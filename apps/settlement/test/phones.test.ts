// Celular como nó que rende (docs/economia/no-celular.md): caução, avais, teto menor, saída, e as
// correções da revisão independente (avais com data retroativa, griefing de caução, fazenda de um
// operador, teto por caução, limites por arquivo, validade/retirada de aval, reentrada).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady, encodeAddress } from '@polkadot/util-crypto';
import { BOND_REASON, type BondRecord, checkBonds, markBond, refundsDue, regKey, walletSigned } from '../src/bond.js';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, type KeyPair, newSeed } from '../src/protocol/keys.js';
import {
  bondOwnerMessage, dayOfSec, derivePhoneOperatorKey, makeEndorsement, makeEndorsementRevocation, makeOperatorCert, makePhoneExit, makePhoneRegistration, type PhoneRegistrationJson,
} from '../src/protocol/phoneNode.js';
import { ENDORSE_REASON, MAX_SEEN, PHONE_FILE_LIMITS, PHONE_REASON, phoneEligibility, phonePolicyFrom, type PhonePolicy, recordFirstSeen } from '../src/phone-nodes.js';
import { sign } from '../src/protocol/suite.js';
import { makeCertJson, makeRotationJson, MAX_CERTS_PER_FILE, NodeRegistry, type RegistryFile } from '../src/registry.js';
import { lunesToPlanck } from '../src/units.js';
import { closeEpoch, emptyState, epochEnd, epochStart, type ValidatorState } from '../src/validator.js';
import { FakeChain } from './fake-chain.js';
import { buildLedger, delivery, evidence, node, operatorKey, operators, registryFile } from './v2-helpers.js';

const E1 = '2026-S40';
const inE = (h = 12) => epochStart(E1) + h * 3600;
const NOW = epochEnd(E1) + 7 * 86400 + 60;
const BOND_ADDR = encodeAddress(new Uint8Array(32).fill(9), 42);
// Os testes de regra usam caução de 10 e 2 avais (números pequenos); os padrões (100, 3) têm teste próprio.
const POLICY: Partial<PhonePolicy> = { bondAddress: BOND_ADDR, minBondPlanck: lunesToPlanck('10'), minEndorsements: 2 };
const DAY = dayOfSec(inE()) - 5;
const L = (s: string) => lunesToPlanck(s);

let keyring: Keyring;
const ready = cryptoWaitReady().then(() => { keyring = new Keyring({ type: 'sr25519' }); });

interface Phone { seed: Uint8Array; op: KeyPair; wallet: KeyringPair; reg: PhoneRegistrationJson; node: KeyPair; file: RegistryFile }

function regFor(op: KeyPair, wallet: KeyringPair, bond: { txHash: string; block: number }, walletSig?: Uint8Array) {
  return makePhoneRegistration(op, wallet.address, bond, walletSig ?? wallet.sign(bondOwnerMessage(toHex(op.pk), wallet.address, BOND_ADDR)));
}
/** Celular com caução paga na chain simulada; `node` é a chave do dia dos recibos, já certificada. */
function phone(chain: FakeChain, o: { amount?: string; bondAt?: number; to?: string; payer?: KeyringPair; walletSig?: Uint8Array; seed?: Uint8Array } = {}): Phone {
  const seed = o.seed ?? newSeed(), op = derivePhoneOperatorKey(seed);
  const wallet = keyring.addFromSeed(newSeed());
  const bond = chain.addTransfer((o.payer ?? wallet).address, o.to ?? BOND_ADDR, L(o.amount ?? '10'), { at: o.bondAt ?? inE() - 10 * 86400 });
  const reg = regFor(op, wallet, bond, o.walletSig);
  const day = dayOfSec(inE());
  const n = deriveNodeKey(seed, day);
  return { seed, op, wallet, reg, node: n, file: { v: 1, certs: [makeOperatorCert(op, n.pk, day * 86400)], phones: [reg], endorsements: [] } };
}
const endorse = (by: KeyPair, p: Phone, day = DAY) => makeEndorsement(by, p.op.pk, day);

const rootsOf = (files: RegistryFile[]) => NodeRegistry.build([operators], [registryFile, ...files]).operatorRoots();
async function evaluate(files: RegistryFile[], chain: FakeChain | null, o: { state?: ValidatorState; policy?: Partial<PhonePolicy>; now?: number } = {}) {
  return phoneEligibility({ files: [registryFile, ...files], roots: rootsOf(files), chain, state: o.state ?? emptyState(), now: o.now ?? NOW, epoch: E1, policy: { ...POLICY, ...o.policy } });
}
type Ev = Awaited<ReturnType<typeof evaluate>>;
const repOf = (r: Ev, p: Phone | KeyPair) => r.report.find(x => x.operator === toHex('op' in p ? p.op.pk : p.pk))!;

