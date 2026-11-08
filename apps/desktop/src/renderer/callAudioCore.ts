/**
 * Partes puras do áudio da chamada no Desktop (testadas em test/callAudioCore.test.ts): nível de voz
 * a partir do RMS, suavização (sobe rápido, desce em ~150 ms), recorte em quadros de 20 ms e o relógio
 * da reprodução com folga anti-oscilação (alvo 60 ms, teto 250 ms).
 */

/** RMS (−1..1) → nível 0..1 numa escala de −50 dB a −10 dB. */
export function levelOf(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 50) / 40));
}

export function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}

/** Sobe na hora, desce com constante de tempo `fallMs`. */
export class Smoother {
  private v = 0;
  private at = 0;
  constructor(private readonly fallMs = 150) {}
  push(x: number, nowMs: number): number {
    const dt = Math.max(0, nowMs - this.at);
    this.at = nowMs;
    const decayed = this.v * Math.exp(-dt / this.fallMs);
    this.v = Math.max(x, decayed);
    return this.v;
  }
  read(nowMs: number): number { return this.v * Math.exp(-Math.max(0, nowMs - this.at) / this.fallMs); }
}

/** Junta amostras e devolve quadros de tamanho fixo (20 ms a 48 kHz = 960). */
export class Framer {
  private buf: Float32Array;
  private n = 0;
  constructor(private readonly size = 960) { this.buf = new Float32Array(size); }
  push(x: Float32Array, out: (frame: Float32Array) => void) {
    let i = 0;
    while (i < x.length) {
      const take = Math.min(this.size - this.n, x.length - i);
      this.buf.set(x.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.size) { out(this.buf.slice()); this.n = 0; }
    }
  }
  reset() { this.n = 0; }
}

export const JITTER = { targetS: 0.06, maxS: 0.25 } as const;

/**
 * Quando tocar o próximo pedaço: em sequência com o anterior; se atrasou (buffer vazio), recomeça com
 * a folga alvo; se o atraso acumulado passou do teto, descarta (`null`) para não crescer a latência.
 */
export function scheduleAt(nextS: number, nowS: number): number | null {
  if (nextS < nowS + 0.005) return nowS + JITTER.targetS;
  if (nextS > nowS + JITTER.maxS) return null;
  return nextS;
}
