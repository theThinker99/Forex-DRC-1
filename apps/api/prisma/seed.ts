/**
 * Jeu de donnees de demonstration.
 *
 * Idempotent : on peut le relancer sans dupliquer (upserts sur les cles
 * naturelles). Les mots de passe de demo sont volontairement affiches en fin
 * d'execution — ce sont des comptes de developpement, jamais de production.
 */
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  AuthProvider,
  Currency,
  IdDocumentType,
  PrismaClient,
  Role,
  TransactionStatus,
  TransactionType,
  UserStatus,
  Prisma,
} from '@prisma/client';
import { hash, Algorithm } from '@node-rs/argon2';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();
const D = Prisma.Decimal;

const DEMO_PASSWORD = 'ChangeRDC2026!';

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function main(): Promise<void> {
  console.log('Seed : demarrage...');

  const passwordHash = await hash(DEMO_PASSWORD, ARGON_OPTIONS);

  // --- Parametres systeme --------------------------------------------------
  await prisma.systemSetting.upsert({
    where: { key: 'transactions.policy' },
    create: {
      key: 'transactions.policy',
      value: { supervisorValidationAboveUsd: 5000 },
      description: 'Montant au-dela duquel une operation exige la validation d\'un superviseur.',
    },
    update: {},
  });

  // --- Agences -------------------------------------------------------------
  const goma = await prisma.agency.upsert({
    where: { code: 'GOM' },
    create: {
      code: 'GOM',
      name: 'Bureau de change Goma Centre',
      city: 'Goma',
      commune: 'Goma',
      address: '12, avenue du Lac Kivu',
      phone: '+243810000001',
      licenseNo: 'BCC/CHG/2026/0142',
    },
    update: {},
  });

  const kinshasa = await prisma.agency.upsert({
    where: { code: 'KIN' },
    create: {
      code: 'KIN',
      name: 'Bureau de change Kinshasa Gombe',
      city: 'Kinshasa',
      commune: 'Gombe',
      address: '45, boulevard du 30 Juin',
      phone: '+243820000002',
      licenseNo: 'BCC/CHG/2026/0087',
    },
    update: {},
  });

  console.log(`Agences : ${goma.code}, ${kinshasa.code}`);

  // --- Utilisateurs (un par role) ------------------------------------------
  const admin = await upsertUser({
    email: 'admin@change-rdc.cd',
    fullName: 'Alice Kabwhela (Admin)',
    role: Role.ADMIN,
    passwordHash,
    agencyId: null,
  });

  const bcc = await upsertUser({
    email: 'bcc@change-rdc.cd',
    fullName: 'Bernard Ilunga (Controleur BCC)',
    role: Role.BCC,
    passwordHash,
    agencyId: null,
  });

  const superviseur = await upsertUser({
    email: 'superviseur.goma@change-rdc.cd',
    fullName: 'Carine Masika (Superviseur Goma)',
    role: Role.SUPERVISEUR,
    passwordHash,
    agencyId: goma.id,
  });

  const cabisteGoma = await upsertUser({
    email: 'cabiste.goma@change-rdc.cd',
    fullName: 'David Mumbere (Cabiste Goma)',
    role: Role.CABISTE,
    passwordHash,
    agencyId: goma.id,
  });

  const cabisteKin = await upsertUser({
    email: 'cabiste.kinshasa@change-rdc.cd',
    fullName: 'Esther Nkosi (Cabiste Kinshasa)',
    role: Role.CABISTE,
    passwordHash,
    agencyId: kinshasa.id,
  });

  console.log('Utilisateurs : admin, bcc, superviseur, 2 cabistes');

  // --- Taux de change (nationaux) ------------------------------------------
  // Valeurs proches des cours BCC pour rendre la demo realiste.
  const usdRate = await upsertRate({
    baseCurrency: Currency.USD,
    buyRate: '2245.000000',
    sellRate: '2265.000000',
    referenceRate: '2255.318200',
    createdById: admin.id,
    effectiveFrom: startOfToday(),
  });

  const otherRates: Array<{
    currency: Currency;
    buy: string;
    sell: string;
    ref: string;
  }> = [
    { currency: Currency.EUR, buy: '2575.000000', sell: '2597.000000', ref: '2585.899500' },
    { currency: Currency.GBP, buy: '3030.000000', sell: '3060.000000', ref: '3045.176900' },
    { currency: Currency.CHF, buy: '2780.000000', sell: '2810.000000', ref: '2795.395600' },
    { currency: Currency.ZAR, buy: '135.000000', sell: '141.000000', ref: '137.973000' },
    { currency: Currency.RWF, buy: '1.500000', sell: '1.580000', ref: '1.540500' },
    { currency: Currency.UGX, buy: '0.590000', sell: '0.630000', ref: '0.612200' },
  ];

  for (const r of otherRates) {
    await upsertRate({
      baseCurrency: r.currency,
      buyRate: r.buy,
      sellRate: r.sell,
      referenceRate: r.ref,
      createdById: admin.id,
      effectiveFrom: startOfToday(),
    });
  }

  console.log(`Taux : USD + ${otherRates.length} autres devises publies`);

  // --- Clients -------------------------------------------------------------
  const client1 = await upsertClient({
    agencyId: goma.id,
    createdById: cabisteGoma.id,
    firstName: 'Jean',
    lastName: 'Mukendi',
    idDocumentType: IdDocumentType.CARTE_ELECTEUR,
    idDocumentNo: '19-A12345-67890',
    phone: '+243991111111',
  });

  const client2 = await upsertClient({
    agencyId: goma.id,
    createdById: cabisteGoma.id,
    firstName: 'Marie',
    lastName: 'Furaha',
    idDocumentType: IdDocumentType.PASSEPORT,
    idDocumentNo: 'OP1234567',
    phone: '+243992222222',
  });

  const client3 = await upsertClient({
    agencyId: kinshasa.id,
    createdById: cabisteKin.id,
    firstName: 'Patrick',
    lastName: 'Lelo',
    idDocumentType: IdDocumentType.PERMIS_CONDUIRE,
    idDocumentNo: 'KIN-2021-55443',
    phone: '+243993333333',
  });

  console.log('Clients : 3 fiches');

  // --- Transactions --------------------------------------------------------
  // On ne rejoue pas les transactions si le seed a deja tourne : leurs
  // references sont datees et sequentielles, un doublon casserait la demo.
  const alreadySeeded = await prisma.transaction.count();
  if (alreadySeeded === 0) {
    await seedTransaction({
      agency: goma,
      operator: cabisteGoma,
      client: client1,
      type: TransactionType.ACHAT,
      foreignCurrency: Currency.USD,
      fromAmount: '200.00',
      rate: usdRate.buyRate,
      status: TransactionStatus.VALIDEE,
      reviewedById: null,
      minutesAgo: 180,
    });

    await seedTransaction({
      agency: goma,
      operator: cabisteGoma,
      client: client2,
      type: TransactionType.VENTE,
      foreignCurrency: Currency.USD,
      fromAmount: '1400000.00',
      rate: usdRate.sellRate,
      status: TransactionStatus.VALIDEE,
      reviewedById: null,
      minutesAgo: 120,
    });

    // Grosse operation : au-dela du seuil, reste EN_ATTENTE et leve une alerte.
    const big = await seedTransaction({
      agency: kinshasa,
      operator: cabisteKin,
      client: client3,
      type: TransactionType.ACHAT,
      foreignCurrency: Currency.USD,
      fromAmount: '8000.00',
      rate: usdRate.buyRate,
      status: TransactionStatus.EN_ATTENTE,
      reviewedById: null,
      minutesAgo: 60,
    });

    await prisma.alert.create({
      data: {
        type: AlertType.SEUIL_DEPASSE,
        severity: AlertSeverity.HAUTE,
        status: AlertStatus.OUVERTE,
        message: 'Operation de 8000.00 USD : seuil de vigilance de 5000 USD franchi.',
        context: { usdEquivalent: '8000.00', seuil: 5000, nature: 'vigilance' },
        transactionId: big.id,
        clientId: client3.id,
        agencyId: kinshasa.id,
      },
    });

    console.log('Transactions : 3 operations + 1 alerte');
  } else {
    console.log('Transactions : deja presentes, etape ignoree');
  }

  console.log('\nSeed termine.\n');
  printCredentials();
}

