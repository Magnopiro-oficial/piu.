/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, utf8 } from '../bytes';
import { MsgType, openDirect, type Opened, sealDirect } from '../envelope';
import { deriveIdentity, type Identity, identityId, newSeed, toPublic, verifyBinding } from '../keys';
import { SessionManager } from '../sessions';
import { random, sign } from '../suite';

const NOW = 1_800_000_000;
const B = deriveIdentity(newSeed(), 'public');

/** Identidade do atacante: assinatura válida, mas a chave de acordo é um ponto de ordem baixa (binding assinado por ele mesmo). */
function lowOrderIdentity(agreePk: Uint8Array): Identity {
  const base = deriveIdentity(newSeed(), 'public');
  const binding = sign.sign(concat(utf8('piu/v0/binding'), agreePk), base.sign.sk);
  return { ...base, agree: { sk: base.agree.sk, pk: agreePk }, agreePk, binding, id: identityId(base.signPk, agreePk) };
}
const ZERO = new Uint8Array(32);
const ONE = Uint8Array.of(1, ...new Uint8Array(31));

test('chave de acordo de ordem baixa: o binding não confere, mesmo assinado pelo dono', () => {
  for (const pk of [ZERO, ONE]) assert.equal(verifyBinding(toPublic(lowOrderIdentity(pk))), false);
  assert.equal(verifyBinding({ ...toPublic(B), agreePk: B.agreePk.slice(0, 31) }), false, 'tamanho errado');
  assert.ok(verifyBinding(toPublic(B)), 'identidade normal continua valendo');
});

test('chave de acordo de ordem baixa no remetente: o envelope não abre e a sessão não lança', () => {
  const evil = lowOrderIdentity(ZERO);
  const { bytes } = sealDirect({ from: evil, to: toPublic(B), type: MsgType.Session, body: random(80), now: NOW });
  assert.equal(openDirect(bytes, B, NOW), null, 'recusado ao ler o remetente');
  // Mesmo que um envelope assim chegasse aberto, a sessão devolve null em vez de lançar.
  const m: Opened = { id: 'x', kind: 1, type: MsgType.Session, body: random(80), sentAt: NOW, from: toPublic(evil), fromId: evil.id, ackSecret: random(16) };
  const mgr = new SessionManager(B);
  assert.equal(mgr.open(m), null);
  assert.equal(mgr.get(evil.id), undefined);
});
