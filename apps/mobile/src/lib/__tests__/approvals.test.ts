/// <reference types="node" />
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { approvalCode, checkCode, pairCode, parsePair, parseRequest } from '../approvals';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const secret = Buffer.alloc(32, 7);

test('aprovação no celular: mesma conta do piu-node (pareamento, conferência e aprovação)', () => {
  const p = parsePair('piup:' + b64({ v: 1, i: 'phone-1', s: secret.toString('base64url'), n: 'piu-node.local', o: 'Ana' }));
  const ref = createHmac('sha256', secret).update('piu/v0/phone-pair').digest().readUInt32BE(0) % 1_000_000;
  assert.equal(pairCode(p), String(ref).padStart(6, '0'));
  const raw = 'piut:' + b64({ v: 1, i: 'tx-1', a: 10, t: 'personal', p: 'phone-1', x: 1_800_000_000, n: 'piu-node.local' });
  const r = parseRequest(raw);
  assert.equal(checkCode(r), String(createHash('sha256').update(raw).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0'));
  // Mesmo algoritmo do nó (base32 sem ambiguidades, 16 caracteres).
  const h = createHmac('sha256', secret).update('piu/v0/approve\n').update(raw).digest();
  const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let bits = 0, acc = 0, out = '';
  for (const byte of h) { acc = (acc << 8) | byte; bits += 8; while (bits >= 5 && out.length < 16) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; } if (out.length >= 16) break; }
  assert.equal(approvalCode(p, r), out);
});

test('aprovação no celular: QR inválido, destino estranho e segredo curto são recusados', () => {
  assert.throws(() => parsePair('piut:xxx'), /pareamento/);
  assert.throws(() => parsePair('piup:' + b64({ v: 1, i: 'x', s: 'AAAA' })), /inválido/);
  assert.throws(() => parseRequest('piut:' + b64({ v: 1, i: 'tx', a: 1, t: 'bitcoin:abc', p: 'p', x: 1 })), /Destino/);
  assert.throws(() => parseRequest('piut:' + b64({ v: 1, i: 'tx', a: -5, t: 'personal', p: 'p', x: 1 })), /inválido/);
});
