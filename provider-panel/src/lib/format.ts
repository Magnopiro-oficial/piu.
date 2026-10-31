const lunesFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('pt-BR');

/** 1284.6 → "1.284,60" */
export const fmt = (n: number) => lunesFmt.format(n);
/** 24880 → "24.880" */
export const fmtInt = (n: number) => intFmt.format(n);
/** "1.284,60" → 1284.6 (aceita também "200" e "200.5"). */
export function parseAmount(s: string): number {
  const str = String(s);
  // Só trata ponto como separador de milhar quando há vírgula decimal ou grupos de 3.
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(str) ? str.replace(/\./g, '') : str;
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? v : 0;
}
/** 3.1 → "3,1" */
export const fmtDec = (n: number) => String(n).replace('.', ',');