/** Recibo do celular numa entrega comprovada: estado do recibo dele no livro. */
function credited(r: Ev, files: RegistryFile[], p: Phone, at = inE()) { // recibo da chave do dia de `inE()`
  const reg = NodeRegistry.build([operators], [registryFile, ...files], r.eligible);
  const d = delivery([p.node], at);
  const e = [...buildLedger([evidence([d])], [], NOW, reg).entries()].find(x => toHex(x.receipt.nodePk) === toHex(p.node.pk))!;
  return [e.state, e.reason ?? ''];
}
/** Celular habilitado por dois operadores admitidos. */
function seeded(chain: FakeChain, a = operatorKey(), b = operatorKey()) {
  const p = phone(chain);
  p.file.endorsements = [endorse(a, p), endorse(b, p)];
  return p;
}

test('chave e certificado do celular: o mesmo OPERATOR_CERT do piu-node (assinatura idêntica)', async t => {
  const op = derivePhoneOperatorKey(newSeed()), n = deriveNodeKey(newSeed(), 20400);
  const c = makeOperatorCert(op, n.pk, 20400 * 86400);
  assert.deepEqual(c, makeCertJson(op, n.pk, 20400 * 86400));
  let pn: typeof import('../../piu-node/src/relay/operator-frames.js');
  try { pn = await import('../../piu-node/src/relay/operator-frames.js'); } catch { t.skip('apps/piu-node não está presente'); return; }
  assert.deepEqual(pn.certToJson(pn.makeCert(op, n.pk, 20400 * 86400)), c);
  assert.ok(pn.verifyCert(pn.certFromJson(c)));
});

test('carteira: assinatura sr25519 feita pelo app (walletKey.ts) confere no validador', async () => {
  // Vetor gerado com apps/mobile/src/lib/walletKey.ts (frase dev pública do Substrate, `random` fixo).
  const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  const r = {
    v: 1, class: 'phone', operatorPk: '11'.repeat(32), wallet: '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse', bond: { txHash: '0x' + 'ab'.repeat(32), block: 1234 },
    walletSig: '2820712af87f4364e23e7c986678ab05ae5d612a72c4f758e80ad391dc1fb84e5b0c52d88de133880aec6392da935172830ee37b16135df4d902aff044580687', sig: '00'.repeat(64),
  } as const satisfies PhoneRegistrationJson;
  assert.ok(await walletSigned(r, ALICE));
  assert.equal(await walletSigned(r, BOND_ADDR), false, 'vale só para aquele endereço de caução');
});

test('habilitado: caução + 7 dias + 2 avais de raízes diferentes → rende; teto do celular e teto pela caução', async () => {
  await ready;
  const chain = new FakeChain();
  const p = seeded(chain);
  const r = await evaluate([p.file], chain);
  const rep = repOf(r, p);
  assert.equal(rep.eligible, true, rep.reason);
  assert.equal(rep.endorsements.counted, 2);
  assert.equal(rep.roots, 2);
  assert.deepEqual(credited(r, [p.file], p), ['validado', '']);
  const b = r.state.bonds!;
  assert.equal(b.length, 1);
  assert.equal(b[0]!.state, 'ativa');
  assert.equal(b[0]!.roots!.length, 2, 'linhagem gravada');
  assert.equal(Object.keys(r.state.phoneSeen!.endorsements).length, 2, 'avais vistos gravados');

  // Teto: celular e um nó de piu-node com muitas entregas. Orçamento 100: teto do nó 2, do celular
  // min(metade = 1, 25% da caução = 2,5) = 1. Orçamento 10000: nó 200, celular min(100, 2,5) = 2,5.
  const big = node();
  const reg = NodeRegistry.build([operators], [registryFile, p.file], r.eligible);
  const ds = Array.from({ length: 30 }, (_, i) => delivery([p.node], inE(12 + (i % 6))));
  const db = Array.from({ length: 30 }, () => delivery([big], inE()));
  const ledger = buildLedger([evidence([...ds, ...db])], [], NOW, reg);
  const acc = (out: ReturnType<typeof closeEpoch>, k: KeyPair) => out.state.accruals.find(x => x.node === toHex(k.pk))!.planck;
  const small = closeEpoch({ epoch: E1, budget: L('100'), now: NOW, state: emptyState(), ledger, claims: [], phones: r.report });
  assert.equal(acc(small, p.node), L('1').toString());
  assert.equal(acc(small, big), L('2').toString());
  assert.equal(small.report.phoneCap, '1');
  assert.ok(small.report.phones?.some(x => x.eligible));
  const large = closeEpoch({ epoch: E1, budget: L('10000'), now: NOW, state: emptyState(), ledger, claims: [] });
  assert.equal(acc(large, p.node), L('2.5').toString(), 'no máximo um quarto da caução por época');
  assert.equal(acc(large, big), L('200').toString());
  assert.deepEqual(large.report.phoneCaps, [{ operator: toHex(p.op.pk).slice(0, 16), cap: '2.5', bond: '10' }]);
  const tenth = closeEpoch({ epoch: E1, budget: L('10000'), now: NOW, state: emptyState(), ledger, claims: [], params: { phoneMaxPayoutBondRatio: 0.1 } });
  assert.equal(acc(tenth, p.node), L('1').toString(), 'razão configurável');
  assert.equal(ledger.walletOf(toHex(p.node.pk)), p.wallet.address);
});

