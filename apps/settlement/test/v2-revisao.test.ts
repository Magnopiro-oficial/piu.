// Revisão independente da prova de entrega v2 (docs/economia/prova-de-entrega-v2.md, seção 12).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeFileAtomic } from '../src/fsutil.js';
import { Journal } from '../src/journal.js';
import { hash, random } from '../src/protocol/suite.js';
import { toHex } from '../src/protocol/bytes.js';
import { authHeader } from '../src/protocol/envelope.js';
import { deriveIdentity, newSeed } from '../src/protocol/keys.js';
import { proofPseudonym, sealDeliveryProof, signDeliveryProof } from '../src/protocol/proof.js';
import { makeRelayReceipt } from '../src/protocol/receipts.js';
import { makeCertJson, makeRevocationJson, makeRotationJson, NodeRegistry } from '../src/registry.js';
import { lunesToPlanck } from '../src/units.js';
import { allocate, buildLedger as build, closeEpoch, emptyState, epochEnd, epochStart, type EvidenceFile, toEvidence } from '../src/validator.js';
import { buildLedger, delivery, evidence, node, operatorKey, operators, PROOF_KEY, registry, unregistered } from './v2-helpers.js';

const L = (s: string) => lunesToPlanck(s);
const E1 = '2026-S40', E2 = '2026-S41';
const inE = (e: string, h = 12) => epochStart(e) + h * 3600;
const closeAt = (e: string) => epochEnd(e) + 7 * 86400 + 60;
const NOW = closeAt(E2);
const close = (epoch: string, ev: EvidenceFile[], budget: string, capPercent: number, policy = {}) =>
  closeEpoch({ epoch, budget: L(budget), now: NOW, state: emptyState(), ledger: build(ev, [], NOW, { registry: registry(), proofKey: PROOF_KEY, policy }), claims: [], params: { capPercent } });
const sumLunes = (xs: { lunes: string }[]) => xs.reduce((s, x) => s + L(x.lunes), 0n);

/** Prova v2 "válida" com cabeçalho forjado (ackHash próprio) para o id de um envelope real. */
function forgedProof(d: ReturnType<typeof delivery>) {
  const s = random(16);
  const header = authHeader(d.bytes);
  header.set(hash(s).slice(0, 16), 84);
  const key = proofPseudonym(deriveIdentity(newSeed(), 'public'), PROOF_KEY.pk);
  const p = signDeliveryProof({ envelopeId: d.envelopeId, header, ackSecret: s, pseudonym: key.pk, provedAt: inE(E1) - (inE(E1) % 3600) }, key);
  return { ackHash: header.slice(84, 100), sealed: { envelopeId: d.envelopeId, sealed: sealDeliveryProof(p, PROOF_KEY.pk) } };
}

test('1. conflito sem custo: prova com cabeçalho forjado é ruído; só conta se um nó REGISTRADO assinar recibo com aquele ackHash', () => {
  const a = node(), b = node();
  const d = delivery([a, b], inE(E1));
  const f = forgedProof(d);
  for (const ev of [[toEvidence([], [], [f.sealed]), evidence([d])], [evidence([d]), toEvidence([], [], [f.sealed])]]) {
    const l = buildLedger(ev, [], NOW);
    assert.deepEqual([...l.entries()].map(x => x.state), ['validado', 'validado'], 'a prova forjada não derruba a verdadeira');
    assert.equal(l.stats.badProofs, 1);
  }
  // Recibo de nó SEM registro com o ackHash forjado: continua ruído.
  const free = makeRelayReceipt(unregistered(), d.envelopeId, f.ackHash, inE(E1));
  assert.equal([...buildLedger([evidence([d], [free]), toEvidence([], [], [f.sealed])], [], NOW).entries()].filter(x => x.state === 'validado').length, 2);
  // Só um nó registrado, que fica identificado, consegue criar o conflito.
  const griefer = node();
  const signed = makeRelayReceipt(griefer, d.envelopeId, f.ackHash, inE(E1));
  const l = buildLedger([evidence([d], [signed]), toEvidence([], [], [f.sealed])], [], NOW);
  assert.ok([...l.entries()].every(x => x.state === 'rejeitado'));
  assert.deepEqual(l.flagged, [{ envelopeId: d.envelopeId, reason: 'provas conflitantes' }]);
});

