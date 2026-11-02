/**
 * Valores em LUNES sem ponto flutuante. A Lunes Mainnet usa 8 casas decimais (`tokenDecimals` no
 * chain spec do lunes-nightly; 1 LUNES = 100.000.000 planck). Tudo aqui é `bigint` em planck.
 */
export const DECIMALS = 8;
export const PLANCK_PER_LUNES = 10n ** BigInt(DECIMALS);

/** "12.34" ou "12,34" → 1234000000n. Recusa negativo, mais de 8 casas e qualquer outra coisa. */
export function lunesToPlanck(v: string | number, decimals = DECIMALS): bigint {
  const s = String(v).trim().replace(',', '.');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Valor inválido: ${v}`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) throw new Error(`Mais de ${decimals} casas decimais: ${v}`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** 1234000000n → "12.34" (sem zeros à direita). */
export function planckToLunes(p: bigint, decimals = DECIMALS): string {
  const neg = p < 0n; const a = neg ? -p : p;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / base}${frac ? '.' + frac : ''}`;
}
