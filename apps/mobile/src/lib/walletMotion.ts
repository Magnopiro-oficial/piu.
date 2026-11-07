/**
 * Animações da carteira (design: `docs/animations/app.css` + `PiuApp.dc.html`, classe `Component`).
 * Lógica pura, sem React: tempos, curvas, onda do QR, gesto de segurar e cronologia da cena de pagamento,
 * para testar à parte de `ui/QrWave.tsx`, `ui/HoldToSign.tsx`, `ui/PayScene.tsx` e `app/(tabs)/wallet.tsx`.
 */

// ── curvas ────────────────────────────────────────────────

/** `cubic-bezier(x1,y1,x2,y2)` do CSS: devolve y para o progresso x (0–1), com bissecção em x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const bez = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1, t = p;
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2;
      if (bez(t, x1, x2) < p) lo = t; else hi = t;
    }
    return bez(t, y1, y2);
  };
}

export type Easing = (p: number) => number;
export interface Range { inputRange: number[]; outputRange: number[] }

/**
 * Amostra uma curva para `Animated.interpolate` (que só interpola linearmente): `samples` pontos entre
 * `delay` e `delay + dur`, mapeando `from → to` pela `ease`. Mais amostras, curva mais fiel.
 */
export function easedRange(delay: number, dur: number, from: number, to: number, ease: Easing, samples = 12): Range {
  const inputRange: number[] = [], outputRange: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    inputRange.push(delay + dur * p);
    outputRange.push(from + (to - from) * ease(p));
  }
  return { inputRange, outputRange };
}

/** `piuPop`: scale .4 → 1.14 em 70 % → 1, com a curva aplicada em cada trecho (como o CSS faz por keyframe). */
export function popRange(delay: number, dur: number, bezier: readonly [number, number, number, number] = [0.2, 0.9, 0.3, 1.4]): Range {
  const ease = cubicBezier(...bezier);
  const a = easedRange(delay, dur * 0.7, 0.4, 1.14, ease, 8);
  const b = easedRange(delay + dur * 0.7, dur * 0.3, 1.14, 1, ease, 4);
  return { inputRange: [...a.inputRange, ...b.inputRange.slice(1)], outputRange: [...a.outputRange, ...b.outputRange.slice(1)] };
}

// ── contagem do saldo ─────────────────────────────────────

/** Entrada: 0 → valor em 950 ms. Concluir: valor antigo → novo em 1,3 s. */
export const COUNT = { enter: 950, settle: 1300 } as const;

/** Easing da contagem do protótipo: `1 − (1 − p)^4`. */
export const countEase = (p: number) => 1 - Math.pow(1 - p, 4);

/** Valor mostrado `elapsed` ms depois de começar a contar de `from` até `to`. */
export function countFrame(from: number, to: number, elapsed: number, dur: number): { value: number; done: boolean } {
  const p = dur <= 0 ? 1 : Math.min(1, Math.max(0, elapsed) / dur);
  if (p >= 1) return { value: to, done: true };
  return { value: from + (to - from) * countEase(p), done: false };
}

// ── entrada da carteira ───────────────────────────────────

/** Cartão de saldo: `piuCardIn .65s cubic-bezier(.2,.85,.3,1) .04s`. */
export const CARD_IN = { dur: 650, delay: 40, bezier: [0.2, 0.85, 0.3, 1] as const, dy: 26, rotateX: 16, scale: 0.96 } as const;
/** Brilho atravessando o cartão: `piuShine 1.5s cubic-bezier(.4,0,.2,1) .55s`. */
export const SHINE = { dur: 1500, delay: 550, bezier: [0.4, 0, 0.2, 1] as const } as const;
/** Anel decorativo girando com o ponto: `piuSpin 22s linear infinite`. */
export const SPIN = 22_000;
/** Botões Enviar/Receber/Convidar: `piuPop .5s cubic-bezier(.2,.9,.3,1.4)`, atraso .32s + 70 ms cada. */
export const ACTION_POP = { dur: 500, bezier: [0.2, 0.9, 0.3, 1.4] as const } as const;
export const actionDelay = (i: number) => 320 + i * 70;
/** Linhas de atividade: `piuUp .45s cubic-bezier(.2,.85,.3,1)`, atraso .3s + 45 ms (no máximo 8 degraus). */
export const ROW_UP = { dur: 450, bezier: [0.2, 0.85, 0.3, 1] as const, dy: 16 } as const;
export const rowDelay = (i: number) => 300 + Math.min(i, 8) * 45;
/** Linha nova depois de Concluir: `piuRowFresh 1.8s cubic-bezier(.2,.85,.3,1) .35s` (desce 14 px, destaque some). */
export const ROW_FRESH = { dur: 1800, delay: 350, bezier: [0.2, 0.85, 0.3, 1] as const, dy: -14, settleAt: 0.22 } as const;

