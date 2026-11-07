import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { claimableEpochs, epochOf, isLunesAddress } from '../src/payout.js';
import { toHex, utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import { verifyPayoutClaim } from '../src/protocol/receipts.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { certToJson, makeCert, operatorKeyPair } from '../src/relay/operator-frames.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

/** O validador de verdade (apps/settlement), quando está no repositório com as dependências instaladas. */
const SETTLEMENT = join(fileURLToPath(import.meta.url), '../../../settlement');
async function validator() {
  if (!existsSync(join(SETTLEMENT, 'node_modules/@polkadot/util-crypto'))) return null;
  const v = await import(join(SETTLEMENT, 'src/validator.ts'));
  const reg = await import(join(SETTLEMENT, 'src/registry.ts'));
  const proof = await import(join(SETTLEMENT, 'src/protocol/proof.ts'));
  const u = await import(join(SETTLEMENT, 'node_modules/@polkadot/util-crypto/index.js'));
  await u.cryptoWaitReady();
  return { v, reg, proof, u } as {
    v: typeof import('../../settlement/src/validator.js');
    reg: typeof import('../../settlement/src/registry.js');
    proof: typeof import('../../settlement/src/protocol/proof.js');
    u: { encodeAddress(pk: Uint8Array, prefix: number): string; decodeAddress(a: string): Uint8Array };
  };
}

// Endereço de exemplo (chave pública toda 7), prefixo 42 e 57.
const ADDR42 = '5CDvHBym6RLoxTdX9MS1acpaDbNxaFagqM5LpBiFGjWT6o1n';
const ADDR57 = '6h2pA56ornTiJLhUjLdNF8owusXNQ12VfTPK3SMmDZRmKTqa';

test('carteira do lote: endereço SS58 conferido por inteiro (prefixo 42/57 e soma de verificação)', async t => {
  assert.ok(isLunesAddress(ADDR42));
  assert.ok(isLunesAddress(ADDR57));
  assert.equal(isLunesAddress('1ADRXEpxCcHPze36zV1imej5DNcGZ8puqopyUhbppXyGuhP'), false, 'prefixo 0 (Polkadot) não é LUNES');
  assert.equal(isLunesAddress(ADDR42.slice(0, -1) + (ADDR42.endsWith('n') ? 'm' : 'n')), false, 'um caractere trocado');
  assert.equal(isLunesAddress('5CDvHBym6RLoxTdX9MS1acpaDbNxaFagqM5LpBiFGjWT6o1'), false, 'curto');
  assert.equal(isLunesAddress('lunes:5CDvHBym6RLoxTdX9MS1acpaDbNxaFagqM5LpBiFGjWT6o1n'), false);
  assert.equal(isLunesAddress('0OIl' + ADDR42.slice(4)), false, 'fora do alfabeto base58');
  const s = await validator();
  if (!s) { t.diagnostic('apps/settlement sem dependências: conferência cruzada pulada'); return; }
  // Mesma resposta que o @polkadot/util-crypto, que o validador usa.
  for (let i = 0; i < 50; i++) {
    const pk = deriveNodeKey(newSeed()).pk;
    for (const prefix of [42, 57]) assert.ok(isLunesAddress(s.u.encodeAddress(pk, prefix)));
  }
  // Época igual à do validador, inclusive na virada do ano.
  for (const d of ['2026-01-01', '2026-12-28', '2027-01-03', '2027-01-04', '2020-12-31', '2026-11-03']) {
    const sec = Date.parse(d + 'T12:00:00Z') / 1000;
    assert.equal(epochOf(sec), s.v.epochOf(sec), d);
  }
});

test('evidências e carteira do lote: exportadas no formato do validador, assinadas pelo nó, só pelo dono e com step-up', async t => {
  const cfg = (o: Partial<LnnpConfig> = {}): LnnpConfig => ({ enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 100, ...o });
  const open: RelayHandle[] = [];
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  const R = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100 }); open.push(R);
  const A = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${R.port}`] }), DEFAULT_SETTINGS, { identities: [alice], tickMs: 100 }); open.push(A);
  const B = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${R.port}`] }), DEFAULT_SETTINGS, { identities: [bob], tickMs: 100 }); open.push(B);
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay: R, selfDevice: { name: 'Mini-PC', cls: 'Home Node' } });
  t.after(async () => { await app.close(); await Promise.all(open.map(n => n.close())); });
  const end = Date.now() + 5000;
  while (R.engine.linkCount < 2) { if (Date.now() > end) throw new Error('vizinhos'); await new Promise(r => setTimeout(r, 20)); }
  const m = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('pago?'), now: Math.floor(Date.now() / 1000) });
  A.engine.send(m.bytes);
  while (B.engine.inbox.length < 1) { if (Date.now() > end) throw new Error('entrega'); await new Promise(r => setTimeout(r, 20)); }

  const headers = { host: HOST, origin: `https://${HOST}` };
  const login = async (name: string) => {
    const p = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name } });
    const cookie = String(p.headers['set-cookie']).split(';')[0]!;
    const csrf = (p.json() as { csrf: string }).csrf;
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers: { ...headers, cookie } }),
      post: (url: string, payload: object) => app.inject({ method: 'POST', url, headers: { ...headers, cookie, 'x-csrf-token': csrf }, payload }),
      cookie,
    };
  };
  const dona = await login('Dona');
  const outra = await login('Outra pessoa');
  assert.equal((await app.inject({ method: 'GET', url: '/api/relay/evidence', headers })).statusCode, 401);
  assert.equal((await outra.get('/api/relay/evidence')).statusCode, 403, 'só o dono do equipamento');

  const ev = await dona.get('/api/relay/evidence');
  assert.equal(ev.statusCode, 200);
  assert.match(String(ev.headers['content-disposition']), /^attachment; filename="piu-evidencias-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.json"$/);
  const file = ev.json() as { v: 1; receipts: { envelopeId: string; ackHash: string; nodePk: string; at: number; sig: string }[]; proofs: unknown[] };
  assert.equal(file.v, 1);
  assert.deepEqual(file.proofs, [], 'o piu-node não decifra nada: não tem provas de entrega');
  assert.equal(file.receipts.length, 1);
  assert.deepEqual(Object.keys(file.receipts[0]!).sort(), ['ackHash', 'at', 'envelopeId', 'nodePk', 'sig']);
  assert.equal(file.receipts[0]!.nodePk, toHex(R.engine.node.pk));
  assert.ok(Object.values(file.receipts[0]!).every(x => typeof x === 'number' || /^[0-9a-f]+$/.test(x)), 'binários em hex');

  // Carteira do lote: endereço inválido, época fora, sem step-up, de outro operador → recusados.
  const [epoch, next] = claimableEpochs(Date.now());
  assert.equal((await outra.post('/api/payout-claims', { epoch, address: ADDR42 })).statusCode, 403);
  store.sessionsOf(store.owner()!.id).forEach(s => { s.authAt = 0; });
  const noStep = await dona.post('/api/payout-claims', { epoch, address: ADDR42 });
  assert.equal(noStep.statusCode, 403);
  assert.equal((noStep.json() as { reauth: boolean }).reauth, true);
  assert.equal((await dona.post('/api/reauth', { code: pairing.issue(Date.now()) })).statusCode, 200);
  assert.equal((await dona.post('/api/payout-claims', { epoch, address: ADDR42.replace('5CD', '5CE') })).statusCode, 400);
  assert.equal((await dona.post('/api/payout-claims', { epoch: '2020-S01', address: ADDR42 })).statusCode, 400);
  const ok = await dona.post('/api/payout-claims', { epoch, address: ADDR42 });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal((await dona.post('/api/payout-claims', { epoch: next!, address: ADDR57 })).statusCode, 201);
  const view = (await dona.get('/api/payout-claims')).json() as { epochs: string[]; claims: { epoch: string; address: string }[] };
  assert.deepEqual(view.epochs, [epoch, next]);
  assert.deepEqual(view.claims.map(c => [c.epoch, c.address]), [[epoch, ADDR42], [next, ADDR57]]);

  const cf = await dona.get('/api/payout-claims/file');
  assert.equal(cf.statusCode, 200);
  assert.match(String(cf.headers['content-disposition']), /piu-carteira-[0-9a-f]{8}\.json/);
  const claims = cf.json() as { v: 1; claims: { epoch: string; address: string; nodePk: string; sig: string }[] };
  assert.equal(claims.v, 1);
  for (const c of claims.claims) {
    assert.ok(verifyPayoutClaim({ epoch: c.epoch, address: c.address, nodePk: Uint8Array.from(Buffer.from(c.nodePk, 'hex')), sig: Uint8Array.from(Buffer.from(c.sig, 'hex')) }));
  }

  const s = await validator();
  if (!s) { t.diagnostic('apps/settlement sem dependências: conferência com o validador pulada'); return; }
  // Validador v2 (docs/economia/prova-de-entrega-v2.md): o recibo do nó vale com a prova v2 do
  // destino (assinada por ele, selada para o validador) e o certificado de operador do nó.
  const nowSec = Math.floor(Date.now() / 1000);
  const got = B.engine.inbox[0]!;
  const seed = newSeed();
  const proofKey = s.proof.validatorProofKey(seed);
  const sealed = s.proof.sealDeliveryProof(s.proof.makeDeliveryProof(m.bytes, bob, got.ackSecret, nowSec, proofKey.pk), proofKey.pk);
  const proofFile = { v: 2 as const, sealedProofs: [{ envelopeId: got.id, sealed: toHex(sealed) }] };
  const op = operatorKeyPair(newSeed());
  const regFile = { v: 1 as const, certs: [certToJson(makeCert(op, R.engine.node.pk, nowSec - 60))] };
  const registry = s.reg.NodeRegistry.build([{ v: 1, operators: [{ pk: toHex(op.pk) }] }], [regFile]);
  const ledger = s.v.buildLedger([file, proofFile], [], nowSec, { registry, proofKey });
  assert.deepEqual([...ledger.entries()].map(x => x.state), ['validado']);
  // A prova v1 (segredo em claro) sozinha não paga mais (auditoria 2026-11-06, C-01).
  const v1 = { v: 1 as const, proofs: [{ envelopeId: got.id, ackSecret: toHex(got.ackSecret) }] };
  assert.deepEqual([...s.v.buildLedger([file, v1], [], nowSec, { registry, proofKey }).entries()].map(x => x.state), ['pendente']);
  // Sem certificado de operador admitido, o nó não é registrado.
  const none = s.reg.NodeRegistry.build([{ v: 1, operators: [] }], [regFile]);
  assert.deepEqual([...s.v.buildLedger([file, proofFile], [], nowSec, { registry: none, proofKey }).entries()].map(x => x.reason), ['nó não registrado']);
  for (const c of claims.claims) assert.doesNotThrow(() => s.u.decodeAddress(c.address));
});
