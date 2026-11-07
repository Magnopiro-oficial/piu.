// Validador v2 (docs/economia/prova-de-entrega-v2.md): os ataques C-01, A-01 e M-05 da auditoria
// 2026-11-06 (docs/seguranca/auditoria-2026-11-06/node-settlement.md) agora falham.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeAddress } from '@polkadot/util-crypto';
import { checkLotBinding } from '../src/binding.js';
import { Journal } from '../src/journal.js';
import { planLot } from '../src/lot.js';
import { toHex } from '../src/protocol/bytes.js';
import { deriveIdentity, newSeed } from '../src/protocol/keys.js';
import { makeDeliveryProof, sealDeliveryProof, validatorProofKey } from '../src/protocol/proof.js';
import { makePayoutClaim, makeRelayReceipt } from '../src/protocol/receipts.js';
import { hash, random } from '../src/protocol/suite.js';
import { makeCertJson, makeRevocationJson, makeRotationJson, NodeRegistry } from '../src/registry.js';
import { payLot, SettlementError } from '../src/settler.js';
import { lunesToPlanck } from '../src/units.js';
import { buildLedger as build, closeEpoch, emptyState, epochEnd, epochStart, type EvidenceFile, toClaims, toEvidence } from '../src/validator.js';
import { FakeChain } from './fake-chain.js';
import { buildLedger, delivery, evidence, node, operatorKey, operators, PROOF_KEY, registry, registryFile, unregistered } from './v2-helpers.js';

const L = (s: string) => lunesToPlanck(s);
const E1 = '2026-S40', E2 = '2026-S41';
const inE = (e: string, h = 12) => epochStart(e) + h * 3600;
const closeAt = (e: string) => epochEnd(e) + 7 * 86400 + 60;
const wallet = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const NOW = closeAt(E1);
const states = (ev: EvidenceFile[], reg = registry()) => [...buildLedger(ev, [], NOW, reg).entries()].map(x => [x.state, x.reason ?? ''] as const);
const closeE1 = (ev: EvidenceFile[], budget = '100', capPercent = 2) =>
  closeEpoch({ epoch: E1, budget: L(budget), now: NOW, state: emptyState(), ledger: buildLedger(ev, [], NOW), claims: [], params: { capPercent } });

test('C-01: prova v1 forjada (id e segredo aleatórios, ackHash = H(segredo)) não rende nada', () => {
  const n = node();
  const fake = Array.from({ length: 20 }, () => {
    const envelopeId = toHex(random(16)), secret = random(16);
    return { r: makeRelayReceipt(n, envelopeId, hash(secret).slice(0, 16), inE(E1)), p: { envelopeId, ackSecret: secret } };
  });
  const ev = toEvidence(fake.map(f => f.r), fake.map(f => f.p));
  const r = closeE1([ev], '100', 100);
  assert.equal(r.report.deliveries, 0);
  assert.equal(r.report.receipts.validated, 0);
  assert.equal(r.report.receipts.legacyOnly, 20, 'aparecem como "só prova v1"');
  assert.deepEqual(r.report.accrued, []);
});

test('C-01: arquivo v1 inteiro (recibos + provas em claro, como os celulares antigos exportam) não paga', () => {
  const n = node();
  const ds = Array.from({ length: 5 }, () => delivery([n], inE(E1), false));
  const v1: EvidenceFile = { v: 1, receipts: toEvidence(ds.flatMap(d => d.receipts)).receipts, proofs: ds.flatMap(d => d.proofs).map(p => ({ envelopeId: p.envelopeId, ackSecret: toHex(p.ackSecret) })) };
  assert.equal(closeE1([v1], '100', 100).report.deliveries, 0);
  // Os mesmos recibos v1 rendem quando a prova v2 chega por outro arquivo (o recibo não mudou de formato).
  const v2proofs = toEvidence([], [], ds.map(d => ({ envelopeId: d.envelopeId, sealed: sealDeliveryProof(makeDeliveryProof(d.bytes, d.to, d.ackSecret, inE(E1) + 60, PROOF_KEY.pk), PROOF_KEY.pk) })));
  assert.equal(closeE1([v1, v2proofs], '100', 100).report.deliveries, 5);
});

