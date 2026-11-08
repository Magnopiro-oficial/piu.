// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/transport/meshtastic/fragments.ts. Não edite aqui.
/**
 * Envelope do Piu em pedaços de pacote Meshtastic (porta 256). Cabeçalho de 7 bytes: "P1", id u32 da
 * mensagem, índice<<4 | total. A porta é compartilhada com outros apps: sem a marca, o pacote é ignorado.
 */
import { DATA_PAYLOAD_LEN } from './proto.js';

const MAGIC0 = 0x50, MAGIC1 = 0x31, HEAD = 7;
export const FRAGMENT_BYTES = DATA_PAYLOAD_LEN - HEAD;
/** No máximo 4 pedaços: texto curto e recibos (2 pedaços) cabem com folga; o resto espera outro meio. */
export const LORA_MAX_PARTS = 4;
export const LORA_MAX_ENVELOPE = LORA_MAX_PARTS * FRAGMENT_BYTES;
const KEEP_MS = 60_000, MAX_PENDING = 32;
/** Mensagens lembradas depois de entregues (eco de repetidor) e variantes aceitas de cada uma. */
const MAX_DONE = 512, MAX_VARIANTS = 3;

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

type Done = { at: number; parts?: Uint8Array[]; variants: number };

const same = (a: Uint8Array | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
function join(parts: Uint8Array[]) {
  const env = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of parts) { env.set(x, o); o += x.length; }
  return env;
}

/**
 * Junta os pedaços. O id da mensagem viaja aberto: quem ouve o ar pode mandar um pedaço falso com o mesmo
 * id. Por isso, depois de entregue, um pedaço diferente do guardado monta outra variante (até
 * MAX_VARIANTS) e a assinatura do envelope, lá em cima, decide qual vale; o eco igual é ignorado.
 */
export class Reassembler {
  private pending = new Map<number, Pending>();
  /** Mensagens já entregues (os repetidores ecoam) e as minhas. */
  private done = new Map<number, Done>();

  /** Devolve o envelope inteiro quando o último pedaço chega; `null` enquanto falta algo (ou se não é do Piu). */
  push(p: Uint8Array, now: number): Uint8Array | null {
    this.prune(now);
    if (p.length <= HEAD || p[0] !== MAGIC0 || p[1] !== MAGIC1) return null;
    const id = new DataView(p.buffer, p.byteOffset).getUint32(2), idx = p[6]! >> 4, total = p[6]! & 0x0f;
    if (!total || total > LORA_MAX_PARTS || idx >= total) return null;
    const body = p.slice(HEAD);
    const d = this.done.get(id);
    if (d) {
      if (!d.parts || d.parts.length !== total || same(d.parts[idx], body) || d.variants >= MAX_VARIANTS) return null;
      d.parts[idx] = body; d.variants++;
      return join(d.parts);
    }
    let m = this.pending.get(id);
    if (m && m.total !== total) { this.pending.delete(id); return null; }
    if (!m) {
      m = { total, parts: Array.from({ length: total }, () => undefined), at: now };
      this.pending.set(id, m);
      while (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
    }
    if (m.parts[idx]) return null;
    m.parts[idx] = body;
    if (m.parts.some(x => !x)) return null;
    this.pending.delete(id);
    const parts = m.parts as Uint8Array[];
    this.remember(id, { at: now, parts, variants: 0 });
    return join(parts);
  }

  private remember(id: number, d: Done) {
    this.done.set(id, d);
    while (this.done.size > MAX_DONE) this.done.delete(this.done.keys().next().value!);
  }

  /** O que eu mesmo mandei: o eco dos repetidores não volta como mensagem nova. */
  sent(msgId: number, now: number) { this.remember(msgId >>> 0, { at: now, variants: 0 }); }

  prune(now: number) {
    for (const [id, m] of this.pending) if (now - m.at > KEEP_MS) this.pending.delete(id);
    for (const [id, d] of this.done) if (now - d.at > 10 * KEEP_MS) this.done.delete(id);
  }
}
