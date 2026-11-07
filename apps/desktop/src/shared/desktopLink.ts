/**
 * Vínculo com o celular — só o que é ESPECÍFICO do desktop. O protocolo (QR, handshake, derivação,
 * palavras, quadros, tipos de snapshot/event/cmd) vem da lib compartilhada do celular:
 * `apps/mobile/src/lib/desktopLink.ts` (vetores de compatibilidade no teste de lá).
 * Aqui: a oferta renovável do QR, prazos, e a tradução do modelo do celular (chats/msgs) para o do
 * desktop (ContactInfo/Message/ConversationsState).
 */
import {
  encodeLinkQr, type LinkChat, type LinkEvent, type LinkMsg, MAX_TEXT, type PhoneMessage, type Snapshot,
} from '../../../mobile/src/lib/desktopLink';
import { decodeSs58 } from '../../../mobile/src/lib/ss58';
import { agree, random } from '../../../mobile/src/protocol/suite';
import { type ConversationsState, emptyState, markRead } from './conversations';
import type { ContactInfo, Message, MessageStatus } from './types';

export {
  certPin, desktopHandshake, DesktopLinkError, encodeLinkQr, FrameOpener, FrameSealer, LINK_INFO, LINK_PREFIX, LINK_VERSION, LINK_WORDS, linkWords, parseCommand, parseHello, parseLinkQr, phoneHandshake, wsUrl,
  type Command, type DesktopMessage, type Hello, type LinkChat, type LinkContact, type LinkEvent, type LinkKeys, type LinkMessage, type LinkMsg, type LinkOffer, type PhoneMessage, type Snapshot,
} from '../../../mobile/src/lib/desktopLink';

/** O QR é renovado a cada 30 s enquanto ninguém conectou (design: contador na tela). */
export const LINK_RENEW_SEC = 30;
/** Keepalive: o celular derruba em 75 s sem quadros; o desktop manda `ping` bem antes disso. */
export const LINK_PING_MS = 25_000;

/** Oferta mostrada no QR: chave X25519 efêmera e sessão de 16 bytes, novas a cada renovação. */
export interface DesktopOffer { sk: Uint8Array; pk: Uint8Array; session: Uint8Array; createdAt: number }

export function newOffer(now = Date.now(), sk: Uint8Array = random(32), session: Uint8Array = random(16)): DesktopOffer {
  return { sk, pk: agree.publicKey(sk), session, createdAt: now };
}
export const offerExpired = (o: DesktopOffer, now = Date.now()) => now - o.createdAt >= LINK_RENEW_SEC * 1000;
/**
 * QR com o certificado fixado (`c` = SHA-256 do DER, 32 bytes): `piu-link:1?h=…&k=…&s=…&c=…`.
 * O celular conecta por `wss://` aceitando só esse certificado (lib: `wsUrl`, `certPin`).
 */
export const offerQr = (o: DesktopOffer, host: string, port: number, cert: Uint8Array) => encodeLinkQr({ host, port, pk: o.pk, session: o.session, cert });

/** Códigos de fechamento WebSocket combinados com o celular. */
export const CLOSE_BAD_SESSION = 4001;
export const CLOSE_BAD_VERSION = 4002;

// ── modelo do celular → modelo do desktop ───────────────────────
const STATUS: Record<string, MessageStatus> = { criada: 'criada', aguardando: 'aguardando', encaminhada: 'encaminhada', entregue: 'entregue', expirada: 'expirada' };

/**
 * Tetos do espelho (B-04): o celular legítimo fica bem abaixo; o resto é descartado (mensagens: ficam
 * as mais novas). Os dados vêm de outro aparelho: tipo e tamanho são conferidos antes de virar estado.
 */
export const MAX_LINK_CHATS = 2000;
export const MAX_LINK_MESSAGES = 1000;
const MAX_LINK_ID = 64;
const MAX_NAME = 200;

/** Texto do celular: só string, cortada no tamanho combinado; o resto vira vazio. */
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
/** Id usado como chave de objeto: string curta e nunca um nome do `Object.prototype` (`constructor`, `__proto__`…). */
export const safeLinkId = (x: unknown): string | null =>
  typeof x === 'string' && x.length > 0 && x.length <= MAX_LINK_ID && !(x in Object.prototype) && x !== '__proto__' ? x : null;

export const contactFromChat = (c: LinkChat): ContactInfo => {
  const kind: NonNullable<ContactInfo['kind']> = ['direct', 'group', 'channel', 'community'].includes(c.kind) ? c.kind : 'unknown';
  const lunes = kind === 'direct' ? walletFromLink(c.lunes) : null;
  const sub = str(c.sub, MAX_NAME);
  return { id: c.id, name: str(c.name, MAX_NAME), via: c.ident === 'anon' ? 'anon' : 'public', request: c.request === true, kind,
    ...(kind !== 'direct' ? { canPost: c.owner === true } : {}), ...(sub ? { subtitle: sub } : {}), ...(lunes ? { lunesAddress: lunes } : {}) };
};
/** Conversa do celular com id válido (senão `null`: fica de fora). */
const chatFromLink = (c: unknown): ContactInfo | null => (c && typeof c === 'object' && safeLinkId((c as LinkChat).id) ? contactFromChat(c as LinkChat) : null);

