/**
 * Vínculo com o Piu Desktop (modelo WhatsApp Web clássico): o celular continua dono da identidade e
 * das chaves; o computador é uma tela remota, cifrada, pela rede local. TypeScript PURO (sem React
 * Native): o app importa daqui e o Piu Desktop (apps/desktop) pode importar por caminho relativo.
 *
 * Protocolo (v1):
 * 1. O desktop mostra o QR `piu-link:1?h=<ip>:<porta>&k=<X25519 pública base64url>&s=<id da sessão,
 *    16 bytes base64url>&c=<SHA-256 do certificado TLS em DER, base64url>` e renova a cada 30 s.
 * 2. O celular lê o QR, abre `wss://h` aceitando SÓ o certificado cujo SHA-256 é `c` (pino; sem
 *    autoridade nem conferência de nome, o host é um IP) e manda, dentro do TLS, `{t:'hello', v:1, s, pk}`
 *    com a sua chave X25519 efêmera. Android de release não permite `ws://` em claro: por isso TLS.
 * 3. Os dois lados: shared = X25519; okm = HKDF-SHA256(ikm = shared, salt = s, info = "piu/v1/desktop-link",
 *    64 bytes); k_c2d = okm[0..32] (celular → desktop), k_d2c = okm[32..64] (desktop → celular).
 *    Palavras de conferência: as 3 primeiras de `codeWords(SHA-256(s ‖ pk_desktop ‖ pk_celular ‖ c)[0..8])`
 *    (mesma lista e mesmos 11 bits por palavra do convite, que usa 4); `c` amarra o canal TLS ao QR.
 *    A pessoa confere nos dois.
 * 4. Daí em diante todo quadro é XChaCha20-Poly1305 com contador por sentido:
 *    header = 0x01 ‖ u64be(n); nonce = 16 zeros ‖ u64be(n); AD = header; wire = base64url(header ‖ ct),
 *    mandado como mensagem de TEXTO do WebSocket (funciona igual em RN, navegador, Electron e Node).
 *    Quadro adulterado, repetido ou fora de ordem mata a sessão (FrameOpener fica morto).
 * 5. Celular → desktop: `snapshot` (contatos, conversas, últimas N mensagens, sem chaves), `event`
 *    (mensagem nova/alterada, estado de envio, conversa alterada, digitando), `ack`. Desktop → celular:
 *    `cmd` (`send`, `read`, `typing`) e, opcionalmente, `ready` com o nome do computador.
 *
 * Por que é seguro: a chave pública do desktop chega pela CÂMERA (canal autêntico), então ninguém na
 * mesma Wi-Fi consegue ler o que o celular manda — só quem tem a chave privada que gerou o QR. Quem
 * se meter no caminho (trocando o hello) muda as palavras no desktop; a pessoa compara e cancela.
 */
import type { Chat, Msg } from '../data/types';
import { b64url, unb64url } from '../messaging/card';
import { concat, equal, fromUtf8, utf8 } from '../protocol/bytes';
import { aead, agree, hash, kdf, random } from '../protocol/suite';
import { codeWords } from './migration';

export const LINK_VERSION = 1;
export const LINK_PREFIX = 'piu-link:';
export const LINK_INFO = 'piu/v1/desktop-link';
export const LINK_WORDS = 3;
export const SESSION_BYTES = 16;
export const KEY_BYTES = 32;
/** SHA-256 do certificado DER do desktop (pino do TLS). */
export const CERT_HASH_BYTES = 32;
/** Teto de um quadro (header + cifra), conferido antes de decodificar. */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
/** Mesmo limite de texto do mensageiro (messaging/messenger.ts). */
export const MAX_TEXT = 4000;
/** Últimas mensagens por conversa no snapshot. */
export const SNAPSHOT_MSGS = 50;
const MAX_ID = 64;
const FRAME_VERSION = 1;
const HEADER_BYTES = 9;
const TAG_BYTES = 16;
const NONCE_BYTES = 24;

export class DesktopLinkError extends Error {
  constructor(public code: 'FORMAT' | 'VERSION' | 'AUTH' | 'ORDER' | 'SIZE' | 'STATE', message: string) { super(message); this.name = 'DesktopLinkError'; }
}

// ── QR ─────────────────────────────────────────────────────────────

