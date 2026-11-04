import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config, LnnpConfig } from '../src/config.js';
import { OperatorVault } from '../src/operator.js';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import {
  decodeDevicePolicy, decodeDeviceReport, encodeDevicePolicy, encodeDeviceReport, FRAME_DEVICE_POLICY, makeDevicePolicy, makeDeviceReport,
  operatorKeyPair, verifyDevicePolicy, verifyDeviceReport,
} from '../src/relay/operator-frames.js';
import type { LinkPort } from '../src/relay/engine.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { Pairing } from '../src/security/pairing.js';
import { DEFAULT_SETTINGS, Store } from '../src/store.js';

const N = 1 << 14;
function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 64 * 1024, allow: null, beaconMs: 100, ...o };
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

async function panel(relay: RelayHandle | null, name: string, restart?: () => void) {
  const pairing = new Pairing();
  const store = new Store(null);
  const vault = new OperatorVault(null);
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', relay, vault, backupN: N, selfDevice: { name: 'Nó ' + name, cls: 'Home Node' }, restart });
  const pair = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(Date.now()), name } });
  const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
  const csrf = (pair.json() as { csrf: string }).csrf;
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { ...headers, cookie } });
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: { ...headers, cookie, 'x-csrf-token': csrf }, ...(payload ? { payload } : {}) });
  const stepUp = async () => assert.equal((await send('POST', '/api/reauth', { code: pairing.issue(Date.now()) })).statusCode, 200);
  return { app, store, vault, get, send, stepUp, pairing };
}

interface DevView {
  id: string; status: string; self: boolean; parent?: string;
  policy?: { seq: number; applied: boolean };
  report?: { forwarded: number; stored: number; neighbors: number; paused: boolean; relaying: boolean; at: number; startedAt: number };
}

test('ajustes e resumo do equipamento: assinados, codificados sem perda e adulteração invalida', () => {
  const op = operatorKeyPair(newSeed()), node = deriveNodeKey(newSeed());
  const p = makeDevicePolicy(op, node.pk, 7, 1000, { paused: true, limits: { bw: 5, sto: 1, hours: 'night' } });
  const back = decodeDevicePolicy(encodeDevicePolicy(p));
  assert.ok(verifyDevicePolicy(back));
  assert.deepEqual({ seq: back.seq, paused: back.paused, limits: back.limits }, { seq: 7, paused: true, limits: { bw: 5, sto: 1, hours: 'night' } });
  assert.equal(verifyDevicePolicy({ ...back, paused: false }), false, 'pausa trocada invalida');
  assert.equal(verifyDevicePolicy({ ...back, seq: 8 }), false, 'número trocado invalida');
  const free = decodeDevicePolicy(encodeDevicePolicy(makeDevicePolicy(op, node.pk, 1, 1000, { paused: false, limits: null })));
  assert.equal(free.limits, null);
  // Regra fora das opções do assistente: malformado.
  const raw = encodeDevicePolicy(p);
  raw[32 + 32 + 4 + 4 + 1] = 77;
  assert.throws(() => decodeDevicePolicy(raw), /opções/);

  const r = makeDeviceReport(node, { at: 2000, seq: 3, startedAt: 1500, forwarded: 12, stored: 4, receipts: 9, neighbors: 2, paused: true, relaying: false, policySeq: 7 });
  const rb = decodeDeviceReport(encodeDeviceReport(r));
  assert.ok(verifyDeviceReport(rb));
  assert.deepEqual({ ...rb, sig: null, nodePk: null }, { ...r, sig: null, nodePk: null });
  assert.equal(verifyDeviceReport({ ...rb, forwarded: 13 }), false);
});

