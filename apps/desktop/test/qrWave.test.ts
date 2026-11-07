import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cubicBezier, QR_CELL_MS, QR_POP, qrCellDelay, qrCellScale, qrIsFinder, qrWaveTotal } from '../src/renderer/qrWave';

describe('cubicBezier (curva do CSS)', () => {
  it('linear devolve a identidade', () => {
    const f = cubicBezier(0, 0, 1, 1);
    for (const x of [0, 0.1, 0.5, 0.9, 1]) assert.ok(Math.abs(f(x) - x) < 1e-4, `f(${x}) = ${f(x)}`);
  });
  it('ease (.25,.1,.25,1) bate com o valor conhecido em x=.5 (≈ .8024)', () => {
    assert.ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 1e-3);
  });
  it('piuQr (.2,.9,.3,1.5) começa em 0, termina em 1 e passa de 1 no meio do caminho', () => {
    assert.equal(QR_POP(0), 0);
    assert.equal(QR_POP(1), 1);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => QR_POP(i / 100)));
    assert.ok(peak > 1.05 && peak < 1.2, `pico ${peak}`);
    assert.equal(QR_POP(-1), 0); assert.equal(QR_POP(2), 1);
  });
});

describe('onda do QR', () => {
  it('na malha 29×29 do protótipo o atraso é distância × 28 ms (centro 0, canto 554)', () => {
    assert.equal(qrCellDelay(14, 14, 29), 0);
    assert.equal(qrCellDelay(0, 0, 29), Math.round(Math.hypot(14, 14) * 28));
    assert.equal(qrWaveTotal(29), 554 + QR_CELL_MS);
  });
  it('numa malha maior (QR real, 49 módulos) a onda inteira dura o mesmo que no protótipo', () => {
    assert.ok(Math.abs(qrWaveTotal(49) - qrWaveTotal(29)) <= 2);
    assert.equal(qrCellDelay(24, 24, 49), 0);
  });
  it('escala do módulo: 0 antes do atraso, 1 depois de 350 ms, passa de 1 no meio', () => {
    assert.equal(qrCellScale(100, 200), 0);
    assert.equal(qrCellScale(200, 200), 0);
    assert.equal(qrCellScale(550, 200), 1);
    assert.equal(qrCellScale(900, 200), 1);
    assert.ok(qrCellScale(200 + QR_CELL_MS * 0.7, 200) > 1);
  });
  it('localizadores: três cantos 7×7, nunca o quarto canto nem o miolo', () => {
    assert.ok(qrIsFinder(0, 0, 29) && qrIsFinder(6, 6, 29) && qrIsFinder(0, 22, 29) && qrIsFinder(28, 0, 29));
    assert.ok(!qrIsFinder(7, 7, 29) && !qrIsFinder(28, 28, 29) && !qrIsFinder(14, 14, 29));
  });
});
