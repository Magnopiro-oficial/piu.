import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migratePrefs, sanitizePrefsPatch } from '../src/main/prefs';

test('B-01: setPrefs vindo da interface aceita só chaves conhecidas com o tipo certo', () => {
  assert.deepEqual(sanitizePrefsPatch({ theme: 'dark', notifications: false, displayName: '  Ana  ', fontSize: 'l', density: 'compact', notifPreview: 'name', identity: 'anon' }),
    { theme: 'dark', notifications: false, displayName: '  Ana  ', fontSize: 'l', density: 'compact', notifPreview: 'name', identity: 'anon' });
  for (const k of ['animations', 'relay', 'hideBalance', 'screenSecurity', 'shareWalletAddress', 'lan', 'notifSound', 'enterSends']) {
    assert.deepEqual(sanitizePrefsPatch({ [k]: true }), { [k]: true });
    assert.throws(() => sanitizePrefsPatch({ [k]: 'sim' }), /inválid/i);
  }
  assert.deepEqual(sanitizePrefsPatch({}), {});
});

test('B-01: setPrefs recusa endereço da carteira e vizinhos (têm métodos próprios com validação), chaves desconhecidas e valores fora da lista', () => {
  assert.throws(() => sanitizePrefsPatch({ walletAddress: 'qualquer coisa' }), /walletAddress/);
  assert.throws(() => sanitizePrefsPatch({ peers: ['x'] }), /peers/);
  assert.throws(() => sanitizePrefsPatch({ theme: 'neon' }), /theme/);
  assert.throws(() => sanitizePrefsPatch({ displayName: 42 }), /displayName/);
  assert.throws(() => sanitizePrefsPatch({ displayName: 'x'.repeat(1000) }), /displayName/);
  assert.throws(() => sanitizePrefsPatch({ notifPreview: 'tudo' }), /notifPreview/);
  assert.throws(() => sanitizePrefsPatch({ outra: 1 }), /outra/);
  assert.throws(() => sanitizePrefsPatch(JSON.parse('{"__proto__":{"x":1}}')), /__proto__/);
  assert.throws(() => sanitizePrefsPatch(null), /inválid/i);
  assert.throws(() => sanitizePrefsPatch(['theme']), /inválid/i);
});

test('Ajustes novos (notificações por tipo, privacidade, bloqueio, rede, sistema) só com valores conhecidos', () => {
  for (const k of ['notifGroups', 'notifChannels', 'notifWallet', 'badge', 'dnd', 'readReceipts', 'typing', 'randomDelay', 'pad', 'lockOnSuspend', 'openAtLogin', 'tray', 'updateNotify']) {
    assert.deepEqual(sanitizePrefsPatch({ [k]: false }), { [k]: false });
    assert.throws(() => sanitizePrefsPatch({ [k]: 1 }), new RegExp(k));
  }
  const ok: Record<string, string[]> = { find: ['all', 'contacts', 'none'], lockAfter: ['5', '15', '60', 'never'], relayBandwidth: ['1', '5', '20'], relayRetention: ['24', '48', '168'], tempDefault: ['off', '24h', '7d'], relayStorage: ['100', '250', '500'] };
  for (const [k, vs] of Object.entries(ok)) {
    for (const v of vs) assert.deepEqual(sanitizePrefsPatch({ [k]: v }), { [k]: v });
    assert.throws(() => sanitizePrefsPatch({ [k]: 'x' }), new RegExp(k));
    assert.throws(() => sanitizePrefsPatch({ [k]: 5 }), new RegExp(k));
  }
});

test('E2: "Automático / Perguntar" virou "Avisar quando sair versão nova" (prefs antigas migram; o ajuste velho é recusado)', () => {
  assert.throws(() => sanitizePrefsPatch({ updateMode: 'auto' }), /updateMode/);
  assert.deepEqual(migratePrefs({ theme: 'dark', updateMode: 'auto' }), { theme: 'dark', updateNotify: true });
  assert.deepEqual(migratePrefs({ updateMode: 'ask' }), { updateNotify: false });
  assert.deepEqual(migratePrefs({ updateMode: 'auto', updateNotify: false }), { updateNotify: false }, 'o novo vale se já existe');
  assert.deepEqual(migratePrefs({ theme: 'light' }), { theme: 'light' });
});
