import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { toHex, utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, type Identity, newSeed, toPublic } from '../src/protocol/keys.js';
import type { Counters } from '../src/relay/engine.js';
import { dayKey, RelayHistory, type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

const counters = (o: Partial<Counters> = {}): Counters => ({
  received: 0, stored: 0, forwarded: 0, delivered: 0, duplicates: 0, rejected: 0, relayOff: 0, full: 0, expired: 0,
  receipts: 0, receiptsReceived: 0, handshakesOk: 0, handshakesFailed: 0, ...o,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'piu-hist-'));

test('histórico: amostras com a diferença dos contadores, totais por dia, arquivo 0600 e volta depois de reiniciar', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'lnnp', 'relay-history.json');
    let clock = new Date(2026, 10, 3, 23, 50).getTime();
    const h = new RelayHistory(file, () => clock);
    h.record(counters({ received: 10, forwarded: 8, receipts: 4, duplicates: 2 }), { neighbors: 2, storedBytes: 900 });
    clock += 5 * 60_000;
    h.record(counters({ received: 15, forwarded: 12, receipts: 6, duplicates: 2 }), { neighbors: 3, storedBytes: 1200 });
    clock += 10 * 60_000; // passou da meia-noite
    h.record(counters({ received: 16, forwarded: 13, receipts: 7, duplicates: 2 }), { neighbors: 3, storedBytes: 1000 });
    const v = h.view(300_000);
    assert.deepEqual(v.samples.map(s => s.received), [10, 5, 1], 'cada amostra é o que aconteceu na rodada');
    assert.deepEqual(v.samples.map(s => s.neighbors), [2, 3, 3]);
    assert.deepEqual(v.days.map(d => [d.day, d.receipts, d.forwarded]), [['2026-11-03', 6, 12], ['2026-11-04', 1, 1]]);
    assert.equal(statSync(file).mode & 0o777, 0o600, 'só o usuário do serviço lê');
    assert.equal(statSync(join(dir, 'lnnp')).mode & 0o777, 0o700);
    // Sem dado sensível no arquivo: só contagens e horários.
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort(), ['days', 'samples']);

    // Reiniciou: os contadores do motor voltam a zero; nada é contado duas vezes nem se perde.
    const h2 = new RelayHistory(file, () => clock);
    assert.equal(h2.view(1).days.length, 2, 'carregou do disco');
    clock += 60_000;
    h2.record(counters({ received: 3, receipts: 1 }), { neighbors: 1, storedBytes: 0 });
    assert.equal(h2.view(1).days.at(-1)!.received, 4);
    assert.equal(h2.view(1).days.at(-1)!.receipts, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('histórico: tamanho limitado (24 h de amostras, 120 dias) e arquivo corrompido não derruba o nó', () => {
  const dir = tmp();
  try {
    const file = join(dir, 'relay-history.json');
    writeFileSync(file, '{"samples":[{"at":"x"},{"at":1,"received":-5}],"days":[{"day":"../../etc"},{"day":"2026-01-01","receipts":"9"}]}');
    let clock = new Date(2026, 0, 1, 12).getTime();
    const h = new RelayHistory(file, () => clock);
    const v0 = h.view(1);
    assert.equal(v0.samples.length, 0, 'amostra sem horário válido ou antiga demais sai');
    assert.deepEqual(v0.days, [{ day: '2026-01-01', received: 0, stored: 0, forwarded: 0, duplicates: 0, rejected: 0, relayOff: 0, full: 0, expired: 0, receipts: 0, receiptsReceived: 0 }], 'valor com tipo errado vira zero');
    let c = 0;
    for (let i = 0; i < 200; i++) { clock += 86_400_000; h.record(counters({ received: ++c }), { neighbors: 0, storedBytes: 0 }); }
    const v = h.view(1);
    assert.equal(v.days.length, 120);
    assert.equal(v.days.at(-1)!.day, dayKey(clock));
    assert.ok(v.samples.every(s => s.at >= clock - 24 * 3_600_000), 'só as últimas 24 h');
    try { readFileSync(file + '.tmp'); assert.fail('arquivo temporário ficou'); } catch (e) { assert.equal((e as NodeJS.ErrnoException).code, 'ENOENT'); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── API com motores de verdade ──────────────────────────
const nodes: RelayHandle[] = [];
const cfg = (o: Partial<LnnpConfig> = {}): LnnpConfig => ({ enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, sampleMs: 3_600_000, ...o });
async function node(o: Partial<LnnpConfig> = {}, id?: Identity) {
  const n = await startRelay(deriveNodeKey(newSeed()), cfg(o), DEFAULT_SETTINGS, { identities: id ? [id] : [], tickMs: 100 });
  nodes.push(n);
  return n;
}
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

test('API: histórico, recibos e equipamento próprio exigem sessão, trazem dados reais e nenhum segredo', async t => {
  t.after(async () => { await Promise.all(nodes.splice(0).map(n => n.close())); });
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  const R = await node();
  const A = await node({ peers: [`127.0.0.1:${R.port}`] }, alice);
  await until(() => R.engine.stats().neighbors.length === 1, 'A–R conectados');
  const m = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now: Math.floor(Date.now() / 1000) });
  A.engine.send(m.bytes);
  await until(() => R.engine.router.has(m.id), 'R guardar o envelope');
  // Um vizinho a mais, para R repassar (e assinar o recibo na primeira cópia).
  await node({ peers: [`127.0.0.1:${R.port}`] });
  await until(() => R.engine.counters.receipts >= 1, 'R assinar o recibo');
  R.sample();

  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay: R, selfDevice: { name: 'Mini-PC', cls: 'Home Node' } });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };

  for (const url of ['/api/relay/history', '/api/relay/receipts']) {
    assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 401, `${url} sem sessão`);
    assert.equal((await app.inject({ method: 'GET', url, headers: { ...headers, cookie: '__Host-piu_session=forjado' } })).statusCode, 401, `${url} cookie forjado`);
  }
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name: 'Dona' } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  const csrf = (pair.json() as { csrf: string }).csrf;
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { ...headers, cookie } });

  const h = await get('/api/relay/history');
  assert.equal(h.statusCode, 200);
  assert.equal(h.headers['cache-control'], 'no-store');
  const hv = h.json() as { enabled: boolean; sampleMs: number; samples: { forwarded: number; receipts: number }[]; days: { day: string; receipts: number; received: number }[] };
  assert.equal(hv.enabled, true);
  assert.equal(hv.sampleMs, 3_600_000);
  assert.equal(hv.days.at(-1)!.day, dayKey(Date.now()));
  assert.ok(hv.days.at(-1)!.receipts >= 1 && hv.days.at(-1)!.received >= 1, 'recibos e recebidos de verdade');
  assert.ok(hv.samples.at(-1)!.forwarded >= 1);

  const r = await get('/api/relay/receipts');
  assert.equal(r.statusCode, 200);
  const rv = r.json() as { kept: number; keptOwn: number; recent: Record<string, unknown>[] };
  assert.ok(rv.keptOwn >= 1);
  assert.deepEqual(Object.keys(rv.recent[0]!).sort(), ['at', 'own']);
  assert.equal(rv.recent[0]!.own, true);
  // Nem id de envelope, nem chave do nó, nem o hash do segredo de entrega.
  for (const body of [r.body, h.body]) {
    assert.equal(body.includes(m.id), false);
    assert.equal(body.includes(toHex(R.engine.node.pk)), false);
    assert.equal(body.includes(toHex(R.engine.receiptLog[0]!.ackHash)), false);
  }

  // O próprio nó aparece como equipamento da dona; pausar vale no motor, remover não pode.
  const devs = (await get('/api/devices')).json() as { id: string; name: string; self: boolean }[];
  assert.deepEqual(devs.map(d => [d.name, d.self]), [['Mini-PC', true]]);
  const mut = (method: 'POST' | 'DELETE', url: string) => app.inject({ method, url, headers: { ...headers, cookie, 'x-csrf-token': csrf } });
  assert.equal((await mut('POST', `/api/devices/${devs[0]!.id}/pause`)).statusCode, 200);
  assert.equal(R.engine.relaying, false, 'pausado no painel: não retransmite');
  assert.equal(((await get('/api/relay')).json() as { paused: boolean }).paused, true);
  assert.equal((await mut('POST', `/api/devices/${devs[0]!.id}/pause`)).statusCode, 200);
  assert.equal(R.engine.relaying, true);
  assert.equal((await mut('DELETE', `/api/devices/${devs[0]!.id}`)).statusCode, 409);

  // Carteira sem valor de exemplo: começa em zero, sem movimentações.
  assert.deepEqual((await get('/api/wallet')).json(), { balance: 0, txs: [] });
});

test('API: sem motor de retransmissão, histórico e recibos respondem enabled: false', async t => {
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const pairing = new Pairing();
  const app = await buildApp({ config, store: new Store(null), pairing, packages: [], packagesDir: '/nao-usado', relay: null });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name: 'Dona' } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  for (const url of ['/api/relay/history', '/api/relay/receipts']) assert.deepEqual((await app.inject({ method: 'GET', url, headers: { ...headers, cookie } })).json(), { enabled: false });
});