test('sem caução, caução devolvida ou confiscada, caução errada → não rende', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const withE = (p: Phone) => { p.file.endorsements = [endorse(a, p), endorse(b, p)]; return p; };
  const ghost = withE(phone(chain));
  chain.transfers.delete(ghost.reg.bond.txHash);
  const low = withE(phone(chain, { amount: '9.99' }));
  const elsewhere = withE(phone(chain, { to: encodeAddress(new Uint8Array(32).fill(3), 42) }));
  const otherPayer = withE(phone(chain, { payer: keyring.addFromSeed(newSeed()) }));
  const badSig = withE(phone(chain, { walletSig: new Uint8Array(64) }));
  const refunded = withE(phone(chain)), slashed = withE(phone(chain));
  const all = [ghost, low, elsewhere, otherPayer, badSig, refunded, slashed];
  const first = await evaluate(all.map(p => p.file), chain);
  let records = markBond(first.state.bonds!, toHex(refunded.op.pk), 'devolvida', 'pedido de saída', NOW);
  assert.throws(() => markBond(records, toHex(slashed.op.pk), 'confiscada', '', NOW), /motivo/);
  records = markBond(records, toHex(slashed.op.pk), 'confiscada', 'fraude comprovada', NOW);
  const r = await evaluate(all.map(p => p.file), chain, { state: { ...first.state, bonds: records } });
  const why = (p: Phone) => repOf(r, p).reason;
  assert.equal(why(ghost), BOND_REASON.notFound);
  assert.equal(why(low), BOND_REASON.amount);
  assert.equal(why(elsewhere), BOND_REASON.to);
  assert.equal(why(otherPayer), BOND_REASON.from);
  assert.equal(why(badSig), BOND_REASON.walletSig);
  assert.equal(why(refunded), BOND_REASON.refunded);
  assert.equal(why(slashed), BOND_REASON.slashed);
  for (const p of all) assert.deepEqual(credited(r, all.map(x => x.file), p), ['rejeitado', 'nó não registrado']);
  const off = await evaluate([refunded.file], null, { policy: { bondAddress: null } });
  assert.equal(repOf(off, refunded).reason, BOND_REASON.noAddress);
});

test('revisão 2: copiar o hash da caução de alguém com assinatura falsa não derruba a vítima; a dona assinar duas chaves derruba as duas', async () => {
  await ready;
  const chain = new FakeChain();
  const victim = seeded(chain);
  const thief = derivePhoneOperatorKey(newSeed());
  const fake = makePhoneRegistration(thief, victim.wallet.address, victim.reg.bond, new Uint8Array(64).fill(5));
  const r = await evaluate([victim.file, { v: 1, phones: [fake], endorsements: [] }], chain);
  assert.equal(repOf(r, victim).eligible, true, repOf(r, victim).reason);
  assert.equal(repOf(r, thief).reason, BOND_REASON.walletSig);
  // A própria dona da carteira assina a mesma caução para outra chave: as duas ficam fora.
  const op2 = derivePhoneOperatorKey(newSeed());
  const twice = regFor(op2, victim.wallet, victim.reg.bond);
  const r2 = await evaluate([victim.file, { v: 1, phones: [twice], endorsements: [] }], chain);
  assert.equal(repOf(r2, victim).reason, BOND_REASON.reused);
  assert.equal(repOf(r2, op2).reason, BOND_REASON.reused);
  // Caução já gravada para um celular não serve depois para outro.
  const r3 = await evaluate([{ v: 1, phones: [twice], endorsements: [] }], chain, { state: r.state });
  assert.equal(repOf(r3, op2).reason, BOND_REASON.reused);
});

