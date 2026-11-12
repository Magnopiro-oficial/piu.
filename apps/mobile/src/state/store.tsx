import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Chat, FileXfer, IdentityKind, Msg, Status, ToastData } from '../data/types';
import { getChatStore } from '../core';
import { dropExpired, type Signals } from '../core/chatStore';
import type { Preview } from '../data/settings';
import type { AnonAvatar } from '../lib/avatar';
import { cleanBlocked, cleanProfile } from '../lib/demoCleanup';
import { onAppLockChange } from '../lib/appLockGate';
import { bannerFor } from '../lib/preview';
import { forgetPersisted, readPersisted, usePersisted } from '../lib/persist';
import { tempSeconds } from '../lib/status';
import { nowHM } from '../lib/text';

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
  /** Zera as não lidas e confirma a leitura ao contato, sem marcar a conversa como aberta (Piu Desktop leu a conversa). */
  markChatRead: (chatId: string) => void;
  /** Mensagem real recebida (já decifrada e conferida). */
  /** `quiet`: entra na conversa sem banner nem notificação (ex.: grupo movimentado sem menção). */
  receive: (chatId: string, msg: Msg, opts?: { quiet?: boolean }) => void;
  setMsgStatus: (chatId: string, msgId: string, status: Status) => void;
  /** Altera uma mensagem da conversa (ex.: etapa do cartão "Pedido de chamada"). */
  patchMsg: (chatId: string, msgId: string, p: Partial<Msg>) => void;
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
export type { Signals };

const Ctx = createContext<Store | null>(null);
/** Remoção das mensagens temporárias vencidas. */
const SWEEP_MS = 30_000;
const TOAST_MS = 4500;

