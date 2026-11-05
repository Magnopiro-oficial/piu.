/**
 * Transporte LAN do Piu Desktop: LNNP v1 pela rede local, o mesmo enlace que o piu-node fala
 * (docs/lnnp/especificacao-v1.md; adapter de referência em apps/piu-node/src/relay/lan.ts).
 *
 * - Descoberta: anúncio UDP de 18 bytes (`encodeBeacon`) a cada `beaconMs` para cada destino de
 *   `broadcast`. Quem recebe conecta só se a SUA etiqueta for menor (uma conexão por par).
 * - Vizinhos fixos (`host:porta`): da configuração ou adicionados na tela Rede; reconectam sozinhos.
 * - Enlace TCP: quadros com prefixo u32; handshake HELLO/AUTH (assinado pela chave técnica do nó);
 *   depois só registros cifrados (XChaCha20-Poly1305 por sentido). Qualquer erro fecha a conexão.
 * - Envelopes maiores que o MTU negociado vão em fragmentos (fragment.ts), se o vizinho aceitar.
 *
 * O que sobe daqui para a camada de mensagens são só os bytes do envelope (FrameType.Envelope);
 * recibos de retransmissão e quadros do operador (coisa de nó) são ignorados: este é um aparelho
 * de pessoa, com identidade, não um nó do provider.
 */
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect, createServer, isIPv4, isIPv6, type Server, type Socket } from 'node:net';
import { toHex } from '../../../mobile/src/protocol/bytes';
import { fragment, Reassembler } from '../../../mobile/src/protocol/fragment';
import type { KeyPair } from '../../../mobile/src/protocol/keys';
import {
  compareBytes, decodeBeacon, defaultCapabilities, encodeBeacon, errorFrame, Feature, FrameType, Handshake, type LinkSession, LNNP_MIN_VERSION, LNNP_VERSION,
  LnnpError, LnnpErrorCode, MAX_FRAME_BYTES, Medium, nodeTag, RECORD_OVERHEAD, ReplayGuard,
} from '../../../mobile/src/protocol/lnnp';
import type { PeerInfo, PeerState, TransportState } from '../shared/types';
import type { Transport, TransportEvent } from './types';

export interface LanTransportOptions {
  /** Chave técnica do nó (`deriveNodeKey`), nunca a identidade social. */
  node: KeyPair;
  /** Endereço de escuta do enlace TCP. Padrão: todas as interfaces. */
  listen?: string;
  /** Porta TCP do enlace (0 = aleatória). Padrão: 8422, a do piu-node. */
  port?: number;
  /** Porta UDP da descoberta (`null` desliga). Padrão: 8423. */
  discoveryPort?: number | null;
  /** Destinos do anúncio: `endereço` ou `endereço:porta`. Padrão: broadcast da rede local. */
  broadcast?: string[];
  /** Vizinhos fixos iniciais (`host:porta`). */
  peers?: string[];
  beaconMs?: number;
  handshakeTimeoutMs?: number;
  /** Anuncia que retransmite envelopes de terceiros (Modo nó). */
  relay?: boolean;
  /** MTU anunciado (testes de fragmentação). Padrão: o maior quadro do LNNP. */
  mtu?: number;
  /** Relógio em segundos (testes). */
  now?: () => number;
  log?: (msg: string) => void;
  maxLinks?: number;
  maxPending?: number;
}

export const LNNP_DEFAULT_PORT = 8422;
export const LNNP_DEFAULT_DISCOVERY_PORT = 8423;
const HANDSHAKE_MAX = 4096;
export const MAX_MANUAL_PEERS = 32;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);

/**
 * Endereço digitado na tela Rede: só `host:porta` (nome, IPv4 ou `[IPv6]`), porta 1–65535 obrigatória.
 * Devolve a forma canônica (minúsculas, IPv6 entre colchetes) ou `null`. Mesma regra do piu-node.
 */
