/**
 * O que a prévia da tela bloqueada (app/lock.tsx) mostra: as notificações reais recentes, sem nada
 * de exemplo. TypeScript puro (testado no Node).
 *
 * - Mensagens: uma entrada por conversa com mensagens recebidas ainda não lidas (a mais recente,
 *   com a contagem), na ordem em que chegaram. Conversas silenciadas e tipos desligados em
 *   Notificações → O que avisar ficam de fora, como nas notificações do sistema.
 * - Pré-visualização: só "Sempre" mostra remetente e texto na tela bloqueada; "Desbloqueado" e
 *   "Nunca" mostram "Piu" e o texto neutro (o mesmo de lib/notifications.ts).
 * - Alertas oficiais severos e extremos da região (lib/alertsCore.ts) sempre mostram o conteúdo:
 *   são públicos, e é o mesmo que a notificação crítica faz.
 */
import type { NotifKey, Preview } from '../data/settings';
import type { Chat } from '../data/types';
import { alertTitle, areaLine, type AlertRegion, isUrgent, type OfficialAlert, visibleAlerts } from './alertsCore';

export interface LockItem {
  id: string;
  critical: boolean;
  title: string;
  body: string;
  /** Mais mensagens da mesma conversa (o cartão aparece empilhado). */
  more: number;
  /** Quando chegou (ms), ou `null` se a mensagem só tem a hora (versões antigas). */
  at: number | null;
  /** Hora "HH:MM" da mensagem, para quando não há `at`. */
  hm: string;
  /** Rota ao tocar. */
  href: string;
}

const MAX_ITEMS = 12;

export const notifKindOf = (c: Pick<Chat, 'kind'>): NotifKey => (c.kind === 'group' ? 'group' : c.kind === 'channel' || c.kind === 'community' ? 'channel' : 'msg');

export function lockItems(o: {
  chats: Chat[]; preview: Preview; notifs: Record<NotifKey, boolean>;
  alerts?: OfficialAlert[]; region?: AlertRegion; now: number;
}): LockItem[] {
  const hide = o.preview !== 'always';
  const out: LockItem[] = [];
  if (o.alerts && o.region) {
    for (const a of visibleAlerts(o.alerts, o.region, o.now).filter(isUrgent)) {
      out.push({ id: 'alert:' + a.id, critical: true, title: alertTitle(a), body: areaLine(a) || a.info.description, more: 0, at: a.receivedAt, hm: '', href: `/alert?id=${encodeURIComponent(a.id)}` });
    }
  }
  const msgs: LockItem[] = [];
  for (const c of o.chats) {
    if (c.muted || c.unread <= 0 || !o.notifs[notifKindOf(c)]) continue;
    const incoming = (c.msgs ?? []).filter(m => m.from === 'them' && (!m.expiresAt || m.expiresAt > o.now));
    const unread = incoming.slice(-c.unread);
    const last = unread.at(-1);
    if (!last) continue;
    const kind = notifKindOf(c);
    const text = last.text || (last.file ? `Arquivo: ${last.file.name}` : '');
    const body = kind === 'group' && last.sender ? `${last.sender}: ${text}` : text;
    const neutral = kind === 'channel' ? 'Nova publicação' : unread.length > 1 ? 'Novas mensagens' : 'Nova mensagem';
    msgs.push({
      id: c.id, critical: false, title: hide ? 'Piu' : c.name, body: hide ? neutral : body,
      more: unread.length - 1, at: last.at ?? null, hm: last.time, href: `/chat/${c.id}`,
    });
  }
  // A lista de conversas já vem com a mais recente no topo quando não há horário salvo.
  msgs.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return [...out, ...msgs].slice(0, MAX_ITEMS);
}

/** "agora", "5 min", "2 h" ou a hora da mensagem. */
export function lockTime(i: Pick<LockItem, 'at' | 'hm'>, now: number): string {
  if (i.at == null) return i.hm;
  const min = Math.max(0, Math.round((now - i.at) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h`;
  return i.hm || `${Math.round(min / 1440)} d`;
}
