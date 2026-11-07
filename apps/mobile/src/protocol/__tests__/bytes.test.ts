/**
 * Writer (protocol/bytes.ts): inteiros de largura fixa são estritos. Antes, `u32` fazia `>>> 0` e `X` e
 * `X + 2^32` davam os mesmos bytes (e a mesma assinatura): auditoria final, H-1 (raiz).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProtocolError, Reader, Writer } from '../bytes';

const range = (e: unknown) => e instanceof ProtocolError && e.code === 'OUT_OF_RANGE';

test('u8/u16/u32 escrevem os extremos da faixa e voltam iguais na leitura', () => {
  const b = new Writer().u8(0).u8(0xff).u16(0).u16(0xffff).u32(0).u32(0xffffffff).done();
  assert.deepEqual([...b], [0, 0xff, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
  const r = new Reader(b);
  assert.deepEqual([r.u8(), r.u8(), r.u16(), r.u16(), r.u32(), r.u32()], [0, 0xff, 0, 0xffff, 0, 0xffffffff]);
});

test('u32 fora de [0, 2^32−1] lança erro em vez de truncar (X e X+2^32 não colidem)', () => {
  for (const v of [2 ** 32, 2 ** 32 + 5, -1, -(2 ** 31), Number.MAX_SAFE_INTEGER]) assert.throws(() => new Writer().u32(v), range, String(v));
});

test('u16 e u8 também: fora da faixa lança erro', () => {
  for (const v of [0x10000, -1, 70_000]) assert.throws(() => new Writer().u16(v), range, String(v));
  for (const v of [0x100, -1, 300]) assert.throws(() => new Writer().u8(v), range, String(v));
});

test('não inteiro, NaN e infinito lançam erro (nada de arredondar calado)', () => {
  for (const w of ['u8', 'u16', 'u32'] as const) {
    for (const v of [1.5, NaN, Infinity, -Infinity]) assert.throws(() => new Writer()[w](v), range, `${w}(${v})`);
  }
});

test('vbytes continua prefixando o tamanho em u32', () => {
  assert.deepEqual([...new Writer().vbytes(Uint8Array.of(9, 8)).done()], [0, 0, 0, 2, 9, 8]);
});
