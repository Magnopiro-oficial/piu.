/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARD_IN, COUNT, HOLD, PAY, QR_WAVE, ROW_FRESH,
  actionDelay, coinKeyframes, countEase, countFrame, cubicBezier, easedRange, holdFrame, holdRelease, irisRadius, irisScaleRanges,
  payInsets, payStage, pointAlong, popRange, qrIsFinder, qrWaveDelay, qrWaveModules, qrWavePath, qrWaveTotal, routeStops, rowDelay, scanFrame, shortHash, typedChars,
} from '../walletMotion';

// ── contagem do saldo ─────────────────────────────────────

test('saldo: easing 1-(1-p)^4 começa em 0, termina em 1 e desacelera', () => {
  assert.equal(countEase(0), 0);
  assert.equal(countEase(1), 1);
  assert.equal(countEase(0.5), 0.9375);
  // Desacelera: na primeira metade já percorreu mais de 90 %.
  assert.ok(countEase(0.25) > 0.68 && countEase(0.25) < 0.69);
});

test('saldo: entrada conta de 0 ao valor em 950 ms e a liquidação desce em 1,3 s', () => {
  assert.equal(COUNT.enter, 950);
  assert.equal(COUNT.settle, 1300);
  const mid = countFrame(0, 58.4, 475, COUNT.enter);
  assert.equal(mid.done, false);
  assert.ok(Math.abs(mid.value - 58.4 * 0.9375) < 1e-9);
  const end = countFrame(0, 58.4, 950, COUNT.enter);
  assert.equal(end.done, true);
  assert.equal(end.value, 58.4);
  // Descendo: de 58,40 a 53,40 nunca passa do destino.
  const down = countFrame(58.4, 53.4, 2000, COUNT.settle);
  assert.equal(down.value, 53.4);
  assert.equal(countFrame(58.4, 53.4, 650, COUNT.settle).value > 53.4, true);
});

test('saldo: elapsed negativo ou duração zero não quebram', () => {
  assert.deepEqual(countFrame(0, 10, -5, 950), { value: 0, done: false });
  assert.deepEqual(countFrame(0, 10, 0, 0), { value: 10, done: true });
});

// ── curvas ────────────────────────────────────────────────

test('cubic-bezier: extremos exatos, overshoot da curva do QR (.2,.9,.3,1.5) e curva "ease"', () => {
  const qr = cubicBezier(0.2, 0.9, 0.3, 1.5);
  assert.equal(qr(0), 0);
  assert.equal(qr(1), 1);
  // Passa de 1 no meio (o módulo cresce além do tamanho e volta).
  assert.ok(Math.max(...[0.3, 0.4, 0.5, 0.6, 0.7].map(qr)) > 1.05);
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.ok(Math.abs(ease(0.5) - 0.8024) < 0.002);
  // Linear.
  const lin = cubicBezier(0, 0, 1, 1);
  for (const p of [0.1, 0.5, 0.9]) assert.ok(Math.abs(lin(p) - p) < 1e-6);
});

test('easedRange: amostras crescentes no tempo, começando no atraso e terminando em atraso+duração', () => {
  const r = easedRange(300, 850, 478, 0, cubicBezier(0.6, 0, 0.3, 1), 8);
  assert.equal(r.inputRange[0], 300);
  assert.equal(r.inputRange[r.inputRange.length - 1], 1150);
  assert.equal(r.outputRange[0], 478);
  assert.equal(r.outputRange[r.outputRange.length - 1], 0);
  for (let i = 1; i < r.inputRange.length; i++) assert.ok(r.inputRange[i]! > r.inputRange[i - 1]!);
  assert.equal(r.inputRange.length, r.outputRange.length);
});

