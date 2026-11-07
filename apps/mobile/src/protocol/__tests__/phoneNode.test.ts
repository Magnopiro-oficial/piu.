/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHex } from '../bytes';
import { deriveIdentity, deriveNodeKey, deriveWalletSeed, newSeed } from '../keys';
import {
  bondOwnerMessage, derivePhoneOperatorKey, makeEndorsement, makeEndorsementRevocation, makeOperatorCert, makePhoneExit, makePhoneRegistration,
  verifyEndorsement, verifyEndorsementRevocation, verifyOperatorCert, verifyPhoneExit, verifyPhoneRegistration,
} from '../phoneNode';

const WALLET = '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse';
const BOND = { txHash: '0x' + 'ab'.repeat(32), block: 1234 };

test('chave de operador do celular: determinística e sem ligação com identidades, nó e carteira', () => {
  const seed = newSeed();
  const op = derivePhoneOperatorKey(seed);
  assert.equal(toHex(derivePhoneOperatorKey(seed).pk), toHex(op.pk));
  const others = [deriveIdentity(seed, 'public').signPk, deriveIdentity(seed, 'anon').signPk, deriveNodeKey(seed, 0).pk, deriveNodeKey(seed, 20000).pk, deriveWalletSeed(seed)];
  for (const o of others) assert.notEqual(toHex(o), toHex(op.pk));
  assert.notEqual(toHex(derivePhoneOperatorKey(newSeed()).pk), toHex(op.pk));
});

test('certificado do nó do dia: formato OPERATOR_CERT, confere e recusa adulteração', () => {
  const seed = newSeed(), op = derivePhoneOperatorKey(seed), node = deriveNodeKey(seed, 20400);
  const c = makeOperatorCert(op, node.pk, 20400 * 86400);
  assert.ok(verifyOperatorCert(c));
  assert.deepEqual(c.chain, []);
  assert.equal(verifyOperatorCert({ ...c, issuedAt: c.issuedAt + 1 }), false);
  assert.equal(verifyOperatorCert({ ...c, nodePk: toHex(deriveNodeKey(seed, 20401).pk) }), false);
});

test('aval: assinado por quem avaliza, sobre a chave do celular e o dia; ninguém avaliza a si', () => {
  const a = derivePhoneOperatorKey(newSeed()), b = derivePhoneOperatorKey(newSeed());
  const e = makeEndorsement(a, b.pk, 20400);
  assert.ok(verifyEndorsement(e));
  assert.equal(verifyEndorsement({ ...e, day: 20401 }), false);
  assert.equal(e.inPerson, true, 'por padrão afirma verificação pessoal');
  assert.equal(verifyEndorsement({ ...e, inPerson: false }), false, 'a afirmação está assinada');
  const remote = makeEndorsement(a, b.pk, 20400, { inPerson: false });
  assert.ok(verifyEndorsement(remote));
  assert.equal(remote.inPerson, false);
  assert.equal(verifyEndorsement({ ...e, phonePk: toHex(a.pk) }), false);
  assert.throws(() => makeEndorsement(a, a.pk, 1));
});

test('retirada de aval: assinada por quem avalizou', () => {
  const a = derivePhoneOperatorKey(newSeed()), b = derivePhoneOperatorKey(newSeed());
  const r = makeEndorsementRevocation(a, b.pk, 5000);
  assert.ok(verifyEndorsementRevocation(r));
  assert.equal(verifyEndorsementRevocation({ ...r, phonePk: toHex(a.pk) }), false);
  assert.equal(verifyEndorsementRevocation({ ...r, endorserPk: toHex(b.pk) }), false);
});

test('registro do celular e pedido de saída: assinatura do operador sobre carteira e caução', () => {
  const op = derivePhoneOperatorKey(newSeed());
  const r = makePhoneRegistration(op, WALLET, BOND, new Uint8Array(64).fill(7));
  assert.ok(verifyPhoneRegistration(r));
  assert.equal(verifyPhoneRegistration({ ...r, wallet: '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV' }), false, 'trocar a carteira invalida');
  assert.equal(verifyPhoneRegistration({ ...r, bond: { ...BOND, block: 1 } }), false, 'trocar a caução invalida');
  assert.equal(verifyPhoneRegistration({ ...r, walletSig: '00'.repeat(64) }), false, 'trocar a assinatura da carteira invalida');
  assert.throws(() => makePhoneRegistration(op, WALLET, { txHash: 'x', block: 1 }, new Uint8Array(64)));
  assert.match(new TextDecoder().decode(bondOwnerMessage(r.operatorPk, WALLET, WALLET)), /^piu\/phone-node\/v2\/bond-owner\n/);
  const x = makePhoneExit(op, BOND.txHash, 1000);
  assert.ok(verifyPhoneExit(x));
  assert.equal(verifyPhoneExit({ ...x, at: 999 }), false);
  assert.equal(verifyPhoneExit({ ...x, txHash: '0x' + 'cd'.repeat(32) }), false, 'a saída vale só para aquela caução');
  assert.throws(() => makePhoneExit(op, 'x', 1));
  const back = makePhoneExit(op, BOND.txHash, 2000, 'cancel');
  assert.ok(verifyPhoneExit(back));
  assert.equal(verifyPhoneExit({ ...back, kind: 'exit' }), false, 'o tipo está assinado');
});
