import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CHANNEL_TYPES, seedChats, seedMembers } from '../data/seed';
import type { ChannelType, Chat, FileXfer, IdentityKind, Member, Msg, Status, ToastData } from '../data/types';
import { notify } from '../lib/notifications';
import { usePersisted } from '../lib/persist';
import { initialsOf, nowHM } from '../lib/text';

/** Operações de arquivo reais (MessagingProvider). */
export interface FileOps {
  send: (chatId: string, peer: string, msgId: string, f: { name: string; mime: string; data: Uint8Array }) => { blocks: number } | null;
  setPaused: (msgId: string, paused: boolean) => boolean;
}

interface Profile { idType: IdentityKind; name: string }

export interface GroupSettings { members: Member[]; keyV: number; approve: boolean; send: 'all' | 'admins'; inv: 'admins' | 'all' }

export interface NewChannel { name: string; desc: string; type: ChannelType; post: 'admins' | 'mods'; ident: IdentityKind }

interface Store {
  profile: Profile;
  setProfile: (p: Partial<Profile>) => void;
  onboarded: boolean;
  finishOnboarding: () => void;
  /** Identidade em uso na lista de conversas (listas separadas). */
  identity: IdentityKind;
  setIdentity: (i: IdentityKind) => void;
  toggleIdentity: () => void;
  chats: Chat[];
  openChat: (id: string) => void;
  leaveChat: () => void;
  send: (chatId: string, text: string) => void;
  retry: (chatId: string, msgId: string) => void;
  typing: string | null;
  /** Contatos verificados pessoalmente pelo código de segurança. */
  verified: Record<string, boolean>;
  setVerified: (chatId: string, v: boolean) => void;
  group: GroupSettings;
  setGroup: (p: Partial<GroupSettings>) => void;
  /** Remove o membro e troca a chave do grupo (v → v+1). */
  removeMember: (memberId: string) => void;
  createChannel: (c: NewChannel) => string;
  /** Acrescenta uma conversa no topo (se ainda não existir). */
  addChat: (c: Chat) => void;
  sendFile: (chatId: string, kind: 'image' | 'doc') => void;
  /** Conversa real: envia o arquivo escolhido pelo protocolo. */
  sendRealFile: (chatId: string, f: { name: string; mime: string; data: Uint8Array; preview?: string }) => void;
  setFileOps: (ops: FileOps | null) => void;
  patchFile: (chatId: string, msgId: string, p: Partial<FileXfer>) => void;
  /** Camada de mensagens real (MessagingProvider): envia cifrado para contatos com `peer`. */
  setOutbound: (fn: ((chatId: string, peer: string, msgId: string, text: string) => boolean) | null) => void;
  /** Mensagem real recebida (já decifrada e conferida). */
  receive: (chatId: string, msg: Msg) => void;
  setMsgStatus: (chatId: string, msgId: string, status: Status) => void;
  /** Filtro dos banners pelos ajustes de notificação (definido por NotifyBridge). */
  setNotifyFilter: (fn: ((t: ToastData) => boolean) | null) => void;
  patchChat: (chatId: string, p: Partial<Chat>) => void;
  removeChat: (chatId: string) => void;
  toggleFilePause: (chatId: string, msgId: string) => void;
  toast: (ToastData & { seq: number; leaving?: boolean }) | null;
  showToast: (t: ToastData) => void;
  dismissToast: () => void;
}

const Ctx = createContext<Store | null>(null);

const FILES: Record<'image' | 'doc', Omit<FileXfer, 'done' | 'state'>> = {
  image: { name: 'mutirao-galpao.jpg', mb: 2.4, blocks: 24, icon: 'image' },
  doc: { name: 'mapa-da-trilha.pdf', mb: 4.2, blocks: 42, icon: 'description' },
};
const BLOCK_MS = 170;

/**
 * Ao reabrir o app, os temporizadores da simulação não existem mais:
 * mensagens em trânsito voltam para a fila e envios de arquivo ficam pausados (a pessoa retoma).
 */
