/**
 * Estado das conversas (mensagens por contato) como funções puras: o processo principal aplica os
 * eventos do Messenger e o renderer só mostra. Testado em test/conversations.test.ts.
 */
import type { CallRecord } from '../../../mobile/src/calls/callMachine';
import type { RequestStep } from '../../../mobile/src/calls/callView';
import type { ContactInfo, ConversationSummary, Message, MessageStatus, Route, TempMode } from './types';

/** Prazos das mensagens temporárias (os do celular e do protótipo). */
export const TEMP_MODES: readonly TempMode[] = ['off', '1h', '24h', '7d'];
const TEMP_SEC: Record<TempMode, number | undefined> = { off: undefined, '1h': 3600, '24h': 86400, '7d': 7 * 86400 };
export const expireSecOf = (t: TempMode | undefined): number | undefined => (t ? TEMP_SEC[t] : undefined);

export interface ConversationsState {
  /** Mensagens por contato, na ordem em que entraram. */
  byContact: Record<string, Message[]>;
  /** Última leitura por contato (índice de mensagens já vistas). */
  readCount: Record<string, number>;
}

export const emptyState = (): ConversationsState => ({ byContact: {}, readCount: {} });

/**
 * Teto do histórico local por conversa (B-04): ficam as mais novas, para um contato (ou nó) insistente
 * não inflar `state.bin` sem limite.
 */
export const MAX_LOCAL_MESSAGES = 5000;

/** Só listas próprias: `constructor`/`__proto__` não resolvem para o `Object.prototype`. */
export const messagesOf = (s: ConversationsState, contactId: string): Message[] => (Object.hasOwn(s.byContact, contactId) ? s.byContact[contactId]! : []);

const withList = (s: ConversationsState, contactId: string, list: Message[]): ConversationsState => {
  if (list.length <= MAX_LOCAL_MESSAGES) return { ...s, byContact: { ...s.byContact, [contactId]: list } };
  const drop = list.length - MAX_LOCAL_MESSAGES;
  const read = s.readCount[contactId];
  return { byContact: { ...s.byContact, [contactId]: list.slice(drop) }, readCount: read === undefined ? s.readCount : { ...s.readCount, [contactId]: Math.max(0, read - drop) } };
};

/** Mensagem minha, já cifrada e na fila do roteador ("aguardando"). */
export function appendOutgoing(s: ConversationsState, m: { id: string; contactId: string; text: string; at: number; expiresAt?: number }): ConversationsState {
  const list = messagesOf(s, m.contactId);
  if (list.some(x => x.id === m.id)) return s;
  const msg: Message = { id: m.id, contactId: m.contactId, dir: 'out', text: m.text, at: m.at, status: 'aguardando', ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}) };
  // O que eu mesmo escrevi conta como lido.
  const next = withList(s, m.contactId, [...list, msg]);
  return { ...next, readCount: { ...next.readCount, [m.contactId]: messagesOf(next, m.contactId).length } };
}

/** Mensagem recebida de um contato (não lida até `markRead`). Repetida (mesmo id) não duplica. */
export function receiveIncoming(s: ConversationsState, m: { id: string; contactId: string; text: string; at: number; route?: Route; sender?: string; expiresAt?: number }): ConversationsState {
  const list = messagesOf(s, m.contactId);
  if (list.some(x => x.id === m.id)) return s;
  const msg: Message = { id: m.id, contactId: m.contactId, dir: 'in', text: m.text, at: m.at, status: 'recebida', ...(m.sender ? { sender: m.sender } : {}), ...(m.route ? { route: m.route } : {}), ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}) };
  return withList(s, m.contactId, [...list, msg]);
}

/**
 * Registro de chamada de voz (cartão no lugar do balão). Repetido (mesma chamada) não duplica. Atender,
 * recusar ou ligar conta como ter visto a conversa; só a chamada perdida fica como não lida.
 */
export function appendCallRecord(s: ConversationsState, rec: CallRecord): ConversationsState {
  const id = `call-${rec.callId}`, list = messagesOf(s, rec.peer);
  if (list.some(x => x.id === id)) return s;
  const msg: Message = { id, contactId: rec.peer, dir: rec.dir, text: '', at: Math.floor(rec.at / 1000), status: rec.dir === 'out' ? 'entregue' : 'recebida', call: rec };
  const next = withList(s, rec.peer, [...list, msg]);
  if (rec.dir === 'in' && rec.outcome === 'missed') return next;
  return { ...next, readCount: { ...next.readCount, [rec.peer]: messagesOf(next, rec.peer).length } };
}

/** Cartão "Pedido de chamada": aparece na primeira etapa e avança no mesmo lugar (a caminho → entregue → aceito…). */
export function upsertCallRequest(s: ConversationsState, m: { peer: string; requestId: string; step: RequestStep; dir: 'out' | 'in'; at: number }): ConversationsState {
  const id = `callreq-${m.requestId}`, list = messagesOf(s, m.peer);
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) {
    if (list[i]!.callRequest?.step === m.step) return s;
    const copy = list.slice();
    copy[i] = { ...list[i]!, callRequest: { requestId: m.requestId, step: m.step } };
    return withList(s, m.peer, copy);
  }
  const msg: Message = { id, contactId: m.peer, dir: m.dir, text: '', at: m.at, status: m.dir === 'out' ? 'entregue' : 'recebida', callRequest: { requestId: m.requestId, step: m.step } };
  return withList(s, m.peer, [...list, msg]);
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

/**
 * Mensagens temporárias vencidas saem do histórico (nos dois lados, como no celular). A contagem de lidas
 * desconta as que sumiram dentro da parte já lida. Nada venceu: devolve o mesmo objeto.
 */
export function dropExpired(s: ConversationsState, now: number): ConversationsState {
  let changed = false;
  const byContact: Record<string, Message[]> = {}, readCount = { ...s.readCount };
  for (const [contactId, list] of Object.entries(s.byContact)) {
    if (!list.some(m => m.expiresAt !== undefined && m.expiresAt <= now)) { byContact[contactId] = list; continue; }
    changed = true;
    const read = s.readCount[contactId] ?? 0;
    const goneRead = list.slice(0, read).filter(m => m.expiresAt !== undefined && m.expiresAt <= now).length;
    byContact[contactId] = list.filter(m => !(m.expiresAt !== undefined && m.expiresAt <= now));
    if (s.readCount[contactId] !== undefined) readCount[contactId] = read - goneRead;
  }
  return changed ? { byContact, readCount } : s;
}

const unreadOf = (s: ConversationsState, contactId: string) =>
  messagesOf(s, contactId).slice(s.readCount[contactId] ?? 0).filter(m => m.dir === 'in').length;

/** Lista de conversas ordenada pela última atividade (contatos sem mensagem ficam no fim, em ordem). */
export function summaries(s: ConversationsState, contacts: ContactInfo[], local: { muted?: ReadonlySet<string>; temp?: Readonly<Record<string, TempMode>> } = {}): ConversationSummary[] {
  const rows = contacts.map(contact => {
    const list = messagesOf(s, contact.id);
    const temp = local.temp && Object.hasOwn(local.temp, contact.id) ? local.temp[contact.id] : undefined;
    return {
      ...(local.muted?.has(contact.id) ? { muted: true } : {}),
      ...(temp && temp !== 'off' ? { temp } : {}),
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