test('popRange: piuPop vai de .4 a 1.14 em 70 % e volta a 1 no fim', () => {
  const r = popRange(2050, 450);
  assert.equal(r.inputRange[0], 2050);
  assert.equal(r.outputRange[0], 0.4);
  assert.equal(r.inputRange[r.inputRange.length - 1], 2500);
  assert.equal(r.outputRange[r.outputRange.length - 1], 1);
  const i70 = r.inputRange.indexOf(2050 + 450 * 0.7);
  assert.ok(i70 > 0);
  assert.ok(Math.abs(r.outputRange[i70]! - 1.14) < 1e-9);
});

// ── entrada da carteira ───────────────────────────────────

test('entrada: cartão .65s com atraso 40 ms, botões a partir de 320 ms com 70 ms entre eles, linhas 300 + 45 ms (máx. 8)', () => {
  assert.equal(CARD_IN.dur, 650);
  assert.equal(CARD_IN.delay, 40);
  assert.deepEqual([0, 1, 2].map(actionDelay), [320, 390, 460]);
  assert.deepEqual([0, 1, 8, 9, 20].map(rowDelay), [300, 345, 660, 660, 660]);
  assert.equal(ROW_FRESH.dur, 1800);
  assert.equal(ROW_FRESH.delay, 350);
});

// ── QR em onda ────────────────────────────────────────────

test('QR: atraso = 120 ms + distância ao centro × 28 ms, normalizado para a grade de 29', () => {
  assert.equal(qrWaveDelay(14, 14, 29), 120);
  assert.equal(qrWaveDelay(0, 14, 29), 120 + 14 * 28);
  // Grade maior: a onda dura o mesmo que na de 29 (o passo encolhe).
  assert.equal(qrWaveDelay(0, 16, 33), Math.round(120 + 16 * 28 * 29 / 33));
  assert.equal(QR_WAVE.dur, 350);
  assert.deepEqual(QR_WAVE.bezier, [0.2, 0.9, 0.3, 1.5]);
});

test('QR: módulos escuros viram quadrados que nascem do próprio centro; antes do atraso nada aparece', () => {
  const dark = (r: number, c: number) => (r + c) % 2 === 0;
  const mods = qrWaveModules(3, dark);
  assert.equal(mods.length, 5);
  assert.equal(mods.find(m => m.r === 1 && m.c === 1)!.delay, 120);
  // t = 0: nenhum módulo nasceu.
  assert.equal(qrWavePath(mods, 0), '');
  // Depois de tudo: cada módulo é um quadrado 1×1 inteiro.
  const full = qrWavePath(mods, qrWaveTotal(mods));
  // Varredura linha a linha (r, depois c), como o gerador de QR.
  assert.equal(full, 'M0 0h1v1h-1zM2 0h1v1h-1zM1 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1z');
  // No meio da animação do centro, o quadrado é menor que 1 e centrado em (1.5, 1.5).
  const mid = qrWavePath([mods.find(m => m.r === 1 && m.c === 1)!], 120 + 60);
  const m = /^M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-([\d.]+)z$/.exec(mid)!;
  const s = Number(m[3]);
  assert.ok(s > 0 && s < 1);
  assert.ok(Math.abs(Number(m[1]) + s / 2 - 1.5) < 1e-6);
});

test('QR: cantos arredondados (2 px nos dados, 1 px nos localizadores) e detecção dos localizadores', () => {
  assert.equal(qrIsFinder(0, 0, 29), true);
  assert.equal(qrIsFinder(6, 28, 29), true);
  assert.equal(qrIsFinder(28, 6, 29), true);
  assert.equal(qrIsFinder(28, 28, 29), false);
  assert.equal(qrIsFinder(7, 7, 29), false);
  const mods = qrWaveModules(3, () => true, (r, c) => (r === 0 && c === 0 ? 0 : 0.25));
  const full = qrWavePath(mods, qrWaveTotal(mods));
  // O primeiro módulo é quadrado; os demais têm arcos.
  assert.ok(full.startsWith('M0 0h1v1h-1z'));
  assert.ok(full.includes('a0.25 0.25 0 0 1 0.25 0.25'));
  // Durante o crescimento, o raio nunca passa de metade do lado.
  const tiny = qrWavePath([{ r: 0, c: 0, delay: 0, rad: 0.5 }], 1);
  assert.match(tiny, /^M[\d.]+ [\d.]+h0a/);
});

