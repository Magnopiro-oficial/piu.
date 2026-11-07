/**
 * O nó do ponto Piu neste computador: enlace LNNP próprio (chave do PONTO, não a identidade nem a chave de
 * nó da pessoa) + roteador store-and-forward do protocolo (apps/mobile/src/protocol/router.ts), sem
 * identidade nenhuma: não abre nada, só guarda e repassa envelopes cifrados (o roteador lê só o cabeçalho).
 * Gateway opcional (com internet): abre só as cargas endereçadas ao gateway de transações
 * (protocol/carry.ts) e as entrega com o mesmo CarryGateway do celular e do piu-node.
 * Estatísticas reais, só contagens: nenhum id de aparelho sai daqui.
 */
import { createHash } from 'node:crypto';
import { CarryGateway } from '../../../../mobile/src/lib/carryGateway';
import { finalizedHead, LunesRpc } from '../../../../mobile/src/lib/lunesRpc';
import { carryOf, CarryKind, GATEWAY_TX_IDENTITY, gatewayKindOf, sealCarryReceipt } from '../../../../mobile/src/protocol/carry';
import { envelopeId, openDirect } from '../../../../mobile/src/protocol/envelope';
import type { KeyPair } from '../../../../mobile/src/protocol/keys';
import { Router, type StoredEnvelope } from '../../../../mobile/src/protocol/router';
import type { Transport } from '../../transport/types';

export interface NodeLimits { maxBytes: number; retentionSec: number }

export interface GuardianNodeOptions {
  key: KeyPair;
  transport: Transport;
  limits: NodeLimits;
  /** Gateway de transações (só com internet). `rpc` nos testes. */
  gateway?: { rpc?: () => LunesRpc; probeMs?: number; tickMs?: number } | null;
  /** Contagem do dia (restaurada do disco). */
  day?: DayCounters;
  totals?: { forwarded: number; receipts: number };
  now?: () => number;
  log?: (m: string) => void;
  tickMs?: number;
  /** Algo nas contagens mudou (para gravar de vez em quando). */
  onChange?: () => void;
}

