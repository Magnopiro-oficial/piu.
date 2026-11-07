import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPrefs, savePrefs } from '../src/prefs.ts';

test('prefs: aviso de versão nova ligado por padrão e desligar fica salvo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-prefs-'));
  try {
    const p = loadPrefs(dir);
    assert.deepEqual(p, { lan: false, trayHintShown: false, updateNotify: true, lastUpdateCheck: 0 });
    savePrefs({ ...p, updateNotify: false, lastUpdateCheck: 123 });
    assert.deepEqual(loadPrefs(dir), { lan: false, trayHintShown: false, updateNotify: false, lastUpdateCheck: 123 });
    // Arquivo de versão antiga (sem as chaves novas): continua avisando.
    writeFileSync(join(dir, 'desktop.json'), JSON.stringify({ lan: true, trayHintShown: true }));
    assert.deepEqual(loadPrefs(dir), { lan: true, trayHintShown: true, updateNotify: true, lastUpdateCheck: 0 });
    // Valores estranhos não passam.
    writeFileSync(join(dir, 'desktop.json'), JSON.stringify({ updateNotify: 'no', lastUpdateCheck: -5 }));
    assert.deepEqual(loadPrefs(dir), { lan: false, trayHintShown: false, updateNotify: true, lastUpdateCheck: 0 });
    assert.ok(readFileSync(join(dir, 'desktop.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
