import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CertJson } from './relay/operator-frames.js';

export interface Operator { id: string; name: string; createdAt: number }
export interface Session {
  tokenHash: string; operatorId: string; csrf: string; createdAt: number; lastSeen: number; authAt: number;
  /** Id público (para listar e encerrar sessões sem expor o hash do token). */
  id: string;
  /** Navegador e sistema, para o operador reconhecer a sessão (ex.: "Firefox · Linux"). */
  label: string;
}
export type DeviceStatus = 'active' | 'paused';
/**
 * Equipamento do operador. `self`: o próprio nó que serve o painel (as estatísticas dele são reais).
 * Os outros são registros do assistente; com identidade técnica, recebem pausa e regras pela malha
 * (`DEVICE_POLICY`) e mandam um resumo assinado (`DEVICE_REPORT`) quando estão ligados a este nó.
 * `today` é legado (versões antigas guardavam um valor de referência) e não sai mais pela API.
 */
export interface Device {
  id: string; ownerId: string; name: string; cls: string; status: DeviceStatus; today?: number; family?: string; pub?: string; createdAt?: number; self?: boolean;
  /** Identidade técnica do nó (chave LNNP em hex). O próprio nó sempre tem; os outros, quando vinculados a um vizinho. */
  nodePk?: string;
  /** Certificado da identidade técnica, assinado pela chave de operador (ver relay/operator-frames.ts). */
  cert?: CertJson;
  /** Regras do equipamento (assistente, passo "Regras"). Ausente: só os limites globais. */
  limits?: DeviceLimits;
  /** Ponto de Acesso: id do equipamento (do mesmo operador) que é o nó pai dele. */
  parent?: string;
}
/** Regras de um equipamento: banda (Mbps), armazenamento para terceiros (GB) e horário. */
export interface DeviceLimits { bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: HoursPolicy }
/** Carteira declarada para um lote, assinada pela chave do nó (`PayoutClaim`, binários em hex). */
export interface PayoutClaimRecord { epoch: string; address: string; nodePk: string; sig: string; at: number }
/**
 * Movimentação da carteira. Saída (`out`, ou sem `kind` nas versões antigas): para a carteira pessoal
 * ou outro endereço `lunes:…`. Entrada (`in`): liquidação recebida, com a referência do lote em `from`.
 */
export interface WalletTx { id: string; amount: number; at: number; to: string; kind?: 'in' | 'out'; from?: string }
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

/** Endereço Lunes (SS58) da carteira de provider do operador, configurado no painel. Só leitura do saldo. */
export interface LunesAddress { address: string; at: number }

interface State { operators: Operator[]; sessions: Session[]; devices: Device[]; wallets: Record<string, Wallet>; settings: Record<string, Settings>; phones: Phone[]; pendingTx: PendingTx[]; claims: PayoutClaimRecord[];
  /** Vizinhos fixos do enlace LNNP adicionados pelo painel (`host:porta`), somados aos de `PIU_LNNP_PEERS`. */
  relayPeers: string[]; lunes: Record<string, LunesAddress> }

const empty = (): State => ({ operators: [], sessions: [], devices: [], wallets: {}, settings: {}, phones: [], pendingTx: [], claims: [], relayPeers: [], lunes: {} });

/** Dados de demonstração que as versões antigas gravavam para o primeiro operador (saldo e três equipamentos). */
const LEGACY_DEMO_BALANCE = 1284.6;
const LEGACY_DEMO_DEVICES = new Set(['Mini-PC da garagem|Gateway Local', 'Antena do telhado|Super Node', 'Roteador da sala|Home Node']);
const LEGACY_DEMO_KEYS = 'cls,id,name,ownerId,status,today';
const isLegacyDemoDevice = (d: Device) =>
  LEGACY_DEMO_DEVICES.has(`${d.name}|${d.cls}`) && d.today === 4.12 && Object.keys(d).sort().join(',') === LEGACY_DEMO_KEYS;
/** Saldo que só existe por causa do valor de demonstração: nenhuma entrada real e saídas que fecham com ele. */
const isLegacyDemoWallet = (w: Wallet) =>
  !w.txs.some(t => t.kind === 'in') && Math.round((w.balance + w.txs.reduce((s, t) => s + t.amount, 0)) * 100) === Math.round(LEGACY_DEMO_BALANCE * 100);

