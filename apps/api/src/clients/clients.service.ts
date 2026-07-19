import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { assertAgencyAccess } from '../common/scope/agency-scope';
import {
  CorrectIdentityDto,
  CreateClientDto,
  QueryClientsDto,
  UpdateClientDto,
} from './dto/client.dto';

const CLIENT_INCLUDE = {
  agency: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { transactions: true, attachments: true } },
} satisfies Prisma.ClientInclude;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClientDto, actor: AuthenticatedUser) {
    // Le cabiste n'a pas a choisir son agence : elle decoule de son compte.
    const agencyId = dto.agencyId ?? actor.agencyId;
    if (!agencyId) {
      throw new BadRequestException(
        'Aucune agence determinee : precisez agencyId ou utilisez un compte rattache a une agence.',
      );
    }
    assertAgencyAccess(actor, agencyId);

    const existing = await this.prisma.client.findUnique({
      where: {
        uq_client_identity: {
          idDocumentType: dto.idDocumentType,
          idDocumentNo: dto.idDocumentNo,
        },
      },
      include: { agency: { select: { code: true, name: true } } },
    });

    if (existing) {
      // Message utile plutot qu'un 409 sec : le cabiste doit savoir que le
      // client existe deja et ou, pour le reutiliser au lieu d'insister.
      throw new ConflictException(
        `Un client est deja enregistre avec cette piece (${existing.fullName}, agence ${existing.agency.name}). ` +
          'Utilisez la recherche pour le selectionner.',
      );
    }

    const client = await this.prisma.client.create({
      data: {
        agencyId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        fullName: `${dto.firstName} ${dto.lastName}`,
        idDocumentType: dto.idDocumentType,
        idDocumentNo: dto.idDocumentNo,
        nationality: dto.nationality ?? 'Congolaise (RDC)',
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        phone: dto.phone ?? null,
        address: dto.address ?? null,
        isPep: dto.isPep ?? false,
        notes: dto.notes ?? null,
        createdById: actor.id,
      },
      include: CLIENT_INCLUDE,
    });

    await this.audit.log({
      actor,
      action: AuditAction.CREATION,
      entity: 'Client',
      entityId: client.id,
      after: client,
    });

    return client;
  }

  async findAll(
    query: QueryClientsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ClientWhereInput = {};

    // Base clients NATIONALE : tout cabiste peut retrouver un client, meme
    // enregistre dans une autre agence. Le filtre par agence reste possible
    // mais n'est plus impose (la fiche indique l'agence et le cabiste d'origine).
    if (query.agencyId) where.agencyId = query.agencyId;

    if (query.idDocumentType) where.idDocumentType = query.idDocumentType;

    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { idDocumentNo: { contains: query.search.toUpperCase() } },
        { phone: { contains: query.search } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        include: CLIENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.client.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        ...CLIENT_INCLUDE,
        attachments: {
          select: {
            id: true,
            kind: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!client) throw new NotFoundException('Client introuvable.');

    // Consultation ouverte a tous les roles authentifies : la base clients est
    // partagee nationalement (cf. findAll). La modification, elle, reste
    // controlee par les guards de la route et le service update().
    return client;
  }

  async update(id: string, dto: UpdateClientDto, actor: AuthenticatedUser) {
    const before = await this.prisma.client.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Client introuvable.');
    assertAgencyAccess(actor, before.agencyId);

    const firstName = dto.firstName ?? before.firstName;
    const lastName = dto.lastName ?? before.lastName;

    const after = await this.prisma.client.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        // fullName est denormalise : il doit suivre toute modification du nom.
        fullName: `${firstName} ${lastName}`,
        nationality: dto.nationality,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        phone: dto.phone,
        address: dto.address,
        isPep: dto.isPep,
        notes: dto.notes,
      },
      include: CLIENT_INCLUDE,
    });

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'Client',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /**
   * Correction de la piece d'identite.
   *
   * Reservee a l'ADMIN et exigeant un motif : ce numero figure sur des
   * bordereaux deja imprimes et remis a des clients. Le modifier fait
   * diverger le papier et la base, ce qui doit rester tracable et rare.
   */
  async correctIdentity(id: string, dto: CorrectIdentityDto, actor: AuthenticatedUser) {
    const before = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!before) throw new NotFoundException('Client introuvable.');

    const duplicate = await this.prisma.client.findUnique({
      where: {
        uq_client_identity: {
          idDocumentType: dto.idDocumentType,
          idDocumentNo: dto.idDocumentNo,
        },
      },
    });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException(
        `Cette piece est deja enregistree au nom de ${duplicate.fullName}.`,
      );
    }

    const after = await this.prisma.client.update({
      where: { id },
      data: {
        idDocumentType: dto.idDocumentType,
        idDocumentNo: dto.idDocumentNo,
      },
      include: CLIENT_INCLUDE,
    });

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'Client',
      entityId: id,
      before: {
        idDocumentType: before.idDocumentType,
        idDocumentNo: before.idDocumentNo,
      },
      after: {
        idDocumentType: after.idDocumentType,
        idDocumentNo: after.idDocumentNo,
        motif: dto.reason,
        bordereauxImpactes: before._count.transactions,
      },
    });

    return after;
  }

  /**
   * Recherche rapide par piece, utilisee au guichet avant de creer un client.
   * Renvoie null plutot qu'un 404 : "pas trouve" est ici un resultat normal.
   */
  async findByDocument(
    idDocumentType: CreateClientDto['idDocumentType'],
    idDocumentNo: string,
    actor: AuthenticatedUser,
  ) {
    const client = await this.prisma.client.findUnique({
      where: {
        uq_client_identity: {
          idDocumentType,
          idDocumentNo: idDocumentNo.trim().toUpperCase(),
        },
      },
      include: CLIENT_INCLUDE,
    });

    // Base clients nationale : le client est renvoye quelle que soit son
    // agence d'origine. Sa fiche indique le cabiste et l'agence qui l'ont
    // enregistre, pour que l'operateur courant sache d'ou il vient.
    return client;
  }
}
