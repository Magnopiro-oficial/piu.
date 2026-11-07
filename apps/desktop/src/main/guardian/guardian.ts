/**
 * Desktop como guardião de ponto Piu (Piu 12 · E4/E5), sem Electron (testado em test/guardian.test.ts).
 * Ver docs/rede/guardiao-desktop.md.
 *
 * - Chave do ponto: semente aleatória NOVA (32 bytes) gerada ao ativar, nunca derivada da frase; a chave
 *   técnica do ponto sai dela com o rótulo próprio `piu/v1/ponto/node`. Nada liga o ponto às identidades
 *   nem à chave de nó da pessoa. Fica em `point.bin`, cifrada com a chave de dados do cofre do sistema;
 *   sem cofre, o ponto não ativa. Encerrar apaga a semente e os envelopes guardados.
 * - Nível e limites (`shared/guardian.ts`): Multiplicador (repassa na hora, nada no disco) ou Guardião
 *   (guarda envelopes cifrados de terceiros até N MB / N dias). Gateway: papel a mais, só com internet.
 * - Rede: o ponto fica na rede em que foi ativado. Caiu → `down` e volta sozinho; outra rede → `changed`
 *   e só continua quando a pessoa confirmar; todos os enlaces caíram juntos depois de vários aparelhos →
 *   `isolating` (o roteador pode ter começado a isolar clientes) até "Testar de novo".
 * - QR: só com a senha da rede que a PESSOA digitou (`setWifi`); o Piu nunca lê a senha salva no sistema.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { kdf } from '../../../../mobile/src/protocol/suite';
import { deriveNodeKey, type KeyPair } from '../../../../mobile/src/protocol/keys';
import { utf8, toHex } from '../../../../mobile/src/protocol/bytes';
import type { LunesRpc } from '../../../../mobile/src/lib/lunesRpc';
import {
  DEFAULT_DAYS, DEFAULT_STORAGE_MB, type GuardianConfig, type GuardianNetwork, type GuardianState, type GuardianStatus, type GuardianTest,
  MAX_GUARD_DAYS, MULTIPLIER_BUFFER_MB, MULTIPLIER_HOLD_SEC, sanitizeGuardianConfig, STORAGE_OPTIONS_MB, wifiPasswordProblem, wifiQr,
} from '../../shared/guardian';
import { LnnpLanTransport } from '../../transport/lnnpLan';
import type { Transport } from '../../transport/types';
import { type DayCounters, GuardianNode } from './guardianNode';
import { type CheckDeps, runLanCheck } from './lanCheck';
import { currentNetwork, type NetDeps } from './netinfo';
import { packRecords, readSealed, shred, unpackRecords, writeSealed } from './sealed';
import { tm } from '../i18n';

const POINT_MAGIC = 'PIUP1';
const STORE_MAGIC = 'PIUS1';

/** Chave técnica do ponto: só da semente do ponto, com rótulo próprio (nunca da frase da pessoa). */
export function pointKey(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) throw new Error('Semente do ponto inválida.');
  return deriveNodeKey(kdf(seed, utf8('piu/v1/ponto'), 'ponto/node'));
}
const storeKey = (seed: Uint8Array) => Buffer.from(kdf(seed, utf8('piu/v1/ponto'), 'ponto/store'));

interface PointFile {
  v: 1;
  seed: string;
  config: GuardianConfig;
  network: { label: string; ssid: string | null; cidr: string | null };
  createdAt: number;
  paused: boolean;
  wifi: { password: string | null; open: boolean };
  totals: { forwarded: number; receipts: number };
  day: DayCounters | null;
}

export interface GuardianOptions {
  /** Pasta só do ponto (`<userData>/guardian`). */
  dir: string;
  /** Chave de dados do cofre do sistema (32 bytes) ou `null` sem cofre. */
  dataKey: () => Promise<Buffer | null>;
  hostname: string;
  onState: (s: GuardianState) => void;
  /** Transporte LAN do ponto (testes: porta 0, sem descoberta). */
  lan?: { port?: number; discoveryPort?: number | null; listen?: string; broadcast?: string[]; peers?: string[] };
  transport?: (key: KeyPair) => Transport;
  net?: NetDeps;
  check?: CheckDeps;
  gatewayRpc?: () => LunesRpc;
  now?: () => number;
  log?: (m: string) => void;
  /** Intervalo da vigia de rede (ms). */
  watchMs?: number;
  tickMs?: number;
}

