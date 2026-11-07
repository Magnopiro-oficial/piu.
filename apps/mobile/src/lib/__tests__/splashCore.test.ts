/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPLASH, dotDelays, splashHold, splashPlan } from '../splashCore';

test('abertura: com movimento, segura 900 ms e sai em 420 ms com o app entrando em 500 ms', () => {
  const p = splashPlan(false);
  assert.equal(p.animate, true);
  assert.equal(p.hold, 900);
  assert.equal(p.exit, 420);
  assert.equal(p.reveal, 500);
  // A tela some só depois de a saída terminar.
  assert.equal(p.total, 900 + 420);
});

test('abertura: com "reduzir movimento", nada anima e a tela só corta depois da espera', () => {
  const p = splashPlan(true);
  assert.equal(p.animate, false);
  assert.equal(p.hold, 900);
  assert.equal(p.exit, 0);
  assert.equal(p.reveal, 0);
  assert.equal(p.total, 900);
});

test('abertura: os pontinhos piscam em sequência com 150 ms entre eles', () => {
  assert.deepEqual(dotDelays(3), [0, 150, 300]);
  assert.deepEqual(dotDelays(0), []);
});

test('abertura: a entrada dos elementos termina antes da saída começar', () => {
  const ends = [SPLASH.pop, SPLASH.up, SPLASH.fade].map((s) => s.delay + s.dur);
  for (const end of ends) assert.ok(end <= SPLASH.hold, `${end} > ${SPLASH.hold}`);
});

test('abertura: a splash sai ~2,6 s depois do boot (design), mas nunca antes de 900 ms na tela', () => {
  assert.equal(splashHold(0), 2600);
  assert.equal(splashHold(1000), 1600);
  assert.equal(splashHold(1700), 900);
  assert.equal(splashHold(5000), 900);
  assert.equal(splashHold(-50), 2600);
});
