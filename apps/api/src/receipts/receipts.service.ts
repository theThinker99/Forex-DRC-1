import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { assertAgencyAccess } from '../common/scope/agency-scope';
import { ReceiptPdfService, ReceiptData } from './receipt-pdf.service';

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: ReceiptPdfService,
    private readonly audit: AuditService,
  ) {}

  async metadata(transactionId: string, actor: AuthenticatedUser) {
    const receipt = await this.load(transactionId, actor);
    return {
      id: receipt.id,
      number: receipt.number,
      issuedAt: receipt.issuedAt,
      printCount: receipt.printCount,
      lastPrintedAt: receipt.lastPrintedAt,
      checksum: receipt.checksum,
      transaction: {
        reference: receipt.transaction.reference,
        status: receipt.transaction.status,
      },
    };
  }

  /**
   * Produit le PDF du bordereau et incremente le compteur d'impressions.
   *
   * Le compteur n'est pas cosmetique : une operation dont le bordereau est
   * reimprime dix fois est un signal que la BCC doit pouvoir constater. La
   * premiere generation ne compte pas comme une reimpression.
   */
  async render(
    transactionId: string,
    actor: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const receipt = await this.load(transactionId, actor);
    const t = receipt.transaction;

    const isReprint = receipt.printCount > 0;

    const updated = await this.prisma.receipt.update({
      where: { id: receipt.id },
      data: { printCount: { increment: 1 }, lastPrintedAt: new Date() },
      select: { printCount: true },
    });

    const data: ReceiptData = {
      number: receipt.number,
      reference: t.reference,
      type: t.type,
      issuedAt: receipt.issuedAt,
      occurredAt: t.occurredAt,
      agency: {
        code: t.agency.code,
        name: t.agency.name,
        city: t.agency.city,
        address: t.agency.address,
        phone: t.agency.phone,
        licenseNo: t.agency.licenseNo,
      },
      operator: { fullName: t.operator.fullName },
      client: {
        fullName: t.client.fullName,
        idDocumentType: t.client.idDocumentType,
        idDocumentNo: t.client.idDocumentNo,
        phone: t.client.phone,
      },
      fromCurrency: t.fromCurrency,
      fromAmount: t.fromAmount.toString(),
      toCurrency: t.toCurrency,
      toAmount: t.toAmount.toString(),
      appliedRate: t.appliedRate.toString(),
      commission: t.commission.toString(),
      checksum: receipt.checksum,
      reprint: isReprint,
      printCount: updated.printCount,
    };

    const buffer = await this.pdf.generate(data);

    await this.audit.log({
      actor,
      action: AuditAction.IMPRESSION_BORDEREAU,
      entity: 'Receipt',
      entityId: receipt.id,
      after: {
        bordereau: receipt.number,
        reimpression: isReprint,
        impressionNo: updated.printCount,
      },
    });

    return { buffer, filename: `bordereau-${receipt.number}.pdf` };
  }

  /**
   * Charge le bordereau et applique le controle d'acces.
   *
   * Le cabiste ne peut imprimer que les bordereaux de ses propres operations ;
   * la BCC les consulte tous mais, en lecture seule, n'en genere pas de
   * duplicata (le ReadOnlyGuard couvre les routes d'ecriture ; l'impression
   * passe par un POST, donc lui reste fermee).
   */
  private async load(transactionId: string, actor: AuthenticatedUser) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { transactionId },
      include: {
        transaction: {
          include: {
            agency: {
              select: {
                code: true,
                name: true,
                city: true,
                address: true,
                phone: true,
                licenseNo: true,
              },
            },
            operator: { select: { id: true, fullName: true } },
            client: {
              select: {
                fullName: true,
                idDocumentType: true,
                idDocumentNo: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException(
        'Aucun bordereau pour cette operation : elle n\'est peut-etre pas encore validee.',
      );
    }

    assertAgencyAccess(actor, receipt.transaction.agencyId);
    if (
      actor.role === Role.CABISTE &&
      receipt.transaction.operatorId !== actor.id
    ) {
      throw new NotFoundException('Bordereau introuvable.');
    }

    return receipt;
  }
}
