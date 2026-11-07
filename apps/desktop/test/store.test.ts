import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyState } from '../src/shared/conversations';
import { DEFAULT_PREFS } from '../src/shared/types';
import { type AppState, Store, StoreUnreadableError } from '../src/main/store';

const state = (): AppState => ({ v: 1, messenger: '{"v":1,"segredo":"abc"}', conversations: emptyState(), prefs: { ...DEFAULT_PREFS, displayName: 'Lucas' } });

test('armazenamento: grava cifrado (AES-256-GCM) e lê de volta igual', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-store-'));
  try {
    const key = randomBytes(32);
    const st = new Store(join(dir, 'state.bin'), key);
    assert.equal(st.load(), null);
    st.save(state());
    const raw = readFileSync(join(dir, 'state.bin'));
    assert.ok(!raw.toString('latin1').includes('segredo'), 'o estado das sessões não pode ficar em claro');
    assert.ok(!raw.toString('latin1').includes('Lucas'));
    assert.deepEqual(new Store(join(dir, 'state.bin'), key).load(), state());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('armazenamento (A-01): chave errada ou arquivo adulterado → erro (não `null`); a cópia ilegível vai para quarentena, nunca é sobrescrita', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-store-'));
  try {
    const file = join(dir, 'state.bin');
    new Store(file, randomBytes(32)).save(state());
    const original = readFileSync(file);
    const other = new Store(file, randomBytes(32));
    assert.throws(() => other.load(), (e: unknown) => e instanceof StoreUnreadableError);
    const key = randomBytes(32);
    const st = new Store(file, key);
    assert.throws(() => st.load(), StoreUnreadableError);
    // Quarentena: renomeia para state.bin.corrupt-<ts> e o próximo `save` começa num arquivo novo.
    const moved = st.quarantine();
    assert.ok(moved && /state\.bin\.corrupt-\d+$/.test(moved));
    assert.deepEqual(readFileSync(moved!), original, 'o arquivo antigo fica guardado como estava');
    assert.equal(st.load(), null, 'sem state.bin: começa limpo');
    st.save(state());
    assert.deepEqual(readFileSync(moved!), original);
    const raw = readFileSync(file);
    raw[raw.length - 1] ^= 0xff;
    require('node:fs').writeFileSync(file, raw);
    assert.throws(() => st.load(), StoreUnreadableError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('armazenamento: gravação atômica não deixa arquivo temporário para trás', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-store-'));
  try {
    const st = new Store(join(dir, 'state.bin'), randomBytes(32));
    st.save(state());
    st.save(state());
    assert.deepEqual(require('node:fs').readdirSync(dir), ['state.bin']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
