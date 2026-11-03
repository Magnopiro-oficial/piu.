/**
 * Dados de exemplo que versões antigas do app salvaram (TypeScript puro, testado).
 * Só campos que NUNCA tiveram dado real saem: movimentações e saldo inventados da carteira, pedidos e
 * convites para perfis de exemplo de Por perto, equipamentos de exemplo do provider, aparelhos de
 * exemplo desconectados e o "cache de mídia" de mentira. Ajustes escolhidos pela pessoa (taxa do
 * convite, visibilidade, Modo nó, transportes, limites) ficam.
 */
export const LEGACY_KEYS = [
  'wallet.sent', 'wallet.reserved', 'wallet.earned', 'wallet.refunded', 'wallet.joaoPaid',
  'nearby.helenaNotified', 'nearby.invited', 'nearby.reqStatus',
  'net.devices',
  'set.dropped', 'set.mediaCleared',
] as const;

/** Dos campos salvos (nomes sem prefixo), quais são de exemplo e devem sair. */
export const legacyKeysIn = (names: readonly string[]): string[] => names.filter(n => (LEGACY_KEYS as readonly string[]).includes(n));
