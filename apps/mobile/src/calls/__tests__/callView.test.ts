import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tIn } from '../../i18n/core';
import '../../i18n';
import { IDLE, type CallState, type EndReason } from '../callMachine';
import { contactOf, controls, encChip, failNotice, meshNodes, recordCard, requestCard, routeChip, routeVia, ROUTE_ICON, speakLine, statusLine } from '../callView';

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

test('contato sem chamada e oferta que não saiu: o fim diz o motivo (não "Sem resposta" à toa)', () => {
  const end = (reason: 'nocall' | 'unreachable') => statusLine(t, { ...IDLE, phase: 'ending', end: { reason } }, marina, 0);
  assert.equal(end('nocall'), 'O contato pode estar com o Piu fechado, numa versão antiga ou no iPhone');
  assert.equal(end('unreachable'), 'Sem conexão com o contato agora');
  const rec = (note?: string) => recordCard(t, { callId: 'c', peer: 'm', dir: 'out', outcome: 'noanswer', at: 0, route: 'direct', ...(note ? { note } : {}) }, marina);
  assert.deepEqual([rec('nocall').title, rec('nocall').sub], ['Não foi possível chamar', 'pode estar com o Piu fechado, versão antiga ou iPhone']);
  assert.deepEqual([rec('unreachable').title, rec('unreachable').sub], ['Não foi possível chamar', 'sem conexão com o contato']);
  assert.deepEqual([rec().title, rec().sub], ['Sem resposta', 'direto pelo Wi-Fi'], 'sem resposta comum continua igual');
});

test('aviso de falha na tela de fim: título claro e o porquê, só para a tentativa de quem ligou', () => {
  const end = (reason: EndReason, dir: 'out' | 'in' = 'out') => failNotice(t, { ...active, dir, phase: 'ending', end: { reason } }, marina);
  assert.deepEqual(end('unreachable'), { icon: 'call_end', title: 'Não foi possível chamar', sub: 'Sem conexão com o contato agora' });
  assert.deepEqual(end('nocall'), { icon: 'call_end', title: 'Não foi possível chamar', sub: 'O contato pode estar com o Piu fechado, numa versão antiga ou no iPhone' });
  assert.deepEqual(end('noanswer'), { icon: 'phone_missed', title: 'Sem resposta', sub: 'Marina não atendeu' });
  assert.deepEqual(end('declined'), { icon: 'call_end', title: 'Recusada', sub: 'Marina recusou a chamada' });
  assert.deepEqual(end('busy'), { icon: 'call_end', title: 'Em outra chamada', sub: 'Marina está em outra chamada' });
  assert.equal(end('cancel'), null, 'eu cancelei');
  assert.equal(end('hangup'), null);
  assert.equal(end('declined', 'in'), null, 'eu recusei');
  assert.equal(failNotice(t, active, marina), null);
});

test('Wi-Fi Direct (Nearby, `bt` no fio com a marca wifiDirect) aparece como Wi-Fi Direct, não como Bluetooth', () => {
  const nb: CallState = { ...active, route: 'bt', wifiDirect: true };
  assert.deepEqual(routeChip(t, nb, 30), { icon: 'wifi_tethering', text: 'Direto · Wi-Fi Direct', q: '30 ms' });
  assert.equal(routeChip(t, { ...nb, switching: { from: 'bt', since: 0 } }).text, 'Wi-Fi Direct fora de alcance · mudando');
  assert.equal(routeVia(t, 'bt', true), 'direto por Wi-Fi Direct');
  assert.equal(routeVia(t, 'bt'), 'direto por Bluetooth', 'Bluetooth de verdade continua Bluetooth');
  assert.equal(routeVia(t, 'direct', true), 'direto pelo Wi-Fi', 'a marca só vale para bt');
  assert.equal(statusLine(t, { ...IDLE, phase: 'calling', stage: 'searching', route: 'bt', wifiDirect: true }, marina, 0), 'Procurando Marina por Wi-Fi Direct…');
  assert.equal(statusLine(t, { ...IDLE, phase: 'ringing', route: 'bt', wifiDirect: true }, marina, 0), 'direto por Wi-Fi Direct');
  assert.equal(routeChip(t, { ...active, route: 'bt' }).icon, 'bluetooth');
  assert.equal(recordCard(t, { callId: 'c', peer: 'm', dir: 'in', outcome: 'declined', at: 0, route: 'bt', wifiDirect: true }, marina).sub, 'direto por Wi-Fi Direct');
  assert.equal(ROUTE_ICON.bt, 'bluetooth');
});

test('diagrama da malha: um nó por salto quando se sabe; sem saber, nenhum número inventado', () => {
  assert.equal(meshNodes(undefined), 0);
  assert.equal(meshNodes(0), 0);
  assert.equal(meshNodes(2), 2);
  assert.equal(meshNodes(9), 5);
  assert.equal(meshNodes(undefined, true), 2, 'LoRa (5a): o rádio e um nó depois dele');
});
