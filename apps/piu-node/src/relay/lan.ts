/**
 * Adapter LAN do LNNP (Ethernet e Wi-Fi local, INF-007): descoberta por anúncio UDP na rede local
 * e enlace TCP entre nós. Sem internet e sem servidor: cada nó escuta, anuncia e conecta aos vizinhos.
 *
 * - Descoberta: a cada `beaconMs`, um anúncio de 18 bytes (lnnp.ts, `encodeBeacon`) vai por UDP para
 *   cada destino de `broadcast` (padrão 255.255.255.255 na porta de descoberta). Quem recebe conecta
 *   só se a SUA etiqueta for menor: assim os dois lados não abrem duas conexões.
 * - Vizinhos fixos (`peers`, host:porta): conectados e reconectados sem depender da descoberta
 *   (redes que bloqueiam broadcast, enlaces Ethernet ponto a ponto). Os de `PIU_LNNP_PEERS` vêm na
 *   configuração; os do painel (`addPeer`/`removePeer`) entram e saem sem reiniciar o nó. O estado
 *   de cada um (conectando, conectado, falha e o motivo) fica em `peerStatus()`.
 * - Enlace: cada quadro vai com prefixo de tamanho u32. Handshake LNNP (HELLO/AUTH) em até 5 s;
 *   depois, só registros cifrados. Qualquer erro fecha a conexão (o vizinho reconecta).
 */
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect, createServer, isIPv4, isIPv6, type Server, type Socket } from 'node:net';
import {
  compareBytes, decodeBeacon, encodeBeacon, errorFrame, Handshake, LNNP_MIN_VERSION, LNNP_VERSION, LnnpError, LnnpErrorCode,
  MAX_FRAME_BYTES, RECORD_OVERHEAD,
} from '../protocol/lnnp.js';
import type { LinkPort, RelayEngine } from './engine.js';

export interface LanOptions {
  /** Endereço de escuta do enlace TCP. */
  listen: string;
  /** Porta TCP do enlace (0 = aleatória, para testes). */
  port: number;
  /** Porta UDP da descoberta (0 = aleatória; `null` desliga a descoberta). */
  discoveryPort: number | null;
  /** Destinos do anúncio: `endereço` (usa a porta de descoberta) ou `endereço:porta`. */
  broadcast: string[];
  /** Vizinhos fixos (`host:porta` do enlace TCP). */
  peers: string[];
  /** Intervalo do anúncio e das tentativas de reconexão. */
  beaconMs: number;
  /** Rodada do motor (horário, limpeza, envio pendente). */
  tickMs?: number;
  handshakeTimeoutMs?: number;
  /** Conexões em handshake ao mesmo tempo (as demais são recusadas). */
  maxPending?: number;
  maxLinks?: number;
}

const HANDSHAKE_MAX = 4096;
/** Vizinhos fixos adicionados pelo painel (além dos de `PIU_LNNP_PEERS`). */
export const MAX_RUNTIME_PEERS = 32;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);

/**
 * Endereço de vizinho digitado no painel: só `host:porta` (nome, IPv4 ou `[IPv6]`), porta 1–65535
 * obrigatória. Sem esquema, caminho, usuário, espaço ou zona IPv6. Devolve a forma canônica
 * (minúsculas, IPv6 entre colchetes) ou `null`.
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

export type PeerState = 'connecting' | 'connected' | 'failed';
/** Estado de um vizinho fixo, para o painel. `nodeId`/`pk`: quem respondeu no handshake. */
export interface PeerStatus {
  address: string;
  /** `config`: veio de `PIU_LNNP_PEERS` (só sai mudando a configuração); `panel`: adicionado pelo painel. */
  source: 'config' | 'panel';
  state: PeerState;
  /** Último erro (conexão recusada, sem resposta, handshake recusado…) e quando (ms). */
  error: string | null;
  errorAt: number | null;
  nodeId: string | null;
  pk: string | null;
  /** Desde quando o enlace atual está aberto (só `connected`). */
  since: number | null;
  /** Tentativas de conexão desde que entrou na lista. */
  attempts: number;
}

