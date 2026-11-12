/**
 * Transporte LAN do celular: LNNP v1 pela rede Wi-Fi em que o aparelho está, o mesmo enlace do Piu
 * Desktop e do piu-node (apps/desktop/src/transport/lnnpLan.ts, apps/piu-node/src/relay/lan.ts;
 * docs/lnnp/especificacao-v1.md). Complementa Bluetooth LE e Nearby, que seguem iguais.
 *
 * - Descoberta em camadas (docs/rede/pontos-piu-roteadores.md §3.2):
 *   1. anúncio UDP de 18 bytes (`encodeBeacon`) para o broadcast da rede, compatível com Desktop e Node;
 *   2. mDNS/DNS-SD `_piu._udp` (NsdManager no Android), para redes que filtram broadcast;
 *   3. varredura leve da sub-rede na porta fixa, só se 1 e 2 não acharam ninguém (scan.ts);
 *   4. vizinho manual `IP:porta` (QR do ponto, só pela API).
 * - Quem recebe um anúncio conecta só se a SUA etiqueta for menor (uma conexão por par).
 * - Enlace: handshake HELLO/AUTH assinado pela chave técnica do nó (a do dia, nunca a identidade);
 *   depois só registros cifrados. Envelopes acima do MTU negociado vão em fragmentos.
 * - Limites da auditoria (A-02, B-03, M-04), os mesmos do piu-node: só rede local vira discagem,
 *   discagens de descoberta com teto, uma por IP por período e espera crescente depois de falha;
 *   handshakes de entrada com vagas próprias e teto por IP; quadro de handshake até 4 KiB.
 *
 * Os eventos saem como enlaces (`LinkEvent`, meio `lan`) para `multi.ts`, que junta os meios em
 * vizinhos e escolhe por onde cada envelope sai. Depois do handshake o celular manda o nome curto do
 * nó (`piu-xxxxxx`, o mesmo do anúncio BLE/Nearby) num quadro de extensão (`NODE_HINT`): assim o mesmo
 * celular visto pelo Bluetooth e pela rede vira UM vizinho. Desktop e piu-node ignoram o tipo.
 */
import { fromUtf8, toHex, utf8 } from '../../protocol/bytes';
import { fragment, Reassembler } from '../../protocol/fragment';
import type { KeyPair } from '../../protocol/keys';
import {
  compareBytes, decodeBeacon, defaultCapabilities, encodeBeacon, errorFrame, Feature, FrameType, Handshake, type LinkSession, LNNP_MIN_VERSION, LNNP_VERSION,
  LnnpError, LnnpErrorCode, MAX_FRAME_BYTES, Medium, nodeTag, RECORD_OVERHEAD, ReplayGuard,
} from '../../protocol/lnnp';
import type { LinkEvent } from '../multi';
import { broadcastOf, isPrivateLan, joinHostPort, splitHostPort, subnetHosts } from './addr';
import { DEFAULT_SCAN, shouldScan, type ScanPolicy } from './scan';
import { NO_WIFI, type LanSocketApi, type LanSocketEvent, type WifiInfo } from './types';

export const LNNP_DEFAULT_PORT = 8422;
export const LNNP_DEFAULT_DISCOVERY_PORT = 8423;
/** Tipo DNS-SD do anúncio mDNS. */
export const MDNS_SERVICE_TYPE = '_piu._udp';
/** Quadro de extensão do celular: nome curto do nó (UTF-8, `piu-` + 6 hex). Tipo desconhecido para Desktop/Node. */
export const NODE_HINT_FRAME = 0x50;
const NODE_NAME = /^piu-[0-9a-f]{6}$/;

/** Maior quadro antes do handshake terminar (HELLO/AUTH/ERROR). */
export const HANDSHAKE_MAX = 4096;
/** Discagens de descoberta (anúncio, mDNS, varredura) abertas ao mesmo tempo (A-02). */
export const MAX_DISCOVERY_DIALS = 8;
const MAX_DISCOVERY_IPS = 1024;
const MAX_DISCOVERY_BACKOFF_MS = 5 * 60_000;
/** Vizinhos manuais (QR do ponto). */
export const MAX_MANUAL_PEERS = 16;
/** Quantos vizinhos vistos por fonte ficam guardados para o teste de compatibilidade. */
const MAX_SEEN = 256;

export type DialSource = 'beacon' | 'mdns' | 'scan' | 'manual';
export type LanState = 'off' | 'starting' | 'running' | 'unavailable';

