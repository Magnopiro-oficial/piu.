/// <reference types="node" />
/**
 * Regras de tela do Piu 11 (design/handoff/design/"Piu 11 Modo no e malha.dc.html", N1…N10c):
 * qual estado cada tela mostra, a partir do estado real (modo nó, carteira, malha). Sem React.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhoneNodeError } from '../phoneNodeErrors';
import {
  addrGroups, bondFailOf, bondSheetOf, confirmOutcomeOf, evidenceRowOf, exitShareNeeded, keyGroups, monthCounter, monthRenewalMs, nodeParamsOf, phaseCardOf, phoneScreen,
  requestList, shortHash, sortAskRows, topCardOf, trailSteps,
} from '../phoneNodeView';
import { gatewayRows, meshFunds, meshModeOf, readingAgeDays, transitPill, transitSteps, wholeLunes } from '../carryView';
import { phraseIssue, phraseSlots, placeWord, phraseSuggestions } from '../phraseConfirm';
import { WalletTransferError, type WalletTransferRecord } from '../walletTransfer';
import { isValidPhrase, WORDLIST } from '../../protocol';

const DAY = 86400;

// ── N2 / N2b ────────────────────────────────────────────────

test('phoneScreen: desligado → N1; caução finalizada sem vínculo → N4; o resto → painel N2', () => {
  assert.equal(phoneScreen(null, 'none', false), 'entry');
  assert.equal(phoneScreen('off', 'none', false), 'entry');
  assert.equal(phoneScreen('needsBond', 'none', false), 'panel');
  assert.equal(phoneScreen('bondPending', 'confirming', false), 'panel');
  assert.equal(phoneScreen('bondPending', 'confirmed', false), 'confirm');
  assert.equal(phoneScreen('bondPending', 'confirmed', true), 'panel'); // vínculo antigo: o registro fecha sozinho
  for (const p of ['certStreak', 'needsEndorsements', 'ready', 'left'] as const) assert.equal(phoneScreen(p, 'registered', true), 'panel');
});

test('trailSteps (N2): anteriores ✓, atual pulsando, seguintes cinza; 7 dias e avais andam juntos', () => {
  const st = (o: Partial<Parameters<typeof trailSteps>[0]>) => trailSteps({ bond: 'registered', certComplete: false, endorsements: 0, needed: 3, ready: false, ...o }).map(s => s.state);
  assert.deepEqual(st({ bond: 'none' }), ['current', 'pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(st({ bond: 'failed' }), ['current', 'pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(st({ bond: 'confirming' }), ['done', 'current', 'pending', 'pending', 'pending']);
  assert.deepEqual(st({ bond: 'confirmed' }), ['done', 'current', 'pending', 'pending', 'pending']);
  assert.deepEqual(st({ endorsements: 1 }), ['done', 'done', 'current', 'current', 'pending']); // N2 do design
  assert.deepEqual(st({ certComplete: true, endorsements: 1 }), ['done', 'done', 'done', 'current', 'pending']);
  assert.deepEqual(st({ certComplete: true, endorsements: 3, ready: true }), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(trailSteps({ bond: 'none', certComplete: false, endorsements: 0, needed: 3, ready: false }).map(s => s.key), ['paid', 'confirmed', 'days', 'endorse', 'ready']);
});

test('phaseCardOf (N2b): uma linha por fase; no topo do painel só as que a trilha não mostra', () => {
  const base = { bound: false, certComplete: false, endorsements: 0, needed: 3 };
  assert.equal(phaseCardOf({ ...base, phase: 'off', bond: 'none' }), null);
  assert.equal(phaseCardOf({ ...base, phase: 'needsBond', bond: 'none' }), 'needsBond');
  assert.equal(phaseCardOf({ ...base, phase: 'bondPending', bond: 'confirming' }), 'bondSent');
  assert.equal(phaseCardOf({ ...base, phase: 'bondPending', bond: 'unconfirmed' }), 'bondUnconfirmed');
  assert.equal(phaseCardOf({ ...base, phase: 'bondPending', bond: 'failed' }), 'bondFailed');
  assert.equal(phaseCardOf({ ...base, phase: 'bondPending', bond: 'confirmed' }), 'confirmBond');
  assert.equal(phaseCardOf({ ...base, bound: true, phase: 'bondPending', bond: 'confirmed' }), 'bondSent');
  assert.equal(phaseCardOf({ ...base, phase: 'certStreak', bond: 'registered' }), 'days');
  assert.equal(phaseCardOf({ ...base, phase: 'needsEndorsements', bond: 'registered' }), 'endorse');
  assert.equal(phaseCardOf({ ...base, phase: 'ready', bond: 'registered' }), 'ready');
  assert.equal(phaseCardOf({ ...base, phase: 'left', bond: 'registered' }), 'left');
  for (const k of ['needsBond', 'bondSent', 'bondUnconfirmed', 'bondFailed', 'confirmBond', 'left'] as const) assert.equal(topCardOf(k), k);
  for (const k of ['days', 'endorse', 'ready', null] as const) assert.equal(topCardOf(k), null);
});

test('nodeParamsOf: o que as telas mostram vem dos parâmetros do programa (100 LUNES, 3 avais, 7 dias, 90, 3, 200 MB, 30%)', () => {
  const p = nodeParamsOf({ bond: '100', minEndorsements: 3, dailyBytes: 200 * 1024 * 1024, batteryPct: 30, rewardsOn: false });
  assert.deepEqual(p, { bond: '100', minEndorsements: 3, days: 7, batteryPct: 30, dailyMb: 200, rewardsOn: false, refundDays: 7, endorseValidityDays: 90, maxPerMonth: 5 });
});

test('shortHash / addrGroups (N3, N4)', () => {
  assert.equal(shortHash('0x8e41' + '0'.repeat(56) + 'c07a'), '8E41 … C07A');
  assert.equal(shortHash(null), '—');
  assert.equal(addrGroups('3P8xKd2Qabcdefghij9vLm'), '3P8x Kd2Q … 9vLm');
});

test('sortAskRows (N5): avalizou, pedido, pode pedir; depois os que não podem', () => {
  const rows = [{ kind: 'noNode', name: 'B' }, { kind: 'eligible', name: 'R' }, { kind: 'asked', name: 'D' }, { kind: 'received', name: 'L' }, { kind: 'notVerified', name: 'C' }, { kind: 'eligible', name: 'J' }] as const;
  assert.deepEqual(sortAskRows(rows).map(r => r.name), ['L', 'D', 'J', 'R', 'C', 'B']);
});

test('keyGroups: chave do nó em 4 grupos de 4 (N2, N5)', () => {
  assert.equal(keyGroups('7f3a91c24d0e18b5' + '0'.repeat(48)), '7F3A 91C2 4D0E 18B5');
  assert.equal(keyGroups(null), '—');
  assert.equal(keyGroups('abc'), '—');
});

// ── N3 / N4 ─────────────────────────────────────────────────

test('bondSheetOf (N3a–e): cada bloqueio vira o seu estado no lugar da folha', () => {
  assert.equal(bondSheetOf(null), 'sheet');
  assert.equal(bondSheetOf('soon'), 'soon');
  assert.equal(bondSheetOf('noWallet'), 'noWallet');
  assert.equal(bondSheetOf('pending'), 'sent');
  assert.equal(bondSheetOf('done'), 'registered');
  assert.equal(bondSheetOf('inactive'), 'inactive');
});

test('bondFailOf (N3f–h): saldo, biometria cancelada e carteira ocupada; o resto é aviso', () => {
  assert.equal(bondFailOf(new PhoneNodeError('insufficient')), 'insufficient');
  assert.equal(bondFailOf(new WalletTransferError('funds', 'x')), 'insufficient');
  assert.equal(bondFailOf(new PhoneNodeError('cancelled')), 'cancelled');
  assert.equal(bondFailOf(new WalletTransferError('cancelled', 'x')), 'cancelled');
  assert.equal(bondFailOf(new WalletTransferError('busy', 'x')), 'busy');
  assert.equal(bondFailOf(new PhoneNodeError('soon')), 'soon');
  assert.equal(bondFailOf(new Error('rede')), 'toast');
});

test('confirmOutcomeOf (N4a–d)', () => {
  assert.equal(confirmOutcomeOf(null), 'ok');
  assert.equal(confirmOutcomeOf(new PhoneNodeError('notFinal')), 'notFinal');
  assert.equal(confirmOutcomeOf(new PhoneNodeError('cancelled')), 'cancelled');
  assert.equal(confirmOutcomeOf(new PhoneNodeError('recover')), 'recover');
  assert.equal(confirmOutcomeOf(new PhoneNodeError('wrongWallet')), 'toast');
});

// ── N4e: frase inteira (adaptação honesta) ──────────────────

const GOOD = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');

test('phraseSlots: preenchidas, a atual (anel) e as vazias', () => {
  const w = ['a', 'b', '', '', '', '', '', '', '', '', '', ''];
  assert.deepEqual(phraseSlots(w, 2).slice(0, 4), ['filled', 'filled', 'current', 'empty']);
  assert.equal(phraseSlots(w, 2).length, 12);
});

test('placeWord: coloca e vai para a próxima vazia; colar a frase preenche tudo', () => {
  const empty = Array(12).fill('');
  let r = placeWord(empty, 0, 'Legal ');
  assert.equal(r.words[0], 'legal');
  assert.equal(r.cursor, 1);
  r = placeWord(r.words, 5, 'sausage');
  assert.equal(r.cursor, 1, 'volta para a primeira vazia');
  r = placeWord(empty, 0, GOOD.join(' '));
  assert.deepEqual(r.words, GOOD);
  assert.equal(r.cursor, 11);
});

test('phraseIssue: incompleta, palavra fora da lista (posição revelada: é o que a pessoa digitou), checksum sem posição', () => {
  assert.equal(isValidPhrase(GOOD), true);
  assert.deepEqual(phraseIssue([...GOOD.slice(0, 11), '']), { kind: 'incomplete' });
  assert.deepEqual(phraseIssue([...GOOD.slice(0, 7), 'zzzz', ...GOOD.slice(8)]), { kind: 'notInList', index: 7 });
  const swapped = [...GOOD]; swapped[0] = 'abandon';
  assert.deepEqual(phraseIssue(swapped), { kind: 'checksum' });
  assert.deepEqual(phraseIssue(GOOD), { kind: 'ok' });
});

test('phraseSuggestions: só palavras da lista BIP39, no máximo 9', () => {
  const s = phraseSuggestions('ab');
  assert.ok(s.length > 0 && s.length <= 9 && s.every(w => WORDLIST.includes(w) && w.startsWith('ab')));
  assert.deepEqual(phraseSuggestions('a'), []);
});

// ── N6 ──────────────────────────────────────────────────────

test('requestList (N6): válidos primeiro, mais novos antes; o primeiro (ou o da notificação) abre expandido', () => {
  const R = (id: string, createdAt: number, state: 'ok' | 'expired' = 'ok') => ({ contactId: id, createdAt, state, block: null });
  const l = requestList([R('a', 10), R('b', 30), R('c', 50, 'expired'), R('d', 20)], null);
  assert.deepEqual(l.map(x => x.contactId), ['b', 'd', 'a', 'c']);
  assert.deepEqual(l.map(x => x.expanded), [true, false, false, false]);
  assert.deepEqual(requestList([R('a', 10), R('b', 30)], 'a').map(x => x.expanded), [false, true]);
  assert.deepEqual(requestList([], 'a'), []);
});

test('monthCounter / monthRenewalMs (N6, N6d): 2 de 5 = 40%; renova no dia 1 do mês seguinte (UTC)', () => {
  assert.deepEqual(monthCounter(2, 5), { n: 2, max: 5, pct: 0.4, full: false });
  assert.deepEqual(monthCounter(7, 5), { n: 7, max: 5, pct: 1, full: true });
  const nov6 = Date.UTC(2026, 10, 6, 15) / 1000;
  assert.equal(monthRenewalMs(nov6), Date.UTC(2026, 11, 1, 12));
  assert.equal(new Date(monthRenewalMs(nov6) - 3 * 3600_000).getUTCDate(), 1, 'em UTC−3 ainda é dia 1');
  assert.equal(monthRenewalMs(Date.UTC(2026, 11, 31, 23) / 1000), Date.UTC(2027, 0, 1, 12));
});

// ── N7b / N10a–c ────────────────────────────────────────────

test('exitShareNeeded (N7b): fica até compartilhar o arquivo depois da saída', () => {
  assert.equal(exitShareNeeded(null, null), false);
  assert.equal(exitShareNeeded(100, null), true);
  assert.equal(exitShareNeeded(100, 90), true);
  assert.equal(exitShareNeeded(100, 100), false);
});

test('evidenceRowOf (N10a–c): sem chave do validador, mensageiro abrindo, nada, prontas', () => {
  assert.deepEqual(evidenceRowOf({ validatorKey: false, messenger: true, items: 38, carriedItems: null }), { kind: 'noValidator' });
  assert.deepEqual(evidenceRowOf({ validatorKey: true, messenger: false, items: 38, carriedItems: null }), { kind: 'notReady' });
  assert.deepEqual(evidenceRowOf({ validatorKey: true, messenger: true, items: 0, carriedItems: null }), { kind: 'nothing', carried: false });
  assert.deepEqual(evidenceRowOf({ validatorKey: true, messenger: true, items: 38, carriedItems: 38 }), { kind: 'nothing', carried: true });
  assert.deepEqual(evidenceRowOf({ validatorKey: true, messenger: true, items: 40, carriedItems: 38 }), { kind: 'ready', n: 40 });
  assert.deepEqual(evidenceRowOf({ validatorKey: true, messenger: true, items: 38, carriedItems: null }), { kind: 'ready', n: 38 });
});

// ── N8 / N9 ─────────────────────────────────────────────────

const NOWMS = 1_800_000_000_000;

test('meshModeOf (N8, N8a, N9d): em trânsito bloqueia; com rede é o envio normal; sem rede precisa de leitura ≤ 7 dias', () => {
  const m = (o: Partial<Parameters<typeof meshModeOf>[0]>) => meshModeOf({ offline: true, inTransit: false, ctxAt: NOWMS - 2 * DAY * 1000, now: NOWMS, bridge: true, ...o });
  assert.deepEqual(m({ inTransit: true, offline: false }), { kind: 'inTransit' });
  assert.deepEqual(m({ offline: false }), { kind: 'online' });
  assert.deepEqual(m({ bridge: false }), { kind: 'unavailable' });
  assert.deepEqual(m({ ctxAt: null }), { kind: 'noReading' });
  assert.deepEqual(m({ ctxAt: NOWMS - 9 * DAY * 1000 }), { kind: 'stale', days: 9 });
  assert.deepEqual(m({}), { kind: 'mesh', days: 2 });
  assert.equal(readingAgeDays(NOWMS - 3600_000, NOWMS), 0);
});

test('wholeLunes: valor inteiro sem ",00"', () => {
  assert.equal(wholeLunes(25n * 100_000_000n), '25');
  assert.equal(wholeLunes('2503000000'), '25,03');
});

test('meshFunds (N8, N8b): taxa com folga (o dobro da última lida) e total', () => {
  assert.deepEqual(meshFunds({ value: 2500n, fee: 1n, available: 2503n }), { ok: true, fee: 2n, total: 2502n, have: 2503n, need: 2502n });
  assert.deepEqual(meshFunds({ value: 2500n, fee: 2n, available: 2501n }), { ok: false, fee: 4n, total: 2504n, have: 2501n, need: 2504n });
});

const REC = (o: Partial<WalletTransferRecord> = {}): WalletTransferRecord => ({
  id: 'h', from: 'a', dest: 'b', value: '2500', fee: '1', hash: 'h', hex: '00', validUntil: Number.MAX_SAFE_INTEGER, status: 'signed', createdAt: 1000, updatedAt: 1000,
  ctx: { specVersion: 1, transactionVersion: 1, genesisHash: '0x', blockHash: '0x', blockNumber: 1, nonce: 0, period: 0, tip: '0' },
  carried: { envelopeId: 'ab'.repeat(16), at: 2000, expiresAt: 9 }, ...o,
});

test('transitSteps (N9): assinada, na malha, gateway (informado, não conferido), confirmada só pelo aparelho', () => {
  const k = (r: WalletTransferRecord) => transitSteps(r).map(s => `${s.key}:${s.state}${s.note ? `:${s.note}` : ''}`);
  assert.deepEqual(k(REC()), ['signed:done', 'mesh:done', 'gateway:current:waiting', 'confirmed:pending']);
  assert.deepEqual(k(REC({ carried: { envelopeId: '0'.repeat(32), at: 2000, expiresAt: 0 }, error: 'sem malha' })), ['signed:done', 'mesh:current:meshError', 'gateway:pending', 'confirmed:pending']);
  for (const st of ['pool', 'included', 'finalized', 'invalid', 'error'] as const) {
    assert.deepEqual(k(REC({ carried: { envelopeId: 'ab'.repeat(16), at: 2000, expiresAt: 9, report: { status: st, at: 3000 } } })), ['signed:done', 'mesh:done', `gateway:current:${st}`, 'confirmed:pending']);
  }
  assert.deepEqual(k(REC({ status: 'finalized' })), ['signed:done', 'mesh:done', 'gateway:done', 'confirmed:done']);
  assert.deepEqual(k(REC({ status: 'failed' })), ['signed:done', 'mesh:done', 'gateway:done', 'confirmed:failed']);
  assert.equal(transitSteps(REC())[1]!.at, 2000);
});

test('transitPill / gatewayRows (N9, N9a, N9b, N9c)', () => {
  assert.equal(transitPill(REC()), 'traveling');
  assert.equal(transitPill(REC({ carried: { envelopeId: 'ab'.repeat(16), at: 1, expiresAt: 1, report: { status: 'included', at: 2 } } })), 'reported');
  assert.equal(transitPill(REC({ carried: { envelopeId: 'ab'.repeat(16), at: 1, expiresAt: 1, report: { status: 'invalid', at: 2 } } })), 'refused');
  assert.equal(transitPill(REC({ carried: { envelopeId: '0'.repeat(32), at: 1, expiresAt: 0 }, error: 'x' })), 'meshError');
  assert.equal(transitPill(REC({ status: 'finalized' })), 'confirmed');
  assert.equal(transitPill(REC({ status: 'failed' })), 'failed');
  assert.deepEqual(gatewayRows().map(r => [r.key, r.verified]), [['pool', false], ['included', false], ['finalized', false], ['invalid', false], ['confirmed', true]]);
});
