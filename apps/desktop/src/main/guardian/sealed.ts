/**
 * Arquivos do ponto, cifrados (AES-256-GCM) e gravados de uma vez (tmp + rename), só para o usuário (0600):
 * - `point.bin`: configuração e a SEMENTE da chave do ponto, com a chave de dados do cofre do sistema;
 * - `store.bin`: envelopes de terceiros guardados, com uma chave derivada da semente do ponto
 *   (apagar a semente ao encerrar torna o que sobrar ilegível, mesmo antes de apagar o arquivo).
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
export interface StoredRecord { bytes: Uint8Array; from: string | null; storedAt: number; dropAt: number; sentTo: string[]; copies: number }

export function packRecords(list: StoredRecord[]): Buffer {
  const parts: Buffer[] = [];
  for (const r of list) {
    const meta = Buffer.from(JSON.stringify({ f: r.from, s: r.storedAt, d: r.dropAt, t: r.sentTo.slice(0, 32), c: r.copies }));
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
    let m: { f: string | null; s: number; d: number; t: string[]; c: number };
    try { m = JSON.parse(buf.subarray(i, i + ml).toString('utf8')); } catch { break; }
    i += ml;
    const bl = buf.readUInt32BE(i); i += 4;
    if (bl > maxEnvelope || i + bl > buf.length) break;
    const bytes = new Uint8Array(buf.subarray(i, i + bl)); i += bl;
    if (typeof m.s !== 'number' || typeof m.d !== 'number' || !Array.isArray(m.t)) continue;
    out.push({ bytes, from: typeof m.f === 'string' ? m.f : null, storedAt: m.s, dropAt: m.d, sentTo: m.t.filter(x => typeof x === 'string'), copies: Number(m.c) || 0 });
  }
  return out;
}
