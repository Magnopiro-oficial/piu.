import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Framer, JITTER, RING, Smoother, levelOf, ringCycle, rmsOf, scheduleAt } from '../src/renderer/callAudioCore';

test('nível: silêncio 0, −10 dB ou mais = 1, meio da escala em −30 dB', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(1), 1);
  assert.ok(Math.abs(levelOf(10 ** (-30 / 20)) - 0.5) < 1e-9);
  assert.ok(Math.abs(rmsOf(new Float32Array([0.5, -0.5])) - 0.5) < 1e-9);
});

test('suavização: sobe na hora e desce em ~150 ms', () => {
  const s = new Smoother(150);
  assert.equal(s.push(0.8, 0), 0.8);
  const later = s.push(0, 150);
  assert.ok(Math.abs(later - 0.8 / Math.E) < 1e-9);
  assert.ok(s.read(1000) < 0.01);
});

test('quadros de 20 ms (960 amostras a 48 kHz), juntando pedaços de qualquer tamanho', () => {
  const f = new Framer(960), out: number[] = [];
  f.push(new Float32Array(1024), x => out.push(x.length));
  f.push(new Float32Array(1024), x => out.push(x.length));
  assert.deepEqual(out, [960, 960]);
});

test('reprodução: emenda, recomeça com 60 ms quando esvazia, descarta acima de 250 ms', () => {
  assert.equal(scheduleAt(0, 10), 10 + JITTER.targetS);
  assert.equal(scheduleAt(10.1, 10), 10.1);
  assert.equal(scheduleAt(10.3, 10), null);
});

test('toque: um ciclo gerado (dois "piu" curtos e silêncio), sem estalo nas pontas e com volume contido', () => {
  const rate = 48_000, x = ringCycle(rate);
  assert.equal(x.length, Math.round(RING.cycleS * rate), 'o laço emenda no mesmo tamanho');
  assert.equal(x[0], 0, 'começa do zero');
  assert.equal(x[x.length - 1], 0, 'termina em silêncio (o laço não estala)');
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.1 && peak <= RING.gain, `pico ${peak}`);
  const rms = (a: number, b: number) => rmsOf(x.subarray(Math.round(a * rate), Math.round(b * rate)));
  const step = RING.chirpS + RING.gapS;
  for (let c = 0; c < RING.chirps; c++) assert.ok(rms(c * step, c * step + RING.chirpS) > 0.05, `"piu" ${c + 1} soa`);
  assert.equal(rms(RING.chirps * step, RING.cycleS), 0, 'resto do ciclo em silêncio');
  assert.ok(RING.chirps * step < RING.cycleS / 2, 'mais pausa que som');
  assert.deepEqual(ringCycle(rate), x, 'sempre igual (gerado, sem arquivo)');
  assert.equal(ringCycle(44_100).length, Math.round(RING.cycleS * 44_100));
});