// ---------------------------------------------------------------------------

async function upsertUser(params: {
  email: string;
  fullName: string;
  role: Role;
  passwordHash: string;
  agencyId: string | null;
}) {
  return prisma.user.upsert({
    where: { email: params.email },
    create: {
      email: params.email,
      fullName: params.fullName,
      role: params.role,
      passwordHash: params.passwordHash,
      authProvider: AuthProvider.LOCAL,
      status: UserStatus.ACTIF,
      agencyId: params.agencyId,
    },
    update: { fullName: params.fullName, role: params.role, agencyId: params.agencyId },
  });
}

async function upsertRate(params: {
  baseCurrency: Currency;
  buyRate: string;
  sellRate: string;
  referenceRate: string;
  createdById: string;
  effectiveFrom: Date;
}) {
  const existing = await prisma.exchangeRate.findFirst({
    where: {
      baseCurrency: params.baseCurrency,
      quoteCurrency: Currency.CDF,
      agencyId: null,
      effectiveTo: null,
    },
  });
  if (existing) return existing;

  return prisma.exchangeRate.create({
    data: {
      baseCurrency: params.baseCurrency,
      quoteCurrency: Currency.CDF,
      buyRate: new D(params.buyRate),
      sellRate: new D(params.sellRate),
      referenceRate: new D(params.referenceRate),
      effectiveFrom: params.effectiveFrom,
      createdById: params.createdById,
    },
  });
}