export interface LanEngineOptions {
  api: LanSocketApi;
  /** Chave técnica do nó (a do dia). Trocar com `setNode`. */
  node: KeyPair;
  /** Nome curto do nó (`piu-xxxxxx`), mandado em `NODE_HINT`. */
  name?: string;
  relay?: boolean;
  port?: number;
  discoveryPort?: number;
  beaconMs?: number;
  /** Anúncio com bateria baixa (só escuta e anuncia devagar; sem varredura). */
  lowPowerBeaconMs?: number;
  handshakeTimeoutMs?: number;
  /** Espera pelo `NODE_HINT` antes de avisar o enlace (vizinho sem nome = Desktop/Node). */
  hintWaitMs?: number;
  maxLinks?: number;
  maxPendingIn?: number;
  maxPendingPerIp?: number;
  maxPendingOut?: number;
  /** MTU anunciado (testes de fragmentação). */
  mtu?: number;
  scan?: Partial<ScanPolicy>;
  /** Porta varrida (padrão: a do LNNP). */
  scanPort?: number;
  /** Relógio em ms (testes). */
  now?: () => number;
  log?: (msg: string) => void;
}

export interface LanPeerInfo {
  /** Id do vizinho (16 hex da chave do nó). */
  id: string;
  name: string | null;
  address: string;
  inbound: boolean;
  source: DialSource | 'inbound';
  since: number;
}

export interface ManualPeerInfo { address: string; state: 'connecting' | 'connected' | 'failed'; error: string | null; nodeId: string | null; attempts: number }

/** Vizinhos vistos por cada camada de descoberta (para `runLanCheck`). */
export interface DiscoveryStats { broadcast: number; mdns: number; scan: number; links: number; scanning: boolean; lastScanAt: number | null }

interface Conn {
  id: number;
  inbound: boolean;
  ip: string;
  address: string;
  source: DialSource | 'inbound';
  state: 'hello' | 'auth' | 'open' | 'closed';
  hs: Handshake;
  timer: ReturnType<typeof setTimeout> | null;
  pendingHeld: boolean;
  link: Link | null;
  onOpen?: () => void;
  /** Avisado uma vez quando a conexão termina (backoff da descoberta). */
  onClose?: () => void;
}

interface Link {
  key: string;
  conn: Conn;
  session: LinkSession;
  since: number;
  reassembler: Reassembler | null;
  name: string | null;
  /** `up` já foi emitido para este enlace. */
  announced: boolean;
  hintTimer: ReturnType<typeof setTimeout> | null;
}

function dialError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/refused|ECONNREFUSED/i.test(m)) return 'conexão recusada (nada escutando nessa porta)';
  if (/timed? ?out|ETIMEDOUT/i.test(m)) return 'sem resposta (tempo esgotado)';
  if (/unreachable/i.test(m)) return 'endereço inalcançável a partir deste celular';
  return m || 'erro de rede';
}

export class LnnpLanEngine {
  state: LanState = 'off';
  reason?: string;
  port = 0;
  discoveryPort = 0;
  wifi: WifiInfo = NO_WIFI;

  private o: LanEngineOptions;
  private node: KeyPair;
  private tag: Uint8Array;
  private relay: boolean;
  private lowPower = false;
  private stopped = true;
  private unsubApi: (() => void) | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private conns = new Map<number, Conn>();
  private links = new Map<string, Link>();
  private seq = 0;
  private replay = new ReplayGuard();
  private pendingIn = 0;
  private pendingOut = 0;
  private pendingPerIp = new Map<string, number>();
  /** Destino → id da conexão (`null` enquanto conecta). */
  private outbound = new Map<string, number | null>();
  private discovery = new Map<string, { next: number; fails: number }>();
  private peerOf = new Map<string, string>();
  private manual: string[] = [];
  private dialInfo = new Map<string, { error: string | null; attempts: number }>();
  private seen = { broadcast: new Map<string, number>(), mdns: new Map<string, number>(), scan: new Map<string, number>() };
  private startedAt = 0;
  private lastSeenAt: number | null = null;
  private lastScanAt: number | null = null;
  private scanQueue: string[] | null = null;
  private subs = new Set<(e: LinkEvent) => void>();
  private netSubs = new Set<(w: WifiInfo) => void>();
  private scanPolicy: ScanPolicy;