test('menos de 7 dias de caução ou menos de 2 avais → não rende', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const young = phone(chain, { bondAt: NOW - 6 * 86400 });
  young.file.endorsements = [endorse(a, young), endorse(b, young)];
  const one = phone(chain);
  one.file.endorsements = [endorse(a, one)];
  const r = await evaluate([young.file, one.file], chain);
  assert.equal(repOf(r, young).reason, PHONE_REASON.young);
  assert.equal(repOf(r, one).reason, `${PHONE_REASON.endorsements} (1 de 2)`);
  assert.deepEqual(credited(r, [young.file, one.file], one), ['rejeitado', 'nó não registrado']);
});

test('revisão 1: data do aval é a do "visto" pelo validador; retroativo fora da janela é recusado; visto não muda depois', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const p = phone(chain);
  const lo = dayOfSec(epochStart(E1)) - 7;
  p.file.endorsements = [endorse(a, p, lo - 3), endorse(b, p)];
  const r = await evaluate([p.file], chain);
  assert.equal(repOf(r, p).reason, `${PHONE_REASON.endorsements} (1 de 2)`, 'o retroativo nem entra');
  assert.deepEqual(repOf(r, p).endorsements.ignored.map(x => x.reason), [ENDORSE_REASON.window], 'e aparece no relatório');
  // Ingestão direta (caixa de entrada): mesmo aval, recusado com motivo; o aceito fica com o visto gravado.
  const x = recordFirstSeen(emptyState(), { endorsements: [endorse(a, p, lo - 3), endorse(b, p)] }, { at: NOW, epoch: E1 });
  assert.deepEqual(x.rejected.map(y => y.reason), [ENDORSE_REASON.window]);
  assert.equal(x.added, 1);
  const sig = endorse(b, p).sig;
  assert.equal(x.state.phoneSeen!.endorsements[sig]!.seen, DAY * 86400);
  const again = recordFirstSeen(x.state, { endorsements: [endorse(b, p)] }, { at: NOW + 999_999 });
  assert.equal(again.added, 0);
  assert.equal(again.state.phoneSeen!.endorsements[sig]!.seen, DAY * 86400, 'o primeiro visto fica');
  // Aval no futuro (dia depois de agora) também fica fora.
  assert.equal(recordFirstSeen(emptyState(), { endorsements: [endorse(b, p, dayOfSec(NOW) + 1)] }, { at: NOW }).rejected.length, 1);
  // Sem época (caixa de entrada em tempo real): a janela é de `at` − 7 dias.
  assert.equal(recordFirstSeen(emptyState(), { endorsements: [endorse(b, p, dayOfSec(NOW) - 8)] }, { at: NOW }).rejected.length, 1);
  assert.equal(recordFirstSeen(emptyState(), { endorsements: [endorse(b, p, dayOfSec(NOW) - 6)] }, { at: NOW }).added, 1);
});

test('avais que não contam: repetido, avalista não habilitado, acima do limite mensal', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const loner = derivePhoneOperatorKey(newSeed());
  const p = phone(chain);
  p.file.endorsements = [endorse(a, p, DAY), endorse(a, p, DAY - 1), endorse(loner, p)];
  const rep = repOf(await evaluate([p.file], chain), p);
  assert.equal(rep.eligible, false);
  assert.equal(rep.endorsements.counted, 1, 'o avalista repetido conta uma vez');
  assert.deepEqual(rep.endorsements.ignored.map(x => x.reason).sort(), [ENDORSE_REASON.ineligible, ENDORSE_REASON.repeated].sort());

  // Limite mensal: `b` avaliza 5 celulares antes no mês; o 6º não conta para ele.
  const others = Array.from({ length: 5 }, () => phone(chain));
  const c = operatorKey();
  for (const o of others) o.file.endorsements = [makeEndorsement(b, o.op.pk, DAY - 2), makeEndorsement(c, o.op.pk, DAY - 2)];
  const q = phone(chain);
  q.file.endorsements = [endorse(b, q, DAY), endorse(a, q, DAY)];
  const r2 = await evaluate([...others.map(o => o.file), q.file], chain);
  assert.ok(others.every(o => repOf(r2, o).eligible));
  assert.deepEqual(repOf(r2, q).endorsements.ignored.map(x => x.reason), [ENDORSE_REASON.monthly]);
});

