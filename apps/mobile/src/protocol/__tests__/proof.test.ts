/// <reference types="node" />
// Prova de entrega v2 (docs/economia/prova-de-entrega-v2.md; auditoria 2026-11-06, C-01 e A-01).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHex, utf8 } from '../bytes';
import { authHeader, envelopeId, MsgType, parseHeader, newGroupKey, sealDirect, sealGroup } from '../envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../keys';
import {
  decodeDeliveryProof, decodeProofV2Frame, DELIVERY_PROOF_BYTES, encodeDeliveryProof, encodeProofV2Frame, makeDeliveryProof, openSealedProof,
  PROOF_V2_MAGIC, proofPseudonym, SEALED_PROOF_BYTES, sealDeliveryProof, validatorProofKey, verifyDeliveryProof,
} from '../proof';
import { ContributionLedger, makeRelayReceipt } from '../receipts';
import { hash, random } from '../suite';

const NOW = 1_800_000_000;
const A = deriveIdentity(newSeed(), 'public'), B = deriveIdentity(newSeed(), 'public'), C = deriveIdentity(newSeed(), 'anon');
const V = validatorProofKey(newSeed());

const sent = () => sealDirect({ from: A, to: toPublic(B), type: MsgType.Text, body: utf8('oi'), now: NOW });

test('prova v2: o destino assina, o validador confere contra o ackHash do CABEÇALHO', () => {
  const m = sent();
  const p = makeDeliveryProof(m.bytes, B, m.ackSecret, NOW + 120, V.pk);
  assert.equal(p.envelopeId, m.id);
  assert.equal(encodeDeliveryProof(p).length, DELIVERY_PROOF_BYTES);
  const back = decodeDeliveryProof(encodeDeliveryProof(p));
  const h = verifyDeliveryProof(back, NOW + 3600);
  assert.ok(h);
  assert.equal(toHex(h.ackHash), toHex(parseHeader(m.bytes).ackHash));
  assert.equal(back.provedAt % 3600, 0, 'horário arredondado para a hora');
});

test('C-01: segredo aleatório, id aleatório ou cabeçalho trocado não viram prova', () => {
  const m = sent();
  // Segredo que não é o do envelope: nem dá para assinar.
  assert.throws(() => makeDeliveryProof(m.bytes, B, random(16), NOW, V.pk));
  const p = makeDeliveryProof(m.bytes, B, m.ackSecret, NOW, V.pk);
  // Trocar o segredo e o ackHash do cabeçalho juntos (o ataque do v1) quebra a assinatura do destino.
  const s = random(16);
  const header = p.header.slice(); header.set(hash(s).slice(0, 16), 84);
  assert.equal(verifyDeliveryProof({ ...p, ackSecret: s, header }, NOW), null);
  // Outro id com a mesma assinatura: não confere.
  assert.equal(verifyDeliveryProof({ ...p, envelopeId: toHex(random(16)) }, NOW), null);
  // Outro pseudônimo não assina pelo do destino.
  assert.equal(verifyDeliveryProof({ ...p, pseudonym: proofPseudonym(C, V.pk).pk }, NOW), null);
  // Prova "do futuro" e de muito antes do envelope existir.
  assert.equal(verifyDeliveryProof(makeDeliveryProof(m.bytes, B, m.ackSecret, NOW + 8 * 86400, V.pk), NOW), null);
  assert.equal(verifyDeliveryProof(makeDeliveryProof(m.bytes, B, m.ackSecret, NOW - 9 * 86400, V.pk), NOW), null);
});

test('prova v2: mensagem de grupo não vale (o destino de grupo não é uma pessoa)', () => {
  const g = newGroupKey(random(16), 1);
  const m = sealGroup({ from: A, group: g, type: MsgType.Text, body: utf8('todos'), now: NOW });
  const p = makeDeliveryProof(m.bytes, B, m.ackSecret, NOW, V.pk);
  assert.equal(verifyDeliveryProof(p, NOW), null);
});

test('prova selada: só a chave do validador abre; id de fora tem de bater com o de dentro', () => {
  const m = sent();
  const p = makeDeliveryProof(m.bytes, B, m.ackSecret, NOW, V.pk);
  const sealed = sealDeliveryProof(p, V.pk);
  assert.equal(sealed.length, SEALED_PROOF_BYTES);
  const opened = openSealedProof(sealed, m.id, V);
  assert.ok(opened && verifyDeliveryProof(opened, NOW));
  assert.equal(openSealedProof(sealed, m.id, validatorProofKey(newSeed())), null, 'outra chave');
  assert.equal(openSealedProof(sealed, toHex(random(16)), V), null, 'outro id');
  const bad = sealed.slice(); bad[100] ^= 1;
  assert.equal(openSealedProof(bad, m.id, V), null, 'adulterada');
  // A identidade do destino não aparece em claro na prova selada.
  assert.ok(!toHex(sealed).includes(toHex(B.signPk)) && !toHex(sealed).includes(toHex(B.agreePk)));
  // Nem dentro: o validador vê um pseudônimo, estável por destino e diferente por validador e por identidade.
  assert.notEqual(toHex(opened.pseudonym), toHex(B.signPk));
  assert.equal(toHex(opened.pseudonym), toHex(proofPseudonym(B, V.pk).pk));
  assert.notEqual(toHex(proofPseudonym(B, validatorProofKey(newSeed()).pk).pk), toHex(opened.pseudonym));
  const Banon = deriveIdentity(newSeed(), 'anon');
  assert.notEqual(toHex(proofPseudonym(Banon, V.pk).pk), toHex(opened.pseudonym));
  assert.equal(envelopeId(m.bytes), m.id);
  assert.equal(authHeader(m.bytes).length, 104);
});

test('quadro P2: ida e volta; malformado é recusado; não se confunde com envelope nem com "PR"', () => {
  const m = sent();
  const item = { envelopeId: m.id, sealed: sealDeliveryProof(makeDeliveryProof(m.bytes, B, m.ackSecret, NOW, V.pk), V.pk) };
  const f = encodeProofV2Frame([item, item]);
  assert.deepEqual(decodeProofV2Frame(f)?.map(x => x.envelopeId), [m.id, m.id]);
  assert.equal(decodeProofV2Frame(f.slice(0, -1)), null);
  assert.equal(f[0], PROOF_V2_MAGIC[0]);
  assert.notEqual(f[0], 0, 'envelopes começam com a versão 0');
  assert.notDeepEqual([f[0], f[1]], [0x50, 0x52]);
  assert.throws(() => parseHeader(f), 'um aparelho antigo descarta o quadro como envelope inválido');
  assert.throws(() => encodeProofV2Frame([]));
});

test('A-01 (livro v1): prova diferente para o mesmo envelope não sobrescreve; ninguém ganha', () => {
  const ledger = new ContributionLedger();
  const s1 = random(16), s2 = random(16);
  const r = makeRelayReceipt(deriveNodeKey(newSeed()), 'env-x', hash(s1).slice(0, 16), NOW);
  assert.equal(ledger.submit(r, NOW), 'pendente');
  assert.ok(ledger.confirmDelivery('env-x', s1, hash(s1).slice(0, 16)));
  assert.ok(ledger.confirmDelivery('env-x', s1, hash(s1).slice(0, 16)), 'a mesma prova de novo: sem efeito');
  assert.equal(ledger.summary(r.nodePk).validado, 1);
  assert.equal(ledger.confirmDelivery('env-x', s2, hash(s2).slice(0, 16)), false, 'prova conflitante');
  assert.deepEqual(ledger.summary(r.nodePk), { pendente: 0, validado: 0, rejeitado: 1 });
});