  constructor(o: LanEngineOptions) {
    this.o = o;
    this.node = o.node;
    this.tag = nodeTag(o.node.pk);
    this.relay = o.relay ?? false;
    this.scanPolicy = { ...DEFAULT_SCAN, ...o.scan };
  }

  get nodeId() { return toHex(this.node.pk).slice(0, 16); }
  get linkCount() { return this.links.size; }
  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private sec() { return Math.floor(this.now() / 1000); }

  subscribe(fn: (e: LinkEvent) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  /** Mudanças do Wi-Fi (para ligar/desligar o LAN conforme a rede). */
  onNetwork(fn: (w: WifiInfo) => void) { this.netSubs.add(fn); return () => { this.netSubs.delete(fn); }; }
  private emit(e: LinkEvent) { for (const fn of this.subs) { try { fn(e); } catch (err) { this.o.log?.(`LAN: ouvinte falhou (${(err as Error).message})`); } } }
  private setState(state: LanState, reason?: string) { this.state = state; this.reason = reason; this.emit({ type: 'state', state, reason }); }

  // ── ajustes ───────────────────────────────────────────────
  /** Chave técnica nova (a do dia): vale para os próximos anúncios e handshakes; os enlaces abertos seguem. */
  setNode(node: KeyPair) {
    if (compareBytes(node.pk, this.node.pk) === 0) return;
    this.node = node;
    this.tag = nodeTag(node.pk);
    if (this.state === 'running') this.mdnsAnnounce();
  }
  setName(name: string | undefined) { this.o.name = name; }
  setRelay(relay: boolean) { this.relay = relay; }
  /** Bateria baixa / economia: anúncio devagar, sem varredura (os enlaces abertos seguem). */
  setLowPower(low: boolean) {
    if (low === this.lowPower) return;
    this.lowPower = low;
    if (low) this.scanQueue = null;
    if (this.state === 'running') this.restartBeacon();
  }

  // ── ciclo de vida ─────────────────────────────────────────
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;
    this.stopped = false;
    this.setState('starting');
    const api = this.o.api;
    this.unsubApi = api.subscribe(e => this.onSocket(e));
    try {
      this.wifi = await api.networkInfo();
      if (!this.wifi.connected) throw new Error('Sem Wi-Fi: a rede local só funciona conectado a uma rede Wi-Fi.');
      const conns = (this.o.maxLinks ?? 16) + (this.o.maxPendingIn ?? 8) + (this.o.maxPendingOut ?? 8);
      const r = await api.start({ tcpPort: this.o.port ?? LNNP_DEFAULT_PORT, udpPort: this.o.discoveryPort ?? LNNP_DEFAULT_DISCOVERY_PORT, maxConnections: conns });
      if (this.stopped) { await api.stop().catch(() => {}); return; }
      this.port = r.tcpPort;
      this.discoveryPort = r.udpPort;
    } catch (e) {
      await this.teardown();
      this.setState('unavailable', e instanceof Error ? e.message : String(e));
      return;
    }
    this.startedAt = this.now();
    this.lastSeenAt = null;
    this.mdnsAnnounce();
    this.restartBeacon();
    this.setState('running');
  }

  async stop(): Promise<void> {
    if (this.stopped && this.state === 'off') return;
    await this.teardown();
    this.setState('off');
  }

  private async teardown() {
    this.stopped = true;
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.beaconTimer = this.scanTimer = null;
    this.scanQueue = null;
    for (const c of [...this.conns.values()]) this.drop(c);
    this.conns.clear();
    this.outbound.clear();
    this.pendingIn = this.pendingOut = 0;
    this.pendingPerIp.clear();
    try { this.o.api.mdnsStop?.(); } catch { /* sem mDNS */ }
    await this.o.api.stop().catch(() => {});
    this.unsubApi?.();
    this.unsubApi = null;
  }

  private beaconPeriod() { return this.lowPower ? (this.o.lowPowerBeaconMs ?? 30_000) : (this.o.beaconMs ?? 5000); }