test('revisão 3a: chaves rotacionadas do mesmo operador contam como UM avalista, com UMA cota mensal', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey();
  const a2 = derivePhoneOperatorKey(newSeed()); // só como par Ed25519 novo
  const rot: RegistryFile = { v: 1, certs: [{ ...makeCertJson(a2, deriveNodeKey(newSeed()).pk, 2000), chain: [makeRotationJson(a, a2.pk, 1000)] }] };
  const p = phone(chain);
  p.file.endorsements = [endorse(a, p), endorse(a2, p)];
  const r = await evaluate([rot, p.file], chain);
  assert.equal(repOf(r, p).endorsements.counted, 1);
  assert.equal(repOf(r, p).eligible, false);
  // A cota mensal é da raiz: 3 com a chave antiga + 3 com a nova = só 5 contam.
  const b = operatorKey(), c = operatorKey();
  const ps = Array.from({ length: 6 }, () => phone(chain));
  ps.forEach((x, i) => { x.file.endorsements = [makeEndorsement(i < 3 ? a : a2, x.op.pk, DAY - (i < 3 ? 1 : 0)), makeEndorsement(i < 3 ? b : c, x.op.pk, DAY)]; });
  const r2 = await evaluate([rot, ...ps.map(x => x.file)], chain, { policy: { maxEndorsementsPerMonth: 5 } });
  assert.equal(ps.filter(x => repOf(r2, x).eligible).length, 5);
});

test('revisão 3b/3c: fazenda de um operador corrupto: raízes na linhagem e teto mensal por raiz', async () => {
  await ready;
  const chain = new FakeChain();
  const bad = operatorKey(), honest = operatorKey();
  // O corrupto tem o próprio celular, avalizado por ele e por um honesto (2 raízes).
  const own = seeded(chain, bad, honest);
  // Celulares só com avais do corrupto e do celular dele: raízes {bad, honest} herdadas.
  const later = DAY + 3; // depois de `own` habilitar
  const farm = Array.from({ length: 4 }, () => phone(chain));
  for (const f of farm) f.file.endorsements = [makeEndorsement(bad, f.op.pk, later), makeEndorsement(own.op, f.op.pk, later)];
  const r = await evaluate([own.file, ...farm.map(f => f.file)], chain, { policy: { maxEnabledPerRootPerMonth: 3, maxEndorsementsPerMonth: 10 } });
  assert.ok(repOf(r, own).eligible);
  const ok = farm.filter(f => repOf(r, f).eligible).length;
  assert.equal(ok, 2, 'a raiz habilita no máximo 3 por mês (o próprio celular + 2)');
  assert.ok(farm.some(f => repOf(r, f).reason === PHONE_REASON.rootCap));
  // Sem o honesto na linhagem, só uma raiz: não entra (minRoots 2).
  const solo = phone(chain);
  const c2 = derivePhoneOperatorKey(newSeed());
  solo.file.endorsements = [endorse(bad, solo), endorse(c2, solo)];
  const r2 = await evaluate([solo.file], chain);
  assert.equal(repOf(r2, solo).eligible, false);
  // minRoots configurável: 3 raízes exigidas, só 2 disponíveis.
  const r3 = await evaluate([seeded(chain).file], chain, { policy: { minRoots: 3 } });
  assert.ok(r3.report.some(x => x.reason === PHONE_REASON.roots));
  // A habilitação fica gravada (com as raízes) e conta no mês mesmo em closes seguintes.
  const r4 = await evaluate([own.file, ...farm.map(f => f.file)], chain, { state: r.state, policy: { maxEnabledPerRootPerMonth: 3, maxEndorsementsPerMonth: 10 } });
  assert.equal(farm.filter(f => repOf(r4, f).eligible).length, 2, 'estável entre closes');
});

