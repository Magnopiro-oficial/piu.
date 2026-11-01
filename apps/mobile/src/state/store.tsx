import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CHANNEL_TYPES, seedChats, seedMembers } from '../data/seed';
import type { ChannelType, Chat, FileXfer, IdentityKind, Member, Msg, Status, ToastData } from '../data/types';
import { initialsOf, nowHM } from '../lib/text';

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
  sendFile: (chatId: string, kind: 'image' | 'doc') => void;
  toggleFilePause: (chatId: string, msgId: string) => void;
  toast: (ToastData & { seq: number }) | null;
  showToast: (t: ToastData) => void;
  dismissToast: () => void;
}

const Ctx = createContext<Store | null>(null);

const FILES: Record<'image' | 'doc', Omit<FileXfer, 'done' | 'state'>> = {
  image: { name: 'mutirao-galpao.jpg', mb: 2.4, blocks: 24, icon: 'image' },
  doc: { name: 'mapa-da-trilha.pdf', mb: 4.2, blocks: 42, icon: 'description' },
};
const BLOCK_MS = 170;
const TOAST_MS = 4500;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>({ idType: 'public', name: 'Cardeal' });
  const [onboarded, setOnboarded] = useState(false);
  const [identity, setIdentity] = useState<IdentityKind>('public');
  const [chats, setChats] = useState<Chat[]>(seedChats);
  const [typing, setTyping] = useState<string | null>(null);
  const [verified, setVerifiedMap] = useState<Record<string, boolean>>({});
  const [group, setGroupState] = useState<GroupSettings>({ members: seedMembers(), keyV: 4, approve: true, send: 'all', inv: 'admins' });
  const [toast, setToast] = useState<Store['toast']>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fileTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastSeq = useRef(0);
  const viewing = useRef<string | null>(null);
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
    clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ ...t, seq: toastSeq.current });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  const dismissToast = useCallback(() => { clearTimeout(toastTimer.current); setToast(null); }, []);

  const push = useCallback((cid: string, msg: Msg) => {
    const viewingIt = viewing.current === cid;
    if (msg.from === 'them' && !viewingIt) {
      const c = chatsRef.current.find(x => x.id === cid);
      if (c) showToast({ av: c.initials, title: c.name, body: msg.text });
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
      push(cid, { id, from: 'me', text, time: nowHM(), status: 'criada' });
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
    sendFile: (cid, kind) => {
      const id = 'f' + Date.now();
      push(cid, { id, from: 'me', text: '', time: nowHM(), status: 'encaminhada', file: { ...FILES[kind], done: 0, state: 'sending' } });
      startFile(cid, id);
    },
    toggleFilePause: (cid, mid) => patchFile(cid, mid, { state: chats.find(c => c.id === cid)?.msgs?.find(m => m.id === mid)?.file?.state === 'userPaused' ? 'resuming' : 'userPaused' }),
    toast,
    showToast,
    dismissToast,
  }), [profile, onboarded, identity, chats, typing, verified, group, toast, push, setStatus, patchFile, startFile, showToast, dismissToast]);

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
