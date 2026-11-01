/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromUtf8, toHex, utf8 } from '../bytes';
import {
  decodeGroupKey, encodeGroupKey, envelopeId, HEADER_BYTES, HOP_OFFSET, MsgType, newGroupKey, openDirect, openGroup, parseHeader, sealDirect, sealGroup, withHops,
} from '../envelope';
import { deriveIdentity, deriveNodeKey, deriveWalletSeed, newSeed, toPublic, verifyBinding } from '../keys';
import { safetyNumber } from '../safety';

const NOW = 1_800_000_000;
const alice = deriveIdentity(newSeed(), 'public');
const bob = deriveIdentity(newSeed(), 'public');
const eve = deriveIdentity(newSeed(), 'public');

test('chaves: pública, anônima, nó e carteira nunca se repetem (seção 9)', () => {
  const seed = newSeed();
  const pub = deriveIdentity(seed, 'public'), anon = deriveIdentity(seed, 'anon'), node = deriveNodeKey(seed), wallet = deriveWalletSeed(seed);
  const all = [pub.sign.sk, pub.agree.sk, anon.sign.sk, anon.agree.sk, node.sk, wallet].map(toHex);
  assert.equal(new Set(all).size, all.length);
  assert.notEqual(pub.id, anon.id);
  // Derivação determinística: a mesma semente recupera as mesmas chaves (base do backup).
  assert.equal(deriveIdentity(seed, 'anon').id, anon.id);
  assert.ok(verifyBinding(toPublic(pub)));
});

test('direta: só o destino abre; o relay lê o cabeçalho mas não o conteúdo nem o remetente', () => {
  const { bytes, id } = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('Te vejo na praça'), now: NOW });
  const h = parseHeader(bytes);
  assert.equal(h.bodyLen, bytes.length - HEADER_BYTES);
  assert.ok(!Buffer.from(bytes).includes(Buffer.from(alice.signPk)), 'chave do remetente não aparece em claro');
  assert.ok(!Buffer.from(bytes).includes(Buffer.from('praça')), 'texto não aparece em claro');
  const m = openDirect(bytes, bob, NOW + 10);
  assert.ok(m);
  assert.equal(fromUtf8(m.body), 'Te vejo na praça');
  assert.equal(m.fromId, alice.id);
  assert.equal(m.id, id);
  assert.equal(openDirect(bytes, eve, NOW + 10), null);
  assert.equal(openDirect(bytes, alice, NOW + 10), null);
});

test('integridade: qualquer byte alterado invalida, menos o contador de saltos', () => {
  const { bytes } = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now: NOW });
  for (const pos of [0, 2, 3, 4, 8, 12, 30, 70, 90, 101, HEADER_BYTES + 5, bytes.length - 1]) {
    const t = bytes.slice(); t[pos] ^= 0x01;
    assert.equal(openDirect(t, bob, NOW), null, `byte ${pos}`);
  }
  const hop = withHops(bytes, 3);
  assert.equal(hop[HOP_OFFSET], 3);
  assert.ok(openDirect(hop, bob, NOW));
  assert.equal(envelopeId(hop), envelopeId(bytes), 'o id não muda ao passar por relays');
});

test('preenchimento: mensagens curtas de tamanhos diferentes viram envelopes do mesmo tamanho', () => {
  const a = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now: NOW });
  const b = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('Olá! Tudo certo para amanhã cedo na praça?'), now: NOW });
  assert.equal(a.bytes.length, b.bytes.length);
  assert.equal(fromUtf8(openDirect(b.bytes, bob, NOW)!.body), 'Olá! Tudo certo para amanhã cedo na praça?');
  const raw = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now: NOW, pad: false });
  assert.ok(raw.bytes.length < a.bytes.length);
});

test('autenticidade: ninguém se passa por outra pessoa', () => {
  // Eve cifra para Bob dizendo ser Alice: troca as chaves públicas no conteúdo, mas não tem a chave de assinatura.
  const fake = { ...eve, signPk: alice.signPk, agreePk: alice.agreePk, binding: alice.binding };
  const { bytes } = sealDirect({ from: fake, to: toPublic(bob), type: MsgType.Text, body: utf8('sou a Alice'), now: NOW });
  assert.equal(openDirect(bytes, bob, NOW), null);
});

test('validade no tempo: vencida ou "do futuro" é recusada', () => {
  const { bytes } = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('x'), now: NOW, ttlSec: 3600 });
  assert.equal(openDirect(bytes, bob, NOW + 3601), null);
  const future = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('x'), now: NOW + 3600 });
  assert.equal(openDirect(future.bytes, bob, NOW), null);
});

test('downgrade: versão ou suíte não aceitas são recusadas', () => {
  const { bytes } = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('x'), now: NOW });
  const v = bytes.slice(); v[0] = 9;
  assert.throws(() => parseHeader(v), /Versão/);
  const s = bytes.slice(); s[1] = 0;
  assert.throws(() => parseHeader(s), /Suíte/);
});

test('grupo: quem sai não lê nada depois da troca de chave (v4 → v5)', () => {
  const gid = utf8('mutirao');
  const v4 = newGroupKey(gid, 4);
  const before = sealGroup({ from: alice, group: v4, type: MsgType.Text, body: utf8('antes'), now: NOW });
  assert.equal(fromUtf8(openGroup(before.bytes, [v4], NOW)!.body), 'antes');
  // Eve é removida: a nova chave vai só para quem fica, cada uma num envelope direto.
  const v5 = newGroupKey(gid, 5);
  const dist = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.GroupKey, body: encodeGroupKey(v5), now: NOW });
  const got = decodeGroupKey(openDirect(dist.bytes, bob, NOW)!.body)!;
  assert.equal(got.version, 5);
  const after = sealGroup({ from: alice, group: v5, type: MsgType.Text, body: utf8('depois'), now: NOW });
  assert.equal(fromUtf8(openGroup(after.bytes, [v4, got], NOW)!.body), 'depois');
  assert.equal(openGroup(after.bytes, [v4], NOW), null, 'Eve só tem a v4');
  // Eve guardou a v4 e tenta continuar publicando nela: os membros recusam porque ela não é mais membro.
  const members = new Set([alice.id, bob.id]);
  const isMember = (fromId: string) => members.has(fromId);
  const sneaky = sealGroup({ from: eve, group: v4, type: MsgType.Text, body: utf8('ainda estou aqui'), now: NOW + 5 });
  assert.equal(openGroup(sneaky.bytes, [v4, got], NOW + 5, isMember), null);
  assert.ok(openGroup(after.bytes, [v4, got], NOW, isMember));
});

test('chave efêmera maliciosa (ponto de ordem baixa) é recusada sem quebrar', () => {
  const { bytes } = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('x'), now: NOW });
  const t = bytes.slice(); t.fill(0, 28, 60); // eph = 0
  assert.equal(openDirect(t, bob, NOW), null);
});

test('código de segurança: 12 × 5 dígitos, igual nos dois lados, muda se a chave mudar', () => {
  const ab = safetyNumber(toPublic(alice), toPublic(bob));
  assert.equal(ab.length, 12);
  assert.ok(ab.every(g => /^\d{5}$/.test(g)));
  assert.deepEqual(safetyNumber(toPublic(bob), toPublic(alice)), ab);
  assert.notDeepEqual(safetyNumber(toPublic(alice), toPublic(eve)), ab);
});
