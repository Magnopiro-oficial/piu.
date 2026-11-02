/**
 * Fragmentação e remontagem para meios com MTU pequena (documento, seção 10).
 * Cada fragmento: id do envelope (16) · índice (u16) · total (u16) · dados.
 * A integridade vem do próprio envelope: depois de remontar, o id recalculado tem de bater.
 */
import { concat, ProtocolError, Reader, toHex, Writer } from './bytes';
import { envelopeId } from './envelope';

export const FRAGMENT_HEADER = 20;

export function fragment(envelope: Uint8Array, mtu: number): Uint8Array[] {
  const size = mtu - FRAGMENT_HEADER;
  if (size < 1) throw new ProtocolError('MTU', 'MTU pequena demais.');
  const id = hexToBytes(envelopeId(envelope));
  const count = Math.max(1, Math.ceil(envelope.length / size));
  if (count > 0xffff) throw new ProtocolError('TOO_LARGE', 'Fragmentos demais.');
  return Array.from({ length: count }, (_, i) => new Writer().bytes(id).u16(i).u16(count).bytes(envelope.slice(i * size, (i + 1) * size)).done());
}

interface Partial { parts: Map<number, Uint8Array>; count: number; firstAt: number; bytes: number }

/** Junta fragmentos que chegam fora de ordem; descarta envelopes incompletos depois de `timeoutSec`. */
export class Reassembler {
  private pending = new Map<string, Partial>();
  constructor(private opts = { timeoutSec: 600, maxPending: 64, maxBytes: 64 * 1024 }) {}

  /** Devolve o envelope quando o último fragmento chega e a integridade confere. */
  push(frag: Uint8Array, now: number): Uint8Array | null {
    this.expire(now);
    const r = new Reader(frag);
    const id = toHex(r.bytes(16)), index = r.u16(), count = r.u16(), data = r.bytes(r.remaining);
    if (count === 0 || index >= count) throw new ProtocolError('FRAGMENT', 'Fragmento inválido.');
    let p = this.pending.get(id);
    if (!p) {
      if (this.pending.size >= this.opts.maxPending) throw new ProtocolError('BUSY', 'Remontagens demais em andamento.');
      p = { parts: new Map(), count, firstAt: now, bytes: 0 };
      this.pending.set(id, p);
    }
    if (p.count !== count) { this.pending.delete(id); throw new ProtocolError('FRAGMENT', 'Total de fragmentos inconsistente.'); }
    if (!p.parts.has(index)) { p.parts.set(index, data); p.bytes += data.length; }
    if (p.bytes > this.opts.maxBytes) { this.pending.delete(id); throw new ProtocolError('TOO_LARGE', 'Envelope remontado grande demais.'); }
    if (p.parts.size < count) return null;
    this.pending.delete(id);
    const whole = concat(...Array.from({ length: count }, (_, i) => p!.parts.get(i)!));
    if (envelopeId(whole) !== id) throw new ProtocolError('INTEGRITY', 'Envelope remontado não confere com o id.');
    return whole;
  }

  expire(now: number) {
    for (const [id, p] of this.pending) if (now - p.firstAt > this.opts.timeoutSec) this.pending.delete(id);
  }
}

function hexToBytes(h: string) {
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}
