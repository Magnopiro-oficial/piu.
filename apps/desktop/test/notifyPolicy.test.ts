import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertText, badgeCount, notifKindOf, shouldNotify, shouldNotifyAlert, walletReceived } from '../src/shared/notifyPolicy';
import { DEFAULT_PREFS, type ConversationSummary, type WalletState } from '../src/shared/types';

const P = DEFAULT_PREFS;

test('notificações: cada tipo segue o próprio interruptor; janela em foco não avisa', () => {
  assert.equal(shouldNotify(P, { kind: 'direct' }), true);
  assert.equal(shouldNotify({ ...P, notifications: false }, { kind: 'direct' }), false);
  assert.equal(shouldNotify({ ...P, notifGroups: false }, { kind: 'group' }), false);
  assert.equal(shouldNotify({ ...P, notifGroups: false }, { kind: 'direct' }), true);
  assert.equal(shouldNotify({ ...P, notifChannels: false }, { kind: 'channel' }), false);
  assert.equal(shouldNotify({ ...P, notifWallet: false }, { kind: 'wallet' }), false);
  assert.equal(shouldNotify(P, { kind: 'direct', focused: true }), false);
});

test('notificações: conversa silenciada e Não perturbe calam tudo; o teste manual sempre aparece', () => {
  assert.equal(shouldNotify(P, { kind: 'direct', muted: true }), false);
  assert.equal(shouldNotify({ ...P, dnd: true }, { kind: 'direct' }), false);
  assert.equal(shouldNotify({ ...P, dnd: true }, { kind: 'wallet' }), false);
  assert.equal(shouldNotify({ ...P, dnd: true, notifications: false }, { kind: 'test', focused: true }), true);
});

test('tipo da notificação pelo tipo da conversa (comunidade e desconhecido contam como grupo)', () => {
  assert.equal(notifKindOf({ kind: undefined }), 'direct');
  assert.equal(notifKindOf({ kind: 'direct' }), 'direct');
  assert.equal(notifKindOf({ kind: 'group' }), 'group');
  assert.equal(notifKindOf({ kind: 'community' }), 'group');
  assert.equal(notifKindOf({ kind: 'unknown' }), 'group');
  assert.equal(notifKindOf({ kind: 'channel' }), 'channel');
});

const row = (id: string, unread: number, muted = false): ConversationSummary => ({ contact: { id, name: id, via: 'public', request: false }, last: null, unread, pending: 0, ...(muted ? { muted } : {}) });

test('contador no ícone: soma as não lidas fora das silenciadas; desligado ou Não perturbe = 0; teto 999', () => {
  assert.equal(badgeCount(P, [row('a', 2), row('b', 3), row('c', 7, true)]), 5);
  assert.equal(badgeCount({ ...P, badge: false }, [row('a', 2)]), 0);
  assert.equal(badgeCount({ ...P, dnd: true }, [row('a', 2)]), 0);
  assert.equal(badgeCount(P, [row('a', 5000)]), 999);
  assert.equal(badgeCount(P, []), 0);
});

const w = (o: Partial<WalletState>): WalletState => ({ address: 'A', source: 'phrase', hidden: false, status: 'ok', error: null, free: '0', reserved: '0', block: 1, endpoint: null, at: 1, ...o });

test('carteira: avisa só quando o saldo lido do MESMO endereço sobe (planck)', () => {
  assert.equal(walletReceived(w({ free: '100' }), w({ free: '250' })), 150n);
  assert.equal(walletReceived(w({ free: '100', reserved: '10' }), w({ free: '100', reserved: '30' })), 20n);
  assert.equal(walletReceived(w({ free: '100' }), w({ free: '90' })), null);
  assert.equal(walletReceived(w({ free: '100' }), w({ free: '100' })), null);
  assert.equal(walletReceived(w({ free: '100' }), w({ address: 'B', free: '900' })), null, 'trocou de endereço');
  assert.equal(walletReceived(w({ status: 'loading', free: null }), w({ free: '900' })), null, 'primeira leitura não é recebimento');
  assert.equal(walletReceived(w({ free: '100' }), w({ status: 'error', free: null })), null);
  assert.equal(walletReceived(w({ free: 'lixo' }), w({ free: '900' })), null);
});

test('alertas da comunidade: Graves passam pelo Não perturbe; Atenção não; comunidade silenciada e ajuste desligado calam; em foco vira aviso na tela', () => {
  assert.equal(shouldNotifyAlert(P, { level: 'critical' }), 'notify');
  assert.equal(shouldNotifyAlert(P, { level: 'normal' }), 'notify');
  assert.equal(shouldNotifyAlert({ ...P, dnd: true }, { level: 'critical' }), 'notify');
  assert.equal(shouldNotifyAlert({ ...P, dnd: true }, { level: 'normal' }), null);
  assert.equal(shouldNotifyAlert(P, { level: 'critical', muted: true }), null);
  assert.equal(shouldNotifyAlert({ ...P, notifAlerts: false }, { level: 'critical' }), null);
  assert.equal(shouldNotifyAlert(P, { level: 'critical', focused: true }), 'toast');
  assert.equal(DEFAULT_PREFS.notifAlerts, true);
});

test('texto do alerta: com o Piu bloqueado ou "Nada" no aviso, não diz qual alerta nem de onde', () => {
  const v = { sev: 'grave' as const, cat: 'agua' as const, title: 'Rio subindo', area: 'Centro', communityName: 'Bairro' };
  assert.deepEqual(alertText(v, { level: 'critical', update: false }, { locked: false, preview: 'always' }),
    { title: 'Grave · Rio subindo', body: 'Bairro · Centro. Publicado por um membro da comunidade. Não é aviso oficial.' });
  assert.equal(alertText({ ...v, area: '' }, { level: 'critical', update: true }, { locked: false, preview: 'name' }).title, 'Confirmado pela comunidade · Rio subindo');
  assert.match(alertText({ ...v, area: '' }, { level: 'critical', update: false }, { locked: false, preview: 'always' }).body, /^Bairro · Enchente\/água\./);
  for (const o of [{ locked: true, preview: 'always' as const }, { locked: false, preview: 'never' as const }]) {
    const x = alertText(v, { level: 'critical', update: false }, o);
    assert.deepEqual(x, { title: 'Alerta da comunidade', body: 'Abra o Piu para ver.' });
  }
});
