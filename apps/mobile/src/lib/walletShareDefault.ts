/**
 * "Compartilhar meu endereço Lunes" (Privacidade): só instalação nova nasce com a opção desligada.
 * Lógica pura, sem React, para testar em Node (`__tests__/walletShareDefault.test.ts`).
 *
 * Como saber se a instalação é nova: os ajustes são montados antes de a identidade ser criada ou
 * restaurada. Se nesse momento a entrada ainda não foi concluída (`onboarded` não é `true`) e não há
 * valor salvo, o app grava "desligado" de forma explícita. Quem já usa o app tem `onboarded` salvo como
 * `true`: sem valor explícito continua valendo como ligado, e nada é regravado nem revogado.
 */
export function shareWalletStartsOff(i: {
  /** O que está salvo em `set.priv` (ou `undefined`). */
  saved: unknown;
  /** O que está salvo em `onboarded`. */
  onboarded: unknown;
  /** A leitura do armazenamento falhou: ausência não prova instalação nova. */
  readFailed: boolean;
  /** Houve "Apagar dados locais" nesta sessão: os dados foram apagados de propósito. */
  wiped: boolean;
}): boolean {
  const explicit = !!i.saved && typeof i.saved === 'object' && typeof (i.saved as { shareWallet?: unknown }).shareWallet === 'boolean';
  if (explicit || i.onboarded === true) return false;
  if (i.readFailed && !i.wiped) return false;
  return true;
}
