import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { OperatorVault } from '../src/operator.js';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { decodeCert, decodeRevocationList, encodeCert, encodeRevocationList, makeCert, makeRevocationList, makeRotation, operatorKeyPair, trustPath, verifyCert, verifyRevocationList } from '../src/relay/operator-frames.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

const N = 1 << 14; // scrypt mais barato só nos testes

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 100, ...o };
}
async function until(cond: () => boolean, what: string, ms = 6000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

const HOST = 'piu-node.local:8420';
const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
const headers = { host: HOST, origin: `https://${HOST}` };

/** Painel de um nó: pareia uma operadora e dá atalhos para a API (com step-up quando pedido). */
async function panel(relay: RelayHandle | null, name: string, vault = new OperatorVault(null)) {
  const pairing = new Pairing();
  const store = new Store(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay, vault, backupN: N, selfDevice: { name: 'Nó ' + name, cls: 'Home Node' } });
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  const csrf = (pair.json() as { csrf: string }).csrf;
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { ...headers, cookie } });
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: { ...headers, cookie, 'x-csrf-token': csrf }, ...(payload ? { payload } : {}) });
  const stepUp = async () => assert.equal((await send('POST', '/api/reauth', { code: pairing.issue(Date.now()) })).statusCode, 200);
  return { app, store, vault, get, send, stepUp };
}

test('chave de operador: certificado, rotação e lista de revogação conferem e se codificam sem perda', () => {
  const X = operatorKeyPair(newSeed()), Y = operatorKeyPair(newSeed()), node = deriveNodeKey(newSeed());
  const step = makeRotation(X, Y.pk, 100);
  const cert = makeCert(Y, node.pk, 200, [step]);
  const back = decodeCert(encodeCert(cert));
  assert.ok(verifyCert(back));
  // Quem confia em X passa a confiar em Y pela cadeia; quem não confia em nada da cadeia, não.
  assert.deepEqual(trustPath(back, new Set([toHex(X.pk)])), [toHex(Y.pk)]);
  assert.equal(trustPath(back, new Set([toHex(operatorKeyPair(newSeed()).pk)])), null);
  // Passo forjado (assinado por outra chave) não leva a lugar nenhum.
  const forged = makeCert(Y, node.pk, 200, [{ ...step, sig: makeRotation(Y, Y.pk, 100).sig }]);
  assert.equal(trustPath(forged, new Set([toHex(X.pk)])), null);
  const list = makeRevocationList(Y, 3, 300, [node.pk, node.pk]);
  const lb = decodeRevocationList(encodeRevocationList(list));
  assert.ok(verifyRevocationList(lb));
  assert.equal(lb.revoked.length, 1, 'sem repetição');
  assert.equal(verifyRevocationList({ ...lb, seq: 4 }), false, 'número trocado invalida');
});

