import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LnnpConfig } from '../src/config.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, type Identity, newSeed, toPublic } from '../src/protocol/keys.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { decodeSnapshot, encodeSnapshot, storeKey } from '../src/relay/persist.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

function cfg(o: Partial<LnnpConfig> = {}): LnnpConfig {
  return { enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200, ...o };
}
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
const person = () => deriveIdentity(newSeed(), 'public');
const letter = (from: Identity, to: Identity, text: string) =>
  sealDirect({ from, to: toPublic(to), type: MsgType.Text, body: utf8(text), now: Math.floor(Date.now() / 1000) });

test('reinício: mensagens guardadas, ids vistos e recibos voltam do disco (0600, cifrado); sem entrega duplicada', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-persist-'));
  const open: RelayHandle[] = [];
  t.after(async () => { await Promise.all(open.map(n => n.close())); rmSync(dir, { recursive: true, force: true }); });
  const file = join(dir, 'lnnp', 'relay-store.bin');
  const seed = newSeed();
  const relay = async (peers: string[] = []) => { const n = await startRelay(deriveNodeKey(seed), cfg({ peers }), DEFAULT_SETTINGS, { tickMs: 100, storeFile: file }); open.push(n); return n; };
  const alice = person(), bob = person();

  let R = await relay();
  const A = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${R.port}`] }), DEFAULT_SETTINGS, { identities: [alice], tickMs: 100 });
  open.push(A);
  await until(() => R.engine.linkCount === 1, 'A–R conectados');
  const m = letter(alice, bob, 'sobrevive ao reinício');
  A.engine.send(m.bytes);
  await until(() => R.engine.router.has(m.id), 'R guardar');
  // Um terceiro vizinho (sem Bob) recebe a cópia: o recibo é assinado antes do reinício.
  const C = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${R.port}`] }), DEFAULT_SETTINGS, { tickMs: 100 });
  open.push(C);
  await until(() => R.engine.receiptLog.length === 1, 'recibo assinado');
  await C.close(); open.splice(open.indexOf(C), 1);
  await A.close(); open.splice(open.indexOf(A), 1);
  await R.close(); open.splice(open.indexOf(R), 1);

  // Arquivo: só o usuário do serviço lê; o conteúdo não aparece em claro.
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'lnnp')).mode & 0o777, 0o700);
  assert.ok(!readFileSync(file).includes(Buffer.from(m.id)), 'id do envelope não fica em claro');

  R = await relay();
  assert.ok(R.engine.router.has(m.id), 'a mensagem voltou');
  assert.equal(R.engine.receiptLog.length, 1, 'o recibo voltou');
  assert.equal(R.engine.stats().store.restored.envelopes, 1);
  // O mesmo envelope chegando de novo (outro caminho, replay) é duplicata.
  assert.equal(R.engine.router.ingest(m.bytes, 'outro', Math.floor(Date.now() / 1000)).status, 'duplicate');
  // Bob aparece: recebe uma vez, e o reinício não gerou recibo novo.
  const B = await startRelay(deriveNodeKey(newSeed()), cfg({ peers: [`127.0.0.1:${R.port}`] }), DEFAULT_SETTINGS, { identities: [bob], tickMs: 100 });
  open.push(B);
  await until(() => B.engine.inbox.length === 1, 'Bob receber');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(B.engine.inbox.length, 1);
  assert.equal(R.engine.receiptLog.length, 1);
});

test('reinício: arquivo corrompido ou de outro nó não derruba o nó; vencido não volta', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-persist-'));
  const open: RelayHandle[] = [];
  t.after(async () => { await Promise.all(open.map(n => n.close())); rmSync(dir, { recursive: true, force: true }); });
  const file = join(dir, 'relay-store.bin');
  writeFileSync(file, 'lixo que não é um armazenamento', { mode: 0o600 });
  const logs: string[] = [];
  const node = deriveNodeKey(newSeed());
  const n = await startRelay(node, cfg(), DEFAULT_SETTINGS, { tickMs: 100, storeFile: file, log: x => logs.push(x) });
  open.push(n);
  assert.equal(n.engine.router.size, 0);
  assert.ok(existsSync(file + '.corrompido'), 'posto de lado');
  assert.ok(logs.some(l => l.includes('ilegível')));

  // De outro nó (chave diferente): não abre.
  const other = encodeSnapshot({ envelopes: [], seen: [['ab', 9e9]], receipts: [] }, storeKey(deriveNodeKey(newSeed())), Date.now());
  assert.equal(decodeSnapshot(other, storeKey(node)), null);
  // Do mesmo nó, adulterado: não abre.
  const mine = encodeSnapshot({ envelopes: [], seen: [], receipts: [] }, storeKey(node), Date.now());
  mine[mine.length - 1] ^= 1;
  assert.equal(decodeSnapshot(mine, storeKey(node)), null);

  // Vencido enquanto o nó estava desligado: não volta.
  const alice = person(), bob = person();
  const curto = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('curta'), now: Math.floor(Date.now() / 1000) - 3600, ttlSec: 600 });
  const snap = encodeSnapshot({ envelopes: [{ bytes: curto.bytes, from: 'x', own: false, storedAt: 0, dropAt: 9e9, sentTo: [], copies: 0, releaseAt: 0 }], seen: [[curto.id, 1]], receipts: [] }, storeKey(node), Date.now());
  const file2 = join(dir, 'b.bin');
  writeFileSync(file2, snap, { mode: 0o600 });
  const n2 = await startRelay(node, cfg(), DEFAULT_SETTINGS, { tickMs: 100, storeFile: file2 });
  open.push(n2);
  assert.equal(n2.engine.router.size, 0);
  assert.equal(n2.engine.router.stats().seen, 0);
});
