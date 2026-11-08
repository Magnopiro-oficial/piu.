/**
 * Matemática das animações da chamada (design CHAMADA-DE-VOZ.md §5), igual no celular (Skia) e no
 * Desktop (canvas 2D). Só números: quem desenha chama estas funções a cada quadro.
 * Tempos em segundos. `amp` é o nível de voz 0..1 que vem do áudio real (não há simulação no app).
 */

export type CallGeometry = {
  width: number; height: number;
  /** Centro do efeito (o avatar). */
  cx: number; cy: number;
  grid: number;
  /** Ondas ao tocar: raio máximo e largura (σ²). */
  waveMax: number; waveSigma: number;
  /** Onda de choque ao atender: px/s e largura. */
  shockSpeed: number; shockSigma: number;
  /** Queda do brilho da voz com a distância. */
  voiceFalloff: number;
  /** Onda que volta ao desligar. */
  endWave: number; endSigma: number;
  /** Anéis: raio inicial e quanto crescem. */
  ringBase: number; ringSpan: number;
  /** Velocidade dos anéis por fase (o Desktop só desenha anéis ao chamar). */
  ringRate: number;
};

export const PHONE_GEOMETRY: CallGeometry = {
  width: 390, height: 844, cx: 195, cy: 360, grid: 18,
  waveMax: 720, waveSigma: 1800, shockSpeed: 950, shockSigma: 3200, voiceFalloff: 150,
  endWave: 520, endSigma: 1600, ringBase: 66, ringSpan: 120, ringRate: 0.62,
};

export const DESKTOP_GEOMETRY: CallGeometry = {
  width: 916, height: 754, cx: 458, cy: 260, grid: 18,
  waveMax: 900, waveSigma: 2200, shockSpeed: 1100, shockSigma: 3600, voiceFalloff: 170,
  endWave: 640, endSigma: 1800, ringBase: 66, ringSpan: 140, ringRate: 0.62,
};

/** Geometria para outro tamanho de tela: mantém as proporções do protótipo e o centro relativo. */
export function fitGeometry(base: CallGeometry, width: number, height: number, cy?: number): CallGeometry {
  return { ...base, width, height, cx: width / 2, cy: cy ?? base.cy * (height / base.height) };
}

export type FrameInput = {
  /** Tocando (chamando ou recebendo): ondas e anéis. */
  ringing: boolean;
  /** Chamando = mais calmo (0,7); recebendo = 1. */
  speed: number;
  active: boolean;
  /** Segundos desde que conectou (onda de choque). */
  sinceConnect: number;
  /** Progresso do desligar 0..1 (1,1 s); 0 fora do fim. */
  endProgress: number;
  amp: number;
  switching: boolean;
  soft: boolean;
  /** Passar para o celular: 0..1 (só Desktop). */
  handoff?: number;
};

export const END_SECONDS = 1.1;
export const SHOCK_SECONDS = 1.4;
export const REST_ALPHA = 0.07;

const gauss = (d: number, w: number, sigma: number) => Math.exp(-((d - w) * (d - w)) / sigma);

/** Opacidade de um ponto da malha a `d` px do centro (§5.1–5.5). */
export function dotAlpha(g: CallGeometry, f: FrameInput, t: number, gx: number, gy: number): number {
  const d = Math.hypot(gx - g.cx, gy - g.cy);
  let a = REST_ALPHA;
  if (f.ringing) for (let k = 0; k < 2; k++) {
    const w = ((t * f.speed + k * 0.8) % 1.6) / 1.6 * g.waveMax;
    a += (f.soft ? 0.25 : 0.6) * gauss(d, w, g.waveSigma) * (1 - w / g.waveMax);
  }
  if (f.active) {
    a += f.amp * 0.75 * Math.exp(-d / g.voiceFalloff);
    if (f.switching) a *= 0.6 + 0.4 * Math.abs(Math.sin(t * 3 + d / 60));
  }
  if (shockOn(f)) a += 1.1 * gauss(d, f.sinceConnect * g.shockSpeed, g.shockSigma) * Math.max(0, 1 - f.sinceConnect / SHOCK_SECONDS);
  if (f.handoff) a += 0.8 * Math.exp(-Math.pow(gx - f.handoff * (g.width + 80), 2) / 900) * (1 - f.handoff * 0.6);
  if (f.endProgress > 0) {
    const ep = f.endProgress, w = (1 - ep) * g.endWave;
    a = a * (1 - ep) + 0.5 * gauss(d, w, g.endSigma) * (1 - ep);
  }
  return Math.min(1, a);
}

export const shockOn = (f: FrameInput) => f.active && !f.soft && f.sinceConnect < SHOCK_SECONDS;
/** Raio de um ponto: `1 + a × 1,7`. */
export const dotRadius = (a: number) => 1 + a * 1.7;
/** Flash branco nos primeiros 0,35 s depois de atender. */
export const flashAlpha = (f: FrameInput) => (shockOn(f) && f.sinceConnect < 0.35 ? (0.35 - f.sinceConnect) * 0.9 : 0);

