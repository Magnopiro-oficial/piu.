/**
 * Caixa de entrada do validador (src/inbox.ts): pacotes que chegam pela malha viram arquivos comuns em
 * evidencias/ e registro/, conferidos depois no close como os compartilhados à mão.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ingestBundle, inboxServer } from '../src/inbox.js';
import { BundleKind, sealBundle } from '../src/protocol/carry.js';
import { validatorProofKey } from '../src/protocol/proof.js';
import { random } from '../src/protocol/suite.js';

const key = validatorProofKey(random(32));
const evidence = { v: 2, receipts: [{ envelopeId: 'ab'.repeat(16), ackHash: 'cd'.repeat(16), nodePk: 'ef'.repeat(32), at: 1_800_000_000, sig: '01'.repeat(64) }], proofs: [], sealedProofs: [] };
const registry = { v: 1, certs: [], revocations: [], phones: [], endorsements: [], exits: [], endorsementRevocations: [] };
const dir = () => mkdtempSync(join(tmpdir(), 'piu-caixa-'));

test('pacote de evidências vira arquivo em evidencias/ (igual ao enviado); repetido não grava de novo', () => {
  const d = dir();
  const sealed = sealBundle(BundleKind.Evidence, JSON.stringify(evidence), key.pk);
  const r = ingestBundle(sealed, key, d);
  assert.ok(r.ok && !r.duplicate && r.kind === 'evidencias');
  assert.deepEqual(JSON.parse(readFileSync(r.file, 'utf8')), evidence);
  const again = ingestBundle(sealed, key, d);
  assert.ok(again.ok && again.duplicate);
  assert.equal(readdirSync(join(d, 'evidencias')).length, 1);
  const reg = ingestBundle(sealBundle(BundleKind.Registry, JSON.stringify(registry), key.pk), key, d);
  assert.ok(reg.ok && reg.kind === 'registro');
});

test('recusa: outra chave, adulterado, JSON inválido, forma errada, campo desconhecido', () => {
  const d = dir();
  const other = validatorProofKey(random(32));
  const fail = (b: Uint8Array) => { const r = ingestBundle(b, key, d); assert.equal(r.ok, false); return r.ok ? '' : r.reason; };
  assert.match(fail(sealBundle(BundleKind.Evidence, JSON.stringify(evidence), other.pk)), /chave/);
  const bad = sealBundle(BundleKind.Evidence, JSON.stringify(evidence), key.pk); bad[70]! ^= 1;
  assert.match(fail(bad), /chave|adulterado/);
  assert.match(fail(sealBundle(BundleKind.Evidence, '{', key.pk)), /JSON/);
  assert.match(fail(sealBundle(BundleKind.Evidence, JSON.stringify({ v: 9 }), key.pk)), /versão/);
  assert.match(fail(sealBundle(BundleKind.Evidence, JSON.stringify({ ...evidence, receipts: [{ envelopeId: 'x', at: 1 }] }), key.pk)), /recibo/);
  assert.match(fail(sealBundle(BundleKind.Registry, JSON.stringify({ ...registry, extra: 1 }), key.pk)), /desconhecido/);
  assert.equal(readdirSync(d).length, 0, 'nada gravado');
});

test('caixa HTTP: POST /caixa grava (202), lixo é 400, outro caminho 404, limite por endereço 429', async t => {
  const d = dir();
  const server = inboxServer({ proofKey: key, dir: d, perMinute: 3 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  const post = (body: Uint8Array, path = '/caixa') => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: body as unknown as BodyInit });
  assert.equal((await post(sealBundle(BundleKind.Evidence, JSON.stringify(evidence), key.pk))).status, 202);
  assert.equal(readdirSync(join(d, 'evidencias')).length, 1);
  assert.equal((await post(random(200))).status, 400);
  assert.equal((await post(random(10), '/outro')).status, 404);
  assert.equal((await post(random(10))).status, 400);
  assert.equal((await post(random(10))).status, 429);
});

test('caixa atrás de proxy (--trust-proxy): o limite é por cliente (X-Forwarded-For), não pelo proxy; cota de arquivos (507)', async t => {
  const d = dir();
  const server = inboxServer({ proofKey: key, dir: d, perMinute: 2, trustProxy: true, maxFiles: 2 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  const post = (body: Uint8Array, xff: string) => fetch(`http://127.0.0.1:${port}/caixa`, { method: 'POST', body: body as unknown as BodyInit, headers: { 'X-Forwarded-For': xff } });
  // Um atacante (1.1.1.1) esgota a cota dele; outro cliente (2.2.2.2) continua passando.
  assert.equal((await post(random(10), '1.1.1.1')).status, 400);
  assert.equal((await post(random(10), '1.1.1.1')).status, 400);
  assert.equal((await post(random(10), '1.1.1.1')).status, 429);
  const ev = (n: number) => sealBundle(BundleKind.Evidence, JSON.stringify({ ...evidence, receipts: [{ ...evidence.receipts[0]!, at: 1_800_000_000 + n }] }), key.pk);
  assert.equal((await post(ev(1), '2.2.2.2')).status, 202);
  assert.equal((await post(ev(2), '3.3.3.3')).status, 202);
  // Cota: 2 arquivos em evidencias/; o terceiro pacote novo é recusado sem gravar.
  assert.equal((await post(ev(3), '4.4.4.4')).status, 507);
  assert.equal(readdirSync(join(d, 'evidencias')).length, 2);
  // Sem --trust-proxy o cabeçalho é ignorado (qualquer um forjaria o endereço).
  const s2 = inboxServer({ proofKey: key, dir: dir(), perMinute: 1 });
  await new Promise<void>(r => s2.listen(0, '127.0.0.1', () => r()));
  t.after(() => new Promise<void>(r => s2.close(() => r())));
  const p2 = (s2.address() as { port: number }).port;
  const post2 = (xff: string) => fetch(`http://127.0.0.1:${p2}/caixa`, { method: 'POST', body: random(10) as unknown as BodyInit, headers: { 'X-Forwarded-For': xff } });
  assert.equal((await post2('5.5.5.5')).status, 400);
  assert.equal((await post2('6.6.6.6')).status, 429);
});