// ── QR em onda ────────────────────────────────────────────

/**
 * `piuQr .35s cubic-bezier(.2,.9,.3,1.5)`, atraso = 120 ms + distância ao centro × 28 ms (grade de 29);
 * linha de leitura `piuScan 2.6s ease-in-out 1.1s infinite`; ícone central `piuPop .5s` a 1 s; cartão `piuPop .6s` a .12s.
 */
export const QR_WAVE = {
  base: 120, perModule: 28, refGrid: 29, dur: 350, bezier: [0.2, 0.9, 0.3, 1.5] as const,
  scan: { delay: 1100, period: 2600 },
  icon: { delay: 1000, dur: 500, bezier: [0.2, 0.9, 0.3, 1.5] as const },
  card: { delay: 120, dur: 600, bezier: [0.2, 0.9, 0.3, 1.25] as const },
} as const;

/** `rad`: raio dos cantos em módulos (design: 2 px nos dados, 1 px nos localizadores; 0 = quadrado). */
export interface QrModule { r: number; c: number; delay: number; rad?: number }

/** Os três localizadores (7×7 nos cantos) de uma grade n×n. */
export const qrIsFinder = (r: number, c: number, n: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

/** Atraso de nascimento do módulo (r, c) numa grade n×n: o passo encolhe para a onda durar o mesmo que na de 29. */
export function qrWaveDelay(r: number, c: number, n: number): number {
  const mid = (n - 1) / 2;
  return Math.round(QR_WAVE.base + Math.hypot(r - mid, c - mid) * QR_WAVE.perModule * QR_WAVE.refGrid / n);
}

/** Lista dos módulos escuros com o atraso de cada um; `rad(r, c)` dá o raio dos cantos (opcional). */
export function qrWaveModules(n: number, dark: (r: number, c: number) => boolean, rad?: (r: number, c: number) => number): QrModule[] {
  const out: QrModule[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) out.push({ r, c, delay: qrWaveDelay(r, c, n), ...(rad ? { rad: rad(r, c) } : {}) });
  return out;
}

/** Instante em que o último módulo termina de nascer. */
export const qrWaveTotal = (mods: QrModule[]) => mods.reduce((m, x) => Math.max(m, x.delay), 0) + QR_WAVE.dur;

const qrEase = cubicBezier(...QR_WAVE.bezier);
const fx = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * Caminho SVG (unidades = módulos) com cada módulo escuro desenhado como um quadrado que cresce do próprio
 * centro (`transform: scale(0→1)`, com overshoot da curva) no instante `t` ms. Antes do atraso, nada.
 */
export function qrWavePath(mods: QrModule[], t: number): string {
  let d = '';
  for (const m of mods) {
    const p = (t - m.delay) / QR_WAVE.dur;
    if (p <= 0) continue;
    const s = p >= 1 ? 1 : qrEase(p);
    if (s <= 0) continue;
    const o = (1 - s) / 2;
    const k = Math.min(m.rad ?? 0, s / 2);
    if (k <= 0) { d += s === 1 ? `M${m.c} ${m.r}h1v1h-1z` : `M${fx(m.c + o)} ${fx(m.r + o)}h${fx(s)}v${fx(s)}h-${fx(s)}z`; continue; }
    // Quadrado de cantos arredondados (raio k), ainda centrado no módulo.
    const x = m.c + o, y = m.r + o, e = s - 2 * k, K = fx(k), E = fx(e);
    d += `M${fx(x + k)} ${fx(y)}h${E}a${K} ${K} 0 0 1 ${K} ${K}v${E}a${K} ${K} 0 0 1 -${K} ${K}h-${E}a${K} ${K} 0 0 1 -${K} -${K}v-${E}a${K} ${K} 0 0 1 ${K} -${K}z`;
  }
  return d;
}

const inOut = cubicBezier(0.42, 0, 0.58, 1); // `ease-in-out`

/** `piuScan`: `top` 0 → 100 % (ease-in-out) e opacidade 0 → 1 em 10 % → 1 em 90 % → 0, para o progresso p (0–1) do ciclo. */
export function scanFrame(p: number): { top: number; opacity: number } {
  const q = Math.min(1, Math.max(0, p));
  const opacity = q <= 0.1 ? inOut(q / 0.1) : q >= 0.9 ? 1 - inOut((q - 0.9) / 0.1) : 1;
  return { top: q >= 1 ? 1 : inOut(q), opacity: Math.round(opacity * 1000) / 1000 };
}

// ── segurar para assinar ──────────────────────────────────

/** Enche em 900 ms; o botão encolhe até 3 %; a digital engrossa de 400 a 700; a camada que enche é `invink` a 24 %. */
export const HOLD = {
  dur: 900, shrink: 0.03, fillOpacity: 0.24, weightFrom: 400, weightTo: 700,
  /** Soltar: a escala volta com `transition: transform .2s cubic-bezier(.2,.9,.3,1.3)`; a camada zera na hora. */
  release: { dur: 200, bezier: [0.2, 0.9, 0.3, 1.3] as [number, number, number, number] },
};

export function holdFrame(elapsed: number): { pct: number; scale: number; weight: number; done: boolean } {
  const pct = Math.min(1, Math.max(0, elapsed) / HOLD.dur);
  return { pct, scale: Math.round((1 - pct * HOLD.shrink) * 1000) / 1000, weight: Math.round(HOLD.weightFrom + pct * (HOLD.weightTo - HOLD.weightFrom)), done: pct >= 1 };
}

/** Soltar antes de completar: zera e mostra "Continue segurando até completar" (só se já tinha começado). */
export const holdRelease = (pct: number) => ({ pct: 0, hint: pct > 0 });

// ── cena de pagamento ─────────────────────────────────────

export type Point = readonly [number, number];

/**
 * Cronologia (ms a partir do fim do gesto). A rota aqui é a verdadeira de uma transferência on-chain:
 * Você → rede Lunes (nó RPC) → destinatário; pontos na tela de referência 390 × 844.
 * A cena espera em `signedAt` até a assinatura real existir (biometria + sr25519 + envio ao nó) e só então segue.
 */
export const PAY = {
  iris: { dur: 750, bezier: [0.7, 0, 0.2, 1] as const, anchorY: 0.93, outDur: 520, outBezier: [0.6, 0, 0.4, 1] as const, outAnchorY: 0.24 },
  dots: { delay: 300, dur: 1000 },
  top: { delay: 350, dur: 500 },
  bar: { delay: 300, dur: 3600, bezier: [0.45, 0, 0.25, 1] as const },
  block: { pop: { delay: 250, dur: 600, bezier: [0.2, 0.9, 0.3, 1.3] as const }, ring: { delay: 300, dur: 850, bezier: [0.6, 0, 0.3, 1] as const, dash: 478 } },
  scanY: { delay: 300, dur: 550, from: -4, to: 94 },
  /** O relógio para aqui até a assinatura real existir: antes de qualquer sinal de "assinada" (fade da digital 1120, status 1150). */
  waitAt: 1100,
  /** A folha Enviar some por baixo da íris (design: `walletSheet: null` em 760 ms). */
  coverAt: 760,
  signedAt: 1150,
  verified: { delay: 1180, dur: 500, bezier: [0.2, 0.9, 0.3, 1.5] as const },
  signedWord: { delay: 1200, dur: 400, bezier: [0.2, 0.9, 0.3, 1.2] as const },
  type: { chars: 27, dur: 400, delay: 1150 },
  blockOutAt: 1600, blockOut: { dur: 450, bezier: [0.5, 0, 0.7, 0.4] as const },
  amountInAt: 1750, amountIn: { dur: 450, bezier: [0.2, 0.85, 0.3, 1] as const },
  toCoinAt: 2200, toCoin: { dur: 350, bezier: [0.6, 0, 0.9, 0.5] as const, dy: 208 },
  guide: { delay: 2100, dur: 400 },
  you: { delay: 2050, dur: 450 },
  coinPop: { delay: 2220, dur: 350 },
  flight: { start: 2400, dur: 1400 },
  trail: [
    { d: 150, op: 0.12, scale: 0.62 }, { d: 100, op: 0.22, scale: 0.74 }, { d: 50, op: 0.38, scale: 0.86 }, { d: 0, op: 1, scale: 1 },
  ],
  nodeLit: { dur: 250 }, nodeRing: { dur: 900, to: 6 },
  dest: { pop: { delay: 2440, dur: 500 }, name: { delay: 2500, dur: 400 } },
  arriveAt: 3800, bump: { dur: 550, bezier: [0.3, 0.7, 0.3, 1.4] as const },
  arriveRings: [0, 140, 280], arriveRing: { dur: 1100, to: 2.2 },
  spark: { dur: 800, bezier: [0.1, 0.7, 0.3, 1] as const, count: 16 },
  routeOutAt: 4150, routeOut: { dur: 450, bezier: [0.5, 0, 0.7, 0.4] as const },
  checkAt: 4300, checkCircle: { delay: 4320, dur: 600, bezier: [0.6, 0, 0.3, 1] as const, dash: 352 }, checkMark: { delay: 4800, dur: 380, bezier: [0.5, 0, 0.2, 1] as const, dash: 70 },
  checkRing: { delay: 4950, dur: 1200, to: 2.2 },
  amountOut: { delay: 4550, dur: 500, bezier: [0.2, 0.9, 0.3, 1.2] as const }, line: { delay: 4650 }, rows: { delay: 4800 },
  finishAt: 5000, finish: { dur: 500, bezier: [0.2, 0.85, 0.3, 1] as const },
  total: 5200,
  /** Você → rede Lunes → destinatário (tela 390 × 844). */
  route: [[195, 700], [96, 455], [195, 205]] as const satisfies readonly Point[],
  refW: 390, refH: 844,
} as const;

export type PayStage = 'signing' | 'signed' | 'sending' | 'node' | 'delivered';

/**
 * Posições verticais da cena na tela real: o topo fica a 62 px na tela de referência (barra de status de 54 px + 8)
 * e o Concluir a 38 px do fim (indicador de 34 px + 4). Com safe area maior, mantém as mesmas folgas.
 */
export const payInsets = (top: number, bottom: number) => ({ top: Math.max(top + 8, 62), finishBottom: Math.max(bottom + 4, 38) });

/** Raio da íris: `circle(150%)` do CSS = 150 % de √(w²+h²)/√2. */
export const irisRadius = (w: number, h: number) => 1.5 * Math.hypot(w, h) / Math.SQRT2;

/** Escala da máscara (0 → 1) e a inversa para o conteúdo, amostradas na mesma curva. */
export function irisScaleRanges(dur: number, ease: Easing, samples = 24): { scale: Range; inverse: Range } {
  const scale = easedRange(0, dur, 0, 1, ease, samples);
  scale.outputRange = scale.outputRange.map(v => Math.max(0.001, v));
  return { scale, inverse: { inputRange: scale.inputRange, outputRange: scale.outputRange.map(v => 1 / v) } };
}

/** Frações do comprimento total em que ficam os pontos intermediários (paradas da moeda). */
export function routeStops(points: readonly Point[]): number[] {
  const lens: number[] = [];
  for (let i = 1; i < points.length; i++) lens.push(Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < lens.length - 1; i++) { acc += lens[i]!; out.push(acc / total); }
  return out;
}

export const routeLength = (points: readonly Point[]) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return total;
};

