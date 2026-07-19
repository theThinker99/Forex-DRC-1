import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentKind, AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { assertAgencyAccess } from '../common/scope/agency-scope';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Types acceptes, avec leur signature binaire.
 *
 * On ne fait pas confiance au `mimetype` annonce par le navigateur : il est
 * deduit de l'extension et se falsifie trivialement. Un .exe renomme en .jpg
 * passerait le controle declaratif mais pas la signature.
 */
const ALLOWED: Array<{
  mime: string;
  extension: string;
  matches: (buffer: Buffer) => boolean;
}> = [
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    extension: 'png',
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'application/pdf',
    extension: 'pdf',
    matches: (b) => b.length > 4 && b.toString('ascii', 0, 5) === '%PDF-',
  },
];

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    file: { buffer: Buffer; originalname: string; size: number },
    target: { clientId?: string; transactionId?: string; kind: AttachmentKind },
    actor: AuthenticatedUser,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Fichier vide.');
    }
    if (file.buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(file.buffer.length / 1024 / 1024).toFixed(1)} Mo). Maximum : 5 Mo.`,
      );
    }
    if (!target.clientId && !target.transactionId) {
      throw new BadRequestException(
        'Precisez le client ou l\'operation auquel rattacher le document.',
      );
    }

    const detected = ALLOWED.find((type) => type.matches(file.buffer));
    if (!detected) {
      throw new BadRequestException(
        'Format non accepte. Formats autorises : JPEG, PNG, WebP et PDF.',
      );
    }

    // Perimetre : on verifie l'agence de la cible avant d'ecrire quoi que ce soit.
    if (target.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: target.clientId },
        select: { agencyId: true },
      });
      if (!client) throw new NotFoundException('Client introuvable.');
      assertAgencyAccess(actor, client.agencyId);
    }
    if (target.transactionId) {
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: target.transactionId },
        select: { agencyId: true, operatorId: true },
      });
      if (!transaction) throw new NotFoundException('Operation introuvable.');
      assertAgencyAccess(actor, transaction.agencyId);
      if (actor.role === Role.CABISTE && transaction.operatorId !== actor.id) {
        throw new ForbiddenException(
          'Vous ne pouvez joindre un document qu\'a vos propres operations.',
        );
      }
    }

    const stored = await this.storage.put(file.buffer, {
      prefix: target.kind.toLowerCase(),
      extension: detected.extension,
    });

    const attachment = await this.prisma.attachment.create({
      data: {
        kind: target.kind,
        clientId: target.clientId ?? null,
        transactionId: target.transactionId ?? null,
        // Le nom d'origine n'est conserve que pour l'affichage ; il ne sert
        // jamais a construire un chemin (cf. StorageService.put).
        filename: sanitizeFilename(file.originalname),
        storageKey: stored.storageKey,
        mimeType: detected.mime,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        uploadedById: actor.id,
      },
      select: {
        id: true,
        kind: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        clientId: true,
        transactionId: true,
      },
    });

    await this.audit.log({
      actor,
      action: AuditAction.CREATION,
      entity: 'Attachment',
      entityId: attachment.id,
      after: attachment,
    });

    return attachment;
  }

  /**
   * Renvoie le contenu binaire apres controle d'acces.
   *
   * C'est le seul chemin d'acces au fichier : aucune URL statique n'est
   * exposee, une piece d'identite ne doit pas etre lisible par quiconque
   * devine une adresse.
   */
  async download(id: string, actor: AuthenticatedUser) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      include: {
        client: { select: { agencyId: true } },
        transaction: { select: { agencyId: true, operatorId: true } },
      },
    });
    if (!attachment) throw new NotFoundException('Document introuvable.');

    const agencyId = attachment.client?.agencyId ?? attachment.transaction?.agencyId;
    if (agencyId) assertAgencyAccess(actor, agencyId);

    if (
      actor.role === Role.CABISTE &&
      attachment.transaction &&
      attachment.transaction.operatorId !== actor.id
    ) {
      throw new ForbiddenException('Document rattache a une operation qui n\'est pas la votre.');
    }

    const buffer = await this.storage.get(attachment.storageKey);

    await this.audit.log({
      actor,
      action: AuditAction.CONSULTATION,
      entity: 'Attachment',
      entityId: id,
      after: { filename: attachment.filename },
    });

    return {
      buffer,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
    };
  }

  async listForClient(clientId: string, actor: AuthenticatedUser) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { agencyId: true },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    assertAgencyAccess(actor, client.agencyId);

    return this.prisma.attachment.findMany({
      where: { clientId },
      select: {
        id: true,
        kind: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Suppression, reservee a l'ADMIN.
   *
   * L'enregistrement disparait et le binaire aussi : une piece d'identite
   * versee par erreur (mauvais client) ne doit pas rester sur le disque.
   * L'audit conserve la trace de l'operation.
   */
  async remove(id: string, actor: AuthenticatedUser) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Document introuvable.');

    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.remove(attachment.storageKey);

    await this.audit.log({
      actor,
      action: AuditAction.SUPPRESSION,
      entity: 'Attachment',
      entityId: id,
      before: {
        filename: attachment.filename,
        kind: attachment.kind,
        clientId: attachment.clientId,
        transactionId: attachment.transactionId,
        checksum: attachment.checksum,
      },
    });

    return { message: 'Document supprime.' };
  }
}

/** Neutralise les caracteres de chemin : ce nom n'est qu'une etiquette d'affichage. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  return base.replace(/[^\w.\- ]/g, '_').slice(0, 255) || 'document';
}
