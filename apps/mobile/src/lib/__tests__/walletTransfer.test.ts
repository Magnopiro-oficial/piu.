/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTransferKeepAlive } from '../extrinsic';
import { extrinsicHash, fromHex, LunesRpc } from '../lunesRpc';
import { withWalletKey } from '../walletKey';
import {
  isActiveWalletTransfer, isWalletTransferRecord, LUNES_GENESIS_HASH, prepareWalletTransfer, readWalletExecution,
  retryWalletTransfer, sendWalletTransfer, trackWalletTransfer, WalletTransferError, type WalletQuote, type WalletTransferRecord,
} from '../walletTransfer';
import { accountInfoHex, ALICE_57, fakeSockets, hashOf } from './lunesFake';
import { DEV_ADDR_57, DEV_MNEMONIC, RANDOM } from './walletFixture';

const VALID = '0x00' + '0000000000000000' + '00' + '00' + '4000000000000000' + '01';
function chain() {
  const state = { fin: 100, best: 100, nonce: 7, free: 1_000_000_000n, reserved: 0n, frozen: 0n, fee: 144_000n, spec: 107, tx: 2, genesis: LUNES_GENESIS_HASH,
    validity: VALID, loseResponse: false, reject: '', missing: new Set<number>(), blocks: {} as Record<number, string[]> };
  const calls: string[] = [], submissions: string[] = [];
  const byHash = new Map<string, number>();
  const hash = (n: number) => { const h = n === 0 ? state.genesis : hashOf('block ' + n); byHash.set(h, n); return h; };
  const header = (n: number) => ({ number: '0x' + n.toString(16), parentHash: hash(n - 1) });
  const handler = (method: string, params: unknown[]) => {
    calls.push(method); hash(state.fin); hash(state.best);
    switch (method) {
      case 'chain_getFinalizedHead': return { result: hash(state.fin) };
      case 'chain_getHeader': return { result: params[0] ? header(byHash.get(params[0] as string)!) : header(state.best) };
      case 'chain_getBlockHash': { const n = params[0] as number; return { result: state.missing.has(n) || n > state.best ? null : hash(n) }; }
      case 'chain_getBlock': { const n = byHash.get(params[0] as string); return { result: n === undefined || state.missing.has(n) ? null : { block: { extrinsics: state.blocks[n] ?? [] } } }; }
      case 'state_getStorage': return { result: accountInfoHex({ nonce: state.nonce, free: state.free, reserved: state.reserved, frozen: state.frozen }) };
      case 'state_getRuntimeVersion': return { result: { specVersion: state.spec, transactionVersion: state.tx } };
      case 'system_accountNextIndex': return { result: state.nonce };
      case 'payment_queryInfo': return { result: { partialFee: state.fee.toString(), class: 'Normal' } };
      case 'state_call': return { result: state.validity };
      case 'author_submitExtrinsic':
        submissions.push(params[0] as string);
        if (state.loseResponse) throw new Error('conexão caiu após aceitação');
        if (state.reject) return { error: { code: 1013, message: state.reject } };
        return { result: extrinsicHash(fromHex(params[0] as string)) };
      default: return { error: { code: -32601, message: method } };
    }
  };
  const factory = fakeSockets({ 'ws://wallet': 'ok' }, handler);
  const rpc = new LunesRpc({ endpoints: ['ws://wallet'], connect: factory.connect, timeoutMs: 30 });
  return { state, calls, submissions, rpc, hash };
}
const input = { from: DEV_ADDR_57, dest: ALICE_57, value: '100000000' };
function callbacks() {
  let current: WalletTransferRecord | null = null;
  let auth = true, authorized = 0, signed = 0, failSave = false;
  const saved: WalletTransferRecord[] = [];
  const options = {
    authorize: async () => { authorized++; return auth; },
    sign: (q: WalletQuote) => {
      signed++;
      return withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, { dest: q.dest, value: BigInt(q.value), ctx: { ...q.ctx, tip: BigInt(q.ctx.tip) }, random: fromHex(RANDOM) }));
    },
    save: async (r: WalletTransferRecord) => { if (failSave) throw new Error('disco indisponível'); saved.push(structuredClone(r)); current = r; },
    active: () => current,
  };
  return { options, saved, setAuth: (v: boolean) => { auth = v; }, failSave: () => { failSave = true; }, counts: () => ({ authorized, signed }), current: () => current };
}
const code = (wanted: string) => (error: unknown) => error instanceof WalletTransferError && error.code === wanted;

