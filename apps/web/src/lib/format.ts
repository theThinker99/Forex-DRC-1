import type {
  AlertSeverity,
  Currency,
  Role,
  TransactionStatus,
  TransactionType,
} from './types';

/** Formatage monetaire francais : 1 234 567,89 USD */
export function formatMoney(value: string | number, currency?: Currency): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return String(value);
  const formatted = num.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

/** Taux : jusqu'a 6 decimales, sans zeros superflus. */
export function formatRate(value: string | number): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 6 });
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('fr-FR');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur',
  BCC: 'Contrôle BCC',
  CABISTE: 'Cabiste',
  SUPERVISEUR: 'Superviseur',
};

export const STATUS_META: Record<
  TransactionStatus,
  { label: string; badge: string }
> = {
  EN_ATTENTE: { label: 'En attente', badge: 'badge-warning' },
  VALIDEE: { label: 'Validée', badge: 'badge-success' },
  REJETEE: { label: 'Rejetée', badge: 'badge-danger' },
  ANNULEE: { label: 'Annulée', badge: 'badge-neutral' },
};

export const TYPE_LABELS: Record<TransactionType, string> = {
  ACHAT: 'Achat',
  VENTE: 'Vente',
};

export const SEVERITY_META: Record<
  AlertSeverity,
  { label: string; badge: string }
> = {
  INFO: { label: 'Info', badge: 'badge-info' },
  MOYENNE: { label: 'Moyenne', badge: 'badge-neutral' },
  HAUTE: { label: 'Haute', badge: 'badge-warning' },
  CRITIQUE: { label: 'Critique', badge: 'badge-danger' },
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  CARTE_ELECTEUR: "Carte d'électeur",
  PASSEPORT: 'Passeport',
  PERMIS_CONDUIRE: 'Permis de conduire',
  CARTE_SERVICE: 'Carte de service',
  CARTE_REFUGIE: 'Carte de réfugié',
  AUTRE: 'Autre pièce',
};

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CONNEXION: 'Connexion',
    CONNEXION_ECHOUEE: 'Connexion échouée',
    DECONNEXION: 'Déconnexion',
    LIAISON_GOOGLE: 'Liaison Google',
    CREATION: 'Création',
    MODIFICATION: 'Modification',
    SUPPRESSION: 'Suppression',
    VALIDATION: 'Validation',
    REJET: 'Rejet',
    ANNULATION: 'Annulation',
    CONSULTATION: 'Consultation',
    EXPORT: 'Export',
    IMPRESSION_BORDEREAU: 'Impression bordereau',
  };
  return map[action] ?? action;
}
