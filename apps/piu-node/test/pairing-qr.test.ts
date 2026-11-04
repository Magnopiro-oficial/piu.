import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { test } from 'node:test';
import { generate } from 'selfsigned';
import { pairPayload } from '../src/security/approval.js';

const decode = (qr: string) => JSON.parse(Buffer.from(qr.slice(5), 'base64url').toString()) as Record<string, unknown>;

test('QR de pareamento do celular: impressão digital do certificado e endereço, quando houver', async () => {
  const pems = await generate([{ name: 'commonName', value: 'piu-node.local' }], { keySize: 2048, algorithm: 'sha256' } as never);
  const fp = new X509Certificate(pems.cert).fingerprint256;
  const j = decode(pairPayload({ phoneId: 'p1', secret: Buffer.alloc(32, 1), node: 'piu-node.local', operator: 'Ana', fingerprint: fp, url: 'https://piu-node.local:8420' }));
  assert.equal(j.f, fp);
  // Mesmo formato que o app aceita (apps/mobile/src/lib/nodeApi.ts, normalizePin): 32 bytes em hex.
  assert.match(String(j.f).replace(/:/g, ''), /^[0-9A-F]{64}$/);
  assert.equal(j.u, 'https://piu-node.local:8420');
  const bare = decode(pairPayload({ phoneId: 'p1', secret: Buffer.alloc(32, 1), node: 'n', operator: '' }));
  assert.ok(!('f' in bare) && !('u' in bare), 'sem certificado, o QR não inventa impressão digital nem endereço');
});