test('quote: taxa e planck exatos, free não desconta reserved duas vezes, frozen e keepalive respeitados', async t => {
  const c = chain(); t.after(() => c.rpc.close());
  const q = await prepareWalletTransfer(input, { rpc: c.rpc, now: () => 123 });
  assert.equal(q.fee, '144000'); assert.equal(q.total, '100144000'); assert.equal(q.available, '999999500'); assert.equal(q.preparedAt, 123);
  c.state.reserved = 1000n;
  assert.equal((await prepareWalletTransfer(input, { rpc: c.rpc })).available, '1000000000', 'reserved não pertence a free e já cobre ED');
  c.state.frozen = 999_000_000n;
  await assert.rejects(prepareWalletTransfer(input, { rpc: c.rpc }), code('funds'));
  c.state.frozen = 0n; c.state.reserved = 0n; c.state.free = 100_144_499n;
  await assert.rejects(prepareWalletTransfer(input, { rpc: c.rpc }), code('funds'), 'não gastar os 500 planck da conta');
  c.state.free = 100_144_500n;
  assert.equal((await prepareWalletTransfer(input, { rpc: c.rpc })).available, '100144000');
});

test('rede/gênese/runtime errados são recusados; send rejeita contexto adulterado antes de autorizar/assinar', async t => {
  const c = chain(); t.after(() => c.rpc.close());
  const q = await prepareWalletTransfer(input, { rpc: c.rpc });
  for (const patch of [{ genesis: hashOf('outra rede') }, { spec: 108 }, { tx: 3 }]) {
    const old = { genesis: c.state.genesis, spec: c.state.spec, tx: c.state.tx };
    Object.assign(c.state, patch);
    await assert.rejects(prepareWalletTransfer(input, { rpc: c.rpc }), code('runtime'));
    Object.assign(c.state, old);
  }
  const b = callbacks();
  await assert.rejects(sendWalletTransfer({ ...q, ctx: { ...q.ctx, genesisHash: hashOf('outra') } }, b.options, { rpc: c.rpc }), code('runtime'));
  assert.deepEqual(b.counts(), { authorized: 0, signed: 0 }); assert.equal(c.submissions.length, 0);
});

test('cancelamento biométrico não assina nem envia; erro de persistência não transmite', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc });
  const cancel = callbacks(); cancel.setAuth(false);
  await assert.rejects(sendWalletTransfer(q, cancel.options, { rpc: c.rpc }), code('cancelled'));
  assert.deepEqual(cancel.counts(), { authorized: 1, signed: 0 }); assert.equal(cancel.saved.length, 0); assert.equal(c.submissions.length, 0);
  const disk = callbacks(); disk.failSave();
  await assert.rejects(sendWalletTransfer(q, disk.options, { rpc: c.rpc }), code('persistence'));
  assert.equal(c.submissions.length, 0);
});

test('drift de nonce/taxa depois da autorização exige nova revisão sem assinar', async t => {
  const c = chain(); t.after(() => c.rpc.close());
  for (const changed of ['fee', 'nonce'] as const) {
    const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
    const options = { ...b.options, authorize: async () => { if (changed === 'fee') c.state.fee++; else c.state.nonce++; return true; } };
    await assert.rejects(sendWalletTransfer(q, options, { rpc: c.rpc }), e => code('review_required')(e) && !!(e as WalletTransferError).quote);
    assert.equal(b.counts().signed, 0); assert.equal(c.submissions.length, 0);
  }
});

test('ordem segura: autoriza, assina, await save signed antes de author_submit; registro validável e duplicata bloqueada', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
  const save = async (r: WalletTransferRecord) => { if (r.status === 'signed') assert.equal(c.submissions.length, 0); await b.options.save(r); };
  const r = await sendWalletTransfer(q, { ...b.options, save }, { rpc: c.rpc, now: () => 1000 });
  assert.equal(r.status, 'submitted'); assert.equal(c.submissions.length, 1); assert.equal(b.saved[0]!.status, 'signed');
  assert.equal(isWalletTransferRecord(JSON.parse(JSON.stringify(r))), true); assert.equal(isActiveWalletTransfer(r), true);
  await assert.rejects(sendWalletTransfer(q, b.options, { rpc: c.rpc }), code('busy'));
  assert.equal(c.submissions.length, 1); assert.equal(b.counts().signed, 1);
  assert.equal(isWalletTransferRecord({ ...r, hex: r.hex.slice(0, -2) + 'ff' }), false);
});

