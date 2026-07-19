import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  AuditAction,
  Prisma,
  Transaction,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { resolveAgencyFilter } from '../common/scope/agency-scope';
import { QueryAlertsDto, ResolveAlertDto } from './dto/alert.dto';
import { endOfDay } from '../audit/audit.service';

const ALERT_INCLUDE = {
  transaction: {
    select: {
      id: true,
      reference: true,
      usdEquivalent: true,
      occurredAt: true,
      status: true,
      operator: { select: { id: true, fullName: true } },
      agency: { select: { id: true, code: true, name: true } },
    },
  },
  client: { select: { id: true, fullName: true, idDocumentNo: true } },
  resolvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AlertInclude;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Evalue une transaction qui vient d'etre saisie et leve les alertes.
   *
   * Appelee dans la transaction SQL de creation : une operation au-dessus du
   * seuil et son alerte doivent apparaitre ensemble. Si l'alerte echouait
   * apres coup, l'operation existerait sans signalement — exactement le
   * scenario que le controle cherche a empecher.
   */
  async evaluateTransaction(
    tx: Prisma.TransactionClient,
    transaction: Transaction,
    context: { isPep: boolean; rateDeviationPercent: number | null; hasIdDocument: boolean },
  ): Promise<void> {
    const thresholds = await this.settings.amlThresholds();
    const ratePolicy = await this.settings.ratePolicy();
    const usd = transaction.usdEquivalent;
    const alerts: Prisma.AlertCreateManyInput[] = [];

    if (usd.gte(thresholds.declarationUsd)) {
      alerts.push({
        type: AlertType.SEUIL_DEPASSE,
        severity: AlertSeverity.CRITIQUE,
        message: `Operation de ${usd.toFixed(2)} USD : seuil de declaration de ${thresholds.declarationUsd} USD franchi.`,
        context: {
          usdEquivalent: usd.toString(),
          seuil: thresholds.declarationUsd,
          nature: 'declaration',
        },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    } else if (usd.gte(thresholds.alertUsd)) {
      alerts.push({
        type: AlertType.SEUIL_DEPASSE,
        severity: AlertSeverity.HAUTE,
        message: `Operation de ${usd.toFixed(2)} USD : seuil de vigilance de ${thresholds.alertUsd} USD franchi.`,
        context: {
          usdEquivalent: usd.toString(),
          seuil: thresholds.alertUsd,
          nature: 'vigilance',
        },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    }

    // Fractionnement : plusieurs operations sous le seuil qui, cumulees sur
    // une fenetre courte, le franchissent. C'est le contournement le plus
    // banal d'un seuil de declaration.
    const windowStart = new Date(
      transaction.occurredAt.getTime() - thresholds.splittingWindowHours * 3_600_000,
    );
    const recent = await tx.transaction.findMany({
      where: {
        clientId: transaction.clientId,
        occurredAt: { gte: windowStart, lte: transaction.occurredAt },
        status: { not: TransactionStatus.ANNULEE },
      },
      select: { id: true, usdEquivalent: true },
    });

    const cumulative = recent.reduce(
      (sum, item) => sum.add(item.usdEquivalent),
      new Prisma.Decimal(0),
    );

    if (
      recent.length >= thresholds.splittingOperationCount &&
      cumulative.gte(thresholds.splittingCumulativeUsd) &&
      usd.lt(thresholds.declarationUsd)
    ) {
      alerts.push({
        type: AlertType.FRACTIONNEMENT,
        severity: AlertSeverity.CRITIQUE,
        message:
          `${recent.length} operations de ce client en ${thresholds.splittingWindowHours} h, ` +
          `cumul ${cumulative.toFixed(2)} USD, chacune sous le seuil de declaration.`,
        context: {
          operations: recent.length,
          cumulUsd: cumulative.toString(),
          fenetreHeures: thresholds.splittingWindowHours,
          seuilCumul: thresholds.splittingCumulativeUsd,
        },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    } else if (recent.length >= thresholds.splittingOperationCount) {
      alerts.push({
        type: AlertType.OPERATIONS_REPETEES,
        severity: AlertSeverity.MOYENNE,
        message: `${recent.length} operations de ce client en ${thresholds.splittingWindowHours} h.`,
        context: {
          operations: recent.length,
          cumulUsd: cumulative.toString(),
          fenetreHeures: thresholds.splittingWindowHours,
        },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    }

    if (
      context.rateDeviationPercent !== null &&
      Math.abs(context.rateDeviationPercent) > ratePolicy.maxDeviationPercent
    ) {
      alerts.push({
        type: AlertType.TAUX_HORS_BANDE,
        severity: AlertSeverity.HAUTE,
        message:
          `Taux applique a ${context.rateDeviationPercent.toFixed(2)} % du taux de reference BCC ` +
          `(tolerance : ${ratePolicy.maxDeviationPercent} %).`,
        context: {
          ecartPercent: context.rateDeviationPercent,
          tolerancePercent: ratePolicy.maxDeviationPercent,
          tauxApplique: transaction.appliedRate.toString(),
        },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    }

    if (!context.hasIdDocument && usd.gte(thresholds.alertUsd)) {
      alerts.push({
        type: AlertType.CLIENT_SANS_PIECE,
        severity: AlertSeverity.HAUTE,
        message:
          'Aucune copie de piece d\'identite n\'est jointe pour un client depassant le seuil de vigilance.',
        context: { usdEquivalent: usd.toString(), seuil: thresholds.alertUsd },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    }

    if (context.isPep) {
      alerts.push({
        type: AlertType.AUTRE,
        severity: AlertSeverity.HAUTE,
        message: 'Client signale comme personne politiquement exposee : vigilance renforcee.',
        context: { usdEquivalent: usd.toString(), pep: true },
        transactionId: transaction.id,
        clientId: transaction.clientId,
        agencyId: transaction.agencyId,
      });
    }

    if (alerts.length > 0) {
      await tx.alert.createMany({ data: alerts });
    }
  }

  async findAll(
    query: QueryAlertsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AlertWhereInput = {};

    const agencyId = resolveAgencyFilter(actor, query.agencyId);
    if (agencyId) where.agencyId = agencyId;

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.type) where.type = query.type;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = endOfDay(query.dateTo);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        include: ALERT_INCLUDE,
        // Les alertes ouvertes et graves d'abord : c'est l'ordre de traitement.
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: ALERT_INCLUDE,
    });
    if (!alert) throw new NotFoundException('Alerte introuvable.');

    if (alert.agencyId) {
      const scope = resolveAgencyFilter(actor, undefined);
      if (scope && scope !== alert.agencyId) {
        throw new NotFoundException('Alerte introuvable.');
      }
    }
    return alert;
  }

  /** Compteur pour les pastilles de notification des dashboards. */
  async openCount(actor: AuthenticatedUser) {
    const agencyId = resolveAgencyFilter(actor, undefined);
    const where: Prisma.AlertWhereInput = {
      status: { in: [AlertStatus.OUVERTE, AlertStatus.EN_REVUE] },
      ...(agencyId ? { agencyId } : {}),
    };

    const [total, critiques] = await this.prisma.$transaction([
      this.prisma.alert.count({ where }),
      this.prisma.alert.count({
        where: { ...where, severity: AlertSeverity.CRITIQUE },
      }),
    ]);

    return { total, critiques };
  }

  /** Traitement d'une alerte. Interdit a la BCC, dont le mandat est consultatif. */
  async resolve(id: string, dto: ResolveAlertDto, actor: AuthenticatedUser) {
    const before = await this.prisma.alert.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Alerte introuvable.');

    if (before.status === AlertStatus.RESOLUE || before.status === AlertStatus.IGNOREE) {
      throw new BadRequestException('Cette alerte est deja cloturee.');
    }
    if (before.agencyId) {
      const scope = resolveAgencyFilter(actor, undefined);
      if (scope && scope !== before.agencyId) {
        throw new NotFoundException('Alerte introuvable.');
      }
    }

    const after = await this.prisma.alert.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution,
        resolvedById: actor.id,
        resolvedAt: new Date(),
      },
      include: ALERT_INCLUDE,
    });

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'Alert',
      entityId: id,
      before,
      after,
    });

    return after;
  }
}
