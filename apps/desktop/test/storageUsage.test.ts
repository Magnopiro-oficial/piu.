import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conversationSizes, dirSize, freeBytes, lowDisk, measureStorage } from '../src/main/storageUsage';

test('espaço: soma a pasta de dados inteira (subpastas), sem seguir links; pasta ausente = 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-usage-'));
  try {
    writeFileSync(join(dir, 'state.bin'), Buffer.alloc(1000));
    writeFileSync(join(dir, 'payments.bin'), Buffer.alloc(200));
    mkdirSync(join(dir, 'Cache', 'x'), { recursive: true });
    writeFileSync(join(dir, 'Cache', 'x', 'blob'), Buffer.alloc(5000));
    try { symlinkSync('/', join(dir, 'raiz')); } catch { /* sem permissão para link: o teste segue */ }
    assert.equal(dirSize(dir), 6200);
    assert.equal(dirSize(join(dir, 'nao-existe')), 0);
    assert.deepEqual(measureStorage(dir, 300), { total: 6200, messages: 900, relay: 300, media: 0 });
    assert.deepEqual(measureStorage(dir, null), { total: 6200, messages: 1200, relay: null, media: 0 });
    // A fila em memória pode passar do que já foi gravado: nunca dá negativo.
    assert.deepEqual(measureStorage(dir, 99999), { total: 6200, messages: 0, relay: 99999, media: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('espaço: livre no disco pelo statfs; pasta que não existe sobe até a que existe; erro = null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-free-'));
  try {
    const f = freeBytes(dir);
    assert.ok(typeof f === 'number' && f > 0);
    assert.ok((freeBytes(join(dir, 'ainda', 'nao')) ?? 0) > 0, 'mede pela pasta mais próxima que existe');
    assert.equal(freeBytes(dir, () => { throw new Error('x'); }), null);
    assert.equal(freeBytes(dir, () => ({ bavail: 10, bsize: 4096 })), 40960);
    assert.equal(lowDisk(999_999_999), true);
    assert.equal(lowDisk(1_000_000_000), false);
    assert.equal(lowDisk(null), false, 'sem medida, sem alarme');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('espaço por conversa: bytes do histórico como vai para o state.bin, maior primeiro', () => {
  const m = (id: string, contactId: string, text: string) => ({ id, contactId, dir: 'in' as const, text, at: 1, status: 'recebida' as const });
  const s = { byContact: { a: [m('1', 'a', 'oi')], b: [m('2', 'b', 'x'.repeat(500)), m('3', 'b', 'y')], c: [] }, readCount: {} };
  const r = conversationSizes(s);
  assert.deepEqual(r.map(x => x.id), ['b', 'a']);
  assert.equal(r[0]!.count, 2);
  assert.equal(r[0]!.bytes, Buffer.byteLength(JSON.stringify(s.byContact.b)));
});
