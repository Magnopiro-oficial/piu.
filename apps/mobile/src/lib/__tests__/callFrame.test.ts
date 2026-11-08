import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE, type CallState } from '../../calls/callMachine';
import { CONTOUR_STYLE, PHONE_GEOMETRY as P, REST_ALPHA, dotAlpha, dotRadius, rings, swipeLabels, type FrameInput } from '../../calls/callVisual';
import { ALPHA_LEVELS, buildFrame, frameInputOf, gridOf, swipeLabelRange } from '../callFrame';

const still: FrameInput = { ringing: false, speed: 1, active: false, sinceConnect: 9, endProgress: 0, amp: 0, switching: false, soft: false };
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const grid = gridOf(P);

test('malha do protótipo: 18 px a partir de (9, 9), 22 × 47 pontos em 390 × 844', () => {
  assert.equal(grid.n, 22 * 47);
  assert.equal(grid.x[0], 9);
  assert.equal(grid.y[0], 9);
  assert.ok(Math.max(...grid.x) < P.width && Math.max(...grid.y) < P.height);
});

test('repouso: um único grupo de pontos a 0,07 (uma passada de desenho)', () => {
  const f = buildFrame(P, grid, still, 1);
  assert.equal(f.buckets.length, 1);
  close(f.buckets[0]!.alpha, REST_ALPHA);
  close(f.buckets[0]!.radius, dotRadius(REST_ALPHA));
  assert.equal(f.buckets[0]!.idx.length, grid.n);
  assert.equal(f.rings.length, 0);
  assert.equal(f.contours.length, 0);
  assert.equal(f.flash, 0);
});

test('tocando: todos os pontos em grupos ordenados, alfa quantizado da fórmula, 3 anéis', () => {
  const t = 0.7, fi = { ...still, ringing: true, speed: 0.7 };
  const f = buildFrame(P, grid, fi, t);
  assert.equal(f.buckets.reduce((n, b) => n + b.idx.length, 0), grid.n);
  for (let i = 1; i < f.buckets.length; i++) assert.ok(f.buckets[i]!.alpha > f.buckets[i - 1]!.alpha);
  assert.ok(f.buckets.length <= ALPHA_LEVELS);
  for (const b of f.buckets) for (const i of b.idx.slice(0, 5)) {
    assert.ok(Math.abs(dotAlpha(P, fi, t, grid.x[i]!, grid.y[i]!) - b.alpha) <= 0.5 / ALPHA_LEVELS + 1e-9);
  }
  assert.deepEqual(f.rings, rings(P, t, 0.7));
});

test('em chamada: contorno de 2 camadas; flash só no começo e nunca no modo suave', () => {
  const fi = { ...still, active: true, sinceConnect: 0.1, amp: 0.5 };
  const f = buildFrame(P, grid, fi, 2);
  assert.equal(f.contours.length, 2);
  assert.deepEqual(f.contours.map(c => ({ stroke: c.stroke, fill: c.fill })), CONTOUR_STYLE.map(s => ({ stroke: s.stroke, fill: s.fill })));
  assert.equal(f.contours[0]!.pts.length, 97);
  close(f.flash, 0.25 * 0.9);
  assert.equal(buildFrame(P, grid, { ...fi, soft: true }, 2).flash, 0);
  assert.equal(buildFrame(P, grid, { ...fi, sinceConnect: 1 }, 2).flash, 0);
});

test('desligar: contorno encolhe com (1 − ep)² e o traço apaga junto; avatar some', () => {
  const f = buildFrame(P, grid, { ...still, endProgress: 0.5 }, 1);
  const r0 = Math.hypot(f.contours[0]!.pts[0]!.x - P.cx, f.contours[0]!.pts[0]!.y - P.cy);
  close(r0, 72 * 0.25, 1e-6);
  close(f.contours[0]!.stroke, 0.9 * 0.25);
  close(f.avatar.scale, 0.5);
  close(f.avatar.opacity, 0.5);
});

const st = (o: Partial<CallState>): CallState => ({ ...IDLE, ...o });

test('frameInputOf: chamando é mais calmo, recebendo a 1; sem chamada não desenha', () => {
  const now = 10_000;
  assert.equal(frameInputOf(st({ phase: 'idle' }), { nowMs: now, amp: 0, soft: false }), null);
  assert.equal(frameInputOf(st({ phase: 'pre' }), { nowMs: now, amp: 0, soft: false }), null);
  assert.equal(frameInputOf(st({ phase: 'calling' }), { nowMs: now, amp: 0, soft: false })!.speed, 0.7);
  const r = frameInputOf(st({ phase: 'ringing' }), { nowMs: now, amp: 0, soft: true })!;
  assert.equal(r.speed, 1);
  assert.equal(r.ringing, true);
  assert.equal(r.soft, true);
  const a = frameInputOf(st({ phase: 'active', connectedAt: now - 500, switching: { from: 'direct', since: now } }), { nowMs: now, amp: 0.3, soft: false })!;
  assert.equal(a.active, true);
  close(a.sinceConnect, 0.5);
  assert.equal(a.switching, true);
  assert.equal(a.amp, 0.3);
});

test('frameInputOf: no fim o progresso vai de quase 0 a 1 em 1,1 s', () => {
  const e0 = frameInputOf(st({ phase: 'ending', endedAt: 1000 }), { nowMs: 1000, amp: 0.8, soft: false })!;
  assert.ok(e0.endProgress > 0 && e0.endProgress < 0.01);
  assert.equal(e0.amp, 0, 'sem voz depois de desligar');
  close(frameInputOf(st({ phase: 'ending', endedAt: 1000 }), { nowMs: 1550, amp: 0, soft: false })!.endProgress, 0.5);
  assert.equal(frameInputOf(st({ phase: 'ending', endedAt: 1000 }), { nowMs: 5000, amp: 0, soft: false })!.endProgress, 1);
});

test('rótulos do trilho: interpolação linear por trechos igual a swipeLabels', () => {
  for (const which of ['decline', 'answer'] as const) {
    const r = swipeLabelRange(which);
    for (let dx = -120; dx <= 120; dx += 7) {
      let i = 0;
      while (i < r.inputRange.length - 2 && dx > r.inputRange[i + 1]!) i++;
      const [x0, x1] = [r.inputRange[i]!, r.inputRange[i + 1]!], [y0, y1] = [r.outputRange[i]!, r.outputRange[i + 1]!];
      close(y0 + (y1 - y0) * (dx - x0) / (x1 - x0), swipeLabels(dx)[which], 1e-9);
    }
  }
});