export function parsePeerAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > 262 || /[\s/@?#%\\]/.test(s)) return null;
  const v6 = /^\[([0-9a-f:.]+)\]:([0-9]+)$/.exec(s);
  const m = v6 ?? /^([^:[\]]+):([0-9]+)$/.exec(s);
  if (!m) return null;
  const host = m[1] ?? '', portStr = m[2] ?? '';
  if (!/^[1-9][0-9]{0,4}$/.test(portStr) || Number(portStr) > 65535) return null;
  if (v6) {
    if (!isIPv6(host) || host === '::') return null;
    return `[${host}]:${portStr}`;
  }
  if (/^[0-9.]+$/.test(host)) {
    if (!isIPv4(host) || host === '0.0.0.0' || host === '255.255.255.255') return null;
  } else if (!HOSTNAME.test(host)) return null;
  return `${host}:${portStr}`;
}

/** Motivo legível para um erro de conexão TCP. */
function connectError(e: NodeJS.ErrnoException): string {
  switch (e.code) {
    case 'ECONNREFUSED': return 'conexão recusada (nada escutando nessa porta)';
    case 'ETIMEDOUT': return 'sem resposta (tempo esgotado)';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'endereço inalcançável a partir deste computador';
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'nome não encontrado na rede local';
    case 'ECONNRESET': return 'conexão encerrada pelo outro lado';
    default: return e.code ? `erro de rede (${e.code})` : e.message || 'erro de rede';
  }
}

function splitHostPort(s: string, defPort: number): { host: string; port: number } {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim());
  if (!m || !m[1]) throw new Error(`Endereço inválido: ${s}`);
  if (m[1].includes(':') && !s.includes('[')) return { host: s.trim(), port: defPort };
  return { host: m[1], port: m[2] ? Number(m[2]) : defPort };
}

/** Separa o fluxo TCP em quadros (u32 de tamanho + bytes), com limite. */
class Deframer {
  private buf: Buffer = Buffer.alloc(0);
  max = HANDSHAKE_MAX;
  push(chunk: Buffer): Uint8Array[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Uint8Array[] = [];
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32BE(0);
      if (n === 0 || n > this.max) throw new LnnpError(LnnpErrorCode.TooLarge, 'Quadro grande demais.');
      if (this.buf.length < 4 + n) break;
      out.push(new Uint8Array(this.buf.subarray(4, 4 + n)));
      this.buf = this.buf.subarray(4 + n);
    }
    return out;
  }
}

function writeFrame(sock: Socket, bytes: Uint8Array) {
  if (sock.destroyed) return;
  const h = Buffer.alloc(4);
  h.writeUInt32BE(bytes.length);
  sock.write(Buffer.concat([h, bytes]));
}

/** Enlace autenticado com um vizinho. */
interface Link {
  id: string;
  session: LinkSession;
  sock: Socket;
  inbound: boolean;
  address: string;
  since: number;
  reassembler: Reassembler | null;
}

interface DialInfo { error: string | null; errorAt: number | null; attempts: number }

export class LnnpLanTransport implements Transport {
  readonly kind = 'lan' as const;
  state: TransportState = 'off';
  reason?: string;
  port = 0;
  discoveryPort: number | null = null;
  /** Id curto deste nó (como os vizinhos o veem). */
  readonly nodeId: string;
  readonly tag: Uint8Array;

  private server: Server | null = null;
  private udp: UdpSocket | null = null;
  private timers: NodeJS.Timeout[] = [];
  private sockets = new Set<Socket>();
  private links = new Map<string, Link>();
  private pending = 0;
  private seq = 0;
  private replay = new ReplayGuard();
  /** Destinos em conexão ou conectados por este nó (chave host:porta). */
  private outbound = new Map<string, Socket>();
  /** Nó (id) que respondeu em cada destino. */
  private peerOf = new Map<string, string>();
  private configPeers: string[];
  private manualPeers: string[] = [];
  private dialInfo = new Map<string, DialInfo>();
  private subs = new Set<(e: TransportEvent) => void>();
  private stopped = false;
  private relay: boolean;