test('C-01: prova v2 com segredo, cabeçalho ou destino trocados, ou selada para outra chave, não abre ou não confere', () => {
  const n = node();
  const d = delivery([n], inE(E1), false);
  const other = deriveIdentity(newSeed(), 'public');
  // Um relay sabe o id e o ackHash (cabeçalho), mas não o segredo: não consegue fazer a prova.
  assert.throws(() => makeDeliveryProof(d.bytes, other, random(16), inE(E1), PROOF_KEY.pk));
  const other2 = validatorProofKey(newSeed()).pk;
  const wrongKey = sealDeliveryProof(makeDeliveryProof(d.bytes, d.to, d.ackSecret, inE(E1), other2), other2);
  const ev = [evidence([d]), toEvidence([], [], [{ envelopeId: d.envelopeId, sealed: wrongKey }])];
  assert.deepEqual(states(ev), [['pendente', '']]);
  // Prova de OUTRO envelope com o id deste: o id de dentro não bate.
  const e = delivery([], inE(E1));
  const swapped = toEvidence([], [], [{ envelopeId: d.envelopeId, sealed: e.sealed[0]!.sealed }]);
  assert.deepEqual(states([evidence([d]), swapped]), [['pendente', '']]);
  // Recibo com ackHash diferente do cabeçalho: a prova verdadeira só conta junto de um recibo registrado
  // com o mesmo ackHash; o recibo errado não confere com ela.
  const p = delivery([n], inE(E1));
  const n2 = node();
  const bad = makeRelayReceipt(n2, p.envelopeId, random(16), inE(E1));
  assert.deepEqual(states([evidence([p], [bad])]).sort(), [['rejeitado', 'prova não confere'], ['validado', '']]);
  // Sozinho, o recibo errado nem deixa a prova contar: fica sem prova.
  assert.deepEqual(states([toEvidence([bad], [], p.sealed)]), [['pendente', '']]);
});

test('C-01: chaves Sybil (nós sem registro) não ganham nada, nem com tráfego e provas reais', () => {
  const honest = node();
  const sybils = Array.from({ length: 50 }, unregistered);
  const ds = [...Array.from({ length: 10 }, () => delivery([honest], inE(E1))), ...sybils.map(s => delivery([s], inE(E1)))];
  const r = closeE1([evidence(ds)], '100', 100);
  assert.equal(r.report.deliveries, 10);
  assert.equal(r.report.receipts.rejected['nó não registrado'], 50);
  assert.deepEqual(r.report.accrued.map(x => x.node), [toHex(honest.pk).slice(0, 16)]);
  // Operador não admitido, certificado forjado e nó revogado também ficam de fora.
  const rogue = operatorKey(false);
  const byRogue = node(rogue);
  const forged = unregistered();
  registryFile.certs!.push({ ...makeCertJson(operatorKey(), forged.pk, 0), sig: toHex(random(64)) });
  const op = operatorKey();
  const revoked = node(op);
  registryFile.revocations!.push(makeRevocationJson(op, 1, 0, [revoked.pk]));
  const out = states([evidence([delivery([byRogue], inE(E1)), delivery([forged], inE(E1)), delivery([revoked], inE(E1))])]).map(x => x[1]).sort();
  assert.deepEqual(out, ['nó não registrado', 'nó não registrado', 'nó revogado pelo operador']);
});

test('C-01: N chaves sob o MESMO operador admitido não multiplicam o teto de 2%', () => {
  const op = operatorKey();
  const farm = Array.from({ length: 50 }, () => node(op));
  const honest = Array.from({ length: 5 }, () => node());
  const ds = [...farm.flatMap(n => Array.from({ length: 4 }, () => delivery([n], inE(E1)))), ...honest.map(n => delivery([n], inE(E1)))];
  const r = closeE1([evidence(ds)], '1000');
  const farmHex = new Set(farm.map(n => toHex(n.pk).slice(0, 16)));
  const farmTotal = r.report.accrued.filter(x => farmHex.has(x.node)).reduce((s, x) => s + L(x.lunes), 0n);
  assert.ok(farmTotal <= L('20'), `o operador leva no máximo 2% de 1000 (levou ${farmTotal})`);
  assert.ok(r.report.accrued.filter(x => farmHex.has(x.node)).every(x => x.capped));
  // Rotação da chave do operador: certificado assinado pela chave nova, ligado pela cadeia, ainda conta como o mesmo operador.
  const next = operatorKey(false);
  const n2 = unregistered();
  registryFile.certs!.push({ ...makeCertJson(next, n2.pk, 2), chain: [makeRotationJson(op, next.pk, 1)] });
  const reg = registry();
  assert.equal(reg.operatorOf(toHex(n2.pk), inE(E1)), toHex(op.pk));
});

test('A-01: prova falsa não sobrescreve a verdadeira, em qualquer ordem de arquivos', () => {
  const a = node(), b = node();
  const d = delivery([a, b], inE(E1));
  // Um relay viu o envelope (sabe o id) e manda "provas": v1 com segredo aleatório e v2 lixo.
  const junk = toEvidence([], [{ envelopeId: d.envelopeId, ackSecret: random(16) }], [{ envelopeId: d.envelopeId, sealed: random(406) }]);
  for (const ev of [[junk, evidence([d])], [evidence([d]), junk]]) {
    assert.deepEqual(states(ev).map(x => x[0]), ['validado', 'validado']);
  }
});

