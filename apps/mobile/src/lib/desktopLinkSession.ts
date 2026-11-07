/**
 * Sessão com o Piu Desktop no celular (lado React Native): WebSocket nativo com certificado fixado
 * (`wss://`, módulo piu-node-link), ciclo de vida e a ponte com o store. A lógica do protocolo (QR, handshake, quadros, snapshot, eventos) é pura e fica em
 * lib/desktopLink.ts; aqui só o que depende do app.
 *
 * O estado vive fora do React (assinatura via `useDesktopLink`) para a sessão sobreviver à troca de
 * tela: a pessoa lê o QR em Perfil → Conectar ao computador, confirma as 3 palavras e volta às
 * conversas; o computador continua recebendo os eventos. `DesktopLinkBridge` (montado em
 * state/messaging.tsx) liga o store à sessão: snapshot ao confirmar, diferença de `chats`/`typing`
 * como eventos e os comandos do desktop executados pelo próprio store (`send`, `markChatRead`,
 * `notifyTyping`), como se a pessoa tivesse digitado no celular.
 *
 * Nada sai do celular antes de a pessoa confirmar as palavras; comandos recebidos antes disso só
 * ganham um `ack` de erro. Qualquer quadro que não abra (adulterado, repetido, fora de ordem ou de
 * outra chave) derruba a sessão.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { PiuNodeLink } from '../../modules/piu-node-link';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { canDesktopSend, parseDesktopPayment, validPaymentId, type DesktopPaymentRequest, type DesktopPaymentStatus } from './desktopPayment';
import {
  buildSnapshot, certPin, type Command, DesktopLinkError, diffChats, diffTyping, FrameOpener, FrameSealer, type LinkEvent, type LinkMessage, type LinkOffer,
  parseCommand, parseLinkQr, phoneHandshake, type Snapshot, wsUrl,
} from './desktopLink';

/**
 * Transporte do vínculo: SEMPRE o WebSocket nativo do módulo piu-node-link (OkHttp, `wss://` com o
 * certificado fixado pelo SHA-256 que veio no QR). O WebSocket do React Native não serve: não permite
 * fixar o certificado autoassinado do desktop. Sem o módulo (Expo Go, web) não há vínculo.
 */
export const linkAvailable = () => !!PiuNodeLink;
export const LINK_UNAVAILABLE = 'Conectar ao computador precisa do app Piu instalado (não funciona no Expo Go nem no navegador).';

export type LinkPhase = 'idle' | 'connecting' | 'confirm' | 'connected' | 'error';
export interface LinkState {
  phase: LinkPhase;
  /** `ip:porta` do computador (do QR). */
  host?: string;
  /** Nome que o computador mandou no `ready`, se mandou. */
  name?: string;
  /** As 3 palavras a conferir (de `connecting` em diante). */
  words?: string[];
  /** Conectado desde (ms). */
  since?: number;
  error?: string;
  /** Quadros cifrados enviados e recebidos (diagnóstico na tela). */
  sent: number; received: number;
  payment?: DesktopPaymentRequest;
}

/** Sem resposta do computador ao abrir a conexão. */
const CONNECT_TIMEOUT_MS = 12_000;
/** O celular manda `ping`; qualquer quadro do outro lado conta como vida. */
const PING_MS = 25_000;
const DEAD_MS = 75_000;
const MAX_NAME = 40;
/** Códigos de fechamento que o desktop pode usar (documentados no protocolo). */
const CLOSE_SESSION_RENEWED = 4001;
const CLOSE_VERSION = 4002;

