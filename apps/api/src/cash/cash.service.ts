import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CashSession,
  CashSessionStatus,
  Currency,
  Prisma,
  Role,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, endOfDay } from '../audit/audit.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  CloseCashSessionDto,
  OpenCashSessionDto,
  QueryCashSessionsDto,
} from './dto/cash-session.dto';

const D = Prisma.Decimal;

/** Une operation compte dans la caisse tant qu'elle n'est ni rejetee ni annulee. */
const COUNTED_STATUSES: TransactionStatus[] = [
  TransactionStatus.VALIDEE,
  TransactionStatus.EN_ATTENTE,
];

const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,4})?$/;

const SESSION_INCLUDE = {
  operator: { select: { id: true, fullName: true } },
  agency: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CashSessionInclude;

export interface CashLine {
  currency: Currency;
  opening: string;
  inflow: string;
  outflow: string;
  /** ouverture + entrees - sorties */
  theoretical: string;
  /** Montant compte a la cloture, si renseigne. */
  counted: string | null;
  /** compte - theorique (positif = excedent, negatif = manquant). */
  variance: string | null;
}

export interface CashSummary {
  session: {
    id: string;
    status: CashSessionStatus;
    openedAt: Date;
    closedAt: Date | null;
    note: string | null;
    operator: { id: string; fullName: string };
    agency: { id: string; code: string; name: string };
  };
  operations: number;
  lines: CashLine[];
}

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Ouverture
  // -------------------------------------------------------------------------

  async open(dto: OpenCashSessionDto, actor: AuthenticatedUser): Promise<CashSummary> {
    if (!actor.agencyId) {
      throw new ForbiddenException(
        'Seul un operateur rattache a une agence peut ouvrir une caisse.',
      );
    }

    const existing = await this.prisma.cashSession.findFirst({
      where: { operatorId: actor.id, status: CashSessionStatus.OUVERTE },
    });
    if (existing) {
      throw new ConflictException(
        'Vous avez deja une caisse ouverte. Cloturez-la avant d\'en ouvrir une nouvelle.',
      );
    }

    const openingBalances = this.normalizeBalances(dto.balances);

    const session = await this.prisma.cashSession.create({
      data: {
        agencyId: actor.agencyId,
        operatorId: actor.id,
        status: CashSessionStatus.OUVERTE,
        openingBalances,
        note: dto.note ?? null,
      },
      include: SESSION_INCLUDE,
    });

    await this.audit.log({
      actor,
      action: AuditAction.OUVERTURE_CAISSE,
      entity: 'CashSession',
      entityId: session.id,
      after: { openingBalances },
    });

    return this.summarize(session);
  }

  // -------------------------------------------------------------------------
  // Cloture
  // -------------------------------------------------------------------------

  async close(
    id: string,
    dto: CloseCashSessionDto,
    actor: AuthenticatedUser,
  ): Promise<CashSummary> {
    const session = await this.prisma.cashSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Caisse introuvable.');

    // Un cabiste ne cloture que sa propre caisse ; un superviseur/admin peut
    // cloturer celle d'un cabiste de son perimetre (ex. cabiste absent).
    this.assertCanManage(session, actor);

    if (session.status !== CashSessionStatus.OUVERTE) {
      throw new BadRequestException('Cette caisse est deja cloturee.');
    }

    const closingCounted = dto.countedBalances
      ? this.normalizeBalances(dto.countedBalances)
      : undefined;

    const updated = await this.prisma.cashSession.update({
      where: { id },
      data: {
        status: CashSessionStatus.CLOTUREE,
        closedAt: new Date(),
        // DbNull = colonne SQL NULL quand aucun comptage n'est fourni.
        closingCounted: closingCounted ?? Prisma.DbNull,
        note: dto.note ?? session.note,
      },
      include: SESSION_INCLUDE,
    });

    const summary = await this.summarize(updated);

    await this.audit.log({
      actor,
      action: AuditAction.CLOTURE_CAISSE,
      entity: 'CashSession',
      entityId: id,
      before: { status: session.status },
      after: {
        status: updated.status,
        operations: summary.operations,
        soldesTheoriques: summary.lines.map((l) => ({
          devise: l.currency,
          theorique: l.theoretical,
          compte: l.counted,
          ecart: l.variance,
        })),
      },
    });

    return summary;
  }

  // -------------------------------------------------------------------------
  // Consultation
  // -------------------------------------------------------------------------

  /** Caisse actuellement ouverte de l'operateur connecte (ou null). */
  async currentForUser(actor: AuthenticatedUser): Promise<CashSummary | null> {
    const session = await this.prisma.cashSession.findFirst({
      where: { operatorId: actor.id, status: CashSessionStatus.OUVERTE },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
    if (!session) return null;
    return this.summarize(session);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<CashSummary> {
    const session = await this.prisma.cashSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Caisse introuvable.');
    this.assertCanView(session, actor);
    return this.summarize(session);
  }

  async findAll(
    query: QueryCashSessionsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CashSessionWhereInput = {};

    // Perimetre : le cabiste ne voit que ses caisses ; le superviseur celles
    // de son agence ; l'ADMIN et la BCC tout le parc.
    if (actor.role === Role.CABISTE) {
      where.operatorId = actor.id;
    } else if (actor.role === Role.SUPERVISEUR) {
      where.agencyId = actor.agencyId ?? '__none__';
      if (query.operatorId) where.operatorId = query.operatorId;
    } else {
      if (query.agencyId) where.agencyId = query.agencyId;
      if (query.operatorId) where.operatorId = query.operatorId;
    }

    if (query.dateFrom || query.dateTo) {
      where.openedAt = {};
      if (query.dateFrom) where.openedAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.openedAt.lte = endOfDay(query.dateTo);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cashSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: { openedAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.cashSession.count({ where }),
    ]);

    // On renvoie une version allegee (sans recalcul complet) pour la liste.
    const data = rows.map((s) => ({
      id: s.id,
      status: s.status,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      operator: s.operator,
      agency: s.agency,
      openingBalances: s.openingBalances,
    }));

    return paginate(data, total, query.page, query.limit);
  }

  // -------------------------------------------------------------------------
  // Calcul du resume
  // -------------------------------------------------------------------------

  /**
   * Calcule les mouvements de la session a partir de ses transactions.
   *
   * Regle physique de caisse : a chaque operation, la caisse RECOIT ce que le
   * client remet (fromCurrency / fromAmount) et DEBOURSE ce qu'elle rend au
   * client (toCurrency / toAmount). La commission, deja deduite du montant
   * remis, reste donc mecaniquement en caisse.
   */
  private async summarize(session: CashSessionWithRels): Promise<CashSummary> {
    const txns = await this.prisma.transaction.findMany({
      where: {
        cashSessionId: session.id,
        status: { in: COUNTED_STATUSES },
      },
      select: {
        fromCurrency: true,
        fromAmount: true,
        toCurrency: true,
        toAmount: true,
      },
    });

    const inflow = new Map<Currency, Prisma.Decimal>();
    const outflow = new Map<Currency, Prisma.Decimal>();
    const add = (map: Map<Currency, Prisma.Decimal>, cur: Currency, amount: Prisma.Decimal) => {
      map.set(cur, (map.get(cur) ?? new D(0)).add(amount));
    };

    for (const t of txns) {
      add(inflow, t.fromCurrency, t.fromAmount);
      add(outflow, t.toCurrency, t.toAmount);
    }

    const opening = toDecimalMap(session.openingBalances);
    const counted = session.closingCounted
      ? toDecimalMap(session.closingCounted)
      : null;

    // Ensemble des devises concernees : fonds d'ouverture, mouvements, comptages.
    const currencies = new Set<Currency>();
    for (const c of opening.keys()) currencies.add(c);
    for (const c of inflow.keys()) currencies.add(c);
    for (const c of outflow.keys()) currencies.add(c);
    if (counted) for (const c of counted.keys()) currencies.add(c);

    // Ordre stable : CDF en tete, puis alphabetique.
    const ordered = [...currencies].sort((a, b) => {
      if (a === Currency.CDF) return -1;
      if (b === Currency.CDF) return 1;
      return a.localeCompare(b);
    });

    const lines: CashLine[] = ordered.map((currency) => {
      const open = opening.get(currency) ?? new D(0);
      const inn = inflow.get(currency) ?? new D(0);
      const out = outflow.get(currency) ?? new D(0);
      const theoretical = open.add(inn).minus(out);
      const cnt = counted?.get(currency) ?? null;
      const variance = cnt !== null ? cnt.minus(theoretical) : null;

      return {
        currency,
        opening: open.toFixed(2),
        inflow: inn.toFixed(2),
        outflow: out.toFixed(2),
        theoretical: theoretical.toFixed(2),
        counted: cnt !== null ? cnt.toFixed(2) : null,
        variance: variance !== null ? variance.toFixed(2) : null,
      };
    });

    return {
      session: {
        id: session.id,
        status: session.status,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        note: session.note,
        operator: session.operator,
        agency: session.agency,
      },
      operations: txns.length,
      lines,
    };
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  /**
   * Valide et normalise un dictionnaire devise -> montant.
   * Rejette les devises inconnues et les montants negatifs ou mal formes.
   */
  private normalizeBalances(balances: Record<string, unknown>): Prisma.JsonObject {
    const validCurrencies = new Set<string>(Object.values(Currency));
    const out: Prisma.JsonObject = {};

    for (const [rawKey, rawValue] of Object.entries(balances)) {
      const currency = rawKey.toUpperCase();
      if (!validCurrencies.has(currency)) {
        throw new BadRequestException(`Devise inconnue : "${rawKey}".`);
      }
      const value = typeof rawValue === 'number' ? String(rawValue) : rawValue;
      if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value.trim())) {
        throw new BadRequestException(
          `Montant invalide pour ${currency} : nombre positif avec au plus 4 decimales attendu.`,
        );
      }
      const decimal = new D(value.trim());
      if (decimal.lt(0)) {
        throw new BadRequestException(`Le montant pour ${currency} ne peut pas etre negatif.`);
      }
      // On ignore les zeros : inutile d'encombrer la caisse d'une devise a 0.
      if (decimal.gt(0)) {
        out[currency] = decimal.toFixed(2);
      }
    }

    return out;
  }

  private assertCanManage(session: CashSession, actor: AuthenticatedUser): void {
    if (actor.role === Role.ADMIN) return;
    if (actor.role === Role.SUPERVISEUR && session.agencyId === actor.agencyId) return;
    if (actor.role === Role.CABISTE && session.operatorId === actor.id) return;
    throw new ForbiddenException('Vous ne pouvez pas gerer cette caisse.');
  }

  private assertCanView(session: CashSession, actor: AuthenticatedUser): void {
    if (actor.role === Role.ADMIN || actor.role === Role.BCC) return;
    if (
      (actor.role === Role.SUPERVISEUR && session.agencyId === actor.agencyId) ||
      (actor.role === Role.CABISTE && session.operatorId === actor.id)
    ) {
      return;
    }
    throw new NotFoundException('Caisse introuvable.');
  }
}

type CashSessionWithRels = CashSession & {
  operator: { id: string; fullName: string };
  agency: { id: string; code: string; name: string };
};

/** Convertit un JSON { devise: montant } en Map<Currency, Decimal>. */
function toDecimalMap(value: Prisma.JsonValue): Map<Currency, Prisma.Decimal> {
  const map = new Map<Currency, Prisma.Decimal>();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === 'string' || typeof raw === 'number') {
        map.set(key as Currency, new D(raw));
      }
    }
  }
  return map;
}
