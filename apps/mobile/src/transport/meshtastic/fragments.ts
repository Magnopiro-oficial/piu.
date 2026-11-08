/**
 * Envelope do Piu em pedaços de pacote Meshtastic (porta 256). Cabeçalho de 7 bytes: "P1", id u32 da
 * mensagem, índice<<4 | total. A porta é compartilhada com outros apps: sem a marca, o pacote é ignorado.
 */
import { DATA_PAYLOAD_LEN } from './proto';

const MAGIC0 = 0x50, MAGIC1 = 0x31, HEAD = 7;
export const FRAGMENT_BYTES = DATA_PAYLOAD_LEN - HEAD;
/** No máximo 4 pedaços: texto curto e recibos (2 pedaços) cabem com folga; o resto espera outro meio. */
export const LORA_MAX_PARTS = 4;
export const LORA_MAX_ENVELOPE = LORA_MAX_PARTS * FRAGMENT_BYTES;
const KEEP_MS = 60_000, MAX_PENDING = 32;

export function splitEnvelope(env: Uint8Array, msgId: number): Uint8Array[] {
  if (env.length === 0 || env.length > LORA_MAX_ENVELOPE) throw new Error('Envelope grande demais para o LoRa.');
  const total = Math.ceil(env.length / FRAGMENT_BYTES);
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const body = env.subarray(i * FRAGMENT_BYTES, (i + 1) * FRAGMENT_BYTES);
    const p = new Uint8Array(HEAD + body.length);
    p[0] = MAGIC0; p[1] = MAGIC1;
    new DataView(p.buffer).setUint32(2, msgId >>> 0);
    p[6] = (i << 4) | total;
    p.set(body, HEAD);
    out.push(p);
  }
  return out;
}

type Pending = { total: number; parts: (Uint8Array | undefined)[]; at: number };

export class Reassembler {
  private pending = new Map<number, Pending>();
  /** Mensagens já entregues (os repetidores ecoam). */
  private done = new Map<number, number>();

  /** Devolve o envelope inteiro quando o último pedaço chega; `null` enquanto falta algo (ou se não é do Piu). */
  push(p: Uint8Array, now: number): Uint8Array | null {
    this.prune(now);
    if (p.length <= HEAD || p[0] !== MAGIC0 || p[1] !== MAGIC1) return null;
    const id = new DataView(p.buffer, p.byteOffset).getUint32(2), idx = p[6]! >> 4, total = p[6]! & 0x0f;
    if (!total || total > LORA_MAX_PARTS || idx >= total || this.done.has(id)) return null;
    let m = this.pending.get(id);
    if (m && m.total !== total) { this.pending.delete(id); return null; }
    if (!m) {
      m = { total, parts: Array.from({ length: total }, () => undefined), at: now };
      this.pending.set(id, m);
      while (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
    }
    if (m.parts[idx]) return null;
    m.parts[idx] = p.slice(HEAD);
    if (m.parts.some(x => !x)) return null;
    this.pending.delete(id);
    this.done.set(id, now);
    const len = m.parts.reduce((a, x) => a + x!.length, 0), env = new Uint8Array(len);
    let o = 0;
    for (const x of m.parts) { env.set(x!, o); o += x!.length; }
    return env;
  }

  /** O que eu mesmo mandei: o eco dos repetidores não volta como mensagem nova. */
  sent(msgId: number, now: number) { this.done.set(msgId >>> 0, now); }

  prune(now: number) {
    for (const [id, m] of this.pending) if (now - m.at > KEEP_MS) this.pending.delete(id);
    for (const [id, at] of this.done) if (now - at > 10 * KEEP_MS) this.done.delete(id);
  }
}