/** Motivo legível para um erro de conexão TCP. */
function connectError(e: NodeJS.ErrnoException): string {
  switch (e.code) {
    case 'ECONNREFUSED': return 'conexão recusada (nada escutando nessa porta)';
    case 'ETIMEDOUT': return 'sem resposta (tempo esgotado)';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'endereço inalcançável a partir deste nó';
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'nome não encontrado na rede local';
    case 'ECONNRESET': return 'conexão encerrada pelo outro lado';
    default: return e.code ? `erro de rede (${e.code})` : e.message || 'erro de rede';
  }
}

function splitHostPort(s: string, defPort: number): { host: string; port: number } {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim());
  if (!m || !m[1]) throw new Error(`Endereço inválido: ${s}`);
  // IPv6 sem colchetes e sem porta: o último ":" não é porta.
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

export class LanAdapter {
  private server: Server | null = null;
  private udp: UdpSocket | null = null;
  private timers: NodeJS.Timeout[] = [];
  private sockets = new Set<Socket>();
  private pending = 0;
  private seq = 0;
  /** Vizinhos fixos/descobertos em conexão ou conectados por este nó (chave host:porta). */
  private outbound = new Map<string, Socket>();
  /** Vizinho (id) que respondeu em cada destino: não redisca enquanto ele estiver conectado por outra via. */
  private peerOf = new Map<string, string>();
  /** Vizinhos fixos adicionados pelo painel (forma canônica de `parsePeerAddress`). */
  private runtime: string[] = [];
  /** Último erro e tentativas por destino fixo. */
  private dialInfo = new Map<string, { error: string | null; errorAt: number | null; attempts: number }>();
  private stopped = false;
  port = 0;
  discoveryPort: number | null = null;

  constructor(private engine: RelayEngine, private o: LanOptions) {}

  async start(): Promise<{ port: number; discoveryPort: number | null }> {
    this.server = createServer(sock => this.handle(sock, true, `${sock.remoteAddress}:${sock.remotePort}`));
    this.server.maxConnections = (this.o.maxLinks ?? 64) + (this.o.maxPending ?? 16);
    await new Promise<void>((res, rej) => { this.server!.once('error', rej); this.server!.listen(this.o.port, this.o.listen, () => { this.server!.off('error', rej); res(); }); });
    const a = this.server.address();
    this.port = typeof a === 'object' && a ? a.port : this.o.port;

    if (this.o.discoveryPort !== null) {
      const udp = createSocket({ type: 'udp4', reuseAddr: true });
      this.udp = udp;
      udp.on('message', (msg, rinfo) => this.onBeacon(msg, rinfo.address));
      udp.on('error', e => this.engine.handshakeFailed(`descoberta: ${e.message}`));
      await new Promise<void>((res, rej) => { udp.once('error', rej); udp.bind(this.o.discoveryPort!, this.o.listen.includes(':') ? undefined : this.o.listen, () => { udp.off('error', rej); res(); }); });
      udp.setBroadcast(true);
      this.discoveryPort = udp.address().port;
    }

    const every = (ms: number, fn: () => void) => { const t = setInterval(fn, ms); t.unref(); this.timers.push(t); };
    every(this.o.beaconMs, () => { this.beacon(); this.dialPeers(); });
    every(this.o.tickMs ?? 1000, () => this.engine.tick());
    this.beacon();
    this.dialPeers();
    return { port: this.port, discoveryPort: this.discoveryPort };
  }

  /** Troca os vizinhos fixos da configuração (ex.: depois de descobrir a porta de outro nó num teste). */
  setPeers(peers: string[]) { this.o.peers = peers; this.dialPeers(); }

  /** Vizinhos fixos em vigor: os da configuração e os do painel, sem repetir. */
  private fixedPeers(): { address: string; source: 'config' | 'panel' }[] {
    const out: { address: string; source: 'config' | 'panel' }[] = this.o.peers.map(address => ({ address, source: 'config' }));
    for (const address of this.runtime) if (!out.some(p => p.address === address)) out.push({ address, source: 'panel' });
    return out;
  }

