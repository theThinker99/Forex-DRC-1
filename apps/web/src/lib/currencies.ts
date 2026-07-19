import type { Currency } from './types';

/** Noms complets des devises, pour l'affichage (abréviation + nom). */
export const CURRENCY_NAMES: Record<string, string> = {
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

/**
 * Toutes les devises étrangères gérées (tout sauf le CDF).
 * Doit rester alignée sur l'enum Currency du backend (schema.prisma).
 */
export const FOREIGN_CURRENCIES: Currency[] = [
  'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD',
  'ZAR', 'RWF', 'UGX', 'TZS', 'ZMW', 'BIF', 'XAF', 'AOA', 'XDR',
];

export const ALL_CURRENCIES: Currency[] = ['CDF', ...FOREIGN_CURRENCIES];

export function currencyName(currency: string): string {
  return CURRENCY_NAMES[currency] ?? currency;
}

/** "USD — Dollar américain" */
export function currencyLabel(currency: string): string {
  return `${currency} — ${currencyName(currency)}`;
}
