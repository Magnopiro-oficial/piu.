import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSignWalletAddress, walletSelection } from '../walletSelection';
import { encodeSs58 } from '../ss58';
import { DEV_ADDR_42, DEV_ADDR_57 } from './walletFixture';

const external = encodeSs58(new Uint8Array(32).fill(7));
const ready = { native: true, secure: true, ownAddress: DEV_ADDR_57, useOwn: false };

test('carteira: padrão próprio sem endereço externo, mesma conta nos prefixos 57/42', () => {
  assert.deepEqual(walletSelection({ ...ready, externalAddress: null }), { ownAddress: DEV_ADDR_57, nativeWalletReady: true, lunesAddress: DEV_ADDR_57, canSign: true });
  assert.equal(canSignWalletAddress(DEV_ADDR_42, DEV_ADDR_57), true);
  assert.equal(canSignWalletAddress(external, DEV_ADDR_57), false);
  assert.equal(canSignWalletAddress('invalid', DEV_ADDR_57), false);
  assert.equal(canSignWalletAddress(null, DEV_ADDR_57), false);
});

test('carteira: endereço externo salvo continua selecionado e só leitura; escolher próprio não apaga externo', () => {
  const saved = { ...ready, externalAddress: external };
  assert.deepEqual(walletSelection(saved), { ownAddress: DEV_ADDR_57, nativeWalletReady: true, lunesAddress: external, canSign: false });
  assert.equal(walletSelection({ ...saved, useOwn: true }).lunesAddress, DEV_ADDR_57);
  assert.equal(saved.externalAddress, external);
  assert.equal(walletSelection(saved).lunesAddress, external);
  assert.equal(walletSelection({ ...ready, externalAddress: DEV_ADDR_42 }).canSign, true);
});

test('carteira: web, cofre inseguro e frase ausente nunca habilitam assinatura', () => {
  for (const o of [{ ...ready, native: false }, { ...ready, secure: false }, { ...ready, ownAddress: null }]) {
    const selected = walletSelection({ ...o, externalAddress: external });
    assert.equal(selected.ownAddress, null);
    assert.equal(selected.nativeWalletReady, false);
    assert.equal(selected.canSign, false);
    assert.equal(selected.lunesAddress, external);
    assert.equal(walletSelection({ ...o, externalAddress: null }).lunesAddress, null);
  }
});
