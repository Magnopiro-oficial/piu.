/**
 * G.711 µ-law (PCMU), 8 kHz: o codec de reserva da chamada para celulares sem codificador Opus
 * (Android 7–9). 20 ms = 160 bytes. O Desktop decodifica aqui; o celular, no módulo nativo.
 */
const BIAS = 0x84, CLIP = 32635;

export function encodeSample(pcm: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(pcm)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

export function decodeSample(u: number): number {
  const x = ~u & 0xff;
  const sign = x & 0x80, exp = (x >> 4) & 0x07, mant = x & 0x0f;
  const s = (((mant << 3) + BIAS) << exp) - BIAS;
  return sign ? -s : s;
}

/** PCM 16 bits → µ-law. */
export const encodePcmu = (pcm: Int16Array) => Uint8Array.from(pcm, encodeSample);
/** µ-law → amostras em ponto flutuante −1..1 (para o Web Audio). */
export const decodePcmuFloat = (u: Uint8Array) => Float32Array.from(u, b => decodeSample(b) / 32768);
