/**
 * Mensagens guardadas sobrevivem ao reinício (design `devRestart`: "Mensagens guardadas continuam
 * no armazenamento local"; REQ NFR-002 e FUN-012).
 *
 * Salva em `<data>/lnnp/relay-store.bin`:
 * - os envelopes guardados pelo roteador (com a quem já foram e quantas cópias saíram, para o
 *   reinício não repetir envio nem recibo);
 * - os ids já vistos até vencerem (deduplicação: o mesmo envelope chegando de novo depois do
 *   reinício continua sendo duplicata, sem segunda entrega);
 * - os recibos guardados para o validador (evidência que não pode sumir num reinício).
 *
 * Ao subir, tudo passa de novo pelas regras do roteador: vencido (TTL ou retenção) é descartado e o
 * que não cabe no limite de armazenamento atual fica de fora (o de menor prioridade primeiro).
 *
 * O arquivo é cifrado e autenticado (AES-256-GCM) com uma chave derivada da semente do nó. Os
 * envelopes já são cifrados de ponta a ponta; a cifra aqui protege o cabeçalho (destino, prazo) de
 * quem copiar só este arquivo e detecta corrupção. Permissão 0600, pasta 0700, gravação atômica.
 * Arquivo corrompido, de outro nó ou de versão desconhecida não derruba o nó: é posto de lado
 * (`.corrompido`) e o nó sobe vazio.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
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

export function encodeSnapshot(s: RelaySnapshot, key: Uint8Array, now: number): Buffer {
  const body: FileShape = {
    v: 1, savedAt: now, seen: s.seen,
    envelopes: s.envelopes.map(e => ({ b: Buffer.from(e.bytes).toString('base64'), from: e.from, own: e.own, storedAt: e.storedAt, dropAt: e.dropAt, sentTo: e.sentTo, copies: e.copies, releaseAt: e.releaseAt })),
    receipts: s.receipts.map(r => ({ envelopeId: r.envelopeId, ackHash: toHex(r.ackHash), nodePk: toHex(r.nodePk), at: r.at, sig: toHex(r.sig) })),
  };
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(utf8(JSON.stringify(body))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

/** Abre o arquivo; `null` se não for deste nó, estiver corrompido ou numa versão desconhecida. */
export function decodeSnapshot(buf: Buffer, key: Uint8Array): RelaySnapshot | null {
  if (buf.length < MAGIC.length + IV + TAG || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  let body: FileShape;
  try {
    const iv = buf.subarray(MAGIC.length, MAGIC.length + IV);
    const tag = buf.subarray(MAGIC.length + IV, MAGIC.length + IV + TAG);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(MAGIC);
    d.setAuthTag(tag);
    const pt = Buffer.concat([d.update(buf.subarray(MAGIC.length + IV + TAG)), d.final()]);
    body = JSON.parse(pt.toString('utf8')) as FileShape;
  } catch { return null; }
  if (!body || body.v !== 1 || !Array.isArray(body.envelopes) || !Array.isArray(body.seen)) return null;
  const envelopes: StoredEnvelope[] = [];
  for (const e of body.envelopes) {
    if (!e || typeof e.b !== 'string') continue;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    envelopes.push({
      bytes: Uint8Array.from(Buffer.from(e.b, 'base64')), from: typeof e.from === 'string' ? e.from : null, own: e.own === true,
      storedAt: num(e.storedAt), dropAt: num(e.dropAt), sentTo: Array.isArray(e.sentTo) ? e.sentTo.filter(x => typeof x === 'string') : [],
      copies: num(e.copies), releaseAt: num(e.releaseAt),
    });
  }
  const seen = body.seen.filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number');
  const receipts: RelayReceipt[] = [];
  for (const r of body.receipts ?? []) {
    try { receipts.push({ envelopeId: String(r.envelopeId), ackHash: hex(r.ackHash), nodePk: hex(r.nodePk), at: Number(r.at), sig: hex(r.sig) }); } catch { /* malformado: ignora */ }
  }
  return { envelopes, seen, receipts };
}

/** Lê o arquivo salvo. Ausente: `null`. Ilegível: põe de lado e devolve `null` (o nó sobe vazio). */
export function loadSnapshot(file: string, key: Uint8Array, maxBytes: number, log?: (m: string) => void): RelaySnapshot | null {
  if (!existsSync(file)) return null;
  let snap: RelaySnapshot | null = null;
  try {
    // Teto de leitura: o que o limite de armazenamento permite, com folga para base64 e ids vistos.
    if (statSync(file).size <= maxBytes * 1.5 + 64 * 1024 ** 2) snap = decodeSnapshot(readFileSync(file), key);
  } catch { snap = null; }
  if (!snap) {
    try { renameSync(file, `${file}.corrompido`); } catch { /* sem como mover: será sobrescrito na próxima gravação */ }
    log?.('LNNP: armazenamento de mensagens ilegível, posto de lado (relay-store.bin.corrompido); o nó sobe sem mensagens guardadas');
  }
  return snap;
}

export function saveSnapshot(file: string, s: RelaySnapshot, key: Uint8Array, now: number) {
  writeFileAtomic(file, encodeSnapshot(s, key, now));
}