test('A-01: duas provas válidas DIFERENTES para o mesmo envelope = conflito: ninguém ganha e vai para auditoria', () => {
  const a = node();
  const d = delivery([a], inE(E1));
  // Remetente e um cúmplice conhecem o segredo: outra identidade assina a "mesma" entrega.
  const accomplice = deriveIdentity(newSeed(), 'anon');
  const second = toEvidence([], [], [{ envelopeId: d.envelopeId, sealed: sealDeliveryProof(makeDeliveryProof(d.bytes, accomplice, d.ackSecret, inE(E1) + 3600, PROOF_KEY.pk), PROOF_KEY.pk) }]);
  for (const ev of [[evidence([d]), second], [second, evidence([d])]]) {
    const l = buildLedger(ev, [], NOW);
    assert.deepEqual([...l.entries()].map(x => [x.state, x.reason]), [['rejeitado', 'provas conflitantes']]);
    assert.deepEqual(l.flagged, [{ envelopeId: d.envelopeId, reason: 'provas conflitantes' }]);
  }
  // A MESMA prova repetida (ou do mesmo destino em outra hora) não é conflito.
  const again = toEvidence([], [], [{ envelopeId: d.envelopeId, sealed: sealDeliveryProof(makeDeliveryProof(d.bytes, d.to, d.ackSecret, inE(E1) + 7200, PROOF_KEY.pk), PROOF_KEY.pk) }]);
  assert.deepEqual(states([evidence([d]), again, evidence([d])]).map(x => x[0]), ['validado']);
});

test('A-01: tomar as 8 vagas com `at` mais cedo não funciona; excesso = ninguém ganha; sem registro não ocupa vaga', () => {
  const honest = [node(), node()];
  const d = delivery(honest, inE(E1, 40));
  // 8 Sybils REGISTRADOS assinam recibos com o ackHash real e `at` no início da época.
  const grabbers = Array.from({ length: 8 }, () => node());
  const early = grabbers.map(g => makeRelayReceipt(g, d.envelopeId, d.receipts[0]!.ackHash, epochStart(E1)));
  const l = buildLedger([evidence([d], early)], [], NOW);
  assert.ok([...l.entries()].every(x => x.state === 'rejeitado' && x.reason === 'excesso de recibos (auditar)'), 'ninguém leva o envelope');
  assert.deepEqual(l.flagged, [{ envelopeId: d.envelopeId, reason: 'excesso de recibos (auditar)' }]);
  // Os mesmos 8 sem registro: não ocupam vaga, os honestos ganham.
  const free = Array.from({ length: 8 }, unregistered).map(g => makeRelayReceipt(g, d.envelopeId, d.receipts[0]!.ackHash, epochStart(E1)));
  const ok = buildLedger([evidence([d], free)], [], NOW);
  assert.deepEqual([...ok.entries()].filter(x => x.state === 'validado').map(x => toHex(x.receipt.nodePk)).sort(), honest.map(h => toHex(h.pk)).sort());
  // `at` fora da vida do envelope (muito antes de ele existir) é recusado.
  const n = node();
  const old = makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, inE(E1, 40) - 10 * 86400);
  assert.deepEqual(states([toEvidence([old], [], d.sealed)]), [['rejeitado', 'horário fora da vida do envelope']]);
});

test('A-01: dois recibos diferentes do mesmo nó para o mesmo envelope: os dois fora', () => {
  const n = node();
  const d = delivery([n], inE(E1));
  const twin = makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, inE(E1) + 3600);
  assert.deepEqual(states([evidence([d], [twin])]), [['rejeitado', 'recibos conflitantes do mesmo nó']]);
});

test('teto por destino: tráfego sintético para uma identidade só rende até o teto da época', () => {
  const n = node();
  const me = deriveIdentity(newSeed(), 'public');
  const ds = Array.from({ length: 6 }, () => delivery([n], inE(E1), true, me));
  const l = build([evidence(ds)], [], NOW, { registry: registry(), proofKey: PROOF_KEY, policy: { maxPerRecipientPerEpoch: 4 } });
  const s = [...l.entries()].map(x => x.reason ?? 'ok').sort();
  assert.deepEqual(s, ['ok', 'ok', 'ok', 'ok', 'teto do destino', 'teto do destino']);
});

test('reprodutível: a mesma evidência em outra ordem dá o mesmo fechamento', () => {
  const ns = Array.from({ length: 4 }, () => node());
  const ds = Array.from({ length: 12 }, (_, i) => delivery(ns.slice(0, 1 + (i % 4)), inE(E1, i)));
  const a = closeE1([evidence(ds.slice(0, 6)), evidence(ds.slice(6))], '100', 100);
  const b = closeE1([evidence(ds.slice(6)), evidence(ds.slice(0, 6))], '100', 100);
  assert.deepEqual(a.report.accrued, b.report.accrued);
});

