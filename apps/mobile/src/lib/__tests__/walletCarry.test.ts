/// <reference types="node" />
/**
 * Carteira sem internet (lib/walletCarry.ts): contexto guardado, revisão, assinatura imortal gravada
 * antes de soltar na malha, recibo do gateway como dica e a conferência do próprio aparelho na Mainnet.
 * Lunes falsa (carryFake.ts); nada vai para a Mainnet.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarryKind } from '../../protocol/carry';
import { buildTransferKeepAlive } from '../extrinsic';
import { fromHex } from '../lunesRpc';
import { withWalletKey } from '../walletKey';
import {
  advanceOfflineContext, applyCarryReceipt, carryWalletTransfer, isInTransit, isOfflineContext, OFFLINE_CONTEXT_MAX_AGE_MS, prepareCarriedTransfer,
  readOfflineContext, reconcileCarriedTransfer, recarryTransfer, type WalletOfflineContext,
} from '../walletCarry';
import { isActiveWalletTransfer, isWalletTransferRecord, WalletTransferError, type WalletQuote, type WalletTransferRecord } from '../walletTransfer';
import { PAYMENT, fakeLunes } from './carryFake';
import { ALICE_57 } from './lunesFake';
import { DEV_ADDR_57, DEV_MNEMONIC, RANDOM } from './walletFixture';

const NOW = 1_800_000_000_000;
const code = (wanted: string) => (e: unknown) => e instanceof WalletTransferError && e.code === wanted;
const input = { from: DEV_ADDR_57, dest: ALICE_57, value: '100000000' };

async function context(chain = fakeLunes()) {
  const rpc = chain.rpc();
  try { return { chain, ctx: await readOfflineContext(DEV_ADDR_57, { rpc, now: () => NOW }) }; } finally { rpc.close(); }
}
function wallet() {
  let current: WalletTransferRecord | null = null;
  const order: string[] = [], carried: string[] = [];
  let failCarry = false, failSave = false, auth = true;
  const cb = {
    authorize: async () => { order.push('authorize'); return auth; },
    sign: (q: WalletQuote) => { order.push('sign'); return withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, { dest: q.dest, value: BigInt(q.value), ctx: { ...q.ctx, tip: BigInt(q.ctx.tip) }, random: fromHex(RANDOM) })); },
    save: async (r: WalletTransferRecord) => { if (failSave) throw new Error('disco'); order.push(`save:${r.carried?.envelopeId === '0'.repeat(32) ? 'antes' : 'depois'}`); current = structuredClone(r); },
    active: () => current,
    carry: (hex: string) => { order.push('carry'); if (failCarry) throw new Error('sem malha'); carried.push(hex); return { envelopeId: 'ab'.repeat(16), expiresAt: 1_800_600_000 }; },
  };
  return { cb, order, carried, current: () => current, set: (o: { failCarry?: boolean; failSave?: boolean; auth?: boolean }) => { failCarry = o.failCarry ?? failCarry; failSave = o.failSave ?? failSave; auth = o.auth ?? auth; } };
}

test('contexto sem internet: lido com rede (runtime, nonce, saldo, taxa) e conferido ao restaurar', async () => {
  const { ctx } = await context();
  assert.equal(ctx.nonce, 7); assert.equal(ctx.block, 1000); assert.equal(ctx.fee, '144000');
  assert.equal(ctx.available, (1_000_000_000n - 500n).toString(), 'sem o mínimo da conta');
  assert.ok(isOfflineContext(ctx));
  assert.ok(!isOfflineContext({ ...ctx, specVersion: 108 }), 'runtime diferente do conferido');
  assert.ok(!isOfflineContext({ ...ctx, nonce: -1 }));
  const c = fakeLunes(); c.state.spec = 108;
  await assert.rejects(context(c), code('runtime'));
});

test('revisão sem internet: era imortal, nonce guardado; sem contexto, velho ou sem saldo com folga → recusa', async () => {
  const { ctx } = await context();
  const q = prepareCarriedTransfer(input, ctx, NOW + 1000);
  assert.deepEqual([q.ctx.period, q.ctx.blockHash, q.ctx.nonce, q.fee], [0, ctx.genesisHash, 7, '144000']);
  assert.throws(() => prepareCarriedTransfer(input, null, NOW), code('offline_context'));
  assert.throws(() => prepareCarriedTransfer(input, ctx, NOW + OFFLINE_CONTEXT_MAX_AGE_MS + 1), code('offline_context'));
  assert.throws(() => prepareCarriedTransfer({ ...input, from: ALICE_57, dest: DEV_ADDR_57 }, ctx, NOW), code('offline_context'), 'contexto de outra conta');
  const tight: WalletOfflineContext = { ...ctx, available: (100_000_000n + 144_000n).toString() };
  assert.throws(() => prepareCarriedTransfer(input, tight, NOW), code('funds'), 'taxa com folga (2×) precisa caber');
  assert.ok(prepareCarriedTransfer(input, { ...tight, available: (100_000_000n + 288_000n).toString() }, NOW));
});

test('enviar pela malha: autoriza, assina, GRAVA e só então solta; registro restaurável e "em trânsito"', async () => {
  const { ctx } = await context();
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb, { now: () => NOW });
  assert.deepEqual(w.order, ['authorize', 'sign', 'save:antes', 'carry', 'save:depois']);
  assert.equal(r.status, 'signed');
  assert.ok(isInTransit(r) && isActiveWalletTransfer(r), 'bloqueia novos envios (nonce)');
  assert.equal(r.carried!.envelopeId, 'ab'.repeat(16));
  assert.ok(isWalletTransferRecord(structuredClone(r)), 'volta do disco');
  assert.ok(!isWalletTransferRecord({ ...r, carried: undefined }), 'imortal sem carga não é registro válido');
  assert.ok(!isWalletTransferRecord({ ...r, ctx: { ...r.ctx, blockHash: '0x' + '11'.repeat(32) } }));
  await assert.rejects(carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb), code('busy'));
});

test('cancelar não grava; gravar falhou não solta; malha recusou fica guardada para soltar de novo', async () => {
  const { ctx } = await context();
  const a = wallet(); a.set({ auth: false });
  await assert.rejects(carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), a.cb), code('cancelled'));
  assert.equal(a.current(), null);
  const b = wallet(); b.set({ failSave: true });
  await assert.rejects(carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), b.cb), code('persistence'));
  assert.equal(b.carried.length, 0);
  const c = wallet(); c.set({ failCarry: true });
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), c.cb);
  assert.match(r.error!, /não entrou na malha/);
  c.set({ failCarry: false });
  const again = await recarryTransfer(r, c.cb);
  assert.equal(again.hex, r.hex, 'os mesmos bytes, sem reassinar');
  assert.equal(again.error, undefined);
  assert.deepEqual(c.carried, [r.hex]);
});

test('recibo do gateway é dica: guarda o que disse, não confirma e não regride', async () => {
  const { ctx } = await context();
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb);
  const ref = fromHex(r.hash);
  assert.equal(applyCarryReceipt(r, { about: CarryKind.Tx, ref: new Uint8Array(32), status: 'finalized' }, NOW), null, 'outro hash');
  const inc = applyCarryReceipt(r, { about: CarryKind.Tx, ref, status: 'included', block: { number: 1001, hash: new Uint8Array(32).fill(1), index: 1 } }, NOW)!;
  assert.equal(inc.status, 'signed', 'continua em trânsito até o aparelho conferir');
  assert.equal(inc.carried!.report!.block!.number, 1001);
  assert.equal(applyCarryReceipt(inc, { about: CarryKind.Tx, ref, status: 'pool' }, NOW), null, 'cópia atrasada não regride');
  assert.ok(isWalletTransferRecord(inc));
});

test('com internet: nonce livre → o próprio aparelho envia os mesmos bytes e acompanha até confirmar', async () => {
  const { chain, ctx } = await context();
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb);
  const rpc = chain.rpc();
  try {
    const deps = { rpc, readExecution: async () => ({ ok: true as const }) };
    const sub = await reconcileCarriedTransfer(r, w.cb, deps);
    assert.equal(sub.status, 'submitted');
    assert.equal(sub.scanned, 1000);
    assert.deepEqual(chain.submissions, [r.hex]);
    chain.mine(1, true);
    const fin = await reconcileCarriedTransfer(sub, w.cb, deps);
    assert.equal(fin.status, 'finalized');
    assert.equal(fin.block!.number, 1001);
    assert.ok(!isActiveWalletTransfer(fin), 'libera novos envios');
    const next = advanceOfflineContext(ctx, fin)!;
    assert.equal(next.nonce, 8, 'o contexto guardado não repete o nonce');
  } finally { rpc.close(); }
});

test('com internet: um gateway já incluiu → acha pelo recibo ou pela busca; nonce usado por outra → não concluída', async () => {
  const { chain, ctx } = await context();
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb);
  chain.state.pool.push(r.hex); chain.mine(3, true); // gateway enviou; está no bloco 1001
  const rpc = chain.rpc();
  try {
    const deps = { rpc, readExecution: async () => ({ ok: true as const }), outgoingBlocks: async () => [] };
    const found = await reconcileCarriedTransfer(r, w.cb, deps);
    assert.equal(found.status, 'finalized');
    assert.equal(found.block!.number, 1001);
    assert.equal(chain.submissions.length, 0, 'não reenvia o que já está em bloco');
    // Outra transação usou o nonce 7 (a mesma frase em outra carteira, por exemplo).
    const c2 = fakeLunes();
    const { ctx: ctx2 } = await context(c2);
    const w2 = wallet();
    const r2 = await carryWalletTransfer(prepareCarriedTransfer(input, ctx2, NOW), w2.cb);
    c2.state.pool.push('0x' + 'aa'.repeat(150)); c2.mine(2, true);
    const rpc2 = c2.rpc();
    try {
      // Indexador fora do ar: só o nó RPC não basta para dizer "não concluída".
      const unsure = await reconcileCarriedTransfer(r2, w2.cb, { rpc: rpc2, outgoingBlocks: async () => null });
      assert.equal(unsure.status, 'signed');
      assert.match(unsure.error!, /não refaça o pagamento/i);
      const lost = await reconcileCarriedTransfer(unsure, w2.cb, { rpc: rpc2, outgoingBlocks: async () => [] });
      assert.equal(lost.status, 'failed');
      assert.match(lost.error!, /mesmo nonce/);
      // Indexador fora do ar por 24 h: não fica em trânsito (e bloqueando envios) para sempre.
      const since = await reconcileCarriedTransfer(r2, w2.cb, { rpc: rpc2, outgoingBlocks: async () => null, now: () => NOW });
      assert.equal(since.status, 'signed'); assert.equal(since.unconfirmedSince, NOW);
      const freed = await reconcileCarriedTransfer(since, w2.cb, { rpc: rpc2, outgoingBlocks: async () => null, now: () => NOW + 24 * 3_600_000 });
      assert.equal(freed.status, 'failed'); assert.equal(isActiveWalletTransfer(freed), false);
      assert.match(freed.error!, /confira/i);
    } finally { rpc2.close(); }
  } finally { rpc.close(); }
});

test('nonce passou há muitos blocos: busca por partes, sem declarar "não concluída" antes de olhar tudo', async () => {
  const chain = fakeLunes();
  const { ctx } = await context(chain);
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb);
  chain.mine(450, true);
  chain.state.pool.push(r.hex); chain.mine(10, true); // incluída no bloco 1451
  const rpc = chain.rpc();
  try {
    const deps = { rpc, readExecution: async () => ({ ok: true as const }), outgoingBlocks: async () => null };
    const step = await reconcileCarriedTransfer(r, w.cb, deps);
    assert.equal(step.status, 'signed', 'ainda procurando: não diz que falhou');
    assert.equal(step.scanned, 1400);
    const done = await reconcileCarriedTransfer(step, w.cb, deps);
    assert.equal(done.status, 'finalized');
    assert.equal(done.block!.number, 1451);
  } finally { rpc.close(); }
});

test('com internet: Lunes recusa (saldo) → não concluída com o aviso; sem rota → segue em trânsito', async () => {
  const { chain, ctx } = await context();
  const w = wallet();
  const r = await carryWalletTransfer(prepareCarriedTransfer(input, ctx, NOW), w.cb);
  chain.state.offline = true;
  const rpc = chain.rpc();
  try {
    const still = await reconcileCarriedTransfer(r, w.cb, { rpc });
    assert.equal(still.status, 'signed');
    assert.match(still.error!, /Segue em trânsito/);
    chain.state.offline = false; chain.state.validity = PAYMENT;
    // A recusa vem de um nó RPC só: sem o indexador para conferir, segue em trânsito.
    const unsure = await reconcileCarriedTransfer(still, w.cb, { rpc, outgoingBlocks: async () => null });
    assert.equal(unsure.status, 'signed');
    assert.match(unsure.error!, /não refaça o pagamento/i);
    // Indexador lista uma saída igual: as fontes discordam, não diz "não concluída".
    const conflict = await reconcileCarriedTransfer(unsure, w.cb, { rpc, outgoingBlocks: async () => [1003] });
    assert.equal(conflict.status, 'signed'); assert.match(conflict.error!, /#1003/);
    const failed = await reconcileCarriedTransfer(conflict, w.cb, { rpc, outgoingBlocks: async () => [] });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error!, /Payment/);
    assert.match(failed.error!, /ainda pode valer/);
    assert.equal(chain.submissions.length, 0);
  } finally { rpc.close(); }
});
