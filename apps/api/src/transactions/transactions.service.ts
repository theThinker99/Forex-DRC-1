import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Currency,
  Prisma,
  Role,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, endOfDay } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { SettingsService } from '../settings/settings.service';
import { SequenceService } from '../common/sequences/sequence.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  assertAgencyAccess,
  resolveAgencyFilter,
  resolveOperatorFilter,
} from '../common/scope/agency-scope';
import { convert, roundAmount } from '../common/utils/money';
import {
  CancelTransactionDto,
  CreateTransactionDto,
  QueryTransactionsDto,
  ReviewTransactionDto,
} from './dto/transaction.dto';

const D = Prisma.Decimal;

const TRANSACTION_INCLUDE = {
  client: {
    select: {
      id: true,
      fullName: true,
      idDocumentType: true,
      idDocumentNo: true,
      phone: true,
      isPep: true,
    },
  },
  operator: { select: { id: true, fullName: true, email: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  agency: { select: { id: true, code: true, name: true, city: true } },
  receipt: { select: { id: true, number: true, issuedAt: true, printCount: true } },
  _count: { select: { alerts: true, attachments: true } },
} satisfies Prisma.TransactionInclude;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
    private readonly alerts: AlertsService,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  async create(dto: CreateTransactionDto, actor: AuthenticatedUser) {
    if (dto.foreignCurrency === Currency.CDF) {
      throw new BadRequestException(
        'La devise de l\'operation doit etre une devise etrangere : le CDF en est toujours la contrepartie.',
      );
    }

    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
      include: { _count: { select: { attachments: true } } },
    });
    if (!client) throw new NotFoundException('Client introuvable.');

    // L'operation est rattachee a l'agence de l'OPERATEUR (le guichet ou elle
    // se fait), pas a l'agence ou le client a ete initialement enregistre :
    // un client de Goma servi a Kinshasa produit une operation Kinshasa.
    // Pour l'ADMIN (sans agence), on retombe sur l'agence du client.
    const agencyId = actor.agencyId ?? client.agencyId;

    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, code: true, status: true, name: true },
    });
    if (!agency) throw new NotFoundException('Agence introuvable.');
    if (agency.status !== 'ACTIVE') {
      throw new BadRequestException(
        `L'agence "${agency.name}" est fermee : aucune operation ne peut y etre saisie.`,
      );
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    // Une operation datee dans le futur fausserait les cumuls journaliers et
    // la detection de fractionnement. On tolere une minute de derive d'horloge.
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException(
        'L\'horodatage de l\'operation ne peut pas etre dans le futur.',
      );
    }

    const rateRow = await this.rates.current(dto.foreignCurrency, agencyId, occurredAt);
    if (!rateRow && !dto.rateOverride) {
      throw new BadRequestException(
        `Aucun taux ${dto.foreignCurrency}/CDF n'est en vigueur. Demandez a un administrateur de publier le taux du jour.`,
      );
    }

    const appliedRate = await this.resolveAppliedRate(dto, rateRow, actor);
    const fromAmount = new D(dto.fromAmount);
    const commission = dto.commission ? new D(dto.commission) : new D(0);

    if (fromAmount.lte(0)) {
      throw new BadRequestException('Le montant doit etre strictement positif.');
    }

    const conversion = convert({
      type: dto.type,
      foreignCurrency: dto.foreignCurrency,
      fromAmount,
      rate: appliedRate,
      commission,
    });

    if (conversion.toAmount.lte(0)) {
      throw new BadRequestException(
        `La commission (${commission.toFixed(2)}) absorbe la totalite du montant a remettre au client (${conversion.grossAmount.toFixed(2)}).`,
      );
    }

    const usd = await this.computeUsdEquivalent({
      type: dto.type,
      foreignCurrency: dto.foreignCurrency,
      fromAmount,
      grossAmount: conversion.grossAmount,
      appliedRate,
      agencyId,
      occurredAt,
    });

    const policy = await this.settings.transactionPolicy();
    // Au-dela du seuil, l'operation attend un superviseur ; en dessous, elle
    // est acquise immediatement : faire patienter chaque client au guichet
    // pour 20 USD serait ingerable.
    const status = usd.gte(policy.supervisorValidationAboveUsd)
      ? TransactionStatus.EN_ATTENTE
      : TransactionStatus.VALIDEE;

    const rateDeviation = this.rateDeviationPercent(appliedRate, rateRow?.referenceRate ?? null);

    // Si l'operateur a une caisse ouverte, l'operation y est rattachee pour le
    // suivi des soldes par devise. Facultatif : sans caisse ouverte, null.
    const openSession = await this.prisma.cashSession.findFirst({
      where: { operatorId: actor.id, status: 'OUVERTE' },
      select: { id: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await this.sequences.nextTransactionReference(
        tx,
        agency.code,
        occurredAt,
      );

      const transaction = await tx.transaction.create({
        data: {
          reference,
          agencyId,
          operatorId: actor.id,
          clientId: client.id,
          cashSessionId: openSession?.id ?? null,
          type: dto.type,
          fromCurrency: conversion.fromCurrency,
          toCurrency: conversion.toCurrency,
          fromAmount,
          toAmount: conversion.toAmount,
          appliedRate,
          commission: conversion.commission,
          usdEquivalent: usd,
          exchangeRateId: dto.rateOverride ? null : (rateRow?.id ?? null),
          status,
          occurredAt,
          // Une operation validee d'office l'est par le systeme, pas par un
          // humain : reviewedById reste nul, le statut suffit a le dire.
          reviewedAt: status === TransactionStatus.VALIDEE ? new Date() : null,
          reviewComment:
            status === TransactionStatus.VALIDEE
              ? `Validation automatique : contre-valeur inferieure au seuil de ${policy.supervisorValidationAboveUsd} USD.`
              : null,
        },
      });

      if (status === TransactionStatus.VALIDEE) {
        await this.issueReceipt(tx, transaction.id, agency.code, occurredAt, actor.id);
      }

      await this.alerts.evaluateTransaction(tx, transaction, {
        isPep: client.isPep,
        rateDeviationPercent: rateDeviation,
        hasIdDocument: client._count.attachments > 0,
      });

      await this.audit.logInTransaction(tx, {
        actor,
        action: AuditAction.CREATION,
        entity: 'Transaction',
        entityId: transaction.id,
        after: {
          ...transaction,
          motifDerogation: dto.rateOverrideReason ?? null,
        },
      });

      return transaction;
    });

    return this.findOne(created.id, actor);
  }

  // ---------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------

  async findAll(
    query: QueryTransactionsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<unknown>> {
    const where = this.buildWhere(query, actor);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        ...TRANSACTION_INCLUDE,
        exchangeRate: {
          select: {
            id: true,
            buyRate: true,
            sellRate: true,
            referenceRate: true,
            effectiveFrom: true,
          },
        },
        alerts: {
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            message: true,
            createdAt: true,
          },
          orderBy: { severity: 'desc' },
        },
        attachments: {
          select: {
            id: true,
            kind: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');

    this.assertCanRead(transaction, actor);
    return transaction;
  }

  /**
   * Export CSV. Volontairement sans pagination — c'est le but d'un export —
   * mais borne dans le temps pour ne pas materialiser tout l'historique en
   * memoire sur un clic distrait.
   */
  async export(query: QueryTransactionsDto, actor: AuthenticatedUser): Promise<string> {
    const where = this.buildWhere(query, actor);

    const count = await this.prisma.transaction.count({ where });
    const MAX_EXPORT = 50_000;
    if (count > MAX_EXPORT) {
      throw new BadRequestException(
        `L'export porte sur ${count} operations, au-dela de la limite de ${MAX_EXPORT}. Resserrez la periode.`,
      );
    }

    const rows = await this.prisma.transaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      orderBy: { occurredAt: 'asc' },
    });

    const header = [
      'Reference',
      'Date',
      'Heure',
      'Agence',
      'Cabiste',
      'Client',
      'Type piece',
      'Numero piece',
      'Sens',
      'Devise remise',
      'Montant remis',
      'Devise recue',
      'Montant recu',
      'Taux applique',
      'Commission',
      'Contre-valeur USD',
      'Statut',
      'Bordereau',
    ];

    const lines = rows.map((t) =>
      [
        t.reference,
        formatDate(t.occurredAt),
        formatTime(t.occurredAt),
        `${t.agency.code} - ${t.agency.name}`,
        t.operator.fullName,
        t.client.fullName,
        t.client.idDocumentType,
        t.client.idDocumentNo,
        t.type,
        t.fromCurrency,
        t.fromAmount.toFixed(2),
        t.toCurrency,
        t.toAmount.toFixed(2),
        t.appliedRate.toFixed(6),
        t.commission.toFixed(2),
        t.usdEquivalent.toFixed(2),
        t.status,
        t.receipt?.number ?? '',
      ].map(csvCell),
    );

    await this.audit.log({
      actor,
      action: AuditAction.EXPORT,
      entity: 'Transaction',
      after: { lignes: rows.length, filtres: { ...query } },
    });

    // BOM UTF-8 : sans lui, Excel en environnement francophone lit les
    // accents en Latin-1 et affiche "Rf�rence".
    return '﻿' + [header.map(csvCell).join(';'), ...lines.map((l) => l.join(';'))].join('\r\n');
  }

  // ---------------------------------------------------------------------------
  // Validation / rejet / annulation
  // ---------------------------------------------------------------------------

  async validate(id: string, dto: ReviewTransactionDto, actor: AuthenticatedUser) {
    const transaction = await this.loadForReview(id, actor);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.VALIDEE,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewComment: dto.comment ?? null,
        },
        include: { agency: { select: { code: true } } },
      });

      // Le bordereau n'existe qu'a la validation : remettre un justificatif
      // au client pour une operation encore contestable n'aurait pas de sens.
      await this.issueReceipt(
        tx,
        result.id,
        result.agency.code,
        result.occurredAt,
        actor.id,
      );

      await this.audit.logInTransaction(tx, {
        actor,
        action: AuditAction.VALIDATION,
        entity: 'Transaction',
        entityId: id,
        before: { status: transaction.status },
        after: { status: result.status, commentaire: dto.comment ?? null },
      });

      return result;
    });

    return this.findOne(updated.id, actor);
  }

  async reject(id: string, dto: ReviewTransactionDto, actor: AuthenticatedUser) {
    if (!dto.comment) {
      throw new BadRequestException(
        'Un motif est obligatoire pour rejeter une operation : le cabiste doit savoir quoi corriger.',
      );
    }

    const transaction = await this.loadForReview(id, actor);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.REJETEE,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewComment: dto.comment,
        },
      });

      await this.audit.logInTransaction(tx, {
        actor,
        action: AuditAction.REJET,
        entity: 'Transaction',
        entityId: id,
        before: { status: transaction.status },
        after: { status: result.status, motif: dto.comment },
      });
    });

    return this.findOne(id, actor);
  }

  /**
   * Annulation d'une operation deja validee.
   *
   * Reservee a l'ADMIN : le bordereau est deja entre les mains du client.
   * On ne detruit ni la transaction ni son bordereau, on marque l'operation
   * ANNULEE — la piste doit rester lisible pour un controle ulterieur.
   */
  async cancel(id: string, dto: CancelTransactionDto, actor: AuthenticatedUser) {
    const before = await this.prisma.transaction.findUnique({
      where: { id },
      include: { receipt: { select: { number: true } } },
    });
    if (!before) throw new NotFoundException('Transaction introuvable.');

    if (before.status === TransactionStatus.ANNULEE) {
      throw new BadRequestException('Cette operation est deja annulee.');
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.ANNULEE,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewComment: dto.reason,
        },
      });

      await this.audit.logInTransaction(tx, {
        actor,
        action: AuditAction.ANNULATION,
        entity: 'Transaction',
        entityId: id,
        before: { status: before.status, bordereau: before.receipt?.number ?? null },
        after: { status: result.status, motif: dto.reason },
      });
    });

    return this.findOne(id, actor);
  }

  // ---------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------

  private async loadForReview(id: string, actor: AuthenticatedUser) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');

    assertAgencyAccess(actor, transaction.agencyId);

    if (transaction.status !== TransactionStatus.EN_ATTENTE) {
      throw new BadRequestException(
        `Cette operation est deja ${transaction.status.toLowerCase()} : seule une operation en attente peut etre validee ou rejetee.`,
      );
    }

    // Un superviseur qui validerait sa propre saisie annulerait le controle :
    // le principe des quatre yeux impose deux personnes distinctes.
    if (transaction.operatorId === actor.id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas valider une operation que vous avez saisie vous-meme.',
      );
    }

    return transaction;
  }

  private async issueReceipt(
    tx: Prisma.TransactionClient,
    transactionId: string,
    agencyCode: string,
    date: Date,
    issuedById: string,
  ): Promise<void> {
    const existing = await tx.receipt.findUnique({ where: { transactionId } });
    // Un bordereau est unique et definitif : une revalidation ne doit pas en
    // emettre un second pour la meme operation.
    if (existing) return;

    const number = await this.sequences.nextReceiptNumber(tx, agencyCode, date);

    const transaction = await tx.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: {
        client: { select: { fullName: true, idDocumentNo: true } },
        agency: { select: { code: true } },
      },
    });

    await tx.receipt.create({
      data: {
        number,
        transactionId,
        issuedById,
        checksum: receiptChecksum({
          number,
          reference: transaction.reference,
          client: transaction.client.fullName,
          idDocumentNo: transaction.client.idDocumentNo,
          fromAmount: transaction.fromAmount.toString(),
          fromCurrency: transaction.fromCurrency,
          toAmount: transaction.toAmount.toString(),
          toCurrency: transaction.toCurrency,
          appliedRate: transaction.appliedRate.toString(),
          occurredAt: transaction.occurredAt.toISOString(),
        }),
      },
    });
  }

  /**
   * Determine le taux a appliquer.
   *
   * Par defaut : taux d'achat ou de vente en vigueur, fige a la saisie.
   * Sur derogation : taux libre, mais reserve a l'ADMIN et au SUPERVISEUR,
   * motif obligatoire, et alerte systematique — un taux hors grille est
   * exactement ce qu'un controle BCC vient chercher.
   */
  private async resolveAppliedRate(
    dto: CreateTransactionDto,
    rateRow: { buyRate: Prisma.Decimal; sellRate: Prisma.Decimal } | null,
    actor: AuthenticatedUser,
  ): Promise<Prisma.Decimal> {
    if (dto.rateOverride) {
      if (actor.role !== Role.ADMIN && actor.role !== Role.SUPERVISEUR) {
        throw new ForbiddenException(
          'Seul un superviseur ou un administrateur peut appliquer un taux derogatoire.',
        );
      }
      if (!dto.rateOverrideReason) {
        throw new BadRequestException(
          'Un motif est obligatoire pour appliquer un taux derogatoire.',
        );
      }
      const override = new D(dto.rateOverride);
      if (override.lte(0)) {
        throw new BadRequestException('Le taux derogatoire doit etre strictement positif.');
      }
      return override;
    }

    if (!rateRow) {
      throw new BadRequestException('Aucun taux en vigueur pour cette devise.');
    }

    return dto.type === TransactionType.ACHAT ? rateRow.buyRate : rateRow.sellRate;
  }

  /**
   * Contre-valeur USD, socle des seuils AML et des statistiques.
   *
   * Pour une paire USD/CDF, la reponse est directe. Pour EUR/CDF, on passe
   * par le CDF puis par le taux USD/CDF du moment : sans cette conversion,
   * une operation en euros echapperait a tous les seuils.
   */
  private async computeUsdEquivalent(params: {
    type: TransactionType;
    foreignCurrency: Currency;
    fromAmount: Prisma.Decimal;
    grossAmount: Prisma.Decimal;
    appliedRate: Prisma.Decimal;
    agencyId: string;
    occurredAt: Date;
  }): Promise<Prisma.Decimal> {
    // Montant de l'operation exprime en devise etrangere, quel que soit le sens.
    const foreignAmount =
      params.type === TransactionType.ACHAT ? params.fromAmount : params.grossAmount;

    if (params.foreignCurrency === Currency.USD) {
      return roundAmount(foreignAmount);
    }

    const usdRow = await this.rates.current(Currency.USD, params.agencyId, params.occurredAt);
    if (!usdRow) {
      throw new BadRequestException(
        'Aucun taux USD/CDF en vigueur : impossible de calculer la contre-valeur en USD, ' +
          'necessaire au controle des seuils. Publiez le taux USD du jour.',
      );
    }

    // Reference BCC si disponible, sinon milieu de fourchette : une valorisation
    // de controle ne doit pencher ni vers l'achat ni vers la vente.
    const usdCdf =
      usdRow.referenceRate ?? usdRow.buyRate.add(usdRow.sellRate).div(2);

    const inCdf = foreignAmount.mul(params.appliedRate);
    return roundAmount(inCdf.div(usdCdf));
  }

  private rateDeviationPercent(
    applied: Prisma.Decimal,
    reference: Prisma.Decimal | null,
  ): number | null {
    if (!reference || reference.lte(0)) return null;
    return applied.minus(reference).div(reference).mul(100).toNumber();
  }

  private buildWhere(
    query: QueryTransactionsDto,
    actor: AuthenticatedUser,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {};

    const agencyId = resolveAgencyFilter(actor, query.agencyId);
    if (agencyId) where.agencyId = agencyId;

    // Le cabiste ne voit que ses propres operations : impose ici, pas
    // seulement dans le frontend.
    const operatorId = resolveOperatorFilter(actor, query.operatorId);
    if (operatorId) where.operatorId = operatorId;

    if (query.clientId) where.clientId = query.clientId;
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;

    if (query.currency) {
      where.OR = [{ fromCurrency: query.currency }, { toCurrency: query.currency }];
    }

    if (query.dateFrom || query.dateTo) {
      where.occurredAt = {};
      if (query.dateFrom) where.occurredAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.occurredAt.lte = endOfDay(query.dateTo);
    }

    if (query.minUsd || query.maxUsd) {
      where.usdEquivalent = {};
      if (query.minUsd) where.usdEquivalent.gte = new D(query.minUsd);
      if (query.maxUsd) where.usdEquivalent.lte = new D(query.maxUsd);
    }

    if (query.search) {
      const search = query.search;
      const searchClauses: Prisma.TransactionWhereInput[] = [
        { reference: { contains: search, mode: 'insensitive' } },
        { client: { fullName: { contains: search, mode: 'insensitive' } } },
        { client: { idDocumentNo: { contains: search.toUpperCase() } } },
      ];
      // AND explicite : un OR de devise deja pose serait sinon ecrase, et le
      // filtre devise disparaitrait silencieusement de la requete.
      where.AND = [...(toArray(where.AND)), { OR: searchClauses }];
    }

    return where;
  }

  private assertCanRead(
    transaction: { agencyId: string; operatorId: string },
    actor: AuthenticatedUser,
  ): void {
    assertAgencyAccess(actor, transaction.agencyId);
    if (actor.role === Role.CABISTE && transaction.operatorId !== actor.id) {
      throw new ForbiddenException('Vous ne pouvez consulter que vos propres operations.');
    }
  }
}

// ---------------------------------------------------------------------------

function toArray(
  value: Prisma.TransactionWhereInput | Prisma.TransactionWhereInput[] | undefined,
): Prisma.TransactionWhereInput[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Empreinte du contenu du bordereau.
 *
 * Les cles sont triees avant concatenation : la meme operation doit produire
 * la meme empreinte quel que soit l'ordre des proprietes de l'objet, sinon
 * la comparaison d'une reimpression a l'original n'aurait aucune valeur.
 */
export function receiptChecksum(payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR');
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Echappement CSV : le point-virgule est le separateur en Excel francophone. */
function csvCell(value: string): string {
  const needsQuotes = /[";\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
