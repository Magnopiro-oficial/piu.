/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { certBar, certFailed, emptyPhoneNode, ENDORSE_REQUEST_TTL_SEC, issueDailyCert, type PhoneNodeState } from '../phoneNodeCore';
import {
  askRows, certDayOf, certValidUntilMs, daysUntil, endorseSlots, errorAction, leaveMode, newRequestNotices, personalRequirementsOk, phoneScreen,
  requestNoticeKey, requestView, shortAddr, shortOp,
} from '../phoneNodeView';

const DAY = 86400;
const D0 = 20400;
const NOW = D0 * DAY + 10 * 3600;
const ME = 'ab'.repeat(32);
const C = (id: string, name: string, verified = true) => ({ contactId: id, chatId: 'p' + id, name, verified });
const endorsement = (phonePk = ME) => ({ endorserPk: 'cd'.repeat(32), phonePk, day: D0, inPerson: true, sig: '00' });

test('shortOp / shortAddr', () => {
  assert.equal(shortOp('7f3a91c2' + '0'.repeat(56)), 'op:7F3A 91C2');
  assert.equal(shortOp(null), '—');
  assert.equal(shortAddr('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'), '5Grw…utQY');
  assert.equal(shortAddr(null), '—');
});

test('phoneScreen (Piu 11): desligado → N1; caução esperando o vínculo → N4; o resto → painel N2', () => {
  assert.equal(phoneScreen(null, 'none', false), 'entry');
  assert.equal(phoneScreen('needsBond', 'none', false), 'panel');
  assert.equal(phoneScreen('bondPending', 'unconfirmed', false), 'panel');
  assert.equal(phoneScreen('bondPending', 'confirmed', false), 'confirm');
  for (const p of ['certStreak', 'needsEndorsements', 'ready', 'left'] as const) assert.equal(phoneScreen(p, 'registered', true), 'panel');
});

test('errorAction: cada código vai para a tela ou o aviso certo', () => {
  const E = (code: string) => Object.assign(new Error(code), { code });
  assert.deepEqual(errorAction(E('requirements')), { kind: 'requirements' });
  assert.deepEqual(errorAction(E('insufficient')), { kind: 'insufficient' });
  assert.deepEqual(errorAction(E('soon')), { kind: 'soon' });
  assert.deepEqual(errorAction(E('cancelled')), { kind: 'silent' });
  assert.deepEqual(errorAction(E('recover')), { kind: 'silent' });
  for (const k of ['noKeys', 'wrongWallet', 'bond', 'endorse', 'notEligible']) assert.deepEqual(errorAction(E(k)), { kind: 'toast', key: k });
  assert.deepEqual(errorAction(new Error('rede')), { kind: 'toast', key: 'generic' });
});

test('personalRequirementsOk: o programa "em breve" não trava o Continuar', () => {
  assert.equal(personalRequirementsOk([{ key: 'program', ok: false }, { key: 'wallet', ok: true }]), true);
  assert.equal(personalRequirementsOk([{ key: 'program', ok: true }, { key: 'backup', ok: false }]), false);
});

test('certDayOf: hoje conta como em andamento até o certificado sair', () => {
  let s: PhoneNodeState = { ...emptyPhoneNode(), activeSince: NOW - 3 * DAY };
  // nenhum certificado ainda: dia 1
  assert.equal(certDayOf(certBar(s, NOW)), 1);
  s = issueDailyCert(s, NOW);
  assert.equal(certDayOf(certBar(s, NOW)), 1); // hoje saiu: dia 1 de 7
  s = { ...s, certDays: [D0 - 2, D0 - 1] };
  assert.equal(certDayOf(certBar(s, NOW)), 3); // ontem e anteontem; hoje é o 3º
  s = issueDailyCert(s, NOW);
  assert.equal(certDayOf(certBar(s, NOW)), 3);
  s = certFailed({ ...s, certDays: [D0 - 2, D0 - 1] }, NOW, 'x');
  assert.equal(certDayOf(certBar(s, NOW)), 3); // M3e: o dia 3 está pausado
  s = { ...s, certError: undefined, certDays: [0, 1, 2, 3, 4, 5, 6].map(i => D0 - i) };
  assert.equal(certDayOf(certBar(s, NOW)), 7);
});

test('certValidUntilMs: fim do dia UTC; daysUntil arredonda para cima', () => {
  assert.equal(certValidUntilMs(NOW), (D0 + 1) * DAY * 1000 - 60_000);
  assert.equal(daysUntil(NOW + 1, NOW), 1);
  assert.equal(daysUntil(NOW + 2.5 * DAY, NOW), 3);
  assert.equal(daysUntil(NOW - 5, NOW), 0);
});