test('equipamento remoto do mesmo operador: pausa e regras chegam assinadas, valem no motor dele e voltam no resumo', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-remoto-'));
  const trustFile = join(dir, 'operator-trust.json');
  const open: RelayHandle[] = [];
  const A = await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 50, reportMs: 200 });
  open.push(A);
  const bKey = deriveNodeKey(newSeed());
  let B = await startRelay(bKey, cfg({ peers: [`127.0.0.1:${A.port}`] }), DEFAULT_SETTINGS, { tickMs: 50, reportMs: 200, trustFile });
  open.push(B);
  const pa = await panel(A, 'Ana');
  const pb = await panel(B, 'Ana');
  t.after(async () => { await pa.app.close(); await pb.app.close(); await Promise.all(open.map(n => n.close())); rmSync(dir, { recursive: true, force: true }); });

  // B passa a ser do mesmo operador (backup da chave de A restaurado nele).
  await pa.stepUp();
  const backup = ((await pa.send('POST', '/api/operator/backup', { password: 'uma senha bem longa' })).json() as { backup: string }).backup;
  await pb.stepUp();
  assert.equal((await pb.send('POST', '/api/operator/restore', { backup, password: 'uma senha bem longa' })).statusCode, 200);
  await until(() => A.engine.stats().neighbors.some(n => n.sameOperator) && B.engine.stats().neighbors.some(n => n.sameOperator), 'A e B do mesmo operador');

  // B registrado no painel de A pela identidade técnica.
  const created = await pa.send('POST', '/api/devices', { name: 'Mini-PC da sala', cls: 'Home Node', family: 'minipc', nodePk: toHex(bKey.pk) });
  assert.equal(created.statusCode, 201, created.body);
  const id = (created.json() as { id: string }).id;
  const view = async () => ((await pa.get('/api/devices')).json() as DevView[]).find(d => d.id === id)!;

  // Resumo assinado de B chega a A: contadores do motor dele.
  await until(() => !!A.engine.deviceReport(toHex(bKey.pk)), 'resumo de B em A');
  const first = await view();
  assert.ok(first.report);
  assert.equal(first.report.neighbors, 1);
  assert.equal(first.report.paused, false);
  assert.equal(first.report.relaying, true);
  assert.equal(first.policy, undefined, 'nada a mandar enquanto está ativo e sem regras');

  // Pausar B pelo painel de A: vale no motor de B.
  const paused = await pa.send('POST', `/api/devices/${id}/pause`);
  assert.equal(paused.statusCode, 200);
  assert.equal((paused.json() as { status: string }).status, 'paused');
  await until(() => B.engine.pausedNow && !B.engine.relaying, 'B pausado');
  assert.equal(B.engine.isPaused, false, 'não é a pausa local do painel de B');
  const bs = B.engine.stats();
  assert.equal(bs.paused, true);
  assert.equal(bs.operatorPolicy?.paused, true);
  // O resumo de B confirma: A mostra "aplicado".
  await until(() => A.engine.deviceReport(toHex(bKey.pk))?.report.paused === true, 'resumo de B pausado');
  const afterPause = await view();
  assert.equal(afterPause.policy?.applied, true);
  assert.equal(afterPause.report?.paused, true);

  // Regras de B pelo painel de A: o menor entre o global de B e as regras vale lá.
  assert.equal((await pa.send('PUT', `/api/devices/${id}/limits`, { bw: 5, sto: 1, hours: 'always' })).statusCode, 200);
  await until(() => B.engine.effective.bw === 5, 'regras em B');
  assert.deepEqual(B.engine.effective, { bw: 5, sto: 1, hours: ['always', 'always'] });
  assert.equal(B.engine.router.limits.maxBytes, 1024 ** 3);

  // Retomar.
  assert.equal(((await pa.send('POST', `/api/devices/${id}/pause`)).json() as { status: string }).status, 'active');
  await until(() => !B.engine.pausedNow && B.engine.relaying, 'B retomado');
  const seqNow = B.engine.operatorPolicy!.seq;

  // Replay: um ajuste antigo (pausado, número menor) mandado de novo por A não volta a valer.
  const linkTo = (h: RelayHandle, pk: Uint8Array) => [...((h.engine as unknown as { links: Map<string, LinkPort> }).links.values())].find(l => toHex(l.session.peerPk) === toHex(pk))!;
  const opKey = pa.vault.keyPair(pa.store.owner()!.id)!;
  const old = makeDevicePolicy(opKey, bKey.pk, seqNow - 1, Math.floor(Date.now() / 1000), { paused: true, limits: null });
  const la = linkTo(A, bKey.pk);
  la.send(la.session.seal(FRAME_DEVICE_POLICY, encodeDevicePolicy(old)));
  // Forjado: assinado por outra chave de operador, com número maior.
  const rejected = B.engine.counters.rejected;
  const forged = makeDevicePolicy(operatorKeyPair(newSeed()), bKey.pk, seqNow + 50, Math.floor(Date.now() / 1000), { paused: true, limits: null });
  la.send(la.session.seal(FRAME_DEVICE_POLICY, encodeDevicePolicy(forged)));
  // Do futuro (além da tolerância do relógio): recusado.
  const future = makeDevicePolicy(opKey, bKey.pk, seqNow + 60, Math.floor(Date.now() / 1000) + 3600, { paused: true, limits: null });
  la.send(la.session.seal(FRAME_DEVICE_POLICY, encodeDevicePolicy(future)));
  await until(() => B.engine.counters.rejected >= rejected + 2, 'forjado e do futuro recusados');
  assert.equal(B.engine.pausedNow, false);
  assert.equal(B.engine.operatorPolicy!.seq, seqNow);

  // Pausar de novo e reiniciar B sem enlace com A: continua pausado (o ajuste fica no disco, conferido de novo).
  assert.equal(((await pa.send('POST', `/api/devices/${id}/pause`)).json() as { status: string }).status, 'paused');
  await until(() => B.engine.pausedNow, 'B pausado de novo');
  await pb.app.close();
  await B.close();
  open.splice(open.indexOf(B), 1);
  B = await startRelay(bKey, cfg(), DEFAULT_SETTINGS, { tickMs: 50, reportMs: 200, trustFile });
  open.push(B);
  assert.equal(B.engine.pausedNow, true);
  assert.equal(B.engine.relaying, false);
  assert.deepEqual(B.engine.effective, { bw: 5, sto: 1, hours: ['always', 'always'] });
});