export class GuardianService {
  private p: PointFile | null = null;
  private node: GuardianNode | null = null;
  private status: GuardianStatus = 'off';
  private reason: string | undefined;
  private key: Buffer | null = null;
  private canStore = false;
  private dirty = false;
  private timers: NodeJS.Timeout[] = [];
  private lastTest: GuardianTest | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private o: GuardianOptions) {}

  private get pointFile() { return join(this.o.dir, 'point.bin'); }
  private get storeFile() { return join(this.o.dir, 'store.bin'); }
  private ms() { return this.o.now ? this.o.now() : Date.now(); }

  /** Lê o ponto salvo e, com "manter ativo" ligado e a mesma rede, liga sozinho. */
  async init() {
    try { this.key = await this.o.dataKey(); } catch { this.key = null; }
    this.canStore = !!this.key && this.key.length === 32;
    if (this.canStore) {
      try {
        const raw = readSealed(this.pointFile, this.key!, POINT_MAGIC);
        if (raw) this.p = JSON.parse(raw.toString('utf8')) as PointFile;
      } catch (e) { this.o.log?.(`ponto: arquivo do ponto ilegível (${(e as Error).message}); o ponto fica desligado`); this.p = null; }
    }
    if (this.p) {
      this.status = this.p.paused ? 'paused' : 'off';
      if (!this.p.paused && this.p.config.autoStart) await this.resume();
    }
    const t = setInterval(() => void this.watch(), this.o.watchMs ?? 10_000); t.unref(); this.timers.push(t);
    const s = setInterval(() => this.persist(), 60_000); s.unref(); this.timers.push(s);
    this.emit();
  }

  async close() {
    for (const t of this.timers.splice(0)) clearInterval(t);
    await this.stopNode();
    this.persist(true);
  }

  // ── estado para a interface ───────────────────────────
  state(): GuardianState {
    const p = this.p;
    const n = this.node;
    const st = n?.stats();
    return {
      status: p ? this.status : 'off',
      canStore: this.canStore,
      point: p ? {
        ...p.config, id: toHex(pointKey(Buffer.from(p.seed, 'hex')).pk).slice(0, 16), createdAt: p.createdAt, network: p.network,
        wifi: { set: !!p.wifi.password || p.wifi.open, open: p.wifi.open }, qr: wifiQr(p.network.ssid, p.wifi),
      } : null,
      stats: p ? {
        peersNow: n?.peersNow ?? 0, peersToday: n?.peersToday ?? (p.day && p.day.day === new Date(this.ms()).toISOString().slice(0, 10) ? p.day.seen.length : 0),
        stored: st?.stored ?? 0, storedBytes: st?.storedBytes ?? 0, maxBytes: st?.maxBytes ?? this.limits(p.config).maxBytes,
        forwarded: n?.forwarded ?? p.totals.forwarded, receipts: n?.receipts ?? p.totals.receipts,
        bytesToday: n?.bytesToday ?? (p.day && p.day.day === new Date(this.ms()).toISOString().slice(0, 10) ? p.day.bytes : 0),
        gatewayOnline: p.config.gateway ? (n?.gatewayOnline ?? false) : null, gatewaySent: n?.gatewaySent ?? 0,
      } : null,
      apk: { available: false, reason: tm('main.point.apkNeeded') },
      ...(this.reason && p ? { reason: this.reason } : {}),
    };
  }
  private emit() { this.o.onState(this.state()); }

  network() { return currentNetwork(this.o.net); }

  /** Teste automático (E4). O espaço confere contra o menor limite (o nível vem depois). */
  async test(): Promise<GuardianTest> {
    const net = await this.network();
    const t = await runLanCheck(net, { storageMB: this.p?.config.storageMB ?? STORAGE_OPTIONS_MB[0], dataDir: this.o.dir, discoveryPort: this.o.lan?.discoveryPort ?? undefined }, this.o.check);
    this.lastTest = t;
    // "Testar de novo" depois do aviso de isolamento: se os aparelhos voltaram a se ver, sai do aviso.
    if (this.p && this.status === 'isolating' && t.steps.find(s => s.id === 'peers')?.level === 'ok') { this.status = 'active'; this.reason = undefined; this.emit(); }
    return t;
  }

  private limits(c: GuardianConfig) {
    return c.level === 'multiplier'
      ? { maxBytes: MULTIPLIER_BUFFER_MB * 1024 * 1024, retentionSec: MULTIPLIER_HOLD_SEC }
      : { maxBytes: c.storageMB * 1024 * 1024, retentionSec: Math.min(c.days, MAX_GUARD_DAYS) * 86400 };
  }

  /** "Ativar ponto" (um toque, E4e): chave nova, grava cifrado e liga. */
  async activate(raw: unknown): Promise<GuardianState> {
    if (!this.canStore) throw new Error(tm('main.point.noStore'));
    if (this.p) throw new Error(tm('main.point.alreadyPoint'));
    const config = sanitizeGuardianConfig(raw, { name: `Piu · ${this.o.hostname}`.slice(0, 40), level: 'guardian', storageMB: DEFAULT_STORAGE_MB, days: DEFAULT_DAYS, gateway: false, autoStart: true });
    if (config.level === 'guardian-app') throw new Error(this.state().apk.reason);
    const net = await this.network();
    if (!net.up) throw new Error(tm('main.point.noLan'));
    if (config.gateway && !(this.lastTest?.internet)) throw new Error(tm('main.point.gatewayNeedsInternet'));
    this.p = {
      v: 1, seed: randomBytes(32).toString('hex'), config, network: { label: net.label, ssid: net.ssid, cidr: net.cidr }, createdAt: this.ms(), paused: false,
      wifi: { password: null, open: false }, totals: { forwarded: 0, receipts: 0 }, day: null,
    };
    this.persist(true);
    await this.startNode();
    return this.state();
  }

  /** Nível, limites, nome, gateway, "manter ativo". Mudou o nível ou o limite: o nó recomeça com o que guardava. */
  async update(raw: unknown): Promise<GuardianState> {
    const p = this.need();
    const next = sanitizeGuardianConfig(raw, p.config);
    if (next.level === 'guardian-app') throw new Error(this.state().apk.reason);
    if (next.gateway && !p.config.gateway && !(this.lastTest?.internet)) throw new Error(tm('main.point.gatewayRetest'));
    const restart = next.level !== p.config.level || next.storageMB !== p.config.storageMB || next.days !== p.config.days || next.gateway !== p.config.gateway;
    p.config = next;
    if (restart && this.node) { await this.stopNode(); await this.startNode(); }
    this.persist(true);
    this.emit();
    return this.state();
  }

  async pause(paused: boolean): Promise<GuardianState> {
    const p = this.need();
    p.paused = paused;
    if (paused) { await this.stopNode(); this.status = 'paused'; this.reason = undefined; }
    else await this.resume();
    this.persist(true);
    this.emit();
    return this.state();
  }

  /** E5b/E5 "o computador mudou de rede": continuar nesta rede (a pessoa confirmou). */
  async adoptNetwork(): Promise<GuardianState> {
    const p = this.need();
    const net = await this.network();
    if (!net.up) throw new Error(tm('main.point.noLanNow'));
    p.network = { label: net.label, ssid: net.ssid, cidr: net.cidr };
    // A senha digitada era da rede antiga.
    p.wifi = { password: null, open: false };
    this.persist(true);
    await this.resume();
    return this.state();
  }

  /** Senha da rede do ponto, digitada pela pessoa (para o QR). `null` e `open: false` apagam. */
  setWifi(raw: unknown): GuardianState {
    const p = this.need();
    const r = (raw ?? {}) as { password?: unknown; open?: unknown };
    const open = r.open === true;
    let password: string | null = null;
    if (!open && r.password !== null && r.password !== undefined) {
      if (typeof r.password !== 'string') throw new Error(tm('main.err.badPassword'));
      const problem = wifiPasswordProblem(r.password);
      if (problem) throw new Error(problem);
      password = r.password;
    }
    if (!p.network.ssid) throw new Error(tm('main.point.noSsid'));
    p.wifi = { password, open };
    this.persist(true);
    this.emit();
    return this.state();
  }

  /** Encerrar (E5d): para, apaga a semente (chave do ponto) e os envelopes de terceiros. */
  async end(): Promise<GuardianState> {
    this.need();
    this.node?.wipe();
    await this.stopNode(false);
    shred(this.storeFile);
    shred(this.pointFile);
    this.p = null; this.status = 'off'; this.reason = undefined; this.lastTest = null;
    this.emit();
    return this.state();
  }

  private need(): PointFile { if (!this.p) throw new Error(tm('main.point.notPoint')); return this.p; }

  // ── nó ─────────────────────────────────────────────────
  private async resume() {
    const p = this.need();
    const net = await this.network();
    if (!net.up) { this.status = 'down'; this.reason = tm('main.point.netDown', { network: p.network.label }); this.emit(); return; }
    if (!sameNetwork(p.network, net)) { this.status = 'changed'; this.reason = tm('main.point.netChanged', { current: net.label, saved: p.network.label }); this.emit(); return; }
    p.paused = false;
    await this.startNode();
  }

  private async startNode() {
    const p = this.need();
    if (this.node) return;
    const seed = Buffer.from(p.seed, 'hex');
    const key = pointKey(seed);
    const transport = this.o.transport ? this.o.transport(key) : new LnnpLanTransport({ node: key, relay: true, ...this.o.lan, log: this.o.log });
    const node = new GuardianNode({
      key, transport, limits: this.limits(p.config), day: p.day ?? undefined, totals: p.totals, log: this.o.log, tickMs: this.o.tickMs,
      gateway: p.config.gateway ? { ...(this.o.gatewayRpc ? { rpc: this.o.gatewayRpc } : {}) } : null,
      ...(this.o.now ? { now: () => Math.floor(this.o.now!() / 1000) } : {}),
      onChange: () => { this.dirty = true; },
    });
    // Guardião: o que estava guardado volta (multiplicador não guarda nada no disco).
    if (p.config.level !== 'multiplier') {
      try {
        const raw = readSealed(this.storeFile, storeKey(seed), STORE_MAGIC);
        if (raw) node.importStored(unpackRecords(raw).map(r => ({ ...r, own: false, releaseAt: 0 })));
      } catch (e) { this.o.log?.(`ponto: mensagens guardadas ilegíveis (${(e as Error).message}); começando vazio`); }
    } else shred(this.storeFile);
    this.node = node;
    await node.start();
    if ((transport as { state?: string }).state === 'unavailable') {
      this.status = 'down'; this.reason = (transport as { reason?: string }).reason ?? tm('main.point.lanNotOpen');
    } else { this.status = 'active'; this.reason = undefined; }
    this.emit();
  }

  private async stopNode(save = true) {
    const n = this.node;
    if (!n) return;
    this.node = null;
    if (save) this.snapshot(n);
    await n.stop().catch(() => {});
  }

  private snapshot(n: GuardianNode) {
    const p = this.p;
    if (!p) return;
    p.totals = { forwarded: n.forwarded, receipts: n.receipts };
    p.day = n.dayCounters();
    if (p.config.level !== 'multiplier') {
      try { writeSealed(this.storeFile, storeKey(Buffer.from(p.seed, 'hex')), packRecords(n.exportStored()), STORE_MAGIC); }
      catch (e) { this.o.log?.(`ponto: mensagens não gravadas (${(e as Error).message})`); }
    }
  }

  private persist(force = false) {
    if (!this.p || !this.key || (!force && !this.dirty)) return;
    if (this.node) this.snapshot(this.node);
    try { writeSealed(this.pointFile, this.key, Buffer.from(JSON.stringify(this.p)), POINT_MAGIC); this.dirty = false; }
    catch (e) { this.o.log?.(`ponto: não gravado (${(e as Error).message})`); }
  }

  /** Vigia de rede e de isolamento (a cada 10 s). */
  async watch() {
    const p = this.p;
    if (!p || p.paused) return;
    const net = await this.network();
    const before = this.status;
    if (!net.up) {
      if (this.status !== 'down') { await this.stopNode(); this.status = 'down'; this.reason = tm('main.point.netDown', { network: p.network.label }); }
    } else if (!sameNetwork(p.network, net)) {
      if (this.status !== 'changed') { await this.stopNode(); this.status = 'changed'; this.reason = tm('main.point.netChanged', { current: net.label, saved: p.network.label }); }
    } else if (this.status === 'down') {
      await this.startNode();
    } else if (this.status === 'active' && this.node && isolationSuspected(this.node, this.ms())) {
      this.status = 'isolating'; this.reason = tm('main.point.isolating');
    } else if (this.status === 'isolating' && this.node && this.node.peersNow > 0) {
      this.status = 'active'; this.reason = undefined;
    }
    if (this.status !== before) this.emit();
  }
}

/** Mesma rede: o mesmo nome de Wi-Fi (se havia) e a mesma sub-rede. */
export function sameNetwork(a: { ssid: string | null; cidr: string | null }, b: GuardianNetwork): boolean {
  if (a.ssid && b.ssid && a.ssid !== b.ssid) return false;
  return !a.cidr || a.cidr === b.cidr;
}

/** Vários aparelhos ligados e, de repente, todos caíram no mesmo minuto (e ninguém voltou). */
export function isolationSuspected(n: Pick<GuardianNode, 'peersNow' | 'peersEver' | 'lastDrops'>, nowMs: number): boolean {
  if (n.peersNow > 0 || n.peersEver < 2 || n.lastDrops.length < 2) return false;
  const last = n.lastDrops.slice(-2);
  return last[1]! - last[0]! <= 60_000 && nowMs - last[1]! >= 30_000;
}
