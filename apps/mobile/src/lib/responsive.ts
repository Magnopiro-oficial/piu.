import { useWindowDimensions } from 'react-native';

/** Referência do design: iPhone de 390 × 844. */
const BASE_W = 390;

/**
 * Medidas da tela para adaptar o layout a celulares de 320 a 430+ px de largura.
 * - `compact`: telas estreitas (< 375 px, ex.: iPhone SE 1ª geração e Androids de 360 px).
 * - `short`: telas baixas (< 700 px), em que elementos decorativos devem encolher.
 * - `fit(n)`: escala um tamanho do design para a largura atual (entre 82% e 100%).
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const k = Math.min(1, Math.max(0.82, width / BASE_W));
  return { width, height, compact: width < 375, short: height < 700, fit: (n: number) => Math.round(n * k) };
}