export interface LinkOffer { v: number; host: string; port: number; pk: Uint8Array; session: Uint8Array; /** SHA-256 do certificado TLS (DER). */ cert: Uint8Array }

const HOST_RE = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/;
const OCTET = '(0|[1-9]\\d{0,2})';
const IPV4_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/**
 * O computador do vínculo está na mesma rede: só IP literal privado ou link-local (10/8, 172.16/12,
 * 192.168/16, 169.254/16, 100.64/10, fe80::/10, fc00::/7). Nome DNS, IP público, loopback e 0.0.0.0
 * ficam de fora: um QR de outra pessoa não leva o celular a um servidor na internet (QRLjacking).
 * IPv4 só em decimal sem zero à esquerda (nada de octal, hexadecimal, inteiro ou forma curta).
 */
function isLocalHost(host: string): boolean {
  if (host.startsWith('[')) {
    const a = host.slice(1, -1).toLowerCase();
    if (a.includes('.') || a.includes(':::')) return false;
    const halves = a.split('::');
    if (halves.length > 2) return false;
    const groups = halves.flatMap(h => (h ? h.split(':') : []));
    if (!groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return false;
    if (halves.length === 1 ? groups.length !== 8 : groups.length > 7) return false;
    if (!halves[0] || groups[0]!.length !== 4) return false;
    const first = parseInt(groups[0]!, 16);
    return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00;
  }
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
const isZero = (b: Uint8Array) => b.every(x => x === 0);

function fromB64(s: string, len: number, what: string): Uint8Array {
  let b: Uint8Array;
  try { b = unb64url(s); } catch { throw new DesktopLinkError('FORMAT', `${what} ilegível.`); }
  if (b.length !== len) throw new DesktopLinkError('FORMAT', `${what} com tamanho errado.`);
  return b;
}

/** Lê o QR do computador. Lança DesktopLinkError (FORMAT, VERSION ou AUTH) com mensagem em português. */
export function parseLinkQr(text: string): LinkOffer {
  const t = text.trim();
  if (!t.startsWith(LINK_PREFIX)) throw new DesktopLinkError('FORMAT', 'Este QR não é do Piu Desktop. No computador, abra o Piu e escolha "Conectar celular".');
  const q = t.indexOf('?');
  if (q < 0) throw new DesktopLinkError('FORMAT', 'QR incompleto. Tente de novo.');
  const ver = t.slice(LINK_PREFIX.length, q);
  if (!/^\d+$/.test(ver)) throw new DesktopLinkError('FORMAT', 'QR ilegível. Tente de novo.');
  if (Number(ver) !== LINK_VERSION) throw new DesktopLinkError('VERSION', 'Versão do Piu diferente no computador e no celular. Atualize os dois.');
  const params = new Map<string, string>();
  for (const part of t.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const h = params.get('h'), k = params.get('k'), s = params.get('s'), cert = params.get('c');
  if (!h || !k || !s || !cert) throw new DesktopLinkError('FORMAT', 'QR incompleto. No computador, gere outro.');
  const colon = h.lastIndexOf(':');
  if (colon < 1) throw new DesktopLinkError('FORMAT', 'Endereço do computador inválido.');
  const host = h.slice(0, colon), portS = h.slice(colon + 1);
  if (!HOST_RE.test(host) || host.length > 253 || !/^\d{1,5}$/.test(portS)) throw new DesktopLinkError('FORMAT', 'Endereço do computador inválido.');
  if (!isLocalHost(host)) throw new DesktopLinkError('FORMAT', 'Este QR aponta para fora da sua rede. O computador e o celular precisam estar na mesma rede Wi-Fi.');
  const port = Number(portS);
  if (port < 1 || port > 65535) throw new DesktopLinkError('FORMAT', 'Porta inválida no QR.');
  const pk = fromB64(k, KEY_BYTES, 'Chave do computador');
  if (isZero(pk)) throw new DesktopLinkError('AUTH', 'Chave do computador inválida.');
  return { v: LINK_VERSION, host, port, pk, session: fromB64(s, SESSION_BYTES, 'Id da sessão'), cert: fromB64(cert, CERT_HASH_BYTES, 'Certificado do computador') };
}

/** Texto do QR (o desktop gera; aqui serve aos testes e à demonstração). */
export const encodeLinkQr = (o: { host: string; port: number; pk: Uint8Array; session: Uint8Array; cert: Uint8Array }) =>
  `${LINK_PREFIX}${LINK_VERSION}?h=${o.host}:${o.port}&k=${b64url(o.pk)}&s=${b64url(o.session)}&c=${b64url(o.cert)}`;

/** Sempre TLS: o certificado é autoassinado e fixado por `certPin`. */
export const wsUrl = (o: LinkOffer) => `wss://${o.host}:${o.port}`;
/** Pino no formato do módulo nativo piu-node-link (`AA:BB:…`, SHA-256 do certificado DER). */
export const certPin = (o: LinkOffer) => Array.from(o.cert, b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();

// ── handshake ─────────────────────────────────────────────────────

export interface Hello { t: 'hello'; v: number; s: string; pk: string }
/** Chaves de um lado: `send` cifra o que sai, `recv` abre o que chega. */
export interface LinkKeys { send: Uint8Array; recv: Uint8Array }

/** HKDF sobre o segredo X25519 (salt = id da sessão); cada sentido tem a sua chave. */
export function deriveKeys(shared: Uint8Array, session: Uint8Array, role: 'phone' | 'desktop'): LinkKeys {
  if (shared.length !== KEY_BYTES || isZero(shared)) throw new DesktopLinkError('AUTH', 'Chave efêmera inválida.');
  const okm = kdf(shared, session, LINK_INFO, 2 * KEY_BYTES);
  const c2d = okm.slice(0, KEY_BYTES), d2c = okm.slice(KEY_BYTES);
  return role === 'phone' ? { send: c2d, recv: d2c } : { send: d2c, recv: c2d };
}

/** 3 palavras da transcrição pública: s ‖ pk_desktop ‖ pk_celular ‖ SHA-256(certificado). */
export const linkWords = (session: Uint8Array, pkDesktop: Uint8Array, pkPhone: Uint8Array, cert: Uint8Array) =>
  codeWords(hash(concat(session, pkDesktop, pkPhone, cert)).slice(0, 8)).slice(0, LINK_WORDS);

function shared(sk: Uint8Array, pk: Uint8Array): Uint8Array {
  try { return agree.shared(sk, pk); } catch { throw new DesktopLinkError('AUTH', 'Chave efêmera inválida.'); }
}

/** Celular: gera o par efêmero, o `hello` (JSON em claro), as chaves e as palavras. `wipe()` ao terminar. */
export function phoneHandshake(offer: LinkOffer, sk: Uint8Array = random(KEY_BYTES)): { hello: Hello; keys: LinkKeys; words: string[]; wipe: () => void } {
  const pk = agree.publicKey(sk);
  const keys = deriveKeys(shared(sk, offer.pk), offer.session, 'phone');
  const words = linkWords(offer.session, offer.pk, pk, offer.cert);
  const hello: Hello = { t: 'hello', v: LINK_VERSION, s: b64url(offer.session), pk: b64url(pk) };
  sk.fill(0); // só o segredo compartilhado interessa daqui em diante
  return { hello, keys, words, wipe: () => { keys.send.fill(0); keys.recv.fill(0); } };
}

/** Desktop: lê o `hello` do celular. Lança FORMAT, VERSION ou AUTH (sessão diferente / chave inválida). */
export function parseHello(text: string, expectedSession: Uint8Array): { session: Uint8Array; pk: Uint8Array } {
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new DesktopLinkError('FORMAT', 'hello ilegível.'); }
  if (!o || typeof o !== 'object' || (o as Hello).t !== 'hello') throw new DesktopLinkError('FORMAT', 'Esperava um hello.');
  const h = o as Partial<Hello>;
  if (typeof h.v !== 'number') throw new DesktopLinkError('FORMAT', 'hello sem versão.');
  if (h.v !== LINK_VERSION) throw new DesktopLinkError('VERSION', 'Versão do Piu diferente no computador e no celular. Atualize os dois.');
  if (typeof h.s !== 'string' || typeof h.pk !== 'string') throw new DesktopLinkError('FORMAT', 'hello incompleto.');
  const session = fromB64(h.s, SESSION_BYTES, 'Id da sessão');
  if (!equal(session, expectedSession)) throw new DesktopLinkError('AUTH', 'Este QR já foi renovado. Leia o QR de novo.');
  const pk = fromB64(h.pk, KEY_BYTES, 'Chave do celular');
  if (isZero(pk)) throw new DesktopLinkError('AUTH', 'Chave do celular inválida.');
  return { session, pk };
}

/** Desktop: a partir da chave privada do QR, do hash do próprio certificado e do `hello`, as chaves e as palavras (iguais às do celular). */
export function desktopHandshake(skDesktop: Uint8Array, session: Uint8Array, cert: Uint8Array, helloText: string): { keys: LinkKeys; words: string[]; pkPhone: Uint8Array } {
  const { pk } = parseHello(helloText, session);
  const keys = deriveKeys(shared(skDesktop, pk), session, 'desktop');
  return { keys, words: linkWords(session, agree.publicKey(skDesktop), pk, cert), pkPhone: pk };
}

// ── quadros ───────────────────────────────────────────────────────

function u64be(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { b[i] = Number(n & 0xffn); n >>= 8n; }
  return b;
}
function readU64be(b: Uint8Array, off: number): bigint {
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[off + i]!);
  return n;
}
const nonceFor = (n: bigint) => concat(new Uint8Array(NONCE_BYTES - 8), u64be(n));
const MAX_COUNTER = (1n << 64n) - 1n;

/** Cifra os quadros de um sentido (contador começa em 0). */
export class FrameSealer {
  private n = 0n;
  constructor(private key: Uint8Array) {}
  get counter() { return this.n; }
  seal(msg: LinkMessage): string {
    if (this.n > MAX_COUNTER) throw new DesktopLinkError('STATE', 'Contador esgotado.');
    const body = utf8(JSON.stringify(msg));
    if (body.length + HEADER_BYTES + TAG_BYTES > MAX_FRAME_BYTES) throw new DesktopLinkError('SIZE', 'Mensagem grande demais para um quadro.');
    const header = concat(Uint8Array.of(FRAME_VERSION), u64be(this.n));
    const ct = aead.seal(this.key, nonceFor(this.n), body, header);
    this.n += 1n;
    return b64url(concat(header, ct));
  }
}

/** Abre os quadros de um sentido. Qualquer erro mata a sessão: os quadros seguintes dão STATE. */
export class FrameOpener {
  private n = 0n;
  private dead = false;
  constructor(private key: Uint8Array) {}
  get counter() { return this.n; }
  get isDead() { return this.dead; }
  private kill(code: DesktopLinkError['code'], message: string): never { this.dead = true; throw new DesktopLinkError(code, message); }
  open(wire: string): LinkMessage {
    if (this.dead) throw new DesktopLinkError('STATE', 'Sessão encerrada.');
    if (typeof wire !== 'string' || !/^[A-Za-z0-9_-]+$/.test(wire)) this.kill('FORMAT', 'Quadro ilegível.');
    if (Math.floor((wire.length * 3) / 4) > MAX_FRAME_BYTES) this.kill('SIZE', 'Quadro grande demais.');
    const raw = unb64url(wire);
    if (raw.length < HEADER_BYTES + TAG_BYTES) this.kill('FORMAT', 'Quadro curto demais.');
    if (raw[0] !== FRAME_VERSION) this.kill('VERSION', 'Versão de quadro desconhecida.');
    const n = readU64be(raw, 1);
    if (n !== this.n) this.kill('ORDER', 'Quadro fora de ordem.');
    const header = raw.slice(0, HEADER_BYTES);
    const pt = aead.open(this.key, nonceFor(n), raw.slice(HEADER_BYTES), header);
    if (!pt) this.kill('AUTH', 'Quadro adulterado ou de outra sessão.');
    let msg: unknown;
    try { msg = JSON.parse(fromUtf8(pt)); } catch { this.kill('FORMAT', 'Conteúdo ilegível.'); }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') this.kill('FORMAT', 'Mensagem sem tipo.');
    this.n += 1n;
    return msg as LinkMessage;
  }
}

// ── mensagens ─────────────────────────────────────────────────────

/** Arquivo como viaja para o desktop: sem conteúdo nem prévia (o desktop não guarda mídia nesta versão). */
export interface LinkFile { name: string; mb: number; icon: 'image' | 'description'; state: string; done: number; blocks: number; incoming?: boolean; held?: boolean }
export interface LinkMsg {
  id: string; from: Msg['from']; text: string; time: string; status?: Msg['status']; at?: number; sender?: string; expiresAt?: number;
  loc?: { lat: number; lon: number }; file?: LinkFile;
}
export interface LinkChat {
  id: string; ident: Chat['ident']; kind: Chat['kind']; name: string; initials: string; time: string; unread: number;
  sub?: string; peer?: string; group?: string; muted?: boolean; request?: boolean; photo?: string; owner?: boolean; temp?: Chat['temp'];
  /** Endereço Lunes que o contato compartilhou (destinatário na Carteira do computador). */
  lunes?: string;
}
export interface LinkContact { id: string; chatId: string; name: string; verified: boolean; lunes?: string }
export interface Snapshot {
  t: 'snapshot'; contacts: LinkContact[]; chats: LinkChat[]; messages: Record<string, LinkMsg[]>;
  /** Endereço Lunes deste celular: o computador mostra no Receber e usa como origem do Enviar. */
  wallet?: string;
}
export type LinkEvent = { t: 'event' } & (
  | { k: 'message'; chatId: string; msg: LinkMsg }
  | { k: 'status'; chatId: string; msgId: string; status: Msg['status'] }
  | { k: 'messageRemoved'; chatId: string; msgId: string }
  | { k: 'chat'; chat: LinkChat }
  | { k: 'chatRemoved'; chatId: string }
  | { k: 'typing'; chatId: string; on: boolean }
);
export type Command = { op: 'send'; chatId: string; text: string; ref?: string } | { op: 'read' | 'typing'; chatId: string; ref?: string };
export type PhoneMessage = Snapshot | LinkEvent | { t: 'payment_status'; id: string; status: import('./desktopPayment').DesktopPaymentStatus; hash?: string; error?: string } | { t: 'ack'; ref?: string; ok: boolean; error?: string } | { t: 'ping' } | { t: 'pong' } | { t: 'bye'; reason?: string };
export type DesktopMessage = { t: 'payment_request'; id: string; expectedFrom: string; dest: string; amount: string } | ({ t: 'cmd' } & Command) | { t: 'ready'; name?: string } | { t: 'ping' } | { t: 'pong' } | { t: 'bye'; reason?: string };
export type LinkMessage = PhoneMessage | DesktopMessage;

const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;

/** Valida um comando vindo do desktop (nunca confie no outro lado). Lança FORMAT. */
export function parseCommand(x: unknown): Command {
  if (!x || typeof x !== 'object') throw new DesktopLinkError('FORMAT', 'Comando ilegível.');
  const c = x as Record<string, unknown>;
  if (c.t !== 'cmd' || !isId(c.chatId)) throw new DesktopLinkError('FORMAT', 'Comando incompleto.');
  if (c.ref !== undefined && !isId(c.ref)) throw new DesktopLinkError('FORMAT', 'Referência inválida.');
  const ref = typeof c.ref === 'string' ? { ref: c.ref } : {};
  if (c.op === 'read' || c.op === 'typing') return { op: c.op, chatId: c.chatId, ...ref };
  if (c.op === 'send') {
    if (typeof c.text !== 'string') throw new DesktopLinkError('FORMAT', 'Mensagem sem texto.');
    const text = c.text.trim().slice(0, MAX_TEXT);
    if (!text) throw new DesktopLinkError('FORMAT', 'Mensagem vazia.');
    return { op: 'send', chatId: c.chatId, text, ...ref };
  }
  throw new DesktopLinkError('FORMAT', 'Comando desconhecido.');
}

/** Só o que viaja: nem prévia (`preview`), nem `real`/`lost`/`purged`/`pausedOnce` (estado interno do app). */
function linkFile(f: NonNullable<Msg['file']>): LinkFile {
  return { name: f.name, mb: f.mb, icon: f.icon, state: f.state, done: f.done, blocks: f.blocks, ...(f.incoming ? { incoming: true } : {}), ...(f.held ? { held: true } : {}) };
}
export function linkMsg(m: Msg): LinkMsg {
  return {
    id: m.id, from: m.from, text: m.text, time: m.time,
    ...(m.status !== undefined ? { status: m.status } : {}), ...(m.at !== undefined ? { at: m.at } : {}), ...(m.sender !== undefined ? { sender: m.sender } : {}),
    ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}), ...(m.loc ? { loc: { lat: m.loc.lat, lon: m.loc.lon } } : {}), ...(m.file ? { file: linkFile(m.file) } : {}),
  };
}
export function linkChat(c: Chat): LinkChat {
  const opt = <K extends keyof LinkChat>(k: K, v: LinkChat[K]) => (v !== undefined ? { [k]: v } : {});
  return {
    id: c.id, ident: c.ident, kind: c.kind, name: c.name, initials: c.initials, time: c.time, unread: c.unread,
    ...opt('sub', c.sub), ...opt('peer', c.peer), ...opt('group', c.group), ...opt('muted', c.muted), ...opt('request', c.request), ...opt('photo', c.photo), ...opt('owner', c.owner), ...opt('temp', c.temp), ...opt('lunes', c.lunes),
  };
}

