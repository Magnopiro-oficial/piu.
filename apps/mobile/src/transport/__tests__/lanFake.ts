/**
 * Rede local falsa, em memória, para os testes do transporte LAN: UDP (broadcast e unicast), TCP com
 * quadros (o enquadramento é do lado "nativo"), teto de quadro por conexão, mDNS e conexões de teste.
 * Entrega assíncrona (setImmediate), como os eventos da ponte nativa.
 */
import type { LanSocketApi, LanSocketEvent, LanStartOptions, ProbeResult, WifiInfo } from '../lan/types';

interface End { api: FakeApi; id: number }

export class FakeLan {
  apis: FakeApi[] = [];
  private nextId = 1;
  /** Conexão de teste: endereço → resultado (padrão: `timeout`). */
  probes = new Map<string, ProbeResult>();
  mdns = new Map<string, { api: FakeApi; name: string; udpPort: number; txt: Record<string, string> }>();
  /** Bloqueia broadcast (rede que filtra) e/ou isola clientes (nada passa entre aparelhos). */
  blockBroadcast = false;
  isolate = false;

  add(ip: string, o: Partial<WifiInfo> = {}) {
    const a = new FakeApi(this, { connected: true, internet: false, ip, prefix: 24, gateway: '192.168.1.1', ...o });
    this.apis.push(a);
    return a;
  }
  id() { return this.nextId++; }

  udp(from: FakeApi, host: string, port: number, data: Uint8Array) {
    const bcast = host === '255.255.255.255' || host.endsWith('.255');
    if (bcast && this.blockBroadcast) return;
    for (const a of this.apis) {
      if (!a.started || a.udpPort !== port) continue;
      if (this.isolate && a !== from) continue;
      if (bcast || a.info.ip === host) a.fire({ type: 'udp', host: from.info.ip!, port: from.udpPort, data: data.slice() });
    }
  }

  connect(from: FakeApi, host: string, port: number): number {
    const to = this.apis.find(a => a.started && a.info.ip === host && a.tcpPort === port && !(this.isolate && a !== from));
    if (!to) throw new Error('ECONNREFUSED');
    if (to.open() >= to.maxConnections) throw new Error('ECONNREFUSED');
    const a = this.id(), b = this.id();
    from.ends.set(a, { api: to, id: b });
    to.ends.set(b, { api: from, id: a });
    to.limits.set(b, 1 << 20);
    from.limits.set(a, 1 << 20);
    to.fire({ type: 'accept', id: b, host: from.info.ip!, port: 40000 + a });
    return a;
  }

  /** Conexão crua de um "atacante" (sem engine): devolve funções para mandar quadros e ver o que chega. */
  raw(fromIp: string, host: string, port: number) {
    const atk = this.add(fromIp);
    atk.started = true;
    const got: LanSocketEvent[] = [];
    atk.subscribe(e => got.push(e));
    const id = this.connect(atk, host, port);
    return { id, got, send: (b: Uint8Array) => atk.send(id, b), api: atk };
  }

  registerMdns(api: FakeApi, name: string, udpPort: number, txt: Record<string, string>) {
    this.mdns.set(name, { api, name, udpPort, txt });
    for (const a of this.apis) if (a.mdnsOn) this.announceTo(a);
  }
  announceTo(a: FakeApi) {
    for (const s of this.mdns.values()) {
      if (this.isolate && s.api !== a) continue;
      a.fire({ type: 'mdns', name: s.name, host: s.api.info.ip!, port: s.udpPort, tcp: s.txt.tcp ? Number(s.txt.tcp) : null, tag: s.txt.tag ?? null });
    }
  }
}

export class FakeApi implements LanSocketApi {
  started = false;
  tcpPort = 0;
  udpPort = 0;
  maxConnections = 64;
  mdnsOn = false;
  ends = new Map<number, End>();
  limits = new Map<number, number>();
  sent: { host: string; port: number; data: Uint8Array }[] = [];
  private subs = new Set<(e: LanSocketEvent) => void>();

  constructor(private lan: FakeLan, public info: WifiInfo) {}

  open() { return this.ends.size; }
  fire(e: LanSocketEvent) { setImmediate(() => { for (const fn of this.subs) fn(e); }); }

  async start(o: LanStartOptions) {
    const busy = this.lan.apis.some(a => a !== this && a.started && a.info.ip === this.info.ip && a.tcpPort === o.tcpPort);
    this.tcpPort = busy ? 50000 + this.lan.id() : o.tcpPort;
    this.udpPort = o.udpPort;
    this.maxConnections = o.maxConnections;
    this.started = true;
    return { tcpPort: this.tcpPort, udpPort: this.udpPort };
  }
  async stop() {
    this.started = false;
    for (const id of [...this.ends.keys()]) this.close(id);
    this.mdnsStop();
  }
  udpSend(host: string, port: number, data: Uint8Array) { this.sent.push({ host, port, data }); this.lan.udp(this, host, port, data); }
  async connect(host: string, port: number, _timeoutMs = 0) {
    await new Promise(r => setImmediate(r));
    return this.lan.connect(this, host, port);
  }
  send(id: number, frame: Uint8Array) {
    const e = this.ends.get(id);
    if (!e) throw new Error('conexão fechada');
    const limit = e.api.limits.get(e.id) ?? 0;
    if (frame.length === 0 || frame.length > limit) { e.api.close(e.id, 'quadro grande demais'); return; }
    e.api.fire({ type: 'frame', id: e.id, data: frame.slice() });
  }
  setFrameLimit(id: number, max: number) { if (this.ends.has(id)) this.limits.set(id, max); }
  close(id: number, reason?: string) {
    const e = this.ends.get(id);
    if (!e) return;
    this.ends.delete(id);
    this.limits.delete(id);
    this.fire({ type: 'close', id, reason });
    if (e.api.ends.has(e.id)) {
      e.api.ends.delete(e.id);
      e.api.limits.delete(e.id);
      e.api.fire({ type: 'close', id: e.id, reason: 'fechada pelo outro lado' });
    }
  }
  subscribe(fn: (e: LanSocketEvent) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  async networkInfo() { return this.info; }
  async probe(host: string, port: number) { return this.lan.probes.get(`${host}:${port}`) ?? 'timeout'; }
  mdnsStart(name: string, udpPort: number, txt: Record<string, string>) {
    this.mdnsOn = true;
    for (const [k, s] of this.lan.mdns) if (s.api === this) this.lan.mdns.delete(k);
    this.lan.registerMdns(this, name, udpPort, txt);
    this.lan.announceTo(this);
  }
  mdnsStop() {
    this.mdnsOn = false;
    for (const [k, s] of this.lan.mdns) if (s.api === this) this.lan.mdns.delete(k);
  }
  /** Muda o Wi-Fi (evento da rede). */
  setWifi(info: Partial<WifiInfo>) { this.info = { ...this.info, ...info }; this.fire({ type: 'network', info: this.info }); }
}