/** Ponto na polilinha à fração `f` (0–1) do comprimento, em velocidade constante. */
export function pointAlong(points: readonly Point[], f: number): [number, number] {
  const q = Math.min(1, Math.max(0, f));
  const stops = [0, ...routeStops(points), 1];
  for (let i = 1; i < stops.length; i++) {
    if (q <= stops[i]! || i === stops.length - 1) {
      const a = points[i - 1]!, b = points[i]!, span = stops[i]! - stops[i - 1]!;
      const k = span <= 0 ? 1 : (q - stops[i - 1]!) / span;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
  }
  return [points[points.length - 1]![0], points[points.length - 1]![1]];
}

/** Quadros-chave da moeda (`piuCoinFly`, linear): um instante por vértice, proporcional ao comprimento. */
export function coinKeyframes(points: readonly Point[], start: number, dur: number): { inputRange: number[]; x: number[]; y: number[] } {
  const stops = [0, ...routeStops(points), 1];
  return { inputRange: stops.map(s => start + dur * s), x: points.map(p => p[0]), y: points.map(p => p[1]) };
}

/** Status do topo pelo instante da cena (o último vem do resultado real, fora daqui). */
export function payStage(t: number): PayStage {
  if (t >= PAY.arriveAt) return 'delivered';
  const nodeAt = PAY.flight.start + PAY.flight.dur * (routeStops(PAY.route)[0] ?? 1);
  if (t >= nodeAt) return 'node';
  if (t >= 1700) return 'sending';
  if (t >= PAY.signedAt) return 'signed';
  return 'signing';
}

/** `piuType` com `steps(n)`: quantos caracteres já apareceram em `t`. */
export function typedChars(n: number, t: number, dur: number, delay: number): number {
  if (t <= delay) return 0;
  return Math.min(n, Math.floor(((t - delay) / dur) * n));
}

/** "9f2c…a01b" (sem o 0x). */
export function shortHash(hash: string): string {
  const h = hash.startsWith('0x') ? hash.slice(2) : hash;
  return h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h;
}
