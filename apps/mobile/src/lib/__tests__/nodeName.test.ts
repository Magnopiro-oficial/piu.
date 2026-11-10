/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyNodeName, newNodeNameSecret } from '../nodeName';

const DAY = 86_400_000;
const secret = '5a'.repeat(32);
const NAME = /^piu-[0-9a-f]{6}$/; // o mesmo formato que o NODE_HINT da rede local aceita (lan/engine.ts)

test('nome do nó: mantém o formato piu-xxxxxx', () => {
  assert.match(dailyNodeName(secret, 20_000), NAME);
});

test('nome do nó: igual o dia UTC inteiro (os enlaces do mesmo vizinho continuam agrupados)', () => {
  const t0 = Date.UTC(2026, 10, 9, 0, 0, 0);
  const day = Math.floor(t0 / DAY);
  assert.equal(Math.floor((t0 + DAY - 1) / DAY), day);
  assert.equal(dailyNodeName(secret, day), dailyNodeName(secret, day));
});

test('nome do nó: muda a cada dia UTC (não serve para seguir o aparelho entre datas)', () => {
  const names = new Set<string>();
  for (let d = 20_000; d < 20_030; d++) names.add(dailyNodeName(secret, d));
  assert.ok(names.size >= 29, `só ${names.size} nomes diferentes em 30 dias`);
});

test('nome do nó: outro segredo, outro nome no mesmo dia', () => {
  assert.notEqual(dailyNodeName(secret, 20_000), dailyNodeName('a5'.repeat(32), 20_000));
});

test('nome do nó: o segredo não aparece no nome', () => {
  const s = 'abcdef' + '0'.repeat(58);
  assert.ok(!dailyNodeName(s, 20_000).includes('abcdef'));
});

test('nome do nó: segredo inválido ou dia inválido é recusado', () => {
  assert.throws(() => dailyNodeName('piu-12ab34', 20_000));
  assert.throws(() => dailyNodeName(secret, -1));
  assert.throws(() => dailyNodeName(secret, 1.5));
});

test('segredo do nome: 32 bytes em hex, vindos do gerador informado', () => {
  let asked = 0;
  const s = newNodeNameSecret(b => { asked = b.length; b.fill(7); return b; });
  assert.equal(asked, 32);
  assert.equal(s, '07'.repeat(32));
  assert.match(newNodeNameSecret(), /^[0-9a-f]{64}$/);
  assert.notEqual(newNodeNameSecret(), newNodeNameSecret());
});