test('2. allocate: quem bate no teto fica no teto e o excedente vai para os outros (por nó e por operador)', () => {
  const units = new Map<string, bigint>([['h1', 1n], ['h2', 1n], ...Array.from({ length: 10 }, (_, i) => [`s${i}`, 100n] as [string, bigint])]);
  const op = (n: string) => (n.startsWith('s') ? 'farm' : n);
  const out = allocate(units, op, 1000n, 100n);
  const farm = [...out].filter(([n]) => n.startsWith('s')).reduce((s, [, x]) => s + x.amount, 0n);
  assert.ok(farm <= 100n);
  assert.equal(out.get('h1')!.amount, 100n, 'os honestos vão até o teto deles, em vez de quase zero');
  assert.equal(out.get('h2')!.amount, 100n);
  // Sem teto apertado: proporcional, como antes.
  assert.deepEqual([...allocate(new Map([['a', 1n], ['b', 3n]]), n => n, 100n, 100n)].map(([, x]) => x.amount), [25n, 75n]);
});

test('2. 100 nós Sybil sob um operador admitido não diluem os honestos além da fatia (com teto) dele', () => {
  const honest = Array.from({ length: 30 }, () => node());
  const hds = honest.map(n => delivery([n], inE(E1)));
  const before = close(E1, [evidence(hds)], '1000', 5);
  const farmOp = operatorKey();
  const farm = Array.from({ length: 100 }, () => node(farmOp));
  const fds = farm.flatMap(n => [delivery([n], inE(E1)), delivery([n], inE(E1))]);
  const after = close(E1, [evidence([...hds, ...fds])], '1000', 5);
  const hx = new Set(honest.map(n => toHex(n.pk).slice(0, 16)));
  const honestBefore = sumLunes(before.report.accrued), honestAfter = sumLunes(after.report.accrued.filter(x => hx.has(x.node)));
  const farmAfter = sumLunes(after.report.accrued.filter(x => !hx.has(x.node)));
  const cap = L('50');
  assert.ok(farmAfter <= cap, `o operador fica no teto (${farmAfter})`);
  // (30 planck de folga: arredondamento para baixo por nó.)
  assert.ok(honestAfter + 30n >= honestBefore - cap, `honestos: ${honestAfter} ≥ ${honestBefore} − teto`);
  assert.ok(honestAfter + farmAfter <= L('1000'));
});

test('3. excesso: um operador com 9 nós não zera o envelope; os recibos dele saem e os outros ganham', () => {
  const honest = [node(), node()];
  const op = operatorKey();
  const nine = Array.from({ length: 9 }, () => node(op));
  const d = delivery(honest, inE(E1));
  const grab = nine.map(n => makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, inE(E1)));
  const l = buildLedger([evidence([d], grab)], [], NOW);
  const e = [...l.entries()];
  assert.deepEqual(e.filter(x => x.state === 'validado').map(x => toHex(x.receipt.nodePk)).sort(), honest.map(h => toHex(h.pk)).sort());
  assert.equal(e.filter(x => x.reason === 'vários recibos do mesmo operador num envelope em excesso').length, 9);
  assert.deepEqual(l.operatorFlags, [{ operator: toHex(op.pk), epoch: E1, envelopes: 1, excluded: false }]);
  // 9 operadores diferentes, um nó cada: não dá para saber quem é o atacante; ninguém ganha (auditar).
  const many = Array.from({ length: 9 }, () => node()).map(n => makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, inE(E1)));
  assert.ok([...buildLedger([evidence([d], many)], [], NOW).entries()].every(x => x.state === 'rejeitado' && x.reason === 'excesso de recibos (auditar)'));
});

test('3. operador que causa excesso em N envelopes na época fica fora da época inteira (N configurável)', () => {
  const op = operatorKey();
  const nine = Array.from({ length: 9 }, () => node(op));
  const honest = node();
  const ds = Array.from({ length: 3 }, () => delivery([honest], inE(E1)));
  const grab = ds.flatMap(d => nine.map(n => makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, inE(E1))));
  const own = delivery([nine[0]!], inE(E1)); // entrega legítima do mesmo operador na mesma época
  const r = close(E1, [evidence([...ds, own], grab)], '100', 100, { maxFlagsPerOperator: 3 });
  assert.deepEqual(r.report.operatorFlags, [{ operator: toHex(op.pk), epoch: E1, envelopes: 3, excluded: true }]);
  assert.equal(r.report.receipts.rejected['operador fora da época (excessos demais)'], 27 + 1, 'os 27 recibos em excesso e a entrega legítima dele');
  assert.deepEqual(r.report.accrued.map(x => x.node), [toHex(honest.pk).slice(0, 16)]);
  // Com N maior, só os recibos em excesso saem.
  const r2 = close(E1, [evidence([...ds, own], grab)], '100', 100, { maxFlagsPerOperator: 4 });
  assert.equal(r2.report.operatorFlags[0]!.excluded, false);
  assert.equal(r2.report.accrued.length, 2);
});

