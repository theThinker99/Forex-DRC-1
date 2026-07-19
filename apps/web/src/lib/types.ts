export type Role = 'ADMIN' | 'BCC' | 'CABISTE' | 'SUPERVISEUR';
export type UserStatus = 'ACTIF' | 'SUSPENDU' | 'ARCHIVE';
export type AuthProvider = 'LOCAL' | 'GOOGLE';
export type Currency =
  | 'CDF' | 'USD' | 'EUR' | 'GBP' | 'CHF' | 'JPY' | 'CNY' | 'CAD' | 'AUD'
  | 'ZAR' | 'RWF' | 'UGX' | 'TZS' | 'ZMW' | 'BIF' | 'XAF' | 'AOA' | 'XDR';
export type TransactionType = 'ACHAT' | 'VENTE';
export type TransactionStatus = 'EN_ATTENTE' | 'VALIDEE' | 'REJETEE' | 'ANNULEE';
export type AgencyStatus = 'ACTIVE' | 'FERMEE';

export type IdDocumentType =
  | 'CARTE_ELECTEUR'
  | 'PASSEPORT'
  | 'PERMIS_CONDUIRE'
  | 'CARTE_SERVICE'
  | 'CARTE_REFUGIE'
  | 'AUTRE';

export type AlertSeverity = 'INFO' | 'MOYENNE' | 'HAUTE' | 'CRITIQUE';
export type AlertStatus = 'OUVERTE' | 'EN_REVUE' | 'RESOLUE' | 'IGNOREE';

export interface AgencyRef {
  id: string;
  code: string;
  name: string;
  city?: string;
}

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  agencyId: string | null;
  agency: AgencyRef | null;
  authProvider: AuthProvider;
  googleLinked: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: CurrentUser;
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface Agency extends AgencyRef {
  commune: string | null;
  address: string | null;
  phone: string | null;
  licenseNo: string | null;
  status: AgencyStatus;
  _count?: { users: number; transactions: number; clients: number };
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  phone: string | null;
  agencyId: string | null;
  agency: AgencyRef | null;
  authProvider: AuthProvider;
  googleId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Client {
  id: string;
  agencyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  idDocumentType: IdDocumentType;
  idDocumentNo: string;
  nationality: string;
  birthDate: string | null;
  phone: string | null;
  address: string | null;
  isPep: boolean;
  notes: string | null;
  agency?: AgencyRef;
  createdBy?: { id: string; fullName: string };
  _count?: { transactions: number; attachments: number };
  existsInAnotherAgency?: boolean;
  message?: string;
}

export interface RateBoardEntry {
  currency: Currency;
  available: boolean;
  rate: {
    id: string;
    buyRate: string;
    sellRate: string;
    referenceRate: string | null;
    effectiveFrom: string;
    scope: 'national' | 'agence';
    agency: AgencyRef | null;
  } | null;
}

export interface ExchangeRate {
  id: string;
  agencyId: string | null;
  baseCurrency: Currency;
  quoteCurrency: Currency;
  buyRate: string;
  sellRate: string;
  referenceRate: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  agency: AgencyRef | null;
  createdBy: { id: string; fullName: string };
}

export interface Transaction {
  id: string;
  reference: string;
  agencyId: string;
  type: TransactionType;
  fromCurrency: Currency;
  toCurrency: Currency;
  fromAmount: string;
  toAmount: string;
  appliedRate: string;
  commission: string;
  usdEquivalent: string;
  status: TransactionStatus;
  occurredAt: string;
  createdAt: string;
  reviewComment: string | null;
  client: {
    id: string;
    fullName: string;
    idDocumentType: IdDocumentType;
    idDocumentNo: string;
    phone?: string | null;
    isPep?: boolean;
  };
  operator: { id: string; fullName: string; email?: string };
  reviewedBy: { id: string; fullName: string } | null;
  agency: AgencyRef;
  receipt: { id: string; number: string; issuedAt: string; printCount: number } | null;
  alerts?: Array<{
    id: string;
    type: string;
    severity: AlertSeverity;
    status: AlertStatus;
    message: string;
    createdAt: string;
  }>;
  attachments?: Array<{
    id: string;
    kind: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  _count?: { alerts: number; attachments: number };
}

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: string;
  resolution: string | null;
  resolvedAt: string | null;
  transaction: {
    id: string;
    reference: string;
    usdEquivalent: string;
    occurredAt: string;
    status: TransactionStatus;
    operator: { id: string; fullName: string };
    agency: AgencyRef;
  } | null;
  client: { id: string; fullName: string; idDocumentNo: string } | null;
  resolvedBy: { id: string; fullName: string } | null;
}

export interface DashboardStats {
  periode: { from: string; to: string };
  perimetre: 'national' | 'agence';
  volumeUsd: string;
  commissionsUsd: string;
  operations: number;
  clientsServis: number;
  enAttente: number;
  parStatut: Array<{ status: TransactionStatus; operations: number }>;
  parType: Array<{ type: TransactionType; operations: number; volumeUsd: string }>;
  alertes: {
    total: number;
    parGravite: Array<{ severity: AlertSeverity; nombre: number }>;
  };
}

export interface AuditLog {
  id: string;
  actorEmail: string;
  actorRole: Role | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; email: string; role: Role } | null;
}

export interface AuthProviders {
  local: boolean;
  google: boolean;
  googleClientId: string | null;
}

export type CashSessionStatus = 'OUVERTE' | 'CLOTUREE';

export interface CashLine {
  currency: Currency;
  opening: string;
  inflow: string;
  outflow: string;
  theoretical: string;
  counted: string | null;
  variance: string | null;
}

export interface CashSummary {
  session: {
    id: string;
    status: CashSessionStatus;
    openedAt: string;
    closedAt: string | null;
    note: string | null;
    operator: { id: string; fullName: string };
    agency: AgencyRef;
  };
  operations: number;
  lines: CashLine[];
}

export interface CashSessionListItem {
  id: string;
  status: CashSessionStatus;
  openedAt: string;
  closedAt: string | null;
  operator: { id: string; fullName: string };
  agency: AgencyRef;
  openingBalances: Record<string, string>;
}