test('revisão 3d: celulares confiscados contam contra as raízes da linhagem; raiz suspensa não avaliza', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const slashed: BondRecord[] = Array.from({ length: 3 }, (_, i) => ({ operatorPk: String(i).repeat(64), wallet: 'x', txHash: '0x' + String(i).repeat(64), block: 1, amount: '1', at: 0, state: 'confiscada', roots: [toHex(a.pk), toHex(b.pk)].slice(0, i === 2 ? 2 : 1) }));
  const p = seeded(chain, a, b);
  const r = await evaluate([p.file], chain, { state: { ...emptyState(), bonds: slashed } });
  assert.deepEqual(r.suspendedRoots, [toHex(a.pk)]);
  assert.equal(repOf(r, p).eligible, false);
  assert.ok(repOf(r, p).endorsements.ignored.some(x => x.reason === ENDORSE_REASON.suspended));
  const r2 = await evaluate([p.file], chain, { state: { ...emptyState(), bonds: slashed }, policy: { rootSuspendAfterSlashes: 4 } });
  assert.ok(repOf(r2, p).eligible, 'limiar configurável');
});

test('revisão 8 + anel: avalista celular só conta se estava habilitado no dia do aval; anel sem semente não entra', async () => {
  await ready;
  const chain = new FakeChain();
  const ring = Array.from({ length: 4 }, () => phone(chain));
  const late = DAY + 3; // ring[0..1] habilitam em inE − 3 d; DAY + 3 vem depois
  for (const p of ring) p.file.endorsements = ring.filter(x => x !== p).map(x => endorse(x.op, p, late));
  const r = await evaluate(ring.map(p => p.file), chain);
  assert.ok(ring.every(p => !repOf(r, p).eligible && repOf(r, p).reason === `${PHONE_REASON.endorsements} (0 de 2)`));
  const a = operatorKey(), b = operatorKey();
  for (const p of ring.slice(0, 2)) p.file.endorsements!.push(endorse(a, p), endorse(b, p));
  const r2 = await evaluate(ring.map(p => p.file), chain);
  assert.ok(ring.every(p => repOf(r2, p).eligible), 'a confiança se espalha pelo ponto fixo');
  // Aval dado ANTES de o avalista ser habilitado não conta.
  const early = phone(chain);
  early.file.endorsements = [endorse(ring[0]!.op, early, DAY - 1), endorse(ring[1]!.op, early, DAY - 1)];
  const r3 = await evaluate([...ring.map(p => p.file), early.file], chain);
  assert.equal(repOf(r3, early).eligible, false);
  assert.ok(repOf(r3, early).endorsements.ignored.every(x => x.reason === ENDORSE_REASON.ineligible));
});

test('revisão 6: aval vence (validade configurável) e pode ser retirado; a retirada vale de quando foi vista', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const p = seeded(chain, a, b);
  const short = await evaluate([p.file], chain, { policy: { endorsementValidityDays: 1 } });
  assert.equal(repOf(short, p).eligible, false, 'avais de 1 dia já venceram antes da idade mínima');
  // Retirada vista (caixa de entrada) um dia antes do recibo: a habilitação acaba ali.
  const rev = makeEndorsementRevocation(a, p.op.pk, 1);
  const seen = recordFirstSeen(emptyState(), { endorsements: p.file.endorsements, endorsementRevocations: [rev] }, { at: inE() - 86400, epoch: E1 }).state;
  assert.equal(seen.phoneSeen!.revocations[rev.sig]!.seen, inE() - 86400, 'vale do visto, não do `at` assinado');
  const r = await evaluate([p.file], chain, { state: seen });
  assert.equal(repOf(r, p).eligible, true);
  assert.equal(repOf(r, p).until, inE() - 86400);
  assert.deepEqual(credited(r, [p.file], p), ['rejeitado', 'celular fora da habilitação (saída ou avais vencidos)']);
});

test('revisão 7: saída amarrada à caução; volta com caução nova; registro de caução ativa vence o conflito', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const p = seeded(chain, a, b);
  p.file.exits = [makePhoneExit(p.op, p.reg.bond.txHash, inE() - 3600)];
  const r = await evaluate([p.file], chain);
  assert.ok(repOf(r, p).eligible);
  assert.equal(r.state.bonds![0]!.exitAt, inE() - 3600);
  assert.deepEqual(credited(r, [p.file], p), ['rejeitado', 'celular fora da habilitação (saída ou avais vencidos)']);
  // Caução nova (mesma chave): a saída antiga não vale para ela.
  const bond2 = chain.addTransfer(p.wallet.address, BOND_ADDR, L('10'), { at: inE() - 9 * 86400 });
  const reg2 = regFor(p.op, p.wallet, bond2);
  const back = { ...p.file, phones: [p.reg, reg2] };
  const r2 = await evaluate([back], chain);
  assert.ok(repOf(r2, p).eligible);
  assert.deepEqual(credited(r2, [back], p), ['validado', '']);
  // Dois registros da mesma chave: um com caução inexistente, outro ativo → vale o ativo.
  const q = seeded(chain, a, b);
  const ghost = regFor(q.op, q.wallet, { txHash: '0x' + 'ee'.repeat(32), block: 99999 });
  const r3 = await evaluate([{ ...q.file, phones: [ghost, q.reg] }], chain);
  assert.ok(repOf(r3, q).eligible, repOf(r3, q).reason);
});

