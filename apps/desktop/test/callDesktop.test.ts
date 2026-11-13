import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE, type CallState } from '../../mobile/src/calls/callMachine';
import { contactOf, type Tr } from '../../mobile/src/calls/callView';
import { DESKTOP_GEOMETRY } from '../../mobile/src/calls/callVisual';
import { callKeyLabel, callTimer, callLines, callToastText, callWindowTitle, declineDraft, deviceIcon, matchCallKey, stageLayout, type KeyLike } from '../src/renderer/call/callDesktop';
import { callPtBR } from '../../mobile/src/i18n/call/pt-BR';
import { tIn, type Key } from '../src/shared/i18n';

const key = (k: string, o: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
const marina = contactOf('Marina Alves');
const tr: Tr = (k, v) => tIn('pt-BR', k as Key, v);

test('atalhos: Ctrl⇧C liga, Ctrl⇧A atende, Ctrl⇧D recusa, Ctrl D mudo, Ctrl⇧E desliga (só na fase certa)', () => {
  assert.equal(matchCallKey(key('C', { ctrlKey: true, shiftKey: true }), false, 'idle'), 'open');
  assert.equal(matchCallKey(key('C', { ctrlKey: true, shiftKey: true }), false, 'active'), null);
  assert.equal(matchCallKey(key('A', { ctrlKey: true, shiftKey: true }), false, 'ringing'), 'answer');
  assert.equal(matchCallKey(key('A', { ctrlKey: true, shiftKey: true }), false, 'idle'), null);
  assert.equal(matchCallKey(key('D', { ctrlKey: true, shiftKey: true }), false, 'ringing'), 'decline');
  assert.equal(matchCallKey(key('d', { ctrlKey: true }), false, 'active'), 'mute');
  assert.equal(matchCallKey(key('d', { ctrlKey: true }), false, 'ringing'), null);
  assert.equal(matchCallKey(key('E', { ctrlKey: true, shiftKey: true }), false, 'calling'), 'hangup');
  assert.equal(matchCallKey(key('E', { ctrlKey: true, shiftKey: true }), false, 'ending'), null);
  // Pedido recebido pela malha: atender = "Posso agora", recusar = "Mais tarde".
  assert.equal(matchCallKey(key('A', { ctrlKey: true, shiftKey: true }), false, 'reqIn'), 'answer');
});

test('atalhos: ⌘ no macOS, Ctrl nos outros; Alt ou tecla sem modificador não acionam', () => {
  assert.equal(matchCallKey(key('d', { metaKey: true }), true, 'active'), 'mute');
  assert.equal(matchCallKey(key('d', { ctrlKey: true }), true, 'active'), null);
  assert.equal(matchCallKey(key('d', { metaKey: true }), false, 'active'), null);
  assert.equal(matchCallKey(key('d', { ctrlKey: true, altKey: true }), false, 'active'), null);
  assert.equal(matchCallKey(key('d'), false, 'active'), null);
  assert.equal(callKeyLabel('open', false), 'Ctrl Shift C');
  assert.equal(callKeyLabel('mute', false), 'Ctrl D');
  assert.equal(callKeyLabel('hangup', true), '⌘ ⇧ E');
});

test('título da janela: "{nome} · mm:ss" em chamada, "··:··" chamando, o de sempre fora dela', () => {
  const active: CallState = { ...IDLE, phase: 'active', peer: 'p', connectedAt: 1_000 };
  assert.equal(callTimer(active, 1_000 + 134_500), '02:14');
  assert.equal(callWindowTitle('Marina Alves', { state: active, contact: marina }, 1_000 + 65_000), 'Marina Alves · 01:05');
  assert.equal(callWindowTitle('Ajustes', { state: { ...IDLE, phase: 'calling', peer: 'p' }, contact: marina }, 0), 'Marina Alves · ··:··');
  assert.equal(callWindowTitle('Ajustes', { state: { ...IDLE, phase: 'pre', peer: 'p' }, contact: marina }, 0), 'Ajustes');
  assert.equal(callWindowTitle('Piu', null, 0), 'Piu');
});

test('palco: no 916×754 do protótipo, avatar em (398, 200), nome em 372, áudio em 300; noutro tamanho segue o centro', () => {
  const p = stageLayout(916, 754);
  assert.equal(p.g, DESKTOP_GEOMETRY);
  assert.deepEqual([p.avatar.left, p.avatar.top, p.textTop, p.audioLeft], [398, 200, 372, 300]);
  const w = stageLayout(1200, 754 * 1.5);
  assert.equal(w.g.cx, 600);
  assert.equal(w.g.cy, 390);
  assert.deepEqual([w.avatar.left, w.avatar.top, w.textTop], [540, 330, 502]);
  assert.equal(stageLayout(0, 0).g, DESKTOP_GEOMETRY);
});

test('aparelhos de áudio: ícone pelo nome; avisos da máquina viram texto', () => {
  assert.equal(deviceIcon('mic', { id: '1', label: 'Microfone embutido' }), 'laptop');
  assert.equal(deviceIcon('mic', { id: '2', label: 'Fone Bluetooth' }), 'headphones');
  assert.equal(deviceIcon('out', { id: '3', label: 'AirPods Pro' }), 'headphones');
  assert.equal(deviceIcon('out', { id: '4', label: 'Alto-falantes' }), 'speaker');
  assert.equal(deviceIcon('mic', { id: '5', label: 'USB Audio' }), 'mic');
  assert.equal(deviceIcon('out', { id: '6', label: 'x', icon: 'tv' }), 'tv');
  assert.equal(callToastText(tr, 'verified'), 'Ninguém no meio. Pode falar tranquilo');
  assert.equal(callToastText(tr, 'requestLater', contactOf('Ana Souza')), 'Ana vai saber que agora não dá');
});

test('Recusar → Mensagem: o rascunho do celular fica pronto, sem apagar o que a pessoa já escreveu', () => {
  assert.equal(declineDraft(tr, ''), 'Não posso falar agora, te ligo em 10 min.');
  assert.equal(declineDraft(tr, ''), callPtBR['call.declineDraft'], 'o mesmo texto do celular');
  assert.equal(declineDraft(tr, '   '), callPtBR['call.declineDraft']);
  assert.equal(declineDraft(tr, 'já te respondo'), 'já te respondo');
  assert.equal(declineDraft((k, v) => tIn('en', k as Key, v), ''), tIn('en', 'call.declineDraft'));
});

test('linhas do palco: tentativa minha que falhou mostra o título e o porquê, como no celular (3,5 s na tela)', () => {
  const failed: CallState = { ...IDLE, phase: 'ending', callId: 'c', peer: 'm', dir: 'out', end: { reason: 'noanswer' } };
  assert.deepEqual(callLines(tr, failed, marina, 0, null), { status: 'Sem resposta', speak: 'Marina não atendeu' });
  // Quem recebeu, ou quem desligou: segue como antes (status do fim, sem aviso).
  const mine: CallState = { ...failed, end: { reason: 'cancel' } };
  assert.deepEqual(callLines(tr, mine, marina, 0, null), { status: 'Chamada cancelada', speak: '' });
  const theirs: CallState = { ...failed, dir: 'in' };
  assert.equal(callLines(tr, theirs, marina, 0, null).speak, '');
});
