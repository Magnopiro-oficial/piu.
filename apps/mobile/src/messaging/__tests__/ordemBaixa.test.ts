/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, utf8 } from '../../protocol/bytes';
import { MsgType, sealDirect } from '../../protocol/envelope';
import { deriveIdentity, deriveNodeKey, type Identity, identityId, newSeed, toPublic } from '../../protocol/keys';
import { random, sign } from '../../protocol/suite';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;

/** Identidade com assinatura válida e chave de acordo de ordem baixa (32 bytes zero), binding assinado pelo próprio dono. */
function lowOrderIdentity(): Identity {
  const base = deriveIdentity(newSeed(), 'public'), agreePk = new Uint8Array(32);
  const binding = sign.sign(concat(utf8('piu/v0/binding'), agreePk), base.sign.sk);
  return { ...base, agree: { sk: base.agree.sk, pk: agreePk }, agreePk, binding, id: identityId(base.signPk, agreePk) };
}

test('remetente com chave de acordo de ordem baixa: receive não lança, nada chega às conversas e o contato é recusado', () => {
  const seed = newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const got: string[] = [];
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => T0, transmit: async () => {},
    events: { message: c => got.push(c), newContact: c => got.push(c.id), status: () => {} },
  });
  const evil = lowOrderIdentity();
  const { bytes } = sealDirect({ from: evil, to: toPublic(ids.public), type: MsgType.Session, body: random(80), now: T0 });
  let r: { status: string } | undefined;
  assert.doesNotThrow(() => { r = m.receive('vizinho', bytes); });
  assert.notEqual(r?.status, 'delivered');
  assert.deepEqual(got, []);
  const c: Contact = { id: evil.id, via: 'public', pub: toPublic(evil), name: 'Eva' };
  assert.throws(() => m.addContact(c), /inválidas/);
});