const IDLE: LinkState = { phase: 'idle', sent: 0, received: 0 };
let state: LinkState = IDLE;
const listeners = new Set<() => void>();
export const getLinkState = () => state;
export function subscribeLink(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function set(p: Partial<LinkState>) {
  state = { ...state, ...p };
  for (const fn of listeners) fn();
}

/** Estado da sessão para componentes (renderizam de novo a cada mudança). */
export function useDesktopLink(): LinkState {
  return useSyncExternalStore(subscribeLink, getLinkState, getLinkState);
}

// ── ponte com o store ─────────────────────────────────────────────

/** O que a sessão precisa do app (registrado por `DesktopLinkBridge`). */
export interface LinkBridge {
  snapshot: () => Snapshot;
  /** `false` se a conversa não existe. */
  send: (chatId: string, text: string) => boolean;
  read: (chatId: string) => void;
  typing: (chatId: string) => void;
}
let bridge: LinkBridge | null = null;
export function setLinkBridge(b: LinkBridge | null) { bridge = b; }

// ── sessão ────────────────────────────────────────────────────────

type Timer = ReturnType<typeof setTimeout>;
interface Session {
  /** Id da conexão no módulo nativo (null até `wsOpen` resolver). */
  wsId: number | null; open: boolean;
  sealer: FrameSealer; opener: FrameOpener; wipe: () => void; offer: LinkOffer;
  confirmed: boolean; desktopReady: boolean; closed: boolean; token: number; seenPayments: Set<string>; paymentStarted: boolean; paymentTimer?: Timer;
  /** `hello` em JSON, enviado quando o socket abrir. */
  pendingHello?: string;
  connectTimer?: Timer; pingTimer?: ReturnType<typeof setInterval>; deadTimer?: Timer;
}
let session: Session | null = null;
let nextToken = 0;
let listening = false;

/** Assina os eventos do módulo nativo uma vez; cada evento vai para a sessão com aquele `id`. */
function listen() {
  if (listening || !PiuNodeLink) return;
  listening = true;
  const forId = (id: number) => (session && session.wsId === id && !session.closed ? session : null);
  PiuNodeLink.addListener('onWsOpen', e => { const s = forId(e.id); if (s) onOpen(s); });
  PiuNodeLink.addListener('onWsMessage', e => { const s = forId(e.id); if (s) onWire(s, e.data); });
  PiuNodeLink.addListener('onWsError', e => { const s = forId(e.id); if (s) fail(s, e.message.includes('impressão digital') ? 'O certificado do computador não é o do QR: alguém pode estar se passando por ele. Leia o QR de novo.' : `Falha na conexão com o computador: ${e.message}`); });
  PiuNodeLink.addListener('onWsClose', e => {
    const s = forId(e.id);
    if (!s) return;
    const why = e.code === CLOSE_SESSION_RENEWED ? 'Este QR já foi renovado. No computador, leia o QR novo.'
      : e.code === CLOSE_VERSION ? 'Versão do Piu diferente no computador e no celular. Atualize os dois.'
      : state.phase === 'connected' ? 'O computador encerrou a conexão.' : 'A conexão caiu antes de terminar.';
    fail(s, why);
  });
}

function teardown(s: Session) {
  s.closed = true;
  clearTimeout(s.connectTimer); clearInterval(s.pingTimer); clearTimeout(s.deadTimer); clearTimeout(s.paymentTimer);
  if (state.payment?.token === s.token) set({ payment: undefined });
  if (s.wsId !== null) { try { PiuNodeLink?.wsClose(s.wsId, 1000, 'bye'); } catch { /* já fechado */ } }
  s.wipe();
  if (session === s) session = null;
}

function fail(s: Session, error: string) {
  if (s.closed) return;
  teardown(s);
  set({ phase: 'error', error, words: undefined, since: undefined });
}

function armDeadman(s: Session) {
  clearTimeout(s.deadTimer);
  s.deadTimer = setTimeout(() => fail(s, 'O computador parou de responder. Os dois ainda estão na mesma Wi-Fi?'), DEAD_MS);
}

function sendFrame(s: Session, msg: LinkMessage): boolean {
  if (s.closed || !s.open || s.wsId === null || !PiuNodeLink) return false;
  try {
    if (!PiuNodeLink.wsSend(s.wsId, s.sealer.seal(msg))) throw new Error('fechado');
    set({ sent: state.sent + 1 });
    return true;
  } catch (e) {
    fail(s, e instanceof DesktopLinkError ? e.message : 'Falha ao enviar para o computador.');
    return false;
  }
}

function ack(s: Session, ref: string | undefined, ok: boolean, error?: string) {
  if (!ref && ok) return; // sem referência, só vale a pena avisar erro
  sendFrame(s, { t: 'ack', ...(ref ? { ref } : {}), ok, ...(error ? { error } : {}) });
}

function handleCommand(s: Session, raw: LinkMessage) {
  const rawRef = (raw as { ref?: unknown }).ref;
  const ref = typeof rawRef === 'string' ? rawRef.slice(0, 64) : undefined;
  let cmd: Command;
  try { cmd = parseCommand(raw); } catch (e) { ack(s, ref, false, e instanceof Error ? e.message : 'Comando inválido.'); return; }
  if (!s.confirmed) { ack(s, ref, false, 'Aguardando a confirmação das palavras no celular.'); return; }
  const b = bridge;
  if (!b) { ack(s, ref, false, 'O app ainda está carregando as conversas.'); return; }
  try {
    if (cmd.op === 'send') { if (!b.send(cmd.chatId, cmd.text)) { ack(s, ref, false, 'Conversa não encontrada.'); return; } }
    else if (cmd.op === 'read') b.read(cmd.chatId);
    else b.typing(cmd.chatId);
    ack(s, ref, true);
  } catch { ack(s, ref, false, 'Não deu para executar no celular.'); }
}


/** Each request is bound to this exact confirmed connection; never reuse an ID. */
function handlePayment(s: Session, raw: LinkMessage) {
  const id = (raw as { id?: unknown }).id;
  if (!validPaymentId(id)) return;
  if (s.seenPayments.has(id)) { sendFrame(s, { t: 'payment_status', id, status: 'error', error: 'Pedido duplicado.' }); return; }
  if (s.seenPayments.size >= 1024) { sendFrame(s, { t: 'payment_status', id, status: 'error', error: 'Limite de pedidos nesta sessão.' }); return; }
  s.seenPayments.add(id);
  const payment = parseDesktopPayment(raw, s.token, Date.now());
  if (!payment || !s.confirmed || !s.desktopReady || state.phase !== 'connected' || state.payment) {
    sendFrame(s, { t: 'payment_status', id, status: 'error', error: 'Pedido inválido ou sessão indisponível.' }); return;
  }
  s.paymentStarted = false;
  set({ payment });
  sendFrame(s, { t: 'payment_status', id, status: 'review' });
  s.paymentTimer = setTimeout(() => {
    if (session === s && !s.paymentStarted && state.payment?.id === id) {
      sendFrame(s, { t: 'payment_status', id, status: 'cancelled' }); set({ payment: undefined });
    }
  }, 120_000);
}
export function desktopPaymentActive(p: DesktopPaymentRequest): boolean {
  const s = session;
  return !!s && s.token === p.token && !s.closed && s.open && s.confirmed && s.desktopReady && state.phase === 'connected' && state.payment?.id === p.id;
}
export function startDesktopPayment(p: DesktopPaymentRequest): boolean {
  if (!desktopPaymentActive(p) || !session || (!session.paymentStarted && Date.now() >= p.expiresAt)) return false;
  session.paymentStarted = true; clearTimeout(session.paymentTimer); return true;
}
export function desktopPaymentStatus(p: DesktopPaymentRequest, status: DesktopPaymentStatus, hash?: string, error?: string): void {
  if (!desktopPaymentActive(p) || !session) return;
  sendFrame(session, { t: 'payment_status', id: p.id, status, ...(hash ? { hash } : {}), ...(error ? { error: error.slice(0, 300) } : {}) });
}
export function finishDesktopPayment(p: DesktopPaymentRequest): void {
  if (!desktopPaymentActive(p) || !session) return;
  clearTimeout(session.paymentTimer); set({ payment: undefined });
}

/** Conexão TLS aberta (certificado conferido pelo pino): manda o hello e passa a conferir as palavras. */
function onOpen(s: Session) {
  if (s.closed || s.wsId === null || !PiuNodeLink) return;
  clearTimeout(s.connectTimer);
  s.open = true;
  // Única mensagem fora dos quadros cifrados (mas já dentro do TLS): a chave efêmera do celular e o id da sessão lido no QR.
  if (!PiuNodeLink.wsSend(s.wsId, s.pendingHello ?? '')) { fail(s, 'Falha ao iniciar a conexão.'); return; }
  set({ phase: 'confirm' });
  armDeadman(s);
  s.pingTimer = setInterval(() => sendFrame(s, { t: 'ping' }), PING_MS);
}

function onWire(s: Session, data: unknown) {
  if (typeof data !== 'string') { fail(s, 'O computador mandou um quadro em formato inesperado.'); return; }
  let msg: LinkMessage;
  try { msg = s.opener.open(data); } catch (e) { fail(s, `Conexão encerrada: ${e instanceof Error ? e.message : 'quadro inválido.'}`); return; }
  set({ received: state.received + 1 });
  armDeadman(s);
  switch (msg.t) {
    case 'ready': { s.desktopReady = true; const n = typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_NAME) : ''; if (n) set({ name: n }); break; }
    case 'ping': sendFrame(s, { t: 'pong' }); break;
    case 'pong': break;
    case 'bye': teardown(s); set({ phase: 'idle', words: undefined, since: undefined, error: undefined }); break;
    case 'cmd': handleCommand(s, msg); break;
    case 'payment_request': handlePayment(s, msg); break;
    default: break; // tipo desconhecido: ignora (compatibilidade com versões futuras do desktop)
  }
}

