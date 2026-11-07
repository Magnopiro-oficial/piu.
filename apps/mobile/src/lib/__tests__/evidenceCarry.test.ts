/// <reference types="node" />
/**
 * Evidências e registro pela malha (lib/evidenceCarry.ts), a ponte carteira ↔ mensageiro e a entrega
 * HTTPS do gateway à caixa do validador (lib/carryConfig.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BundleKind, CarryKind, MAX_BUNDLE_BYTES, openBundle } from '../../protocol/carry';
import { validatorProofKey } from '../../protocol/proof';
import { random } from '../../protocol/suite';
import type { EvidenceFile } from '../../messaging/evidence';
import { carryBridge } from '../carryBridge';
import { bundlePoster, VALIDATOR_INBOX_URL } from '../carryConfig';
import { evidenceParts, registryParts, sealEvidence, sealRegistry } from '../evidenceCarry';
import type { PhoneRegistryFile } from '../phoneNodeCore';

const h = (n: number, len: number) => n.toString(16).padStart(len, '0');
function bigEvidence(n: number): EvidenceFile {
  return {
    v: 2,
    receipts: Array.from({ length: n }, (_, i) => ({ envelopeId: h(i, 32), ackHash: h(i, 32), nodePk: 'ab'.repeat(32), at: 1_800_000_000 + i, sig: 'cd'.repeat(64) })),
    proofs: [{ envelopeId: h(1, 32), ackSecret: h(2, 32) }],
    sealedProofs: Array.from({ length: 30 }, (_, i) => ({ envelopeId: h(i, 32), sealed: 'ef'.repeat(330) })),
  };
}

test('evidências em partes: cada parte é um arquivo válido sozinho e nada se perde', () => {
  const file = bigEvidence(300);
  const parts = evidenceParts(file);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(new TextEncoder().encode(JSON.stringify(p)).length < MAX_BUNDLE_BYTES - 200);
  assert.equal(parts.reduce((a, p) => a + p.receipts.length, 0), 300);
  assert.equal(parts.reduce((a, p) => a + p.sealedProofs.length, 0), 30);
  assert.equal(parts.reduce((a, p) => a + p.proofs.length, 0), 1);
  assert.ok(parts.every(p => p.v === 2 && Array.isArray(p.receipts) && Array.isArray(p.proofs) && Array.isArray(p.sealedProofs)));
});

test('selado só para o validador; sem chave publicada nada vai pela malha', () => {
  const v = validatorProofKey(random(32));
  const sealed = sealEvidence(bigEvidence(80), v.pk);
  assert.ok(sealed.length >= 2);
  const back = sealed.map(s => openBundle(s, v)!);
  assert.ok(back.every(b => b.kind === BundleKind.Evidence));
  assert.equal(back.reduce((a, b) => a + (JSON.parse(b.json) as EvidenceFile).receipts.length, 0), 80);
  assert.deepEqual(sealEvidence(bigEvidence(5), null), []);
  assert.deepEqual(sealRegistry(null, v.pk), []);
});

test('registro em partes: cabeçalho (registro, avais, saída) na primeira, certificados divididos', () => {
  const cert = (d: number) => ({ operatorPk: 'aa'.repeat(32), nodePk: h(d, 64), from: d * 86400, sig: 'bb'.repeat(64) });
  const file = { v: 1, certs: Array.from({ length: 67 }, (_, d) => cert(d)), revocations: [], phones: [{ operatorPk: 'aa'.repeat(32) } as never], endorsements: [{ e: 1 } as never], exits: [], endorsementRevocations: [] } as unknown as PhoneRegistryFile;
  const parts = registryParts(file);
  assert.equal(parts[0]!.phones.length, 1);
  assert.equal(parts[0]!.endorsements.length, 1);
  assert.ok(parts.slice(1).every(p => p.phones.length === 0 && p.endorsements.length === 0));
  assert.equal(parts.reduce((a, p) => a + p.certs.length, 0), 67);
  const v = validatorProofKey(random(32));
  const sealed = sealRegistry(file, v.pk);
  assert.equal(sealed.length, parts.length);
  assert.equal(openBundle(sealed[0]!, v)!.kind, BundleKind.Registry);
});

test('ponte carteira ↔ mensageiro: sem malha lança; com malha solta e repassa recibos', () => {
  carryBridge.setCarrier(null);
  assert.equal(carryBridge.available(), false);
  assert.throws(() => carryBridge.carry({ kind: CarryKind.Evidence, sealed: new Uint8Array(4) }, '00'), /não está pronta/);
  const got: string[] = [];
  carryBridge.setCarrier((_item, ref) => ({ envelopeId: 'e'.repeat(32), expiresAt: 1 + ref.length }));
  assert.equal(carryBridge.carry({ kind: CarryKind.Evidence, sealed: new Uint8Array(4) }, 'abc').expiresAt, 4);
  const off = carryBridge.onReceipt(id => got.push(id));
  carryBridge.onReceipt(() => { throw new Error('ouvinte com erro'); });
  carryBridge.receipt('x', { about: CarryKind.Tx, ref: new Uint8Array(32), status: 'pool' });
  off();
  carryBridge.receipt('y', { about: CarryKind.Tx, ref: new Uint8Array(32), status: 'pool' });
  assert.deepEqual(got, ['x']);
  carryBridge.setCarrier(null);
});

test('caixa do validador: nula de fábrica; só HTTPS; POST binário com o pacote', async () => {
  assert.equal(VALIDATOR_INBOX_URL, null, 'não inventar endereço');
  assert.equal(bundlePoster(null), null);
  assert.equal(bundlePoster('http://inseguro.example/caixa'), null);
  const calls: { url: string; body: unknown; method?: string }[] = [];
  const post = bundlePoster('https://validador.example/caixa', (async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body, method: init?.method }); return { ok: calls.length > 1, status: 503 } as Response; }) as typeof fetch)!;
  assert.deepEqual(await post(Uint8Array.of(1, 2)), { ok: false, error: 'HTTP 503' });
  assert.deepEqual(await post(Uint8Array.of(1, 2)), { ok: true });
  assert.equal(calls[0]!.method, 'POST');
  assert.deepEqual(calls[0]!.body, Uint8Array.of(1, 2));
});
