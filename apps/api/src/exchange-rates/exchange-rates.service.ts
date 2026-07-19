import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Currency, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { FOREIGN_CURRENCIES } from '../common/utils/currencies';
import {
  CreateExchangeRateDto,
  QueryExchangeRatesDto,
} from './dto/exchange-rate.dto';

const RATE_INCLUDE = {
  agency: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ExchangeRateInclude;

@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Publie un nouveau taux et cloture le precedent.
   *
   * On n'ecrase jamais un taux existant : les transactions passees pointent
   * dessus, et un controle BCC doit pouvoir reconstituer le taux affiche a
   * l'instant T. L'historique est donc append-only.
   */
  async create(dto: CreateExchangeRateDto, actor: AuthenticatedUser) {
    if (dto.baseCurrency === Currency.CDF) {
      throw new BadRequestException(
        'La devise de base doit etre une devise etrangere (USD, EUR) : le CDF est la devise de cotation.',
      );
    }
    if (dto.quoteCurrency !== Currency.CDF) {
      throw new BadRequestException(
        'La devise de cotation doit etre le CDF : les taux expriment le prix d\'une devise etrangere en francs congolais.',
      );
    }
    // Base forcement etrangere et cotation forcement CDF : la paire differe
    // toujours, inutile de le reverifier (TypeScript le sait deja).

    const buyRate = new Prisma.Decimal(dto.buyRate);
    const sellRate = new Prisma.Decimal(dto.sellRate);
    const referenceRate = dto.referenceRate ? new Prisma.Decimal(dto.referenceRate) : null;

    if (buyRate.lte(0) || sellRate.lte(0)) {
      throw new BadRequestException('Les taux doivent etre strictement positifs.');
    }
    // Un achat plus cher que la vente ferait perdre de l'argent au bureau a
    // chaque aller-retour : c'est presque toujours une inversion de saisie.
    if (buyRate.gte(sellRate)) {
      throw new BadRequestException(
        'Le taux d\'achat doit etre inferieur au taux de vente. Verifiez que les deux valeurs ne sont pas inversees.',
      );
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    // Perimetre du taux selon le role :
    //  - ADMIN : taux national (agencyId nul) ou taux d'une agence precise.
    //  - CABISTE / SUPERVISEUR : uniquement le taux de LEUR agence. Ils ne
    //    peuvent pas fixer un taux national ni celui d'une autre agence.
    let agencyId: string | null;
    if (actor.role === Role.ADMIN) {
      agencyId = dto.agencyId ?? null;
    } else if (actor.role === Role.CABISTE || actor.role === Role.SUPERVISEUR) {
      if (!actor.agencyId) {
        throw new ForbiddenException(
          'Votre compte n\'est rattache a aucune agence : impossible de publier un taux.',
        );
      }
      if (dto.agencyId && dto.agencyId !== actor.agencyId) {
        throw new ForbiddenException(
          'Vous ne pouvez publier un taux que pour votre propre agence.',
        );
      }
      agencyId = actor.agencyId;
    } else {
      // La BCC (lecture seule) est deja bloquee par le ReadOnlyGuard ; ce
      // garde-fou couvre tout role futur non prevu.
      throw new ForbiddenException('Votre role ne permet pas de publier un taux.');
    }

    if (agencyId) {
      const agency = await this.prisma.agency.findUnique({ where: { id: agencyId } });
      if (!agency) throw new BadRequestException('Agence introuvable.');
    }

    // Cloture + creation dans la meme transaction : un instant sans taux en
    // vigueur bloquerait le guichet.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.exchangeRate.updateMany({
        where: {
          agencyId,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          effectiveTo: null,
        },
        data: { effectiveTo: effectiveFrom },
      });

      const rate = await tx.exchangeRate.create({
        data: {
          agencyId,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          buyRate,
          sellRate,
          referenceRate,
          effectiveFrom,
          createdById: actor.id,
        },
        include: RATE_INCLUDE,
      });

      await this.audit.logInTransaction(tx, {
        actor,
        action: AuditAction.CREATION,
        entity: 'ExchangeRate',
        entityId: rate.id,
        after: rate,
      });

      return rate;
    });

    return created;
  }

  /**
   * Taux en vigueur pour une paire.
   *
   * Un taux propre a l'agence prime sur le taux national : une agence
   * frontaliere n'affiche pas les memes conditions qu'un guichet de Kinshasa.
   */
  async current(
    baseCurrency: Currency,
    agencyId: string | null,
    at: Date = new Date(),
  ) {
    const where: Prisma.ExchangeRateWhereInput = {
      baseCurrency,
      quoteCurrency: Currency.CDF,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    };

    if (agencyId) {
      const agencyRate = await this.prisma.exchangeRate.findFirst({
        where: { ...where, agencyId },
        orderBy: { effectiveFrom: 'desc' },
        include: RATE_INCLUDE,
      });
      if (agencyRate) return agencyRate;
    }

    return this.prisma.exchangeRate.findFirst({
      where: { ...where, agencyId: null },
      orderBy: { effectiveFrom: 'desc' },
      include: RATE_INCLUDE,
    });
  }

  /**
   * Tableau des taux en vigueur pour toutes les devises etrangeres.
   *
   * Une seule requete ramene les taux actifs (agence + national), puis on
   * choisit pour chaque devise le taux le plus specifique (agence prioritaire).
   * On evite ainsi une requete par devise, qui ne passerait pas a l'echelle
   * avec la vingtaine de devises geree.
   */
  async board(agencyId: string | null) {
    const now = new Date();

    const activeRates = await this.prisma.exchangeRate.findMany({
      where: {
        quoteCurrency: Currency.CDF,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        AND: [{ OR: [{ agencyId: null }, ...(agencyId ? [{ agencyId }] : [])] }],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: RATE_INCLUDE,
    });

    // Index par devise, en privilegiant le taux propre a l'agence.
    const byCurrency = new Map<Currency, (typeof activeRates)[number]>();
    for (const rate of activeRates) {
      const existing = byCurrency.get(rate.baseCurrency);
      if (!existing) {
        byCurrency.set(rate.baseCurrency, rate);
      } else if (existing.agencyId === null && rate.agencyId !== null) {
        // Le taux agence remplace le taux national pour cette devise.
        byCurrency.set(rate.baseCurrency, rate);
      }
    }

    return FOREIGN_CURRENCIES.map((currency) => {
      const rate = byCurrency.get(currency) ?? null;
      return {
        currency,
        available: rate !== null,
        rate: rate
          ? {
              id: rate.id,
              buyRate: rate.buyRate.toString(),
              sellRate: rate.sellRate.toString(),
              referenceRate: rate.referenceRate?.toString() ?? null,
              effectiveFrom: rate.effectiveFrom,
              scope: rate.agencyId ? 'agence' : 'national',
              agency: rate.agency,
            }
          : null,
      };
    });
  }

  async findAll(query: QueryExchangeRatesDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ExchangeRateWhereInput = {};

    if (query.baseCurrency) where.baseCurrency = query.baseCurrency;
    if (query.agencyId) where.agencyId = query.agencyId;
    if (query.activeOnly) {
      const now = new Date();
      where.effectiveFrom = { lte: now };
      where.OR = [{ effectiveTo: null }, { effectiveTo: { gt: now } }];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.exchangeRate.findMany({
        where,
        include: RATE_INCLUDE,
        orderBy: { effectiveFrom: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.exchangeRate.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const rate = await this.prisma.exchangeRate.findUnique({
      where: { id },
      include: {
        ...RATE_INCLUDE,
        _count: { select: { transactions: true } },
      },
    });
    if (!rate) throw new NotFoundException('Taux introuvable.');
    return rate;
  }
}
