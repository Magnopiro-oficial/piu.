/**
 * Achados de severidade baixa da auditoria de 09/11/2026 na frente piu-node: pareamento por origem,
 * log sem metadado de presença, variáveis numéricas validadas e teto de enlaces por IP.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, loadLnnpConfig, type LnnpConfig } from '../src/config.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { RelayEngine, type RelayHandle, startRelay } from '../src/relay/index.js';
import { LanAdapter } from '../src/relay/lan.js';
import { DEFAULT_SETTINGS } from '../src/store.js';
import { Pairing } from '../src/security/pairing.js';

async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const wrongOf = (code: string) => (code === '12345678' ? '87654321' : '12345678');

test('pareamento: erros de uma origem bloqueiam só aquela origem; o código segue valendo para as outras', () => {
  const p = new Pairing();
  const code = p.issue(0);
  const res = Array.from({ length: 5 }, () => p.verify(wrongOf(code), 1, '10.0.0.66'));
  assert.deepEqual(res, ['invalid', 'invalid', 'invalid', 'invalid', 'blocked']);
  assert.equal(p.verify(code, 2, '10.0.0.66'), 'blocked', 'a origem bloqueada não testa mais nada, nem o código certo');
  assert.equal(p.active, true);
  assert.equal(p.verify(code, 3, '10.0.0.7'), 'ok', 'o dono, em outro endereço, ainda pareia');
});

test('pareamento: há teto total de erros por código, mesmo trocando de origem', () => {
  const p = new Pairing();
  const code = p.issue(0);
  const res: string[] = [];
  for (let i = 0; i < 20; i++) res.push(p.verify(wrongOf(code), 1, `10.0.1.${i}`));
  assert.equal(res.at(-1), 'locked');
  assert.ok(res.slice(0, -1).every(r => r === 'invalid'));
  assert.equal(p.active, false);
});

test('pareamento: sem origem informada, continua como antes (5 erros destroem o código)', () => {
  const p = new Pairing();
  const code = p.issue(0);
  const res = Array.from({ length: 5 }, () => p.verify(wrongOf(code), 1));
  assert.deepEqual(res, ['invalid', 'invalid', 'invalid', 'invalid', 'locked']);
});

test('config: porta, memória e intervalo de anúncio inválidos recusam a subida', () => {
  for (const [k, v] of [
    ['PIU_LNNP_BEACON_MS', '5s'], ['PIU_LNNP_BEACON_MS', '0'], ['PIU_LNNP_BEACON_MS', '200'],
    ['PIU_LNNP_MEMORY_MB', 'muito'], ['PIU_LNNP_MEMORY_MB', '0'], ['PIU_LNNP_MEMORY_MB', '1.5'],
    ['PIU_LNNP_PORT', 'abc'], ['PIU_LNNP_PORT', '70000'], ['PIU_LNNP_PORT', '-1'],
  ]) assert.throws(() => loadLnnpConfig({ [k!]: v }), new RegExp(`${k}: valor inválido`), `${k}=${v}`);
  assert.throws(() => loadConfig({ PIU_NODE_PORT: '84x0' }), /PIU_NODE_PORT: valor inválido/);
  // Linha em branco no arquivo de ambiente vale o padrão (antes virava 0).
  const c = loadLnnpConfig({ PIU_LNNP_BEACON_MS: '', PIU_LNNP_MEMORY_MB: '', PIU_LNNP_PORT: '' });
  assert.equal(c.beaconMs, 5000); assert.equal(c.memoryMB, 256); assert.equal(c.port, 8422);
  // Valores válidos (inclusive porta 0, usada nos testes do pacote e no smoke do desktop).
  const d = loadLnnpConfig({ PIU_LNNP_BEACON_MS: '1000', PIU_LNNP_MEMORY_MB: '16', PIU_LNNP_PORT: '0' });
  assert.equal(d.beaconMs, 1000); assert.equal(d.memoryMB, 16); assert.equal(d.port, 0);
  assert.equal(loadConfig({ PIU_NODE_PORT: '9000' }).port, 9000);
});

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}

test('log: entrada e saída de vizinho não gravam o id inteiro nem o endereço', async t => {
  const lines: string[] = [];
  const R = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100, handshakeTimeoutMs: 1500, log: m => lines.push(m) });
  const A = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100, handshakeTimeoutMs: 1500 });
  t.after(async () => { await A.close(); await R.close(); });
  A.addPeer(`127.0.0.1:${R.port}`);
  await until(() => R.engine.linkCount === 1, 'A–R conectados');
  await A.close();
  await until(() => R.engine.linkCount === 0, 'A saiu');
  const peer = A.engine.stats().node;
  const presence = lines.filter(l => /vizinho .* (conectado|desconectado)/.test(l));
  assert.equal(presence.length, 2, presence.join('\n'));
  for (const l of presence) {
    assert.ok(!l.includes(peer), `id inteiro no log: ${l}`);
    assert.ok(!l.includes('127.0.0.1'), `endereço no log: ${l}`);
  }
});

test('LNNP: teto de enlaces estabelecidos por IP de origem', async t => {
  const engine = new RelayEngine({ node: deriveNodeKey(newSeed()), relay: true, memoryBytes: 1 << 24 });
  const lan = new LanAdapter(engine, { listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], beaconMs: 200, tickMs: 100, handshakeTimeoutMs: 1500, maxLinksPerIp: 2 });
  const { port } = await lan.start();
  const xs: RelayHandle[] = [];
  t.after(async () => { await Promise.all(xs.map(x => x.close())); await lan.stop(); });
  for (let i = 0; i < 4; i++) {
    const x = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100, handshakeTimeoutMs: 1500 });
    xs.push(x);
    x.addPeer(`127.0.0.1:${port}`);
  }
  await until(() => engine.linkCount === 2, 'dois enlaces do mesmo IP');
  await sleep(800); // várias rodadas de reconexão dos outros dois
  assert.equal(engine.linkCount, 2, 'o mesmo IP não passa do teto');
  // Um sai: a vaga do IP volta.
  const inside = xs.filter(x => engine.hasPeer(x.engine.stats().node));
  await inside[0]!.close();
  await until(() => engine.linkCount === 2 && !engine.hasPeer(inside[0]!.engine.stats().node), 'vaga reaproveitada');
});