/**
 * Lê o QR e abre a conexão. Devolve a mensagem de erro do QR (para o leitor mostrar) ou null se a
 * conexão começou; o que acontecer depois chega pelo estado (`useDesktopLink`).
 */
export function startLink(qrText: string): string | null {
  let offer: LinkOffer;
  try { offer = parseLinkQr(qrText); } catch (e) { return e instanceof DesktopLinkError ? e.message : 'QR ilegível. Tente de novo.'; }
  if (!PiuNodeLink) return LINK_UNAVAILABLE;
  stopLink();
  listen();
  const hs = phoneHandshake(offer);
  const s: Session = { wsId: null, open: false, sealer: new FrameSealer(hs.keys.send), opener: new FrameOpener(hs.keys.recv), wipe: hs.wipe, offer, confirmed: false, desktopReady: false, closed: false, token: ++nextToken, seenPayments: new Set(), paymentStarted: false };
  session = s;
  set({ phase: 'connecting', host: `${offer.host}:${offer.port}`, name: undefined, words: hs.words, since: undefined, error: undefined, sent: 0, received: 0 });
  s.connectTimer = setTimeout(() => fail(s, 'O computador não respondeu. Confira se os dois estão na mesma Wi-Fi e se o Piu Desktop está mostrando o QR.'), CONNECT_TIMEOUT_MS);
  // TLS com o certificado fixado pelo `c` do QR: qualquer outro certificado derruba antes do hello.
  PiuNodeLink.wsOpen(wsUrl(offer), certPin(offer)).then(id => {
    if (session !== s || s.closed) { try { PiuNodeLink?.wsClose(id, 1000, 'cancelado'); } catch { /* ignora */ } return; }
    s.wsId = id;
  }, e => fail(s, e instanceof Error && e.message ? e.message : 'Não deu para abrir a conexão com o computador.'));
  const hello = JSON.stringify(hs.hello);
  s.pendingHello = hello;
  return null;
}