test('reiniciar pelo painel: só o próprio nó, só o dono, com step-up; sai depois da resposta', async t => {
  let restarts = 0;
  const p = await panel(null, 'Ana', () => { restarts++; });
  const outro = await p.app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: p.pairing.issue(Date.now()), name: 'Beto' } });
  const bc = String(outro.headers['set-cookie']).split(';')[0]!, bcsrf = (outro.json() as { csrf: string }).csrf;
  t.after(() => p.app.close());
  const self = ((await p.get('/api/devices')).json() as DevView[]).find(d => d.self)!;
  const other = (await p.send('POST', '/api/devices', { name: 'Roteador', cls: 'Home Node', family: 'router' })).json() as { id: string };
  assert.equal((await p.send('POST', `/api/devices/${other.id}/restart`)).statusCode, 409, 'outro equipamento');
  // Outro operador não vê o equipamento (404, sem revelar o id).
  assert.equal((await p.app.inject({ method: 'POST', url: `/api/devices/${self.id}/restart`, headers: { ...headers, cookie: bc, 'x-csrf-token': bcsrf } })).statusCode, 404);
  // Sem confirmação recente: pede step-up.
  p.store.sessionsOf(p.store.owner()!.id)[0]!.authAt = 0;
  const late = await p.send('POST', `/api/devices/${self.id}/restart`);
  assert.equal(late.statusCode, 403);
  assert.equal((late.json() as { reauth: boolean }).reauth, true);
  assert.equal(restarts, 0);
  await p.stepUp();
  const ok = await p.send('POST', `/api/devices/${self.id}/restart`);
  assert.equal(ok.statusCode, 202);
  assert.deepEqual(ok.json(), { restarting: true });
  await until(() => restarts === 1, 'reinício chamado');

  // Sem supervisor ligado (sem `restart`): 409 com o motivo.
  const q = await panel(null, 'Ana');
  t.after(() => q.app.close());
  const qs = ((await q.get('/api/devices')).json() as DevView[]).find(d => d.self)!;
  assert.equal((await q.send('POST', `/api/devices/${qs.id}/restart`)).statusCode, 409);
});

test('ponto de acesso com nó pai: validado (do mesmo operador, com Piu Node), guardado e mostrado', async t => {
  const p = await panel(null, 'Ana');
  t.after(() => p.app.close());
  const self = ((await p.get('/api/devices')).json() as DevView[]).find(d => d.self)!;
  const ap = { name: 'Repetidor', cls: 'Ponto de Acesso', family: 'ap', pub: 'piu.praca' };
  const r = await p.send('POST', '/api/devices', { ...ap, parent: self.id });
  assert.equal(r.statusCode, 201, r.body);
  const created = r.json() as DevView;
  assert.equal(created.parent, self.id);
  assert.equal(((await p.get('/api/devices')).json() as DevView[]).find(d => d.id === created.id)?.parent, self.id);
  // Id que não é de equipamento seu, AP como pai, pai em equipamento que não é AP, id malformado.
  assert.equal((await p.send('POST', '/api/devices', { ...ap, parent: '00000000-0000-4000-8000-000000000000' })).statusCode, 404);
  assert.equal((await p.send('POST', '/api/devices', { ...ap, parent: created.id })).statusCode, 400);
  assert.equal((await p.send('POST', '/api/devices', { name: 'Mini', cls: 'Home Node', family: 'minipc', parent: self.id })).statusCode, 400);
  assert.equal((await p.send('POST', '/api/devices', { ...ap, parent: 'x' })).statusCode, 400);
  // Pai removido: o ponto de acesso fica sem nó pai.
  const mini = (await p.send('POST', '/api/devices', { name: 'Mini', cls: 'Home Node', family: 'minipc' })).json() as DevView;
  const ap2 = (await p.send('POST', '/api/devices', { ...ap, pub: 'piu.feira', parent: mini.id })).json() as DevView;
  assert.equal((await p.send('DELETE', `/api/devices/${mini.id}`)).statusCode, 204);
  assert.equal(((await p.get('/api/devices')).json() as DevView[]).find(d => d.id === ap2.id)?.parent, undefined);
});