test('M-05: o lote v2 é amarrado ao estado; renomear, editar ou repetir os pagamentos com outro id é recusado', async () => {
  const a = node(), b = node();
  const ev = [evidence([...Array.from({ length: 6 }, () => delivery([a], inE(E1))), ...Array.from({ length: 4 }, () => delivery([b], inE(E1)))])];
  const r1 = closeE1(ev, '100', 100);
  const claims = [toClaims([makePayoutClaim(a, E2, wallet(1)), makePayoutClaim(b, E2, wallet(2))])];
  const r2 = closeEpoch({ epoch: E2, budget: L('100'), now: closeAt(E2), state: r1.state, ledger: buildLedger(ev, [], closeAt(E2)), claims, params: { capPercent: 100 } });
  const raw = r2.lot!;
  assert.equal(raw.v, 2);
  assert.equal(raw.accruals, 2);
  assert.ok(r2.state.accruals.every(x => x.address && x.lot === raw.id));
  const lot = planLot(raw);
  assert.doesNotThrow(() => checkLotBinding(raw, lot, r2.state));
  // Renomeado (outro id, mesmo conteúdo): nenhum crédito em lote com esse id.
  const renamed = { ...raw, id: `${raw.id}b` };
  assert.throws(() => checkLotBinding(renamed, planLot(renamed), r2.state), /Nenhum crédito em lote/);
  // Carteira trocada ou valor editado no arquivo: não bate.
  const edited = { ...raw, payouts: raw.payouts.map((p, i) => (i === 0 ? { ...p, address: wallet(9) } : p)) };
  assert.throws(() => checkLotBinding(edited, planLot(edited), r2.state), SettlementError);
  const more = { ...raw, payouts: raw.payouts.map((p, i) => (i === 0 ? { ...p, lunes: '99' } : p)) };
  assert.throws(() => checkLotBinding(more, planLot(more), r2.state), /stateHash|não batem/);
  // Lote manual (v1) não passa sem --manual.
  assert.throws(() => checkLotBinding({ id: raw.id }, lot, r2.state), /--manual/);

  // Diário: depois de pago, os MESMOS pagamentos com outro id são recusados (mesmo sem o estado).
  const treasury = wallet(250);
  const chain = new FakeChain(); chain.balances.set(treasury, L('1000'));
  const journal = new Journal(mkdtempSync(join(tmpdir(), 'piu-v2-')));
  const opts = { from: treasury, signer: treasury, wait: async () => { chain.mine(); } };
  assert.equal((await payLot(chain, journal, lot, opts)).state, 'finalizado');
  await assert.rejects(payLot(chain, journal, planLot(renamed), opts), /já estão no lote/);
  assert.equal(chain.paidTo(wallet(1)), L('60'), 'pago uma vez só');
});

test('registro: mesmas mensagens assinadas que o piu-node (OPERATOR_CERT, rotação, revogação)', async t => {
  let pn: typeof import('../../piu-node/src/relay/operator-frames.js');
  try { pn = await import('../../piu-node/src/relay/operator-frames.js'); } catch { t.skip('apps/piu-node não está presente'); return; }
  const op = operatorKey();
  const next = { sk: newSeed(), pk: new Uint8Array() }; next.pk = (await import('../src/protocol/suite.js')).sign.publicKey(next.sk);
  const n = unregistered(), r = unregistered();
  const cert = pn.certToJson(pn.makeCert(next, n.pk, 1000, [pn.makeRotation(op, next.pk, 999)]));
  const list = pn.listToJson(pn.makeRevocationList(next, 3, 1001, [r.pk]));
  const certR = pn.certToJson(pn.makeCert(op, r.pk, 998));
  const reg = NodeRegistry.build([operators], [{ v: 1, certs: [cert, certR], revocations: [list] }]);
  assert.equal(reg.operatorOf(toHex(n.pk), 5000), toHex(op.pk), 'certificado do piu-node, chave rotacionada');
  assert.equal(reg.operatorOf(toHex(r.pk), 5000), null, 'revogado pela lista do piu-node');
  assert.equal(reg.operatorOf(toHex(n.pk), 1000 - 3601), null, 'recibo anterior ao registro');
});

test('sem a chave do validador nada abre; sem operadores admitidos nada é registrado', () => {
  const n = node();
  const d = delivery([n], inE(E1));
  const l = build([evidence([d])], [], NOW, { registry: registry(), proofKey: null });
  assert.deepEqual([...l.entries()].map(x => x.state), ['pendente']);
  const empty = NodeRegistry.build([], [registryFile]);
  assert.deepEqual(states([evidence([d])], empty), [['rejeitado', 'nó não registrado']]);
});