  isConfigPeer(address: string) { return this.o.peers.includes(address); }
  hasPeerAddress(address: string) { return this.o.peers.includes(address) || this.runtime.includes(address); }

  /**
   * Adiciona um vizinho fixo (já validado por `parsePeerAddress`) e conecta na hora; a reconexão
   * segue a cada `beaconMs`, como a dos de `PIU_LNNP_PEERS`.
   */
  addPeer(address: string) {
    if (!this.hasPeerAddress(address)) {
      if (this.runtime.length >= MAX_RUNTIME_PEERS) throw new Error(`No máximo ${MAX_RUNTIME_PEERS} vizinhos adicionados pelo painel.`);
      this.runtime.push(address);
      this.dialInfo.delete(address);
    }
    this.dial(address);
  }

  /** Tira um vizinho adicionado pelo painel: para de reconectar e fecha o enlace aberto até ele. */
  removePeer(address: string): boolean {
    const i = this.runtime.indexOf(address);
    if (i < 0) return false;
    this.runtime.splice(i, 1);
    if (!this.o.peers.includes(address)) {
      this.dialInfo.delete(address);
      this.outbound.get(address)?.destroy();
      this.outbound.delete(address);
      this.peerOf.delete(address);
    }
    return true;
  }

  private noteError(address: string, reason: string) {
    const d = this.dialInfo.get(address);
    if (d) { d.error = reason; d.errorAt = Date.now(); }
  }

  private statusOf(address: string, source: 'config' | 'panel'): PeerStatus {
    const d = this.dialInfo.get(address) ?? { error: null, errorAt: null, attempts: 0 };
    const id = this.peerOf.get(address);
    const link = id ? this.engine.linkInfo(id) : null;
    const base = { address, source, error: d.error, errorAt: d.errorAt, attempts: d.attempts };
    // Conectado também quando o enlace com o mesmo nó ficou pela conexão que ele abriu.
    if (link && id) return { ...base, state: 'connected', nodeId: id, pk: link.pk, since: link.since };
    const state: PeerState = this.outbound.has(address) || !d.error ? 'connecting' : 'failed';
    return { ...base, state, nodeId: id ?? null, pk: null, since: null };
  }

  /** Estado de cada vizinho fixo (configuração e painel). */
  peerStatus(): PeerStatus[] { return this.fixedPeers().map(p => this.statusOf(p.address, p.source)); }

  /**
   * Espera o handshake com um vizinho fixo terminar: conectado, ou uma falha a partir de `from`
   * (quando foi adicionado). Desiste em `ms` e devolve o estado do momento.
   */
  async waitPeer(address: string, ms: number, from = Date.now()): Promise<PeerStatus | null> {
    const end = Date.now() + ms;
    for (;;) {
      const p = this.peerStatus().find(x => x.address === address);
      if (!p) return null;
      if (p.state === 'connected' || (p.errorAt !== null && p.errorAt >= from) || Date.now() >= end || this.stopped) return p;
      await new Promise(r => setTimeout(r, 50));
    }
  }
  setBroadcast(targets: string[]) { this.o.broadcast = targets; this.beacon(); }

