/**
 * Um quadro do fundo da chamada (design CHAMADA-DE-VOZ.md §5), pronto para desenhar em uma passada:
 * os pontos da malha vêm agrupados por faixa de opacidade (cada grupo = uma chamada `drawPoints` no
 * Skia), mais anéis, contorno vivo, flash e o avatar. A matemática é a de src/calls/callVisual.ts.
 */
import { SWIPE, END_SECONDS, CONTOUR_STYLE, avatarScale, contour, dotAlpha, dotRadius, flashAlpha, rings, swipeLabels, type CallGeometry, type FrameInput } from '../calls/callVisual';
import type { CallState } from '../calls/callMachine';

/** Faixas de opacidade: passo de 0,01 (o repouso 0,07 fica exato; a diferença não se vê). */
export const ALPHA_LEVELS = 100;

export type CallGrid = { n: number; x: number[]; y: number[] };

/** Pontos da grade (18 px a partir de 9, 9) para a tela. */
export function gridOf(g: CallGeometry): CallGrid {
  const x: number[] = [], y: number[] = [];
  for (let gx = g.grid / 2; gx < g.width; gx += g.grid) for (let gy = g.grid / 2; gy < g.height; gy += g.grid) { x.push(gx); y.push(gy); }
  return { n: x.length, x, y };
}

export type DotBucket = { alpha: number; radius: number; idx: number[] };
export type CallFrame = {
  /** Em ordem crescente de opacidade; `idx` aponta para a grade. */
  buckets: DotBucket[];
  rings: { r: number; alpha: number }[];
  contours: { pts: { x: number; y: number }[]; stroke: number; fill: number }[];
  flash: number;
  avatar: { scale: number; opacity: number };
};

/** Monta o quadro no tempo `t` (s). Reaproveita `scratch` entre quadros para não alocar a cada um. */
export function buildFrame(g: CallGeometry, grid: CallGrid, f: FrameInput, t: number, scratch?: number[][]): CallFrame {
  const by = scratch ?? [];
  for (const b of by) if (b) b.length = 0;
  for (let i = 0; i < grid.n; i++) {
    const lv = Math.round(dotAlpha(g, f, t, grid.x[i]!, grid.y[i]!) * ALPHA_LEVELS);
    (by[lv] ??= []).push(i);
  }
  const buckets: DotBucket[] = [];
  for (let lv = 0; lv < by.length; lv++) {
    const idx = by[lv];
    if (!idx || !idx.length || lv === 0) continue;
    const alpha = lv / ALPHA_LEVELS;
    buckets.push({ alpha, radius: dotRadius(alpha), idx });
  }
  const ending = f.endProgress > 0;
  const k = ending ? Math.pow(1 - f.endProgress, 2) : 1;
  const contours = f.active || ending
    ? ([0, 1] as const).map(layer => ({ pts: contour(g, t, f.amp, layer, k), stroke: CONTOUR_STYLE[layer].stroke * k, fill: CONTOUR_STYLE[layer].fill }))
    : [];
  const scale = avatarScale({ incoming: f.ringing && f.speed === 1, active: f.active, amp: f.amp, t, endProgress: f.endProgress });
  return {
    buckets,
    rings: f.ringing ? rings(g, t, f.speed) : [],
    contours,
    flash: flashAlpha(f),
    avatar: { scale, opacity: ending ? 1 - f.endProgress : 1 },
  };
}

/** Entrada do quadro a partir do estado da máquina; `null` = não há o que desenhar. */
export function frameInputOf(s: CallState, o: { nowMs: number; amp: number; soft: boolean }): FrameInput | null {
  const base: FrameInput = { ringing: false, speed: 1, active: false, sinceConnect: 99, endProgress: 0, amp: 0, switching: false, soft: o.soft };
  switch (s.phase) {
    case 'calling': return { ...base, ringing: true, speed: 0.7 };
    case 'ringing': return { ...base, ringing: true, speed: 1 };
    case 'active': return { ...base, active: true, amp: o.amp, switching: !!s.switching, sinceConnect: Math.max(0, (o.nowMs - (s.connectedAt ?? o.nowMs)) / 1000) };
    case 'ending': {
      // Nunca exatamente 0: a onda que volta ao centro já aparece no primeiro quadro.
      const ep = Math.min(1, Math.max(1e-4, (o.nowMs - (s.endedAt ?? o.nowMs)) / 1000 / END_SECONDS));
      return { ...base, endProgress: ep };
    }
    default: return null;
  }
}

/** Rótulos "Recusar"/"Atender" do trilho como interpolação do `Animated` (trechos exatos de `swipeLabels`). */
export function swipeLabelRange(which: 'decline' | 'answer'): { inputRange: number[]; outputRange: number[] } {
  const m = SWIPE.travel;
  // 0,7 ∓ dx/120 chega a 1 e a 0,25 nestes deslocamentos.
  const xs = which === 'decline' ? [-m, -36, 54, m] : [-m, -54, 36, m];
  return { inputRange: xs, outputRange: xs.map(x => swipeLabels(x)[which]) };
}
