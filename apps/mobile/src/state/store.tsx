import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { seedChats } from '../data/seed';
import type { Chat, IdentityKind, Msg, Status } from '../data/types';
import { nowHM } from '../lib/text';

interface Profile { idType: IdentityKind; name: string }

interface Store {
  profile: Profile;
  setProfile: (p: Partial<Profile>) => void;
  onboarded: boolean;
  finishOnboarding: () => void;
  /** Identidade em uso na lista de conversas (listas separadas). */
  identity: IdentityKind;
  toggleIdentity: () => void;
  chats: Chat[];
  openChat: (id: string) => void;
  leaveChat: () => void;
  send: (chatId: string, text: string) => void;
  retry: (chatId: string, msgId: string) => void;
  typing: string | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>({ idType: 'public', name: 'Cardeal' });
  const [onboarded, setOnboarded] = useState(false);
  const [identity, setIdentity] = useState<IdentityKind>('public');
  const [chats, setChats] = useState<Chat[]>(seedChats);
  const [typing, setTyping] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const viewing = useRef<string | null>(null);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const setStatus = useCallback((cid: string, mid: string, status: Status) =>
    setChats(cs => cs.map(c => (c.id !== cid ? c : { ...c, msgs: (c.msgs ?? []).map(m => (m.id === mid ? { ...m, status } : m)) }))), []);
  const push = useCallback((cid: string, msg: Msg) =>
    setChats(cs => cs.map(c => (c.id !== cid ? c : {
      ...c, time: msg.time, msgs: [...(c.msgs ?? []), { ...msg, fresh: true }],
      unread: msg.from === 'me' || viewing.current === cid ? c.unread : c.unread + 1,
    }))), []);

  const store = useMemo<Store>(() => ({
    profile,
    setProfile: p => setProfileState(s => ({ ...s, ...p })),
    onboarded,
    finishOnboarding: () => { setIdentity(profile.idType); setOnboarded(true); },
    identity,
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
  }), [profile, onboarded, identity, chats, typing, push, setStatus]);

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
