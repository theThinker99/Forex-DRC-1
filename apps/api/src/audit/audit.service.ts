import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginatedResult } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Champs jamais ecrits dans le journal, quel que soit le modele. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'newPassword',
  'currentPassword',
  'token',
  'refreshToken',
  'tokenHash',
  'accessToken',
  'idToken',
  'credential',
  'secret',
]);

export interface AuditEntry {
  actor: Pick<AuthenticatedUser, 'id' | 'email' | 'role'> | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ecrit une trace d'audit.
   *
   * Volontairement tolerant : une panne du journal ne doit pas annuler une
   * operation de change deja encaissee au guichet. L'echec est logue en
   * ERROR pour etre remonte par la supervision.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actor?.id ?? null,
          actorEmail: entry.actor?.email ?? 'anonyme',
          actorRole: entry.actor?.role ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: this.redact(entry.before),
          after: this.redact(entry.after),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Echec d'ecriture du journal d'audit (${entry.action} ${entry.entity} ${entry.entityId ?? ''})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Variante transactionnelle : la trace vit ou meurt avec l'operation.
   * A utiliser quand l'absence de trace rendrait l'ecriture incontrolable
   * (validation/rejet d'une transaction, changement de role).
   */
  async logInTransaction(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actor?.id ?? null,
        actorEmail: entry.actor?.email ?? 'anonyme',
        actorRole: entry.actor?.role ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: this.redact(entry.before),
        after: this.redact(entry.after),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent?.slice(0, 255) ?? null,
      },
    });
  }

  /**
   * Retire les secrets et normalise en JSON serialisable
   * (les Decimal Prisma ne sont pas serialisables tels quels).
   */
  private redact(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return this.walk(value) as Prisma.InputJsonValue;
  }

  private walk(value: unknown, depth = 0): unknown {
    if (depth > 6) return '[profondeur maximale atteinte]';
    if (value === null || value === undefined) return null;

    if (value instanceof Date) return value.toISOString();
    if (value instanceof Prisma.Decimal) return value.toString();
    if (Buffer.isBuffer(value)) return `[binaire ${value.length} octets]`;

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => this.walk(item, depth + 1));
    }

    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        out[key] = REDACTED_KEYS.has(key) ? '[expurge]' : this.walk(val, depth + 1);
      }
      return out;
    }

    return value;
  }

  async findAll(query: QueryAuditDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorRole) where.actorRole = query.actorRole as Role;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = endOfDay(query.dateTo);
    }

    if (query.search) {
      where.OR = [
        { actorEmail: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: {
          actor: { select: { id: true, fullName: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }
}

/** "2026-07-17" -> 2026-07-17T23:59:59.999 : sinon un filtre "jusqu'au 17" exclut le 17. */
export function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}