test('QR: linha de leitura começa em 1,1 s, dura 2,6 s, surge em 10 % e some em 100 %', () => {
  assert.equal(QR_WAVE.scan.delay, 1100);
  assert.equal(QR_WAVE.scan.period, 2600);
  assert.deepEqual(scanFrame(0), { top: 0, opacity: 0 });
  assert.equal(scanFrame(0.1).opacity, 1);
  assert.equal(scanFrame(0.5).opacity, 1);
  assert.equal(scanFrame(1).opacity, 0);
  assert.equal(scanFrame(1).top, 1);
  assert.ok(scanFrame(0.5).top > 0.45 && scanFrame(0.5).top < 0.55);
});

// ── segurar para assinar ──────────────────────────────────

test('segurar: enche em 900 ms, encolhe 3 %, digital engrossa até 700; soltar antes zera e avisa', () => {
  assert.equal(HOLD.dur, 900);
  assert.deepEqual(holdFrame(0), { pct: 0, scale: 1, weight: 400, done: false });
  const half = holdFrame(450);
  assert.equal(half.pct, 0.5);
  assert.equal(half.scale, 0.985);
  assert.equal(half.weight, 550);
  assert.equal(half.done, false);
  assert.deepEqual(holdFrame(900), { pct: 1, scale: 0.97, weight: 700, done: true });
  assert.deepEqual(holdFrame(1200), { pct: 1, scale: 0.97, weight: 700, done: true });
  assert.deepEqual(holdRelease(0.4), { pct: 0, hint: true });
  assert.deepEqual(holdRelease(0), { pct: 0, hint: false });
});

// ── cena de pagamento ─────────────────────────────────────

test('cena: íris de 150 % do raio de referência; escalas inversas para o conteúdo não encolher', () => {
  assert.ok(Math.abs(irisRadius(390, 844) - 1.5 * Math.hypot(390, 844) / Math.SQRT2) < 1e-9);
  const r = irisScaleRanges(750, cubicBezier(0.7, 0, 0.2, 1));
  assert.equal(r.scale.inputRange[0], 0);
  assert.equal(r.scale.inputRange[r.scale.inputRange.length - 1], 750);
  assert.ok(r.scale.outputRange[0]! > 0 && r.scale.outputRange[0]! < 0.01);
  assert.equal(r.scale.outputRange[r.scale.outputRange.length - 1], 1);
  for (let i = 0; i < r.scale.outputRange.length; i++) {
    assert.ok(Math.abs(r.scale.outputRange[i]! * r.inverse.outputRange[i]! - 1) < 1e-9);
  }
});

test('cena: a cronologia do design (status e momentos-chave)', () => {
  assert.equal(PAY.iris.dur, 750);
  assert.equal(PAY.signedAt, 1150);
  // A espera pela assinatura real acontece antes de qualquer sinal visual de "assinada".
  assert.equal(PAY.waitAt, 1100);
  assert.ok(PAY.waitAt < 1120 && PAY.waitAt < PAY.signedAt && PAY.waitAt < PAY.verified.delay && PAY.waitAt < PAY.signedWord.delay && PAY.waitAt < PAY.type.delay);
  assert.equal(payStage(PAY.waitAt), 'signing');
  assert.equal(PAY.blockOutAt, 1600);
  assert.equal(PAY.amountInAt, 1750);
  assert.equal(PAY.toCoinAt, 2200);
  assert.equal(PAY.flight.start, 2400);
  assert.equal(PAY.flight.dur, 1400);
  assert.equal(PAY.arriveAt, 3800);
  assert.equal(PAY.routeOutAt, 4150);
  assert.equal(PAY.checkAt, 4300);
  assert.equal(PAY.finishAt, 5000);
  assert.equal(PAY.total, 5200);
});

