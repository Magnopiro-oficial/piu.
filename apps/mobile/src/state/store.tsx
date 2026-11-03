import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chat, FileXfer, IdentityKind, Msg, Status, ToastData } from '../data/types';
import type { AnonAvatar } from '../lib/avatar';
import { cleanBlocked, cleanChats, cleanProfile, cleanVerified } from '../lib/demoCleanup';
import { notify } from '../lib/notifications';
import { forgetPersisted, readPersisted, usePersisted } from '../lib/persist';
import { nowHM } from '../lib/text';
import { MESSAGE_TTL_SEC } from '../messaging/messenger';

/** Operações de arquivo reais (MessagingProvider). */
export interface FileOps {
  send: (chatId: string, peer: string, msgId: string, f: { name: string; mime: string; data: Uint8Array }) => { blocks: number } | null;
  setPaused: (msgId: string, paused: boolean) => boolean;
}

interface Profile {
  idType: IdentityKind; name: string;
  /** Foto do perfil público: 256 px (data URI) e 96 px (base64, o que vai para os contatos públicos). */
  photo?: string | null; photoSmall?: string | null;
  /** Imagem da identidade anônima (gerada no aparelho; `null` = só o código da chave) e a rodada do sorteio. */
  anonAvatar?: AnonAvatar | null; anonSeed?: number;
}

/** Contato bloqueado (design: Privacidade → Contatos bloqueados). */
export interface Blocked {
  /** Id da chave do contato (`piu:…`). */
  id: string; chatId?: string; name: string; initials: string;
  at: number; how: 'pedido de conversa' | 'pela conversa'; reported: boolean;
}

interface Store {
  profile: Profile;
  setProfile: (p: Partial<Profile>) => void;
  blocked: Blocked[];
  block: (b: Omit<Blocked, 'at'>) => void;
  unblock: (id: string) => void;
  isBlocked: (id: string | undefined) => boolean;
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
  /** Contatos verificados pessoalmente pelo código de segurança. */
  verified: Record<string, boolean>;
  setVerified: (chatId: string, v: boolean) => void;
  /** Acrescenta uma conversa no topo (se ainda não existir). */
  addChat: (c: Chat) => void;
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

/**
 * Ao reabrir o app: só as conversas reais ficam (as de exemplo das versões antigas saem, ver
 * lib/demoCleanup.ts); mensagens que não chegaram à fila voltam para "na fila" e arquivos que não
 * terminaram ficam pausados e marcados como interrompidos (o conteúdo não é guardado).
 */
function reviveChats(saved: Chat[]): Chat[] {
  return cleanChats(saved).map(c => ({
    ...c,
    msgs: c.msgs?.map(m => {
      const { fresh: _fresh, ...rest } = m;
      const status: Status | undefined = m.status === 'criada' ? 'aguardando' : m.status;
      const file = m.file && m.file.state !== 'verified' ? { ...m.file, state: 'userPaused' as const, lost: true } : m.file;
      return { ...rest, status, file };
    }),
  }));
}
const TOAST_MS = 4500;

export function StoreProvider({ children }: { children: ReactNode }) {
  // Nada pré-preenchido: o nome é obrigatório para a identidade pública (onboarding).
  const [profile, setProfileState] = usePersisted<Profile>('profile', { idType: 'public', name: '' }, p => cleanProfile(p, readPersisted<boolean>('onboarded') === true));
  const [blocked, setBlocked] = usePersisted<Blocked[]>('blocked', [], b => cleanBlocked<Blocked>(b));
  const [onboarded, setOnboarded] = usePersisted('onboarded', false);
  const [identity, setIdentity] = usePersisted<IdentityKind>('identity', 'public');
  // A lista começa vazia: só entram conversas reais (QR, pedido de conversa, grupos, canais e comunidades).
  const [chats, setChats] = usePersisted<Chat[]>('chats', [], reviveChats);
  const [verified, setVerifiedMap] = usePersisted<Record<string, boolean>>('verified', {}, v => cleanVerified(v, cleanChats(readPersisted('chats'))));
  const [toast, setToast] = useState<Store['toast']>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
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
    clearTimeout(toastTimer.current);
  }, []);
  // Configurações do grupo de exemplo das versões antigas: os grupos reais guardam as suas no mensageiro.
  useEffect(() => { void forgetPersisted('group'); }, []);

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

  const store = useMemo<Store>(() => ({
    profile,
    setProfile: p => setProfileState(s => ({ ...s, ...p })),
    blocked,
    block: b => setBlocked(list => (list.some(x => x.id === b.id) ? list : [{ ...b, at: Date.now() }, ...list])),
    unblock: id => setBlocked(list => list.filter(x => x.id !== id)),
    isBlocked: id => !!id && blocked.some(x => x.id === id),
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
    // Cifrado na sessão (ou com a chave do grupo) e na fila do roteador; os estados seguintes vêm da rede.
    // Fora de alcance, fica na fila até surgir uma rota.
    send: (cid, text) => {
      const chat = chats.find(c => c.id === cid);
      const id = 'n' + Date.now();
      push(cid, { id, from: 'me', text, time: nowHM(), status: 'criada', at: Date.now() });
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const ok = !!to && (outbound.current?.(cid, to, id, text) ?? false);
      // Só passa para "na fila" se a rede ainda não avançou o estado (o vizinho pode já ter recebido).
      later(ok ? 300 : 0, () => patchMsg(cid, id, m => (m.status === 'criada' ? { status: ok ? 'aguardando' : 'falha' } : {})));
      if (chat?.request) setChats(cs => cs.map(c => (c.id === cid ? { ...c, request: false } : c)));
    },
    retry: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const m = chat?.msgs?.find(x => x.id === mid);
      const ok = !!to && !!m && (outbound.current?.(cid, to, mid, m.text) ?? false);
      setStatus(cid, mid, ok ? 'aguardando' : 'falha');
    },
    verified,
    setVerified: (id, v) => setVerifiedMap(m => ({ ...m, [id]: v })),
    addChat: ch => setChats(cs => (cs.some(x => x.id === ch.id) ? cs : [ch, ...cs])),
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
      const f = chats.find(c => c.id === cid)?.msgs?.find(m => m.id === mid)?.file;
      if (!f) return;
      const pause = f.state !== 'userPaused';
      if (fileOps.current?.setPaused(mid, pause)) patchFile(cid, mid, { state: pause ? 'userPaused' : 'resuming' });
      else patchFile(cid, mid, { lost: true });
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
        showToast({ kind: 'msg', icon: 'timer_off', title: 'Mensagem expirou', body: `“${quote}” não encontrou rota em ${MESSAGE_TTL_SEC / 3600} h.`, action: 'Reenviar',
          go: () => { open(); retryRef.current(cid, mid); } });
      }
    },
    setNotifyFilter: fn => { notifyFilter.current = fn; },
    patchChat: (cid, p) => setChats(cs => cs.map(c => (c.id === cid ? { ...c, ...p } : c))),
    removeChat: cid => setChats(cs => cs.filter(c => c.id !== cid)),
    toast,
    showToast,
    dismissToast,
  }), [profile, blocked, onboarded, identity, chats, verified, toast, push, setStatus, patchFile, showToast, dismissToast]);

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
