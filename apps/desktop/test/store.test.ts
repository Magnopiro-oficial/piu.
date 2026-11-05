import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyState } from '../src/shared/conversations';
import { DEFAULT_PREFS } from '../src/shared/types';
import { type AppState, Store } from '../src/main/store';

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

test('armazenamento: chave errada ou arquivo adulterado → null (o app começa limpo, não quebra)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-store-'));
  try {
    const file = join(dir, 'state.bin');
    new Store(file, randomBytes(32)).save(state());
    assert.equal(new Store(file, randomBytes(32)).load(), null);
    const key = randomBytes(32);
    const st = new Store(file, key);
    st.save(state());
    const raw = readFileSync(file);
    raw[raw.length - 1] ^= 0xff;
    require('node:fs').writeFileSync(file, raw);
    assert.equal(st.load(), null);
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
