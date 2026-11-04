import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chat, FileXfer, IdentityKind, Msg, Status, ToastData } from '../data/types';
import type { Preview } from '../data/settings';
import type { AnonAvatar } from '../lib/avatar';
import { cleanBlocked, cleanChats, cleanProfile, cleanVerified } from '../lib/demoCleanup';
import { chirpInApp, notify } from '../lib/notifications';
import { bannerFor } from '../lib/preview';
import { forgetPersisted, readPersisted, usePersisted } from '../lib/persist';
import { isStatusBack, tempSeconds } from '../lib/status';
import { msgSummary } from '../lib/chatCore';
import { stripPreviews } from '../lib/storageCore';
import { nowHM } from '../lib/text';
import { MESSAGE_TTL_SEC } from '../messaging/messenger';

/** Operações de arquivo reais (MessagingProvider). */
export interface FileOps {
  send: (chatId: string, peer: string, msgId: string, f: { name: string; mime: string; data: Uint8Array }, expireSec?: number) => { blocks: number } | null;
  setPaused: (msgId: string, paused: boolean) => boolean;
  /** Arquivo recebido que esperava "Baixar": pede os blocos ao contato. */
  download: (peer: string, msgId: string) => boolean;
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
  /** `loc`: localização em texto curto (`text` = nome do lugar ou as coordenadas). */
  send: (chatId: string, text: string, loc?: { lat: number; lon: number }) => void;
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
  /** Camada de mensagens real (MessagingProvider): envia cifrado para contatos com `peer`. `expireSec`: temporária. */
  setOutbound: (fn: Outbound | null) => void;
  /** Confirmação de leitura e "digitando…" (MessagingProvider decide pelos ajustes de Privacidade). */
  setSignals: (s: Signals | null) => void;
  /** Conversas em que o contato está digitando agora. */
  typing: Record<string, boolean>;
  /** O contato da conversa começou a digitar (some sozinho em alguns segundos). */
  setTyping: (chatId: string) => void;
  /** Estou digitando nesta conversa. */
  notifyTyping: (chatId: string) => void;
  /** Mensagem real recebida (já decifrada e conferida). */
  /** `quiet`: entra na conversa sem banner nem notificação (ex.: grupo movimentado sem menção). */
  receive: (chatId: string, msg: Msg, opts?: { quiet?: boolean }) => void;
  setMsgStatus: (chatId: string, msgId: string, status: Status) => void;
  /** Filtro dos banners pelos ajustes de notificação (definido por NotifyBridge). */
  setNotifyFilter: (fn: ((t: ToastData) => boolean) | null) => void;
  /** Pré-visualização escolhida em Notificações (MessagingProvider lê os ajustes e repassa aqui). */
  setPreviewMode: (p: Preview) => void;
  patchChat: (chatId: string, p: Partial<Chat>) => void;
  removeChat: (chatId: string) => void;
  /** "Limpar cache de mídia": apaga as prévias embutidas nas conversas. Devolve os bytes liberados. */
  purgeMediaPreviews: () => number;
  toggleFilePause: (chatId: string, msgId: string) => void;
  toast: (ToastData & { seq: number; leaving?: boolean }) | null;
  showToast: (t: ToastData) => void;
  dismissToast: () => void;
}

type Outbound = (chatId: string, peer: string, msgId: string, text: string, expireSec?: number, loc?: { lat: number; lon: number }) => boolean;
export interface Signals { read: (chatId: string, peer: string, msgIds: string[]) => void; typing: (chatId: string, peer: string) => void }

const Ctx = createContext<Store | null>(null);
/** "digitando…" some se nada novo chegar neste tempo. */
const TYPING_MS = 6000;
/** Remoção das mensagens temporárias vencidas. */
const SWEEP_MS = 30_000;
const dropExpired = (msgs: Msg[] | undefined, now: number) => (msgs?.some(m => m.expiresAt && m.expiresAt <= now) ? msgs.filter(m => !m.expiresAt || m.expiresAt > now) : msgs);

