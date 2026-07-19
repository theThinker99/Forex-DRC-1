import { Injectable } from '@nestjs/common';
import {
  AlertSeverity,
  AlertStatus,
  Prisma,
  Role,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { endOfDay } from '../audit/audit.service';
import { resolveAgencyFilter, resolveOperatorFilter } from '../common/scope/agency-scope';
import { StatsQueryDto } from './dto/stats-query.dto';

/**
 * Tableaux de bord.
 *
 * Toutes les agregations reposent sur usdEquivalent : c'est la seule echelle
 * qui permet d'additionner des operations en USD, EUR et CDF sans melanger
 * des devises. Les operations ANNULEE sont systematiquement exclues des
 * volumes — elles ne se sont economiquement pas produites.
 *
 * Note de typage : les groupBy Prisma utilisent `_count: { _all: true }`
 * plutot que `_count: true`. Le second produit un type d'union que TypeScript
 * n'arrive pas a reduire a un nombre ; `_all` donne un `{ _all: number }` net.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(query: StatsQueryDto, actor: AuthenticatedUser) {
    const scope = this.scope(query, actor);
    const where = this.baseWhere(scope);

    const [
      volumeAgg,
      countByStatus,
      countByType,
      pendingCount,
      alertsAgg,
      distinctClients,
    ] = await this.prisma.$transaction([
      this.prisma.transaction.aggregate({
        where: { ...where, status: { not: TransactionStatus.ANNULEE } },
        _sum: { usdEquivalent: true, commission: true },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['status'],
        where,
        // orderBy est requis par le typage de groupBy Prisma, meme si l'ordre
        // n'a pas d'importance ici (on reprojette ensuite dans fillStatuses).
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { ...where, status: { not: TransactionStatus.ANNULEE } },
        orderBy: { type: 'asc' },
        _count: { _all: true },
        _sum: { usdEquivalent: true },
      }),
      this.prisma.transaction.count({
        where: { ...where, status: TransactionStatus.EN_ATTENTE },
      }),
      this.prisma.alert.groupBy({
        by: ['severity'],
        where: {
          ...this.alertScope(scope),
          status: { in: [AlertStatus.OUVERTE, AlertStatus.EN_REVUE] },
        },
        orderBy: { severity: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.transaction.findMany({
        where: { ...where, status: { not: TransactionStatus.ANNULEE } },
        distinct: ['clientId'],
        select: { clientId: true },
      }),
    ]);

    return {
      periode: { from: scope.dateFrom, to: scope.dateTo },
      perimetre: scope.agencyId ? 'agence' : 'national',
      volumeUsd: decimalToString(volumeAgg._sum.usdEquivalent),
      commissionsUsd: decimalToString(volumeAgg._sum.commission),
      operations: volumeAgg._count,
      clientsServis: distinctClients.length,
      enAttente: pendingCount,
      parStatut: this.fillStatuses(countByStatus),
      parType: countByType.map((row) => ({
        type: row.type,
        operations: countAll(row._count),
        volumeUsd: decimalToString(row._sum?.usdEquivalent ?? null),
      })),
      alertes: this.fillSeverities(alertsAgg),
    };
  }

  /** Serie journaliere du volume, pour le graphique du dashboard. */
  async timeseries(query: StatsQueryDto, actor: AuthenticatedUser) {
    const scope = this.scope(query, actor);

    // Agregation par jour cote SQL : ramener chaque transaction pour la
    // regrouper en memoire ne passerait pas a l'echelle.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`status <> 'ANNULEE'::"TransactionStatus"`,
      Prisma.sql`occurred_at >= ${scope.dateFrom}`,
      Prisma.sql`occurred_at <= ${scope.dateTo}`,
    ];
    if (scope.agencyId) {
      conditions.push(Prisma.sql`agency_id = ${scope.agencyId}::uuid`);
    }
    if (scope.operatorId) {
      conditions.push(Prisma.sql`operator_id = ${scope.operatorId}::uuid`);
    }
    const whereSql = Prisma.join(conditions, ' AND ');

    const rows = await this.prisma.$queryRaw<
      Array<{ jour: Date; operations: bigint; volume_usd: Prisma.Decimal }>
    >`
      SELECT date_trunc('day', occurred_at) AS jour,
             COUNT(*)                       AS operations,
             COALESCE(SUM(usd_equivalent), 0) AS volume_usd
      FROM transactions
      WHERE ${whereSql}
      GROUP BY jour
      ORDER BY jour ASC
    `;

    return rows.map((row) => ({
      jour: row.jour.toISOString().slice(0, 10),
      operations: Number(row.operations),
      volumeUsd: decimalToString(row.volume_usd),
    }));
  }

  /** Classement des cabistes par volume. Reserve aux roles de controle. */
  async topOperators(query: StatsQueryDto, actor: AuthenticatedUser) {
    const scope = this.scope(query, actor);
    const where = this.baseWhere(scope);

    const grouped = await this.prisma.transaction.groupBy({
      by: ['operatorId'],
      where: { ...where, status: { not: TransactionStatus.ANNULEE } },
      _sum: { usdEquivalent: true },
      _count: { _all: true },
      orderBy: { _sum: { usdEquivalent: 'desc' } },
      take: 10,
    });

    const operators = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.operatorId) } },
      select: { id: true, fullName: true, agency: { select: { code: true } } },
    });
    const byId = new Map(operators.map((o) => [o.id, o]));

    return grouped.map((row) => ({
      operatorId: row.operatorId,
      nom: byId.get(row.operatorId)?.fullName ?? 'Inconnu',
      agence: byId.get(row.operatorId)?.agency?.code ?? null,
      operations: countAll(row._count),
      volumeUsd: decimalToString(row._sum?.usdEquivalent ?? null),
    }));
  }

  // ---------------------------------------------------------------------------

  private scope(query: StatsQueryDto, actor: AuthenticatedUser) {
    const agencyId = resolveAgencyFilter(actor, query.agencyId) ?? null;
    // Le cabiste ne voit que ses propres chiffres, jamais ceux de l'agence.
    const operatorId =
      actor.role === Role.CABISTE ? resolveOperatorFilter(actor, undefined) ?? null : null;

    const dateTo = query.dateTo ? endOfDay(query.dateTo) : new Date();
    const dateFrom = query.dateFrom
      ? new Date(query.dateFrom)
      : startOfDay(daysAgo(dateTo, 30));

    return { agencyId, operatorId, dateFrom, dateTo };
  }

  private baseWhere(scope: {
    agencyId: string | null;
    operatorId: string | null;
    dateFrom: Date;
    dateTo: Date;
  }): Prisma.TransactionWhereInput {
    return {
      occurredAt: { gte: scope.dateFrom, lte: scope.dateTo },
      ...(scope.agencyId ? { agencyId: scope.agencyId } : {}),
      ...(scope.operatorId ? { operatorId: scope.operatorId } : {}),
    };
  }

  private alertScope(scope: { agencyId: string | null }): Prisma.AlertWhereInput {
    return scope.agencyId ? { agencyId: scope.agencyId } : {};
  }

  private fillStatuses(
    rows: Array<{ status: TransactionStatus; _count: unknown }>,
  ) {
    const map = new Map(rows.map((r) => [r.status, countAll(r._count)]));
    return Object.values(TransactionStatus).map((status) => ({
      status,
      operations: map.get(status) ?? 0,
    }));
  }

  private fillSeverities(
    rows: Array<{ severity: AlertSeverity; _count: unknown }>,
  ) {
    const map = new Map(rows.map((r) => [r.severity, countAll(r._count)]));
    const parGravite = Object.values(AlertSeverity).map((severity) => ({
      severity,
      nombre: map.get(severity) ?? 0,
    }));
    return {
      total: parGravite.reduce((sum, item) => sum + item.nombre, 0),
      parGravite,
    };
  }
}

/**
 * Extrait le compte d'un resultat groupBy Prisma.
 *
 * Prisma type `_count` comme une union large (`true | { _all?: number } | ...`)
 * que TypeScript ne sait pas reduire. A l'execution, avec `_count: { _all: true }`,
 * c'est un `{ _all: number }`. Ce lecteur defensif accepte les deux formes et
 * satisfait le compilateur.
 */
function countAll(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && '_all' in value) {
    const all = (value as { _all?: number })._all;
    return typeof all === 'number' ? all : 0;
  }
  return 0;
}

function decimalToString(value: Prisma.Decimal | null): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86_400_000);
}
