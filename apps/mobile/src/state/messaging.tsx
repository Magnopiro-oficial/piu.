import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chat } from '../data/types';
import { persistNow, readPersisted } from '../lib/persist';
import { initialsOf, nowHM } from '../lib/text';
import { type ContactCard, decodeCard, encodeCard } from '../messaging/card';
import { type Contact, Messenger } from '../messaging/messenger';
import { createTestDevice, TEST_DEVICE_PEER, TEST_DEVICE_NAME, type TestDevice } from '../messaging/testDevice';
import type { IdentityKind, PublicIdentity } from '../protocol';
import { getTransport } from '../transport';
import { attachVirtualPeer } from '../transport/simulated';
import { useKeys } from './keys';
import { useNetwork } from './network';
import { useSettings } from './settings';
import { useStore } from './store';

const STATE_KEY = 'msg.state';
const SAVE_DELAY = 300;
const now = () => Math.floor(Date.now() / 1000);

/** Id da conversa de um contato real (curto e seguro para a URL). */
export const chatIdFor = (contactId: string) => 'p' + contactId.replace(/^piu:/, '').slice(0, 20);

interface Messaging {
  ready: boolean;
  /** Código do meu cartão (QR) para a identidade em uso; renovado ao gerar um novo. */
  myCard: (kind: IdentityKind) => string;
  /** Lê um código colado ou escaneado. Lança erro com mensagem em português. */
  readCard: (text: string) => ContactCard;
  /** Adiciona o contato e devolve o id da conversa. */
  addFromCard: (card: ContactCard) => string;
  /** Chaves públicas do contato de uma conversa real (para o código de segurança). */
  contactKeys: (chatId: string) => PublicIdentity | null;
  /** Cartão do aparelho de teste (só no transporte simulado). */
  testDeviceCard: (() => string) | null;
}

const Ctx = createContext<Messaging | null>(null);

/**
 * Mensagens reais: as conversas com `peer` são cifradas (Double Ratchet dentro do envelope selado),
 * vão para a fila do roteador e saem pelo transporte para cada vizinho conectado.
 * O estado das sessões é gravado ANTES de qualquer envio: depois de um travamento, uma chave de
 * mensagem nunca é reutilizada.
 */
