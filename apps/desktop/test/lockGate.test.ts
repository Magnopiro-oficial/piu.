import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventAllowed, lockedView, methodAllowed } from '../src/main/lockGate';
import { DEFAULT_PREFS, type NetworkStatus, type SessionInfo } from '../src/shared/types';
import type { PiuEventName } from '../src/shared/types';

test('bloqueado: só os métodos da tela de bloqueio passam; desbloqueado, tudo', () => {
  for (const m of ['getSession', 'getPrefs', 'networkStatus', 'appLockState', 'unlockApp', 'updateState']) assert.equal(methodAllowed(true, m), true, m);
  for (const m of ['listConversations', 'getMessages', 'sendText', 'revealPhrase', 'wallet', 'requestWalletPayment', 'guardianState', 'guardianSetWifi', 'storageDetail', 'listBlocked', 'exportIdentityBackup', 'eraseAll', 'setPrefs', 'leaveGroup', 'addGroupMembers', 'groupInviteCandidates', 'copy', 'linkStart'])
    assert.equal(methodAllowed(true, m), false, m);
  assert.equal(methodAllowed(false, 'getMessages'), true);
});

test('bloqueado: eventos com nomes, conversas, carteira, vínculo e o ponto (QR com senha do Wi-Fi) não chegam ao renderer', () => {
  for (const e of ['conversations', 'message', 'typing', 'wallet', 'walletPayment', 'notice', 'link', 'guardian'] as PiuEventName[]) assert.equal(eventAllowed(true, e), false, e);
  for (const e of ['appLock', 'network', 'prefs', 'session', 'update'] as PiuEventName[]) assert.equal(eventAllowed(true, e), true, e);
  assert.equal(eventAllowed(false, 'guardian'), true);
});

test('baixo 30: bloqueado, sessão, preferências e rede chegam sem nome, ids, carteira nem vizinhos', () => {
  const session: SessionInfo = { state: 'ready', me: { publicId: 'piu:abc', anonId: 'piu:anon', name: 'Ana', nodePk: 'ff' }, platform: 'darwin', version: '1', vaultSecure: true, hostname: 'mac' };
  const s = lockedView('getSession', session) as SessionInfo;
  assert.equal(s.state, 'ready', 'continua "pronto": a janela segue na tela de bloqueio');
  assert.ok(s.me, 'o objeto existe (a tela de bloqueio depende dele)');
  assert.deepEqual(Object.values(s.me!), ['', '', '', '']);
  assert.equal((lockedView('session', { ...session, state: 'none', me: null }) as SessionInfo).me, null);

  const prefs = { ...DEFAULT_PREFS, displayName: 'Ana', walletAddress: '5Gxyz', peers: ['10.0.0.2:7000'], theme: 'dark' as const, relay: false };
  const p = lockedView('getPrefs', prefs) as typeof prefs;
  assert.equal(p.displayName, ''); assert.equal(p.walletAddress, null); assert.deepEqual(p.peers, []);
  assert.equal(p.theme, 'dark', 'aparência continua'); assert.equal(p.relay, false);
  assert.deepEqual(lockedView('prefs', prefs), p, 'o evento sai igual ao método');

  const net = { lan: { state: 'on', port: 1, discoveryPort: 2, peers: [{ address: '10.0.0.2:7000' }], links: 3 }, ble: { state: 'off' }, relay: true } as unknown as NetworkStatus;
  const n = lockedView('networkStatus', net) as NetworkStatus;
  assert.deepEqual(n.lan.peers, []); assert.equal(n.lan.links, 3, 'a contagem de enlaces aparece na tela de bloqueio');
  assert.deepEqual(lockedView('network', net), n);
  // O resto passa como está (o portão decide o que passa).
  assert.equal(lockedView('updateState', 42), 42);
  assert.deepEqual(prefs.peers, ['10.0.0.2:7000'], 'não altera o original');
});
