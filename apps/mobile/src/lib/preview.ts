import type { ToastData } from '../data/types';
import type { Preview } from '../data/settings';
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

/** Texto neutro por tipo (o mesmo das notificações do sistema, lib/notifications.ts), no idioma em uso. */
const NEUTRAL: Partial<Record<NonNullable<ToastData['kind']>, Key>> = { msg: 'notify.hidden.msg', group: 'notify.hidden.msg', channel: 'notify.hidden.channel', nearby: 'notify.hidden.nearby' };

/**
 * Banner dentro do app conforme a pré-visualização (Notificações → Pré-visualização):
 * - "Nunca": "Nunca mostra remetente nem conteúdo, nem com o aparelho desbloqueado". Sai a versão
 *   `hidden` do banner, sem avatar; banner de conversa sem `hidden` vira "Piu · Nova mensagem".
 * - "Só desbloqueado" e "Sempre": mostra tudo. O banner só aparece com o app aberto (aparelho
 *   desbloqueado), e com o bloqueio do app ligado ele fica por baixo da tela de bloqueio (ui/AppLock.tsx).
 */
export function bannerFor(toast: ToastData, preview: Preview, t: Tr = tGlobal): ToastData {
  if (preview !== 'never') return toast;
  const neutral = toast.hidden ?? (toast.kind && NEUTRAL[toast.kind] ? { title: 'Piu', body: t(NEUTRAL[toast.kind]!) } : null);
  return neutral ? { ...toast, ...neutral, av: undefined, icon: toast.icon ?? 'notifications' } : toast;
}
