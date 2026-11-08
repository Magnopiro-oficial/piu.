import type { ISkiaViewApi, SkPicture, SkPoint, SkiaPictureView } from '@shopify/react-native-skia';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import type { CallGeometry } from '../../calls/callVisual';
import type { CallFrame, CallGrid } from '../../lib/callFrame';

export type CallCanvasHandle = { draw(f: CallFrame | null): void };

// Mesma API que o SkiaPictureView usa por dentro para trocar a figura sem passar pelo React.
const viewApi = () => (globalThis as unknown as { SkiaViewApi: ISkiaViewApi }).SkiaViewApi;
// O Skia só carrega quando uma chamada abre a tela cheia: o app sem chamada não paga a inicialização.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sk = () => require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');

/**
 * Fundo de pontos da chamada no Skia (celular). Cada quadro vira uma `SkPicture` gravada no JS e entregue
 * direto à view nativa: os ~1000 pontos saem em uma chamada `drawPoints` por faixa de opacidade (pontos
 * redondos = traço com ponta redonda), mais anéis, contorno e flash. Nada de React por quadro.
 */
export const CallCanvas = forwardRef<CallCanvasHandle, { geometry: CallGeometry; grid: CallGrid }>(function CallCanvas({ geometry, grid }, ref) {
  const view = useRef<SkiaPictureView>(null);
  const last = useRef<SkPicture | null>(null);
  const kit = useMemo(() => {
    const { Skia, PaintStyle, StrokeCap } = sk();
    const pts: SkPoint[] = grid.x.map((x, i) => Skia.Point(x, grid.y[i]!));
    const white = Skia.Color('#ffffff');
    const dot = Skia.Paint();
    dot.setAntiAlias(true); dot.setColor(white); dot.setStyle(PaintStyle.Stroke); dot.setStrokeCap(StrokeCap.Round);
    const line = Skia.Paint();
    line.setAntiAlias(true); line.setColor(white); line.setStyle(PaintStyle.Stroke); line.setStrokeWidth(1.5);
    const fill = Skia.Paint();
    fill.setAntiAlias(true); fill.setColor(white); fill.setStyle(PaintStyle.Fill);
    return { Points: sk().PointMode.Points, pts, dot, line, fill, path: Skia.PathBuilder.Make(), rec: Skia.PictureRecorder(), bounds: Skia.XYWHRect(0, 0, geometry.width, geometry.height) };
  }, [geometry, grid]);

  useImperativeHandle(ref, () => ({
    draw(f) {
      const v = view.current;
      if (!v) return;
      const { pts, dot, line, fill, path, rec, bounds, Points } = kit;
      const cv = rec.beginRecording(bounds);
      if (f) {
        for (const b of f.buckets) {
          dot.setAlphaf(b.alpha);
          dot.setStrokeWidth(b.radius * 2);
          cv.drawPoints(Points, b.idx.map(i => pts[i]!), dot);
        }
        for (const r of f.rings) { line.setAlphaf(r.alpha); cv.drawCircle(geometry.cx, geometry.cy, r.r, line); }
        for (const c of f.contours) {
          c.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
          const shape = path.close().detach();
          fill.setAlphaf(c.fill); cv.drawPath(shape, fill);
          line.setAlphaf(c.stroke); cv.drawPath(shape, line);
          shape.dispose();
        }
        if (f.flash > 0) { fill.setAlphaf(f.flash); cv.drawRect(bounds, fill); }
      }
      const pic = rec.finishRecordingAsPicture();
      viewApi().setJsiProperty(v.nativeId, 'picture', pic);
      v.redraw();
      // A view nativa guarda a própria referência da figura; a do JS pode ser liberada já.
      last.current?.dispose();
      last.current = pic;
    },
  }), [kit, geometry]);

  const PictureView = sk().SkiaPictureView;
  return <PictureView ref={view} style={StyleSheet.absoluteFill} pointerEvents="none" />;
});
