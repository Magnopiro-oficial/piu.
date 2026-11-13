/**
 * Mensagens guardadas sobrevivem ao reinício (design `devRestart`: "Mensagens guardadas continuam
 * no armazenamento local"; REQ NFR-002 e FUN-012).
 *
 * Salva na pasta `<data>/lnnp/relay-store/`:
 * - `env/<sha256>.bin`: cada envelope guardado num arquivo próprio, gravado uma vez quando chega e
 *   apagado quando sai do roteador (o nome é o SHA-256 dos bytes; não é o id do envelope);
 * - `state.bin`: o resto, pequeno e regravado a cada rodada: a quem cada envelope já foi e quantas
 *   cópias saíram (para o reinício não repetir envio nem recibo), os ids já vistos até vencerem
 *   (deduplicação) e os recibos guardados para o validador.
 * Antes era um arquivo único (`relay-store.bin`) regravado inteiro a cada rodada: passava de algumas
 * centenas de MB num texto só (limite do JavaScript) e travava o nó enquanto gravava. Ele é lido uma
 * vez, gravado no formato novo e só então apagado.
 *
 * Ao subir, tudo passa de novo pelas regras do roteador: vencido (TTL ou retenção) é descartado e o
 * que não cabe no limite de armazenamento atual fica de fora (o de menor prioridade primeiro).
 *
 * Tudo é cifrado e autenticado (AES-256-GCM) com uma chave derivada da semente do nó; cada envelope
 * fica amarrado ao nome do arquivo (trocar um pelo outro não abre). Os envelopes já são cifrados de
 * ponta a ponta; a cifra aqui protege o cabeçalho (destino, prazo) de quem copiar a pasta e detecta
 * corrupção. Permissão 0600, pastas 0700, gravação atômica. Estado corrompido, de outro nó ou de
 * versão desconhecida não derruba o nó: é posto de lado (`.corrompido`) e o nó sobe vazio; envelope
 * ilegível fica de fora e sai do disco na gravação seguinte.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../fsutil.js';
import { toHex, utf8 } from '../protocol/bytes.js';
import type { KeyPair } from '../protocol/keys.js';
import type { RelayReceipt } from '../protocol/receipts.js';
import type { StoredEnvelope } from '../protocol/router.js';
import { kdf } from '../protocol/suite.js';

const MAGIC = Buffer.from('PIU-RELAY\x01', 'latin1');
const IV = 12, TAG = 16;

export interface RelaySnapshot {
  envelopes: StoredEnvelope[];
  seen: [string, number][];
  receipts: RelayReceipt[];
}

interface FileShape {
  v: 1;
  savedAt: number;
  seen: [string, number][];
  envelopes: { b: string; from: string | null; own: boolean; storedAt: number; dropAt: number; sentTo: string[]; copies: number; releaseAt: number }[];
  receipts: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[];
}

const hex = (s: unknown): Uint8Array => {
  if (typeof s !== 'string' || s.length % 2 || !/^[0-9a-f]*$/.test(s)) throw new Error('hex inválido');
  return Uint8Array.from(Buffer.from(s, 'hex'));
};

/** Chave do arquivo: da semente técnica do nó, com rótulo próprio (nunca a mesma de outro uso). */
export const storeKey = (node: KeyPair) => kdf(node.sk, undefined, 'piu-node/relay-store/v1');

type Meta = Omit<StoredEnvelope, 'bytes'>;
type ReceiptJson = FileShape['receipts'][number];

/** AES-256-GCM: `magic | iv | tag | cifra`, autenticando `aad` (o tipo do arquivo e, no envelope, o nome dele). */
function seal(magic: Buffer, aad: Buffer, key: Uint8Array, plain: Uint8Array): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([magic, iv, c.getAuthTag(), ct]);
}

/** O contrário de `seal`; `null` se for de outro nó, de outro tipo, de outro nome ou estiver corrompido. */
function unseal(magic: Buffer, aad: Buffer, key: Uint8Array, buf: Buffer): Buffer | null {
  if (buf.length < magic.length + IV + TAG || !buf.subarray(0, magic.length).equals(magic)) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(magic.length, magic.length + IV));
    d.setAAD(aad);
    d.setAuthTag(buf.subarray(magic.length + IV, magic.length + IV + TAG));
    return Buffer.concat([d.update(buf.subarray(magic.length + IV + TAG)), d.final()]);
  } catch { return null; }
}

const metaOf = (e: StoredEnvelope): Meta => ({ from: e.from, own: e.own, storedAt: e.storedAt, dropAt: e.dropAt, sentTo: e.sentTo, copies: e.copies, releaseAt: e.releaseAt });