test('8. época: a do recibo válido mais antigo do envelope, para o fechamento e para o teto por destino', () => {
  const a = node(), b = node();
  const end = epochEnd(E1);
  const d = delivery([a], end - 3600);
  const late = makeRelayReceipt(b, d.envelopeId, d.receipts[0]!.ackHash, end + 3600); // já em E2
  const ev = [evidence([d], [late])];
  const r1 = close(E1, ev, '100', 100), r2 = close(E2, ev, '100', 100);
  assert.equal(r1.report.deliveries, 1);
  assert.equal(r1.report.receipts.validated, 2, 'os dois recibos contam na época do envelope');
  assert.equal(r2.report.deliveries, 0, 'e não de novo na seguinte');
  // Teto por destino com a mesma regra: duas entregas para o mesmo destino, uma em cada época.
  const me = deriveIdentity(newSeed(), 'public');
  const p = [delivery([a], inE(E1), true, me), delivery([a], inE(E2), true, me)];
  const l = build([evidence(p)], [], NOW, { registry: registry(), proofKey: PROOF_KEY, policy: { maxPerRecipientPerEpoch: 1 } });
  assert.deepEqual([...l.entries()].map(e => e.state), ['validado', 'validado'], 'uma por época, cada uma no seu teto');
});

test('5. diário e estado gravados de forma atômica (0600, sem .tmp sobrando)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-atom-'));
  const f = join(dir, 'sub', 'x.json');
  writeFileAtomic(f, '{"a":1}');
  writeFileAtomic(f, '{"a":2}');
  assert.equal(readFileSync(f, 'utf8'), '{"a":2}');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const j = new Journal(join(dir, 'diario'));
  j.put({ lot: 'L1', digest: 'd', total: '1', state: 'assinado', attempts: [], updatedAt: 0 });
  assert.equal(j.get('L1')?.state, 'assinado');
  assert.throws(() => statSync(join(dir, 'diario', 'L1.json.tmp')));
});

test('6. rotação: a chave antiga só vale para o emitido antes; a nova não vale retroativa', () => {
  const op = operatorKey(), next = operatorKey(false);
  const n1 = unregistered(), n2 = unregistered(), n3 = unregistered(), n4 = unregistered(), rv = unregistered();
  const rot = makeRotationJson(op, next.pk, 1000);
  const certs = [
    makeCertJson(op, n1.pk, 999),                                 // antiga, antes da rotação: vale
    { ...makeCertJson(op, n2.pk, 1500) },                         // antiga, depois da rotação: não
    { ...makeCertJson(next, n3.pk, 1200), chain: [rot] },         // nova, depois: vale
    { ...makeCertJson(next, n4.pk, 500), chain: [rot] },          // nova, retroativa: não
    makeCertJson(op, rv.pk, 10),
  ];
  const lists = [makeRevocationJson(op, 9, 1500, [rv.pk])];         // lista da antiga depois da rotação: não vale
  const reg = NodeRegistry.build([operators], [{ v: 1, certs, revocations: lists }]);
  const at = 5000;
  assert.equal(reg.operatorOf(toHex(n1.pk), at), toHex(op.pk));
  assert.equal(reg.operatorOf(toHex(n2.pk), at), null);
  assert.equal(reg.operatorOf(toHex(n3.pk), at), toHex(op.pk));
  assert.equal(reg.operatorOf(toHex(n4.pk), at), null);
  assert.equal(reg.operatorOf(toHex(rv.pk), at), toHex(op.pk), 'revogação pela chave já substituída não vale');
  const ok = NodeRegistry.build([operators], [{ v: 1, certs, revocations: [makeRevocationJson(next, 9, 1500, [rv.pk])] }]);
  assert.equal(ok.operatorOf(toHex(rv.pk), at), null, 'pela chave vigente vale');
});