  private restartBeacon() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.beaconTimer = setInterval(() => this.tick(), this.beaconPeriod());
    this.tick();
  }

  /**
   * Pulso nativo do PiuRelayService (a cada 5 s, com wake lock curto): com a tela apagada os timers JS
   * podem atrasar. Anuncia (e confere manuais e varredura) só se o último anúncio já venceu.
   */
  heartbeat() {
    if (this.stopped || this.state !== 'running') return;
    if (this.now() - this.lastTickAt >= this.beaconPeriod()) this.tick();
  }

  private tick() {
    if (this.stopped) return;
    this.lastTickAt = this.now();
    this.beacon();
    this.dialManual();
    this.maybeScan();
  }

  private mdnsAnnounce() {
    if (!this.o.api.mdnsStart || this.stopped) return;
    const tagHex = toHex(this.tag);
    try { this.o.api.mdnsStart(`piu-${tagHex.slice(0, 8)}`, this.discoveryPort, { v: String(LNNP_VERSION), tcp: String(this.port), tag: tagHex }); } catch (e) { this.o.log?.(`LAN: mDNS indisponível (${(e as Error).message})`); }
  }

  // ── vizinhos manuais (QR do ponto) ────────────────────────
  /** Vizinho fixo já validado por `parseLanPeer`: conecta na hora e reconecta a cada anúncio. */
  addPeer(address: string) {
    if (!this.manual.includes(address)) {
      if (this.manual.length >= MAX_MANUAL_PEERS) throw new Error(`No máximo ${MAX_MANUAL_PEERS} vizinhos adicionados manualmente.`);
      this.manual.push(address);
      this.dialInfo.delete(address);
    }
    if (this.state === 'running') this.dial(address, 'manual');
  }

  removePeer(address: string): boolean {
    const i = this.manual.indexOf(address);
    if (i < 0) return false;
    this.manual.splice(i, 1);
    this.dialInfo.delete(address);
    const id = this.outbound.get(address);
    if (id != null) { const c = this.conns.get(id); if (c) this.drop(c); }
    this.outbound.delete(address);
    this.peerOf.delete(address);
    return true;
  }

  manualPeers(): ManualPeerInfo[] {
    return this.manual.map(address => {
      const d = this.dialInfo.get(address) ?? { error: null, attempts: 0 };
      const id = this.peerOf.get(address) ?? null;
      const connected = !!(id && this.linkOf(id));
      return { address, state: connected ? 'connected' : this.outbound.has(address) || !d.error ? 'connecting' : 'failed', error: connected ? null : d.error, nodeId: id, attempts: d.attempts };
    });
  }

  private dialManual() { for (const a of this.manual) this.dial(a, 'manual'); }

  private noteError(address: string, reason: string) {
    const d = this.dialInfo.get(address);
    if (d) d.error = reason;
  }

  /** Vizinhos com enlace aberto agora. */
  peers(): LanPeerInfo[] {
    return [...this.links.values()].map(l => ({ id: l.session.peerId, name: l.name, address: l.conn.address, inbound: l.conn.inbound, source: l.conn.source, since: l.since }));
  }

  discoveryStats(): DiscoveryStats {
    return { broadcast: this.seen.broadcast.size, mdns: this.seen.mdns.size, scan: this.seen.scan.size, links: this.links.size, scanning: this.scanQueue !== null, lastScanAt: this.lastScanAt };
  }

  /** Este IP apareceu pela descoberta (anúncio UDP ou enlace aberto). */
  sawHost(ip: string): boolean {
    if (this.seen.broadcast.has(ip)) return true;
    return [...this.links.values()].some(l => l.conn.ip === ip);
  }

  private see(kind: 'broadcast' | 'mdns' | 'scan', key: string) {
    const m = this.seen[kind];
    m.delete(key);
    m.set(key, this.now());
    while (m.size > MAX_SEEN) m.delete(m.keys().next().value!);
    if (kind !== 'scan') this.lastSeenAt = this.now();
  }

  // ── descoberta ────────────────────────────────────────────
  private beacon() {
    if (this.stopped || !this.discoveryPort) return;
    const msg = encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port: this.port, tag: this.tag, relay: this.relay });
    const targets = new Set(['255.255.255.255']);
    const b = this.wifi.ip && this.wifi.prefix !== null ? broadcastOf(this.wifi.ip, this.wifi.prefix) : null;
    if (b) targets.add(b);
    for (const t of targets) { try { this.o.api.udpSend(t, LNNP_DEFAULT_DISCOVERY_PORT, msg); } catch { /* rede saiu: ignora */ } }
  }

  private onBeacon(data: Uint8Array, host: string) {
    const b = decodeBeacon(data);
    if (!b || this.stopped) return;
    if (compareBytes(b.tag, this.tag) === 0) return;                      // o próprio anúncio
    if (b.maxVersion < LNNP_MIN_VERSION || b.minVersion > LNNP_VERSION) return;
    // B-03: o anúncio não é autenticado (origem UDP forjável): só rede local.
    if (!isPrivateLan(host)) return;
    this.see('broadcast', host);
    if (compareBytes(this.tag, b.tag) > 0) return;                         // o outro (etiqueta menor) conecta
    if (this.hasPeerTag(b.tag)) return;
    this.discoveryDial(host, b.port, 'beacon');
  }

  private onMdns(e: { name: string; host: string; tcp: number | null; tagHex?: string }) {
    if (this.stopped || !isPrivateLan(e.host)) return;
    const mine = toHex(this.tag);
    if (e.tagHex === mine || (e.host === this.wifi.ip && e.tcp === this.port)) return; // o próprio serviço
    this.see('mdns', e.name);
    if (e.tagHex && /^[0-9a-f]{16}$/.test(e.tagHex)) {
      const tag = Uint8Array.from({ length: 8 }, (_, i) => parseInt(e.tagHex!.slice(i * 2, i * 2 + 2), 16));
      if (compareBytes(this.tag, tag) > 0 || this.hasPeerTag(tag)) return;
    }
    const port = e.tcp && e.tcp > 0 && e.tcp <= 65535 ? e.tcp : LNNP_DEFAULT_PORT;
    this.discoveryDial(e.host, port, 'mdns');
  }

  private hasPeerTag(tag: Uint8Array) {
    for (const l of this.links.values()) if (compareBytes(nodeTag(l.session.peerPk), tag) === 0) return true;
    return false;
  }

  /** Discagens abertas pela descoberta (não por vizinho manual) neste momento. */
  private discoveryDials() { let n = 0; for (const k of this.outbound.keys()) if (!this.manual.includes(k)) n++; return n; }

  /** A-02: uma discagem por IP por período (espera maior depois de falha), teto global e mapa de tamanho fixo. */
  private discoveryDial(host: string, port: number, source: DialSource): boolean {
    const target = joinHostPort(host, port);
    if (this.outbound.has(target) || this.manual.includes(target)) return false;
    if (this.links.size >= (this.o.maxLinks ?? 16)) return false;
    const now = this.now();
    const d = this.discovery.get(host);
    if (d && now < d.next) return false;
    if (this.discoveryDials() >= MAX_DISCOVERY_DIALS) return false;
    const period = this.o.beaconMs ?? 5000;
    this.discovery.delete(host);
    this.discovery.set(host, { next: now + period, fails: d?.fails ?? 0 });
    while (this.discovery.size > MAX_DISCOVERY_IPS) this.discovery.delete(this.discovery.keys().next().value!);
    this.dial(target, source, ok => {
      const x = this.discovery.get(host);
      if (!x) return;
      if (ok) { x.fails = 0; return; }
      x.fails = Math.min(x.fails + 1, 16);
      x.next = this.now() + Math.min(period * 2 ** (x.fails + 1), MAX_DISCOVERY_BACKOFF_MS);
    });
    return true;
  }

  // ── varredura (último recurso) ────────────────────────────
  private maybeScan() {
    if (this.scanQueue || !this.wifi.ip) return;
    if (!shouldScan({ now: this.now(), startedAt: this.startedAt, lastSeenAt: this.lastSeenAt, lastScanAt: this.lastScanAt, prefix: this.wifi.prefix, lowPower: this.lowPower, scanning: false }, this.scanPolicy)) return;
    this.startScan();
  }

  /** Começa uma varredura agora (teste de compatibilidade). `false` se a sub-rede é grande demais ou já varrendo. */
  startScan(): boolean {
    if (this.stopped || this.scanQueue || !this.wifi.ip || this.wifi.prefix === null) return false;
    const hosts = subnetHosts(this.wifi.ip, this.wifi.prefix).slice(0, this.scanPolicy.maxHosts);
    if (!hosts.length) return false;
    this.scanQueue = hosts;
    this.o.log?.(`LAN: varrendo ${hosts.length} endereços da sub-rede`);
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = setInterval(() => this.scanStep(), this.scanPolicy.intervalMs);
    return true;
  }

  private scanStep() {
    const q = this.scanQueue;
    if (!q || this.stopped || this.lowPower || !q.length) {
      if (this.scanTimer) clearInterval(this.scanTimer);
      this.scanTimer = null;
      if (q) this.lastScanAt = this.now();
      this.scanQueue = null;
      return;
    }
    if (this.discoveryDials() >= MAX_DISCOVERY_DIALS) return; // espera vaga
    this.discoveryDial(q.shift()!, this.o.scanPort ?? LNNP_DEFAULT_PORT, 'scan');
  }

  // ── conexões ──────────────────────────────────────────────
  private linkOf(peerId: string): Link | null { return this.links.get(peerId) ?? null; }

  private dial(target: string, source: DialSource, done?: (ok: boolean) => void) {
    if (this.stopped || this.outbound.has(target)) return;
    const known = this.peerOf.get(target);
    if (known && this.linkOf(known)) return;
    if (source === 'manual') {
      const d = this.dialInfo.get(target) ?? { error: null, attempts: 0 };
      d.attempts++;
      this.dialInfo.set(target, d);
    }
    let host: string, port: number;
    try { ({ host, port } = splitHostPort(target, LNNP_DEFAULT_PORT)); } catch { this.noteError(target, 'endereço inválido'); done?.(false); return; }
    this.outbound.set(target, null);
    const timeout = source === 'scan' ? this.scanPolicy.dialTimeoutMs : (this.o.handshakeTimeoutMs ?? 5000);
    this.o.api.connect(host, port, timeout).then(id => {
      if (this.stopped || this.outbound.get(target) !== null) { this.o.api.close(id); done?.(false); return; }
      this.outbound.set(target, id);
      if (source === 'scan') this.see('scan', host);
      let opened = false;
      this.handle(id, false, host, target, source, () => { opened = true; }, () => done?.(opened));
    }, err => {
      if (this.outbound.get(target) === null) this.outbound.delete(target);
      this.noteError(target, dialError(err));
      done?.(false);
    });
  }

  private onSocket(e: LanSocketEvent) {
    switch (e.type) {
      case 'udp': if (e.data.length <= 64) this.onBeacon(e.data, e.host); break;
      case 'accept':
        // O servidor nativo só escuta no IP do Wi-Fi; mesmo assim, origem fora da rede local é recusada.
        if (!isPrivateLan(e.host)) { this.o.api.close(e.id); break; }
        this.handle(e.id, true, e.host, joinHostPort(e.host, e.port), 'inbound');
        break;
      case 'frame': this.onConnFrame(e.id, e.data); break;
      case 'close': this.onConnClose(e.id); break;
      case 'network': {
        this.wifi = e.info;
        for (const fn of this.netSubs) { try { fn(e.info); } catch { /* ouvinte */ } }
        break;
      }
      case 'mdns': this.onMdns({ name: e.name, host: e.host, tcp: e.tcp, tagHex: e.tag ?? undefined }); break;
    }
  }

  private caps() {
    return defaultCapabilities({ media: Medium.Eth, relay: this.relay, storageMiB: 0, mtu: this.o.mtu ?? MAX_FRAME_BYTES });
  }

  private release(c: Conn) {
    if (!c.pendingHeld) return;
    c.pendingHeld = false;
    if (!c.inbound) { this.pendingOut--; return; }
    this.pendingIn--;
    const n = (this.pendingPerIp.get(c.ip) ?? 1) - 1;
    if (n > 0) this.pendingPerIp.set(c.ip, n); else this.pendingPerIp.delete(c.ip);
  }

  private handle(id: number, inbound: boolean, ip: string, address: string, source: DialSource | 'inbound', onOpen?: () => void, onClose?: () => void) {
    const api = this.o.api;
    if (this.stopped) { api.close(id); onClose?.(); return; }
    // M-04: vagas separadas para quem entra e para quem este celular chama; teto por IP de origem.
    const busy = inbound
      ? this.pendingIn >= (this.o.maxPendingIn ?? 8) || (this.pendingPerIp.get(ip) ?? 0) >= (this.o.maxPendingPerIp ?? 4)
      : this.pendingOut >= (this.o.maxPendingOut ?? 8);
    if (busy) {
      try { api.send(id, errorFrame(LnnpErrorCode.Busy, 'Ocupado.')); } catch { /* fechando */ }
      api.close(id);
      if (!inbound && this.outbound.get(address) === id) this.outbound.delete(address);
      onClose?.();
      return;
    }
    if (inbound) { this.pendingIn++; this.pendingPerIp.set(ip, (this.pendingPerIp.get(ip) ?? 0) + 1); } else this.pendingOut++;
    const hs = new Handshake({ node: this.node, caps: this.caps(), now: this.sec(), replay: this.replay, versions: { min: LNNP_MIN_VERSION, max: LNNP_VERSION } });
    const c: Conn = { id, inbound, ip, address, source, state: 'hello', hs, timer: null, pendingHeld: true, link: null, onOpen, onClose };
    this.conns.set(id, c);
    api.setFrameLimit(id, HANDSHAKE_MAX);
    c.timer = setTimeout(() => {
      if (c.state === 'hello' || c.state === 'auth') { this.sendRaw(c, errorFrame(LnnpErrorCode.State, 'Tempo esgotado.')); this.fail(c, 'tempo esgotado'); }
    }, this.o.handshakeTimeoutMs ?? 5000);
    this.sendRaw(c, hs.hello);
  }

  private sendRaw(c: Conn, bytes: Uint8Array) {
    if (c.state === 'closed') return;
    try { this.o.api.send(c.id, bytes); } catch { /* conexão caiu: o evento de fechamento chega */ }
  }

  private fail(c: Conn, reason: string) {
    if (c.state === 'closed') return;
    this.release(c);
    if (!c.inbound) this.noteError(c.address, `handshake recusado: ${reason}`);
    else this.o.log?.(`LAN: handshake recusado (${reason})`);
    this.drop(c);
  }

  /** Fecha a conexão e limpa tudo dela (uma vez só). */
  private drop(c: Conn) {
    const wasClosed = c.state === 'closed';
    c.state = 'closed';
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    this.release(c);
    if (c.link) this.detach(c.link);
    this.conns.delete(c.id);
    if (!c.inbound && this.outbound.get(c.address) === c.id) this.outbound.delete(c.address);
    if (!wasClosed) { try { this.o.api.close(c.id); } catch { /* já fechada */ } }
    const onClose = c.onClose;
    c.onClose = undefined;
    onClose?.();
  }

  private onConnClose(id: number) {
    const c = this.conns.get(id);
    if (!c) return;
    if (c.state === 'hello' || c.state === 'auth') { this.release(c); if (!c.inbound) this.noteError(c.address, 'conexão fechada'); }
    else if (c.state === 'open' && !c.inbound && !this.stopped) this.noteError(c.address, 'enlace encerrado (o vizinho saiu ou a rede caiu)');
    c.state = 'closed';
    this.drop(c);
  }

  private onConnFrame(id: number, data: Uint8Array) {
    const c = this.conns.get(id);
    if (!c || c.state === 'closed') return;
    try {
      if (c.state !== 'open' && data.length > HANDSHAKE_MAX) throw new LnnpError(LnnpErrorCode.TooLarge, 'Quadro grande demais.');
      if (c.state === 'hello') { this.sendRaw(c, c.hs.receiveHello(data)); c.state = 'auth'; return; }
      if (c.state === 'auth') {
        const session = c.hs.receiveAuth(data);
        if (c.timer) clearTimeout(c.timer);
        c.timer = null;
        this.release(c);
        c.state = 'open';
        this.o.api.setFrameLimit(id, MAX_FRAME_BYTES + RECORD_OVERHEAD);
        if (this.links.size >= (this.o.maxLinks ?? 16) && !this.links.has(session.peerId)) {
          this.sendRaw(c, session.seal(FrameType.Close));
          this.drop(c);
          return;
        }
        const link: Link = { key: `${session.peerId}#${++this.seq}`, conn: c, session, since: this.now(), reassembler: null, name: null, announced: false, hintTimer: null };
        if (!c.inbound) this.peerOf.set(c.address, session.peerId);
        if (!this.attach(link)) { this.drop(c); return; }
        c.link = link;
        c.onOpen?.();
        if (!c.inbound) { const d = this.dialInfo.get(c.address); if (d) d.error = null; }
        return;
      }
      const link = c.link;
      if (link) this.onRecord(link, link.session.open(data));
    } catch (e) {
      if (e instanceof LnnpError && !e.fromPeer && c.state !== 'open') this.sendRaw(c, errorFrame(e.wire, e.message));
      this.fail(c, e instanceof Error ? e.message : 'erro');
    }
  }

  /** Enlace pronto. Já existindo outro com o mesmo nó, fica o aberto pelo nó de chave menor (os dois lados decidem igual). */
  private attach(link: Link): boolean {
    const id = link.session.peerId;
    const existing = this.links.get(id);
    if (existing) {
      const iAmLo = toHex(this.node.pk) < toHex(link.session.peerPk);
      const preferred = (l: Link) => (iAmLo ? !l.conn.inbound : l.conn.inbound);
      if (!(preferred(link) && !preferred(existing))) return false;
      // Troca de conexão sem derrubar o vizinho lógico: o enlace novo herda o nome e o aviso.
      link.name = existing.name;
      link.announced = existing.announced;
      if (existing.hintTimer) clearTimeout(existing.hintTimer);
      existing.conn.link = null;
      this.links.set(id, link);
      this.drop(existing.conn);
    } else this.links.set(id, link);
    this.lastSeenAt = this.now();
    this.o.log?.(`LAN: vizinho ${id} conectado (${link.conn.address}, LNNP v${link.session.version})`);
    // Nome curto deste nó (só celular↔celular faz uso; Desktop/Node ignoram o tipo).
    const name = this.o.name;
    if (name && NODE_NAME.test(name)) this.sendRaw(link.conn, link.session.seal(NODE_HINT_FRAME, utf8(name)));
    if (!link.announced) link.hintTimer = setTimeout(() => this.announce(link), this.o.hintWaitMs ?? 400);
    return true;
  }

  private announce(link: Link) {
    if (link.hintTimer) clearTimeout(link.hintTimer);
    link.hintTimer = null;
    if (link.announced || this.links.get(link.session.peerId) !== link) return;
    link.announced = true;
    this.emit({ type: 'up', medium: 'lan', id: link.session.peerId, name: link.name ?? undefined });
  }

  private detach(link: Link) {
    if (link.hintTimer) clearTimeout(link.hintTimer);
    link.hintTimer = null;
    const id = link.session.peerId;
    if (this.links.get(id) !== link) return;
    this.links.delete(id);
    this.o.log?.(`LAN: vizinho ${id} desconectado`);
    if (link.announced) { this.emit({ type: 'down', medium: 'lan', id }); this.emit({ type: 'lost', medium: 'lan', id }); }
  }

  /** Registro decifrado. Envelopes (inteiros ou em fragmentos) sobem; recibos e quadros de operador são coisa de nó. */
  private onRecord(link: Link, f: { type: number; body: Uint8Array }) {
    const id = link.session.peerId;
    switch (f.type) {
      case FrameType.Envelope: this.emit({ type: 'data', medium: 'lan', id, data: f.body }); break;
      case FrameType.Fragment: {
        if (!link.reassembler) link.reassembler = new Reassembler();
        let whole: Uint8Array | null = null;
        try { whole = link.reassembler.push(f.body, this.sec()); } catch (e) { this.o.log?.(`LAN: fragmento inválido de ${id} (${(e as Error).message})`); }
        if (whole) this.emit({ type: 'data', medium: 'lan', id, data: whole });
        break;
      }
      case FrameType.Ping: this.sendRaw(link.conn, link.session.seal(FrameType.Pong, f.body.slice(0, 8))); break;
      case FrameType.Close: case FrameType.Error: this.drop(link.conn); break;
      case NODE_HINT_FRAME: {
        // Só o primeiro nome vale (sem trocar de vizinho depois) e só no formato do app.
        if (link.name !== null || f.body.length > 16) break;
        const name = fromUtf8(f.body);
        if (!NODE_NAME.test(name)) break;
        link.name = name;
        if (link.announced) this.emit({ type: 'found', medium: 'lan', id, name });
        else this.announce(link);
        break;
      }
      default: break; // recibos, quadros do operador, Pong, CapsUpdate, tipos futuros
    }
  }

  /** Envelope para o vizinho pelo enlace aberto; fragmenta se não cabe no MTU negociado. */
  async send(peerId: string, data: Uint8Array): Promise<void> {
    const link = this.linkOf(peerId);
    if (!link || link.conn.state !== 'open') throw new Error('Sem enlace pela rede local com este vizinho agora.');
    const max = link.session.maxFrame - 1;
    if (data.length <= max) { this.o.api.send(link.conn.id, link.session.seal(FrameType.Envelope, data)); return; }
    if (!(link.session.negotiated.features & Feature.Fragments)) throw new Error('Envelope maior que o MTU e o vizinho não aceita fragmentos.');
    for (const part of fragment(data, max)) this.o.api.send(link.conn.id, link.session.seal(FrameType.Fragment, part));
  }
}
