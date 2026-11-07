/**
 * piu-node como gateway da carga pela malha (docs/carteira/transacoes-pela-malha.md): a transação
 * assinada num celular sem internet atravessa um relay comum por LNNP/TCP, o gateway envia à Lunes
 * FALSA (nada vai para a Mainnet) e o recibo volta pela malha para a identidade descartável.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLnnpConfig, type LnnpConfig } from '../src/config.js';
import { buildTransferKeepAlive, IMMORTAL_PERIOD } from '../src/lunes/extrinsic.js';
import { LunesRpc } from '../src/lunes/lunesRpc.js';
import { withWalletKey } from '../src/lunes/walletKey.js';
import { CarryChain, CarryKind, openCarryReceipt, returnIdentity, sealCarry } from '../src/protocol/carry.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { DEFAULT_SETTINGS } from '../src/store.js';
import { ALICE_57, fakeConnect, substrate } from './lunes-fake.js';
import { DEV_MNEMONIC } from './wallet-fixture.js';

const GENESIS = '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac';
function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}
const nodes: RelayHandle[] = [];
const closeAll = async () => { await Promise.all(nodes.splice(0).map(n => n.close())); };
const addr = (n: RelayHandle) => `127.0.0.1:${n.port}`;
async function until(cond: () => boolean, what: string, ms = 6000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 20)); }
}
const signed = (nonce = 3) => withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, {
  dest: ALICE_57, value: 100_000_000n,
  ctx: { specVersion: 107, transactionVersion: 2, genesisHash: GENESIS, blockHash: GENESIS, blockNumber: 1000, nonce, tip: 0n, period: IMMORTAL_PERIOD },
}));

function lunes(down = false) {
  const chain = { finalized: 1000, storage: {}, extrinsics: {} as Record<number, string[]> };
  const s = substrate(chain);
  const { connect } = fakeConnect(s.handle, down ? ['ws://lunes-falsa'] : []);
  return { chain, s, rpc: () => new LunesRpc({ endpoints: ['ws://lunes-falsa'], connect, timeoutMs: 200 }) };
}
async function start(o: Partial<LnnpConfig>, gw?: ReturnType<typeof lunes>) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg(o), DEFAULT_SETTINGS, { tickMs: 100, ...(gw ? { gateway: { rpc: gw.rpc, probeMs: 100, tickMs: 100 } } : {}) });
  nodes.push(n);
  return n;
}

test('celular → relay → piu-node gateway → Lunes falsa; recibo "pool" e "finalizada" voltam pela malha', async t => {
  t.after(closeAll);
  const L = lunes();
  const G = await start({ gateway: true }, L);
  const R = await start({ peers: [addr(G)] });
  const P = await start({ peers: [addr(R)] }); // o "celular": só solta a carga e guarda o que volta
  await until(() => G.gateway!.roles().tx, 'gateway alcançar a Lunes');
  await until(() => R.engine.stats().neighbors.length === 2, 'P–R–G conectados');
  const tx = signed();
  const c = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: tx.extrinsic }, now: Math.floor(Date.now() / 1000) });
  assert.equal(P.engine.send(c.bytes).status, 'stored');
  await until(() => L.s.submitted.length === 1, 'gateway enviar à Lunes');
  assert.equal(L.s.submitted[0], tx.hex, 'os mesmos bytes assinados no celular');
  assert.equal(R.engine.inbox.length, 0, 'o relay não abriu nada');
  const me = returnIdentity(c.returnSeed);
  const receipts = () => P.engine.router.exportStored().map(e => openCarryReceipt(e.bytes, me, Math.floor(Date.now() / 1000))).filter(r => r !== null);
  await until(() => receipts().some(r => r.status === 'pool'), 'recibo "pool" voltar ao celular');
  L.chain.extrinsics[1001] = [tx.hex]; L.chain.finalized = 1001;
  await until(() => receipts().some(r => r.status === 'finalized'), 'recibo "finalizada"');
  const fin = receipts().find(r => r.status === 'finalized')!;
  assert.equal(fin.block!.number, 1001);
  assert.equal(G.gateway!.stats().finalized, 1);
});

test('gateway sem rota até a Lunes: não pega a carga, guarda e repassa como envelope de terceiros', async t => {
  t.after(closeAll);
  const L = lunes(true);
  const G = await start({ gateway: true }, L);
  const P = await start({ peers: [addr(G)] });
  await until(() => G.engine.stats().neighbors.length === 1, 'P–G conectados');
  await G.gateway!.probe();
  assert.equal(G.gateway!.roles().tx, false);
  const c = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: signed().extrinsic }, now: Math.floor(Date.now() / 1000) });
  P.engine.send(c.bytes);
  await until(() => G.engine.router.has(c.id), 'G guardar para repassar');
  assert.equal(G.engine.inbox.length, 0);
  assert.equal(L.s.submitted.length, 0);
});

test('configuração: gateway ligado de fábrica; caixa do validador só HTTPS e nenhuma por padrão', () => {
  const c = loadLnnpConfig({});
  assert.equal(c.gateway, true);
  assert.equal(c.inboxUrl, null);
  assert.equal(loadLnnpConfig({ PIU_GATEWAY: '0' }).gateway, false);
  assert.equal(loadLnnpConfig({ PIU_VALIDATOR_INBOX: 'https://validador.example/caixa' }).inboxUrl, 'https://validador.example/caixa');
  assert.throws(() => loadLnnpConfig({ PIU_VALIDATOR_INBOX: 'http://validador.example/caixa' }), /https/);
});