test('revisão 5: limites por arquivo e repetidos pela assinatura antes de conferir', async () => {
  await ready;
  const chain = new FakeChain();
  const p = phone(chain);
  const many = Array.from({ length: PHONE_FILE_LIMITS.endorsements + 100 }, () => makeEndorsement(derivePhoneOperatorKey(newSeed()), p.op.pk, DAY));
  const x = recordFirstSeen(emptyState(), { endorsements: [...many, ...many] }, { at: NOW, epoch: E1 });
  assert.equal(x.added, PHONE_FILE_LIMITS.endorsements);
  assert.ok(MAX_SEEN >= 10_000);
  // Certificados: no máximo MAX_CERTS_PER_FILE por arquivo.
  const op = operatorKey();
  const nodes = Array.from({ length: MAX_CERTS_PER_FILE + 5 }, () => deriveNodeKey(newSeed()));
  const reg = NodeRegistry.build([operators], [{ v: 1, certs: nodes.map(n => makeCertJson(op, n.pk, 0)) }]);
  assert.equal(reg.stats.certs, MAX_CERTS_PER_FILE);
  assert.equal(reg.operatorOf(toHex(nodes.at(-1)!.pk), 10), null);
  const dup = makeCertJson(op, nodes[0]!.pk, 0);
  assert.equal(NodeRegistry.build([operators], [{ v: 1, certs: [dup, dup, dup] }]).stats.certs, 1, 'repetido não é conferido de novo');
});

test('operador de piu-node e celulares antigos não mudam; operador admitido com registro de celular segue classe node', async () => {
  await ready;
  const chain = new FakeChain();
  const old = deriveNodeKey(newSeed(), dayOfSec(inE()));
  const n = node();
  const r = await evaluate([], chain);
  const reg = NodeRegistry.build([operators], [registryFile], r.eligible);
  const d = delivery([n, old], inE());
  const st = [...buildLedger([evidence([d])], [], NOW, reg).entries()].map(e => [toHex(e.receipt.nodePk) === toHex(n.pk) ? 'piu-node' : 'antigo', e.state, e.reason ?? '']).sort();
  assert.deepEqual(st, [['antigo', 'rejeitado', 'nó não registrado'], ['piu-node', 'validado', '']]);
  const op = operatorKey();
  const p = phone(chain);
  const fake = regFor(op, p.wallet, p.reg.bond);
  const r2 = await evaluate([{ v: 1, phones: [fake] }], chain);
  assert.equal(repOf(r2, op).reason, PHONE_REASON.admitted);
  assert.equal(NodeRegistry.build([operators], [registryFile], r2.eligible).classOf(toHex(op.pk)), 'node');
});

