import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chat, TempMode } from '../data/types';
import { cleanChats, cleanVerified } from '../lib/demoCleanup';
import { persistNow, readPersisted } from '../lib/persist';
import { initialsOf, nowHM } from '../lib/text';
import { fmtLunes } from '../data/wallet';
import { type ContactCard, decodeCard, encodeCard } from '../messaging/card';
import { router } from 'expo-router';
import { type Contact, Messenger, type NearPeer, type NearRequest } from '../messaging/messenger';
import { canPost, type GroupState, memberCount } from '../messaging/groups';
import type { CreditBook, Credit, Lot } from '../messaging/credits';
import { b64url, unb64url } from '../messaging/card';
import { createTestDevice, TEST_DEVICE_PEER, TEST_DEVICE_NAME, type TestDevice } from '../messaging/testDevice';
import type { IdentityKind, PublicIdentity } from '../protocol';
import { getTransport } from '../transport';
import { applySessionRotation, takeRestoredData, useSessionRotationEpoch } from '../lib/migrationState';
import { markRevocationsSent, pendingRevocations } from '../lib/devices';
import { decodeRevocation, encodeRevocation, verifyRevocation } from '../lib/devicesCore';
import { toHex } from '../protocol/bytes';
import { toBase64 } from '../transport/base64';
import { PREVIEW_MAX_BYTES } from '../lib/pickFile';
import type { ProfilePhoto } from '../lib/avatar';
import type { IncomingFile } from '../messaging/messenger';
import { attachVirtualPeer } from '../transport/simulated';
import { useKeys } from './keys';
import { useNetwork } from './network';
import { useSettings } from './settings';
import { useStore } from './store';
import { useWallet } from './wallet';

const STATE_KEY = 'msg.state';
/** Arquivos recebidos nesta execução do app (o conteúdo não vai para o armazenamento). */
export const receivedFiles = new Map<string, IncomingFile>();
const SAVE_DELAY = 300;
const now = () => Math.floor(Date.now() / 1000);

/** Id da conversa de um contato real (curto e seguro para a URL). */
export const chatIdFor = (contactId: string) => 'p' + contactId.replace(/^piu:/, '').slice(0, 20);

interface Messaging {
  ready: boolean;
  /** Código do meu cartão (QR) para a identidade em uso; renovado ao gerar um novo. */
  /** `fresh`: revoga o convite anterior dessa identidade e gera outro. */
  myCard: (kind: IdentityKind, fresh?: boolean) => string;
  /** Muda quando um convite meu é usado (o QR precisa ser trocado). */
  inviteEpoch: number;
  /** Lê um código colado ou escaneado. Lança erro com mensagem em português. */
  readCard: (text: string) => ContactCard;
  /** Adiciona o contato e devolve o id da conversa. */
  addFromCard: (card: ContactCard) => string;
  /** Chaves públicas do contato de uma conversa real (para o código de segurança). */
  contactKeys: (chatId: string) => PublicIdentity | null;
  /** Cartão do aparelho de teste (só no transporte simulado). */
  testDeviceCard: (() => string) | null;
  /** Contatos aceitos de uma identidade (para escolher membros). */
  contactsFor: (via: IdentityKind) => { id: string; name: string }[];
  /** Estado real de um grupo/canal/comunidade da conversa (ou null). */
  groupOf: (chatId: string) => GroupState | null;
  /** Meu id na identidade usada pelo grupo (para saber se sou admin). */
  myIdIn: (via: IdentityKind) => string;
  createGroup: (o: Parameters<Messenger['createGroup']>[0]) => string;
  groupOps: {
    update: Messenger['updateGroup']; addMembers: Messenger['addMembers']; remove: Messenger['removeMember'];
    setRole: Messenger['setRole']; leave: (gid: string) => void; answerJoin: Messenger['answerJoin'];
    pending: (gid: string) => { id: string; name: string }[];
    joinChild: (communityId: string, childId: string) => void;
    isMember: (gid: string) => boolean;
    /** Posso convidar? (admin, ou membro com "Quem pode convidar: Todos os membros"). */
    canInvite: (gid: string) => boolean;
    /** Link/QR do convite do grupo (7 dias, até 50 usos). */
    inviteLink: (gid: string, fresh?: boolean) => string;
  } | null;
  /** Lê um convite de grupo (`piug:`) e pede para entrar. Devolve o nome do grupo. */
  joinFromLink: (text: string) => string;
  /** Muda quando grupos ou pedidos mudam (para as telas se atualizarem). */
  groupEpoch: number;
  /** Métricas e créditos deste aparelho (null antes das chaves). */
  stats: () => Stats | null;
  /** Troca (ou remove) a foto do perfil público e manda a versão pequena aos contatos públicos. */
  setProfilePhoto: (p: ProfilePhoto | null) => void;
  /**
   * Por perto pela malha: perfis visíveis (só enquanto eu estou visível), pedidos recebidos, convite
   * pago e respostas. `null` antes das chaves.
   */
  nearby: {
    profiles: NearPeer[];
    requests: NearRequest[];
    /** Envia o convite com o texto. Lança erro em português (fora de alcance, 30 dias, texto). */
    invite: (profileId: string, text: string) => { fee: number; name: string };
    /** Aceitar devolve o id da conversa aberta; recusar e bloquear devolvem null. */
    answer: (id: string, a: 'accept' | 'decline' | 'block') => string | null;
    /** Denunciar perfil: some da lista de Por perto neste aparelho. */
    hide: (profileId: string) => void;
  } | null;
}

