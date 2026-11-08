import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESKTOP_GEOMETRY as D, PHONE_GEOMETRY as P, REST_ALPHA, avatarScale, barHeight, contour, dotAlpha, flashAlpha, rings, swipeLabels, swipeResult, voiceNow, type FrameInput } from '../callVisual';

const still: FrameInput = { ringing: false, speed: 1, active: false, sinceConnect: 9, endProgress: 0, amp: 0, switching: false, soft: false };
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('repouso: todo ponto a 0,07', () => {
  close(dotAlpha(P, still, 3, 9, 9), REST_ALPHA);
  close(dotAlpha(D, still, 3, 900, 700), REST_ALPHA);
});

test('onda ao tocar: no raio da frente o ponto acende (fórmula do protótipo)', () => {
  const t = 0.4, f = { ...still, ringing: true, speed: 1 };
  const w0 = ((t + 0) % 1.6) / 1.6 * P.waveMax, w1 = ((t + 0.8) % 1.6) / 1.6 * P.waveMax;
  const gx = P.cx + w0, gy = P.cy;
  const expect = REST_ALPHA + 0.6 * (1 - w0 / 720) + 0.6 * Math.exp(-((w0 - w1) ** 2) / 1800) * (1 - w1 / 720);
  close(dotAlpha(P, f, t, gx, gy), Math.min(1, expect));
  const soft = dotAlpha(P, { ...f, soft: true }, t, gx, gy);
  assert.ok(soft < dotAlpha(P, f, t, gx, gy), 'modo suave é mais fraco');
});

test('onda de choque e flash só no começo da chamada e nunca no modo suave', () => {
  const f = { ...still, active: true, sinceConnect: 0.1 };
  assert.ok(flashAlpha(f) > 0);
  close(flashAlpha(f), 0.25 * 0.9);
  assert.equal(flashAlpha({ ...f, soft: true }), 0);
  assert.equal(flashAlpha({ ...f, sinceConnect: 0.5 }), 0);
  assert.ok(dotAlpha(P, f, 0, P.cx + 95, P.cy) > dotAlpha(P, { ...f, soft: true }, 0, P.cx + 95, P.cy));
});

test('voz acende perto do avatar; desligar apaga tudo no fim', () => {
  const f = { ...still, active: true, amp: 1 };
  assert.ok(dotAlpha(P, f, 0, P.cx, P.cy) > 0.8);
  close(dotAlpha(P, { ...f, endProgress: 1 }, 0, P.cx, P.cy), 0);
});

test('anéis: 3, de 66 px, opacidade (1 − p) × 0,55', () => {
  const r = rings(P, 0, 1);
  assert.equal(r.length, 3);
  close(r[0].r, 66); close(r[0].alpha, 0.55);
  close(r[1].r, 66 + 120 / 3);
});

test('contorno: 97 pontos (fecha o círculo) com raio 72 sem voz', () => {
  const pts = contour(P, 0, 0, 0, 1);
  assert.equal(pts.length, 97);
  close(Math.hypot(pts[10].x - P.cx, pts[10].y - P.cy), 72);
  close(Math.hypot(contour(P, 0, 0, 1, 1)[5].x - P.cx, contour(P, 0, 0, 1, 1)[5].y - P.cy), 88);
});

test('avatar: some ao desligar, pulsa com a voz, respira ao receber', () => {
  close(avatarScale({ incoming: false, active: false, amp: 0, t: 0, endProgress: 0.5 }), 0.5);
  close(avatarScale({ incoming: false, active: true, amp: 1, t: 0, endProgress: 0 }), 1.05);
  close(avatarScale({ incoming: true, active: false, amp: 0, t: Math.PI / 6, endProgress: 0 }), 1.015);
});

test('barras: 4 px em silêncio, até 20 px no celular', () => {
  close(barHeight(0, 0, 0), 4);
  assert.ok(barHeight(0, 0.3, 1) <= 20);
});

test('quem fala vem dos níveis reais; mudo zera o meu; trocando caminho baixa para 25%', () => {
  assert.deepEqual(voiceNow({ mine: 0.05, theirs: 0.05, muted: false, switching: false, soft: false }), { who: null, amp: 0 });
  assert.equal(voiceNow({ mine: 0.2, theirs: 0.6, muted: false, switching: false, soft: false }).who, 'them');
  assert.equal(voiceNow({ mine: 0.8, theirs: 0.1, muted: false, switching: false, soft: false }).who, 'me');
  assert.equal(voiceNow({ mine: 0.8, theirs: 0.1, muted: true, switching: false, soft: false }).who, null);
  close(voiceNow({ mine: 0, theirs: 0.8, muted: false, switching: true, soft: false }).amp, 0.2);
  close(voiceNow({ mine: 0, theirs: 0.8, muted: false, switching: false, soft: true }).amp, 0.36);
});

test('trilho: limiar 92 px; rótulos mudam com o arraste (mín. 0,25)', () => {
  assert.equal(swipeResult(93), 'answer');
  assert.equal(swipeResult(-93), 'decline');
  assert.equal(swipeResult(80), null);
  close(swipeLabels(0).answer, 0.7);
  close(swipeLabels(120).decline, 0.25);
  close(swipeLabels(36).answer, 1);
});
