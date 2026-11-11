/**
 * Arquivos do ponto, cifrados (AES-256-GCM) e gravados de uma vez (tmp + rename), só para o usuário (0600):
 * - `point.bin`: configuração e a SEMENTE da chave do ponto, com a chave de dados do cofre do sistema;
 * - `store.bin`: envelopes de terceiros guardados, com uma chave derivada da semente do ponto
 *   (apagar a semente ao encerrar torna o que sobrar ilegível, mesmo antes de apagar o arquivo).
 *
 * O que fica no `store.bin`, por envelope de terceiro, até ele vencer (no máximo 7 dias):
 * - os bytes do envelope (já cifrados de ponta a ponta: o ponto não abre);
 * - quem trouxe (`f`) e para quem já foi (`t`): nunca o id do aparelho, só um nome que o ponto calcula
 *   (HMAC do id com a chave do ponto, 16 hex). Em `t` só entram os vizinhos ligados na hora da gravação;
 *   quem já saiu não fica. Toda regravação feita ao ligar o ponto (store.bin antigo, com ids em claro, ou
 *   vencidos descartados) acontece sem vizinho ligado: `f` do antigo é convertido, mas `t` vai VAZIO para o
 *   disco e só volta a ter nomes na gravação seguinte (até 1 min) com vizinhos ligados. Se o app cair nesse
 *   intervalo, o envelope pode ser reenviado uma vez a quem já tinha recebido (o aparelho descarta);
 * - quando chegou e quando some (`s`, `d`), arredondados à hora; e quantas cópias saíram (`c`).
 * Limite conhecido: quem abre o cofre do dono do ponto tem a chave do ponto e consegue conferir se um id
 * de que já suspeita passou por aqui (refaz o HMAC) e ver quais envelopes vieram do mesmo vizinho. Não dá
 * para tirar `f` sem o ponto devolver o envelope a quem o trouxe depois de reiniciar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const IV = 12, TAG = 16;

export function seal(key: Buffer, plain: Buffer, magic: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(magic));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from(magic), iv, ct, c.getAuthTag()]);
}

export function open(key: Buffer, raw: Buffer, magic: string): Buffer {
  const m = Buffer.from(magic);
  if (raw.length < m.length + IV + TAG || !raw.subarray(0, m.length).equals(m)) throw new Error('formato');
  const iv = raw.subarray(m.length, m.length + IV);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(m);
  d.setAuthTag(raw.subarray(raw.length - TAG));
  return Buffer.concat([d.update(raw.subarray(m.length + IV, raw.length - TAG)), d.final()]);
}

export function writeSealed(file: string, key: Buffer, plain: Buffer, magic: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, seal(key, plain, magic), { mode: 0o600 });
  renameSync(tmp, file);
}

/** `null` se não existe; erro se existe e não abre (chave trocada ou arquivo adulterado). */
export function readSealed(file: string, key: Buffer, magic: string): Buffer | null {
  if (!existsSync(file)) return null;
  return open(key, readFileSync(file), magic);
}

/** Apaga sobrescrevendo antes (melhor esforço: SSD e sistemas com cópia na gravação podem manter blocos antigos). */
export function shred(file: string) {
  try {
    if (existsSync(file)) {
      const n = readFileSync(file).length;
      if (n) writeFileSync(file, randomBytes(Math.min(n, 64 * 1024 * 1024)));
    }
  } catch { /* segue para apagar */ }
  rmSync(file, { force: true });
}

// ── envelopes guardados: [u32 tamanho do meta][meta JSON][u32 tamanho][bytes] … ──
export interface StoredRecord { bytes: Uint8Array; from: string | null; storedAt: number; dropAt: number; sentTo: string[]; copies: number; legacy?: true }
/** Versão do meta. Sem `v` = formato antigo, com os ids dos vizinhos em claro (`legacy`: converter e regravar). */
const RECORD_V = 2;

const HOUR = 3600;
/**
 * Horários vão ao disco arredondados à hora para baixo (não o segundo em que cada aparelho passou): ao
 * restaurar, o envelope some no máximo 1 h antes, nunca depois do prazo prometido. `f`/`t` já chegam como HMAC do id do vizinho (guardianNode.pid), nunca o id em claro.
 */
export function packRecords(list: StoredRecord[]): Buffer {
  const parts: Buffer[] = [];
  for (const r of list) {
    const s = Math.floor(r.storedAt / HOUR) * HOUR, d = Math.floor(r.dropAt / HOUR) * HOUR;
    const meta = Buffer.from(JSON.stringify({ v: RECORD_V, f: r.from, s, d, t: r.sentTo.slice(0, 32), c: r.copies }));
    const h = Buffer.alloc(4); h.writeUInt32BE(meta.length);
    const b = Buffer.alloc(4); b.writeUInt32BE(r.bytes.length);
    parts.push(h, meta, b, Buffer.from(r.bytes));
  }
  return Buffer.concat(parts);
}

export function unpackRecords(buf: Buffer, maxEnvelope = 64 * 1024): StoredRecord[] {
  const out: StoredRecord[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const ml = buf.readUInt32BE(i); i += 4;
    if (ml > 4096 || i + ml + 4 > buf.length) break;
    let m: { v?: number; f: string | null; s: number; d: number; t: string[]; c: number };
    try { m = JSON.parse(buf.subarray(i, i + ml).toString('utf8')); } catch { break; }
    i += ml;
    const bl = buf.readUInt32BE(i); i += 4;
    if (bl > maxEnvelope || i + bl > buf.length) break;
    const bytes = new Uint8Array(buf.subarray(i, i + bl)); i += bl;
    if (typeof m.s !== 'number' || typeof m.d !== 'number' || !Array.isArray(m.t)) continue;
    out.push({ bytes, from: typeof m.f === 'string' ? m.f : null, storedAt: m.s, dropAt: m.d, sentTo: m.t.filter(x => typeof x === 'string'), copies: Number(m.c) || 0, ...(m.v === RECORD_V ? {} : { legacy: true as const }) });
  }
  return out;
}
