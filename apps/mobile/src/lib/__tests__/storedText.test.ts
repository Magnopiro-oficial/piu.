/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tIn, type Key, type Vars } from '../../i18n';
import { STORED, localizeStored, nearAcceptedText } from '../storedText';
import { msgSummary } from '../chatCore';
import type { CallRecord } from '../../calls/callMachine';

const en = (k: Key, v?: Vars) => tIn('en', k, v);
const pt = (k: Key, v?: Vars) => tIn('pt-BR', k, v);

test('texto gravado em pt-BR na conversa aparece no idioma do app', () => {
  assert.equal(localizeStored(STORED.subRequest, en), 'chat request · check the code');
  assert.equal(localizeStored(STORED.subE2e, en), 'end-to-end encrypted');
  assert.equal(localizeStored(STORED.sysRequest, en), 'This person wrote first. Check the safety code in person before trusting them.');
});

test('em pt-BR o texto fica igual ao gravado (nada muda para quem já usa)', () => {
  for (const s of Object.values(STORED)) assert.equal(localizeStored(s, pt), s);
});

test('aviso de Por perto com o nome da pessoa: traduz e mantém o nome', () => {
  assert.equal(localizeStored(nearAcceptedText('Adriana'), en), 'Adriana accepted your Nearby invite. The chat is end-to-end encrypted.');
  assert.equal(localizeStored(nearAcceptedText(''), en), 'The person accepted your Nearby invite. The chat is end-to-end encrypted.');
  assert.equal(localizeStored(nearAcceptedText('Adriana'), pt), nearAcceptedText('Adriana'));
});

test('texto que a pessoa escreveu não é tocado', () => {
  assert.equal(localizeStored('Oi', en), 'Oi');
  assert.equal(localizeStored('cifrada de ponta a ponta!', en), 'cifrada de ponta a ponta!');
});

test('prévia de registro de chamada segue o idioma, não o título gravado', () => {
  const rec = { callId: 'c1', peer: 'piu:x', dir: 'out', outcome: 'done', at: 0, durationMs: 45_000 } as CallRecord;
  assert.equal(msgSummary({ text: 'Chamada de voz', call: rec }, en), 'Voice call');
  assert.equal(msgSummary({ text: 'Pedido de chamada', callReq: { requestId: 'r', step: 'accepted' } }, en), 'Call request');
});

test('prévia de aviso do sistema gravado também traduz', () => {
  assert.equal(msgSummary({ text: STORED.sysKeys }, en), en('stored.sys.keys'));
});
