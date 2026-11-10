/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, newSeed } from '../../protocol/keys';
import { b64url } from '../card';
import { decodeState } from '../groups';

const wire = (i: ReturnType<typeof deriveIdentity>, name: string, role: string, id = i.id) =>
  ({ id, name, role, s: b64url(i.signPk), a: b64url(i.agreePk), b: b64url(i.binding) });
const state = (members: unknown[]) =>
  JSON.stringify({ id: 'a'.repeat(32), kind: 'group', rev: 1, keyV: 1, key: b64url(new Uint8Array(32).fill(3)), name: 'Família', members });

test('estado de grupo: membro cujo id não é o das chaves (ou com binding trocado) é descartado', () => {
  const admin = deriveIdentity(newSeed(), 'public'), x = deriveIdentity(newSeed(), 'public'), eva = deriveIdentity(newSeed(), 'public');
  // Id de X com as chaves da Eva: quem aceitasse passaria a cifrar para a Eva achando que é X.
  const g = decodeState(state([wire(admin, 'Ana', 'admin'), wire(eva, 'X', 'member', x.id)]), 'public');
  assert.ok(g);
  assert.deepEqual(g.members.map(m => m.id), [admin.id]);
  // Chave de acordo de outra pessoa sob a assinatura de X: o binding não confere.
  const mixed = { ...wire(x, 'X', 'member'), a: b64url(eva.agreePk) };
  assert.deepEqual(decodeState(state([wire(admin, 'Ana', 'admin'), mixed]), 'public')?.members.map(m => m.id), [admin.id]);
  // Membros corretos passam.
  assert.equal(decodeState(state([wire(admin, 'Ana', 'admin'), wire(x, 'X', 'member')]), 'public')?.members.length, 2);
});

test('estado de grupo: sem admin com chaves válidas, o estado inteiro é recusado', () => {
  const x = deriveIdentity(newSeed(), 'public'), eva = deriveIdentity(newSeed(), 'public');
  assert.equal(decodeState(state([wire(eva, 'X', 'admin', x.id)]), 'public'), null);
});