test('chave de operador: backup cifrado com senha, restauração e rotação (arquivo 0600)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-op-'));
  try {
    const v = new OperatorVault(dir);
    const pk = toHex(v.ensure('op1', 1000).pk);
    assert.equal(statSync(join(dir, 'operator', 'keys.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'operator')).mode & 0o777, 0o700);
    await assert.rejects(v.backup('op1', 'Ana', 'curta', 2000, { N }), /10 caracteres/);
    const file = await v.backup('op1', 'Ana', 'uma senha bem longa', 2000, { N });
    assert.equal(file.includes(pk), false, 'a chave não aparece em claro');
    assert.equal(JSON.parse(file).piu, 'operator-backup');
    // Em outro nó: senha errada não abre; a certa traz a mesma chave.
    const other = new OperatorVault(null);
    await assert.rejects(other.restore('op9', file, 'senha errada demais'), /Senha errada/);
    await assert.rejects(other.restore('op9', file.replace(/"N":16384/, '"N":1024'), 'uma senha bem longa'), /fora do esperado/);
    await other.restore('op9', file, 'uma senha bem longa');
    assert.equal(toHex(other.keyPair('op9')!.pk), pk);
    // Rotação: chave nova, a antiga assina a nova; a revogação passa para a nova com número maior.
    const victim = deriveNodeKey(newSeed()).pk;
    const l1 = v.revoke('op1', [victim], 3000);
    const r = v.rotate('op1', 4000);
    assert.equal(r.previous, pk);
    assert.notEqual(r.current, pk);
    assert.deepEqual(v.lineage('op1'), [pk, r.current]);
    const l2 = v.revocation('op1')!;
    assert.ok(l2.seq > l1.seq && toHex(l2.operatorPk) === r.current && verifyRevocationList(l2));
    assert.deepEqual(l2.revoked.map(toHex), [toHex(victim)]);
    assert.equal(v.info('op1')!.rotations, 1);
    // Reabre do disco igual.
    assert.equal(toHex(new OperatorVault(dir).keyPair('op1')!.pk), r.current);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('API: backup e rotação exigem step-up; o próprio nó sai assinado pela chave de operador', async t => {
  const R = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100 });
  const p = await panel(R, 'Ana');
  t.after(async () => { await p.app.close(); await R.close(); });
  const info = (await p.get('/api/operator')).json() as { fingerprint: string[]; publicKey: string; owner: boolean; rotations: number; signedDevices: number };
  assert.equal(info.fingerprint.length, 8);
  assert.ok(info.fingerprint.every(g => /^[0-9A-F]{4}$/.test(g)));
  assert.equal(info.owner, true);
  assert.equal(info.signedDevices, 1);
  const self = ((await p.get('/api/devices')).json() as { self: boolean; nodeId: string; signed: boolean }[])[0]!;
  assert.equal(self.nodeId, toHex(R.engine.node.pk).slice(0, 16));
  assert.equal(self.signed, true);
  assert.equal(R.engine.operatorCert && toHex(R.engine.operatorCert.operatorPk), info.publicKey, 'o motor anuncia o certificado');

  // Sem confirmação recente: pede step-up.
  for (const [url, body] of [['/api/operator/backup', { password: 'uma senha bem longa' }], ['/api/operator/rotate', undefined]] as const) {
    // A sessão do pareamento já conta como autenticação recente: vence depois de 15 min. Simula com authAt antigo.
    p.store.sessionsOf(p.store.owner()!.id)[0]!.authAt = 0;
    const r = await p.send('POST', url, body);
    assert.equal(r.statusCode, 403);
    assert.equal((r.json() as { reauth: boolean }).reauth, true);
  }
  await p.stepUp();
  const b = await p.send('POST', '/api/operator/backup', { password: 'uma senha bem longa' });
  assert.equal(b.statusCode, 200);
  const bv = b.json() as { filename: string; backup: string };
  assert.equal(bv.filename, 'piu-operador.backup');
  assert.equal(bv.backup.includes(info.publicKey), false);
  const rot = await p.send('POST', '/api/operator/rotate');
  assert.equal(rot.statusCode, 200);
  const after = (await p.get('/api/operator')).json() as { publicKey: string; rotations: number };
  assert.notEqual(after.publicKey, info.publicKey);
  assert.equal(after.rotations, 1);
  // O certificado do próprio nó foi assinado de novo pela chave nova.
  assert.equal(toHex(R.engine.operatorCert!.operatorPk), after.publicKey);
  assert.equal(((await p.get('/api/devices')).json() as { signed: boolean }[])[0]!.signed, true);
});

test('revogação: o nó revogado tem o handshake recusado aqui e nos vizinhos do mesmo operador; rotação chega na sincronização', async t => {
  const open: RelayHandle[] = [];
  const relay = async (peers: string[] = []) => { const n = await startRelay(deriveNodeKey(newSeed()), cfg({ peers }), DEFAULT_SETTINGS, { tickMs: 100 }); open.push(n); return n; };
  const A = await relay();
  const B = await relay([`127.0.0.1:${A.port}`]);
  const pa = await panel(A, 'Ana');
  const pb = await panel(B, 'Ana');
  t.after(async () => { await pa.app.close(); await pb.app.close(); await Promise.all(open.map(n => n.close())); });

  // B passa a ser do mesmo operador restaurando o backup da chave de A.
  await pa.stepUp();
  const backup = ((await pa.send('POST', '/api/operator/backup', { password: 'uma senha bem longa' })).json() as { backup: string }).backup;
  await pb.stepUp();
  assert.equal((await pb.send('POST', '/api/operator/restore', { backup, password: 'uma senha bem longa' })).statusCode, 200);
  const opPk = ((await pa.get('/api/operator')).json() as { publicKey: string }).publicKey;
  assert.equal(((await pb.get('/api/operator')).json() as { publicKey: string }).publicKey, opPk);
  // Os dois se reconhecem como do mesmo operador (certificado trocado depois do handshake).
  await until(() => A.engine.stats().neighbors.some(n => n.sameOperator) && B.engine.stats().neighbors.some(n => n.sameOperator), 'A e B do mesmo operador');

  // V: um equipamento de Ana, ligado aos dois e registrado em A pela identidade técnica.
  const V = await relay([`127.0.0.1:${A.port}`, `127.0.0.1:${B.port}`]);
  await until(() => V.engine.linkCount === 2, 'V ligado a A e B');
  const vpk = toHex(V.engine.node.pk);
  const created = await pa.send('POST', '/api/devices', { name: 'Roteador da sala', cls: 'Home Node', family: 'router', nodePk: vpk });
  assert.equal(created.statusCode, 201, created.body);
  const dev = created.json() as { id: string; nodeId: string; signed: boolean };
  assert.equal(dev.nodeId, vpk.slice(0, 16));
  assert.equal(dev.signed, true);
  // A mesma identidade de novo, ou a do próprio nó: recusado.
  assert.equal((await pa.send('POST', '/api/devices', { name: 'De novo', cls: 'Home Node', family: 'router', nodePk: vpk })).statusCode, 409);
  assert.equal((await pa.send('POST', '/api/devices', { name: 'Eu', cls: 'Home Node', family: 'linux', nodePk: toHex(A.engine.node.pk) })).statusCode, 409);

  // Revogar: A fecha o enlace com V e manda a lista assinada a B, que também fecha e passa a recusar.
  const del = await pa.send('DELETE', `/api/devices/${dev.id}`);
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), { revoked: true, appliedHere: true });
  await until(() => B.engine.revokedKeys.includes(vpk), 'B receber a lista de revogação');
  await until(() => V.engine.linkCount === 0, 'V sem enlaces');
  const refusedA = A.engine.counters.revokedRefused, refusedB = B.engine.counters.revokedRefused;
  // V continua tentando (vizinhos fixos): os dois recusam o handshake.
  await until(() => A.engine.counters.revokedRefused > refusedA && B.engine.counters.revokedRefused > refusedB, 'handshakes de V recusados');
  assert.equal(V.engine.linkCount, 0);
  assert.equal(A.engine.linkCount, 1, 'A–B continua');
  // Registrar de novo a identidade revogada: recusado.
  assert.equal((await pa.send('POST', '/api/devices', { name: 'Volta', cls: 'Home Node', family: 'router', nodePk: vpk })).statusCode, 409);

  // Rotação em A: B recebe a chave nova na sincronização e a revogação continua valendo (lista nova).
  await pa.stepUp();
  assert.equal((await pa.send('POST', '/api/operator/rotate')).statusCode, 200);
  const head = ((await pa.get('/api/operator')).json() as { publicKey: string }).publicKey;
  await until(() => B.engine.lineage.at(-1) === head, 'B aprender a chave nova');
  await until(() => B.engine.operatorList?.seq === A.engine.operatorList?.seq, 'B com a lista assinada pela chave nova');
  assert.ok(B.engine.revokedKeys.includes(vpk));
  assert.equal(((await pb.get('/api/operator')).json() as { rotatedElsewhere: boolean }).rotatedElsewhere, true);
});

