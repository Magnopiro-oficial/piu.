import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtBytes } from '../src/renderer/format';

test('espaço: bytes legíveis em base 1000 com vírgula; sem medição vira traço', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(999), '999 B');
  assert.equal(fmtBytes(1500), '1,5 kB');
  assert.equal(fmtBytes(312_000_000), '312 MB');
  assert.equal(fmtBytes(1_200_000_000), '1,2 GB');
  assert.equal(fmtBytes(null), '—');
  assert.equal(fmtBytes(Number.NaN), '—');
  assert.equal(fmtBytes(-1), '—');
});