/** Contagens do dia: aparelhos distintos (só hashes salgados com o dia, que não se ligam entre dias) e bytes. */
export interface DayCounters { day: string; seen: string[]; bytes: number }
const MAX_SEEN_TODAY = 5000;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class GuardianNode {
  readonly router: Router;
  private peers = new Set<string>();
  private unsub: (() => void) | null = null;
  private timers: NodeJS.Timeout[] = [];
  private today: DayCounters;
  private seenToday: Set<string>;
  forwarded: number;
  receipts: number;
  private carry: CarryGateway | null = null;
  gatewayOnline: boolean | null = null;
  gatewaySent = 0;
  /** Quando cada enlace caiu (para o aviso de roteador isolando). */
  lastDrops: number[] = [];
  /** Aparelhos distintos vistos desde que ligou (para saber se "deixaram de se ver"). */
  peersEver = 0;
  private running = false;

  constructor(private o: GuardianNodeOptions) {
    const now = this.ms();
    this.today = o.day && o.day.day === dayKey(now) ? { ...o.day, seen: [...o.day.seen] } : { day: dayKey(now), seen: [], bytes: 0 };
    this.seenToday = new Set(this.today.seen);
    this.forwarded = o.totals?.forwarded ?? 0;
    this.receipts = o.totals?.receipts ?? 0;
    const gw = o.gateway ?? null;
    this.router = new Router({
      node: o.key, identities: [], relay: true,
      limits: { maxBytes: o.limits.maxBytes, maxRetentionSec: o.limits.retentionSec, maxCount: Math.max(500, Math.floor(o.limits.maxBytes / 2048)) },
      // Só o gateway de transações, e só com o papel ligado e a Lunes alcançável.
      openExtra: (bytes, h, nowSec) => (this.carry && this.gatewayOnline && gatewayKindOf(h) === CarryKind.Tx ? openDirect(bytes, GATEWAY_TX_IDENTITY, nowSec) : null),
    });
    if (gw) {
      const rpc = gw.rpc ?? (() => new LunesRpc());
      this.carry = new CarryGateway({
        rpc, now: () => this.sec(), postBundle: null, log: o.log,
        reply: (to, rc) => { this.router.send(sealCarryReceipt(to, rc, this.sec()).bytes, this.sec()); this.flushAll(); },
      });
      this.gatewayOnline = false;
      const probe = async () => {
        const c = rpc();
        try { await finalizedHead(c); this.gatewayOnline = true; } catch { this.gatewayOnline = false; } finally { c.close(); }
        o.onChange?.();
      };
      this.probeGateway = probe;
      this.gatewayTimers = [gw.probeMs ?? 60_000, gw.tickMs ?? 15_000];
    }
  }
  private probeGateway: (() => Promise<void>) | null = null;
  private gatewayTimers: [number, number] | null = null;

  private ms() { return this.o.now ? this.o.now() * 1000 : Date.now(); }
  private sec() { return this.o.now ? this.o.now() : Math.floor(Date.now() / 1000); }

  get peersNow() { return this.peers.size; }
  get peersToday() { this.rollDay(); return this.seenToday.size; }
  get bytesToday() { this.rollDay(); return this.today.bytes; }
  dayCounters(): DayCounters { this.rollDay(); return { day: this.today.day, seen: [...this.seenToday], bytes: this.today.bytes }; }

  private rollDay() {
    const d = dayKey(this.ms());
    if (d !== this.today.day) { this.today = { day: d, seen: [], bytes: 0 }; this.seenToday = new Set(); }
  }
  /** Conta o aparelho no dia sem guardar o id: hash do id com o dia (não liga um dia ao outro). */
  private countPeer(id: string) {
    this.rollDay();
    const h = createHash('sha256').update(`piu/ponto/dia/${this.today.day}/${id}`).digest('hex').slice(0, 16);
    if (!this.seenToday.has(h) && this.seenToday.size < MAX_SEEN_TODAY) { this.seenToday.add(h); this.o.onChange?.(); }
  }
  private addBytes(n: number) { this.rollDay(); this.today.bytes += n; }

  async start() {
    if (this.running) return;
    this.running = true;
    this.unsub = this.o.transport.subscribe(e => {
      switch (e.type) {
        case 'connected': this.peers.add(e.id); this.peersEver++; this.countPeer(e.id); this.flush(e.id); break;
        case 'disconnected': if (this.peers.delete(e.id)) { this.lastDrops.push(this.ms()); this.lastDrops = this.lastDrops.slice(-20); } break;
        case 'envelope': this.receive(e.from, e.data); break;
        default: break;
      }
    });
    await this.o.transport.start();
    const every = (ms: number, fn: () => void) => { const t = setInterval(fn, ms); t.unref(); this.timers.push(t); };
    every(this.o.tickMs ?? 2000, () => { this.router.purge(this.sec()); this.flushAll(); });
    if (this.probeGateway && this.gatewayTimers && this.carry) {
      const carry = this.carry;
      void this.probeGateway();
      every(this.gatewayTimers[0], () => { void this.probeGateway!(); });
      every(this.gatewayTimers[1], () => { void carry.tick(); });
    }
  }

  async stop() {
    this.running = false;
    for (const t of this.timers.splice(0)) clearInterval(t);
    this.unsub?.(); this.unsub = null;
    this.peers.clear();
    await this.o.transport.stop();
  }

  /** Envelope de um vizinho: guarda (se couber) e repassa aos outros conectados. */
  receive(from: string, data: Uint8Array) {
    this.addBytes(data.length);
    const r = this.router.ingest(data, from, this.sec());
    if (r.status === 'delivered') {
      // Só o gateway abre (openExtra): carga de transação para a Lunes.
      const c = carryOf(r.message, data);
      if (c && this.carry) void this.carry.handle(c).then(res => { if (res === 'submitted') this.gatewaySent++; this.o.log?.(`ponto: gateway → ${res}`); this.o.onChange?.(); });
      this.router.inbox.length = 0;
      return;
    }
    if (r.status === 'stored') { this.o.onChange?.(); this.flushAll(from); }
  }

  private flushAll(except?: string) { for (const p of this.peers) if (p !== except) this.flush(p); }

  private flush(peer: string) {
    const before = this.router.receipts.length;
    const out = this.router.outgoing(peer, 'eth', this.sec());
    if (this.router.receipts.length > before) {
      this.receipts += this.router.receipts.length - before;
      // Recibos ficam para o validador num ponto com gateway/internet; aqui só a contagem (memória curta).
      if (this.router.receipts.length > 1000) this.router.receipts.splice(0, this.router.receipts.length - 1000);
    }
    for (const bytes of out) {
      this.forwarded++;
      this.addBytes(bytes.length);
      this.o.transport.send(peer, bytes).catch(() => { try { this.router.unsent(peer, envelopeId(bytes)); } catch { /* inválido */ } this.forwarded--; });
    }
    if (out.length) this.o.onChange?.();
  }

  stats() {
    const s = this.router.stats();
    return { stored: s.stored, storedBytes: s.bytes, maxBytes: this.router.limits.maxBytes };
  }

  exportStored(): StoredEnvelope[] { return this.router.exportStored().filter(e => !e.own); }
  importStored(list: StoredEnvelope[]) { return this.router.importStored(list, this.sec()); }
  /** Apaga tudo o que o ponto guarda de outras pessoas (encerrar). */
  wipe() { for (const e of this.router.exportStored()) this.router.forget(envelopeId(e.bytes)); }
}
