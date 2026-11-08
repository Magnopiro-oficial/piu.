import { createElement, forwardRef, useImperativeHandle, useRef } from 'react';
import type { CallGeometry } from '../../calls/callVisual';
import type { CallFrame, CallGrid } from '../../lib/callFrame';

export type CallCanvasHandle = { draw(f: CallFrame | null): void };

/**
 * No navegador (só para conferir o desenho no `expo start --web`): o mesmo quadro num <canvas> 2D,
 * como o protótipo, sem carregar o CanvasKit do Skia. O celular usa ./CallCanvas.tsx (Skia).
 */
export const CallCanvas = forwardRef<CallCanvasHandle, { geometry: CallGeometry; grid: CallGrid }>(function CallCanvas({ geometry, grid }, ref) {
  const el = useRef<HTMLCanvasElement | null>(null);
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  useImperativeHandle(ref, () => ({
    draw(f) {
      const x = el.current?.getContext('2d');
      if (!x) return;
      const { width: w, height: h, cx, cy } = geometry;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, w, h);
      if (!f) return;
      for (const b of f.buckets) {
        x.fillStyle = `rgba(255,255,255,${b.alpha})`;
        x.beginPath();
        for (const i of b.idx) { x.moveTo(grid.x[i]! + b.radius, grid.y[i]!); x.arc(grid.x[i]!, grid.y[i]!, b.radius, 0, 6.2832); }
        x.fill();
      }
      x.lineWidth = 1.5;
      for (const r of f.rings) { x.strokeStyle = `rgba(255,255,255,${r.alpha})`; x.beginPath(); x.arc(cx, cy, r.r, 0, 6.2832); x.stroke(); }
      for (const c of f.contours) {
        x.beginPath();
        c.pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
        x.closePath();
        x.fillStyle = `rgba(255,255,255,${c.fill})`; x.fill();
        x.strokeStyle = `rgba(255,255,255,${c.stroke})`; x.stroke();
      }
      if (f.flash > 0) { x.fillStyle = `rgba(255,255,255,${f.flash})`; x.fillRect(0, 0, w, h); }
    },
  }), [geometry, grid, dpr]);
  return createElement('canvas', {
    ref: el, width: Math.round(geometry.width * dpr), height: Math.round(geometry.height * dpr),
    style: { position: 'absolute', left: 0, top: 0, width: geometry.width, height: geometry.height, pointerEvents: 'none' },
  });
});
