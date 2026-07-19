import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  AmlThresholdsSetting,
  GoogleAutoProvisionSetting,
  RatePolicySetting,
  SETTING_DEFAULTS,
  SETTING_DESCRIPTIONS,
  SETTING_KEYS,
  TransactionPolicySetting,
} from './settings.constants';

/** Duree du cache memoire. Les seuils changent rarement ; les relire a chaque
 *  transaction couterait une requete par operation de guichet. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    // Fusion avec le defaut : un parametre enregistre avant l'ajout d'un
    // nouveau champ ne doit pas rendre ce champ undefined a l'execution.
    const value =
      row && isRecord(row.value) && isRecord(fallback)
        ? ({ ...fallback, ...row.value } as T)
        : ((row?.value as T | undefined) ?? fallback);

    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async set(
    key: string,
    value: Prisma.InputJsonValue,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    if (!(key in SETTING_DEFAULTS)) {
      throw new BadRequestException(
        `Parametre inconnu : "${key}". Parametres valides : ${Object.values(SETTING_KEYS).join(', ')}.`,
      );
    }

    this.validate(key, value);

    const before = await this.prisma.systemSetting.findUnique({ where: { key } });

    const updated = await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, description: SETTING_DESCRIPTIONS[key] ?? null },
      update: { value, description: SETTING_DESCRIPTIONS[key] ?? null },
    });

    this.cache.delete(key);

    await this.audit.log({
      actor,
      action: AuditAction.MODIFICATION,
      entity: 'SystemSetting',
      entityId: key,
      before: before?.value,
      after: updated.value,
    });

    return updated.value;
  }

  async all(): Promise<Array<{ key: string; value: unknown; description: string | null }>> {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    const stored = new Map(rows.map((r) => [r.key, r]));

    // On renvoie toujours la liste complete, defauts inclus : l'admin doit
    // voir les seuils effectivement appliques, pas seulement ceux deja edites.
    return Object.entries(SETTING_DEFAULTS).map(([key, fallback]) => {
      const row = stored.get(key);
      const value =
        row && isRecord(row.value) && isRecord(fallback)
          ? { ...fallback, ...row.value }
          : (row?.value ?? fallback);
      return {
        key,
        value,
        description: SETTING_DESCRIPTIONS[key] ?? null,
      };
    });
  }

  // --- Accesseurs types -----------------------------------------------------

  googleAutoProvision(): Promise<GoogleAutoProvisionSetting> {
    return this.get(
      SETTING_KEYS.GOOGLE_AUTO_PROVISION,
      SETTING_DEFAULTS[SETTING_KEYS.GOOGLE_AUTO_PROVISION],
    );
  }

  amlThresholds(): Promise<AmlThresholdsSetting> {
    return this.get(
      SETTING_KEYS.AML_THRESHOLDS,
      SETTING_DEFAULTS[SETTING_KEYS.AML_THRESHOLDS],
    );
  }

  ratePolicy(): Promise<RatePolicySetting> {
    return this.get(SETTING_KEYS.RATE_POLICY, SETTING_DEFAULTS[SETTING_KEYS.RATE_POLICY]);
  }

  transactionPolicy(): Promise<TransactionPolicySetting> {
    return this.get(
      SETTING_KEYS.TRANSACTION_POLICY,
      SETTING_DEFAULTS[SETTING_KEYS.TRANSACTION_POLICY],
    );
  }

  // --- Validation -----------------------------------------------------------

  private validate(key: string, value: Prisma.InputJsonValue): void {
    if (!isRecord(value)) {
      throw new BadRequestException('La valeur d\'un parametre doit etre un objet JSON.');
    }

    if (key === SETTING_KEYS.GOOGLE_AUTO_PROVISION) {
      const v = value as Partial<GoogleAutoProvisionSetting>;
      if (v.enabled !== undefined && typeof v.enabled !== 'boolean') {
        throw new BadRequestException('"enabled" doit etre un booleen.');
      }
      if (v.defaultRole !== undefined) {
        if (!Object.values(Role).includes(v.defaultRole)) {
          throw new BadRequestException(
            `"defaultRole" doit valoir ${Object.values(Role).join(', ')}.`,
          );
        }
        // Un compte auto-cree ne doit jamais naitre administrateur : ce serait
        // une escalade de privileges pilotee depuis Google.
        if (v.defaultRole === Role.ADMIN) {
          throw new BadRequestException(
            'Le role par defaut de l\'auto-provisionnement ne peut pas etre ADMIN. ' +
              'Creez les administrateurs manuellement.',
          );
        }
      }
      return;
    }

    if (key === SETTING_KEYS.AML_THRESHOLDS) {
      const numeric: Array<keyof AmlThresholdsSetting> = [
        'declarationUsd',
        'alertUsd',
        'splittingCumulativeUsd',
        'splittingWindowHours',
        'splittingOperationCount',
      ];
      for (const field of numeric) {
        const raw = (value as Record<string, unknown>)[field];
        if (raw === undefined) continue;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
          throw new BadRequestException(`"${field}" doit etre un nombre strictement positif.`);
        }
      }
      return;
    }

    if (key === SETTING_KEYS.RATE_POLICY) {
      const raw = (value as Record<string, unknown>).maxDeviationPercent;
      if (raw !== undefined) {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
          throw new BadRequestException(
            '"maxDeviationPercent" doit etre un nombre entre 0 et 100.',
          );
        }
      }
      return;
    }

    if (key === SETTING_KEYS.TRANSACTION_POLICY) {
      const raw = (value as Record<string, unknown>).supervisorValidationAboveUsd;
      if (raw !== undefined) {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
          throw new BadRequestException(
            '"supervisorValidationAboveUsd" doit etre un nombre positif ou nul.',
          );
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