/**
 * Ao reabrir o app: só as conversas reais ficam (as de exemplo das versões antigas saem, ver
 * lib/demoCleanup.ts); mensagens que não chegaram à fila voltam para "na fila" e arquivos que não
 * terminaram ficam pausados e marcados como interrompidos (o conteúdo não é guardado).
 */
function reviveChats(saved: Chat[]): Chat[] {
  const now = Date.now();
  // `via`, `viaIcon`, `route` e `priority` eram fixos nas versões antigas: a rota real fica à parte (lib/routeCore.ts).
  return cleanChats(saved).map(({ via: _v, viaIcon: _vi, route: _r, priority: _p, ...c }: Chat & { via?: unknown; viaIcon?: unknown; route?: unknown; priority?: unknown }) => ({
    ...c,
    msgs: dropExpired(c.msgs, now)?.map(m => {
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
  const previewMode = useRef<Preview>('always');
  const fileOps = useRef<FileOps | null>(null);
  const outbound = useRef<Outbound | null>(null);
  const signals = useRef<Signals | null>(null);
  const [typing, setTypingMap] = useState<Record<string, boolean>>({});
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    clearTimeout(toastTimer.current);
    typingTimers.current.forEach(clearTimeout);
  }, []);
  // Mensagens temporárias: somem deste aparelho no prazo (o contato apaga as dele do mesmo jeito).
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      if (!chatsRef.current.some(c => c.msgs?.some(m => m.expiresAt && m.expiresAt <= now))) return;
      setChats(cs => cs.map(c => { const msgs = dropExpired(c.msgs, now); return msgs === c.msgs ? c : { ...c, msgs }; }));
    };
    sweep();
    const t = setInterval(sweep, SWEEP_MS);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stopTyping = useCallback((cid: string) => {
    clearTimeout(typingTimers.current.get(cid));
    typingTimers.current.delete(cid);
    setTypingMap(t => { if (!t[cid]) return t; const { [cid]: _x, ...rest } = t; return rest; });
  }, []);
  const setTyping = useCallback((cid: string) => {
    clearTimeout(typingTimers.current.get(cid));
    typingTimers.current.set(cid, setTimeout(() => stopTyping(cid), TYPING_MS));
    setTypingMap(t => (t[cid] ? t : { ...t, [cid]: true }));
  }, [stopTyping]);
  /** Confirma a leitura das mensagens recebidas de um contato (quem decide se sai é `signals`). */
  const markRead = useCallback((cid: string, ids?: string[]) => {
    const c = chatsRef.current.find(x => x.id === cid);
    if (!c?.peer || !signals.current) return;
    const list = ids ?? (c.msgs ?? []).filter(m => m.from === 'them' && m.id.startsWith('in-')).slice(-50).map(m => m.id);
    const remote = list.map(id => id.replace(/^in-/, ''));
    if (remote.length) signals.current.read(cid, c.peer, remote);
  }, []);
  // Configurações do grupo de exemplo das versões antigas: os grupos reais guardam as suas no mensageiro.
  useEffect(() => { void forgetPersisted('group'); }, []);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const patchMsg = useCallback((cid: string, mid: string, p: (m: Msg) => Partial<Msg>) =>
    setChats(cs => cs.map(c => (c.id !== cid ? c : { ...c, msgs: (c.msgs ?? []).map(m => (m.id === mid ? { ...m, ...p(m) } : m)) }))), []);
  // Um estado não volta atrás (ex.: a confirmação de entrega atrasada não desfaz "lida").
  const setStatus = useCallback((cid: string, mid: string, status: Status) => patchMsg(cid, mid, m => (isStatusBack(m.status, status) ? {} : { status })), [patchMsg]);
  const patchFile = useCallback((cid: string, mid: string, p: Partial<FileXfer>) =>
    patchMsg(cid, mid, m => (m.file ? { file: { ...m.file, ...p } } : {})), [patchMsg]);

  /**
   * Banner dentro do app, já conforme a pré-visualização (lib/preview.ts). Banner com `kind` também
   * vira notificação do sistema quando o app não está em primeiro plano (`notify` confere tipos
   * ligados, silêncio e prévia, e não dispara com o app aberto).
   */
  const showToast = useCallback((t: ToastData) => {
    if (t.kind && notifyFilter.current && !notifyFilter.current(t)) return;
    if (t.kind) chirpInApp(t.kind);
    if (t.kind) void notify({ kind: t.kind, title: t.title, body: t.body, go: t.go, ...(t.critical ? { critical: true } : {}), ...(t.href ? { data: { href: t.href } } : {}) });
    clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ ...bannerFor(t, previewMode.current), seq: toastSeq.current });
    toastTimer.current = setTimeout(() => leave(), TOAST_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Sai em 300 ms (sobe e some), como no design. */
  const leave = () => {
    clearTimeout(toastTimer.current);
    setToast(t => (t ? { ...t, leaving: true } : t));
    toastTimer.current = setTimeout(() => setToast(null), 300);
  };
  const dismissToast = useCallback(leave, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((cid: string, msg: Msg, opts?: { quiet?: boolean }) => {
    const viewingIt = viewing.current === cid;
    if (msg.from === 'them') {
      stopTyping(cid);
      // Conversa aberta: a mensagem que chegou já foi lida.
      if (viewingIt && msg.id.startsWith('in-')) setTimeout(() => markRead(cid, [msg.id]), 0);
    }
    if (msg.from === 'them' && !viewingIt && !opts?.quiet) {
      const c = chatsRef.current.find(x => x.id === cid);
      // Banner e, com o app em segundo plano, notificação do sistema (showToast chama `notify`).
      // Comunidade conta como Canais (o mesmo tipo nos dois).
      const kind = c?.kind === 'group' ? 'group' as const : c?.kind === 'channel' || c?.kind === 'community' ? 'channel' as const : 'msg' as const;
      if (c && !c.muted) showToast({ kind, av: c.initials, title: c.name, body: msgSummary(msg), href: `/chat/${cid}`,
        hidden: { title: 'Piu', body: kind === 'channel' ? 'Nova publicação' : 'Nova mensagem' }, go: () => router.push({ pathname: '/chat/[id]', params: { id: cid } }) });
    }
    setChats(cs => cs.map(c => (c.id !== cid ? c : {
      // Recebida: guarda quando chegou (prévia da tela bloqueada, lib/lockFeed.ts).
      // Toda mensagem guarda quando entrou (separador de data da conversa; prévia da tela bloqueada).
      ...c, time: msg.time, msgs: [...(c.msgs ?? []), { ...msg, ...(!msg.at ? { at: Date.now() } : {}), fresh: true }],
      unread: msg.from === 'me' || viewingIt ? c.unread : c.unread + 1,
    })));
  }, [showToast, stopTyping, markRead]);

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
      markRead(id);
    },
    leaveChat: () => { viewing.current = null; },
    // Estados (seção 3.1): criada → aguardando (na fila) → encaminhada → entregue.
    // Cifrado na sessão (ou com a chave do grupo) e na fila do roteador; os estados seguintes vêm da rede.
    // Fora de alcance, fica na fila até surgir uma rota.
    send: (cid, text, loc) => {
      const chat = chats.find(c => c.id === cid);
      const id = 'n' + Date.now();
      // Temporária (só conversa com uma pessoa): o prazo vai junto e a mensagem some dos dois lados.
      const exp = chat?.peer ? tempSeconds(chat.temp) : undefined;
      push(cid, { id, from: 'me', text, time: nowHM(), status: 'criada', at: Date.now(), ...(exp ? { expiresAt: Date.now() + exp * 1000 } : {}), ...(loc ? { loc } : {}) });
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const ok = !!to && (outbound.current?.(cid, to, id, text, exp, loc) ?? false);
      // Só passa para "na fila" se a rede ainda não avançou o estado (o vizinho pode já ter recebido).
      later(ok ? 300 : 0, () => patchMsg(cid, id, m => (m.status === 'criada' ? { status: ok ? 'aguardando' : 'falha' } : {})));
      if (chat?.request) setChats(cs => cs.map(c => (c.id === cid ? { ...c, request: false } : c)));
    },
    retry: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const m = chat?.msgs?.find(x => x.id === mid);
      // Temporária: reenvia com o que falta do prazo.
      const left = m?.expiresAt ? Math.floor((m.expiresAt - Date.now()) / 1000) : undefined;
      if (left !== undefined && left < 60) return;
      const ok = !!to && !!m && (outbound.current?.(cid, to, mid, m.text, left, m.loc) ?? false);
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
      const exp = tempSeconds(chat.temp);
      // O balão entra antes do envio: o progresso pode começar a chegar na hora.
      push(cid, { id, from: 'me', text: '', time: nowHM(), status: 'aguardando', at: Date.now(), ...(exp ? { expiresAt: Date.now() + exp * 1000 } : {}),
        file: { name: f.name, mb, blocks: Math.max(1, Math.ceil(f.data.length / (12 * 1024))), icon, done: 0, state: 'sending', real: true, preview: f.preview } });
      const r = fileOps.current?.send(cid, chat.peer, id, f, exp) ?? null;
      if (!r) setStatus(cid, id, 'falha');
    },
    setFileOps: ops => { fileOps.current = ops; },
    patchFile,
    toggleFilePause: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      const f = chat?.msgs?.find(m => m.id === mid)?.file;
      if (!f) return;
      if (f.incoming) {
        if (f.held && chat?.peer && fileOps.current?.download(chat.peer, mid.replace(/^in-/, ''))) patchFile(cid, mid, { held: false });
        return;
      }
      const pause = f.state !== 'userPaused';
      if (fileOps.current?.setPaused(mid, pause)) patchFile(cid, mid, { state: pause ? 'userPaused' : 'resuming' });
      else patchFile(cid, mid, { lost: true });
    },
    setOutbound: fn => { outbound.current = fn; },
    setSignals: s => { signals.current = s; },
    typing,
    setTyping,
    notifyTyping: cid => { const c = chatsRef.current.find(x => x.id === cid); if (c?.peer && !c.request) signals.current?.typing(cid, c.peer); },
    receive: (cid, msg, opts) => push(cid, msg, opts),
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
        showToast({ kind: 'msg', icon: 'done_all', title: `Entregue a ${c.name}`, body: `Uma rota surgiu depois de ${wait} na fila.`, hidden: { title: 'Mensagem entregue', body: `Uma rota surgiu depois de ${wait} na fila.` }, go: open });
      }
      if (st === 'expirada') {
        showToast({ kind: 'msg', icon: 'timer_off', title: 'Mensagem expirou', body: `“${quote}” não encontrou rota em ${MESSAGE_TTL_SEC / 3600} h.`, action: 'Reenviar',
          hidden: { title: 'Mensagem expirou', body: `Uma mensagem não encontrou rota em ${MESSAGE_TTL_SEC / 3600} h.` },
          go: () => { open(); retryRef.current(cid, mid); } });
      }
    },
    setNotifyFilter: fn => { notifyFilter.current = fn; },
    setPreviewMode: p => { previewMode.current = p; },
    patchChat: (cid, p) => setChats(cs => cs.map(c => (c.id === cid ? { ...c, ...p } : c))),
    removeChat: cid => {
      if (viewing.current === cid) viewing.current = null;
      stopTyping(cid);
      setChats(cs => cs.filter(c => c.id !== cid));
      setVerifiedMap(m => { if (!(cid in m)) return m; const { [cid]: _x, ...rest } = m; return rest; });
    },
    purgeMediaPreviews: () => {
      const r = stripPreviews(chatsRef.current);
      if (r.freed) { chatsRef.current = r.chats; setChats(r.chats); }
      return r.freed;
    },
    toast,
    showToast,
    dismissToast,
  }), [profile, blocked, onboarded, identity, chats, verified, toast, push, setStatus, patchFile, showToast, dismissToast, typing, setTyping, markRead, stopTyping]);

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
