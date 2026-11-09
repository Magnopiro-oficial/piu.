/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotifKey } from '../../data/settings';
import { canChirp, incomingAlert, notifyMode, SOUND_DEFAULTS, type ChirpCfg } from '../piuChirp';

const all = { msg: true, group: true, channel: true, nearby: true, wallet: true, network: true, alert: true } as Record<NotifKey, boolean>;
const factory: ChirpCfg = { onboarded: true, ...SOUND_DEFAULTS, notifs: all };
const day = new Date(2026, 10, 8, 15, 0);
const night = new Date(2026, 10, 8, 23, 0);

test('padrão de fábrica: a notificação com o app fechado toca o piu (vibração discreta vem desligada)', () => {
  assert.equal(SOUND_DEFAULTS.piu, true);
  assert.equal(SOUND_DEFAULTS.discreet, false);
  assert.equal(notifyMode(factory, false, day), 'piu');
});

test('canal da notificação: crítico > noturno > discreto > piu > normal', () => {
  assert.equal(notifyMode({ ...factory, discreet: true, quiet: true }, true, night), 'critical');
  assert.equal(notifyMode({ ...factory, quiet: true }, false, night), 'quiet');
  assert.equal(notifyMode({ ...factory, quiet: true }, false, day), 'piu');
  assert.equal(notifyMode({ ...factory, discreet: true }, false, day), 'discreet');
  assert.equal(notifyMode({ ...factory, piu: false }, false, day), 'normal');
});

test('piu com o app aberto: chegou algo de um tipo ligado toca; tipo desligado, som desligado, segundo plano ou antes do cadastro, não', () => {
  const on = { kind: 'msg' as const, active: true, ringer: 'normal' as const, now: day };
  assert.equal(canChirp(factory, on), true);
  assert.equal(canChirp({ ...factory, notifs: { ...all, msg: false } }, on), false);
  assert.equal(canChirp({ ...factory, piu: false }, on), false);
  assert.equal(canChirp(factory, { ...on, active: false }), false);
  assert.equal(canChirp({ ...factory, onboarded: false }, on), false);
  assert.equal(canChirp(null, on), false);
});

test('piu ao abrir o app (sem tipo): toca com o som ligado; no modo noturno, só fora das 22h–7h', () => {
  assert.equal(canChirp(factory, { active: true, ringer: 'normal', now: day }), true);
  assert.equal(canChirp(factory, { active: true, ringer: 'normal', now: night }), true);
  assert.equal(canChirp({ ...factory, quiet: true }, { active: true, ringer: 'normal', now: night }), false);
  assert.equal(canChirp({ ...factory, quiet: true }, { active: true, ringer: 'normal', now: day }), true);
});

test('Android no silencioso ou no vibrar: o piu não toca (sai pelo volume de mídia, que tocaria mesmo assim)', () => {
  assert.equal(canChirp(factory, { kind: 'msg', active: true, ringer: 'silent', now: day }), false);
  assert.equal(canChirp(factory, { kind: 'msg', active: true, ringer: 'vibrate', now: day }), false);
  // Sem leitura do modo (iPhone, web): quem decide é o sistema (o iPhone respeita a chave do silencioso).
  assert.equal(canChirp(factory, { kind: 'msg', active: true, ringer: null, now: day }), true);
});

test('mensagem que chegou: fora da conversa, banner (com piu); na conversa aberta, só o piu', () => {
  assert.deepEqual(incomingAlert({ fromThem: true, viewing: false, exists: true }), { banner: true, chirp: false });
  assert.deepEqual(incomingAlert({ fromThem: true, viewing: true, exists: true }), { banner: false, chirp: true });
});

test('mensagem que chegou: minha, silenciosa (histórico, sincronização), de conversa silenciada ou desconhecida, nada', () => {
  const none = { banner: false, chirp: false };
  assert.deepEqual(incomingAlert({ fromThem: false, viewing: true, exists: true }), none);
  assert.deepEqual(incomingAlert({ fromThem: true, viewing: false, exists: true, quiet: true }), none);
  assert.deepEqual(incomingAlert({ fromThem: true, viewing: true, exists: true, muted: true }), none);
  assert.deepEqual(incomingAlert({ fromThem: true, viewing: false, exists: false }), none);
});
