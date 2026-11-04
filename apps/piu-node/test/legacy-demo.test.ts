import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.js';

// Estado gravado pelas versões antigas: o primeiro operador ganhava 1.284,60 LUNES e três
// equipamentos de demonstração. Quem atualiza não pode continuar vendo esses dados como reais.
const OP = 'op-1';
const demo = (name: string, cls: string) => ({ id: `d-${name}`, ownerId: OP, name, cls, status: 'active', today: 4.12 });
function legacyState(extra: { devices?: object[]; txs?: object[]; balance?: number } = {}) {
  return {
    operators: [{ id: OP, name: 'Lucas', createdAt: 1 }],
    sessions: [], phones: [], pendingTx: [], settings: {},
    devices: [
      { id: 'self', ownerId: OP, name: 'iMac.local', cls: 'Home Node', status: 'active', family: 'linux', createdAt: 2, self: true, nodePk: 'ab' },
      demo('Mini-PC da garagem', 'Gateway Local'), demo('Antena do telhado', 'Super Node'), demo('Roteador da sala', 'Home Node'),
      ...(extra.devices ?? []),
    ],
    wallets: { [OP]: { balance: extra.balance ?? 1284.6, txs: extra.txs ?? [] } },
  };
}
function open(state: object) {
  const dir = mkdtempSync(join(tmpdir(), 'piu-legacy-'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  return { dir, store: new Store(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('estado antigo: equipamentos e saldo de demonstração saem ao abrir, e a limpeza fica gravada', t => {
  const { dir, store, cleanup } = open(legacyState());
  t.after(cleanup);
  assert.deepEqual(store.devicesOf(OP).map(d => d.name), ['iMac.local']);
  assert.deepEqual(store.wallet(OP), { balance: 0, txs: [] });
  const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(saved.devices.length, 1);
  assert.equal(saved.wallets[OP].balance, 0);
});

test('estado antigo: transferências feitas com o saldo de demonstração também saem', t => {
  const txs = [{ id: 't1', amount: 100, at: 3, to: 'personal' }, { id: 't2', amount: 84.6, at: 4, to: 'lunes:abc', kind: 'out' }];
  const { store, cleanup } = open(legacyState({ balance: 1100, txs }));
  t.after(cleanup);
  assert.deepEqual(store.wallet(OP), { balance: 0, txs: [] });
});

test('dados do operador ficam: equipamento com o mesmo nome mas criado no assistente, saldo com liquidação real', t => {
  const mine = { id: 'mine', ownerId: OP, name: 'Antena do telhado', cls: 'Super Node', status: 'active', today: 0, family: 'router', createdAt: 5 };
  const txs = [{ id: 'in1', amount: 10, at: 6, to: 'provider', kind: 'in', from: 'lote #0001' }];
  const { store, cleanup } = open(legacyState({ devices: [mine], balance: 1294.6, txs }));
  t.after(cleanup);
  assert.ok(store.devicesOf(OP).some(d => d.id === 'mine'), 'o do assistente fica');
  assert.equal(store.devicesOf(OP).filter(d => d.name === 'Antena do telhado').length, 1);
  assert.equal(store.wallet(OP).balance, 1294.6, 'com entrada real, o saldo não é mexido');
  assert.equal(store.wallet(OP).txs.length, 1);
});

test('estado novo não muda', t => {
  const { store, cleanup } = open({ operators: [{ id: OP, name: 'Lucas', createdAt: 1 }], devices: [], wallets: { [OP]: { balance: 0, txs: [] } } });
  t.after(cleanup);
  assert.deepEqual(store.wallet(OP), { balance: 0, txs: [] });
  assert.equal(store.devicesOf(OP).length, 0);
});