/** Metadados lidos do disco, sem confiar no formato (o que faltar vira o valor neutro). */
function parseMeta(e: Partial<Record<keyof Meta, unknown>>): Meta {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return {
    from: typeof e.from === 'string' ? e.from : null, own: e.own === true, storedAt: num(e.storedAt), dropAt: num(e.dropAt),
    sentTo: Array.isArray(e.sentTo) ? e.sentTo.filter((x): x is string => typeof x === 'string') : [], copies: num(e.copies), releaseAt: num(e.releaseAt),
  };
}

const receiptsToJson = (rs: RelayReceipt[]): ReceiptJson[] => rs.map(r => ({ envelopeId: r.envelopeId, ackHash: toHex(r.ackHash), nodePk: toHex(r.nodePk), at: r.at, sig: toHex(r.sig) }));

function parseReceipts(list: unknown): RelayReceipt[] {
  const out: RelayReceipt[] = [];
  for (const r of Array.isArray(list) ? (list as ReceiptJson[]) : []) {
    try { out.push({ envelopeId: String(r.envelopeId), ackHash: hex(r.ackHash), nodePk: hex(r.nodePk), at: Number(r.at), sig: hex(r.sig) }); } catch { /* malformado: ignora */ }
  }
  return out;
}

const parseSeen = (list: unknown[]) => list.filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number');

/** Formato antigo (um arquivo só). Fica para migrar o que já estava salvo e para os testes. */
export function encodeSnapshot(s: RelaySnapshot, key: Uint8Array, now: number): Buffer {
  const body: FileShape = {
    v: 1, savedAt: now, seen: s.seen,
    envelopes: s.envelopes.map(e => ({ b: Buffer.from(e.bytes).toString('base64'), ...metaOf(e) })),
    receipts: receiptsToJson(s.receipts),
  };
  return seal(MAGIC, MAGIC, key, utf8(JSON.stringify(body)));
}

/** Abre o arquivo antigo; `null` se não for deste nó, estiver corrompido ou numa versão desconhecida. */
export function decodeSnapshot(buf: Buffer, key: Uint8Array): RelaySnapshot | null {
  let body: FileShape;
  try {
    const pt = unseal(MAGIC, MAGIC, key, buf);
    if (!pt) return null;
    body = JSON.parse(pt.toString('utf8')) as FileShape;
  } catch { return null; }
  if (!body || body.v !== 1 || !Array.isArray(body.envelopes) || !Array.isArray(body.seen)) return null;
  const envelopes: StoredEnvelope[] = [];
  for (const e of body.envelopes) {
    if (!e || typeof e.b !== 'string') continue;
    envelopes.push({ bytes: Uint8Array.from(Buffer.from(e.b, 'base64')), ...parseMeta(e) });
  }
  return { envelopes, seen: parseSeen(body.seen), receipts: parseReceipts(body.receipts) };
}

/** Lê o arquivo antigo. Ausente: `null`. Ilegível: põe de lado e devolve `null` (o nó sobe vazio). */
export function loadSnapshot(file: string, key: Uint8Array, log?: (m: string) => void): RelaySnapshot | null {
  if (!existsSync(file)) return null;
  let snap: RelaySnapshot | null = null;
  try { snap = decodeSnapshot(readFileSync(file), key); } catch { snap = null; }
  if (!snap) {
    try { renameSync(file, `${file}.corrompido`); } catch { /* sem como mover: apagado depois da primeira gravação no formato novo */ }
    log?.('LNNP: armazenamento de mensagens ilegível, posto de lado (relay-store.bin.corrompido); o nó sobe sem mensagens guardadas');
  }
  return snap;
}

const STATE_MAGIC = Buffer.from('PIU-RELAY\x02', 'latin1');
const ENV_MAGIC = Buffer.from('PIU-ENV\x01', 'latin1');
const NAME = /^[0-9a-f]{64}$/;
const envAad = (name: string) => Buffer.concat([ENV_MAGIC, Buffer.from(name, 'latin1')]);

interface StateShape {
  v: 2;
  savedAt: number;
  seen: [string, number][];
  envelopes: (Meta & { n: string })[];
  receipts: ReceiptJson[];
}

