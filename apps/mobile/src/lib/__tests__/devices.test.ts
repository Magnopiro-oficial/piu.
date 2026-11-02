/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64url } from '../../messaging/card';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import {
  createRevocation, decodeRevocation, deviceIdOf, type DeviceRecord, encodeRevocation, markRevoked, newDeviceKey, upsertDevice, verifyRevocation,
} from '../devicesCore';

const AT = 1_800_000_000;
const me = deriveIdentity(newSeed(), 'public');
const eve = deriveIdentity(newSeed(), 'public');
const lost = newDeviceKey();
const rec: DeviceRecord = { id: deviceIdOf(lost.pk), pk: b64url(lost.pk), name: 'Galaxy', platform: 'android', via: 'origin', addedAt: AT };

test('revogação: assinada pela identidade e conferida com a chave conhecida', () => {
  const n = createRevocation(me, rec, 'lost', AT);
  assert.equal(n.device, rec.id);
  assert.ok(verifyRevocation(n));
  assert.ok(verifyRevocation(n, me.signPk));
  // Outra identidade não revoga aparelhos meus: o contato confere com a chave que já conhece.
  assert.ok(!verifyRevocation(n, eve.signPk));
  const forged = createRevocation(eve, rec, 'lost', AT);
  assert.ok(verifyRevocation(forged));
  assert.ok(!verifyRevocation(forged, me.signPk));
});

test('revogação: qualquer campo adulterado invalida o aviso', () => {
  const n = createRevocation(me, rec, 'lost', AT);
  const other = newDeviceKey();
  assert.ok(!verifyRevocation({ ...n, at: AT + 1 }));
  assert.ok(!verifyRevocation({ ...n, reason: 'disconnected' }));
  assert.ok(!verifyRevocation({ ...n, devicePk: b64url(other.pk), device: deviceIdOf(other.pk) }));
  assert.ok(!verifyRevocation({ ...n, device: deviceIdOf(other.pk) }));
  assert.ok(!verifyRevocation({ ...n, by: b64url(eve.signPk) }));
  assert.ok(!verifyRevocation({ ...n, sig: (n.sig[0] === 'A' ? 'B' : 'A') + n.sig.slice(1) }));
  assert.ok(!verifyRevocation({ ...n, v: 2 }));
});

test('revogação: serializa e volta igual; lixo é recusado', () => {
  const n = createRevocation(me, rec, 'disconnected', AT);
  const back = decodeRevocation(encodeRevocation(n));
  assert.deepEqual(back, n);
  assert.ok(verifyRevocation(back, me.signPk));
  assert.throws(() => decodeRevocation('{"t":"outra"}'));
  assert.throws(() => decodeRevocation('não é json'));
});

test('registro: inserir, atualizar e revogar (este aparelho não se revoga)', () => {
  const self = newDeviceKey();
  const thisRec: DeviceRecord = { id: deviceIdOf(self.pk), pk: b64url(self.pk), name: 'Este', platform: 'ios', via: 'this', addedAt: AT };
  let list = upsertDevice(upsertDevice([], thisRec), rec);
  assert.equal(list.length, 2);
  list = upsertDevice(list, { ...rec, name: 'Galaxy S10' });
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'Galaxy S10');
  list = markRevoked(list, rec.id, 'lost', AT + 5);
  list = markRevoked(list, thisRec.id, 'lost', AT + 5);
  assert.equal(list[1].revokedAt, AT + 5);
  assert.equal(list[0].revokedAt, undefined);
  // Parear de novo não desfaz a revogação.
  list = upsertDevice(list, { ...rec, via: 'paired' });
  assert.equal(list[1].revokedAt, AT + 5);
});
