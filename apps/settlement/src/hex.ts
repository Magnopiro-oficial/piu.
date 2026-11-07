/** Hex estrito (tamanho par, só 0-9a-f): entrada malformada é descartada, não “consertada”. */
export function fromHex(h: string): Uint8Array {
  if (typeof h !== 'string' || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('hex inválido');
  return Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));
}

/** Chave pública (32 bytes) em hex minúsculo, ou erro. */
export function pkHex(h: string): string {
  if (typeof h !== 'string' || !/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('chave pública inválida');
  return h.toLowerCase();
}

/**
 * Inteiro que cabe em u32 (0 … 2^32 − 1). As mensagens assinadas codificam horários e números de
 * sequência em u32: sem esta conferência, X e X + 2^32 têm a MESMA assinatura válida, e um valor
 * trocado (maleável) serviria para "desrevogar" um nó ou atrasar o crédito de outro (auditoria final
 * 06/11/2026, H-1).
 */
export const isU32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
