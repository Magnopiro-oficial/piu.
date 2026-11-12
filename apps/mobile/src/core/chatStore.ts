/**
 * Conversas fora da árvore React: um store por processo, dono único de `chats` e `verified`.
 * Deslizar o app dos recentes desmonta o StoreProvider, mas o mensageiro do núcleo segue recebendo;
 * ele grava aqui (`push`, `patchMsg`, `patchChat`…) e a tela só assina (`useSyncExternalStore`).
 * - A gravação é a mesma de antes: `schedule` (o atraso de lib/persist.ts) na chave de sempre.
 * - Banner com `kind` vira notificação do sistema mesmo sem tela; o banner dentro do app só vai a
 *   quem assina `onBanner` (o StoreProvider montado).
 * Sem react-native: roda no app (core/index.ts liga as peças reais) e nos testes.
 */
import type { Chat, FileXfer, Msg, Status, ToastData } from '../data/types';
import { cleanChats, cleanVerified } from '../lib/demoCleanup';
import { isViewingNow, readOnView } from '../lib/appLockGate';
import { incomingAlert } from '../lib/piuChirp';
import { isStatusBack } from '../lib/status';
import { msgSummary } from '../lib/chatCore';
import { stripPreviews } from '../lib/storageCore';
import { t } from '../i18n/core';
import { MESSAGE_TTL_SEC } from '../messaging/messenger';

/** Chaves salvas cujo dono é este store (core/__tests__/keyOwners.test.ts). */
export const CHAT_STORE_KEYS = ['chats', 'verified'] as const;

type Kind = NonNullable<ToastData['kind']>;
export interface Signals { read: (chatId: string, peer: string, msgIds: string[]) => void; typing: (chatId: string, peer: string) => void }

export interface ChatState {
  chats: Chat[];
  /** Contatos verificados pessoalmente pelo código de segurança. */
  verified: Record<string, boolean>;
  /** Conversas em que o contato está digitando agora. */
  typing: Record<string, boolean>;
}

export interface ChatStoreDeps {
  /** Valor salvo (já carregado por `loadPersisted`). */
  read: <T>(key: string) => T | undefined;
  /** Grava com o pequeno atraso de lib/persist.ts. */
  schedule: (key: string, value: unknown) => void;
  /** Notificação do sistema (lib/notifications.ts: confere tipos ligados, silêncio, prévia e app aberto). */
  notify: (n: { kind: Kind; title: string; body: string; go?: () => void; critical?: boolean; data?: { href: string } }) => void;
  /** O piu dentro do app. */
  chirp: (kind: Kind) => void;
  /** App em primeiro plano e bloqueio do app (conversa aberta só conta com os dois a favor). */
  active: () => boolean;
  locked: () => boolean;
  /** Abre uma rota (toque no banner que também faz outra coisa, ex.: "Reenviar"). */
  navigate?: (href: string) => void;
}

export type ChatStore = ReturnType<typeof createChatStore>;

/** "digitando…" some se nada novo chegar neste tempo. */
const TYPING_MS = 6000;
/** Remoção das mensagens temporárias vencidas (o núcleo varre, com ou sem tela: messengerRuntime.ts). */
export const SWEEP_MS = 30_000;
export const dropExpired = (msgs: Msg[] | undefined, now: number) => (msgs?.some(m => m.expiresAt && m.expiresAt <= now) ? msgs.filter(m => !m.expiresAt || m.expiresAt > now) : msgs);

/**
 * Ao reabrir o app: só as conversas reais ficam (as de exemplo das versões antigas saem, ver
 * lib/demoCleanup.ts); mensagens que não chegaram à fila voltam para "na fila" e arquivos que não
 * terminaram ficam pausados e marcados como interrompidos (o conteúdo não é guardado).
 */
