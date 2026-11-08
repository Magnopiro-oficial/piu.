import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePcmuFloat, decodeSample, encodePcmu, encodeSample } from '../pcmu';

test('µ-law: valores de referência do G.711', () => {
  assert.equal(encodeSample(0), 0xff);
  assert.equal(encodeSample(-1), 0x7f);
  assert.equal(decodeSample(0xff), 0);
  assert.equal(decodeSample(0x80), 32124);
  assert.equal(decodeSample(0x00), -32124);
});

test('µ-law: ida e volta com erro relativo pequeno em toda a faixa', () => {
  for (let v = -32000; v <= 32000; v += 97) {
    const back = decodeSample(encodeSample(v));
    assert.ok(Math.abs(back - v) <= Math.max(16, Math.abs(v) * 0.07), `${v} → ${back}`);
  }
});

test('20 ms a 8 kHz = 160 bytes; decodificado em −1..1', () => {
  const pcm = Int16Array.from({ length: 160 }, (_, i) => Math.round(Math.sin(i / 8) * 12000));
  const u = encodePcmu(pcm);
  assert.equal(u.length, 160);
  const f = decodePcmuFloat(u);
  assert.ok(f.every(x => x >= -1 && x <= 1));
  assert.ok(Math.abs(f[10] - pcm[10] / 32768) < 0.03);
});
