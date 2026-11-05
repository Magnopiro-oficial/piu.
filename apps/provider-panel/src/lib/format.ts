import { decimalSeparator, numberFormat } from '../i18n';

// Formatadores na região do idioma atual do painel (pt-BR: "1.284,60"; en: "1,284.60").
const lunesFmt = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = () => numberFormat();
const decFmt = () => numberFormat({ maximumFractionDigits: 2 });

/** 1284.6 → "1.284,60" (pt-BR) */
export const fmt = (n: number) => lunesFmt().format(n);
/** 24880 → "24.880" (pt-BR) */
export const fmtInt = (n: number) => intFmt().format(n);
/**
 * "1.284,60" → 1284.6 (aceita também "200" e "200.5"). O separador decimal é o da região atual; o
 * outro é tratado como separador de milhar. Com só um separador presente e ambíguo, grupos de 3
 * dígitos viram milhar e o resto vira decimal.
 */
export function parseAmount(s: string): number {
  const str = String(s).replace(/\s/g, '');
  const dec = decimalSeparator();
  const grp = dec === ',' ? '.' : ',';
  const esc = (c: string) => c.replace(/[.]/g, '\\.');
  let normalized: string;
  if (str.includes(dec) && str.includes(grp)) normalized = str.split(grp).join('').replace(dec, '.');
  else if (str.includes(dec)) normalized = str.replace(dec, '.');
  else if (str.includes(grp)) normalized = new RegExp(`^\\d{1,3}(${esc(grp)}\\d{3})+$`).test(str) ? str.split(grp).join('') : str.replace(grp, '.');
  else normalized = str;
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? v : 0;
}
/** 3.1 → "3,1" (pt-BR) */
export const fmtDec = (n: number) => decFmt().format(n);
/** planck (texto, 1 LUNES = 10^8) → "1.234,56789012", com 2 a 8 casas, sem arredondar para cima. */
export function fmtPlanck(planck: string): string {
  const p = BigInt(planck), base = 100_000_000n;
  const int = intFmt().format(p / base);
  let frac = (p % base).toString().padStart(8, '0');
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${int}${decimalSeparator()}${frac}`;
}
