// Auditoria final de 06/11/2026 (docs/auditoria-final-2026-11-06/core-node-provider.md): correções no
// validador e no liquidante, cada uma com o ataque que ela fecha.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeAddress } from '@polkadot/util-crypto';
import { markBond, type BondRecord } from '../src/bond.js';
import { EXPECTED, preflight } from '../src/chain.js';
import { ingestBundle } from '../src/inbox.js';
import { Journal } from '../src/journal.js';
import { planLot } from '../src/lot.js';
import { toHex } from '../src/protocol/bytes.js';
import { BundleKind, sealBundle } from '../src/protocol/carry.js';
import { newSeed } from '../src/protocol/keys.js';
import { dayOfSec, derivePhoneOperatorKey, makeEndorsement } from '../src/protocol/phoneNode.js';
import { recordFirstSeen } from '../src/phone-nodes.js';
import { emptyState } from '../src/validator.js';
import { makeCertJson, makeRevocationJson, makeRotationJson, NodeRegistry } from '../src/registry.js';
import { payLot, SettlementError } from '../src/settler.js';
import { loadSigner } from '../src/signer.js';
import { lunesToPlanck } from '../src/units.js';
import { buildLedger as build, type EvidenceFile, toEvidence } from '../src/validator.js';
import { FakeChain } from './fake-chain.js';
import { delivery, evidence, node, operatorKey, operators, PROOF_KEY, registry, unregistered } from './v2-helpers.js';

const W = 2 ** 32;
const NOW = 1_800_000_000;

test('H-1: lista de revogação antiga com seq + 2^32 não "desrevoga" um nó', () => {
  const op = operatorKey();
  const a = unregistered(), b = unregistered();
  const certs = [makeCertJson(op, a.pk, 0), makeCertJson(op, b.pk, 0)];
  const l1 = makeRevocationJson(op, 1, 100, [a.pk]);
  const l2 = makeRevocationJson(op, 2, 200, [a.pk, b.pk]);
  const forged = { ...l1, seq: l1.seq + W };
  const reg = NodeRegistry.build([operators], [{ v: 1, certs, revocations: [forged, l1, l2] }]);
  assert.equal(reg.operatorOf(toHex(b.pk), 5000), null, 'b continua revogado');
  assert.equal(reg.operatorOf(toHex(a.pk), 5000), null);
});

test('H-1: cópia de certificado com issuedAt + 2^32 (em arquivo que ordena antes) não tira o registro do nó honesto', () => {
  const op = operatorKey();
  const n = unregistered();
  const cert = makeCertJson(op, n.pk, 10);
  const copy = { ...cert, issuedAt: cert.issuedAt + W };
  const reg = NodeRegistry.build([operators], [{ v: 1, certs: [copy] }, { v: 1, certs: [cert] }]);
  assert.equal(reg.operatorOf(toHex(n.pk), 5000), toHex(op.pk));
});

test('H-1: passo de rotação com at + 2^32 não congela a chave nova do operador', () => {
  const op = operatorKey(), next = operatorKey(false);
  const n = unregistered();
  const rot = makeRotationJson(op, next.pk, 1000);
  const bad = { ...rot, at: rot.at + W };
  const reg = NodeRegistry.build([operators], [{ v: 1, certs: [{ ...makeCertJson(next, n.pk, 1200), chain: [bad, rot] }] }]);
  assert.equal(reg.operatorOf(toHex(n.pk), 5000), toHex(op.pk));
});

test('H-1: cópia de recibo com at ± 2^32 não derruba o crédito do honesto', () => {
  const a = node(), b = node();
  const d = delivery([a, b], NOW - 86400);
  const r = d.receipts[0]!;
  const ev: EvidenceFile = toEvidence([{ ...r, at: r.at + W }, { ...r, at: r.at - W }], [], []);
  const honest = evidence([d]);
  const led = build([ev, honest], [], NOW, { registry: registry(), proofKey: PROOF_KEY });
  const states = [...led.entries()].map(e => `${toHex(e.receipt.nodePk).slice(0, 8)}:${e.state}:${e.reason ?? ''}`);
  assert.equal([...led.entries()].filter(e => toHex(e.receipt.nodePk) === toHex(a.pk) && /duplicad|conflit|diferente/i.test(e.reason ?? '')).length, 0, states.join(' | '));
  // O recibo do honesto entra no livro com o `at` original.
  assert.ok([...led.entries()].some(e => toHex(e.receipt.nodePk) === toHex(a.pk) && e.receipt.at === r.at), states.join(' | '));
});

