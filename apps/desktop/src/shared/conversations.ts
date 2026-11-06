/**
 * Estado das conversas (mensagens por contato) como funções puras: o processo principal aplica os
 * eventos do Messenger e o renderer só mostra. Testado em test/conversations.test.ts.
 */
import type { ContactInfo, ConversationSummary, Message, MessageStatus, Route } from './types';

export interface ConversationsState {
  /** Mensagens por contato, na ordem em que entraram. */
  byContact: Record<string, Message[]>;
  /** Última leitura por contato (índice de mensagens já vistas). */
  readCount: Record<string, number>;
}

export const emptyState = (): ConversationsState => ({ byContact: {}, readCount: {} });

export const messagesOf = (s: ConversationsState, contactId: string): Message[] => s.byContact[contactId] ?? [];

const withList = (s: ConversationsState, contactId: string, list: Message[]): ConversationsState =>
  ({ ...s, byContact: { ...s.byContact, [contactId]: list } });

/** Mensagem minha, já cifrada e na fila do roteador ("aguardando"). */
export function appendOutgoing(s: ConversationsState, m: { id: string; contactId: string; text: string; at: number }): ConversationsState {
  const list = messagesOf(s, m.contactId);
  if (list.some(x => x.id === m.id)) return s;
  const msg: Message = { id: m.id, contactId: m.contactId, dir: 'out', text: m.text, at: m.at, status: 'aguardando' };
  // O que eu mesmo escrevi conta como lido.
  return { ...withList(s, m.contactId, [...list, msg]), readCount: { ...s.readCount, [m.contactId]: list.length + 1 } };
}

/** Mensagem recebida de um contato (não lida até `markRead`). Repetida (mesmo id) não duplica. */
export function receiveIncoming(s: ConversationsState, m: { id: string; contactId: string; text: string; at: number; route?: Route; sender?: string }): ConversationsState {
  const list = messagesOf(s, m.contactId);
  if (list.some(x => x.id === m.id)) return s;
  const msg: Message = { id: m.id, contactId: m.contactId, dir: 'in', text: m.text, at: m.at, status: 'recebida', ...(m.sender ? { sender: m.sender } : {}), ...(m.route ? { route: m.route } : {}) };
  return withList(s, m.contactId, [...list, msg]);
}

const RANK: Record<MessageStatus, number> = { criada: 0, aguardando: 1, encaminhada: 2, entregue: 3, expirada: 3, recebida: 9 };

/** Estado vindo do Messenger (`status`). Não regride (entregue fica entregue); id desconhecido é ignorado. */
export function applyStatus(s: ConversationsState, msgId: string, status: 'encaminhada' | 'entregue' | 'expirada', route: Route | undefined, now: number): ConversationsState {
  for (const [contactId, list] of Object.entries(s.byContact)) {
    const i = list.findIndex(m => m.id === msgId);
    if (i < 0) continue;
    const cur = list[i]!;
    if (RANK[status] <= RANK[cur.status] && cur.status !== 'aguardando') return s;
    const next: Message = { ...cur, status };
    if (route) next.route = route;
    if (status === 'encaminhada') next.forwardedAt = now;
    if (status === 'entregue') next.deliveredAt = now;
    const copy = [...list];
    copy[i] = next;
    return withList(s, contactId, copy);
  }
  return s;
}

export function markRead(s: ConversationsState, contactId: string): ConversationsState {
  return { ...s, readCount: { ...s.readCount, [contactId]: messagesOf(s, contactId).length } };
}

export function removeConversation(s: ConversationsState, contactId: string): ConversationsState {
  const byContact = { ...s.byContact }, readCount = { ...s.readCount };
  delete byContact[contactId];
  delete readCount[contactId];
  return { byContact, readCount };
}

const unreadOf = (s: ConversationsState, contactId: string) =>
  messagesOf(s, contactId).slice(s.readCount[contactId] ?? 0).filter(m => m.dir === 'in').length;

/** Lista de conversas ordenada pela última atividade (contatos sem mensagem ficam no fim, em ordem). */
export function summaries(s: ConversationsState, contacts: ContactInfo[]): ConversationSummary[] {
  const rows = contacts.map(contact => {
    const list = messagesOf(s, contact.id);
    return {
      contact,
      last: list.length ? list[list.length - 1]! : null,
      unread: unreadOf(s, contact.id),
      pending: list.filter(m => m.dir === 'out' && (m.status === 'aguardando' || m.status === 'encaminhada' || m.status === 'criada')).length,
    };
  });
  return rows.sort((a, b) => (b.last?.at ?? -1) - (a.last?.at ?? -1));
}

export type ConversationFilter = 'all' | 'unread' | 'requests';

export function filterSummaries(list: ConversationSummary[], query: string, filter: ConversationFilter): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  return list.filter(r => {
    if (filter === 'unread' && r.unread === 0) return false;
    if (filter === 'requests' && !r.contact.request) return false;
    if (!q) return true;
    return r.contact.name.toLowerCase().includes(q) || r.contact.id.toLowerCase().includes(q);
  });
}

/** Tipo de contatos persistidos antes da inclusão de grupos. */
export const conversationKind = (c: ContactInfo) => c.kind ?? 'direct';
/** Em conversas coletivas, a permissão deve ter sido explicitamente concedida pelo celular. */
export const canSendToConversation = (c: ContactInfo) => conversationKind(c) === 'direct' || (conversationKind(c) !== 'unknown' && c.canPost === true);
/** Filtros visíveis do desktop, sem converter comunidades em canais ou pessoas. */
export function filterConversationKind(list: ConversationSummary[], kind: 'all' | 'direct' | 'group' | 'channel'): ConversationSummary[] {
  return kind === 'all' ? list : list.filter(row => conversationKind(row.contact) === kind);
}