async function upsertClient(params: {
  agencyId: string;
  createdById: string;
  firstName: string;
  lastName: string;
  idDocumentType: IdDocumentType;
  idDocumentNo: string;
  phone: string;
}) {
  return prisma.client.upsert({
    where: {
      uq_client_identity: {
        idDocumentType: params.idDocumentType,
        idDocumentNo: params.idDocumentNo,
      },
    },
    create: {
      agencyId: params.agencyId,
      createdById: params.createdById,
      firstName: params.firstName,
      lastName: params.lastName,
      fullName: `${params.firstName} ${params.lastName}`,
      idDocumentType: params.idDocumentType,
      idDocumentNo: params.idDocumentNo,
      phone: params.phone,
    },
    update: {},
  });
}

async function seedTransaction(params: {
  agency: { id: string; code: string };
  operator: { id: string };
  client: { id: string; fullName: string; idDocumentNo: string };
  type: TransactionType;
  foreignCurrency: Currency;
  fromAmount: string;
  rate: Prisma.Decimal;
  status: TransactionStatus;
  reviewedById: string | null;
  minutesAgo: number;
}) {
  const occurredAt = new Date(Date.now() - params.minutesAgo * 60_000);
  const fromAmount = new D(params.fromAmount);

  const isAchat = params.type === TransactionType.ACHAT;
  const grossAmount = isAchat ? fromAmount.mul(params.rate) : fromAmount.div(params.rate);
  const toAmount = grossAmount.toDecimalPlaces(2, D.ROUND_HALF_UP);
  const fromCurrency = isAchat ? params.foreignCurrency : Currency.CDF;
  const toCurrency = isAchat ? Currency.CDF : params.foreignCurrency;

  // Contre-valeur USD (les taux de demo sont en USD/CDF).
  const foreignAmount = isAchat ? fromAmount : grossAmount;
  const usd =
    params.foreignCurrency === Currency.USD
      ? foreignAmount.toDecimalPlaces(2, D.ROUND_HALF_UP)
      : new D(0);

  const period = formatPeriod(occurredAt);
  const seq = await nextSeq('TX', params.agency.code, period);
  const reference = `TX-${params.agency.code}-${period}-${String(seq).padStart(6, '0')}`;

  const transaction = await prisma.transaction.create({
    data: {
      reference,
      agencyId: params.agency.id,
      operatorId: params.operator.id,
      clientId: params.client.id,
      type: params.type,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      appliedRate: params.rate,
      commission: new D(0),
      usdEquivalent: usd,
      status: params.status,
      occurredAt,
      reviewedById: params.reviewedById,
      reviewedAt: params.status === TransactionStatus.VALIDEE ? occurredAt : null,
    },
  });

  // Bordereau uniquement pour les operations validees.
  if (params.status === TransactionStatus.VALIDEE) {
    const brdSeq = await nextSeq('BRD', params.agency.code, String(occurredAt.getFullYear()));
    const number = `BRD-${params.agency.code}-${occurredAt.getFullYear()}-${String(brdSeq).padStart(6, '0')}`;
    await prisma.receipt.create({
      data: {
        number,
        transactionId: transaction.id,
        issuedById: params.operator.id,
        issuedAt: occurredAt,
        checksum: createHash('sha256')
          .update(`${number}|${reference}|${params.client.fullName}`)
          .digest('hex'),
      },
    });
  }

  return transaction;
}

/** Increment de sequence hors transaction concurrente : suffisant pour un seed. */
async function nextSeq(scope: string, agency: string, period: string): Promise<number> {
  const row = await prisma.documentSequence.upsert({
    where: { scope_agency_period: { scope, agency, period } },
    create: { scope, agency, period, current: 1 },
    update: { current: { increment: 1 } },
  });
  return row.current;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function printCredentials(): void {
  console.log('Comptes de demonstration (mot de passe commun) :');
  console.log('  Mot de passe : ' + DEMO_PASSWORD);
  console.log('  ---------------------------------------------------------');
  console.log('  ADMIN        admin@change-rdc.cd');
  console.log('  BCC          bcc@change-rdc.cd            (lecture seule)');
  console.log('  SUPERVISEUR  superviseur.goma@change-rdc.cd');
  console.log('  CABISTE      cabiste.goma@change-rdc.cd');
  console.log('  CABISTE      cabiste.kinshasa@change-rdc.cd');
  console.log('  ---------------------------------------------------------');
  console.log('  A ne jamais utiliser en production.\n');
}

main()
  .catch((error) => {
    console.error('Echec du seed :', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
