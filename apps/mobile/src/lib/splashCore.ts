/**
 * Tempos da tela de abertura animada (design: `piuPop`, `piuUp`, `piuFade`, `piuDot`, `piuSplashOut`, `piuReveal`).
 * Lógica pura, sem React, para ser testada à parte de `ui/Splash.tsx`.
 */
export const SPLASH = {
  /** Quanto tempo a tela fica depois de o app estar pronto, antes de começar a sair. */
  hold: 900,
  /** Saída da tela: scale 1,08 + fade. */
  exit: 420,
  /** Entrada do conteúdo do app: scale 0,965→1 + fade. */
  reveal: 500,
  /** Ícone: scale 0,4→1,14→1. */
  pop: { dur: 600, delay: 50 },
  /** Texto "piu.": sobe 16 px com fade. */
  up: { dur: 450, delay: 220 },
  /** Bloco de baixo (pontinhos + texto mono): fade. */
  fade: { dur: 400, delay: 350 },
  /** Design: a splash sai ~2,6 s depois do boot (`boot()` → 2,6 s → `piuSplashOut`). */
  untilExit: 2600,
  /** Pontinhos: período de cada piscada e defasagem entre eles. */
  dot: { period: 1000, stagger: 150 },
} as const;

export interface SplashPlan {
  /** `false` com "reduzir movimento": a tela aparece parada e corta sem transição. */
  animate: boolean;
  hold: number;
  exit: number;
  reveal: number;
  /** Momento (ms após o app ficar pronto) em que a tela pode ser desmontada. */
  total: number;
}

/** Plano da abertura respeitando a opção "reduzir movimento" do sistema. */
export function splashPlan(reduceMotion: boolean): SplashPlan {
  const exit = reduceMotion ? 0 : SPLASH.exit;
  return { animate: !reduceMotion, hold: SPLASH.hold, exit, reveal: reduceMotion ? 0 : SPLASH.reveal, total: SPLASH.hold + exit };
}

/** Atraso inicial de cada pontinho, em ms (0, 150, 300…). */
export function dotDelays(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i * SPLASH.dot.stagger);
}

/**
 * Quanto a tela animada fica antes de sair, dado o tempo desde o boot do JS (o splash nativo cobre o
 * carregamento): completa os ~2,6 s do design, mas fica no mínimo `SPLASH.hold` (a entrada termina antes).
 */
export function splashHold(sinceBootMs: number): number {
  return Math.max(SPLASH.hold, SPLASH.untilExit - Math.max(0, sinceBootMs));
}