/** Tira os dados de demonstração gravados pelas versões antigas. Devolve se mudou algo. */
function dropLegacyDemo(s: State): boolean {
  const before = s.devices.length;
  s.devices = s.devices.filter(d => !isLegacyDemoDevice(d));
  let changed = s.devices.length !== before;
  const first = s.operators[0];
  const w = first && s.wallets[first.id];
  if (w && isLegacyDemoWallet(w)) { s.wallets[first.id] = { balance: 0, txs: [] }; changed = true; }
  return changed;
}

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
      if (dropLegacyDemo(this.s)) this.save();
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
    // Saldo começa em zero: LUNES só entram com uma liquidação de verdade (nada de valor de exemplo).
    this.s.wallets[op.id] = { balance: 0, txs: [] };
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
  /** Tira o equipamento; pontos de acesso ligados a ele ficam sem nó pai. */
  removeDevice(id: string) {
    this.s.devices = this.s.devices.filter(d => d.id !== id);
    for (const d of this.s.devices) if (d.parent === id) delete d.parent;
    this.save();
  }
  /** Muda campos de um equipamento (identidade técnica, certificado, regras). */
  updateDevice(id: string, p: Partial<Pick<Device, 'nodePk' | 'cert' | 'limits'>>) {
    const d = this.s.devices.find(x => x.id === id);
    if (d) { Object.assign(d, p); for (const k of Object.keys(p) as (keyof typeof p)[]) if (p[k] === undefined) delete d[k]; this.save(); }
    return d ?? null;
  }
  /** Algum equipamento (de qualquer operador) já tem esta identidade técnica? */
  deviceByNodePk(nodePk: string) { return this.s.devices.find(d => d.nodePk === nodePk) ?? null; }
  /** Dono do equipamento (o primeiro operador pareado). */
  owner() { return this.s.operators[0] ?? null; }

  relayPeers() { return [...this.s.relayPeers]; }
  addRelayPeer(address: string) { if (!this.s.relayPeers.includes(address)) { this.s.relayPeers.push(address); this.save(); } }
  removeRelayPeer(address: string) { const before = this.s.relayPeers.length; this.s.relayPeers = this.s.relayPeers.filter(a => a !== address); if (this.s.relayPeers.length !== before) this.save(); return before !== this.s.relayPeers.length; }

  claims() { return [...this.s.claims]; }
  /** Uma carteira por época: declarar de novo troca a anterior. */
  setClaim(c: PayoutClaimRecord) { this.s.claims = [...this.s.claims.filter(x => x.epoch !== c.epoch), c].sort((a, b) => a.epoch.localeCompare(b.epoch)); this.save(); return c; }
  /** O equipamento que serve o painel, se já tem dono. */
  selfDevice() { return this.s.devices.find(d => d.self) ?? null; }
  /**
   * Registra o próprio nó como equipamento do dono (o primeiro operador), uma vez. Chamado ao subir
   * e no primeiro pareamento. Sem dono ainda, não faz nada.
   */
  ensureSelfDevice(info: { name: string; cls: string }, now: number) {
    const owner = this.s.operators[0];
    if (!owner || this.selfDevice()) return this.selfDevice();
    const dev: Device = { id: randomUUID(), ownerId: owner.id, name: info.name, cls: info.cls, status: 'active', family: 'linux', createdAt: now, self: true };
    this.s.devices.unshift(dev);
    this.save();
    return dev;
  }

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

  /** Endereço Lunes da carteira de provider do operador (null se ainda não configurado). */
  lunesAddress(operatorId: string): LunesAddress | null { return this.s.lunes[operatorId] ?? null; }
  setLunesAddress(operatorId: string, address: string | null, now: number): LunesAddress | null {
    if (address == null) delete this.s.lunes[operatorId];
    else this.s.lunes[operatorId] = { address, at: now };
    this.save();
    return this.lunesAddress(operatorId);
  }

  wallet(operatorId: string): Wallet { return this.s.wallets[operatorId] ?? { balance: 0, txs: [] }; }
  transfer(operatorId: string, amount: number, now: number, to = 'personal'): WalletTx {
    const w = this.s.wallets[operatorId];
    if (!w) throw new Error('sem carteira');
    const tx: WalletTx = { id: randomUUID(), amount, at: now, to, kind: 'out' };
    w.balance = Math.round((w.balance - amount) * 100) / 100;
    w.txs.unshift(tx);
    this.save();
    return tx;
  }
  /**
   * Entrada na carteira: liquidação de um lote (`from` é a referência do lote). Não há caminho pela
   * API: só quem liquida de verdade (ferramenta local, testes) credita.
   */
  credit(operatorId: string, amount: number, now: number, from: string): WalletTx {
    const w = this.s.wallets[operatorId];
    if (!w) throw new Error('sem carteira');
    const tx: WalletTx = { id: randomUUID(), amount, at: now, to: 'provider', kind: 'in', from };
    w.balance = Math.round((w.balance + amount) * 100) / 100;
    w.txs.unshift(tx);
    this.save();
    return tx;
  }
}
