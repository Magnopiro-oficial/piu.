/// <reference types="node" />
/**
 * Gateway (lib/carryGateway.ts): envio idempotente, recusas da Lunes, tetos contra abuso, sem rota,
 * recibos a cada mudança e o pacote para a caixa do validador.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BundleKind, CarryChain, CarryKind, type CarryReceipt, openCarry, sealBundle, sealCarry } from '../../protocol/carry';
import { deriveIdentity, newSeed, type PublicIdentity } from '../../protocol/keys';
import { validatorProofKey } from '../../protocol/proof';
import { random } from '../../protocol/suite';
import { CarryGateway, type GatewayLimits } from '../carryGateway';
import { toHex } from '../lunesRpc';
import { fakeLunes, PAYMENT, signedCarried, STALE } from './carryFake';

const NOW = 1_800_000_000;
function setup(o: { limits?: Partial<GatewayLimits>; post?: ((b: Uint8Array) => Promise<{ ok: boolean; error?: string }>) | null } = {}) {
  const chain = fakeLunes();
  let now = NOW;
  const replies: { to: PublicIdentity; rc: CarryReceipt }[] = [];
  const gw = new CarryGateway({ rpc: chain.rpc, now: () => now, reply: (to, rc) => replies.push({ to, rc }), postBundle: o.post === undefined ? null : o.post }, o.limits);
  return { chain, gw, replies, advance: (s: number) => { now += s; }, now: () => now };
}
const carryTx = (xt: Uint8Array, now = NOW) => openCarry(sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt }, now }).bytes, now)!;

test('envia uma vez, responde no pool, em bloco e finalizada (com o mesmo hash)', async () => {
  const s = setup();
  const t = signedCarried();
  const c = carryTx(t.extrinsic);
  assert.equal(await s.gw.handle(c), 'submitted');
  assert.equal(s.chain.submissions.length, 1);
  assert.deepEqual(s.replies.map(r => r.rc.status), ['pool']);
  assert.equal(toHex(s.replies[0]!.rc.ref), t.hash);
  assert.deepEqual(s.replies[0]!.to.agreePk, c.replyTo.agreePk);
  s.chain.mine(1, false);
  await s.gw.tick();
  assert.deepEqual(s.replies.map(r => r.rc.status), ['pool', 'included']);
  assert.equal(s.replies[1]!.rc.block!.number, 1001);
  s.chain.mine(1, true);
  await s.gw.tick();
  assert.deepEqual(s.replies.map(r => r.rc.status), ['pool', 'included', 'finalized']);
  assert.equal(s.gw.trackedCount, 0);
});

test('idempotente: a mesma transação por outro caminho não reenvia e a nova cópia recebe o estado', async () => {
  const s = setup();
  const t = signedCarried();
  await s.gw.handle(carryTx(t.extrinsic));
  const other = carryTx(t.extrinsic);
  assert.equal(await s.gw.handle(other), 'duplicate');
  assert.equal(s.chain.submissions.length, 1);
  assert.deepEqual(s.replies.at(-1)!.to.agreePk, other.replyTo.agreePk);
  assert.equal(s.replies.at(-1)!.rc.status, 'pool');
  // O nó já tem os bytes (outro gateway enviou antes): conta como aceito, não como erro.
  const s2 = setup();
  s2.chain.state.submitError = 'Transaction Already Imported';
  assert.equal(await s2.gw.handle(carryTx(t.extrinsic)), 'submitted');
  assert.equal(s2.replies[0]!.rc.status, 'pool');
});

test('recusa da Lunes vira recibo "invalid" com o motivo; Stale (nonce usado) também', async () => {
  const s = setup();
  s.chain.state.validity = PAYMENT;
  assert.equal(await s.gw.handle(carryTx(signedCarried().extrinsic)), 'invalid');
  assert.equal(s.chain.submissions.length, 0, 'não envia o que a Lunes recusou');
  assert.deepEqual([s.replies[0]!.rc.status, s.replies[0]!.rc.reason], ['invalid', 'Payment']);
  s.chain.state.validity = STALE;
  assert.equal(await s.gw.handle(carryTx(signedCarried(8).extrinsic)), 'invalid');
  assert.equal(s.replies.at(-1)!.rc.reason, 'Stale');
  // Recusa antiga (1 h) pode mudar (saldo chegou): uma cópia nova tenta de novo.
  s.chain.state.validity = '0x00' + '0000000000000000' + '00' + '00' + '4000000000000000' + '01';
  assert.equal(await s.gw.handle(carryTx(signedCarried().extrinsic)), 'duplicate');
  s.advance(3601);
  assert.equal(await s.gw.handle(carryTx(signedCarried().extrinsic, s.now())), 'submitted');
});

test('só transferência assinada entra; lixo não gasta consulta', async () => {
  const s = setup();
  assert.equal(await s.gw.handle(carryTx(random(140))), 'rejected');
  assert.equal(s.replies.length, 0);
  assert.equal(s.gw.counters.rejected, 1);
});

test('sem internet: guarda e tenta de novo com espera crescente; depois desiste com recibo "error"', async () => {
  const s = setup({ limits: { maxAttempts: 2 } });
  s.chain.state.offline = true;
  assert.equal(await s.gw.handle(carryTx(signedCarried().extrinsic)), 'queued');
  assert.equal(s.replies.length, 0, 'enquanto tenta, nada a dizer');
  s.chain.state.offline = false;
  await s.gw.tick();
  assert.equal(s.chain.submissions.length, 0, 'espera antes de tentar de novo');
  s.advance(31);
  await s.gw.tick();
  assert.equal(s.chain.submissions.length, 1);
  assert.equal(s.replies[0]!.rc.status, 'pool');
  const g = setup({ limits: { maxAttempts: 2 } });
  g.chain.state.offline = true;
  await g.gw.handle(carryTx(signedCarried().extrinsic));
  g.advance(31); await g.gw.tick();
  assert.equal(g.replies[0]!.rc.status, 'error');
});

test('tetos: envios por minuto e fila curta', async () => {
  const s = setup({ limits: { submitsPerMinute: 2, maxQueued: 1 } });
  const r = [];
  for (let n = 0; n < 4; n++) r.push(await s.gw.handle(carryTx(signedCarried(7 + n).extrinsic)));
  assert.deepEqual(r, ['submitted', 'submitted', 'queued', 'full']);
  s.advance(61);
  await s.gw.tick();
  assert.equal(s.chain.submissions.length, 3);
});

test('pacote para o validador: só com caixa configurada; aceito vira recibo "accepted"', async () => {
  const v = validatorProofKey(random(32));
  const sealed = sealBundle(BundleKind.Evidence, '{"v":2,"receipts":[],"proofs":[],"sealedProofs":[]}', v.pk);
  const c = openCarry(sealCarry({ item: { kind: CarryKind.Evidence, sealed }, now: NOW }).bytes, NOW)!;
  assert.equal(await setup().gw.handle(c), 'no-inbox');
  const posted: Uint8Array[] = [];
  let ok = false;
  const s = setup({ post: async b => { posted.push(b); return ok ? { ok: true } : { ok: false, error: 'HTTP 503' }; } });
  assert.equal(await s.gw.handle(c), 'queued');
  ok = true;
  s.advance(31); await s.gw.tick();
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[1], sealed, 'entrega os bytes selados como chegaram');
  assert.deepEqual([s.replies[0]!.rc.about, s.replies[0]!.rc.status], [CarryKind.Evidence, 'accepted']);
  assert.equal(await s.gw.handle(c), 'duplicate', 'mesmo pacote: não posta de novo');
  assert.equal(posted.length, 2);
});

test('M-N1: cota de envio só para o que passou na validação (lixo bem formado não trava o gateway)', async () => {
  const s = setup({ limits: { submitsPerMinute: 2 } });
  s.chain.state.validity = PAYMENT;
  // Transferências bem formadas que a Lunes recusa (sem saldo, assinatura ruim…): mais que a cota de envio.
  for (let n = 0; n < 5; n++) assert.equal(await s.gw.handle(carryTx(signedCarried(20 + n).extrinsic)), 'invalid');
  assert.equal(s.chain.submissions.length, 0);
  s.chain.state.validity = '0x00' + '0000000000000000' + '00' + '00' + '4000000000000000' + '01';
  const r = [];
  for (let n = 0; n < 3; n++) r.push(await s.gw.handle(carryTx(signedCarried(7 + n).extrinsic)));
  assert.deepEqual(r, ['submitted', 'submitted', 'queued'], 'a cota de envio só conta as que vão para a Mainnet');
  assert.equal(s.chain.submissions.length, 2);
  // A que esperou cota não é tentativa falha: sai na próxima janela, sem recibo "error" no meio.
  s.advance(61); await s.gw.tick();
  assert.equal(s.chain.submissions.length, 3);
  assert.ok(!s.replies.some(x => x.rc.status === 'error'));
});

test('M-N1: validação tem teto próprio; repetida (mesmo hash) não gasta consulta nem cota', async () => {
  const s = setup({ limits: { validationsPerMinute: 3 } });
  s.chain.state.validity = PAYMENT;
  const junk = signedCarried(30).extrinsic;
  assert.equal(await s.gw.handle(carryTx(junk)), 'invalid');
  for (let i = 0; i < 4; i++) assert.equal(await s.gw.handle(carryTx(junk)), 'duplicate');
  assert.equal(s.chain.calls.state_call, 1, 'cópias da mesma carga: uma validação só');
  const r = [];
  for (let n = 0; n < 3; n++) r.push(await s.gw.handle(carryTx(signedCarried(31 + n).extrinsic)));
  assert.deepEqual(r, ['invalid', 'invalid', 'queued'], 'acima do teto de validação a carga espera');
  assert.equal(s.chain.calls.state_call, 3);
});

test('B-N3: na rodada, cada bloco é lido uma vez para todas as transações acompanhadas', async () => {
  const s = setup();
  const txs = [0, 1, 2, 3, 4].map(n => signedCarried(7 + n));
  for (const t of txs) assert.equal(await s.gw.handle(carryTx(t.extrinsic)), 'submitted');
  // Ainda fora dos blocos (pool cheio): três blocos vazios para as cinco olharem.
  const pool = s.chain.state.pool.splice(0);
  s.chain.mine(3, false);
  const before = { blocks: s.chain.calls.chain_getBlock ?? 0, hashes: s.chain.calls.chain_getBlockHash ?? 0 };
  await s.gw.tick();
  assert.equal((s.chain.calls.chain_getBlock ?? 0) - before.blocks, 3, 'antes: 5 transações × 3 blocos = 15 leituras');
  assert.equal((s.chain.calls.chain_getBlockHash ?? 0) - before.hashes, 3);
  // Todas entram no mesmo bloco: uma leitura dele dá "em bloco" para as cinco, e depois "finalizada".
  s.chain.state.pool.push(...pool);
  s.chain.mine(1, true);
  const mid = s.chain.calls.chain_getBlock!;
  await s.gw.tick();
  assert.equal(s.chain.calls.chain_getBlock! - mid, 1);
  assert.equal(s.replies.filter(x => x.rc.status === 'finalized').length, 5);
  assert.ok(s.replies.filter(x => x.rc.status === 'finalized').every(x => x.rc.block!.number === 1004));
  assert.equal(s.gw.trackedCount, 0);
});

test('B-N3: teto de leituras de bloco por rodada; o resto continua na rodada seguinte', async () => {
  const s = setup({ limits: { blockReadsPerTick: 4 } });
  const t = signedCarried();
  await s.gw.handle(carryTx(t.extrinsic));
  const pool = s.chain.state.pool.splice(0);
  s.chain.mine(5, false);
  s.chain.state.pool.push(...pool);
  s.chain.mine(1, true);
  const c0 = (s.chain.calls.chain_getBlock ?? 0) + (s.chain.calls.chain_getBlockHash ?? 0);
  await s.gw.tick();
  assert.equal((s.chain.calls.chain_getBlock ?? 0) + (s.chain.calls.chain_getBlockHash ?? 0) - c0, 4);
  assert.ok(!s.replies.some(x => x.rc.status === 'included'));
  for (let i = 0; i < 3 && s.gw.trackedCount; i++) await s.gw.tick();
  assert.deepEqual(s.replies.map(x => x.rc.status), ['pool', 'included', 'finalized']);
  assert.equal(s.replies[2]!.rc.block!.number, 1006);
});

test('respostas por item têm teto (cópias demais não fazem o gateway mandar recibos sem fim)', async () => {
  const s = setup({ limits: { repliesPerItem: 2 } });
  const t = signedCarried();
  for (let i = 0; i < 5; i++) await s.gw.handle(carryTx(t.extrinsic));
  const before = s.replies.length;
  s.chain.mine(1, true);
  await s.gw.tick();
  assert.ok(s.replies.length - before <= 4, 'incluída + finalizada para no máximo 2 destinos');
  void deriveIdentity(newSeed(), 'anon');
});
