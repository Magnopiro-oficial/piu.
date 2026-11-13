import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadLnnpConfig } from '../src/config.js';
import { utf8 } from '../src/protocol/bytes.js';
import { MsgType, sealDirect } from '../src/protocol/envelope.js';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../src/protocol/keys.js';
import type { StoredEnvelope } from '../src/protocol/router.js';
import { RelayEngine } from '../src/relay/engine.js';
import { encodeSnapshot, RelayStore, storeKey } from '../src/relay/persist.js';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/store.js';

const MiB = 1024 ** 2;
const person = () => deriveIdentity(newSeed(), 'public');
const letter = (text: string) => sealDirect({ from: person(), to: toPublic(person()), type: MsgType.Text, body: utf8(text), now: Math.floor(Date.now() / 1000) });
const kept = (bytes: Uint8Array, o: Partial<StoredEnvelope> = {}): StoredEnvelope => ({ bytes, from: 'vizinho', own: false, storedAt: 10, dropAt: 9e9, sentTo: [], copies: 0, releaseAt: 10, ...o });
const tmp = () => mkdtempSync(join(tmpdir(), 'piu-disco-'));
const envFiles = (dir: string) => readdirSync(join(dir, 'env')).filter(f => f.endsWith('.bin')).sort();

test('disco: cada mensagem num arquivo próprio, gravado uma vez; a que saiu some do disco', t => {
  const root = tmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'lnnp', 'relay-store');
  const key = storeKey(deriveNodeKey(newSeed()));
  const a = letter('primeira '.repeat(800)), b = letter('segunda '.repeat(800)), c = letter('terceira');

  const st = new RelayStore(dir, key);
  assert.equal(st.load(), null, 'nada salvo ainda');
  st.save({ envelopes: [kept(a.bytes, { sentTo: ['x'], copies: 1 }), kept(b.bytes, { own: true, from: null })], seen: [[a.id, 9e9]], receipts: [] }, 1000);
  const files = envFiles(dir);
  assert.equal(files.length, 2);
  // Só o usuário do serviço lê; nada em claro; o estado não carrega as mensagens.
  assert.equal(statSync(join(dir, 'env', files[0]!)).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'env')).mode & 0o777, 0o700);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.ok(statSync(join(dir, 'state.bin')).size < a.bytes.length + b.bytes.length, 'estado sem os bytes das mensagens');
  for (const f of files) assert.ok(!readFileSync(join(dir, 'env', f)).includes(Buffer.from(a.bytes.subarray(-32))), 'mensagem não fica como veio');
  const before = new Map(files.map(f => [f, statSync(join(dir, 'env', f)).mtimeMs]));

  // Segunda gravação: a que já estava não é reescrita; a que saiu é apagada; a nova entra.
  st.save({ envelopes: [kept(a.bytes, { sentTo: ['x', 'y'], copies: 2 }), kept(c.bytes)], seen: [[a.id, 9e9]], receipts: [] }, 2000);
  const after = envFiles(dir);
  assert.equal(after.length, 2);
  const keptName = files.find(f => after.includes(f));
  assert.ok(keptName, 'a primeira continua com o mesmo arquivo');
  assert.equal(statSync(join(dir, 'env', keptName!)).mtimeMs, before.get(keptName!), 'não foi regravada');

  // Reabrindo: bytes e o que mudou (a quem foi, cópias) voltam.
  const back = new RelayStore(dir, key).load()!;
  assert.equal(back.envelopes.length, 2);
  const ea = back.envelopes.find(e => Buffer.from(e.bytes).equals(Buffer.from(a.bytes)))!;
  assert.deepEqual({ sentTo: ea.sentTo, copies: ea.copies, from: ea.from, own: ea.own }, { sentTo: ['x', 'y'], copies: 2, from: 'vizinho', own: false });
  assert.ok(back.envelopes.some(e => Buffer.from(e.bytes).equals(Buffer.from(c.bytes))));
  assert.deepEqual(back.seen, [[a.id, 9e9]]);
});

test('disco: arquivo de mensagem adulterado ou trocado de nome não volta; sobra sem estado é apagada', t => {
  const dir = tmp();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = storeKey(deriveNodeKey(newSeed()));
  const a = letter('a'), b = letter('b');
  const st = new RelayStore(dir, key);
  st.save({ envelopes: [kept(a.bytes), kept(b.bytes)], seen: [], receipts: [] }, 1000);
  const [fa, fb] = envFiles(dir);
  // Troca o conteúdo de um pelo do outro (o nome amarra o conteúdo) e adultera o outro.
  writeFileSync(join(dir, 'env', fa!), readFileSync(join(dir, 'env', fb!)));
  const raw = readFileSync(join(dir, 'env', fb!)); raw[raw.length - 1] ^= 1; writeFileSync(join(dir, 'env', fb!), raw);
  // Sobra de uma gravação interrompida: arquivo que o estado não conhece.
  writeFileSync(join(dir, 'env', 'f'.repeat(64) + '.bin'), 'sobra');
  const logs: string[] = [];
  const again = new RelayStore(dir, key, { log: m => logs.push(m) });
  assert.equal(again.load()!.envelopes.length, 0);
  assert.ok(logs.some(l => l.includes('2')), 'avisa quantas ficaram de fora');
  again.save({ envelopes: [], seen: [], receipts: [] }, 2000);
  assert.deepEqual(envFiles(dir), [], 'o que não vale mais sai do disco');
});