test('cena: paradas proporcionais ao comprimento (rota do design: 20,9 % / 51,8 % / 80,3 %)', () => {
  const design = [[195, 700], [88, 575], [300, 455], [110, 335], [195, 205]] as [number, number][];
  const stops = routeStops(design).map(s => Math.round(s * 1000) / 10);
  assert.deepEqual(stops, [20.9, 51.8, 80.3]);
  // Rota real (Você → rede Lunes → destinatário): uma parada, perto da metade.
  const real = routeStops(PAY.route);
  assert.equal(real.length, 1);
  assert.ok(real[0]! > 0.45 && real[0]! < 0.55);
});

test('cena: a moeda percorre a rota em velocidade constante (quadros-chave lineares)', () => {
  const kf = coinKeyframes(PAY.route, 2400, 1400);
  assert.equal(kf.inputRange[0], 2400);
  assert.equal(kf.inputRange[kf.inputRange.length - 1], 3800);
  assert.deepEqual(kf.x[0], PAY.route[0]![0]);
  assert.deepEqual(kf.y[kf.y.length - 1], PAY.route[PAY.route.length - 1]![1]);
  assert.equal(kf.inputRange.length, PAY.route.length);
  // Ponto no meio do primeiro trecho.
  const p = pointAlong([[0, 0], [10, 0], [10, 10]], 0.25);
  assert.deepEqual(p, [5, 0]);
  assert.deepEqual(pointAlong([[0, 0], [10, 0], [10, 10]], 1), [10, 10]);
  assert.deepEqual(pointAlong([[0, 0], [10, 0], [10, 10]], 0), [0, 0]);
});

test('cena: estágio do status pelo tempo e pelo resultado real', () => {
  assert.equal(payStage(0), 'signing');
  assert.equal(payStage(1149), 'signing');
  assert.equal(payStage(1150), 'signed');
  assert.equal(payStage(1700), 'sending');
  const nodeAt = PAY.flight.start + PAY.flight.dur * routeStops(PAY.route)[0]!;
  assert.equal(payStage(nodeAt - 1), 'sending');
  assert.equal(payStage(nodeAt), 'node');
  assert.equal(payStage(3800), 'delivered');
  assert.equal(payStage(9999), 'delivered');
});

test('cena: assinatura digitada em 27 passos e hash curto', () => {
  assert.equal(typedChars(27, 0, 400, 1150), 0);
  assert.equal(typedChars(27, 1150, 400, 1150), 0);
  assert.equal(typedChars(27, 1350, 400, 1150), 13);
  assert.equal(typedChars(27, 1550, 400, 1150), 27);
  assert.equal(typedChars(27, 9000, 400, 1150), 27);
  assert.equal(shortHash('0x9f2c41d8e07a5b33c1deadbeefa01b'), '9f2c…a01b');
  assert.equal(shortHash('abc'), 'abc');
  assert.equal(shortHash(''), '');
});

test('segurar: ao soltar, a escala volta em 200 ms com leve overshoot (transition do design) e a camada zera na hora', () => {
  assert.deepEqual(HOLD.release, { dur: 200, bezier: [0.2, 0.9, 0.3, 1.3] });
});

test('cena: topo a 62 px e Concluir a 38 px do fim na tela de referência; com safe area, 8 px abaixo da barra e 4 px acima do indicador', () => {
  assert.deepEqual(payInsets(0, 0), { top: 62, finishBottom: 38 });
  assert.deepEqual(payInsets(54, 34), { top: 62, finishBottom: 38 });
  assert.deepEqual(payInsets(59, 34), { top: 67, finishBottom: 38 });
  assert.deepEqual(payInsets(24, 48), { top: 62, finishBottom: 52 });
});

test('cena: a folha some por baixo da íris em 760 ms (design `walletSheet: null`)', () => {
  assert.equal(PAY.coverAt, 760);
});
