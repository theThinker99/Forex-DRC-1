import { Prisma, Currency, TransactionType } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Nombre de decimales conservees a la restitution du montant. */
const AMOUNT_SCALE = 2;
/** Echelle interne de calcul, plus large pour ne pas arrondir en cours de route. */
const WORK_SCALE = 8;

export const CDF: Currency = Currency.CDF;

export function toDecimal(value: string | number | Decimal): Decimal {
  return new D(value);
}

/**
 * Arrondi monetaire au demi-superieur (ROUND_HALF_UP), comme au guichet.
 * On n'utilise jamais l'arrondi bancaire ici : le client doit retrouver le
 * meme chiffre s'il refait le calcul a la main sur son bordereau.
 */
export function roundAmount(value: Decimal, scale = AMOUNT_SCALE): Decimal {
  return value.toDecimalPlaces(scale, D.ROUND_HALF_UP);
}

export interface ConversionInput {
  type: TransactionType;
  /** Devise etrangere de la paire (USD, EUR). Jamais CDF. */
  foreignCurrency: Currency;
  /** Montant remis par le client. */
  fromAmount: Decimal;
  /** Taux applique : prix d'1 unite de devise etrangere en CDF. */
  rate: Decimal;
  /** Commission prelevee, exprimee dans la devise recue par le client. */
  commission?: Decimal;
}

export interface ConversionResult {
  fromCurrency: Currency;
  toCurrency: Currency;
  toAmount: Decimal;
  grossAmount: Decimal;
  commission: Decimal;
}

/**
 * Calcule la contrepartie d'une operation de change.
 *
 * Convention : le taux exprime toujours le prix d'UNE unite de la devise
 * etrangere en CDF (ex. 1 USD = 2 750 CDF). Le sens de l'operation decide
 * donc s'il faut multiplier ou diviser.
 *
 *  ACHAT : le bureau achete la devise etrangere. Client donne USD, recoit CDF.
 *  VENTE : le bureau vend la devise etrangere. Client donne CDF, recoit USD.
 */
export function convert(input: ConversionInput): ConversionResult {
  const { type, foreignCurrency, fromAmount, rate } = input;
  const commission = input.commission ?? new D(0);

  if (foreignCurrency === CDF) {
    throw new Error(
      'La devise etrangere d\'une paire ne peut pas etre le CDF : une operation de change oppose le CDF a une devise etrangere.',
    );
  }
  if (rate.lte(0)) {
    throw new Error('Le taux doit etre strictement positif.');
  }
  if (fromAmount.lte(0)) {
    throw new Error('Le montant doit etre strictement positif.');
  }

  if (type === TransactionType.ACHAT) {
    const gross = fromAmount.mul(rate).toDecimalPlaces(WORK_SCALE);
    return {
      fromCurrency: foreignCurrency,
      toCurrency: CDF,
      grossAmount: roundAmount(gross),
      commission: roundAmount(commission),
      toAmount: roundAmount(gross.minus(commission)),
    };
  }

  const gross = fromAmount.div(rate).toDecimalPlaces(WORK_SCALE);
  return {
    fromCurrency: CDF,
    toCurrency: foreignCurrency,
    grossAmount: roundAmount(gross),
    commission: roundAmount(commission),
    toAmount: roundAmount(gross.minus(commission)),
  };
}

/**
 * Contre-valeur USD d'une operation, utilisee pour les seuils AML et les
 * statistiques toutes devises confondues.
 *
 * `usdPerForeign` n'est requis que pour les paires sans USD (ex. EUR/CDF) :
 * on passe alors par le CDF.
 */
export function usdEquivalent(params: {
  currency: Currency;
  amount: Decimal;
  /** Prix d'1 USD en CDF au moment de l'operation. */
  usdCdfRate: Decimal;
  /** Prix d'1 unite de `currency` en CDF, requis si currency n'est ni USD ni CDF. */
  currencyCdfRate?: Decimal;
}): Decimal {
  const { currency, amount, usdCdfRate, currencyCdfRate } = params;

  if (currency === Currency.USD) return roundAmount(amount);

  if (usdCdfRate.lte(0)) {
    throw new Error('Le taux USD/CDF doit etre strictement positif.');
  }

  if (currency === Currency.CDF) {
    return roundAmount(amount.div(usdCdfRate).toDecimalPlaces(WORK_SCALE));
  }

  if (!currencyCdfRate || currencyCdfRate.lte(0)) {
    throw new Error(
      `Impossible de calculer la contre-valeur USD de ${currency} sans son taux en CDF.`,
    );
  }
  const inCdf = amount.mul(currencyCdfRate).toDecimalPlaces(WORK_SCALE);
  return roundAmount(inCdf.div(usdCdfRate).toDecimalPlaces(WORK_SCALE));
}

/** Formatage francais pour les bordereaux : 1 234 567,89 USD */
export function formatAmount(value: Decimal | string | number, currency: Currency): string {
  const decimal = value instanceof D ? value : new D(value);
  const fixed = decimal.toDecimalPlaces(AMOUNT_SCALE, D.ROUND_HALF_UP).toFixed(AMOUNT_SCALE);
  const [integer, fraction] = fixed.split('.');
  const spaced = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${spaced},${fraction} ${currency}`;
}

/** Formatage d'un taux : jusqu'a 6 decimales, sans zeros inutiles. */
export function formatRate(value: Decimal | string | number): string {
  const decimal = value instanceof D ? value : new D(value);
  const fixed = decimal.toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6).replace(/0+$/, '');
  const clean = fixed.endsWith('.') ? fixed.slice(0, -1) : fixed;
  const [integer, fraction] = clean.split('.');
  const spaced = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction ? `${spaced},${fraction}` : spaced;
}