export function reviveChats(saved: Chat[]): Chat[] {
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

export function createChatStore(deps: ChatStoreDeps) {
  const subs = new Set<() => void>();
  const banners = new Set<(t: ToastData) => void>();
  let viewing: string | null = null;
  let signals: Signals | null = null;
  let notifyFilter: ((t: ToastData) => boolean) | null = null;
  let retry: ((cid: string, mid: string) => void) | null = null;
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Como o `usePersisted` de antes: lê o salvo e só regrava se `revive` mudou algo.
  const load = (): ChatState => {
    const sc = deps.read<Chat[]>('chats');
    const chats = sc !== undefined ? reviveChats(sc) : [];
    if (sc !== undefined && chats !== sc) deps.schedule('chats', chats);
    const sv = deps.read<Record<string, boolean>>('verified');
    const verified = sv !== undefined ? cleanVerified(sv, cleanChats(sc)) : {};
    if (sv !== undefined && verified !== sv) deps.schedule('verified', verified);
    return { chats, verified, typing: {} };
  };
  let st = load();

  const emit = () => subs.forEach(fn => { try { fn(); } catch { /* ouvinte */ } });
  const setChats = (f: (cs: Chat[]) => Chat[]) => {
    const chats = f(st.chats);
    if (chats === st.chats) return;
    st = { ...st, chats };
    deps.schedule('chats', chats);
    emit();
  };
  const setVerifiedMap = (f: (m: Record<string, boolean>) => Record<string, boolean>) => {
    const verified = f(st.verified);
    if (verified === st.verified) return;
    st = { ...st, verified };
    deps.schedule('verified', verified);
    emit();
  };
  const setTypingMap = (f: (m: Record<string, boolean>) => Record<string, boolean>) => {
    const typing = f(st.typing);
    if (typing === st.typing) return;
    st = { ...st, typing };
    emit();
  };
  const find = (cid: string) => st.chats.find(x => x.id === cid);
  const viewingNow = (cid: string | null, id: string) => isViewingNow(cid, id, { active: deps.active(), locked: deps.locked() });

  const stopTyping = (cid: string) => {
    clearTimeout(typingTimers.get(cid));
    typingTimers.delete(cid);
    setTypingMap(t => { if (!t[cid]) return t; const { [cid]: _x, ...rest } = t; return rest; });
  };
  const setTyping = (cid: string) => {
    clearTimeout(typingTimers.get(cid));
    typingTimers.set(cid, setTimeout(() => stopTyping(cid), TYPING_MS));
    setTypingMap(t => (t[cid] ? t : { ...t, [cid]: true }));
  };
  /** Confirma a leitura das mensagens recebidas de um contato (quem decide se sai é `signals`). */
  const markRead = (cid: string, ids?: string[]) => {
    const c = find(cid);
    if (!c?.peer || !signals) return;
    const list = ids ?? (c.msgs ?? []).filter(m => m.from === 'them' && m.id.startsWith('in-')).slice(-50).map(m => m.id);
    const remote = list.map(id => id.replace(/^in-/, ''));
    if (remote.length) signals.read(cid, c.peer, remote);
  };

  const patchMsg = (cid: string, mid: string, p: (m: Msg) => Partial<Msg>) =>
    setChats(cs => cs.map(c => (c.id !== cid ? c : { ...c, msgs: (c.msgs ?? []).map(m => (m.id === mid ? { ...m, ...p(m) } : m)) })));
  // Um estado não volta atrás (ex.: a confirmação de entrega atrasada não desfaz "lida").
  const setStatus = (cid: string, mid: string, status: Status) => patchMsg(cid, mid, m => (isStatusBack(m.status, status) ? {} : { status }));
  const patchFile = (cid: string, mid: string, p: Partial<FileXfer>) => patchMsg(cid, mid, m => (m.file ? { file: { ...m.file, ...p } } : {}));

  /**
   * Banner com `kind` também vira notificação do sistema quando o app não está em primeiro plano
   * (`notify` confere tipos ligados, silêncio e prévia, e não dispara com o app aberto). O banner
   * dentro do app (já conforme a pré-visualização) é da tela que assina `onBanner`.
   */
  const showToast = (t: ToastData) => {
    if (t.kind && notifyFilter && !notifyFilter(t)) return;
    if (t.kind) deps.chirp(t.kind);
    if (t.kind) deps.notify({ kind: t.kind, title: t.title, body: t.body, go: t.go, ...(t.critical ? { critical: true } : {}), ...(t.href ? { data: { href: t.href } } : {}) });
    banners.forEach(fn => { try { fn(t); } catch { /* ouvinte */ } });
  };

  const push = (cid: string, msg: Msg, opts?: { quiet?: boolean }) => {
    // Conversa aberta só conta com o app em primeiro plano e destravado: em segundo plano ou sob o
    // bloqueio do app a mensagem fica não lida, notifica e não sai "lida" para o contato.
    const viewingIt = viewingNow(viewing, cid);
    if (msg.from === 'them') {
      stopTyping(cid);
      // Conversa aberta: a mensagem que chegou já foi lida.
      if (viewingIt && msg.id.startsWith('in-')) setTimeout(() => markRead(cid, [msg.id]), 0);
    }
    const c = msg.from === 'them' ? find(cid) : undefined;
    const alert = incomingAlert({ fromThem: msg.from === 'them', viewing: viewingIt, exists: !!c, quiet: opts?.quiet, muted: c?.muted });
    if (c && (alert.banner || alert.chirp)) {
      // Fora da conversa: banner e, com o app em segundo plano, notificação do sistema (showToast chama
      // `notify`). Na conversa aberta: só o piu. Comunidade conta como Canais (o mesmo tipo nos dois).
      const kind = c.kind === 'group' ? 'group' as const : c.kind === 'channel' || c.kind === 'community' ? 'channel' as const : 'msg' as const;
      if (alert.chirp) deps.chirp(kind);
      else showToast({ kind, av: c.initials, title: c.name, body: msgSummary(msg), href: `/chat/${cid}`,
        hidden: { title: 'Piu', body: kind === 'channel' ? t('notify.hidden.channel') : t('notify.hidden.msg') } });
    }
    setChats(cs => cs.map(c => (c.id !== cid ? c : {
      // Toda mensagem guarda quando entrou (separador de data da conversa; prévia da tela bloqueada).
      ...c, time: msg.time, msgs: [...(c.msgs ?? []), { ...msg, ...(!msg.at ? { at: Date.now() } : {}), fresh: true }],
      unread: msg.from === 'me' || viewingIt ? c.unread : c.unread + 1,
    })));
  };

  return {
    getSnapshot: (): ChatState => st,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    /** Relê o salvo ("Apagar dados locais" esvaziou a memória): sem regravar. */
    reload: () => {
      typingTimers.forEach(clearTimeout); typingTimers.clear();
      viewing = null;
      st = load();
      emit();
    },
    setChats,
    setVerified: (id: string, v: boolean) => setVerifiedMap(m => ({ ...m, [id]: v })),
    push,
    patchMsg,
    setStatus,
    patchFile,
    patchChat: (cid: string, p: Partial<Chat>) => setChats(cs => cs.map(c => (c.id === cid ? { ...c, ...p } : c))),
    /** Acrescenta uma conversa no topo (se ainda não existir). */
    addChat: (ch: Chat) => setChats(cs => (cs.some(x => x.id === ch.id) ? cs : [ch, ...cs])),
    removeChat: (cid: string) => {
      if (viewing === cid) viewing = null;
      stopTyping(cid);
      setChats(cs => cs.filter(c => c.id !== cid));
      setVerifiedMap(m => { if (!(cid in m)) return m; const { [cid]: _x, ...rest } = m; return rest; });
    },
    setMsgStatus: (cid: string, mid: string, s: Status) => {
      setStatus(cid, mid, s);
      const c = find(cid);
      const m = c?.msgs?.find(x => x.id === mid);
      if (!c || !m || m.from !== 'me' || c.muted || viewing === cid) return;
      const href = `/chat/${cid}`;
      const quote = m.text.length > 40 ? m.text.slice(0, 39) + '…' : m.text;
      if (s === 'entregue' && m.at && Date.now() - m.at > 60_000) {
        const min = Math.round((Date.now() - m.at) / 60_000);
        const wait = min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`;
        showToast({ kind: 'msg', icon: 'done_all', title: t('toast.deliveredTo', { name: c.name }), body: t('toast.routeAfter', { wait }), hidden: { title: t('toast.delivered'), body: t('toast.routeAfter', { wait }) }, href });
      }
      if (s === 'expirada') {
        showToast({ kind: 'msg', icon: 'timer_off', title: t('toast.expired'), body: t('toast.expired.body', { quote, hours: MESSAGE_TTL_SEC / 3600 }), action: t('chat.resend'),
          hidden: { title: t('toast.expired'), body: t('toast.expired.hidden', { hours: MESSAGE_TTL_SEC / 3600 }) }, href,
          go: () => { deps.navigate?.(href); retry?.(cid, mid); } });
      }
    },
    /** Mensagens temporárias: somem deste aparelho no prazo (o contato apaga as dele do mesmo jeito). */
    sweepExpired: (now = Date.now()) => {
      if (!st.chats.some(c => c.msgs?.some(m => m.expiresAt && m.expiresAt <= now))) return;
      setChats(list => list.map(c => { const msgs = dropExpired(c.msgs, now); return msgs === c.msgs ? c : { ...c, msgs }; }));
    },
    /**
     * Enviada: "criada" passa a "na fila" (ou "falha") em `ms`, só se a rede ainda não avançou o estado
     * (o vizinho pode já ter recebido). O timer é do store: deslizar o app logo depois não a deixa presa.
     */
    settleSent: (cid: string, mid: string, ok: boolean, ms = ok ? 300 : 0) => {
      setTimeout(() => patchMsg(cid, mid, m => (m.status === 'criada' ? { status: ok ? 'aguardando' : 'falha' } : {})), ms);
    },
    setTyping,
    stopTyping,
    markRead,
    /** Estou digitando nesta conversa. */
    notifyTyping: (cid: string) => { const c = find(cid); if (c?.peer && !c.request) signals?.typing(cid, c.peer); },
    /** Zera as não lidas e confirma a leitura ao contato, sem marcar a conversa como aberta (Piu Desktop leu a conversa). */
    markChatRead: (cid: string) => { setChats(cs => cs.map(c => (c.id === cid && c.unread ? { ...c, unread: 0 } : c))); markRead(cid); },
    open: (id: string) => {
      viewing = id;
      // Aberta por baixo do bloqueio (ex.: toque na notificação) ou em segundo plano: ainda não foi
      // vista. Fica não lida e sem recibo; ao destravar, `back` confirma.
      if (!readOnView(find(id), viewingNow(id, id), true)) return;
      setChats(cs => cs.map(c => (c.id === id ? { ...c, unread: 0 } : c)));
      markRead(id);
    },
    leave: () => { viewing = null; },
    viewing: () => viewing,
    /** Voltou para a frente (ou destravou) com uma conversa aberta: o que chegou nesse meio-tempo é lido agora. */
    back: () => {
      const id = viewing;
      if (!id) return;
      const r = readOnView(find(id), viewingNow(id, id), false);
      if (!r) return;
      setChats(cs => cs.map(c => (c.id === id && c.unread ? { ...c, unread: 0 } : c)));
      if (r.ids?.length) markRead(id, r.ids);
    },
    /** "Limpar cache de mídia": apaga as prévias embutidas nas conversas. Devolve os bytes liberados. */
    purgeMediaPreviews: () => {
      const r = stripPreviews(st.chats);
      if (r.freed) setChats(() => r.chats);
      return r.freed;
    },
    showToast,
    onBanner: (fn: (t: ToastData) => void) => { banners.add(fn); return () => { banners.delete(fn); }; },
    setNotifyFilter: (fn: ((t: ToastData) => boolean) | null) => { notifyFilter = fn; },
    setSignals: (s: Signals | null) => { signals = s; },
    /** "Reenviar" do banner de mensagem expirada (o envio é da tela: StoreProvider). */
    setRetry: (fn: ((cid: string, mid: string) => void) | null) => { retry = fn; },
  };
}