/**
 * Conversas, verificações e "digitando…" vêm do núcleo (core/chatStore.ts): o mensageiro grava lá
 * mesmo sem tela, e este provider só assina. Perfil, bloqueados, identidade e o banner ficam aqui.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  // Nada pré-preenchido: o nome é obrigatório para a identidade pública (onboarding).
  const [profile, setProfileState] = usePersisted<Profile>('profile', { idType: 'public', name: '' }, p => cleanProfile(p, readPersisted<boolean>('onboarded') === true));
  const [blocked, setBlocked] = usePersisted<Blocked[]>('blocked', [], b => cleanBlocked<Blocked>(b));
  const [onboarded, setOnboarded] = usePersisted('onboarded', false);
  const [identity, setIdentity] = usePersisted<IdentityKind>('identity', 'public');
  // A lista começa vazia: só entram conversas reais (QR, pedido de conversa, grupos, canais e comunidades).
  const cs = useMemo(() => getChatStore(), []);
  const { chats, verified, typing } = useSyncExternalStore(cs.subscribe, cs.getSnapshot, cs.getSnapshot);
  const [toast, setToast] = useState<Store['toast']>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastSeq = useRef(0);
  const retryRef = useRef<(cid: string, mid: string) => void>(() => {});
  const previewMode = useRef<Preview>('always');
  const fileOps = useRef<FileOps | null>(null);
  const outbound = useRef<Outbound | null>(null);
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    clearTimeout(toastTimer.current);
  }, []);
  // Mensagens temporárias: somem deste aparelho no prazo (o contato apaga as dele do mesmo jeito).
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      if (!cs.getSnapshot().chats.some(c => c.msgs?.some(m => m.expiresAt && m.expiresAt <= now))) return;
      cs.setChats(list => list.map(c => { const msgs = dropExpired(c.msgs, now); return msgs === c.msgs ? c : { ...c, msgs }; }));
    };
    sweep();
    const t = setInterval(sweep, SWEEP_MS);
    return () => clearInterval(t);
  }, [cs]);
  // Voltou para a frente (ou destravou) com uma conversa aberta: o que chegou nesse meio-tempo é lido agora.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') cs.back(); });
    const off = onAppLockChange(l => { if (!l) cs.back(); });
    return () => { sub.remove(); off(); };
  }, [cs]);
  // Configurações do grupo de exemplo das versões antigas: os grupos reais guardam as suas no mensageiro.
  useEffect(() => { void forgetPersisted('group'); }, []);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  /** Sai em 300 ms (sobe e some), como no design. */
  const leave = () => {
    clearTimeout(toastTimer.current);
    setToast(t => (t ? { ...t, leaving: true } : t));
    toastTimer.current = setTimeout(() => setToast(null), 300);
  };
  const dismissToast = useCallback(leave, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Banner dentro do app, já conforme a pré-visualização (lib/preview.ts). A notificação do sistema
  // (banner com `kind`, app fora da frente) sai pelo núcleo, com ou sem esta tela.
  useEffect(() => cs.onBanner(t => {
    clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ ...bannerFor(t, previewMode.current), seq: toastSeq.current });
    toastTimer.current = setTimeout(() => leave(), TOAST_MS);
  }), [cs]);
  // "Reenviar" do banner de mensagem expirada.
  useEffect(() => { cs.setRetry((cid, mid) => retryRef.current(cid, mid)); return () => cs.setRetry(null); }, [cs]);

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
    openChat: cs.open,
    leaveChat: cs.leave,
    // Estados (seção 3.1): criada → aguardando (na fila) → encaminhada → entregue.
    // Cifrado na sessão (ou com a chave do grupo) e na fila do roteador; os estados seguintes vêm da rede.
    // Fora de alcance, fica na fila até surgir uma rota.
    send: (cid, text, loc) => {
      const chat = chats.find(c => c.id === cid);
      const id = 'n' + Date.now();
      // Temporária (só conversa com uma pessoa): o prazo vai junto e a mensagem some dos dois lados.
      const exp = chat?.peer ? tempSeconds(chat.temp) : undefined;
      cs.push(cid, { id, from: 'me', text, time: nowHM(), status: 'criada', at: Date.now(), ...(exp ? { expiresAt: Date.now() + exp * 1000 } : {}), ...(loc ? { loc } : {}) });
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const ok = !!to && (outbound.current?.(cid, to, id, text, exp, loc) ?? false);
      // Só passa para "na fila" se a rede ainda não avançou o estado (o vizinho pode já ter recebido).
      later(ok ? 300 : 0, () => cs.patchMsg(cid, id, m => (m.status === 'criada' ? { status: ok ? 'aguardando' : 'falha' } : {})));
      if (chat?.request) cs.setChats(list => list.map(c => (c.id === cid ? { ...c, request: false } : c)));
    },
    retry: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      const to = chat?.peer ?? (chat?.group ? 'group:' + chat.group : null);
      const m = chat?.msgs?.find(x => x.id === mid);
      // Temporária: reenvia com o que falta do prazo.
      const left = m?.expiresAt ? Math.floor((m.expiresAt - Date.now()) / 1000) : undefined;
      if (left !== undefined && left < 60) return;
      const ok = !!to && !!m && (outbound.current?.(cid, to, mid, m.text, left, m.loc) ?? false);
      cs.setStatus(cid, mid, ok ? 'aguardando' : 'falha');
    },
    verified,
    setVerified: cs.setVerified,
    addChat: cs.addChat,
    sendRealFile: (cid, f) => {
      const chat = chats.find(c => c.id === cid);
      if (!chat?.peer) return;
      const id = 'f' + Date.now();
      const icon = f.mime.startsWith('image/') ? 'image' as const : 'description' as const;
      const mb = Math.max(0.1, Math.round((f.data.length / 1048576) * 10) / 10);
      const exp = tempSeconds(chat.temp);
      // O balão entra antes do envio: o progresso pode começar a chegar na hora.
      cs.push(cid, { id, from: 'me', text: '', time: nowHM(), status: 'aguardando', at: Date.now(), ...(exp ? { expiresAt: Date.now() + exp * 1000 } : {}),
        file: { name: f.name, mb, blocks: Math.max(1, Math.ceil(f.data.length / (12 * 1024))), icon, done: 0, state: 'sending', real: true, preview: f.preview } });
      const r = fileOps.current?.send(cid, chat.peer, id, f, exp) ?? null;
      if (!r) cs.setStatus(cid, id, 'falha');
    },
    setFileOps: ops => { fileOps.current = ops; },
    patchFile: cs.patchFile,
    toggleFilePause: (cid, mid) => {
      const chat = chats.find(c => c.id === cid);
      const f = chat?.msgs?.find(m => m.id === mid)?.file;
      if (!f) return;
      if (f.incoming) {
        if (f.held && chat?.peer && fileOps.current?.download(chat.peer, mid.replace(/^in-/, ''))) cs.patchFile(cid, mid, { held: false });
        return;
      }
      const pause = f.state !== 'userPaused';
      if (fileOps.current?.setPaused(mid, pause)) cs.patchFile(cid, mid, { state: pause ? 'userPaused' : 'resuming' });
      else cs.patchFile(cid, mid, { lost: true });
    },
    setOutbound: fn => { outbound.current = fn; },
    setSignals: cs.setSignals,
    typing,
    setTyping: cs.setTyping,
    notifyTyping: cs.notifyTyping,
    markChatRead: cs.markChatRead,
    receive: cs.push,
    patchMsg: (cid, mid, p) => cs.patchMsg(cid, mid, () => p),
    setMsgStatus: cs.setMsgStatus,
    setNotifyFilter: cs.setNotifyFilter,
    setPreviewMode: p => { previewMode.current = p; },
    patchChat: cs.patchChat,
    removeChat: cs.removeChat,
    purgeMediaPreviews: cs.purgeMediaPreviews,
    toast,
    showToast: cs.showToast,
    dismissToast,
  }), [cs, profile, blocked, onboarded, identity, chats, verified, toast, dismissToast, typing]); // eslint-disable-line react-hooks/exhaustive-deps

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
