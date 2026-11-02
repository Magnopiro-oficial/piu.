/**
 * Blocos do Bluetooth LE (referência em TypeScript do que `PiuTransportModule.kt` e
 * `PiuTransportModule.swift` fazem). Serve de especificação executável e de vetores de teste.
 *
 * Cada bloco: cabeçalho de 8 bytes big-endian + dados.
 *   0–3 id da mensagem (UInt32, por remetente; 0 é reservado ao `hello`)
 *   4–5 índice do bloco (UInt16)
 *   6–7 total de blocos (UInt16)
 *
 * `hello` (id 0, bloco único): nome curto do nó em UTF-8 (até 64 bytes). Cada lado manda o seu
 * logo que o enlace fica pronto, para o outro saber quem é (o papel periférico não vê o anúncio
 * de quem conectou nele).
 */
export const FRAME_HEADER_BYTES = 8;
export const HELLO_ID = 0;
export const MAX_HELLO_BYTES = 64;
/** Limites da remontagem (proteção de memória contra vizinho malicioso). */
export const MAX_ENVELOPE_BYTES = 32 * 1024;
export const MAX_PARTIAL_MESSAGES = 64;
export const PARTIAL_TIMEOUT_MS = 60_000;

export interface FrameHeader { id: number; index: number; count: number }

export function frameHeader(b: Uint8Array): FrameHeader | null {
  if (b.length < FRAME_HEADER_BYTES) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { id: v.getUint32(0), index: v.getUint16(4), count: v.getUint16(6) };
}

function frame(id: number, index: number, count: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, id); v.setUint16(4, index); v.setUint16(6, count);
  out.set(body, FRAME_HEADER_BYTES);
  return out;
}

/** Divide um envelope em blocos de no máximo `mtu` bytes (cabeçalho incluído). */
export function toFrames(data: Uint8Array, mtu: number, id: number): Uint8Array[] {
  if (id === HELLO_ID) throw new Error('id 0 é reservado ao hello');
  const size = Math.max(1, mtu - FRAME_HEADER_BYTES);
  const count = Math.max(1, Math.ceil(data.length / size));
  if (count > 0xffff) throw new Error('envelope grande demais para o MTU');
  return Array.from({ length: count }, (_, i) => frame(id, i, count, data.subarray(i * size, Math.min((i + 1) * size, data.length))));
}

export function helloFrame(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name).subarray(0, MAX_HELLO_BYTES);
  return frame(HELLO_ID, 0, 1, bytes);
}

/** Próximo id de mensagem: 1..2³²−1, pulando o 0 (hello) ao dar a volta. */
export function nextMessageId(prev: number): number {
  const n = (prev + 1) >>> 0;
  return n === HELLO_ID ? 1 : n;
}

export type Reassembled = { kind: 'envelope'; data: Uint8Array } | { kind: 'hello'; name: string };

/**
 * Junta blocos por `remetente + id`. Descarta blocos inválidos, remontagens velhas (60 s),
 * envelopes acima de 32 KB e, com mais de 64 remontagens abertas, a mais antiga.
 */
export class Reassembler {
  private partial = new Map<string, { parts: Map<number, Uint8Array>; bytes: number; count: number; started: number }>();

  constructor(private now: () => number = Date.now) {}

  get open(): number { return this.partial.size; }

  push(from: string, chunk: Uint8Array): Reassembled | null {
    const h = frameHeader(chunk);
    if (!h || h.count === 0 || h.index >= h.count) return null;
    const body = chunk.subarray(FRAME_HEADER_BYTES);
    if (h.id === HELLO_ID) {
      if (h.count !== 1 || body.length === 0 || body.length > MAX_HELLO_BYTES) return null;
      return { kind: 'hello', name: new TextDecoder().decode(body) };
    }
    // Cada bloco leva ao menos 1 byte: total de blocos acima do teto é inválido.
    if (h.count > MAX_ENVELOPE_BYTES) return null;
    // Todos os blocos menos o último têm o mesmo tamanho: dá para recusar cedo um envelope grande demais.
    if (h.index < h.count - 1 && body.length * (h.count - 1) > MAX_ENVELOPE_BYTES) return null;
    const t = this.now();
    for (const [k, v] of this.partial) if (t - v.started >= PARTIAL_TIMEOUT_MS) this.partial.delete(k);
    const key = from + '-' + h.id;
    let entry = this.partial.get(key);
    if (entry && entry.count !== h.count) { this.partial.delete(key); entry = undefined; }
    if (!entry) {
      if (this.partial.size >= MAX_PARTIAL_MESSAGES) {
        let oldest: string | undefined, at = Infinity;
        for (const [k, v] of this.partial) if (v.started < at) { at = v.started; oldest = k; }
        if (oldest) this.partial.delete(oldest);
      }
      entry = { parts: new Map(), bytes: 0, count: h.count, started: t };
    }
    if (!entry.parts.has(h.index)) { entry.parts.set(h.index, body.slice()); entry.bytes += body.length; }
    if (entry.bytes > MAX_ENVELOPE_BYTES) { this.partial.delete(key); return null; }
    if (entry.parts.size < entry.count) { this.partial.set(key, entry); return null; }
    this.partial.delete(key);
    const out = new Uint8Array(entry.bytes);
    let off = 0;
    for (let i = 0; i < entry.count; i++) { const p = entry.parts.get(i)!; out.set(p, off); off += p.length; }
    return { kind: 'envelope', data: out };
  }

  clear(from?: string) {
    if (from === undefined) { this.partial.clear(); return; }
    for (const k of [...this.partial.keys()]) if (k.startsWith(from + '-')) this.partial.delete(k);
  }
}