test('padrões do produto: caução de 100 LUNES e 3 avais de raízes diferentes', async () => {
  await ready;
  const chain = new FakeChain();
  const def = { bondAddress: BOND_ADDR, minBondPlanck: undefined, minEndorsements: undefined } as unknown as Partial<PhonePolicy>;
  const strip = (p: Partial<PhonePolicy>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<PhonePolicy>;
  const a = operatorKey(), b = operatorKey(), c = operatorKey();
  const ten = phone(chain);
  ten.file.endorsements = [endorse(a, ten), endorse(b, ten), endorse(c, ten)];
  const hundred = phone(chain, { amount: '100' });
  hundred.file.endorsements = [endorse(a, hundred), endorse(b, hundred)];
  const ok = phone(chain, { amount: '100' });
  ok.file.endorsements = [endorse(a, ok), endorse(b, ok), endorse(c, ok)];
  const r = await phoneEligibility({ files: [registryFile, ten.file, hundred.file, ok.file], roots: rootsOf([]), chain, state: emptyState(), now: NOW, epoch: E1, policy: strip(def) });
  assert.equal(repOf(r, ten).reason, BOND_REASON.amount, '10 LUNES não bastam');
  assert.equal(repOf(r, hundred).reason, `${PHONE_REASON.endorsements} (2 de 3)`);
  assert.ok(repOf(r, ok).eligible, repOf(r, ok).reason);
  // Teto pela caução: 100 × 0,25 = 25 LUNES por época.
  const reg = NodeRegistry.build([operators], [registryFile, ok.file], r.eligible);
  const ds = Array.from({ length: 40 }, () => delivery([ok.node], inE()));
  const out = closeEpoch({ epoch: E1, budget: L('10000'), now: NOW, state: emptyState(), ledger: buildLedger([evidence(ds)], [], NOW, reg), claims: [] });
  assert.equal(out.state.accruals.find(x => x.node === toHex(ok.node.pk))!.planck, L('25').toString());
});

test('aval de celular sem afirmar verificação pessoal não conta; de operador de piu-node, conta', async () => {
  await ready;
  const chain = new FakeChain();
  const a = operatorKey(), b = operatorKey();
  const q = seeded(chain, a, b);
  const late = DAY + 3;
  const p = phone(chain);
  p.file.endorsements = [makeEndorsement(q.op, p.op.pk, late, { inPerson: false }), makeEndorsement(a, p.op.pk, late, { inPerson: false })];
  const r = await evaluate([q.file, p.file], chain);
  assert.ok(repOf(r, q).eligible);
  assert.equal(repOf(r, p).endorsements.counted, 1, 'só o do operador admitido');
  assert.ok(repOf(r, p).endorsements.ignored.some(x => x.reason === ENDORSE_REASON.notInPerson));
});

test('saída: devolução devida 7 dias depois; "voltar a ser nó" cancela; `refundsDue` lista as vencidas', async () => {
  await ready;
  const chain = new FakeChain();
  const p = seeded(chain);
  const out = inE() - 3600;
  p.file.exits = [makePhoneExit(p.op, p.reg.bond.txHash, out)];
  const r = await evaluate([p.file], chain);
  const b = r.state.bonds![0]!;
  assert.equal(b.exitAt, out);
  assert.equal(b.refundDueAt, out + 7 * 86400);
  assert.deepEqual(refundsDue(r.state.bonds!, out + 7 * 86400 - 1), []);
  assert.equal(refundsDue(r.state.bonds!, out + 7 * 86400).length, 1);
  // Voltar a ser nó (evento mais novo): sem saída, sem devolução, e o recibo volta a render.
  p.file.exits.push(makePhoneExit(p.op, p.reg.bond.txHash, out + 600, 'cancel'));
  const r2 = await evaluate([p.file], chain, { state: r.state });
  assert.equal(r2.state.bonds![0]!.exitAt, undefined);
  assert.equal(r2.state.bonds![0]!.refundDueAt, undefined);
  assert.deepEqual(credited(r2, [p.file], p), ['validado', '']);
  // Sai de novo depois: o prazo recomeça da nova saída.
  p.file.exits.push(makePhoneExit(p.op, p.reg.bond.txHash, out + 1200));
  const r3 = await evaluate([p.file], chain, { state: r2.state });
  assert.equal(r3.state.bonds![0]!.refundDueAt, out + 1200 + 7 * 86400);
});

test('checkBonds sem chain: motivo claro; config.json dos celulares', async () => {
  await ready;
  const chain = new FakeChain();
  const p = phone(chain);
  const m = await checkBonds([p.reg], null, { bondAddress: BOND_ADDR, minBondPlanck: L('10') });
  assert.deepEqual(m.get(regKey(p.reg)), { ok: false, reason: BOND_REASON.chain });
  const cfg = phonePolicyFrom({ phone: { bondAddress: ' 5abc ', minBondLunes: '25', capFraction: 3, maxPayoutBondRatio: 0.1, maxEnabledPerRootPerMonth: 4 } });
  assert.equal(cfg.bondAddress, '5abc');
  assert.equal(cfg.minBondPlanck, L('25'));
  assert.equal(cfg.capFraction, 1, 'fração no máximo 1');
  assert.equal(cfg.maxPayoutBondRatio, 0.1);
  assert.equal(cfg.maxEnabledPerRootPerMonth, 4);
  const d = phonePolicyFrom(null);
  assert.deepEqual([d.bondAddress, d.minBondPlanck, d.minEndorsements, d.minRoots, d.endorsementValidityDays, d.maxPayoutBondRatio, d.refundDelayDays], [null, L('100'), 3, 2, 90, 0.25, 7]);
  void sign;
});
