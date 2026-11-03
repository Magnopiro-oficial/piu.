/// <reference types="node" />
/**
 * Tela de bloqueio (lib/lockFeed.ts): só notificações reais, conforme pré-visualização e tipos, com
 * os alertas Graves da comunidade vigentes e não contestados no topo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chat } from '../../data/types';
import type { AlertView } from '../../messaging/communityAlerts';
import { lockItems, lockTime } from '../lockFeed';

const T0 = Date.parse('2026-11-03T12:00:00-03:00');
const S0 = Math.floor(T0 / 1000);
const NOTIFS = { msg: true, group: true, channel: true, nearby: true, wallet: true, network: false, alert: true };
const chat = (p: Partial<Chat>): Chat => ({ id: 'c1', ident: 'public', kind: 'direct', name: 'Contato', initials: 'CO', time: '11:58', unread: 0, msgs: [], ...p });
const alert = (p: Partial<AlertView>): AlertView => ({
  id: 'a'.repeat(32), community: 'c'.repeat(32), communityName: 'Vila', author: 'piu:b', authorName: 'Beto', cat: 'agua', sev: 'grave', title: 'Rio subindo', text: '', area: 'Ponte',
  at: S0 - 600, until: S0 + 3600, status: 'unconfirmed', confirms: 0, denies: 0, myVote: null, mine: false, active: true, canVote: true, canClose: false, closedAt: null, ...p,
});

test('tela de bloqueio: só notificações reais (não lidas), respeitando pré-visualização, tipos e silêncio', () => {
  assert.deepEqual(lockItems({ chats: [], preview: 'always', notifs: NOTIFS, now: T0 }), [], 'sem nada novo: vazio');
  const chats: Chat[] = [
    chat({ id: 'a', name: 'Ana', unread: 2, msgs: [{ id: 'm0', from: 'me', text: 'oi', time: '11:50' }, { id: 'in-1', from: 'them', text: 'tudo bem?', time: '11:55', at: T0 - 5 * 60_000 }, { id: 'in-2', from: 'them', text: 'chegou?', time: '11:58', at: T0 - 2 * 60_000 }] }),
    chat({ id: 'g', name: 'Mutirão', kind: 'group', unread: 1, msgs: [{ id: 'in-3', from: 'them', sender: 'Bia', text: 'amanhã 8h', time: '11:30', at: T0 - 30 * 60_000 }] }),
    chat({ id: 'mudo', name: 'Silenciada', unread: 3, muted: true, msgs: [{ id: 'in-4', from: 'them', text: 'x', time: '11:00' }] }),
    chat({ id: 'lida', name: 'Lida', unread: 0, msgs: [{ id: 'in-5', from: 'them', text: 'já li', time: '10:00' }] }),
    chat({ id: 'canal', name: 'Canal', kind: 'channel', unread: 1, msgs: [{ id: 'in-6', from: 'them', text: 'post', time: '09:00', at: T0 - 3 * 3600_000 }] }),
  ];
  const all = lockItems({ chats, preview: 'always', notifs: NOTIFS, now: T0 });
  assert.deepEqual(all.map(i => [i.title, i.body, i.more]), [['Ana', 'chegou?', 1], ['Mutirão', 'Bia: amanhã 8h', 0], ['Canal', 'post', 0]]);
  assert.deepEqual(all.map(i => lockTime(i, T0)), ['2 min', '30 min', '3 h']);
  assert.equal(all[0]!.href, '/chat/a');
  for (const preview of ['unlocked', 'never'] as const) {
    const hidden = lockItems({ chats, preview, notifs: NOTIFS, now: T0 });
    assert.deepEqual(hidden.map(i => [i.title, i.body]), [['Piu', 'Novas mensagens'], ['Piu', 'Nova mensagem'], ['Piu', 'Nova publicação']]);
    assert.ok(!JSON.stringify(hidden).match(/Ana|chegou|Bia|Mutirão/));
  }
  assert.deepEqual(lockItems({ chats, preview: 'always', notifs: { ...NOTIFS, group: false, channel: false }, now: T0 }).map(i => i.title), ['Ana'], 'tipos desligados ficam de fora');
});

test('tela de bloqueio: alertas Graves da comunidade vigentes e não contestados, no topo', () => {
  const alerts = [
    alert({}),
    alert({ id: 'b'.repeat(32), sev: 'warn', title: 'Buraco' }),
    alert({ id: 'c'.repeat(32), status: 'contested', title: 'Boato' }),
    alert({ id: 'd'.repeat(32), status: 'closed', active: false, title: 'Já resolvido' }),
    alert({ id: 'e'.repeat(32), status: 'expired', active: false, until: S0 - 1, title: 'Vencido' }),
  ];
  const chats = [chat({ id: 'a', name: 'Ana', unread: 1, msgs: [{ id: 'in-1', from: 'them', text: 'oi', time: '11:55', at: T0 - 60_000 }] })];
  const items = lockItems({ chats, preview: 'always', notifs: NOTIFS, alerts, now: T0 });
  assert.deepEqual(items.map(i => [i.critical, i.title, i.body]), [[true, 'Alerta grave · Vila', 'Rio subindo · Ponte'], [false, 'Ana', 'oi']]);
  assert.equal(items[0]!.href, `/alert?id=${'a'.repeat(32)}`);
  assert.equal(lockTime(items[0]!, T0), '10 min');
  // Vem de um grupo: segue a pré-visualização.
  const hidden = lockItems({ chats: [], preview: 'never', notifs: NOTIFS, alerts, now: T0 });
  assert.deepEqual(hidden.map(i => [i.title, i.body]), [['Piu', 'Alerta da comunidade']]);
  // Tipo desligado: não aparece.
  assert.deepEqual(lockItems({ chats: [], preview: 'always', notifs: { ...NOTIFS, alert: false }, alerts, now: T0 }), []);
});
