import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { utf8 } from '../../mobile/src/protocol/bytes';
import { envelopeId, HEADER_BYTES, HOP_OFFSET, MsgType, sealDirect } from '../../mobile/src/protocol/envelope';
import { deriveIdentity, newSeed, toPublic } from '../../mobile/src/protocol/keys';
import { GuardianNode, nativeEnvelopeId } from '../src/main/guardian/guardianNode';
import { pointKey } from '../src/main/guardian/guardian';
import { packRecords, type StoredRecord, unpackRecords } from '../src/main/guardian/sealed';
import type { Transport, TransportEvent } from '../src/transport/types';

function fakeTransport() {
  let fn: ((e: TransportEvent) => void) | null = null;
  const t: Transport = {
    kind: 'lan', state: 'running' as never, linkCount: 0,
    start: async () => {}, stop: async () => {}, send: async () => {},
    subscribe: f => { fn = f; return () => { fn = null; }; },
    peerStatus: () => [],
  };
  return { t, emit: (e: TransportEvent) => fn?.(e) };
}

/**
 * Envelopes distintos e válidos para o roteador sem selar um a um: o cabeçalho de um envelope real com um
 * corpo de 4 bytes (contador). O ponto não abre nada, só lê o cabeçalho; menor = carga do teste mais rápida.
 */
function envelopes(n: number, now: number): Uint8Array[] {
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  const head = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now }).bytes.slice(0, HEADER_BYTES);
  new DataView(head.buffer).setUint32(HEADER_BYTES - 4, 4);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) { const b = new Uint8Array(HEADER_BYTES + 4); b.set(head); new DataView(b.buffer).setUint32(HEADER_BYTES, i); out.push(b); }
  return out;
}

test('ponto: reconhecer ao ligar um vizinho que trouxe 131 mil envelopes guardados leva bem menos de 3 s', async () => {
  const N = 131_072;
  const now = Math.floor(Date.now() / 1000);
  const key = pointKey(newSeed());
  const ft = fakeTransport();
  const node = new GuardianNode({ key, transport: ft.t, limits: { maxBytes: N * 4096, retentionSec: 3 * 86400 }, now: () => now });
  const A = 'a1b2c3d4e5f60718', B = '0f1e2d3c4b5a6978';
  // Como o store.bin guarda (sealed.ts): SHA-256(HMAC(chave do ponto, 'piu/ponto/vizinho/sal/' + pid) || sal), 16 hex.
  const kp = (id: string) => createHmac('sha256', key.sk).update(`piu/ponto/vizinho/sal/${node.pid(id)}`).digest();
  const kA = kp(A), kB = kp(B);
  const name = (k: Buffer, salt: string) => createHash('sha256').update(k).update(salt, 'hex').digest('hex').slice(0, 16);
  const recs: StoredRecord[] = envelopes(N, now).map(bytes => {
    const salt = randomBytes(16).toString('hex');
    return { bytes, from: name(kA, salt), storedAt: now, dropAt: now + 86400, sentTo: [name(kB, salt)], copies: 1, salt };
  });
  assert.equal(node.importStored(recs), N);
  await node.start();
  // Guarda que não depende da velocidade da máquina: reconhecer corrige no lugar, numa chamada, sem tirar e
  // devolver ao roteador (cada volta recalculava o id do envelope inteiro).
  const calls: Record<string, number> = {};
  const r = node.router as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['amendStored', 'importStored', 'exportStored', 'forget', 'ingest']) {
    const orig = r[m]!.bind(node.router);
    r[m] = (...a: unknown[]) => { calls[m] = (calls[m] ?? 0) + 1; return orig(...a); };
  }
  const t0 = performance.now();
  ft.emit({ type: 'connected', id: A, pk: '', address: '' });
  const ms = performance.now() - t0;
  assert.deepEqual(calls, { amendStored: 1 }, 'reconhecer: só uma correção no lugar');
  const pa = node.pid(A);
  const after = node.router.exportStored();
  assert.equal(after.length, N, 'nenhum envelope perdido ao reconhecer');
  assert.ok(after.every(e => e.from === pa), 'todos voltam a saber quem trouxe');
  assert.ok(ms < 3000, `reconhecer levou ${ms.toFixed(0)} ms para ${N} registros`);
  for (const m of Object.keys(calls)) delete (calls as Record<string, number>)[m];
  const t1 = performance.now();
  ft.emit({ type: 'connected', id: B, pk: '', address: '' });
  const ms2 = performance.now() - t1;
  assert.deepEqual(calls, { amendStored: 1 });
  assert.ok(node.router.exportStored().every(e => e.sentTo.includes(node.pid(B))), 'para quem já foi também volta');
  assert.ok(ms2 < 3000, `reconhecer (para quem já foi) levou ${ms2.toFixed(0)} ms`);
  await node.stop();
});