test('resposta perdida/AlreadyImported/Stale permanecem ativas; retry usa bytes iguais e não reassina', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
  c.state.loseResponse = true;
  let r = await sendWalletTransfer(q, b.options, { rpc: c.rpc });
  assert.equal(r.status, 'signed'); assert.match(r.error ?? '', /não refaça/); assert.equal(c.submissions.length, 1);
  c.state.loseResponse = false; c.state.reject = 'Transaction Already Imported';
  r = await retryWalletTransfer(r, b.options, { rpc: c.rpc });
  assert.equal(r.status, 'signed'); assert.deepEqual(c.submissions, [r.hex, r.hex]);
  assert.equal(b.counts().signed, 1);
  c.state.validity = '0x010003';
  r = await retryWalletTransfer(r, b.options, { rpc: c.rpc });
  assert.equal(r.status, 'signed'); assert.match(r.error ?? '', /Stale/); assert.equal(c.submissions.length, 2);
});

test('inclusão não conclui pagamento; sucesso/fracasso requerem bloco finalizado e prova do índice/hash', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
  const r = await sendWalletTransfer(q, b.options, { rpc: c.rpc });
  c.state.blocks[101] = ['0x08aabb', r.hex]; c.state.best = 101;
  let proofCalls = 0;
  const deps = { rpc: c.rpc, readExecution: async (_: WalletTransferRecord, block: { number: number; hash: string; index: number }) => { proofCalls++; assert.deepEqual(block, { number: 101, hash: c.hash(101), index: 1 }); return { ok: true as const }; } };
  const included = await trackWalletTransfer(r, b.options, deps);
  assert.equal(included.status, 'included'); assert.equal(proofCalls, 0);
  c.state.fin = 101;
  const pending = await trackWalletTransfer(included, b.options, { rpc: c.rpc, readExecution: async () => ({ ok: null, error: 'indexador atrasado' }) });
  assert.equal(pending.status, 'included'); assert.equal(isActiveWalletTransfer(pending), true);
  const done = await trackWalletTransfer(pending, b.options, deps);
  assert.equal(done.status, 'finalized'); assert.equal(done.proofSource, 'indexer'); assert.equal(isActiveWalletTransfer(done), false);
  const failed = await trackWalletTransfer(included, b.options, { rpc: c.rpc, readExecution: async () => ({ ok: false, error: 'Execução recusada' }) });
  assert.equal(failed.status, 'failed'); assert.match(failed.error ?? '', /Execução recusada/);
});

test('era vencida só libera após conferir todos os blocos finalizados; buraco mantém resultado incerto', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
  const r = await sendWalletTransfer(q, b.options, { rpc: c.rpc });
  c.state.fin = 165; c.state.best = 165; c.state.missing.add(105);
  const unknown = await trackWalletTransfer(r, b.options, { rpc: c.rpc });
  assert.equal(unknown.status, 'submitted'); assert.equal(isActiveWalletTransfer(unknown), true); assert.equal(unknown.scanned, 104);
  c.state.missing.clear();
  const absent = await trackWalletTransfer(unknown, b.options, { rpc: c.rpc });
  assert.equal(absent.status, 'failed'); assert.equal(absent.scanned, 164);
});

test('prova indexer: aceita boolean estrito e bloco/índice exatos, recusa hash diferente, string true e resposta incompleta', async t => {
  const c = chain(); t.after(() => c.rpc.close()); const q = await prepareWalletTransfer(input, { rpc: c.rpc }); const b = callbacks();
  const r = await sendWalletTransfer(q, b.options, { rpc: c.rpc });
  const block = { number: 101, hash: c.hash(101), index: 2 };
  const data = { extrinsic: { id: '101-2', blockNumber: '101', extrinsicIndex: 2, success: true as unknown }, block: { id: '101', number: '101', hash: block.hash } };
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string); assert.deepEqual(body.variables, { id: '101-2', block: '101' });
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  assert.deepEqual(await readWalletExecution(r, block, { fetch: fetcher }), { ok: true });
  data.extrinsic.success = false; assert.equal((await readWalletExecution(r, block, { fetch: fetcher })).ok, false);
  data.extrinsic.success = 'true'; assert.equal((await readWalletExecution(r, block, { fetch: fetcher })).ok, null);
  data.extrinsic.success = true; data.block.hash = hashOf('outra cadeia'); assert.equal((await readWalletExecution(r, block, { fetch: fetcher })).ok, null);
  data.block.hash = block.hash; data.extrinsic.extrinsicIndex = 1; assert.equal((await readWalletExecution(r, block, { fetch: fetcher })).ok, null);
});
