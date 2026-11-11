/**
 * O nó do ponto Piu neste computador: enlace LNNP próprio (chave do PONTO, não a identidade nem a chave de
 * nó da pessoa) + roteador store-and-forward do protocolo (apps/mobile/src/protocol/router.ts), sem
 * identidade nenhuma: não abre nada, só guarda e repassa envelopes cifrados (o roteador lê só o cabeçalho).
 * Gateway opcional (com internet): abre só as cargas endereçadas ao gateway de transações
 * (protocol/carry.ts) e as entrega com o mesmo CarryGateway do celular e do piu-node.
 * Estatísticas reais, só contagens: nenhum id de aparelho sai daqui.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CarryGateway } from '../../../../mobile/src/lib/carryGateway';
import { finalizedHead, LunesRpc } from '../../../../mobile/src/lib/lunesRpc';
import { carryOf, CarryKind, GATEWAY_TX_IDENTITY, gatewayKindOf, sealCarryReceipt } from '../../../../mobile/src/protocol/carry';
import { envelopeId, openDirect } from '../../../../mobile/src/protocol/envelope';
import type { KeyPair } from '../../../../mobile/src/protocol/keys';
import { Router, type StoredEnvelope } from '../../../../mobile/src/protocol/router';
import type { Transport } from '../../transport/types';
import type { StoredRecord } from './sealed';

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
  /**
   * Sal de cada envelope guardado (32 hex): os nomes do disco são calculados com ele. A chave é o próprio
   * `bytes` do roteador (o mesmo objeto enquanto o envelope está guardado): calcular o id do envelope custa
   * ~140 µs, um hash de nome ~2 µs.
   */
  private salts = new WeakMap<Uint8Array, string>();
  /**
   * Restaurados do disco cujo vizinho ainda não ligou desde o reinício: quem trouxe (`f`) e para quem já
   * foi (`t`) só como nomes salgados. Ao ligar um vizinho, confere cada um (um hash por registro).
   */
  private pending = new Map<Uint8Array, { f: string | null; t: string[] }>();

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
  /**
   * Nome do vizinho para o roteador, só em memória: HMAC do id com a chave deste ponto. No store.bin vai
   * salgado por envelope (diskName), para o disco não mostrar quais envelopes vieram do mesmo vizinho.
   */
  pid(id: string) { return createHmac('sha256', this.o.key.sk).update(`piu/ponto/vizinho/${id}`).digest('hex').slice(0, 16); }
  /**
   * Nome do vizinho (pid) no store.bin: SHA-256(chave do vizinho + sal do envelope), 16 hex, com a chave do
   * vizinho = HMAC(chave do ponto, pid) (só quem tem a chave do ponto calcula). Muda de envelope para
   * envelope, então o disco não mostra quais vieram do mesmo vizinho. Um hash por registro (~2 µs).
   */
  private peerKey(pid: string) { return createHmac('sha256', this.o.key.sk).update(`piu/ponto/vizinho/sal/${pid}`).digest(); }
  private saltName(kp: Buffer, salt: string) { return createHash('sha256').update(kp).update(salt, 'hex').digest('hex').slice(0, 16); }
  private diskName(salt: string, pid: string) { return this.saltName(this.peerKey(pid), salt); }

  /**
   * Vizinho ligou: reconhece-o nos envelopes restaurados (sal de cada registro) e devolve ao roteador quem
   * trouxe e para quem já foi, antes do primeiro repasse a ele.
   */
  private recognize(peer: string) {
    if (!this.pending.size) return;
    const p = this.pid(peer), kp = this.peerKey(p);
    const fix: { bytes: Uint8Array; from: boolean; sent: boolean }[] = [];
    for (const [bytes, x] of this.pending) {
      const salt = this.salts.get(bytes);
      if (!salt) { this.pending.delete(bytes); continue; }
      const n = this.saltName(kp, salt);
      const from = x.f === n, sent = x.t.includes(n);
      if (!from && !sent) continue;
      if (from) x.f = null;
      if (sent) x.t = x.t.filter(y => y !== n);
      if (x.f === null && !x.t.length) this.pending.delete(bytes);
      fix.push({ bytes, from, sent });
    }
    if (!fix.length) return;
    // O roteador não muda quem trouxe de um envelope guardado: tira e devolve (mesmo `bytes`) com os nomes corrigidos.
    const stored = new Map(this.router.exportStored().map(e => [e.bytes, e] as const));
    const back: StoredEnvelope[] = [];
    for (const f of fix) {
      const e = stored.get(f.bytes);
      if (!e) { this.pending.delete(f.bytes); continue; }
      this.router.forget(envelopeId(e.bytes));
      back.push({ ...e, from: f.from ? p : e.from, sentTo: f.sent && !e.sentTo.includes(p) ? [...e.sentTo, p] : e.sentTo });
    }
    this.router.importStored(back, this.sec());
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
        case 'connected': this.peers.add(e.id); this.peersEver++; this.countPeer(e.id); this.recognize(e.id); this.flush(e.id); break;
        case 'disconnected': if (this.peers.delete(e.id)) { this.lastDrops.push(this.ms()); this.lastDrops = this.lastDrops.slice(-20); } break;
        case 'envelope': this.receive(e.from, e.data); break;
        default: break;
      }
    });
    await this.o.transport.start();
    const every = (ms: number, fn: () => void) => { const t = setInterval(fn, ms); t.unref(); this.timers.push(t); };
    every(this.o.tickMs ?? 2000, () => {
      const before = this.router.stats().stored;
      this.router.purge(this.sec());
      // Expurgo por validade também vai ao disco (sem isto, um ponto ocioso manteria vencidos no store.bin).
      if (this.router.stats().stored < before) this.o.onChange?.();
      this.flushAll();
    });
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
    const r = this.router.ingest(data, this.pid(from), this.sec());
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
    const stored = this.router.stats().stored;
    const out = this.router.outgoing(this.pid(peer), 'eth', this.sec());
    if (this.router.receipts.length > before) {
      this.receipts += this.router.receipts.length - before;
      // Recibos ficam para o validador num ponto com gateway/internet; aqui só a contagem (memória curta).
      if (this.router.receipts.length > 1000) this.router.receipts.splice(0, this.router.receipts.length - 1000);
    }
    for (const bytes of out) {
      this.forwarded++;
      this.addBytes(bytes.length);
      this.o.transport.send(peer, bytes).catch(() => { try { this.router.unsent(this.pid(peer), envelopeId(bytes)); } catch { /* inválido */ } this.forwarded--; });
    }
    // Repassou algo ou o roteador expurgou vencidos ao montar a rodada: gravar.
    if (out.length || this.router.stats().stored < stored) this.o.onChange?.();
  }

  stats() {
    const s = this.router.stats();
    return { stored: s.stored, storedBytes: s.bytes, maxBytes: this.router.limits.maxBytes };
  }

  /**
   * O que vai para o store.bin, com nomes salgados por envelope (sealed.ts). De "para quem já foi repassado"
   * só ficam os vizinhos ligados agora: quem já saiu não fica registrado no disco (a memória ainda lembra
   * enquanto o ponto está ligado). Preço: depois de reiniciar, quem tinha saído e volta pode receber o mesmo
   * envelope uma vez a mais (o aparelho descarta). Quem trouxe e ainda não ligou desde o reinício segue com
   * o nome salgado lido do disco (mesmo sal).
   */
  exportStored(): StoredRecord[] {
    const here = new Map([...this.peers].map(p => { const x = this.pid(p); return [x, this.peerKey(x)] as const; }));
    const keys = new Map(here);
    const kp = (x: string) => { let k = keys.get(x); if (!k) { k = this.peerKey(x); keys.set(x, k); } return k; };
    const live = new Set<Uint8Array>();
    const out: StoredRecord[] = [];
    for (const e of this.router.exportStored()) {
      if (e.own) continue;
      live.add(e.bytes);
      let salt = this.salts.get(e.bytes);
      if (!salt) { salt = randomBytes(16).toString('hex'); this.salts.set(e.bytes, salt); }
      const from = e.from !== null ? this.saltName(kp(e.from), salt) : (this.pending.get(e.bytes)?.f ?? null);
      out.push({ bytes: e.bytes, from, storedAt: e.storedAt, dropAt: e.dropAt, sentTo: e.sentTo.filter(x => here.has(x)).map(x => this.saltName(here.get(x)!, salt!)), copies: e.copies, salt });
    }
    for (const b of [...this.pending.keys()]) if (!live.has(b)) this.pending.delete(b);
    return out;
  }
  /**
   * Restaura o store.bin. Formatos antigos (sealed.ts) convertem sem perda: ids em claro viram o nome do
   * vizinho (pid); o nome fixo (v2) já é o pid. No formato salgado, quem trouxe e para quem foi esperam o
   * vizinho ligar (recognize). Devolve quantos voltaram.
   */
  importStored(list: StoredRecord[]) {
    const now = this.sec();
    const envs: StoredEnvelope[] = [];
    const salted = new Map<Uint8Array, { salt: string; f: string | null; t: string[] }>();
    for (const r of list) {
      const base = { bytes: r.bytes, storedAt: r.storedAt, dropAt: r.dropAt, copies: r.copies, own: false, releaseAt: 0 };
      if (r.legacy === 'clear') envs.push({ ...base, from: r.from === null ? null : this.pid(r.from), sentTo: r.sentTo.map(x => this.pid(x)) });
      else if (r.legacy === 'stable') envs.push({ ...base, from: r.from, sentTo: r.sentTo });
      else {
        envs.push({ ...base, from: null, sentTo: [] });
        if (r.salt) salted.set(r.bytes, { salt: r.salt, f: r.from, t: r.sentTo });
      }
    }
    const n = this.router.importStored(envs, now);
    for (const e of this.router.exportStored()) {
      const x = salted.get(e.bytes);
      if (!x) continue;
      this.salts.set(e.bytes, x.salt);
      if (x.f !== null || x.t.length) this.pending.set(e.bytes, { f: x.f, t: x.t });
    }
    for (const p of this.peers) this.recognize(p);
    return n;
  }
  /** Apaga tudo o que o ponto guarda de outras pessoas (encerrar). */
  wipe() { for (const e of this.router.exportStored()) this.router.forget(envelopeId(e.bytes)); this.salts = new WeakMap(); this.pending.clear(); }
}