test('ponto: o id nativo do envelope é o mesmo de envelopeId (inclusive com saltos diferentes)', () => {
  const now = Math.floor(Date.now() / 1000);
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  for (const len of [0, 1, 400, 5000]) {
    const b = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: randomBytes(len), now }).bytes;
    assert.equal(nativeEnvelopeId(b), envelopeId(b));
    const hops = b[HOP_OFFSET]!, h = b.slice(); h[HOP_OFFSET] = (hops + 3) & 0xff;
    assert.equal(nativeEnvelopeId(h), envelopeId(b), 'o salto não entra no id');
    assert.equal(h[HOP_OFFSET], (hops + 3) & 0xff, 'não altera o envelope');
  }
  // Recorte de um buffer maior (como sai do store.bin): só os bytes do recorte.
  const b = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi'), now }).bytes;
  const big = new Uint8Array(b.length + 10); big.set(b, 7);
  assert.equal(nativeEnvelopeId(big.subarray(7, 7 + b.length)), envelopeId(b));
});

test('ponto: ligar com 131 mil envelopes reais (593 bytes) guardados e encerrar levam bem menos de 5 s (antes, 20 a 60 s)', () => {
  const N = 131_072;
  const now = Math.floor(Date.now() / 1000);
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  // Envelope real de 593 bytes (o do relato), distinto por um contador no corpo: o ponto só lê o cabeçalho.
  const real = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: new Uint8Array(100), now }).bytes;
  assert.equal(real.length, 593);
  const recs: StoredRecord[] = [];
  for (let i = 0; i < N; i++) {
    const bytes = real.slice(); new DataView(bytes.buffer).setUint32(HEADER_BYTES, i);
    recs.push({ bytes, from: null, storedAt: now, dropAt: now + 86400, sentTo: [], copies: 0, salt: randomBytes(16).toString('hex') });
  }
  const node = new GuardianNode({ key: pointKey(newSeed()), transport: fakeTransport().t, limits: { maxBytes: N * 4096, retentionSec: 7 * 86400 }, now: () => now });
  const t0 = performance.now();
  assert.equal(node.importStored(recs), N);
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `carregar levou ${ms.toFixed(0)} ms para ${N} envelopes de ${real.length} bytes`);
  // Gravação montada num Buffer só (sem tempo aqui: com a suíte em paralelo, a coleta de lixo domina a medida).
  const disk = packRecords(node.exportStored());
  const back = unpackRecords(disk);
  assert.equal(back.length, N);
  assert.deepEqual(new Set(back.map(r => r.salt)), new Set(recs.map(r => r.salt)), 'todos os registros, cada um com o seu sal');
  assert.ok(back.every(r => r.bytes.length === real.length && r.dropAt === Math.floor((now + 86400) / 3600) * 3600));
  const t1 = performance.now();
  node.wipe();
  const ms2 = performance.now() - t1;
  assert.equal(node.stats().stored, 0);
  assert.ok(ms2 < 5000, `encerrar (apagar tudo) levou ${ms2.toFixed(0)} ms`);
});