test('limites do equipamento: salvos pela API e aplicados ao motor quando é o próprio nó', async t => {
  const R = await startRelay(deriveNodeKey(newSeed()), { ...cfg(), memoryMB: 64 * 1024 }, DEFAULT_SETTINGS, { tickMs: 100 });
  const p = await panel(R, 'Ana');
  t.after(async () => { await p.app.close(); await R.close(); });
  const self = ((await p.get('/api/devices')).json() as { id: string }[])[0]!;
  // Fora das opções do assistente: recusado.
  assert.equal((await p.send('PUT', `/api/devices/${self.id}/limits`, { bw: 100, sto: 4, hours: 'always' })).statusCode, 400);
  const r = await p.send('PUT', `/api/devices/${self.id}/limits`, { bw: 5, sto: 1, hours: 'night' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual((r.json() as { limits: object }).limits, { bw: 5, sto: 1, hours: 'night' });
  // O menor entre o global (50 Mbps, 8 GB, sempre) e o do equipamento; os dois horários valem.
  assert.deepEqual(R.engine.effective, { bw: 5, sto: 1, hours: ['always', 'night'] });
  assert.equal(R.engine.router.limits.maxBytes, 1024 ** 3);
  const h = new Date().getHours();
  assert.equal(R.engine.relaying, h >= 22 || h < 7, 'fora das 22h–7h não retransmite');
  // O global mais apertado continua valendo.
  assert.equal((await p.send('PUT', '/api/settings', { limits: { bw: 20, sto: 4, hours: 'always' }, policies: { media: true, unknown: true, community: false } })).statusCode, 200);
  assert.deepEqual(R.engine.effective, { bw: 5, sto: 1, hours: ['always', 'night'] });
  // Equipamento novo pelo assistente leva as regras junto.
  const d = await p.send('POST', '/api/devices', { name: 'Mini-PC', cls: 'Home Node', family: 'minipc', limits: { bw: 20, sto: 4, hours: 'day' } });
  assert.equal(d.statusCode, 201, d.body);
  assert.deepEqual((d.json() as { limits: object }).limits, { bw: 20, sto: 4, hours: 'day' });
  assert.deepEqual(R.engine.effective.hours, ['always', 'night'], 'regras de outro equipamento não mexem neste motor');
  // Limpar: só os globais.
  assert.equal((await p.send('PUT', `/api/devices/${self.id}/limits`, { clear: true })).statusCode, 200);
  assert.deepEqual(R.engine.effective, { bw: 20, sto: 4, hours: ['always'] });
});
