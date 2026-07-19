import { Role } from '@prisma/client';

/**
 * Parametres systeme et leurs valeurs par defaut.
 *
 * Les defauts sont volontairement prudents : si la table system_settings est
 * vide (premiere installation, base restauree partiellement), l'application
 * doit tomber du cote sur — auto-provisionnement ferme, seuils AML actifs.
 */

export const SETTING_KEYS = {
  GOOGLE_AUTO_PROVISION: 'auth.google.autoProvision',
  AML_THRESHOLDS: 'aml.thresholds',
  RATE_POLICY: 'rates.policy',
  TRANSACTION_POLICY: 'transactions.policy',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface GoogleAutoProvisionSetting {
  /** Faux par defaut : personne ne s'auto-cree un acces a un bureau de change. */
  enabled: boolean;
  /** Role attribue aux comptes auto-provisionnes. Jamais ADMIN. */
  defaultRole: Role;
}

export interface AmlThresholdsSetting {
  /** Contre-valeur USD au-dela de laquelle une declaration est requise. */
  declarationUsd: number;
  /** Contre-valeur USD au-dela de laquelle une alerte est levee. */
  alertUsd: number;
  /** Cumul USD par client sur la fenetre glissante avant alerte de fractionnement. */
  splittingCumulativeUsd: number;
  /** Largeur de la fenetre glissante, en heures. */
  splittingWindowHours: number;
  /** Nombre d'operations d'un meme client sur la fenetre avant alerte. */
  splittingOperationCount: number;
}

export interface RatePolicySetting {
  /** Ecart maximal tolere entre le taux applique et le taux de reference BCC, en %. */
  maxDeviationPercent: number;
}

export interface TransactionPolicySetting {
  /**
   * Contre-valeur USD au-dela de laquelle la transaction part en EN_ATTENTE
   * et doit etre validee par un superviseur. En dessous, elle est VALIDEE
   * directement : le guichet ne peut pas faire patienter chaque client.
   */
  supervisorValidationAboveUsd: number;
}

export const SETTING_DEFAULTS: {
  [SETTING_KEYS.GOOGLE_AUTO_PROVISION]: GoogleAutoProvisionSetting;
  [SETTING_KEYS.AML_THRESHOLDS]: AmlThresholdsSetting;
  [SETTING_KEYS.RATE_POLICY]: RatePolicySetting;
  [SETTING_KEYS.TRANSACTION_POLICY]: TransactionPolicySetting;
} = {
  [SETTING_KEYS.GOOGLE_AUTO_PROVISION]: {
    enabled: false,
    defaultRole: Role.CABISTE,
  },
  [SETTING_KEYS.AML_THRESHOLDS]: {
    declarationUsd: 10_000,
    alertUsd: 5_000,
    splittingCumulativeUsd: 10_000,
    splittingWindowHours: 24,
    splittingOperationCount: 3,
  },
  [SETTING_KEYS.RATE_POLICY]: {
    maxDeviationPercent: 5,
  },
  [SETTING_KEYS.TRANSACTION_POLICY]: {
    supervisorValidationAboveUsd: 5_000,
  },
};

export const SETTING_DESCRIPTIONS: Record<string, string> = {
  [SETTING_KEYS.GOOGLE_AUTO_PROVISION]:
    'Creation automatique d\'un compte a la premiere connexion Google, et role attribue.',
  [SETTING_KEYS.AML_THRESHOLDS]:
    'Seuils de vigilance : declaration, alerte unitaire, detection de fractionnement.',
  [SETTING_KEYS.RATE_POLICY]:
    'Ecart maximal tolere entre le taux applique au guichet et le taux de reference BCC.',
  [SETTING_KEYS.TRANSACTION_POLICY]:
    'Montant au-dela duquel une operation exige la validation d\'un superviseur.',
};