test('H-1: a caixa recusa recibo com `at` fora de u32', () => {
  const d = mkdtempSync(join(tmpdir(), 'piu-caixa-'));
  const bad = { v: 2, receipts: [{ envelopeId: 'ab'.repeat(16), ackHash: 'cd'.repeat(16), nodePk: 'ef'.repeat(32), at: W + 5, sig: '01'.repeat(64) }], proofs: [], sealedProofs: [] };
  const r = ingestBundle(sealBundle(BundleKind.Evidence, JSON.stringify(bad), PROOF_KEY.pk), PROOF_KEY, d);
  assert.equal(r.ok, false);
  const neg = { ...bad, receipts: [{ ...bad.receipts[0]!, at: -1 }] };
  assert.equal(ingestBundle(sealBundle(BundleKind.Evidence, JSON.stringify(neg), PROOF_KEY.pk), PROOF_KEY, d).ok, false);
});

test('M-1: endereço que não é de 32 bytes não entra no lote', () => {
  const short = encodeAddress(new Uint8Array([1, 2]), 42);
  const long = encodeAddress(new Uint8Array(33).fill(7), 42);
  for (const a of [short, long]) assert.throws(() => planLot({ id: 'x', payouts: [{ address: a, lunes: '10' }] }), /Endereço inválido/);
});

const addr = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const TREASURY = addr(250);
const lotIn = (id = 'lote-a') => ({ id, payouts: [{ address: addr(1), lunes: '10' }] });

test('M-2: dois lot:pay do mesmo lote ao mesmo tempo: o segundo é recusado pela trava, uma transação só', async () => {
  const chain = new FakeChain();
  chain.balances.set(TREASURY, lunesToPlanck('1000'));
  const dir = mkdtempSync(join(tmpdir(), 'piu-lote-'));
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  // O primeiro fica "esperando a chain" (info) com a trava na mão.
  const slowChain = new Proxy(chain, { get(t, k) {
    if (k === 'info') return async () => { await gate; return t.info(); };
    const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v;
  } });
  const opts = { from: TREASURY, signer: TREASURY, wait: async () => { chain.mine(); } };
  const p1 = payLot(slowChain, new Journal(dir), planLot(lotIn()), opts);
  await new Promise(r => setTimeout(r, 20));
  await assert.rejects(payLot(chain, new Journal(dir), planLot(lotIn()), opts), (e: Error) => e instanceof SettlementError && /em andamento/.test(e.message));
  release();
  const e = await p1;
  assert.equal(e.state, 'finalizado');
  assert.equal(chain.paidTo(addr(1)), lunesToPlanck('10'));
  const slow = opts;
  // Terminado, a trava some: rodar de novo devolve o resultado.
  assert.equal((await payLot(chain, new Journal(dir), planLot(lotIn()), slow)).state, 'finalizado');
});

test('M-3: preflight confere o hash de gênese da Lunes Mainnet', async () => {
  const info = await new FakeChain().info();
  assert.deepEqual(preflight(info), []);
  assert.match(preflight({ ...info, genesisHash: '0x' + '11'.repeat(32) }).join(';'), /gênese/);
  assert.equal(EXPECTED.genesisHash, '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac');
  // Rede de desenvolvimento: só com a gênese declarada de propósito.
  assert.deepEqual(preflight({ ...info, genesisHash: '0x' + '11'.repeat(32) }, '0x' + '11'.repeat(32)), []);
});

