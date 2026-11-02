/**
 * Adapter LAN do LNNP (Ethernet e Wi-Fi local, INF-007): descoberta por anúncio UDP na rede local
 * e enlace TCP entre nós. Sem internet e sem servidor: cada nó escuta, anuncia e conecta aos vizinhos.
 *
 * - Descoberta: a cada `beaconMs`, um anúncio de 18 bytes (lnnp.ts, `encodeBeacon`) vai por UDP para
 *   cada destino de `broadcast` (padrão 255.255.255.255 na porta de descoberta). Quem recebe conecta
 *   só se a SUA etiqueta for menor: assim os dois lados não abrem duas conexões.
 * - Vizinhos fixos (`peers`, host:porta): conectados e reconectados sem depender da descoberta
 *   (redes que bloqueiam broadcast, enlaces Ethernet ponto a ponto).
 * - Enlace: cada quadro vai com prefixo de tamanho u32. Handshake LNNP (HELLO/AUTH) em até 5 s;
 *   depois, só registros cifrados. Qualquer erro fecha a conexão (o vizinho reconecta).
 */
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect, createServer, type Server, type Socket } from 'node:net';
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

  /** Troca os vizinhos fixos (ex.: depois de descobrir a porta de outro nó num teste). */
  setPeers(peers: string[]) { this.o.peers = peers; this.dialPeers(); }
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

  private dialPeers() { for (const p of this.o.peers) this.dial(p); }

  private dial(target: string) {
    if (this.stopped || this.outbound.has(target)) return;
    const known = this.peerOf.get(target);
    if (known && this.engine.hasPeer(known)) return;
    let host: string, port: number;
    try { ({ host, port } = splitHostPort(target, 8422)); } catch { return; }
    const sock = connect({ host, port });
    this.outbound.set(target, sock);
    sock.once('close', () => { if (this.outbound.get(target) === sock) this.outbound.delete(target); });
    sock.once('connect', () => this.handle(sock, false, target));
    sock.on('error', () => {});
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
    const fail = (reason: string) => {
      if (state === 'closed') return;
      endPending();
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
            sock.once('close', () => this.engine.detach(l.id));
            if (!this.engine.attach(l)) { state = 'closed'; sock.end(); return; }
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
