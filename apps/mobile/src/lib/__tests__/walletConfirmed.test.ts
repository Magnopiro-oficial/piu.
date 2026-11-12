import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSs58, encodeSs58 } from '../ss58';
import { addressTrust, cleanConfirmed, groupAddress, needsAddressAck, withConfirmed } from '../walletSend';
import { DEV_ADDR_57 } from './walletFixture';

const A = DEV_ADDR_57;
const B = '6hiMqKZbNejk5Wat7uBBN2krtAd8Bde1Ja4ofzR6goLSd4Kt';
const pk = (a: string) => { const d = decodeSs58(a); if (!d.ok) throw new Error(d.error); return d.publicKey; };
/** A mesma conta escrita com outro prefixo de rede. */
const A42 = encodeSs58(pk(A), 42);

test('endereço do contato: primeiro envio, o mesmo já confirmado, ou mudou', () => {
  assert.equal(addressTrust(undefined, A), 'first');
  assert.equal(addressTrust(A, A), 'same');
  assert.equal(addressTrust(A, ` ${A} `), 'same');
  assert.equal(addressTrust(A, A42), 'same', 'a mesma conta com outro prefixo não é mudança');
  assert.equal(addressTrust(A, B), 'changed');
  assert.equal(addressTrust(A, 'lixo'), 'changed', 'endereço proposto ilegível nunca passa como o confirmado');
  assert.equal(addressTrust('lixo', A), 'first', 'registro estragado não vale como confirmado');
});

test('endereço mudou: o envio só é liberado depois da confirmação explícita daquele endereço', () => {
  assert.equal(needsAddressAck('first', null, B), false);
  assert.equal(needsAddressAck('same', null, A), false);
  assert.equal(needsAddressAck('changed', null, B), true);
  assert.equal(needsAddressAck('changed', B, B), false);
  assert.equal(needsAddressAck('changed', A, B), true, 'confirmar um endereço não libera outro');
});

test('envio concluído grava o endereço confirmado da conversa; conversas apagadas saem', () => {
  const one = withConfirmed({}, 'c1', A42, ['c1', 'c2']);
  assert.deepEqual(one, { c1: A }, 'guardado no prefixo da Lunes');
  assert.equal(withConfirmed(one, 'c1', A, ['c1', 'c2']), one, 'nada mudou: o mesmo objeto (sem regravar)');
  assert.deepEqual(withConfirmed(one, 'c2', B, ['c1', 'c2']), { c1: A, c2: B });
  assert.deepEqual(withConfirmed(one, 'c1', B, ['c1']), { c1: B }, 'depois de confirmar a mudança, vale o novo');
  assert.deepEqual(withConfirmed({ c1: A, velho: B }, 'c2', B, ['c1', 'c2']), { c1: A, c2: B });
  assert.equal(withConfirmed(one, 'c2', 'lixo', ['c1', 'c2']), one, 'endereço inválido não é gravado');
  assert.equal(withConfirmed(one, 'fora', B, ['c1']), one, 'conversa que não existe não é gravada');
});

test('registro lido do aparelho: só conversa → endereço válido', () => {
  assert.deepEqual(cleanConfirmed({ c1: A, c2: 'lixo', c3: 7, c4: null }), { c1: A });
  assert.deepEqual(cleanConfirmed(null), {});
  assert.deepEqual(cleanConfirmed('x'), {});
  assert.deepEqual(cleanConfirmed([A]), {});
});

test('endereço agrupado de 4 em 4 para conferir ao lado do nome', () => {
  assert.equal(groupAddress('abcdefghij'), 'abcd efgh ij');
  assert.equal(groupAddress(A).replace(/ /g, ''), A);
});