function reviveChats(saved: Chat[]): Chat[] {
  return saved.map(c => ({
    ...c,
    msgs: c.msgs?.map(m => {
      const { fresh: _fresh, ...rest } = m;
      const status: Status | undefined = m.status === 'criada' || (m.status === 'encaminhada' && !m.file && !c.peer) ? 'aguardando' : m.status;
      const file = m.file && m.file.state !== 'verified' ? { ...m.file, state: 'userPaused' as const, lost: m.file.real ? true : m.file.lost } : m.file;
      return { ...rest, status, file };
    }),
  }));
}
const TOAST_MS = 4500;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = usePersisted<Profile>('profile', { idType: 'public', name: 'Cardeal' });
  const [onboarded, setOnboarded] = usePersisted('onboarded', false);
  const [identity, setIdentity] = usePersisted<IdentityKind>('identity', 'public');
  const [chats, setChats] = usePersisted<Chat[]>('chats', seedChats, reviveChats);
  const [typing, setTyping] = useState<string | null>(null);
  const [verified, setVerifiedMap] = usePersisted<Record<string, boolean>>('verified', {});
  const [group, setGroupState] = usePersisted<GroupSettings>('group', () => ({ members: seedMembers(), keyV: 4, approve: true, send: 'all', inv: 'admins' }));
  const [toast, setToast] = useState<Store['toast']>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fileTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastSeq = useRef(0);
  const viewing = useRef<string | null>(null);
  const retryRef = useRef<(cid: string, mid: string) => void>(() => {});
  const notifyFilter = useRef<((t: ToastData) => boolean) | null>(null);
  const fileOps = useRef<FileOps | null>(null);
  const outbound = useRef<((chatId: string, peer: string, msgId: string, text: string) => boolean) | null>(null);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    Object.values(fileTimers.current).forEach(clearInterval);
    clearTimeout(toastTimer.current);
  }, []);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const patchMsg = useCallback((cid: string, mid: string, p: (m: Msg) => Partial<Msg>) =>
    setChats(cs => cs.map(c => (c.id !== cid ? c : { ...c, msgs: (c.msgs ?? []).map(m => (m.id === mid ? { ...m, ...p(m) } : m)) }))), []);
  const setStatus = useCallback((cid: string, mid: string, status: Status) => patchMsg(cid, mid, () => ({ status })), [patchMsg]);
  const patchFile = useCallback((cid: string, mid: string, p: Partial<FileXfer>) =>
    patchMsg(cid, mid, m => (m.file ? { file: { ...m.file, ...p } } : {})), [patchMsg]);

  const showToast = useCallback((t: ToastData) => {
    if (t.kind && notifyFilter.current && !notifyFilter.current(t)) return;
    clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ ...t, seq: toastSeq.current });
    toastTimer.current = setTimeout(() => leave(), TOAST_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Sai em 300 ms (sobe e some), como no design. */
  const leave = () => {
    clearTimeout(toastTimer.current);
    setToast(t => (t ? { ...t, leaving: true } : t));
    toastTimer.current = setTimeout(() => setToast(null), 300);
  };
  const dismissToast = useCallback(leave, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((cid: string, msg: Msg) => {
    const viewingIt = viewing.current === cid;
    if (msg.from === 'them' && !viewingIt) {
      const c = chatsRef.current.find(x => x.id === cid);
      // Com o app em segundo plano, vira notificação do sistema (respeita prévia, tipos e silêncio).
      if (c && !c.muted) notify({ kind: c.kind === 'group' ? 'group' : c.kind === 'channel' || c.kind === 'community' ? 'channel' : 'msg', title: c.name, body: msg.text || (msg.file ? `Arquivo: ${msg.file.name}` : ''), data: { href: `/chat/${cid}` } });
      if (c && !c.muted) showToast({ kind: c.kind === 'group' ? 'group' : c.kind === 'channel' ? 'channel' : 'msg', av: c.initials, title: c.name, body: msg.text, go: () => router.push({ pathname: '/chat/[id]', params: { id: cid } }) });
    }
    setChats(cs => cs.map(c => (c.id !== cid ? c : {
      ...c, time: msg.time, msgs: [...(c.msgs ?? []), { ...msg, fresh: true }],
      unread: msg.from === 'me' || viewingIt ? c.unread : c.unread + 1,
    })));
  }, [showToast]);

  /** Motor do envio em blocos: um bloco a cada 170 ms; aos 45% a rota vira LoRa e o envio pausa sozinho. */
  const startFile = useCallback((cid: string, mid: string) => {
    clearInterval(fileTimers.current[mid]);
    fileTimers.current[mid] = setInterval(() => {
      const f = chatsRef.current.find(x => x.id === cid)?.msgs?.find(x => x.id === mid)?.file;
      if (!f) { clearInterval(fileTimers.current[mid]); return; }
      if (f.state === 'userPaused' || f.state === 'paused' || f.state === 'verified') return;
      const done = f.done + 1;
      const pauseAt = Math.floor(f.blocks * 0.45);
      if (!f.pausedOnce && done === pauseAt) {
        patchFile(cid, mid, { done, state: 'paused', pausedOnce: true });
        later(2300, () => patchFile(cid, mid, { state: 'resuming' }));
        return;
      }
      if (done >= f.blocks) {
        clearInterval(fileTimers.current[mid]);
        patchFile(cid, mid, { done: f.blocks, state: 'verified' });
        setStatus(cid, mid, 'entregue');
        return;
      }
      patchFile(cid, mid, { done, state: f.state === 'resuming' && done > pauseAt + 2 ? 'sending' : f.state });
    }, BLOCK_MS);
  }, [patchFile, setStatus]);

  const store = useMemo<Store>(() => ({
    profile,
    setProfile: p => setProfileState(s => ({ ...s, ...p })),
    onboarded,
    finishOnboarding: () => { setIdentity(profile.idType); setOnboarded(true); },
    identity,
    setIdentity,
    toggleIdentity: () => setIdentity(i => (i === 'public' ? 'anon' : 'public')),
    chats,
    openChat: id => {
      viewing.current = id;
      setChats(cs => cs.map(c => (c.id === id ? { ...c, unread: 0 } : c)));
    },
    leaveChat: () => { viewing.current = null; },
    // Estados (seção 3.1): criada → aguardando (na fila) → encaminhada → entregue.
    // Fora de alcance, fica na fila até surgir uma rota.
    send: (cid, text) => {
      const chat = chats.find(c => c.id === cid);
      const id = 'n' + Date.now();
      push(cid, { id, from: 'me', text, time: nowHM(), status: 'criada', at: Date.now() });
      if (chat?.peer || chat?.group) {
        // Real: cifrado na sessão (ou com a chave do grupo) e na fila do roteador; os estados seguintes vêm da rede.
        const ok = outbound.current?.(cid, chat.peer ?? 'group:' + chat.group, id, text) ?? false;
        // Só passa para "na fila" se a rede ainda não avançou o estado (o vizinho pode já ter recebido).
        later(ok ? 300 : 0, () => patchMsg(cid, id, m => (m.status === 'criada' ? { status: ok ? 'aguardando' : 'falha' } : {})));
        if (chat.request) setChats(cs => cs.map(c => (c.id === cid ? { ...c, request: false } : c)));
        return;
      }
      later(600, () => setStatus(cid, id, 'aguardando'));
      if (chat?.offline) return;
      later(1700, () => setStatus(cid, id, 'encaminhada'));
      later(3000, () => setStatus(cid, id, 'entregue'));
      if (cid === 'marina') {
        later(2300, () => setTyping('marina'));
        later(4600, () => { setTyping(null); push(cid, { id: 'r' + Date.now(), from: 'them', text: 'Combinado! Te vejo lá.', time: nowHM() }); });
      }
    },
    retry: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      if (chat?.peer || chat?.group) {
        const m = chat.msgs?.find(x => x.id === mid);
        const ok = !!m && (outbound.current?.(cid, chat.peer ?? 'group:' + chat.group, mid, m.text) ?? false);
        setStatus(cid, mid, ok ? 'aguardando' : 'falha');
        return;
      }
      setStatus(cid, mid, 'aguardando');
      if (chat?.offline) return;
      later(1400, () => setStatus(cid, mid, 'encaminhada'));
      later(2800, () => setStatus(cid, mid, 'entregue'));
    },
    typing,
    verified,
    setVerified: (id, v) => setVerifiedMap(m => ({ ...m, [id]: v })),
    group,
    setGroup: p => setGroupState(g => ({ ...g, ...p })),
    removeMember: memberId => {
      const t = group.members.find(m => m.id === memberId);
      if (!t) return;
      const v = group.keyV + 1;
      setGroupState(g => ({ ...g, members: g.members.filter(m => m.id !== memberId), keyV: v }));
      push('mutirao', { id: 'sys' + Date.now(), from: 'sys', time: nowHM(), text: `${t.name} foi removido. Chave do grupo trocada para a v${v}: ele não lê novas mensagens.` });
      showToast({ icon: 'key', title: `Chave do grupo trocada · v${v}`, body: `${t.name} não recebe nem lê novas mensagens.` });
    },
    createChannel: c => {
      const t = CHANNEL_TYPES.find(x => x[0] === c.type)!;
      const id = 'ch' + Date.now();
      const kind = t[2].toLowerCase();
      const ch: Chat = {
        id, ident: c.ident, kind: 'channel', owner: true, name: c.name.trim(), initials: initialsOf(c.name), time: nowHM(), unread: 0, inv: true,
        sub: `canal ${kind} · 1 inscrito`, via: 'Wi-Fi Mesh · por perto', viaIcon: 'hub',
        msgs: [{ id: 'cs' + id, from: 'sys', time: nowHM(), fresh: true, text: `Canal ${kind} criado. ${t[3]}` }],
      };
      setChats(cs => [ch, ...cs]);
      setIdentity(c.ident);
      return id;
    },
    addChat: ch => setChats(cs => (cs.some(x => x.id === ch.id) ? cs : [ch, ...cs])),
    sendFile: (cid, kind) => {
      const id = 'f' + Date.now();
      push(cid, { id, from: 'me', text: '', time: nowHM(), status: 'encaminhada', file: { ...FILES[kind], done: 0, state: 'sending' } });
      startFile(cid, id);
    },
    sendRealFile: (cid, f) => {
      const chat = chats.find(c => c.id === cid);
      if (!chat?.peer) return;
      const id = 'f' + Date.now();
      const icon = f.mime.startsWith('image/') ? 'image' as const : 'description' as const;
      const mb = Math.max(0.1, Math.round((f.data.length / 1048576) * 10) / 10);
      // O balão entra antes do envio: o progresso pode começar a chegar na hora.
      push(cid, { id, from: 'me', text: '', time: nowHM(), status: 'aguardando', at: Date.now(),
        file: { name: f.name, mb, blocks: Math.max(1, Math.ceil(f.data.length / (12 * 1024))), icon, done: 0, state: 'sending', real: true, preview: f.preview } });
      const r = fileOps.current?.send(cid, chat.peer, id, f) ?? null;
      if (!r) setStatus(cid, id, 'falha');
    },
    setFileOps: ops => { fileOps.current = ops; },
    patchFile,
    toggleFilePause: (cid, mid) => {
      const real = chats.find(c => c.id === cid)?.msgs?.find(m => m.id === mid)?.file;
      if (real?.real) {
        const pause = real.state !== 'userPaused';
        if (fileOps.current?.setPaused(mid, pause)) patchFile(cid, mid, { state: pause ? 'userPaused' : 'resuming' });
        else patchFile(cid, mid, { lost: true });
        return;
      }
      const paused = chats.find(c => c.id === cid)?.msgs?.find(m => m.id === mid)?.file?.state === 'userPaused';
      patchFile(cid, mid, { state: paused ? 'resuming' : 'userPaused' });
      // Depois de reabrir o app o motor do envio não existe mais: retomar o reinicia.
      if (paused && !fileTimers.current[mid]) startFile(cid, mid);
    },
    setOutbound: fn => { outbound.current = fn; },
    receive: (cid, msg) => push(cid, msg),
    setMsgStatus: (cid, mid, st) => {
      setStatus(cid, mid, st);
      const c = chatsRef.current.find(x => x.id === cid);
      const m = c?.msgs?.find(x => x.id === mid);
      if (!c || !m || m.from !== 'me' || c.muted || viewing.current === cid) return;
      const open = () => router.push({ pathname: '/chat/[id]', params: { id: cid } });
      const quote = m.text.length > 40 ? m.text.slice(0, 39) + '…' : m.text;
      if (st === 'entregue' && m.at && Date.now() - m.at > 60_000) {
        const min = Math.round((Date.now() - m.at) / 60_000);
        const wait = min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`;
        showToast({ kind: 'msg', icon: 'done_all', title: `Entregue a ${c.name}`, body: `Uma rota surgiu depois de ${wait} na fila.`, go: open });
      }
      if (st === 'expirada') {
        showToast({ kind: 'msg', icon: 'timer_off', title: 'Mensagem expirou', body: `“${quote}” não encontrou rota a tempo.`, action: 'Reenviar',
          go: () => { open(); retryRef.current(cid, mid); } });
      }
    },
    setNotifyFilter: fn => { notifyFilter.current = fn; },
    patchChat: (cid, p) => setChats(cs => cs.map(c => (c.id === cid ? { ...c, ...p } : c))),
    removeChat: cid => setChats(cs => cs.filter(c => c.id !== cid)),
    toast,
    showToast,
    dismissToast,
  }), [profile, onboarded, identity, chats, typing, verified, group, toast, push, setStatus, patchFile, startFile, showToast, dismissToast]);

  retryRef.current = store.retry;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora de StoreProvider');
  return s;
}

/** Marca qual conversa está aberta (para não contar não lidas nela). */
export function useViewingChat(id: string | null) {
  const { openChat, leaveChat } = useStore();
  useEffect(() => {
    if (!id) return;
    openChat(id);
    return leaveChat;
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
}
