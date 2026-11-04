/**
 * Regra do número no ícone do app (badge), separada do expo-notifications para ser testável.
 *
 * - Cada notificação comum do sistema soma 1 (mensagem, grupo, canal, por perto, carteira, rede).
 * - Alertas críticos da comunidade não contam: já chegam com importância máxima e têm tela própria.
 * - Ao voltar ao primeiro plano o número zera (junto com o dismiss das notificações).
 */

/** Teto defensivo: iOS e os launchers Android não mostram mais que isso de forma útil. */
export const BADGE_MAX = 999;

/** Número a mostrar depois de entregar uma notificação do sistema. */
export function nextBadgeCount(current: number, n: { critical?: boolean }): number {
  const base = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
  if (n.critical) return Math.min(base, BADGE_MAX);
  return Math.min(base + 1, BADGE_MAX);
}

/** Número ao voltar ao primeiro plano: a pessoa já está vendo o app. */
export const badgeAfterOpen = () => 0;
