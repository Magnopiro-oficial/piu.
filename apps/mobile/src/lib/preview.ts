import type { ToastData } from '../data/types';
import type { Preview } from '../data/settings';

/** Texto neutro por tipo (o mesmo das notificações do sistema, lib/notifications.ts). */
const NEUTRAL: Partial<Record<NonNullable<ToastData['kind']>, string>> = { msg: 'Nova mensagem', group: 'Nova mensagem', channel: 'Nova publicação', nearby: 'Novo pedido de conversa' };

/**
 * Banner dentro do app conforme a pré-visualização (Notificações → Pré-visualização):
 * - "Nunca": "Nunca mostra remetente nem conteúdo, nem com o aparelho desbloqueado". Sai a versão
 *   `hidden` do banner, sem avatar; banner de conversa sem `hidden` vira "Piu · Nova mensagem".
 * - "Só desbloqueado" e "Sempre": mostra tudo. O banner só aparece com o app aberto (aparelho
 *   desbloqueado), e com o bloqueio do app ligado ele fica por baixo da tela de bloqueio (ui/AppLock.tsx).
 */
export function bannerFor(t: ToastData, preview: Preview): ToastData {
  if (preview !== 'never') return t;
  const neutral = t.hidden ?? (t.kind && NEUTRAL[t.kind] ? { title: 'Piu', body: NEUTRAL[t.kind]! } : null);
  return neutral ? { ...t, ...neutral, av: undefined, icon: t.icon ?? 'notifications' } : t;
}
