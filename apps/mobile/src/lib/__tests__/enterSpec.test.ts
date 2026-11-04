/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AnimKind, ENTER_SPEC, enterFrom } from '../enterSpec';

test('transições do design: parâmetros de cada entrada (piuPush, piuTab, reveal, fade)', () => {
  assert.deepEqual(ENTER_SPEC.push, { dur: 360, bezier: [0.2, 0.85, 0.3, 1], dx: 56, dy: 0, scale: 1 });
  assert.deepEqual(ENTER_SPEC.tab, { dur: 340, bezier: [0.2, 0.8, 0.3, 1], dx: 0, dy: 16, scale: 0.985 });
  assert.deepEqual(ENTER_SPEC.reveal, { dur: 500, bezier: [0.2, 0.85, 0.3, 1], dx: 0, dy: 0, scale: 0.965 });
  assert.deepEqual(ENTER_SPEC.fade, { dur: 300, bezier: [0, 0, 0.58, 1], dx: 0, dy: 0, scale: 1 });
});

test('estado inicial de cada entrada: só o que o design move sai de 0/1', () => {
  const kinds: AnimKind[] = ['push', 'tab', 'reveal', 'fade'];
  for (const k of kinds) {
    const f = enterFrom(k);
    assert.equal(f.opacity, 0, `${k} começa transparente`);
  }
  assert.deepEqual(enterFrom('push'), { opacity: 0, translateX: 56, translateY: 0, scale: 1 });
  assert.deepEqual(enterFrom('tab'), { opacity: 0, translateX: 0, translateY: 16, scale: 0.985 });
  assert.deepEqual(enterFrom('reveal'), { opacity: 0, translateX: 0, translateY: 0, scale: 0.965 });
  assert.deepEqual(enterFrom('fade'), { opacity: 0, translateX: 0, translateY: 0, scale: 1 });
});

test('"reduzir movimento": a entrada vira instantânea, sem deslocar nem escalar', () => {
  for (const k of ['push', 'tab', 'reveal', 'fade'] as AnimKind[]) {
    assert.deepEqual(enterFrom(k, true), { opacity: 1, translateX: 0, translateY: 0, scale: 1 });
  }
});