/** Estado inicial para o desktop: contatos (das conversas diretas), conversas e as últimas `limit` mensagens de cada. */
export function buildSnapshot(chats: Chat[], verified: Record<string, boolean>, limit = SNAPSHOT_MSGS, wallet?: string | null): Snapshot {
  const messages: Record<string, LinkMsg[]> = {};
  for (const c of chats) messages[c.id] = (c.msgs ?? []).slice(-limit).map(linkMsg);
  return {
    t: 'snapshot',
    contacts: chats.filter(c => c.peer).map(c => ({ id: c.peer!, chatId: c.id, name: c.name, verified: !!verified[c.id], ...(c.lunes ? { lunes: c.lunes } : {}) })),
    chats: chats.map(linkChat),
    messages,
    ...(wallet ? { wallet } : {}),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sansStatus = ({ status: _s, ...rest }: LinkMsg) => rest;

/**
 * Eventos entre dois estados das conversas (o app observa `chats` do store e manda só a diferença).
 * Ordem: conversas antigas (alteradas/removidas, com as mensagens), depois as novas.
 */
export function diffChats(prev: Chat[], next: Chat[], limit = SNAPSHOT_MSGS): LinkEvent[] {
  const out: LinkEvent[] = [];
  const nextById = new Map(next.map(c => [c.id, c]));
  const prevIds = new Set(prev.map(c => c.id));
  for (const p of prev) {
    const n = nextById.get(p.id);
    if (!n) { out.push({ t: 'event', k: 'chatRemoved', chatId: p.id }); continue; }
    const pc = linkChat(p), nc = linkChat(n);
    if (!same(pc, nc)) out.push({ t: 'event', k: 'chat', chat: nc });
    const window = (n.msgs ?? []).slice(-limit);
    const nextAll = new Set((n.msgs ?? []).map(m => m.id));
    const nextWin = new Map(window.map(m => [m.id, m]));
    const prevById = new Map((p.msgs ?? []).map(m => [m.id, m]));
    for (const pm of p.msgs ?? []) {
      if (!nextAll.has(pm.id)) { out.push({ t: 'event', k: 'messageRemoved', chatId: p.id, msgId: pm.id }); continue; }
      const nm = nextWin.get(pm.id);
      if (!nm) continue;
      const a = linkMsg(pm), b = linkMsg(nm);
      if (same(a, b)) continue;
      if (same(sansStatus(a), sansStatus(b))) out.push({ t: 'event', k: 'status', chatId: p.id, msgId: nm.id, status: nm.status });
      else out.push({ t: 'event', k: 'message', chatId: p.id, msg: b });
    }
    for (const nm of window) if (!prevById.has(nm.id)) out.push({ t: 'event', k: 'message', chatId: p.id, msg: linkMsg(nm) });
  }
  for (const n of next) {
    if (prevIds.has(n.id)) continue;
    out.push({ t: 'event', k: 'chat', chat: linkChat(n) });
    for (const m of (n.msgs ?? []).slice(-limit)) out.push({ t: 'event', k: 'message', chatId: n.id, msg: linkMsg(m) });
  }
  return out;
}

/** "Digitando…" que começou ou parou. */
export function diffTyping(prev: Record<string, boolean>, next: Record<string, boolean>): LinkEvent[] {
  const out: LinkEvent[] = [];
  for (const id of Object.keys(prev)) if (prev[id] && !next[id]) out.push({ t: 'event', k: 'typing', chatId: id, on: false });
  for (const id of Object.keys(next)) if (next[id] && !prev[id]) out.push({ t: 'event', k: 'typing', chatId: id, on: true });
  return out;
}