export interface Stats {
  metrics: ReturnType<Messenger['metrics']>;
  credits: { totals: ReturnType<CreditBook['totals']>; list: Credit[]; lots: Lot[] };
  relay: ReturnType<Messenger['relayStatus']>;
}

const Ctx = createContext<Messaging | null>(null);

/**
 * Mensagens reais: as conversas com `peer` são cifradas (Double Ratchet dentro do envelope selado),
 * vão para a fila do roteador e saem pelo transporte para cada vizinho conectado.
 * O estado das sessões é gravado ANTES de qualquer envio: depois de um travamento, uma chave de
 * mensagem nunca é reutilizada.
 */
export function MessagingProvider({ children }: { children: ReactNode }) {
  const { identities, node, nodeKeyFor } = useKeys();
  const { profile, onboarded, setOutbound, receive, setMsgStatus, addChat, chats, showToast, patchFile, setFileOps, patchChat, setIdentity, blocked, setPreviewMode, setSignals, setTyping } = useStore();
  const { relay: relayOn, relayPaused, storage } = useNetwork();
  const relay = relayOn && !relayPaused;
  const { priv, sto, bat, preview } = useSettings();
  // Pré-visualização "Nunca" também nos banners dentro do app (store.tsx, showToast).
  useEffect(() => { setPreviewMode(preview); }, [preview, setPreviewMode]);
  const transport = useMemo(getTransport, []);
  const [messenger, setMessenger] = useState<Messenger | null>(null);
  const [testDevice, setTestDevice] = useState<TestDevice | null>(null);
  const [inviteEpoch, setInviteEpoch] = useState(0);
  const [groupEpoch, setGroupEpoch] = useState(0);
  const [nearEpoch, setNearEpoch] = useState(0);
  const wallet = useWallet();
  const walletRef = useRef(wallet); walletRef.current = wallet;
  const rotationEpoch = useSessionRotationEpoch();
  const { setProfile, setVerified, addChat: addChatRestore } = useStore();
  const importRestored = useRef((d: Record<string, unknown>) => {
    if (d.profile && typeof d.profile === 'object') setProfile(d.profile as never);
    // Backups antigos podem trazer as conversas de exemplo: só as reais entram.
    for (const ch of cleanChats(d.chats)) addChatRestore(ch);
    for (const k of Object.keys(cleanVerified(d.verified, cleanChats(d.chats)))) setVerified(k, true);
  });

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

  const handlers = useRef({ receive, setMsgStatus, addChat, showToast, patchFile, patchChat, setTyping });
  handlers.current = { receive, setMsgStatus, addChat, showToast, patchFile, patchChat, setTyping };

  // Cria o mensageiro quando as chaves existem.
  useEffect(() => {
    if (!identities || !node || !onboarded) return;
    let saving: Promise<void> | null = null;
    /** Mensagem de sistema na conversa do grupo cuja chave foi trocada. */
    const rotatedNote = (g: GroupState, text: string) => {
      const cid = chatIdForGroup(g.id);
      if (chatsRef.current.some(x => x.id === cid)) handlers.current.receive(cid, { id: `sys-rk-${g.id.slice(0, 6)}-${g.keyV}`, from: 'sys', time: nowHM(), text });
    };
    // Backup restaurado por arquivo: importa perfil, conversas e verificações uma vez.
    const restored = takeRestoredData();
    const restoredState = typeof restored?.['msg.state'] === 'string' ? (restored['msg.state'] as string) : undefined;
    if (restored) importRestored.current(restored);
    const m = new Messenger({
      // Rotação pendente (migração/revogação) descarta as sessões; dados de um backup restaurado entram aqui.
      // Chave técnica do nó gira por dia (LNNP §12.1); recibos já emitidos guardam a chave deles.
      identities, node, nodeKeyFor: nodeKeyFor ?? undefined, relay, now, state: applySessionRotation(readPersisted<string>(STATE_KEY) ?? restoredState),
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
        inviteUsed: () => setInviteEpoch(e => e + 1),
        notice: (contactId, text, pub) => {
          try {
            const n = decodeRevocation(text);
            const c = mRef.current?.getContact(contactId);
            if (!verifyRevocation(n, (c?.pub ?? pub).signPk)) return;
            // Grupos em que sou admin e o contato participa trocam de chave (o aparelho perdido tinha a antiga).
            for (const g of mRef.current?.rotateForRevocation(contactId, n.sig) ?? []) {
              const who = c?.name || g.members.find(x => x.id === contactId)?.name || 'um membro';
              rotatedNote(g, `${who} revogou um aparelho. A chave do grupo foi trocada: o aparelho revogado não lê nada novo.`);
            }
            const cid = chatIdFor(contactId);
            if (!c || !chatsRef.current.some(x => x.id === cid)) return;
            handlers.current.receive(cid, { id: 'sys-rv-' + n.sig.slice(0, 12), from: 'sys', time: nowHM(), text: 'Este contato revogou um aparelho perdido ou comprometido. Confira o código de segurança pessoalmente antes de confiar em mensagens novas.' });
          } catch { /* aviso inválido: ignora */ }
        },
        // Foto do perfil público de um contato (já conferida: JPEG pequeno, só de contato público).
        peerPhoto: (contactId, b64) => {
          const cid = chatIdFor(contactId);
          if (chatsRef.current.some(c => c.id === cid)) handlers.current.patchChat(cid, { photo: b64 ? `data:image/jpeg;base64,${b64}` : undefined });
        },
        lotClosed: lot => handlers.current.showToast({ kind: 'wallet', icon: 'toll', coin: true, title: `Lote fechado · ${lot.lunes.toFixed(2).replace('.', ',')} LUNES`, body: `${lot.count} entregas comprovadas · liquidação simulada (sem Mainnet)`, go: () => router.push('/(tabs)/wallet') }),
        // Por perto: perfis, pedidos recebidos e convite meu aceito.
        nearbyChanged: () => setNearEpoch(e => e + 1),
        nearRequest: r => handlers.current.showToast({ kind: 'nearby', icon: 'waving_hand', title: `${r.name} quer conversar`, body: `+${fmtLunes(r.fee)} LUNES se você aceitar · expira em 24 h`, action: 'Ver',
          hidden: { title: 'Pedido de conversa', body: 'Abra Por perto para ver.' }, go: () => router.push('/nearby/requests') }),
        nearAccepted: (c, fee) => {
          walletRef.current.settleInvite(c.id);
          const cid = chatIdFor(c.id);
          if (!chatsRef.current.some(x => x.id === cid)) handlers.current.addChat(nearChat(c, privRef.current.temp, `${c.name || 'A pessoa'} aceitou seu convite de Por perto. A conversa é cifrada de ponta a ponta.`));
          handlers.current.showToast({ kind: 'nearby', icon: 'waving_hand', title: `${c.name || 'Alguém'} aceitou seu convite`, body: `A conversa abriu. ${fmtLunes(fee)} LUNES saem da reserva (registro local, sem Mainnet).`, action: 'Abrir',
            hidden: { title: 'Convite aceito', body: 'Abra Por perto para ver.' }, go: () => router.push({ pathname: '/chat/[id]', params: { id: cid } }) });
        },
        // Grupos: entrar, mudanças, remoção e mensagens.
        groupUpdated: (g, change) => {
          setGroupEpoch(e => e + 1);
          const cid = chatIdForGroup(g.id);
          const exists = chatsRef.current.some(c => c.id === cid);
          if (change === 'removed') {
            if (exists) handlers.current.receive(cid, { id: 'sys-rm-' + Date.now(), from: 'sys', time: nowHM(), text: g.kind === 'channel' ? 'Você não está mais neste canal.' : 'Você foi removido. A chave foi trocada: você não lê nada novo.' });
            return;
          }
          const myId = identities[g.via].id;
          if (!exists) handlers.current.addChat(chatForGroup(g, myId));
          else handlers.current.patchChat(cid, { name: g.name, initials: initialsOf(g.name), sub: groupSub(g), owner: canPost(g, myId) || undefined });
        },
        groupMessage: (gid, _fromId, fromName, x) => {
          const cid = chatIdForGroup(gid);
          if (!chatsRef.current.some(c => c.id === cid)) return;
          handlers.current.receive(cid, { id: 'in-' + gid.slice(0, 6) + '-' + x.msgId, from: 'them', sender: fromName, text: x.text, time: nowHM() });
        },
        joinRequest: (gid, who) => {
          setGroupEpoch(e => e + 1);
          handlers.current.showToast({ kind: 'group', icon: 'person_add', title: `${who.name || 'Alguém'} quer entrar`, body: 'Abra os dados do grupo para aprovar ou recusar.', action: 'Ver',
            hidden: { title: 'Pedido para entrar', body: 'Abra os dados do grupo para aprovar ou recusar.' }, go: () => router.push({ pathname: '/group/[id]', params: { id: chatIdForGroup(gid) } }) });
        },
        // Arquivos: progresso por bloco, entrega conferida e recebimento.
        fileProgress: (msgId, done, total, dir) => {
          const cid = dir === 'out' ? msgToChat.current.get(msgId) : msgToChat.current.get('in-' + msgId);
          if (cid) handlers.current.patchFile(cid, dir === 'out' ? msgId : 'in-' + msgId, { done: Math.min(done, total), blocks: total });
        },
        fileDelivered: msgId => {
          const cid = msgToChat.current.get(msgId);
          if (!cid) return;
          handlers.current.patchFile(cid, msgId, { state: 'verified' });
          handlers.current.setMsgStatus(cid, msgId, 'entregue');
        },
        fileOffered: (contactId, f) => {
          const cid = chatIdFor(contactId);
          if (!chatsRef.current.some(c => c.id === cid)) return;
          msgToChat.current.set('in-' + f.msgId, cid);
          const expiresAt = expiryOf({ sentAt: f.sentAt ?? now(), expireSec: f.expireSec });
          handlers.current.receive(cid, { id: 'in-' + f.msgId, from: 'them', text: '', time: nowHM(), ...(expiresAt ? { expiresAt } : {}),
            file: { name: f.name, mb: Math.max(0.1, Math.round((f.size / 1048576) * 10) / 10), blocks: f.blocks, icon: f.mime.startsWith('image/') ? 'image' : 'description', done: 0, state: 'sending', real: true, incoming: true, ...(f.held ? { held: true } : {}) } });
        },
        fileReceived: (contactId, f) => {
          const cid = msgToChat.current.get('in-' + f.msgId) ?? chatIdFor(contactId);
          const preview = f.mime.startsWith('image/') && f.data.length <= PREVIEW_MAX_BYTES ? `data:${f.mime};base64,${toBase64(f.data)}` : undefined;
          receivedFiles.set('in-' + f.msgId, f);
          handlers.current.patchFile(cid, 'in-' + f.msgId, { state: 'verified', done: f.blocks, preview });
        },
        // Confirmação de leitura do contato: só mensagens minhas daquela conversa.
        read: (contactId, ids) => {
          const cid = chatIdFor(contactId);
          const chat = chatsRef.current.find(c => c.id === cid);
          for (const id of ids) if (chat?.msgs?.some(x => x.id === id && x.from === 'me')) handlers.current.setMsgStatus(cid, id, 'lida');
        },
        typing: contactId => {
          const cid = chatIdFor(contactId);
          if (chatsRef.current.some(c => c.id === cid)) handlers.current.setTyping(cid);
        },
        status: (msgId, st) => {
          const cid = msgToChat.current.get(msgId) ?? chatsRef.current.find(c => c.peer && c.msgs?.some(x => x.id === msgId))?.id;
          if (cid) handlers.current.setMsgStatus(cid, msgId, st);
        },
        message: (contactId, x) => {
          const cid = chatIdFor(contactId);
          if (!chatsRef.current.some(c => c.id === cid)) return;
          const expiresAt = expiryOf(x);
          if (expiresAt && expiresAt <= Date.now()) return; // temporária que já venceu no caminho
          handlers.current.receive(cid, { id: 'in-' + x.msgId, from: 'them', text: x.text, time: nowHM(), ...(expiresAt ? { expiresAt } : {}) });
        },
        newContact: (c, x) => {
          const cid = chatIdFor(c.id);
          handlers.current.addChat(chatFor(c, true, privRef.current.temp));
          const expiresAt = expiryOf(x);
          if (expiresAt && expiresAt <= Date.now()) return;
          handlers.current.receive(cid, { id: 'in-' + x.msgId, from: 'them', text: x.text, time: nowHM(), ...(expiresAt ? { expiresAt } : {}) });
        },
      },
    });
    mRef.current = m;
    setMessenger(m);
    return () => { clearTimeout(saveTimer.current); void persistNow(STATE_KEY, m.export()).catch(() => {}); mRef.current = null; setMessenger(null); };
  }, [identities, node, onboarded, rotationEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisos de aparelho revogado: envia os pendentes aos contatos (pública e anônima, cada um pela sua).
  useEffect(() => {
    if (!messenger) return;
    const flush = () => {
      const list = pendingRevocations();
      if (!list.length || !identities) return;
      for (const n of list) {
        const via: IdentityKind = toHex(identities.public.signPk) === toHex(unb64url(n.by)) ? 'public' : 'anon';
        // Contatos e admins dos meus grupos recebem o aviso; nos grupos em que sou admin, a chave troca aqui.
        messenger.broadcastNotice(via, encodeRevocation(n));
        for (const g of messenger.rotateForRevocation(identities[via].id, n.sig, via)) {
          const cid = chatIdForGroup(g.id);
          if (chatsRef.current.some(x => x.id === cid)) handlers.current.receive(cid, { id: `sys-rk-${g.id.slice(0, 6)}-${g.keyV}`, from: 'sys', time: nowHM(), text: 'Você revogou um aparelho. A chave do grupo foi trocada: o aparelho revogado não lê nada novo.' });
        }
      }
      void markRevocationsSent(list.map(n => n.sig));
    };
    flush();
    const t = setInterval(flush, 30_000);
    return () => clearInterval(t);
  }, [messenger, identities]);

  useEffect(() => { if (messenger) { messenger.relay = relay; } }, [messenger, relay]);
  // Bloqueados (só contatos reais `piu:…`): o mensageiro descarta o que eles mandam.
  useEffect(() => { messenger?.setBlocked(blocked.map(b => b.id).filter(id => id.startsWith('piu:'))); }, [messenger, blocked]);
  // Limites do nó (Rede e Ajustes → Armazenamento / Bateria e limites) aplicados no roteador.
  useEffect(() => {
    if (!messenger) return;
    messenger.setPolicy({
      maxBytes: storage * 1024 * 1024,
      retentionSec: Number(sto.retention) * 3600,
      dailyBytes: bat.traffic * 1024 * 1024,
      bytesPerSec: bat.bw === 'max' ? Infinity : (Number(bat.bw) * 1_000_000) / 8,
      // "Personalizado" ainda não tem horário definido no design: vale como "Sempre".
      hours: bat.hours === 'night' ? 'night' : 'always',
    });
  }, [messenger, storage, sto.retention, bat.traffic, bat.bw, bat.hours]);
  // Armazenamento → "Baixar mídia automaticamente".
  useEffect(() => { messenger?.setAutoDownload(sto.auto); }, [messenger, sto.auto]);
  useEffect(() => { if (messenger) messenger.displayName = profile.idType === 'public' ? profile.name.trim() : ''; }, [messenger, profile]);
  // Por perto: anúncio de presença só enquanto visível (até o fim da 1 h), com o perfil PÚBLICO
  // (nome e foto pequena) e a minha taxa. Invisível = retirada do anúncio.
  const { visibleUntil, myFee } = wallet;
  useEffect(() => {
    messenger?.setNearby({ until: visibleUntil ? Math.floor(visibleUntil / 1000) : null, fee: myFee, name: profile.name.trim(), photo: profile.photoSmall });
    setNearEpoch(e => e + 1);
  }, [messenger, visibleUntil, myFee, profile.name, profile.photoSmall]);

  // Transporte → mensageiro.
  useEffect(() => {
    if (!messenger) return;
    const off = transport.subscribe(e => {
      // Classe do enlace pelo meio real do vizinho (Nearby/Wi-Fi Direct ou BLE).
      if (e.type === 'connected') messenger.peerConnected(e.id, (e.via ?? transport.kind) === 'nearby' ? 'direct' : 'ble');
      else if (e.type === 'disconnected' || e.type === 'peerLost') messenger.peerDisconnected(e.id);
      else if (e.type === 'envelope') messenger.receive(e.from, e.data);
      else if (e.type === 'state' && e.state === 'off') messenger.clearPeers(); // vizinhos somem com o transporte
    });
    const tick = setInterval(() => messenger.tick(), 5000);
    return () => { off(); clearInterval(tick); };
  }, [messenger, transport]);

  // Store → mensageiro (arquivos reais).
  useEffect(() => {
    if (!messenger) { setFileOps(null); return; }
    setFileOps({
      send: (chatId, peer, msgId, f, expireSec) => {
        try { msgToChat.current.set(msgId, chatId); return messenger.sendFile(peer, msgId, f, expireSec); } catch { return null; }
      },
      setPaused: (msgId, paused) => messenger.setFilePaused(msgId, paused),
      download: (peer, msgId) => messenger.downloadFile(peer, msgId),
    });
    return () => setFileOps(null);
  }, [messenger, setFileOps]);

  // Store → mensageiro (envio real).
  useEffect(() => {
    if (!messenger) { setOutbound(null); return; }
    setOutbound((chatId, peer, msgId, text, expireSec) => {
      try {
        // Responder aceita o pedido de conversa.
        const ct = messenger.getContact(peer);
        if (ct?.request) messenger.addContact(ct);
        msgToChat.current.set(msgId, chatId);
        if (peer.startsWith('group:')) messenger.sendGroupText(peer.slice(6), msgId, text);
        else messenger.sendText(peer, msgId, text, expireSec);
        return true;
      } catch { return false; }
    });
    return () => setOutbound(null);
  }, [messenger, setOutbound]);

  // Store → mensageiro: confirmação de leitura e "digitando…", só com o ajuste de Privacidade ligado.
  useEffect(() => {
    if (!messenger) { setSignals(null); return; }
    setSignals({
      read: (_chatId, peer, ids) => { if (privRef.current.read) messenger.sendRead(peer, ids); },
      typing: (_chatId, peer) => { if (privRef.current.typing) messenger.sendTyping(peer); },
    });
    return () => setSignals(null);
  }, [messenger, setSignals]);

  // Arquivo recebido de mensagem temporária que já sumiu da conversa: o conteúdo sai da memória também.
  useEffect(() => {
    if (!receivedFiles.size) return;
    const alive = new Set(chats.flatMap(c => (c.msgs ?? []).map(m => m.id)));
    for (const k of [...receivedFiles.keys()]) if (!alive.has(k)) receivedFiles.delete(k);
  }, [chats]);

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
    return () => { detach(); td.stop(); setTestDevice(null); };
  }, [transport, messenger]);

  const value = useMemo<Messaging>(() => ({
    ready: !!messenger,
    myCard: (kind, fresh) => (identities && messenger ? encodeCard(identities[kind], kind === 'public' ? profile.name : '', messenger.issueInvite(kind, fresh)) : ''),
    inviteEpoch,
    readCard: text => decodeCard(text, now()),
    addFromCard: card => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const via: IdentityKind = card.kind; // anônima conversa com anônima, pública com pública
      const contact: Contact = { id: card.id, via, pub: card.pub, name: card.name, invite: card.invite };
      messenger.addContact(contact);
      const cid = chatIdFor(card.id);
      addChat(chatFor(contact, false, priv.temp));
      // Contato público novo: recebe a foto do perfil público (o anônimo nunca recebe foto).
      if (via === 'public' && profile.photoSmall) messenger.sendProfilePhoto(profile.photoSmall, card.id);
      return cid;
    },
    setProfilePhoto: p => {
      setProfile({ photo: p?.full ?? null, photoSmall: p?.small ?? null });
      messenger?.sendProfilePhoto(p?.small ?? null);
    },
    contactKeys: chatId => {
      const peer = chats.find(c => c.id === chatId)?.peer;
      return (peer && messenger?.getContact(peer)?.pub) || null;
    },
    testDeviceCard: testDevice ? testDevice.card : null,
    contactsFor: via => (messenger ? messenger.listContacts().filter(c => c.via === via && !c.request).map(c => ({ id: c.id, name: c.name || c.id.slice(4, 8).toUpperCase() })) : []),
    groupOf: chatId => {
      const gid = chats.find(c => c.id === chatId)?.group;
      return (gid && messenger?.getGroup(gid)) || null;
    },
    myIdIn: via => identities?.[via].id ?? '',
    createGroup: o => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const g = messenger.createGroup(o);
      addChat(chatForGroup(g, identities![o.via].id));
      setIdentity(o.via);
      setGroupEpoch(e => e + 1);
      return chatIdForGroup(g.id);
    },
    groupOps: messenger ? {
      update: (gid, p) => { const g = messenger.updateGroup(gid, p); setGroupEpoch(e => e + 1); patchChat(chatIdForGroup(gid), { name: g.name, initials: initialsOf(g.name), sub: groupSub(g), owner: canPost(g, identities![g.via].id) || undefined }); return g; },
      addMembers: (gid, ids) => { const g = messenger.addMembers(gid, ids); setGroupEpoch(e => e + 1); patchChat(chatIdForGroup(gid), { sub: groupSub(g) }); return g; },
      remove: (gid, id) => { const g = messenger.removeMember(gid, id); setGroupEpoch(e => e + 1); patchChat(chatIdForGroup(gid), { sub: groupSub(g) }); return g; },
      setRole: (gid, id, role) => { const g = messenger.setRole(gid, id, role); setGroupEpoch(e => e + 1); return g; },
      leave: gid => { messenger.leaveGroup(gid); setGroupEpoch(e => e + 1); },
      answerJoin: (gid, id, ok) => { messenger.answerJoin(gid, id, ok); setGroupEpoch(e => e + 1); },
      pending: gid => messenger.pendingJoinsOf(gid),
      joinChild: (comId, childId) => messenger.requestJoinChild(comId, childId),
      isMember: gid => !!messenger.getGroup(gid),
      canInvite: gid => messenger.canInvite(gid),
      inviteLink: (gid, fresh) => {
        const g = messenger.getGroup(gid)!;
        const inv = messenger.groupInvite(gid, fresh);
        if (fresh) setGroupEpoch(e => e + 1);
        // O link leva o meu cartão (assinado, com o código do convite) e o id do grupo.
        const card = encodeCard(identities![g.via], g.via === 'public' ? profile.name : '', { code: inv.code, expiresAt: inv.expiresAt });
        return GROUP_LINK + b64url(new TextEncoder().encode(JSON.stringify({ c: card, g: g.id, n: g.name, k: g.kind })));
      },
    } : null,
    joinFromLink: text => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const t = text.trim();
      if (!t.startsWith(GROUP_LINK)) throw new Error('Isto não é um convite de grupo do Piu.');
      let j: { c?: string; g?: string; n?: string; k?: string };
      try { j = JSON.parse(new TextDecoder().decode(unb64url(t.slice(GROUP_LINK.length)))); } catch { throw new Error('Convite incompleto ou corrompido.'); }
      if (typeof j.c !== 'string' || typeof j.g !== 'string' || !/^[0-9a-f]{32}$/.test(j.g)) throw new Error('Convite incompleto ou corrompido.');
      const card = decodeCard(j.c, now()); // assinatura e validade (7 dias) conferidas aqui
      if (messenger.getGroup(j.g)) throw new Error('Você já participa deste grupo.');
      messenger.requestJoin({ id: card.id, via: card.kind, pub: card.pub, name: card.name }, j.g, card.invite);
      return String(j.n ?? 'grupo').slice(0, 60);
    },
    groupEpoch,
    nearby: messenger ? {
      profiles: messenger.nearbyProfiles(),
      requests: messenger.nearRequests(),
      invite: (profileId, text) => {
        const r = messenger.sendNearInvite(profileId, text);
        setNearEpoch(e => e + 1);
        return { fee: r.fee, name: r.name };
      },
      answer: (id, a) => {
        const r = messenger.answerNear(id, a);
        setNearEpoch(e => e + 1);
        if (!r) return null;
        const cid = chatIdFor(r.contact.id);
        if (!chats.some(x => x.id === cid)) addChat(nearChat(r.contact, priv.temp, 'Você aceitou o pedido de Por perto. A conversa é cifrada de ponta a ponta.', r.request.msg));
        setIdentity('public');
        wallet.recordEarned(r.request.name, r.request.fee);
        if (profile.photoSmall) messenger.sendProfilePhoto(profile.photoSmall, r.contact.id);
        return cid;
      },
      hide: id => messenger.hideNear(id),
    } : null,
    stats: () => (messenger ? { metrics: messenger.metrics(), credits: { totals: messenger.credits.totals(), list: messenger.credits.list().slice(0, 30), lots: messenger.credits.lots }, relay: messenger.relayStatus() } : null),
  }), [messenger, identities, profile.name, profile.photoSmall, setProfile, chats, addChat, testDevice, inviteEpoch, groupEpoch, nearEpoch, patchChat, setIdentity, priv.temp, wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Prefixo do link de convite de grupo, canal ou comunidade. */
export const GROUP_LINK = 'piug:';
export const chatIdForGroup = (gid: string) => 'g' + gid.slice(0, 20);
function groupSub(g: GroupState) {
  const n = memberCount(g);
  if (g.kind === 'channel') return `canal ${g.visibility === 'public' ? 'público' : g.visibility === 'secret' ? 'secreto' : 'privado'} · ${n} ${n === 1 ? 'inscrito' : 'inscritos'}`;
  if (g.kind === 'community') return `comunidade · ${(g.children ?? []).length} grupos e canais`;
  return `${n} ${n === 1 ? 'membro' : 'membros'} · chave v${g.keyV}`;
}
function chatForGroup(g: GroupState, myId: string): Chat {
  return {
    id: chatIdForGroup(g.id), group: g.id, ident: g.via, kind: g.kind === 'community' ? 'community' : g.kind, name: g.name, initials: initialsOf(g.name),
    time: nowHM(), unread: 0, owner: canPost(g, myId) || undefined,
    sub: groupSub(g), via: 'Por perto', viaIcon: 'hub',
    msgs: [{ id: 'sys-g-' + g.id.slice(0, 8), from: 'sys', time: nowHM(), text: `${g.kind === 'community' ? 'Comunidade cifrada' : g.kind === 'channel' ? 'Canal cifrado' : 'Grupo cifrado'} de ponta a ponta. Só quem está na lista de membros tem a chave.` }],
  };
}

/** Fim de uma mensagem temporária recebida (ms): prazo contado do envio (sem passar de agora). */
const expiryOf = (x: { sentAt: number; expireSec?: number }) => (x.expireSec ? (Math.min(x.sentAt, now()) + x.expireSec) * 1000 : undefined);

/** Conversa nova com um contato. `temp`: padrão de Privacidade para novas conversas. */
function chatFor(c: Contact, request: boolean, temp: TempMode): Chat {
  const name = c.name || (c.via === 'anon' ? 'Anônimo · ' + c.id.slice(4, 8).toUpperCase() : 'Contato · ' + c.id.slice(4, 8).toUpperCase());
  return {
    id: chatIdFor(c.id), peer: c.id, request, ident: c.via, kind: 'direct', name, initials: initialsOf(name), time: nowHM(), unread: 0, temp,
    sub: request ? 'pedido de conversa · confira o código' : 'cifrada de ponta a ponta', via: 'Por perto', viaIcon: 'bluetooth',
    msgs: [{ id: 'sys-' + c.id.slice(4, 12), from: 'sys', time: nowHM(), text: request
      ? 'Esta pessoa escreveu primeiro. Confira o código de segurança pessoalmente antes de confiar.'
      : 'Chaves trocadas. As mensagens são cifradas neste aparelho e só o contato consegue ler.' }],
  };
}

/** Conversa aberta por Por perto (sempre pela identidade pública). `first`: o texto do convite. */
function nearChat(c: Contact, temp: TempMode, note: string, first?: string): Chat {
  const base = chatFor(c, false, temp);
  return {
    ...base, sub: 'Por perto · cifrada de ponta a ponta', viaIcon: 'radar',
    msgs: [{ id: 'sys-near-' + c.id.slice(4, 12), from: 'sys', time: nowHM(), text: note },
      ...(first ? [{ id: 'in-near-' + c.id.slice(4, 12), from: 'them' as const, time: nowHM(), text: first }] : [])],
  };
}

export function useMessaging(): Messaging {
  const m = useContext(Ctx);
  if (!m) throw new Error('useMessaging fora de MessagingProvider');
  return m;
}

/**
 * Meu cartão (QR) para a identidade `kind`. Uso único: troca sozinho depois que alguém o usa.
 * Conferido a cada minuto (vale 24 h; troca quando faltar menos de 1 h). `bump` revoga e gera outro.
 */
export function useMyCard(kind: IdentityKind): [string, () => void] {
  const { myCard, ready, inviteEpoch } = useMessaging();
  const [tick, setTick] = useState(0);
  const fresh = useRef(false);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60_000); return () => clearInterval(t); }, []);
  const card = useMemo(() => {
    if (!ready) return '';
    const f = fresh.current; fresh.current = false;
    return myCard(kind, f);
  }, [ready, myCard, kind, tick, inviteEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
  return [card, () => { fresh.current = true; setTick(x => x + 1); }];
}

/** Métricas e créditos atualizados a cada `ms` (padrão 2 s), para as telas de diagnóstico e carteira. */
export function useStats(ms = 2000): Stats | null {
  const { stats } = useMessaging();
  const [v, setV] = useState<Stats | null>(() => stats());
  useEffect(() => {
    setV(stats());
    const t = setInterval(() => setV(stats()), ms);
    return () => clearInterval(t);
  }, [stats, ms]);
  return v;
}
