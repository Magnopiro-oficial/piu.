import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tIn } from '../../i18n/core';
import '../../i18n';
import { IDLE, type CallState } from '../callMachine';
import { contactOf, controls, encChip, recordCard, requestCard, routeChip, speakLine, statusLine } from '../callView';

const t = (k: string, v?: Record<string, string | number>) => tIn('pt-BR', k as Parameters<typeof tIn>[1], v);
const marina = contactOf('Marina Alves');
const active: CallState = { ...IDLE, phase: 'active', callId: 'c', peer: 'm', dir: 'out', route: 'direct', connectedAt: 0 };

test('contato: iniciais e primeiro nome como no protótipo', () => {
  assert.deepEqual(marina, { name: 'Marina Alves', first: 'Marina', initials: 'MA' });
  assert.equal(contactOf('Ana').initials, 'A');
});

test('status: procurando (Wi-Fi ou Bluetooth), tocando, cronômetro e fim com duração', () => {
  assert.equal(statusLine(t, { ...IDLE, phase: 'calling', stage: 'searching', route: 'direct' }, marina, 0), 'Procurando Marina na rede…');
  assert.equal(statusLine(t, { ...IDLE, phase: 'calling', stage: 'searching', route: 'bt' }, marina, 0), 'Procurando Marina por Bluetooth…');
  assert.equal(statusLine(t, { ...IDLE, phase: 'calling', stage: 'ringing' }, marina, 0, { desktop: true }), 'Tocando no celular e no computador de Marina');
  assert.equal(statusLine(t, active, marina, 134_000), '02:14');
  assert.equal(statusLine(t, { ...active, phase: 'ending', end: { reason: 'hangup', durationMs: 134_000 } }, marina, 0), 'Chamada encerrada · 02:14');
  assert.equal(statusLine(t, { ...active, phase: 'ending', end: { reason: 'sas' } }, marina, 0), 'Encerrada por segurança');
});

test('selos: cifra/conferidas e caminho com latência medida (sem latência inventada)', () => {
  assert.deepEqual(encChip(t, active), { icon: 'lock', text: 'Cifrada de ponta a ponta' });
  assert.deepEqual(encChip(t, { ...active, verified: true }), { icon: 'verified', text: 'Palavras conferidas' });
  assert.deepEqual(routeChip(t, active, 18.2), { icon: 'wifi', text: 'Direto · Wi-Fi local', q: '18 ms' });
  assert.equal(routeChip(t, active).q, '');
  assert.deepEqual(routeChip(t, { ...active, switching: { from: 'direct', since: 0 } }), { icon: 'sync', text: 'O Wi-Fi caiu · mudando', q: '' });
});

test('quem fala, mudo e trocando caminho', () => {
  assert.equal(speakLine(t, active, marina, 'them'), 'Marina está falando');
  assert.equal(speakLine(t, { ...active, muted: true }, marina, null), 'Você está no mudo');
  assert.equal(speakLine(t, { ...active, switching: { from: 'bt', since: 0 } }, marina, 'them'), 'A voz volta em instantes');
});

test('botões: celular 4, Desktop 5 (Pro celular só se houver celular), chamando só 2', () => {
  assert.deepEqual(controls(t, active).map(c => c.id), ['mute', 'speaker', 'words', 'chat']);
  assert.deepEqual(controls(t, active, { desktop: true, phoneName: 'Pixel 7a' }).map(c => c.id), ['mute', 'audio', 'words', 'toPhone', 'chat']);
  assert.deepEqual(controls(t, active, { desktop: true }).map(c => c.id), ['mute', 'audio', 'words', 'chat']);
  assert.deepEqual(controls(t, { ...active, phase: 'calling' }).map(c => c.id), ['mute', 'speaker']);
  assert.equal(controls(t, { ...active, verified: true })[2].label, 'Conferidas');
});

test('cartões de registro: feita, perdida, recusada, palavras diferentes, pedido', () => {
  assert.deepEqual(recordCard(t, { callId: 'c', peer: 'm', dir: 'out', outcome: 'done', at: 0, durationMs: 134_000, route: 'direct' }, marina),
    { icon: 'call_made', title: 'Chamada de voz', sub: '02:14 · direto pelo Wi-Fi', mine: true, callBack: false });
  const missed = recordCard(t, { callId: 'c', peer: 'm', dir: 'in', outcome: 'missed', at: 0, rangMs: 22_000 }, marina);
  assert.equal(missed.sub, 'Marina tentou por 22 s');
  assert.equal(missed.callBack, true);
  assert.equal(recordCard(t, { callId: 'c', peer: 'm', dir: 'in', outcome: 'declined', at: 0, route: 'bt' }, marina).sub, 'direto por Bluetooth');
  assert.equal(recordCard(t, { callId: 'c', peer: 'm', dir: 'out', outcome: 'sas', at: 0, durationMs: 9000 }, marina).sub, '00:09 · palavras diferentes');
  const req = requestCard(t, 'delivered', marina, 3);
  assert.equal(req.sub, 'Entregue · Marina viu o pedido');
  assert.deepEqual(req.dots, [true, true, false]);
  assert.equal(requestCard(t, 'traveling', marina, 3).sub, 'Viajando pela malha · 3 saltos');
});
