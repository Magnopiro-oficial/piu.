import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareWalletStartsOff } from '../walletShareDefault';

const ok = { readFailed: false, wiped: false };

test('instalação nova (sem identidade concluída e sem ajuste salvo): compartilhar o endereço nasce desligado', () => {
  assert.equal(shareWalletStartsOff({ saved: undefined, onboarded: undefined, ...ok }), true);
  assert.equal(shareWalletStartsOff({ saved: undefined, onboarded: false, ...ok }), true);
  // Ajustes salvos antes de concluir a entrada, ainda sem o valor: também é instalação nova.
  assert.equal(shareWalletStartsOff({ saved: { find: 'all' }, onboarded: false, ...ok }), true);
});

test('quem já usa o app continua como está: sem valor explícito segue ligado, e nada é regravado', () => {
  assert.equal(shareWalletStartsOff({ saved: undefined, onboarded: true, ...ok }), false);
  assert.equal(shareWalletStartsOff({ saved: { find: 'contacts' }, onboarded: true, ...ok }), false);
});

test('ajuste salvo é respeitado, ligado ou desligado, em instalação nova ou antiga', () => {
  for (const onboarded of [true, false, undefined]) {
    assert.equal(shareWalletStartsOff({ saved: { shareWallet: true }, onboarded, ...ok }), false);
    assert.equal(shareWalletStartsOff({ saved: { shareWallet: false }, onboarded, ...ok }), false);
  }
});

test('leitura do armazenamento falhou: não dá para saber se é instalação nova, então nada muda', () => {
  assert.equal(shareWalletStartsOff({ saved: undefined, onboarded: undefined, readFailed: true, wiped: false }), false);
});

test('depois de "Apagar dados locais" a identidade seguinte é nova: nasce desligado', () => {
  assert.equal(shareWalletStartsOff({ saved: undefined, onboarded: undefined, readFailed: true, wiped: true }), true);
});
