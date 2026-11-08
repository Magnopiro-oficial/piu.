import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Framer, JITTER, Smoother, levelOf, rmsOf, scheduleAt } from '../src/renderer/callAudioCore';

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