/** 3 anéis saindo do avatar enquanto toca. */
export function rings(g: CallGeometry, t: number, speed: number): { r: number; alpha: number }[] {
  return [0, 1, 2].map(i => {
    const p = ((t * g.ringRate * speed) + i / 3) % 1;
    return { r: g.ringBase + p * g.ringSpan, alpha: (1 - p) * 0.55 };
  });
}

/** Contorno vivo (2 camadas, 96 vértices). `k` encolhe ao desligar ((1−ep)²) e ao passar para o celular. */
export function contour(g: CallGeometry, t: number, amp: number, layer: 0 | 1, k: number, n = 96): { x: number; y: number }[] {
  const base = 72 + amp * 30 + layer * 16;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const th = i / n * Math.PI * 2;
    const r = (base + Math.sin(th * 3 + t * 2.1 + layer) * amp * 9 + Math.sin(th * 5 - t * 3.3) * amp * 6) * k;
    pts.push({ x: g.cx + Math.cos(th) * r, y: g.cy + Math.sin(th) * r });
  }
  return pts;
}
export const CONTOUR_STYLE = [{ stroke: 0.9, fill: 0.07 }, { stroke: 0.28, fill: 0.03 }] as const;

/** Escala do avatar: respira ao receber, pulsa com a voz, some ao desligar. */
export function avatarScale(o: { incoming: boolean; active: boolean; amp: number; t: number; endProgress: number; handoff?: number }): number {
  if (o.endProgress > 0) return Math.max(0.001, 1 - o.endProgress);
  if (o.active) return (1 + o.amp * 0.05) * (1 - (o.handoff ?? 0) * 0.4);
  if (o.incoming) return 1 + Math.sin(o.t * 3) * 0.015;
  return 1;
}

/** Barras de áudio: celular `4 + amp × 16 × …`; Desktop (cartão) `3 + amp × 11 × …`. */
export function barHeight(i: number, t: number, amp: number, base = 4, gain = 16): number {
  return base + amp * gain * (0.45 + 0.55 * Math.abs(Math.sin(t * 9 + i * 1.7)));
}

/** Nível do microfone na caixa "pre" do Desktop (4 barras) a partir do nível real 0..1. */
export const micBarHeight = (i: number, t: number, level: number) => 3 + level * 12 * (0.5 + 0.5 * Math.abs(Math.sin(t * 8 + i * 2)));

/** O ícone do telefone balança a cada 1,5 s durante 0,55 s (para quando o dedo está no trilho). */
export const phoneWobble = (t: number, dragging: boolean) => (!dragging && (t % 1.5) < 0.55 ? Math.sin(t * 42) * 16 : 0);

/** Anel pulsando no aviso do Desktop: ciclo 1,2 s, escala 1 → 1,5. */
export function noteRing(t: number): { scale: number; alpha: number } {
  const p = (t % 1.2) / 1.2;
  return { scale: 1 + p * 0.5, alpha: (1 - p) * 0.9 };
}

/** Quem fala, a partir dos dois níveis reais (§5.4): limiar 0,12; mudo zera o meu; trocando caminho × 0,25; suave × 0,45. */
export function voiceNow(o: { mine: number; theirs: number; muted: boolean; switching: boolean; soft: boolean }): { who: 'me' | 'them' | null; amp: number } {
  const mine = o.muted ? 0 : o.mine;
  const who = Math.max(mine, o.theirs) < 0.12 ? null : o.theirs >= mine ? 'them' : 'me';
  let amp = who === 'them' ? o.theirs : who === 'me' ? mine : 0;
  if (o.switching) amp *= 0.25;
  if (o.soft) amp *= 0.45;
  return { who, amp: Math.min(1, amp) };
}

/** Trilho de deslizar (§4.4): limiar 92 px, curso ±120 px, rótulos `0,7 ∓ dx/120` (mín. 0,25). */
export const SWIPE = { threshold: 92, travel: 120 } as const;
export const clampSwipe = (dx: number) => Math.max(-SWIPE.travel, Math.min(SWIPE.travel, dx));
export const swipeLabels = (dx: number) => ({
  decline: Math.max(0.25, Math.min(1, 0.7 - dx / 120)),
  answer: Math.max(0.25, Math.min(1, 0.7 + dx / 120)),
});
export const swipeResult = (dx: number): 'answer' | 'decline' | null => (dx > SWIPE.threshold ? 'answer' : dx < -SWIPE.threshold ? 'decline' : null);

/** Curvas (§5.6) para CSS e para Easing.bezier. */
export const CURVES = {
  enter: [0.2, 0.85, 0.3, 1] as const,
  bounce: [0.3, 1.35, 0.5, 1] as const,
  spring: [0.3, 1.4, 0.5, 1] as const,
};
