/**
 * Computador como gateway (opcional) da carga pela malha: a carga de outro aparelho chega pela LAN,
 * vai para a Lunes FALSA e o recibo volta. Nada vai para a Mainnet.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarryChain, CarryKind, openCarryReceipt, returnIdentity, sealCarry } from '../../mobile/src/protocol/carry';
import { buildTransferKeepAlive, IMMORTAL_PERIOD } from '../../mobile/src/lib/extrinsic';
import { LunesRpc } from '../../mobile/src/lib/lunesRpc';
import { withWalletKey } from '../../mobile/src/lib/walletKey';
import { ALICE_57, fakeConnect, substrate } from '../../piu-node/test/lunes-fake.js';
import { DEV_MNEMONIC } from '../../piu-node/test/wallet-fixture.js';
import { createIdentity } from '../src/main/identity';
import { MeshNode } from '../src/main/mesh';
import { LnnpLanTransport } from '../src/transport/lnnpLan';

async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 20)); }
}

const GENESIS = '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac';
const signedCarried = () => withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, {
  dest: ALICE_57, value: 100_000_000n,
  ctx: { specVersion: 107, transactionVersion: 2, genesisHash: GENESIS, blockHash: GENESIS, blockNumber: 1000, nonce: 3, tip: 0n, period: IMMORTAL_PERIOD },
}));

test('desktop gateway: carga da LAN → Lunes falsa → recibo de volta; sem a opção, só repassa', async t => {
  const fake = substrate({ finalized: 1000, storage: {} });
  const { connect } = fakeConnect(fake.handle);
  const chain = { submissions: fake.submitted, rpc: () => new LunesRpc({ endpoints: ['ws://lunes-falsa'], connect, timeoutMs: 2000 }) };
  const mk = async (peers: string[], gateway?: { rpc: () => LunesRpc }) => {
    const { keys } = createIdentity();
    const lan = new LnnpLanTransport({ node: keys.node, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers, beaconMs: 150, handshakeTimeoutMs: 2000 });
    const mesh = new MeshNode({ keys, transports: [lan], relay: true, displayName: 'x', events: {}, ...(gateway ? { gateway: { ...gateway, probeMs: 100, tickMs: 100 } } : {}) });
    await mesh.start(100);
    t.after(() => mesh.stop().catch(() => {}));
    return { mesh, lan };
  };
  const G = await mk([], { rpc: chain.rpc });
  const P = await mk([`127.0.0.1:${G.lan.port}`]);
  await until(() => P.lan.linkCount === 1, 'enlace');
  assert.equal(await G.mesh.probeGateway(), true);
  assert.equal(await P.mesh.probeGateway(), false, 'sem a opção não é gateway');
  const tx = signedCarried();
  const c = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: tx.extrinsic }, now: Math.floor(Date.now() / 1000) });
  P.mesh.messenger.router.send(c.bytes, Math.floor(Date.now() / 1000));
  P.mesh.messenger.tick();
  await until(() => chain.submissions.length === 1, 'gateway enviar');
  assert.equal(chain.submissions[0], tx.hex);
  const me = returnIdentity(c.returnSeed);
  await until(() => P.mesh.messenger.router.exportStored().some(e => openCarryReceipt(e.bytes, me, Math.floor(Date.now() / 1000))?.status === 'pool'), 'recibo voltar');
  assert.equal(G.mesh.gatewayStats!.submitted, 1);
});