  private beacon() {
    if (!this.udp || this.stopped) return;
    const msg = encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port: this.port, tag: this.engine.tag, relay: this.engine.relaying });
    for (const t of this.o.broadcast) {
      try {
        const { host, port } = splitHostPort(t, this.discoveryPort ?? 0);
        if (port) this.udp.send(msg, port, host);
      } catch { /* destino inválido na configuração: ignora */ }
    }
  }

  private onBeacon(msg: Buffer, address: string) {
    const b = decodeBeacon(new Uint8Array(msg));
    if (!b || this.stopped) return;
    if (compareBytes(b.tag, this.engine.tag) === 0) return;              // o próprio anúncio
    if (b.maxVersion < LNNP_MIN_VERSION || b.minVersion > LNNP_VERSION) return; // sem versão comum
    if (compareBytes(this.engine.tag, b.tag) > 0) return;               // o outro (etiqueta menor) conecta
    if (this.engine.hasPeerTag(b.tag)) return;
    this.dial(`${address}:${b.port}`);
  }

  private dialPeers() { for (const p of this.fixedPeers()) this.dial(p.address); }

  private dial(target: string) {
    if (this.stopped || this.outbound.has(target)) return;
    const known = this.peerOf.get(target);
    if (known && this.engine.hasPeer(known)) return;
    if (this.hasPeerAddress(target)) {
      const d = this.dialInfo.get(target) ?? { error: null, errorAt: null, attempts: 0 };
      d.attempts++;
      this.dialInfo.set(target, d);
    }
    let host: string, port: number;
    try { ({ host, port } = splitHostPort(target, 8422)); } catch { this.noteError(target, 'endereço inválido'); return; }
    const sock = connect({ host, port });
    this.outbound.set(target, sock);
    // Sem resposta ao SYN (endereço que não existe na rede): desiste no mesmo prazo do handshake.
    const timer = setTimeout(() => { this.noteError(target, 'sem resposta (tempo esgotado)'); sock.destroy(); }, this.o.handshakeTimeoutMs ?? 5000);
    timer.unref();
    let connected = false;
    sock.once('close', () => { clearTimeout(timer); if (this.outbound.get(target) === sock) this.outbound.delete(target); });
    sock.once('connect', () => { connected = true; clearTimeout(timer); this.handle(sock, false, target); });
    sock.on('error', (e: NodeJS.ErrnoException) => { if (!connected) this.noteError(target, connectError(e)); });
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

    const hs = new Handshake(this.engine.handshakeOptions());
    const reader = new Deframer();
    let state: 'hello' | 'auth' | 'open' | 'closed' = 'hello';
    let link: LinkPort | null = null;
    const endPending = () => { if (state === 'hello' || state === 'auth') this.pending--; };
    let attached = false;
    const fail = (reason: string) => {
      if (state === 'closed') return;
      endPending();
      if (!inbound) this.noteError(address, `handshake recusado: ${reason}`);
      if (!link) this.engine.handshakeFailed(reason);
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
            if (this.engine.linkCount >= (this.o.maxLinks ?? 64)) { writeFrame(sock, session.seal(0x7e)); state = 'closed'; sock.end(); return; }
            const l: LinkPort = {
              id: `${session.peerId}#${++this.seq}`, session, medium: 'eth', inbound, address, since: Date.now(),
              send: rec => writeFrame(sock, rec), close: () => { state = 'closed'; sock.destroy(); },
            };
            link = l;
            if (!inbound) this.peerOf.set(address, session.peerId);
            sock.once('close', () => {
              this.engine.detach(l.id);
              if (attached && !inbound && !this.stopped) this.noteError(address, 'enlace encerrado (o vizinho saiu ou a rede caiu)');
            });
            if (!this.engine.attach(l)) { state = 'closed'; sock.end(); return; }
            attached = true;
            if (!inbound) { const d = this.dialInfo.get(address); if (d) { d.error = null; d.errorAt = null; } }
            continue;
          }
          if (state === 'open' && link) this.engine.receive(link.id, link.session.open(frame));
        }
      } catch (e) {
        // Antes do handshake terminar, o erro vai em claro com o código; depois, só fecha.
        if (e instanceof LnnpError && !e.fromPeer && state !== 'open') writeFrame(sock, errorFrame(e.wire, e.message));
        fail(e instanceof Error ? e.message : 'erro');
      }
    });
    sock.once('close', () => { clearTimeout(timer); if (state !== 'closed' && state !== 'open') fail('conexão fechada'); state = 'closed'; });
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    for (const s of this.sockets) s.destroy();
    for (const s of this.outbound.values()) s.destroy();
    this.udp?.close();
    await new Promise<void>(res => (this.server ? this.server.close(() => res()) : res()));
  }
}
