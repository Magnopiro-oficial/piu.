import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Operator { id: string; name: string; createdAt: number }
export interface Session {
  tokenHash: string; operatorId: string; csrf: string; createdAt: number; lastSeen: number; authAt: number;
  /** Id público (para listar e encerrar sessões sem expor o hash do token). */
  id: string;
  /** Navegador e sistema, para o operador reconhecer a sessão (ex.: "Firefox · Linux"). */
  label: string;
}
export type DeviceStatus = 'active' | 'paused';
export interface Device { id: string; ownerId: string; name: string; cls: string; status: DeviceStatus; today: number; family?: string; pub?: string; createdAt?: number }
/** Destino: a carteira pessoal do operador ou outro endereço `lunes:…`. */
export interface WalletTx { id: string; amount: number; at: number; to: string }
export interface Wallet { balance: number; txs: WalletTx[] }

export type HoursPolicy = 'always' | 'night' | 'day';
/** Ajustes do operador: limites globais e política de tráfego (valores do painel). */
export interface Settings {
  limits: { bw: 20 | 50 | 100; sto: 4 | 8 | 16; hours: HoursPolicy };
  policies: { media: boolean; unknown: boolean; community: boolean };
}
export const DEFAULT_SETTINGS: Settings = { limits: { bw: 50, sto: 8, hours: 'always' }, policies: { media: true, unknown: true, community: false } };

/** Celular pareado que aprova transferências. `secret` só aqui e no celular (nunca na API). */
export interface Phone { id: string; operatorId: string; name: string; secret: string; addedAt: number; confirmed: boolean }
/** Transferência esperando a aprovação no celular (5 min, uso único). */
export interface PendingTx { id: string; operatorId: string; phoneId: string; amount: number; to: string; request: string; expiresAt: number }

interface State { operators: Operator[]; sessions: Session[]; devices: Device[]; wallets: Record<string, Wallet>; settings: Record<string, Settings>; phones: Phone[]; pendingTx: PendingTx[] }

const empty = (): State => ({ operators: [], sessions: [], devices: [], wallets: {}, settings: {}, phones: [], pendingTx: [] });

/**
 * Estado do nó num arquivo JSON com permissão 0600 (só o usuário do serviço lê).
 * Gravação atômica (arquivo temporário + rename). Tokens de sessão ficam só como hash SHA-256.
 * Ids são UUIDs aleatórios: nada de id incremental exposto na API.
 */