test('B-a: diário corrompido não vira "lote novo" (não paga de novo)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-lote-'));
  writeFileSync(join(dir, 'lote-a.json'), '{ corrompido');
  const chain = new FakeChain();
  chain.balances.set(TREASURY, lunesToPlanck('1000'));
  await assert.rejects(payLot(chain, new Journal(dir), planLot(lotIn()), { from: TREASURY, signer: TREASURY, wait: async () => { chain.mine(); } }), /diário/i);
  assert.equal(chain.paidTo(addr(1)), 0n);
});

test('B-07: semente em texto claro é recusada na Mainnet; keystore com permissão aberta é recusado', async () => {
  const env = { PIU_SETTLEMENT_SEED: '//Alice' };
  await assert.rejects(loadSigner(env, 42, EXPECTED.genesisHash), /Mainnet/);
  const dev = await loadSigner(env, 42, '0x' + '22'.repeat(32));
  assert.ok(dev.address);
  const d = mkdtempSync(join(tmpdir(), 'piu-ks-'));
  const ks = join(d, 'ks.json'), pw = join(d, 'pw');
  writeFileSync(ks, '{}'); writeFileSync(pw, 'x');
  chmodSync(ks, 0o644); chmodSync(pw, 0o600);
  await assert.rejects(loadSigner({ PIU_SETTLEMENT_KEYSTORE: ks, PIU_SETTLEMENT_PASSWORD_FILE: pw }, 42, EXPECTED.genesisHash), /permissão/);
});

test('B-08: evidência com listas de tipo errado não derruba o close (o arquivo é ignorado)', () => {
  const a = node();
  const d = delivery([a], NOW - 86400);
  const junk = [{ v: 2, receipts: 5 }, { v: 2, sealedProofs: 'x' }, null, { v: 2, receipts: [null, 7, 'x'] }] as unknown as EvidenceFile[];
  const led = build([...junk, evidence([d])], [], NOW, { registry: registry(), proofKey: PROOF_KEY });
  assert.ok([...led.entries()].some(e => toHex(e.receipt.nodePk) === toHex(a.pk)));
});

test('B-c: marcar caução escolhe pela tx quando há mais de uma ativa e guarda a tx da devolução', () => {
  const op = 'aa'.repeat(32);
  const base = { operatorPk: op, wallet: addr(3), amount: '10000000000', block: 1, state: 'ativa' as const, firstSeen: 0 };
  const recs = [{ ...base, txHash: '0x01' }, { ...base, txHash: '0x02' }] as unknown as BondRecord[];
  assert.throws(() => markBond(recs, op, 'devolvida', '', 1), /--tx/);
  const out = markBond(recs, op, 'devolvida', '', 1, { txHash: '0x02', refundTx: '0x' + 'ab'.repeat(32) });
  assert.equal(out.find(b => b.txHash === '0x02')!.state, 'devolvida');
  assert.equal(out.find(b => b.txHash === '0x02')!.refundTx, '0x' + 'ab'.repeat(32));
  assert.equal(out.find(b => b.txHash === '0x01')!.state, 'ativa');
  assert.throws(() => markBond(recs, op, 'devolvida', '', 1, { txHash: '0x02', refundTx: 'não-hash' }), /refund-tx/);
});

test('M-4: aval de quem não é operador nem celular registrado, ou para celular sem registro, não ocupa o estado', () => {
  const phone = derivePhoneOperatorKey(newSeed()), endorser = derivePhoneOperatorKey(newSeed());
  const day = dayOfSec(NOW);
  const junk = Array.from({ length: 50 }, () => makeEndorsement(derivePhoneOperatorKey(newSeed()), derivePhoneOperatorKey(newSeed()).pk, day));
  const good = makeEndorsement(endorser, phone.pk, day);
  const accept = (e: { endorserPk: string; phonePk: string }) => e.phonePk === toHex(phone.pk) && e.endorserPk === toHex(endorser.pk);
  const r = recordFirstSeen(emptyState(), { endorsements: [...junk, good] }, { at: NOW, accept });
  assert.equal(r.added, 1);
  assert.deepEqual(Object.keys(r.state.phoneSeen!.endorsements), [good.sig]);
});

