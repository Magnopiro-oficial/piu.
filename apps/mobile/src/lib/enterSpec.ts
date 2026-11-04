/**
 * Parâmetros das transições de entrada do design (protótipo `piuPush`, `piuTab`, `reveal`, `fade`).
 * Lógica pura, sem React Native, para ser testável: `ui/Enter.tsx` transforma em Animated.
 */
export type EnterKind = 'push' | 'tab' | 'reveal' | 'fade' | 'none';
export type AnimKind = Exclude<EnterKind, 'none'>;

/** Pontos de controle de cubic-bezier(x1, y1, x2, y2). */
export type Bezier = [number, number, number, number];

export type EnterSpec = {
  /** Duração em ms. */
  dur: number;
  bezier: Bezier;
  /** Deslocamento inicial em px (vai a 0). */
  dx: number;
  dy: number;
  /** Escala inicial (vai a 1). */
  scale: number;
};

export const ENTER_SPEC: Record<AnimKind, EnterSpec> = {
  // piuPush: translateX(56px) → nada, 360 ms cubic-bezier(.2,.85,.3,1)
  push: { dur: 360, bezier: [0.2, 0.85, 0.3, 1], dx: 56, dy: 0, scale: 1 },
  // piuTab: translateY(16px) scale(.985) → nada, 340 ms cubic-bezier(.2,.8,.3,1)
  tab: { dur: 340, bezier: [0.2, 0.8, 0.3, 1], dx: 0, dy: 16, scale: 0.985 },
  // reveal: scale(.965) + opacidade → nada, 500 ms cubic-bezier(.2,.85,.3,1)
  reveal: { dur: 500, bezier: [0.2, 0.85, 0.3, 1], dx: 0, dy: 0, scale: 0.965 },
  // fade: só opacidade, 300 ms ease-out (CSS ease-out = cubic-bezier(0,0,.58,1))
  fade: { dur: 300, bezier: [0, 0, 0.58, 1], dx: 0, dy: 0, scale: 1 },
};

export type EnterFrame = { opacity: number; translateX: number; translateY: number; scale: number };

/** Estado final (em repouso) de qualquer entrada. */
export const ENTER_REST: EnterFrame = { opacity: 1, translateX: 0, translateY: 0, scale: 1 };

/** Estado inicial da entrada `kind`. Com "reduzir movimento", já começa em repouso. */
export function enterFrom(kind: AnimKind, reduceMotion = false): EnterFrame {
  if (reduceMotion) return ENTER_REST;
  const s = ENTER_SPEC[kind];
  return { opacity: 0, translateX: s.dx, translateY: s.dy, scale: s.scale };
}