/** `at` do celular é em ms; `time` é só o texto. Mensagens do sistema (`sys`) e sem id válido não entram na lista. */
export function messageFromLink(chatId: string, m: LinkMsg, nowSec: number): Message | null {
  if (!m || typeof m !== 'object' || m.from === 'sys') return null;
  const id = safeLinkId(m.id);
  if (!id) return null;
  const dir = m.from === 'me' ? 'out' : 'in';
  const sender = str(m.sender, MAX_NAME);
  return {
    id, contactId: chatId, dir, text: str(m.text, MAX_TEXT), at: typeof m.at === 'number' && Number.isFinite(m.at) && m.at > 0 ? Math.floor(m.at / 1000) : nowSec,
    status: dir === 'in' ? 'recebida' : STATUS[typeof m.status === 'string' ? m.status : ''] ?? 'entregue',
    ...(sender ? { sender } : {}),
  };
}

/** Snapshot do celular vira contatos + conversas (tudo já visto no celular conta como lido). */
export function stateFromSnapshot(s: Snapshot, nowSec: number): { contacts: ContactInfo[]; conv: ConversationsState } {
  const contacts: ContactInfo[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(s?.chats) ? s.chats : []) {
    if (contacts.length >= MAX_LINK_CHATS) break;
    const x = chatFromLink(c);
    if (x && !seen.has(x.id)) { seen.add(x.id); contacts.push(x); }
  }
  let conv = emptyState();
  const messages = s?.messages && typeof s.messages === 'object' && !Array.isArray(s.messages) ? s.messages : {};
  for (const [rawId, list] of Object.entries(messages)) {
    const chatId = safeLinkId(rawId);
    if (!chatId || !Array.isArray(list)) continue;
    const msgs = list.slice(-MAX_LINK_MESSAGES).map(m => messageFromLink(chatId, m, nowSec)).filter((m): m is Message => !!m);
    conv = { ...conv, byContact: { ...conv.byContact, [chatId]: msgs } };
    conv = markRead(conv, chatId);
  }
  return { contacts, conv };
}

/** Aplica um `event` do celular. Devolve o novo estado e a mensagem tocada (para o renderer). */
export function applyLinkEvent(contacts: ContactInfo[], conv: ConversationsState, e: LinkEvent, nowSec: number): { contacts: ContactInfo[]; conv: ConversationsState; touched: Message | null } {
  const same = { contacts, conv, touched: null };
  // Evento com conversa de id inválido (ou nome do protótipo): ignorado inteiro.
  if (e.k !== 'chat' && !safeLinkId((e as { chatId?: unknown }).chatId)) return same;
  switch (e.k) {
    case 'message': {
      const m = messageFromLink(e.chatId, e.msg, nowSec);
      if (!m) return { contacts, conv, touched: null };
      const list = conv.byContact[e.chatId] ?? [];
      // O que o desktop pediu para enviar chega de volta como mensagem do celular (`from:'me'`):
      // a cópia local provisória (mesmo texto, ainda sem id do celular) sai da lista.
      const without = list.filter(x => x.id !== m.id && !(m.dir === 'out' && x.dir === 'out' && x.id.startsWith('d') && x.text === m.text && (x.status === 'aguardando' || x.status === 'encaminhada')));
      return { contacts, conv: { ...conv, byContact: { ...conv.byContact, [e.chatId]: [...without, m].slice(-MAX_LINK_MESSAGES) } }, touched: m };
    }
    case 'status': {
      const list = conv.byContact[e.chatId] ?? [];
      const i = list.findIndex(x => x.id === e.msgId);
      if (i < 0) return { contacts, conv, touched: null };
      const next = { ...list[i]!, status: STATUS[e.status ?? ''] ?? list[i]!.status };
      const copy = [...list]; copy[i] = next;
      return { contacts, conv: { ...conv, byContact: { ...conv.byContact, [e.chatId]: copy } }, touched: next };
    }
    case 'messageRemoved': {
      const list = (conv.byContact[e.chatId] ?? []).filter(x => x.id !== e.msgId);
      return { contacts, conv: { ...conv, byContact: { ...conv.byContact, [e.chatId]: list } }, touched: null };
    }
    case 'chat': {
      const c = chatFromLink(e.chat);
      if (!c) return same;
      const exists = contacts.some(x => x.id === c.id);
      if (!exists && contacts.length >= MAX_LINK_CHATS) return same;
      const next = exists ? contacts.map(x => (x.id === c.id ? c : x)) : [...contacts, c];
      return { contacts: next, conv, touched: null };
    }
    case 'chatRemoved': {
      const byContact = { ...conv.byContact }; delete byContact[e.chatId];
      const readCount = { ...conv.readCount }; delete readCount[e.chatId];
      return { contacts: contacts.filter(x => x.id !== e.chatId), conv: { byContact, readCount }, touched: null };
    }
    default: return { contacts, conv, touched: null }; // typing e tipos futuros
  }
}

/**
 * Endereço Lunes vindo do espelho do vínculo (`Snapshot.wallet`, `LinkChat.lunes`, `LinkContact.lunes`):
 * nunca confie no outro lado — só um SS58 válido (prefixo 57 ou 42) entra; qualquer outra coisa vira `null`.
 */
export function walletFromLink(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 64) return null;
  const t = x.trim();
  return t && decodeSs58(t).ok ? t : null;
}

/** Mensagem do celular já aberta: só o que o desktop entende; o resto é ignorado (compatibilidade). */
export const isPhoneMessage = (x: unknown): x is PhoneMessage => !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string';
