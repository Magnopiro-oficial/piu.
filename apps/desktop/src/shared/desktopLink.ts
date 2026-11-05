/**
 * Vínculo com o celular — só o que é ESPECÍFICO do desktop. O protocolo (QR, handshake, derivação,
 * palavras, quadros, tipos de snapshot/event/cmd) vem da lib compartilhada do celular:
 * `apps/mobile/src/lib/desktopLink.ts` (vetores de compatibilidade no teste de lá).
 * Aqui: a oferta renovável do QR, prazos, e a tradução do modelo do celular (chats/msgs) para o do
 * desktop (ContactInfo/Message/ConversationsState).
 */
import {
  encodeLinkQr, type LinkChat, type LinkEvent, type LinkMsg, type PhoneMessage, type Snapshot,
} from '../../../mobile/src/lib/desktopLink';
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

export const contactFromChat = (c: LinkChat): ContactInfo => ({ id: c.id, name: c.name, via: c.ident === 'anon' ? 'anon' : 'public', request: !!c.request });

/** `at` do celular é em ms; `time` é só o texto. Mensagens do sistema (`sys`) não entram na lista. */
export function messageFromLink(chatId: string, m: LinkMsg, nowSec: number): Message | null {
  if (m.from === 'sys') return null;
  const dir = m.from === 'me' ? 'out' : 'in';
  return {
    id: m.id, contactId: chatId, dir, text: m.text, at: m.at ? Math.floor(m.at / 1000) : nowSec,
    status: dir === 'in' ? 'recebida' : STATUS[m.status ?? ''] ?? 'entregue',
  };
}

/** Snapshot do celular vira contatos + conversas (tudo já visto no celular conta como lido). */
export function stateFromSnapshot(s: Snapshot, nowSec: number): { contacts: ContactInfo[]; conv: ConversationsState } {
  const contacts = s.chats.map(contactFromChat);
  let conv = emptyState();
  for (const [chatId, list] of Object.entries(s.messages)) {
    const msgs = list.map(m => messageFromLink(chatId, m, nowSec)).filter((m): m is Message => !!m);
    conv = { ...conv, byContact: { ...conv.byContact, [chatId]: msgs } };
    conv = markRead(conv, chatId);
  }
  return { contacts, conv };
}

/** Aplica um `event` do celular. Devolve o novo estado e a mensagem tocada (para o renderer). */
export function applyLinkEvent(contacts: ContactInfo[], conv: ConversationsState, e: LinkEvent, nowSec: number): { contacts: ContactInfo[]; conv: ConversationsState; touched: Message | null } {
  switch (e.k) {
    case 'message': {
      const m = messageFromLink(e.chatId, e.msg, nowSec);
      if (!m) return { contacts, conv, touched: null };
      const list = conv.byContact[e.chatId] ?? [];
      // O que o desktop pediu para enviar chega de volta como mensagem do celular (`from:'me'`):
      // a cópia local provisória (mesmo texto, ainda sem id do celular) sai da lista.
      const without = list.filter(x => x.id !== m.id && !(m.dir === 'out' && x.dir === 'out' && x.id.startsWith('d') && x.text === m.text && (x.status === 'aguardando' || x.status === 'encaminhada')));
      return { contacts, conv: { ...conv, byContact: { ...conv.byContact, [e.chatId]: [...without, m] } }, touched: m };
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
      const c = contactFromChat(e.chat);
      const next = contacts.some(x => x.id === c.id) ? contacts.map(x => (x.id === c.id ? c : x)) : [...contacts, c];
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

/** Mensagem do celular já aberta: só o que o desktop entende; o resto é ignorado (compatibilidade). */
export const isPhoneMessage = (x: unknown): x is PhoneMessage => !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string';