export function MessagingProvider({ children }: { children: ReactNode }) {
  const { identities, node } = useKeys();
  const { profile, onboarded, setOutbound, receive, setMsgStatus, addChat, chats, showToast } = useStore();
  const { relay: relayOn, relayPaused } = useNetwork();
  const relay = relayOn && !relayPaused;
  const { priv } = useSettings();
  const transport = useMemo(getTransport, []);
  const [messenger, setMessenger] = useState<Messenger | null>(null);
  const [testDevice, setTestDevice] = useState<TestDevice | null>(null);

  // Referências para os eventos do mensageiro (que vivem fora do React).
  const chatsRef = useRef(chats); chatsRef.current = chats;
  const privRef = useRef(priv); privRef.current = priv;
  const msgToChat = useRef(new Map<string, string>());

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mRef = useRef<Messenger | null>(null);
  const saveNow = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (mRef.current) await persistNow(STATE_KEY, mRef.current.export());
  }, []);
  const saveSoon = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveNow().catch(() => {}); }, SAVE_DELAY);
  }, [saveNow]);

  const handlers = useRef({ receive, setMsgStatus, addChat, showToast });
  handlers.current = { receive, setMsgStatus, addChat, showToast };

  // Cria o mensageiro quando as chaves existem.
  useEffect(() => {
    if (!identities || !node || !onboarded) return;
    let saving: Promise<void> | null = null;
    const m = new Messenger({
      identities, node, relay, now, state: readPersisted<string>(STATE_KEY),
      randomDelay: () => privRef.current.delay,
      pad: () => privRef.current.pad,
      transmit: async (peerId, bytes) => {
        // Grava as sessões antes de os bytes saírem do aparelho (uma gravação por lote).
        saving ??= Promise.resolve().then(saveNow).finally(() => { saving = null; });
        await saving;
        await transport.send(peerId, bytes);
      },
      events: {
        changed: saveSoon,
        status: (msgId, st) => {
          const cid = msgToChat.current.get(msgId) ?? chatsRef.current.find(c => c.peer && c.msgs?.some(x => x.id === msgId))?.id;
          if (cid) handlers.current.setMsgStatus(cid, msgId, st);
        },
        message: (contactId, x) => {
          const cid = chatIdFor(contactId);
          if (!chatsRef.current.some(c => c.id === cid)) return;
          handlers.current.receive(cid, { id: 'in-' + x.msgId, from: 'them', text: x.text, time: nowHM() });
        },
        newContact: (c, x) => {
          const cid = chatIdFor(c.id);
          handlers.current.addChat(chatFor(c, true));
          handlers.current.receive(cid, { id: 'in-' + x.msgId, from: 'them', text: x.text, time: nowHM() });
        },
      },
    });
    mRef.current = m;
    setMessenger(m);
    return () => { clearTimeout(saveTimer.current); void persistNow(STATE_KEY, m.export()).catch(() => {}); mRef.current = null; setMessenger(null); };
  }, [identities, node, onboarded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (messenger) { messenger.relay = relay; } }, [messenger, relay]);
  useEffect(() => { if (messenger) messenger.displayName = profile.idType === 'public' ? profile.name.trim() : ''; }, [messenger, profile]);

  // Transporte → mensageiro.
  useEffect(() => {
    if (!messenger) return;
    const off = transport.subscribe(e => {
      if (e.type === 'connected') messenger.peerConnected(e.id, transport.kind === 'nearby' ? 'direct' : 'ble');
      else if (e.type === 'disconnected' || e.type === 'peerLost') messenger.peerDisconnected(e.id);
      else if (e.type === 'envelope') messenger.receive(e.from, e.data);
      else if (e.type === 'state' && e.state === 'off') messenger.clearPeers(); // vizinhos somem com o transporte
    });
    const tick = setInterval(() => messenger.tick(), 5000);
    return () => { off(); clearInterval(tick); };
  }, [messenger, transport]);

  // Store → mensageiro (envio real).
  useEffect(() => {
    if (!messenger) { setOutbound(null); return; }
    setOutbound((chatId, peer, msgId, text) => {
      try {
        // Responder aceita o pedido de conversa.
        const ct = messenger.getContact(peer);
        if (ct?.request) messenger.addContact(ct);
        msgToChat.current.set(msgId, chatId); messenger.sendText(peer, msgId, text); return true;
      } catch { return false; }
    });
    return () => setOutbound(null);
  }, [messenger, setOutbound]);

  // Aparelho de teste: só no transporte simulado (navegador / Expo Go).
  useEffect(() => {
    if (transport.kind !== 'sim' || !messenger) return;
    const td = createTestDevice(now, readPersisted<string>('msg.testDevice'), s => { void persistNow('msg.testDevice', s).catch(() => {}); });
    td.messenger.peerConnected('app', 'ble');
    const detach = attachVirtualPeer({
      id: TEST_DEVICE_PEER, name: TEST_DEVICE_NAME,
      receive: (data, reply) => { td.setReply(reply); td.messenger.receive('app', data); },
    });
    setTestDevice(td);
    return () => { detach(); setTestDevice(null); };
  }, [transport, messenger]);

  const value = useMemo<Messaging>(() => ({
    ready: !!messenger,
    myCard: kind => (identities ? encodeCard(identities[kind], kind === 'public' ? profile.name : '', now()) : ''),
    readCard: text => decodeCard(text, now()),
    addFromCard: card => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const via: IdentityKind = card.kind; // anônima conversa com anônima, pública com pública
      const contact: Contact = { id: card.id, via, pub: card.pub, name: card.name };
      messenger.addContact(contact);
      const cid = chatIdFor(card.id);
      addChat(chatFor(contact, false));
      return cid;
    },
    contactKeys: chatId => {
      const peer = chats.find(c => c.id === chatId)?.peer;
      return (peer && messenger?.getContact(peer)?.pub) || null;
    },
    testDeviceCard: testDevice ? testDevice.card : null,
  }), [messenger, identities, profile.name, chats, addChat, testDevice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function chatFor(c: Contact, request: boolean): Chat {
  const name = c.name || (c.via === 'anon' ? 'Anônimo · ' + c.id.slice(4, 8).toUpperCase() : 'Contato · ' + c.id.slice(4, 8).toUpperCase());
  return {
    id: chatIdFor(c.id), peer: c.id, request, ident: c.via, kind: 'direct', name, initials: initialsOf(name), time: nowHM(), unread: 0,
    sub: request ? 'pedido de conversa · confira o código' : 'cifrada de ponta a ponta', via: 'Por perto', viaIcon: 'bluetooth',
    msgs: [{ id: 'sys-' + c.id.slice(4, 12), from: 'sys', time: nowHM(), text: request
      ? 'Esta pessoa escreveu primeiro. Confira o código de segurança pessoalmente antes de confiar.'
      : 'Chaves trocadas. As mensagens são cifradas neste aparelho e só o contato consegue ler.' }],
  };
}

export function useMessaging(): Messaging {
  const m = useContext(Ctx);
  if (!m) throw new Error('useMessaging fora de MessagingProvider');
  return m;
}

/** Meu cartão (QR) para a identidade `kind`, renovado a cada hora (cada um vale 24 h). `bump` gera outro já. */
export function useMyCard(kind: IdentityKind): [string, () => void] {
  const { myCard, ready } = useMessaging();
  const [seq, setSeq] = useState(0);
  const [hour, setHour] = useState(() => Math.floor(Date.now() / 3_600_000));
  useEffect(() => { const t = setInterval(() => setHour(Math.floor(Date.now() / 3_600_000)), 60_000); return () => clearInterval(t); }, []);
  const card = useMemo(() => (ready ? myCard(kind) : ''), [ready, myCard, kind, hour, seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return [card, () => setSeq(s => s + 1)];
}
