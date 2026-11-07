// Utilitários de bytes do protocolo (sem dependência de React Native).
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** Comparação em tempo constante (para MACs, hashes e tags). */
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/**
 * Inteiro na faixa do campo, sem truncar: antes `u32` fazia `>>> 0` e `X` e `X + 2^32` davam os mesmos
 * bytes (a mesma assinatura). Fora da faixa, não inteiro, NaN ou infinito: erro de quem chamou.
 */
function fixed(v: number, max: number, name: string): number {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new ProtocolError('OUT_OF_RANGE', `Valor fora de ${name}: ${v}.`);
  return v;
}

/** Escrita binária big-endian. Inteiros de largura fixa são estritos (ver `fixed`). */
export class Writer {
  private parts: Uint8Array[] = [];
  u8(v: number) { this.parts.push(Uint8Array.of(fixed(v, 0xff, 'u8'))); return this; }
  u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, fixed(v, 0xffff, 'u16')); this.parts.push(b); return this; }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, fixed(v, 0xffffffff, 'u32')); this.parts.push(b); return this; }
  bytes(b: Uint8Array) { this.parts.push(b); return this; }
  /** Bytes com prefixo de tamanho u32. */
  vbytes(b: Uint8Array) { return this.u32(b.length).bytes(b); }
  done() { return concat(...this.parts); }
}

export class ProtocolError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ProtocolError'; }
}

/** Leitura binária big-endian com verificação de limites. */
export class Reader {
  private o = 0;
  private view: DataView;
  constructor(private b: Uint8Array) { this.view = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  private need(n: number) { if (this.o + n > this.b.length) throw new ProtocolError('TRUNCATED', 'Dados truncados.'); }
  u8(): number { this.need(1); return this.b[this.o++]!; }
  u16() { this.need(2); const v = this.view.getUint16(this.o); this.o += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.o); this.o += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.b.slice(this.o, this.o + n); this.o += n; return v; }
  vbytes(max = 1 << 20) { const n = this.u32(); if (n > max) throw new ProtocolError('TOO_LARGE', 'Campo grande demais.'); return this.bytes(n); }
  get offset() { return this.o; }
  get remaining() { return this.b.length - this.o; }
}
