/**
 * Notificações e banners sem tela (plano "app fechado", fatia 6). Com o processo vivo e a tela
 * desmontada (ou o núcleo subindo pela tarefa sem tela), os ajustes de Notificações vêm do salvo, não
 * do NotificationBridge, e o banner só aparece se houver um <Toast/> montado.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ToastData } from '../../data/types';
import { createToasts, persistedNotifyCfg } from '../toasts';

const saved = (o: Record<string, unknown>) => <T,>(k: string) => o[k] as T | undefined;

test('ajustes de notificação sem nada salvo: os padrões de Ajustes (Rede e nós desligado, piu ligado)', () => {
  const c = persistedNotifyCfg(saved({}));
  assert.equal(c.preview, 'always');
  assert.equal(c.onboarded, false);
  assert.deepEqual({ piu: c.piu, quiet: c.quiet, discreet: c.discreet }, { piu: true, quiet: false, discreet: false });
  assert.equal(c.notifs.msg, true);
  assert.equal(c.notifs.alert, true);
  assert.equal(c.notifs.network, false);
});

test('ajustes de notificação lidos do salvo; tipo novo entra com o padrão', () => {
  const c = persistedNotifyCfg(saved({ onboarded: true, 'set.preview': 'never', 'set.notifs': { msg: false }, 'set.quiet': true, 'set.discreet': true, 'set.piuSound': false }));
  assert.equal(c.onboarded, true);
  assert.equal(c.preview, 'never');
  assert.equal(c.notifs.msg, false);
  assert.equal(c.notifs.group, true);
  assert.deepEqual({ piu: c.piu, quiet: c.quiet, discreet: c.discreet }, { piu: false, quiet: true, discreet: true });
});

test('lib/notifications.ts tira o cfg do salvo: o NotificationBridge não é mais quem preenche', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'lib', 'notifications.ts'), 'utf8');
  assert.doesNotMatch(src, /\bcfg = \{/);
  assert.match(src, /persistedNotifyCfg\(readPersisted\)/);
});

function bus(o: Record<string, unknown> = { onboarded: true }) {
  const notes: string[] = [], chirps: string[] = [];
  const t = createToasts({ notify: n => { notes.push(`${n.kind}:${n.title}:${n.data?.href ?? ''}`); }, chirp: k => { chirps.push(k); }, cfg: () => persistedNotifyCfg(saved(o)) });
  return { t, notes, chirps };
}

test('banner com tipo e sem <Toast/> montado: vira notificação do sistema (com a rota) e o piu', () => {
  const { t, notes, chirps } = bus();
  t.show({ kind: 'msg', title: 'Ana', body: 'oi', href: '/chat/a' });
  assert.deepEqual(notes, ['msg:Ana:/chat/a']);
  assert.deepEqual(chirps, ['msg']);
});

test('tipo desligado no salvo: nem banner, nem notificação, nem piu', () => {
  const { t, notes, chirps } = bus({ onboarded: true, 'set.notifs': { wallet: false } });
  const seen: ToastData[] = [];
  t.onBanner(b => seen.push(b));
  t.show({ kind: 'wallet', title: 'LUNES', body: '+1' });
  assert.deepEqual([notes, chirps, seen], [[], [], []]);
});

test('com <Toast/> montado o banner chega a quem assina; sem tipo, não notifica; desassinar para de entregar', () => {
  const { t, notes } = bus();
  const seen: string[] = [];
  const off = t.onBanner(b => seen.push(b.title));
  t.show({ title: 'Copiado', body: '' });
  assert.deepEqual(seen, ['Copiado']);
  assert.deepEqual(notes, []);
  off();
  t.show({ kind: 'msg', title: 'Ana', body: 'oi' });
  assert.deepEqual(seen, ['Copiado']);
  assert.equal(notes.length, 1);
});
