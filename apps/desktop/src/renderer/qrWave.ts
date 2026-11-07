/**
 * Onda do QR de pareamento (protótipo `qr(seed)` + `piuQr .35s <d>ms cubic-bezier(.2,.9,.3,1.5) both`):
 * cada módulo entra do centro para fora, com atraso proporcional à distância ao centro.
 * Só matemática, sem DOM — a pintura fica em `RealQr` (ui.tsx), que desenha num canvas em vez de
 * animar ~2 400 <div> (um QR real de pareamento tem 45–53 módulos de lado, não os 29 do protótipo;
 * com um elemento por módulo o Chromium trava ~1,4 s e a onda some).
 */

/** `cubic-bezier(x1,y1,x2,y2)` do CSS: resolve o parâmetro t para um x dado (Newton + bisseção) e devolve y. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; const e = sx(t) - x; if (Math.abs(e) < 1e-6) return sy(t); t -= e / d; }
    let lo = 0, hi = 1; t = x;
    while (hi - lo > 1e-6) { t = (lo + hi) / 2; if (sx(t) < x) lo = t; else hi = t; }
    return sy(t);
  };
}

/** Curva `piuQr` do protótipo: passa de 1 (até ~1,1) e volta. */
export const QR_POP = cubicBezier(0.2, 0.9, 0.3, 1.5);
/** Duração de cada módulo (`.35s`). */
export const QR_CELL_MS = 350;

/** Módulo (r,c) pertence a um dos três localizadores 7×7? (no protótipo esses têm raio 1px; os outros 2px) */
export const qrIsFinder = (r: number, c: number, n: number) =>
  (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

/**
 * Atraso do módulo (r,c): distância ao centro × 28 ms na malha 29×29 do protótipo (centro = módulo 14);
 * em malhas maiores o fator 28/(n−1) mantém o canto nos mesmos 554 ms, então a onda inteira dura igual.
 */
export const qrCellDelay = (r: number, c: number, n: number) =>
  Math.round(Math.hypot(r - (n - 1) / 2, c - (n - 1) / 2) * 28 * 28 / (n - 1));

/** Quando a onda termina (último módulo do canto + `.35s`). */
export const qrWaveTotal = (n: number) => qrCellDelay(0, 0, n) + QR_CELL_MS;

/** Escala (= opacidade, limitada a 1) do módulo no instante `t` ms desde o início da onda; 0 antes do atraso. */
export function qrCellScale(t: number, delay: number): number {
  const p = (t - delay) / QR_CELL_MS;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return QR_POP(p);
}