test('disco: estado de outro nó ou corrompido é posto de lado e o nó sobe vazio', t => {
  const dir = tmp();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  new RelayStore(dir, storeKey(deriveNodeKey(newSeed()))).save({ envelopes: [kept(letter('x').bytes)], seen: [], receipts: [] }, 1);
  const logs: string[] = [];
  assert.equal(new RelayStore(dir, storeKey(deriveNodeKey(newSeed())), { log: m => logs.push(m) }).load(), null);
  assert.ok(existsSync(join(dir, 'state.bin.corrompido')));
  assert.ok(logs.some(l => l.includes('ilegível')));
});

test('migração: o arquivo único antigo (relay-store.bin) vira o formato novo e só sai depois de gravado', t => {
  const root = tmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const key = storeKey(deriveNodeKey(newSeed()));
  const legacyFile = join(root, 'relay-store.bin');
  const a = letter('de antes');
  writeFileSync(legacyFile, encodeSnapshot({ envelopes: [kept(a.bytes, { copies: 3 })], seen: [[a.id, 9e9]], receipts: [] }, key, 1), { mode: 0o600 });
  const st = new RelayStore(join(root, 'relay-store'), key, { legacyFile });
  const snap = st.load()!;
  assert.equal(snap.envelopes.length, 1);
  assert.equal(snap.envelopes[0]!.copies, 3);
  assert.ok(existsSync(legacyFile), 'ainda não gravou no formato novo: o antigo fica');
  st.save(snap, 2);
  assert.equal(envFiles(join(root, 'relay-store')).length, 1);
  assert.ok(!existsSync(legacyFile), 'gravado no formato novo: o antigo sai');
  assert.equal(new RelayStore(join(root, 'relay-store'), key, { legacyFile }).load()!.envelopes.length, 1);
});

test('espaço para guardar mensagens: opções em MB que o nó cumpre; ajustes antigos em GB viram o padrão', () => {
  assert.equal(DEFAULT_SETTINGS.limits.sto, 256);
  // Antes: 4, 8 ou 16 "GB", que na prática eram 256 MB (memória reservada). Continua valendo o mesmo.
  for (const old of [4, 8, 16]) {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, sto: old } } as unknown as Settings);
    assert.equal(s.limits.sto, 256, `sto ${old}`);
  }
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, sto: 512 } }).limits.sto, 512);
  // A memória reservada por padrão cabe a maior opção.
  assert.equal(loadLnnpConfig({}).memoryMB, 512);
  const e = new RelayEngine({ node: deriveNodeKey(newSeed()), relay: true, memoryBytes: loadLnnpConfig({}).memoryMB * MiB });
  for (const sto of [128, 256, 512] as const) {
    e.applySettings({ ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, sto } });
    assert.equal(e.router.limits.maxBytes, sto * MiB, `${sto} MB valem de verdade`);
    assert.equal(e.stats().limits.effective.stoMB, sto);
  }
  // Regra do equipamento (em GB, na malha) continua valendo como teto.
  e.applySettings({ ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits, sto: 512 } }, { bw: 50, sto: 1, hours: 'always' });
  assert.equal(e.effective.stoMB, 512);
});

test('disco: o nome do arquivo não revela qual mensagem está guardada (só este nó calcula)', t => {
  const dir = tmp();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = letter('quem tem esta mensagem não confirma que ela está aqui');
  new RelayStore(dir, storeKey(deriveNodeKey(newSeed()))).save({ envelopes: [kept(a.bytes)], seen: [], receipts: [] }, 1);
  const [name] = envFiles(dir);
  // Antes: SHA-256 dos bytes. Qualquer um com o envelope (ele passa pela malha) achava o arquivo.
  assert.notEqual(name, `${createHash('sha256').update(a.bytes).digest('hex')}.bin`);
  // Outro nó com a mesma mensagem: outro nome.
  const other = tmp();
  t.after(() => rmSync(other, { recursive: true, force: true }));
  new RelayStore(other, storeKey(deriveNodeKey(newSeed()))).save({ envelopes: [kept(a.bytes)], seen: [], receipts: [] }, 1);
  assert.notEqual(envFiles(other)[0], name);
});