test('endorseSlots: recebidos, depois pedidos, depois vagas; cancelado não ocupa vaga', () => {
  const contacts = [C('a', 'Marina'), C('b', 'João'), C('c', 'Bento')];
  const s: PhoneNodeState = {
    ...emptyPhoneNode(),
    received: [{ contactId: 'a', e: endorsement(), at: NOW - DAY }, { contactId: 'x', e: endorsement('ef'.repeat(32)), at: NOW }],
    asked: [{ contactId: 'b', at: NOW - 3600 }, { contactId: 'c', at: NOW - 60, cancelled: true }],
  };
  const slots = endorseSlots(s, contacts, ME, 3, NOW);
  assert.deepEqual(slots.map(x => x.kind), ['received', 'asked', 'empty']);
  assert.equal(slots[0]!.kind === 'received' && slots[0]!.name, 'Marina');
  assert.equal(slots[1]!.kind === 'asked' && slots[1]!.expired, false);
  const old = endorseSlots({ ...s, asked: [{ contactId: 'b', at: NOW - ENDORSE_REQUEST_TTL_SEC - 1 }] }, contacts, ME, 3, NOW);
  assert.equal(old[1]!.kind === 'asked' && old[1]!.expired, true);
  assert.deepEqual(endorseSlots(emptyPhoneNode(), contacts, ME, 3, NOW).map(x => x.kind), ['empty', 'empty', 'empty']);
});

test('askRows: cada contato com o motivo, elegíveis primeiro', () => {
  const contacts = [C('n', 'Dona Cida', false), C('o', 'Bento'), C('t', 'João'), C('e', 'Lia'), C('r', 'Marina'), C('k', 'Ana')];
  const s: PhoneNodeState = {
    ...emptyPhoneNode(),
    peers: { t: { since: NOW - 2 * DAY, at: NOW }, e: { since: NOW - 90 * DAY, at: NOW }, k: { since: NOW - 20 * DAY, at: NOW }, o: { since: 0, at: NOW } },
    received: [{ contactId: 'r', e: endorsement(), at: NOW - DAY }],
    asked: [{ contactId: 'k', at: NOW - DAY }],
  };
  const rows = askRows(s, contacts, NOW);
  assert.deepEqual(rows.map(r => [r.name, r.kind]), [['Lia', 'eligible'], ['Ana', 'asked'], ['Marina', 'received'], ['João', 'tooNew'], ['Dona Cida', 'notVerified'], ['Bento', 'noNode']]);
  const tooNew = rows.find(r => r.kind === 'tooNew')!;
  assert.ok(tooNew.kind === 'tooNew' && tooNew.nodeDays === 2 && tooNew.daysLeft === 5);
  const lia = rows[0]!;
  assert.ok(lia.kind === 'eligible' && lia.nodeDays === 90);
  // pedido vencido: volta a ser elegível
  const again = askRows({ ...s, asked: [{ contactId: 'k', at: NOW - ENDORSE_REQUEST_TTL_SEC - 1 }] }, contacts, NOW);
  assert.equal(again.find(r => r.contactId === 'k')!.kind, 'eligible');
});

test('requestView: estado do pedido antes do bloqueio; sem pedido = M5e', () => {
  assert.deepEqual(requestView(undefined), { screen: 'm5e', reason: 'missing' });
  assert.deepEqual(requestView({ state: 'ok', block: null }), { screen: 'm5' });
  assert.deepEqual(requestView({ state: 'expired', block: 'notVerified' }), { screen: 'm5e', reason: 'expired' });
  assert.deepEqual(requestView({ state: 'noBond', block: 'noBond' }), { screen: 'm5e', reason: 'noBond' });
  assert.deepEqual(requestView({ state: 'ok', block: 'monthly' }), { screen: 'm5e', reason: 'monthly' });
});

test('newRequestNotices: só pedidos válidos e não avisados', () => {
  const reqs = [{ contactId: 'a', createdAt: 1, state: 'ok' as const }, { contactId: 'b', createdAt: 2, state: 'expired' as const }, { contactId: 'c', createdAt: 3, state: 'ok' as const }];
  assert.deepEqual(newRequestNotices(reqs, [requestNoticeKey(reqs[0]!)]).map(r => r.contactId), ['c']);
});

test('leaveMode: com caução a caminho, sair espera a confirmação', () => {
  assert.equal(leaveMode({ registered: true, bond: 'registered' }), 'refund');
  assert.equal(leaveMode({ registered: false, bond: 'none' }), 'turnOff');
  assert.equal(leaveMode({ registered: false, bond: 'failed' }), 'turnOff');
  assert.equal(leaveMode({ registered: false, bond: 'confirming' }), 'wait');
  assert.equal(leaveMode({ registered: false, bond: 'unconfirmed' }), 'wait');
});
