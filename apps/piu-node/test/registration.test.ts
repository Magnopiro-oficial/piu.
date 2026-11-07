import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { makeCert, makeRevocationList, makeRotation, operatorKeyPair } from '../src/relay/operator-frames.js';
import { registrationFile } from '../src/relay/registration.js';

const SETTLEMENT = join(fileURLToPath(import.meta.url), '../../../settlement');

test('registro para o validador v2: certificados e revogação do operador, lidos pelo apps/settlement', async t => {
  const op = operatorKeyPair(newSeed()), next = operatorKeyPair(newSeed());
  const a = deriveNodeKey(newSeed()), b = deriveNodeKey(newSeed()), gone = deriveNodeKey(newSeed());
  const ca = makeCert(op, a.pk, 100);
  const cb = makeCert(next, b.pk, 101, [makeRotation(op, next.pk, 101)]);
  const file = registrationFile([ca, ca, cb, makeCert(op, gone.pk, 100), null], [makeRevocationList(next, 2, 101, [gone.pk])]);
  assert.equal(file.certs.length, 3, 'sem repetição');
  assert.deepEqual(JSON.parse(JSON.stringify(file)), file);
  if (!existsSync(join(SETTLEMENT, 'src/registry.ts'))) { t.skip('apps/settlement não está presente'); return; }
  const { NodeRegistry } = await import(join(SETTLEMENT, 'src/registry.ts')) as typeof import('../../settlement/src/registry.js');
  const reg = NodeRegistry.build([{ v: 1, operators: [{ pk: toHex(op.pk) }] }], [file]);
  assert.equal(reg.operatorOf(toHex(a.pk), 200), toHex(op.pk));
  assert.equal(reg.operatorOf(toHex(b.pk), 200), toHex(op.pk), 'certificado pela chave rotacionada');
  assert.equal(reg.operatorOf(toHex(gone.pk), 200), null, 'revogado');
  assert.equal(NodeRegistry.build([{ v: 1, operators: [] }], [file]).operatorOf(toHex(a.pk), 200), null, 'operador não admitido');
});

test('aval a um celular: assinado pela chave atual (inclusive rotacionada), vai no registro e o validador aceita como semente', async t => {
  const { OperatorVault } = await import('../src/operator.js');
  const { derivePhoneOperatorKey, verifyEndorsement } = await import('../src/protocol/phoneNode.js');
  const vault = new OperatorVault(null);
  const t0 = Date.UTC(2026, 9, 1);
  const root = vault.ensure('op', t0);
  const n = deriveNodeKey(newSeed());
  const cert = vault.certify('op', n.pk, t0);
  vault.rotate('op', t0 + 1000);
  const phone = derivePhoneOperatorKey(newSeed());
  const e = vault.endorsePhone('op', phone.pk, t0 + 2000);
  assert.ok(verifyEndorsement(e));
  assert.notEqual(e.endorserPk, toHex(root.pk), 'assinado pela chave nova');
  assert.throws(() => vault.endorsePhone('op', new Uint8Array(5), t0));
  const file = registrationFile([vault.certify('op', n.pk, t0 + 3000), cert], [], [e, e]);
  assert.equal(file.endorsements?.length, 1, 'sem repetição');
  assert.equal(registrationFile([cert]).endorsements, undefined, 'sem avais, o arquivo é o de antes');
  const { verifyEndorsementRevocation } = await import('../src/protocol/phoneNode.js');
  const un = vault.unendorsePhone('op', phone.pk, t0 + 4000);
  assert.ok(verifyEndorsementRevocation(un));
  assert.equal(registrationFile([cert], [], [], [un, un]).endorsementRevocations?.length, 1);
  if (!existsSync(join(SETTLEMENT, 'src/registry.ts'))) { t.skip('apps/settlement não está presente'); return; }
  const { NodeRegistry } = await import(join(SETTLEMENT, 'src/registry.ts')) as typeof import('../../settlement/src/registry.js');
  const keys = NodeRegistry.build([{ v: 1, operators: [{ pk: toHex(root.pk) }] }], [file]).operatorKeys();
  assert.ok(keys.has(e.endorserPk), 'a chave rotacionada do operador admitido pode avalizar');
});