  constructor(private o: LanTransportOptions) {
    this.nodeId = toHex(o.node.pk).slice(0, 16);
    this.tag = nodeTag(o.node.pk);
    this.configPeers = [...(o.peers ?? [])];
    this.relay = o.relay ?? false;
  }

  get linkCount() { return this.links.size; }

  subscribe(fn: (e: TransportEvent) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit(e: TransportEvent) { for (const fn of this.subs) { try { fn(e); } catch (err) { this.o.log?.(`LAN: ouvinte falhou (${(err as Error).message})`); } } }
  private setState(state: TransportState, reason?: string) { this.state = state; this.reason = reason; this.emit({ type: 'state', state, reason }); }
  private now() { return this.o.now ? this.o.now() : Math.floor(Date.now() / 1000); }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;
    this.stopped = false;
    this.setState('starting');
    const listen = this.o.listen ?? '0.0.0.0';
    try {
      this.server = createServer(sock => this.handle(sock, true, `${sock.remoteAddress}:${sock.remotePort}`));
      this.server.maxConnections = (this.o.maxLinks ?? 64) + (this.o.maxPending ?? 16);
      const listenOn = (port: number) => new Promise<void>((res, rej) => {
        this.server!.once('error', rej);
        this.server!.listen(port, listen, () => { this.server!.off('error', rej); res(); });
      });
      const wanted = this.o.port ?? LNNP_DEFAULT_PORT;
      try { await listenOn(wanted); } catch (e) {
        // Porta padrão ocupada (um piu-node ou outro Piu neste computador): usa uma porta livre.
        // O anúncio UDP leva a porta real, então a descoberta continua funcionando.
        if (!(wanted && (e as NodeJS.ErrnoException).code === 'EADDRINUSE')) throw e;
        this.o.log?.(`LAN: porta ${wanted} em uso; usando uma porta livre`);
        await listenOn(0);
      }
      const a = this.server.address();
      this.port = typeof a === 'object' && a ? a.port : (this.o.port ?? LNNP_DEFAULT_PORT);

      const dp = this.o.discoveryPort === undefined ? LNNP_DEFAULT_DISCOVERY_PORT : this.o.discoveryPort;
      if (dp !== null) {
        const udp = createSocket({ type: 'udp4', reuseAddr: true });
        this.udp = udp;
        udp.on('message', (msg, rinfo) => this.onBeacon(msg, rinfo.address));
        udp.on('error', e => this.o.log?.(`LAN: descoberta: ${e.message}`));
        await new Promise<void>((res, rej) => { udp.once('error', rej); udp.bind(dp, listen.includes(':') ? undefined : listen, () => { udp.off('error', rej); res(); }); });
        udp.setBroadcast(true);
        this.discoveryPort = udp.address().port;
      }
    } catch (e) {
      await this.stop();
      const msg = e instanceof Error ? e.message : String(e);
      this.setState('unavailable', /EADDRINUSE/.test(msg) ? `porta ${this.o.port ?? LNNP_DEFAULT_PORT} já em uso (outro Piu ou piu-node neste computador?)` : msg);
      return;
    }
    const every = (ms: number, fn: () => void) => { const t = setInterval(fn, ms); t.unref(); this.timers.push(t); };
    every(this.o.beaconMs ?? 5000, () => { this.beacon(); this.dialPeers(); });
    this.beacon();
    this.dialPeers();
    this.setState('running');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.sockets) s.destroy();
    for (const s of this.outbound.values()) s.destroy();
    this.outbound.clear();
    this.udp?.close();
    this.udp = null;
    await new Promise<void>(res => (this.server ? this.server.close(() => res()) : res()));
    this.server = null;
    this.links.clear();
    if (this.state !== 'unavailable') this.setState('off');
  }

  setRelay(relay: boolean) { this.relay = relay; }

  // ── vizinhos ──────────────────────────────────────────────
  private fixedPeers(): { address: string; source: 'config' | 'manual' }[] {
    const out: { address: string; source: 'config' | 'manual' }[] = this.configPeers.map(address => ({ address, source: 'config' }));
    for (const address of this.manualPeers) if (!out.some(p => p.address === address)) out.push({ address, source: 'manual' });
    return out;
  }
  hasPeerAddress(address: string) { return this.configPeers.includes(address) || this.manualPeers.includes(address); }

  /** Vizinho fixo (já validado por `parsePeerAddress`): conecta na hora e reconecta a cada `beaconMs`. */
  addPeer(address: string) {
    if (!this.hasPeerAddress(address)) {
      if (this.manualPeers.length >= MAX_MANUAL_PEERS) throw new Error(`No máximo ${MAX_MANUAL_PEERS} vizinhos adicionados manualmente.`);
      this.manualPeers.push(address);
      this.dialInfo.delete(address);
      this.emit({ type: 'peers' });
    }
    if (this.state === 'running') this.dial(address);
  }

  removePeer(address: string): boolean {
    const i = this.manualPeers.indexOf(address);
    if (i < 0) return false;
    this.manualPeers.splice(i, 1);
    if (!this.configPeers.includes(address)) {
      this.dialInfo.delete(address);
      this.outbound.get(address)?.destroy();
      this.outbound.delete(address);
      this.peerOf.delete(address);
    }
    this.emit({ type: 'peers' });
    return true;
  }

  private noteError(address: string, reason: string) {
    const d = this.dialInfo.get(address);
    if (d) { d.error = reason; d.errorAt = Date.now(); this.emit({ type: 'peers' }); }
  }

  private linkOfPeer(peerId: string): Link | null {
    for (const l of this.links.values()) if (l.session.peerId === peerId) return l;
    return null;
  }

  private statusOf(address: string, source: 'config' | 'manual'): PeerInfo {
    const d = this.dialInfo.get(address) ?? { error: null, errorAt: null, attempts: 0 };
    const id = this.peerOf.get(address);
    const link = id ? this.linkOfPeer(id) : null;
    const base = { address, source, error: d.error, attempts: d.attempts };
    if (link && id) return { ...base, state: 'connected', nodeId: id, pk: toHex(link.session.peerPk), since: link.since };
    const state: PeerState = this.outbound.has(address) || !d.error ? 'connecting' : 'failed';
    return { ...base, state, nodeId: id ?? null, pk: null, since: null };
  }

  /** Vizinhos fixos (configuração e manuais) e os descobertos/entrantes conectados agora. */
  peerStatus(): PeerInfo[] {
    const fixed = this.fixedPeers().map(p => this.statusOf(p.address, p.source));
    const fixedIds = new Set(fixed.map(p => p.nodeId).filter(Boolean));
    const discovered: PeerInfo[] = [];
    for (const l of this.links.values()) {
      if (fixedIds.has(l.session.peerId)) continue;
      discovered.push({ address: l.address, source: 'discovered', state: 'connected', nodeId: l.session.peerId, pk: toHex(l.session.peerPk), since: l.since, error: null, attempts: 0 });
    }
    return [...fixed, ...discovered];
  }

  // ── descoberta ────────────────────────────────────────────
  private beacon() {
    if (!this.udp || this.stopped) return;
    const msg = encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port: this.port, tag: this.tag, relay: this.relay });
    for (const t of this.o.broadcast ?? ['255.255.255.255']) {
      try {
        const { host, port } = splitHostPort(t, this.discoveryPort ?? 0);
        if (port) this.udp.send(msg, port, host, () => {});
      } catch { /* destino inválido: ignora */ }
    }
  }

  private onBeacon(msg: Buffer, address: string) {
    const b = decodeBeacon(new Uint8Array(msg));
    if (!b || this.stopped) return;
    if (compareBytes(b.tag, this.tag) === 0) return;                   // o próprio anúncio
    if (b.maxVersion < LNNP_MIN_VERSION || b.minVersion > LNNP_VERSION) return;
    if (compareBytes(this.tag, b.tag) > 0) return;                      // o outro (etiqueta menor) conecta
    for (const l of this.links.values()) if (compareBytes(nodeTag(l.session.peerPk), b.tag) === 0) return;
    this.dial(`${address}:${b.port}`);
  }

  private dialPeers() { for (const p of this.fixedPeers()) this.dial(p.address); }

  private dial(target: string) {
    if (this.stopped || this.outbound.has(target)) return;
    const known = this.peerOf.get(target);
    if (known && this.linkOfPeer(known)) return;
    if (this.hasPeerAddress(target)) {
      const d = this.dialInfo.get(target) ?? { error: null, errorAt: null, attempts: 0 };
      d.attempts++;
      this.dialInfo.set(target, d);
    }
    let host: string, port: number;
    try { ({ host, port } = splitHostPort(target, LNNP_DEFAULT_PORT)); } catch { this.noteError(target, 'endereço inválido'); return; }
    const sock = connect({ host, port });
    this.outbound.set(target, sock);
    const timer = setTimeout(() => { this.noteError(target, 'sem resposta (tempo esgotado)'); sock.destroy(); }, this.o.handshakeTimeoutMs ?? 5000);
    timer.unref();
    let connected = false;
    sock.once('close', () => { clearTimeout(timer); if (this.outbound.get(target) === sock) this.outbound.delete(target); });
    sock.once('connect', () => { connected = true; clearTimeout(timer); this.handle(sock, false, target); });
    sock.on('error', (e: NodeJS.ErrnoException) => { if (!connected) this.noteError(target, connectError(e)); });
  }

  // ── enlace ────────────────────────────────────────────────
  private caps() {
    return defaultCapabilities({ media: Medium.Eth, relay: this.relay, storageMiB: 0, mtu: this.o.mtu ?? MAX_FRAME_BYTES });
  }

  /** Enlace pronto. Se já existe outro com o mesmo nó, fica o aberto pelo nó de chave menor (os dois lados decidem igual). */
  private attach(link: Link): boolean {
    const existing = this.linkOfPeer(link.session.peerId);
    if (existing) {
      const iAmLo = toHex(this.o.node.pk) < toHex(link.session.peerPk);
      const preferred = (l: Link) => (iAmLo ? !l.inbound : l.inbound);
      if (!(preferred(link) && !preferred(existing))) return false;
      this.links.delete(existing.id);
      existing.sock.destroy();
    }
    this.links.set(link.id, link);
    this.o.log?.(`LAN: vizinho ${link.session.peerId} conectado (${link.address}, LNNP v${link.session.version})`);
    this.emit({ type: 'connected', id: link.session.peerId, pk: toHex(link.session.peerPk), address: link.address });
    this.emit({ type: 'peers' });
    return true;
  }

  private detach(link: Link) {
    if (this.links.get(link.id) !== link) return;
    this.links.delete(link.id);
    this.o.log?.(`LAN: vizinho ${link.session.peerId} desconectado`);
    this.emit({ type: 'disconnected', id: link.session.peerId });
    this.emit({ type: 'peers' });
  }

  private handle(sock: Socket, inbound: boolean, address: string) {
    if (this.stopped) { sock.destroy(); return; }
    this.sockets.add(sock);
    sock.once('close', () => this.sockets.delete(sock));
    sock.on('error', () => {});
    if (this.pending >= (this.o.maxPending ?? 16)) { writeFrame(sock, errorFrame(LnnpErrorCode.Busy, 'Ocupado.')); sock.end(); return; }
    this.pending++;
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 30_000);

    const hs = new Handshake({ node: this.o.node, caps: this.caps(), now: this.now(), replay: this.replay, versions: { min: LNNP_MIN_VERSION, max: LNNP_VERSION } });
    const reader = new Deframer();
    let state: 'hello' | 'auth' | 'open' | 'closed' = 'hello';
    let link: Link | null = null;
    const endPending = () => { if (state === 'hello' || state === 'auth') this.pending--; };
    const fail = (reason: string) => {
      if (state === 'closed') return;
      endPending();
      if (!inbound) this.noteError(address, `handshake recusado: ${reason}`);
      else this.o.log?.(`LAN: handshake recusado (${reason})`);
      state = 'closed';
      sock.destroy();
    };
    const timer = setTimeout(() => {
      if (state !== 'open') { writeFrame(sock, errorFrame(LnnpErrorCode.State, 'Tempo esgotado.')); fail('tempo esgotado'); }
    }, this.o.handshakeTimeoutMs ?? 5000);
    timer.unref();
    writeFrame(sock, hs.hello);

    sock.on('data', (chunk: Buffer) => {
      try {
        for (const frame of reader.push(chunk)) {
          if (state === 'hello') { writeFrame(sock, hs.receiveHello(frame)); state = 'auth'; continue; }
          if (state === 'auth') {
            const session = hs.receiveAuth(frame);
            clearTimeout(timer);
            this.pending--;
            state = 'open';
            reader.max = MAX_FRAME_BYTES + RECORD_OVERHEAD;
            if (this.links.size >= (this.o.maxLinks ?? 64)) { writeFrame(sock, session.seal(FrameType.Close)); state = 'closed'; sock.end(); return; }
            const l: Link = { id: `${session.peerId}#${++this.seq}`, session, sock, inbound, address, since: Date.now(), reassembler: null };
            link = l;
            if (!inbound) this.peerOf.set(address, session.peerId);
            sock.once('close', () => {
              this.detach(l);
              if (!inbound && !this.stopped) this.noteError(address, 'enlace encerrado (o vizinho saiu ou a rede caiu)');
            });
            if (!this.attach(l)) { state = 'closed'; sock.end(); return; }
            if (!inbound) { const d = this.dialInfo.get(address); if (d) { d.error = null; d.errorAt = null; } }
            continue;
          }
          if (state === 'open' && link) this.onFrame(link, link.session.open(frame));
        }
      } catch (e) {
        if (e instanceof LnnpError && !e.fromPeer && state !== 'open') writeFrame(sock, errorFrame(e.wire, e.message));
        fail(e instanceof Error ? e.message : 'erro');
      }
    });
    sock.once('close', () => { clearTimeout(timer); if (state !== 'closed' && state !== 'open') fail('conexão fechada'); state = 'closed'; });
  }

  /** Quadro decifrado. Só envelopes (inteiros ou em fragmentos) sobem; o resto é coisa de nó. */
  private onFrame(link: Link, f: { type: number; body: Uint8Array }) {
    switch (f.type) {
      case FrameType.Envelope: this.emit({ type: 'envelope', from: link.session.peerId, data: f.body }); break;
      case FrameType.Fragment: {
        if (!link.reassembler) link.reassembler = new Reassembler();
        let whole: Uint8Array | null = null;
        try { whole = link.reassembler.push(f.body, this.now()); } catch (e) { this.o.log?.(`LAN: fragmento inválido de ${link.session.peerId} (${(e as Error).message})`); }
        if (whole) this.emit({ type: 'envelope', from: link.session.peerId, data: whole });
        break;
      }
      case FrameType.Ping: link.sock.destroyed || writeFrame(link.sock, link.session.seal(FrameType.Pong, f.body.slice(0, 8))); break;
      case FrameType.Close: case FrameType.Error: link.sock.destroy(); break;
      default: break; // recibos, quadros do operador, Pong, CapsUpdate, tipos futuros
    }
  }

  /** Envelope para o vizinho pelo enlace aberto; fragmenta se não cabe no MTU negociado. */
  async send(peerId: string, data: Uint8Array): Promise<void> {
    const link = this.linkOfPeer(peerId);
    if (!link || link.sock.destroyed) throw new Error('Sem enlace com este vizinho agora.');
    const max = link.session.maxFrame - 1;
    if (data.length <= max) { writeFrame(link.sock, link.session.seal(FrameType.Envelope, data)); return; }
    if (!(link.session.negotiated.features & Feature.Fragments)) throw new Error('Envelope maior que o MTU e o vizinho não aceita fragmentos.');
    for (const part of fragment(data, max)) writeFrame(link.sock, link.session.seal(FrameType.Fragment, part));
  }
}