/** A pessoa conferiu as 3 palavras: manda o snapshot e passa a repassar eventos e aceitar comandos. */
export function confirmLink() {
  const s = session;
  if (!s || s.confirmed || state.phase !== 'confirm') return;
  const b = bridge;
  if (!b) { fail(s, 'O app ainda está carregando as conversas. Tente de novo.'); return; }
  s.confirmed = true;
  if (!sendFrame(s, b.snapshot())) return;
  set({ phase: 'connected', since: Date.now() });
}

/** Encerra a sessão (botão Desconectar, palavras diferentes, app reiniciado). Avisa o desktop se der. */
export function stopLink(reason = 'Desconectado pelo celular.') {
  const s = session;
  if (s) {
    if (!s.closed && s.open) sendFrame(s, { t: 'bye', reason });
    teardown(s);
  }
  if (state.phase !== 'idle') set({ phase: 'idle', words: undefined, since: undefined, error: undefined, name: undefined });
}

/** Sai do estado de erro (botão "Tentar de novo"). */
export function resetLink() { if (!session && state.phase !== 'idle') set({ ...IDLE }); }

/** Há um computador conectado e confirmado (a ponte só calcula a diferença dos estados quando há). */
export const isLinkActive = () => !!session?.confirmed;

/** Mudanças do store (só depois da confirmação). */
export function pushEvents(events: LinkEvent[]) {
  const s = session;
  if (!s || !s.confirmed) return;
  for (const e of events) if (!sendFrame(s, e)) break;
}

// ── componente-ponte (sem UI) ─────────────────────────────────────

/**
 * Liga o store à sessão. Montado uma vez em state/messaging.tsx. Observa `chats` e `typing` e manda
 * só a diferença; registra `snapshot`/`send`/`read`/`typing` sempre com o estado mais novo.
 */
export function DesktopLinkBridge(): null {
  const { chats, verified, typing, send, markChatRead, notifyTyping } = useStore();
  const { lunesAddress } = useWallet();
  const latest = useRef({ chats, verified, send, markChatRead, notifyTyping, lunesAddress });
  latest.current = { chats, verified, send, markChatRead, notifyTyping, lunesAddress };
  const prevChats = useRef(chats);
  const prevTyping = useRef(typing);
  useEffect(() => {
    setLinkBridge({
      snapshot: () => buildSnapshot(latest.current.chats, latest.current.verified, undefined, latest.current.lunesAddress),
      send: (chatId, text) => {
        const chat = latest.current.chats.find(c => c.id === chatId);
        if (!chat || !canDesktopSend(chat)) return false;
        latest.current.send(chatId, text);
        return true;
      },
      read: chatId => latest.current.markChatRead(chatId),
      typing: chatId => latest.current.notifyTyping(chatId),
    });
    return () => { setLinkBridge(null); stopLink('O app foi reiniciado.'); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Sem computador conectado, só acompanha o estado (o snapshot da confirmação é o ponto de partida da diferença).
  useEffect(() => {
    if (isLinkActive() && prevChats.current !== chats) {
      const ev = diffChats(prevChats.current, chats);
      if (ev.length) pushEvents(ev);
    }
    prevChats.current = chats;
  }, [chats]);
  useEffect(() => {
    if (isLinkActive()) {
      const ev = diffTyping(prevTyping.current, typing);
      if (ev.length) pushEvents(ev);
    }
    prevTyping.current = typing;
  }, [typing]);
  return null;
}
