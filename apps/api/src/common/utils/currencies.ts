import { Currency } from '@prisma/client';

/**
 * Noms complets des devises, pour l'affichage et les bordereaux.
 * Le code court (USD) reste la reference technique ; le nom complet n'est
 * qu'un confort de lecture.
 */
export const CURRENCY_NAMES: Record<Currency, string> = {
  CDF: 'Franc congolais',
  USD: 'Dollar américain',
  EUR: 'Euro',
  GBP: 'Livre sterling',
  CHF: 'Franc suisse',
  JPY: 'Yen japonais',
  CNY: 'Yuan chinois (renminbi)',
  CAD: 'Dollar canadien',
  AUD: 'Dollar australien',
  ZAR: 'Rand sud-africain',
  RWF: 'Franc rwandais',
  UGX: 'Shilling ougandais',
  TZS: 'Shilling tanzanien',
  ZMW: 'Kwacha zambien',
  BIF: 'Franc burundais',
  XAF: 'Franc CFA (BEAC)',
  AOA: 'Kwanza angolais',
  XDR: 'Droits de tirage spéciaux (DTS)',
};

/** Toutes les devises etrangeres, c.-a-d. tout sauf la monnaie locale (CDF). */
export const FOREIGN_CURRENCIES: Currency[] = Object.values(Currency).filter(
  (c) => c !== Currency.CDF,
);

export function currencyLabel(currency: Currency): string {
  return `${currency} — ${CURRENCY_NAMES[currency] ?? currency}`;
}