export class Store {
  private s: State;
  private file: string | null;

  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, 'state.json') : null;
    if (this.file && dataDir) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      chmodSync(dataDir, 0o700);
      try { this.s = { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) }; } catch { this.s = empty(); }
    } else {
      this.s = empty();
    }
  }

  private save() {
    if (!this.file) return;
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  addOperator(name: string, now: number): Operator {
    const op: Operator = { id: randomUUID(), name, createdAt: now };
    this.s.operators.push(op);
    this.s.wallets[op.id] = { balance: 1284.6, txs: [] };
    // Referência: o primeiro operador recebe os equipamentos de demonstração do painel.
    if (this.s.operators.length === 1) {
      for (const [name, cls] of [['Mini-PC da garagem', 'Gateway Local'], ['Antena do telhado', 'Super Node'], ['Roteador da sala', 'Home Node']] as const) {
        this.s.devices.push({ id: randomUUID(), ownerId: op.id, name, cls, status: 'active', today: 4.12 });
      }
    }
    this.save();
    return op;
  }

  /** Operador com este nome (sem diferenciar maiúsculas). Parear de novo com o mesmo nome volta à mesma conta. */
  operatorByName(name: string) { const n = name.trim().toLocaleLowerCase('pt-BR'); return this.s.operators.find(o => o.name.toLocaleLowerCase('pt-BR') === n) ?? null; }

  operator(id: string) { return this.s.operators.find(o => o.id === id) ?? null; }

  addSession(sess: Session) { this.s.sessions.push(sess); this.save(); }
  sessionByHash(hash: string) { return this.s.sessions.find(x => x.tokenHash === hash) ?? null; }
  touchSession(hash: string, now: number) { const x = this.sessionByHash(hash); if (x) { x.lastSeen = now; this.save(); } }
  removeSession(hash: string) { this.s.sessions = this.s.sessions.filter(x => x.tokenHash !== hash); this.save(); }
  sessionsOf(operatorId: string) { return this.s.sessions.filter(x => x.operatorId === operatorId); }
  /** Encerra todas as sessões do operador menos `keepHash`. Devolve quantas encerrou. */
  removeOtherSessions(operatorId: string, keepHash: string) {
    const before = this.s.sessions.length;
    this.s.sessions = this.s.sessions.filter(x => x.operatorId !== operatorId || x.tokenHash === keepHash);
    this.save();
    return before - this.s.sessions.length;
  }
  pruneSessions(isAlive: (x: Session) => boolean) { const before = this.s.sessions.length; this.s.sessions = this.s.sessions.filter(isAlive); if (this.s.sessions.length !== before) this.save(); }

  /** Só os equipamentos do operador (a posse é checada em cada ação: anti-IDOR). */
  devicesOf(operatorId: string) { return this.s.devices.filter(d => d.ownerId === operatorId); }
  ownedDevice(operatorId: string, id: string) { return this.s.devices.find(d => d.id === id && d.ownerId === operatorId) ?? null; }
  setDeviceStatus(id: string, status: DeviceStatus) { const d = this.s.devices.find(x => x.id === id); if (d) { d.status = status; this.save(); } return d; }
  addDevice(d: Omit<Device, 'id' | 'status' | 'today'>): Device {
    const dev: Device = { ...d, id: randomUUID(), status: 'active', today: 0 };
    this.s.devices.push(dev);
    this.save();
    return dev;
  }
  removeDevice(id: string) { this.s.devices = this.s.devices.filter(d => d.id !== id); this.save(); }

  settings(operatorId: string): Settings { return this.s.settings[operatorId] ?? DEFAULT_SETTINGS; }
  /**
   * Ajustes que valem para ESTE equipamento: os do dono (o primeiro operador pareado).
   * Outros operadores podem entrar no painel, mas não mudam os limites do equipamento de outra pessoa.
   */
  nodeSettings(): Settings { const owner = this.s.operators[0]; return owner ? this.settings(owner.id) : DEFAULT_SETTINGS; }
  isOwner(operatorId: string) { return this.s.operators[0]?.id === operatorId; }
  setSettings(operatorId: string, v: Settings) { this.s.settings[operatorId] = v; this.save(); return v; }

  phonesOf(operatorId: string) { return this.s.phones.filter(p => p.operatorId === operatorId); }
  /** Celular confirmado do operador (o mais recente), se houver. */
  activePhone(operatorId: string) { return this.phonesOf(operatorId).filter(p => p.confirmed).sort((a, b) => b.addedAt - a.addedAt)[0] ?? null; }
  addPhone(p: Phone) { this.s.phones = this.s.phones.filter(x => !(x.operatorId === p.operatorId && !x.confirmed)); this.s.phones.push(p); this.save(); return p; }
  confirmPhone(id: string) { const p = this.s.phones.find(x => x.id === id); if (p) { p.confirmed = true; this.save(); } return p; }
  removePhone(id: string) { this.s.phones = this.s.phones.filter(x => x.id !== id); this.s.pendingTx = this.s.pendingTx.filter(t => t.phoneId !== id); this.save(); }
  addPendingTx(t: PendingTx, now: number) { this.s.pendingTx = this.s.pendingTx.filter(x => x.expiresAt > now && x.operatorId !== t.operatorId); this.s.pendingTx.push(t); this.save(); return t; }
  pendingTx(id: string, now: number) { return this.s.pendingTx.find(t => t.id === id && t.expiresAt > now) ?? null; }
  removePendingTx(id: string) { this.s.pendingTx = this.s.pendingTx.filter(t => t.id !== id); this.save(); }

  wallet(operatorId: string): Wallet { return this.s.wallets[operatorId] ?? { balance: 0, txs: [] }; }
  transfer(operatorId: string, amount: number, now: number, to = 'personal'): WalletTx {
    const w = this.s.wallets[operatorId];
    if (!w) throw new Error('sem carteira');
    const tx: WalletTx = { id: randomUUID(), amount, at: now, to };
    w.balance = Math.round((w.balance - amount) * 100) / 100;
    w.txs.unshift(tx);
    this.save();
    return tx;
  }
}
