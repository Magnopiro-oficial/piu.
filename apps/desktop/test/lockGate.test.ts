import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventAllowed, methodAllowed } from '../src/main/lockGate';
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