/** Pasta de armazenamento (ver o topo do arquivo). Uma por nó; `load` antes do primeiro `save`. */
export class RelayStore {
  /** Nome no disco de cada envelope, pelo próprio objeto `bytes` do roteador (o hash sai uma vez só). */
  private names = new WeakMap<Uint8Array, string>();
  /** Envelopes que estão no disco agora (os que não estiverem mais no roteador saem na próxima gravação). */
  private onDisk = new Set<string>();
  /** Veio do arquivo único antigo: a próxima gravação acontece mesmo sem mudança (e então o antigo sai). */
  migrating = false;

  constructor(readonly dir: string, private key: Uint8Array, private o: { legacyFile?: string | null; log?: (m: string) => void } = {}) {}

  private get envDir() { return join(this.dir, 'env'); }
  private get stateFile() { return join(this.dir, 'state.bin'); }
  private envFile(name: string) { return join(this.envDir, `${name}.bin`); }

  private nameOf(bytes: Uint8Array) {
    let n = this.names.get(bytes);
    if (!n) { n = createHash('sha256').update(bytes).digest('hex'); this.names.set(bytes, n); }
    return n;
  }

  load(): RelaySnapshot | null {
    this.onDisk = new Set(existsSync(this.envDir) ? readdirSync(this.envDir).filter(f => f.endsWith('.bin') && NAME.test(f.slice(0, -4))).map(f => f.slice(0, -4)) : []);
    if (!existsSync(this.stateFile)) {
      const old = this.o.legacyFile ? loadSnapshot(this.o.legacyFile, this.key, this.o.log) : null;
      this.migrating = !!old;
      return old;
    }
    let body: StateShape | null = null;
    try {
      const pt = unseal(STATE_MAGIC, STATE_MAGIC, this.key, readFileSync(this.stateFile));
      body = pt ? (JSON.parse(pt.toString('utf8')) as StateShape) : null;
    } catch { body = null; }
    if (!body || body.v !== 2 || !Array.isArray(body.envelopes) || !Array.isArray(body.seen)) {
      try { renameSync(this.stateFile, `${this.stateFile}.corrompido`); } catch { /* sem como mover: sobrescrito na próxima gravação */ }
      this.o.log?.('LNNP: armazenamento de mensagens ilegível, posto de lado (state.bin.corrompido); o nó sobe sem mensagens guardadas');
      return null;
    }
    const envelopes: StoredEnvelope[] = [];
    let lost = 0;
    for (const e of body.envelopes) {
      const name = e && typeof e.n === 'string' && NAME.test(e.n) ? e.n : null;
      let bytes: Buffer | null = null;
      if (name && this.onDisk.has(name)) {
        try { bytes = unseal(ENV_MAGIC, envAad(name), this.key, readFileSync(this.envFile(name))); } catch { bytes = null; }
      }
      if (!name || !bytes || createHash('sha256').update(bytes).digest('hex') !== name) { lost++; continue; }
      const u = Uint8Array.from(bytes);
      this.names.set(u, name);
      envelopes.push({ bytes: u, ...parseMeta(e) });
    }
    if (lost) this.o.log?.(`LNNP: ${lost} mensagens guardadas ilegíveis ou ausentes ficaram de fora`);
    return { envelopes, seen: parseSeen(body.seen), receipts: parseReceipts(body.receipts) };
  }

  /**
   * Grava primeiro os envelopes novos, depois o estado, e só então apaga os que saíram: uma queda no
   * meio deixa no máximo arquivos sobrando (apagados na rodada seguinte), nunca um estado apontando
   * para envelope que não foi gravado.
   */
  save(s: RelaySnapshot, now: number) {
    const current = new Set<string>();
    const envelopes: StateShape['envelopes'] = [];
    for (const e of s.envelopes) {
      const n = this.nameOf(e.bytes);
      if (!this.onDisk.has(n)) { writeFileAtomic(this.envFile(n), seal(ENV_MAGIC, envAad(n), this.key, e.bytes)); this.onDisk.add(n); }
      current.add(n);
      envelopes.push({ n, ...metaOf(e) });
    }
    const body: StateShape = { v: 2, savedAt: now, seen: s.seen, envelopes, receipts: receiptsToJson(s.receipts) };
    writeFileAtomic(this.stateFile, seal(STATE_MAGIC, STATE_MAGIC, this.key, utf8(JSON.stringify(body))));
    for (const n of [...this.onDisk]) {
      if (current.has(n)) continue;
      try { unlinkSync(this.envFile(n)); } catch { /* já não estava lá */ }
      this.onDisk.delete(n);
    }
    const legacy = this.o.legacyFile;
    if (legacy && existsSync(legacy)) { try { unlinkSync(legacy); } catch { /* fica para a próxima gravação */ } }
    this.migrating = false;
  }
}
