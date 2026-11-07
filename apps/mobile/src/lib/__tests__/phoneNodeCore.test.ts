/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHex } from '../../protocol/bytes';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { derivePhoneOperatorKey, makeEndorsement, makePhoneExit, verifyEndorsementRevocation, verifyOperatorCert, verifyPhoneExit, verifyPhoneRegistration } from '../../protocol/phoneNode';
import {
  activate, bind, BOND_ADDRESS, BOND_CONFIRM_TIMEOUT_SEC, bondAffordable, bondBlock, bondFromTransfer, bondPhase, bondSent, cancelExit, certBar, certFailed, distinctEndorsements,
  dropFailedBond, eligibleEndorsers, emptyPhoneNode, endorseBlock, ENDORSE_REQUEST_TTL_SEC, estimateCredits, givenThisMonth, issueDailyCert, leave, markRefund,
  NODE_MODE_LIMITS, nodeModeLimits, nodeSince, notePeer, pauseReason, PHONE_NODE_BOND, PHONE_NODE_BOND_PLANCK, PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH,
  PHONE_NODE_MIN_ENDORSEMENTS, PHONE_NODE_MIN_FREE_BYTES, PHONE_NODE_REWARDS_ON, type PhoneNodeState, phoneNodeStatus, receiveEndorsement, receiveRequest, recordGiven,
  refundFromMoves, refundStatus, register, registryFileName, registryFileOf, requestState, requirementsOf, requirementsOk, revivePhoneNode, revokeGiven,
} from '../phoneNodeCore';
import type { WalletTransferRecord } from '../walletTransfer';
import { DEV_ADDR_42, DEV_ADDR_57 } from './walletFixture';

const DAY0 = 20400;
const NOW = DAY0 * 86400 + 3600;
const BOND_TO = DEV_ADDR_42;
const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const seed = newSeed(), op = derivePhoneOperatorKey(seed), me = toHex(op.pk);
const record = (o: Partial<WalletTransferRecord> = {}): WalletTransferRecord => ({
  id: 'x', from: DEV_ADDR_57, dest: BOND_TO, value: PHONE_NODE_BOND_PLANCK.toString(), fee: '1000000', hash: '0x' + 'cd'.repeat(32), hex: '0x', ctx: {} as WalletTransferRecord['ctx'],
  validUntil: 0, status: 'finalized', createdAt: 0, updatedAt: 0, block: { number: 777, hash: '0x00', index: 1 }, ...o,
});
/** Registrado, ativo desde `since`. */
function registered(since = NOW): PhoneNodeState {
  let s = bind(activate(emptyPhoneNode(), since), DEV_ADDR_57, BOND_TO, new Uint8Array(64).fill(1));
  s = bondSent(s, record({ status: 'submitted' }), since);
  return register(s, op, bondFromTransfer(record(), BOND_TO)!, since);
}

test('parâmetros: caução de 100 LUNES, 3 avais, endereço ainda não definido, recompensas desligadas, limites do modo nó', () => {
  assert.equal(PHONE_NODE_BOND, '100');
  assert.equal(PHONE_NODE_BOND_PLANCK, 10_000_000_000n);
  assert.equal(PHONE_NODE_MIN_ENDORSEMENTS, 3);
  assert.equal(BOND_ADDRESS, null);
  assert.equal(PHONE_NODE_REWARDS_ON, false);
  assert.deepEqual([NODE_MODE_LIMITS.dailyBytes, NODE_MODE_LIMITS.batteryPct], [200 * 1024 * 1024, 30]);
  assert.equal(bondBlock(activate(emptyPhoneNode(), NOW), { bondAddress: BOND_ADDRESS, walletAddress: DEV_ADDR_57 }), 'soon');
});

test('M1e: requisitos com ação para cada um', () => {
  const ok = requirementsOf({ bondAddress: BOND_TO, walletAddress: DEV_ADDR_57, backupDone: true, freeBytes: PHONE_NODE_MIN_FREE_BYTES, batterySaver: false });
  assert.ok(requirementsOk(ok));
  const bad = requirementsOf({ bondAddress: null, walletAddress: null, backupDone: false, freeBytes: 10, batterySaver: true });
  assert.deepEqual(bad.filter(x => !x.ok).map(x => [x.key, x.action]), [['program', null], ['wallet', 'wallet'], ['backup', 'backup'], ['freeSpace', 'freeSpace'], ['batterySaver', 'batterySaver']]);
  assert.ok(requirementsOk(requirementsOf({ bondAddress: BOND_TO, walletAddress: DEV_ADDR_57, backupDone: true, freeBytes: null, batterySaver: null })), 'leitura desconhecida não bloqueia');
});

test('M2 … M2e2: saldo, assinatura, aguardando a rede, ainda não confirmada, falha, registro sem biometria', () => {
  assert.deepEqual(bondAffordable({ value: '100', fee: '5', available: '104' }), { ok: false, needed: 105n, available: 104n, missing: 1n });
  assert.ok(bondAffordable({ value: '100', fee: '5', available: '105' }).ok);
  let s = activate(emptyPhoneNode(), NOW);
  assert.equal(bondPhase(s, null, NOW), 'none');
  assert.equal(bondBlock(s, { bondAddress: BOND_TO, walletAddress: null }), 'noWallet');
  assert.equal(bondBlock(s, { bondAddress: BOND_TO, walletAddress: DEV_ADDR_57 }), null);
  s = bind(s, DEV_ADDR_57, BOND_TO, new Uint8Array(64).fill(1));
  const sent = record({ status: 'submitted', block: undefined });
  s = bondSent(s, sent, NOW);
  assert.equal(bondBlock(s, { bondAddress: BOND_TO, walletAddress: DEV_ADDR_57 }), 'pending');
  assert.equal(bondPhase(s, sent, NOW + 10), 'confirming');
  assert.equal(bondPhase(s, sent, NOW + BOND_CONFIRM_TIMEOUT_SEC), 'unconfirmed', '2 min: ainda não confirmada, não é falha');
  assert.equal(bondPhase(s, record({ status: 'failed' }), NOW + 5), 'failed');
  assert.equal(dropFailedBond(s).bond, undefined);
  assert.equal(bondPhase(s, record(), NOW + 500), 'confirmed');
  // Só serve transferência finalizada, para o endereço da caução, de pelo menos a caução.
  assert.equal(bondFromTransfer(record({ status: 'included' }), BOND_TO), null);
  assert.equal(bondFromTransfer(record({ dest: ALICE }), BOND_TO), null);
  assert.equal(bondFromTransfer(record({ value: '9999999999' }), BOND_TO), null);
  assert.equal(bondFromTransfer(record(), null), null);
  const bond = bondFromTransfer(record(), BOND_TO)!;
  assert.throws(() => register({ ...s, binding: undefined }, op, bond, NOW), /vínculo/);
  s = register(s, op, bond, NOW + 600);
  assert.ok(verifyPhoneRegistration(s.registration!));
  assert.equal(s.registeredAt, NOW + 600, 'N2 "Confirmada na rede" e N3d "desde": quando o registro fechou');
  assert.equal(register(s, op, bond, NOW + 900).registeredAt, NOW + 600, 'não muda depois de registrado');
  assert.equal(bondPhase(s, null, NOW + 600), 'registered');
  assert.equal(bondBlock(s, { bondAddress: BOND_TO, walletAddress: DEV_ADDR_57 }), 'done');
});

test('M3/M3v/M3e: 7 dias seguidos com certificado; dia sem certificado zera; erro de hoje', () => {
  let s = registered();
  assert.deepEqual(certBar(s, NOW).dashes, ['today', 'future', 'future', 'future', 'future', 'future', 'future']);
  assert.equal(phoneNodeStatus(s, me, NOW).phase, 'certStreak');
  s = issueDailyCert(s, NOW);
  assert.deepEqual(certBar(s, NOW).dashes, ['done', 'future', 'future', 'future', 'future', 'future', 'future']);
  for (let d = 1; d < 4; d++) s = issueDailyCert(s, NOW + d * 86400);
  assert.deepEqual(certBar(s, NOW + 4 * 86400).dashes.slice(0, 5), ['done', 'done', 'done', 'done', 'today']);
  assert.equal(phoneNodeStatus(s, me, NOW + 4 * 86400).daysLeft, 3);
  const err = certFailed(s, NOW + 4 * 86400, 'sem chave');
  assert.equal(certBar(err, NOW + 4 * 86400).dashes[4], 'error');
  assert.equal(certBar(issueDailyCert(err, NOW + 4 * 86400), NOW + 4 * 86400).dashes[4], 'done', 'tentar de novo limpa o erro');
  // Pulou um dia: zera.
  assert.deepEqual(certBar(s, NOW + 5 * 86400).dashes, ['today', 'future', 'future', 'future', 'future', 'future', 'future']);
  for (let d = 4; d < 7; d++) s = issueDailyCert(s, NOW + d * 86400);
  const bar = certBar(s, NOW + 6 * 86400);
  assert.ok(bar.complete);
  assert.deepEqual(bar.dashes, Array(7).fill('done'));
  assert.equal(phoneNodeStatus(s, me, NOW + 6 * 86400).phase, 'needsEndorsements');
  assert.equal(issueDailyCert(emptyPhoneNode(), NOW).certDays.length, 0, 'desligado não emite');
});

test('M4/M4v: só avaliza contato verificado pessoalmente e no modo nó há mais de 7 dias', () => {
  let s = registered();
  const contacts = [{ contactId: 'a', verified: true }, { contactId: 'b', verified: false }, { contactId: 'c', verified: true }, { contactId: 'd', verified: true }];
  s = notePeer(s, 'a', NOW - 8 * 86400, NOW);
  s = notePeer(s, 'b', NOW - 30 * 86400, NOW);
  s = notePeer(s, 'c', NOW - 2 * 86400, NOW);
  s = notePeer(s, 'd', 0, NOW);
  assert.deepEqual(eligibleEndorsers(s, contacts, NOW).map(c => c.contactId), ['a']);
  assert.deepEqual(eligibleEndorsers(s, contacts, NOW + 6 * 86400).map(c => c.contactId), ['a', 'c']);
  assert.deepEqual(eligibleEndorsers(emptyPhoneNode(), contacts, NOW), [], 'M4v');
  assert.equal(nodeSince(s), NOW);
  assert.equal(nodeSince(activate(emptyPhoneNode(), NOW)), 0, 'só anuncia com caução registrada');
});

test('M5/M5e: pedido vale 3 dias, pode ser cancelado, exige caução de quem pede; quem avaliza precisa de 7 dias e verificação', () => {
  const other = derivePhoneOperatorKey(newSeed()), pk = toHex(other.pk);
  let s = registered(NOW - 8 * 86400);
  s = receiveRequest(s, 'c1', { phonePk: pk, createdAt: NOW - 10, bondOk: true }, NOW);
  s = receiveRequest(s, 'c2', { phonePk: toHex(derivePhoneOperatorKey(newSeed()).pk), createdAt: NOW, bondOk: false }, NOW);
  s = receiveRequest(s, 'c3', { phonePk: 'zz', createdAt: NOW, bondOk: true }, NOW);
  assert.equal(s.requests.length, 2);
  const r1 = s.requests[0]!;
  assert.equal(requestState(r1, NOW), 'ok');
  assert.equal(requestState(r1, NOW - 10 + ENDORSE_REQUEST_TTL_SEC + 1), 'expired');
  assert.equal(requestState(s.requests[1]!, NOW), 'noBond');
  const cancelled = receiveRequest(s, 'c1', { phonePk: pk, createdAt: NOW, bondOk: true, cancel: true }, NOW);
  assert.equal(requestState(cancelled.requests[0]!, NOW), 'cancelled');
  assert.equal(receiveRequest(s, 'c9', { phonePk: pk, createdAt: NOW + 9999, bondOk: true }, NOW).requests.at(-1)!.createdAt, NOW, 'data do futuro conta como agora');
  const ask = { contactId: 'c1', phonePk: pk, verified: true, request: r1 };
  assert.equal(endorseBlock(s, ask, me, NOW), null);
  assert.equal(endorseBlock(s, { ...ask, verified: false }, me, NOW), 'notVerified');
  assert.equal(endorseBlock(registered(NOW - 3 * 86400), ask, me, NOW), 'tooNew');
  assert.equal(endorseBlock(activate(emptyPhoneNode(), NOW - 30 * 86400), ask, me, NOW), 'inactive', 'sem caução registrada não avaliza');
  assert.equal(endorseBlock(s, { ...ask, phonePk: me }, me, NOW), 'self');
  assert.equal(endorseBlock(cancelled, { ...ask, request: cancelled.requests[0]! }, me, NOW), 'cancelled');
  assert.equal(endorseBlock(s, { ...ask, request: s.requests[1]! }, me, NOW), 'noBond');
  // Dá o aval: sai da lista; o limite é de 5 por mês e um por contato.
  s = recordGiven(s, 'c1', makeEndorsement(op, other.pk, DAY0));
  assert.equal(s.requests.length, 1);
  assert.equal(endorseBlock(s, ask, me, NOW), 'already');
  for (let i = 0; i < PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH - 1; i++) s = recordGiven(s, `x${i}`, makeEndorsement(op, derivePhoneOperatorKey(newSeed()).pk, DAY0));
  assert.equal(givenThisMonth(s, NOW), 5);
  assert.equal(endorseBlock(s, { contactId: 'novo', phonePk: toHex(derivePhoneOperatorKey(newSeed()).pk), verified: true }, me, NOW), 'monthly');
  const rv = revokeGiven(s, op, 'c1', NOW);
  assert.ok(verifyEndorsementRevocation(rv.revoked[0]!));
  assert.equal(revokeGiven(rv, op, 'c1', NOW).revoked.length, 1);
});

test('avais recebidos: conferidos, um por avalista e por contato, válidos por 90 dias', () => {
  let s = registered();
  const a = derivePhoneOperatorKey(newSeed()), b = derivePhoneOperatorKey(newSeed());
  s = receiveEndorsement(s, 'ctA', makeEndorsement(a, op.pk, DAY0), me, NOW);
  s = receiveEndorsement(s, 'ctA', makeEndorsement(b, op.pk, DAY0), me, NOW);
  s = receiveEndorsement(s, 'ctB', makeEndorsement(a, op.pk, DAY0 + 1), me, NOW);
  s = receiveEndorsement(s, 'ctC', { ...makeEndorsement(b, op.pk, DAY0), day: 1 }, me, NOW);
  s = receiveEndorsement(s, 'ctD', makeEndorsement(b, a.pk, DAY0), me, NOW);
  assert.equal(distinctEndorsements(s, me, NOW).length, 1);
  assert.equal(distinctEndorsements(s, me, NOW + 91 * 86400).length, 0, 'venceu');
});

test('M6/M6b/M6e: saída, progresso de 7 dias, devolução vista na carteira, voltar a ser nó', () => {
  let s = registered();
  s = leave(s, op, NOW);
  assert.ok(verifyPhoneExit(s.exit!));
  assert.equal(phoneNodeStatus(s, me, NOW).phase, 'left');
  assert.deepEqual(refundStatus(s, NOW + 3.5 * 86400), { phase: 'waiting', dueAt: NOW + 7 * 86400, progress: 0.5, daysLeft: 4 });
  assert.equal(refundStatus(s, NOW + 8 * 86400).phase, 'overdue');
  assert.equal(leave(s, op, NOW + 1).exit, s.exit, 'sair duas vezes não troca o pedido');
  assert.equal(activate(s, NOW + 1), s, 'com saída em andamento, ativar não faz nada (use voltar a ser nó)');
  // Voltar a ser nó: cancela, os dias zeram, e os dois eventos vão no arquivo.
  const back = cancelExit(s, op, NOW + 86400);
  assert.equal(back.exit, undefined);
  assert.equal(refundStatus(back, NOW + 86400).phase, 'none');
  assert.deepEqual(back.exitEvents.map(e => e.kind), ['exit', 'cancel']);
  assert.ok(back.exitEvents.every(verifyPhoneExit));
  assert.equal(phoneNodeStatus(back, me, NOW + 86400).phase, 'certStreak');
  // A devolução aparece no histórico da carteira.
  const moves = [{ direction: 'in', counterparty: ALICE, amount: 1n, at: (NOW + 3600) * 1000 }, { direction: 'in', counterparty: BOND_TO, amount: PHONE_NODE_BOND_PLANCK, at: (NOW - 10) * 1000 }, { direction: 'in', counterparty: BOND_TO, amount: PHONE_NODE_BOND_PLANCK, at: (NOW + 7200) * 1000 }];
  const at = refundFromMoves(moves, BOND_TO, s.exit!.at)!;
  assert.equal(at, NOW + 7200, 'só entrada vinda da caução, depois da saída');
  const done = markRefund(s, at);
  assert.equal(refundStatus(done, NOW + 9 * 86400).phase, 'returned');
  assert.equal(cancelExit(done, op, NOW + 9 * 86400), done, 'depois da devolução, não volta com a mesma caução');
  const again = activate(done, NOW + 10 * 86400);
  assert.equal(again.registration, undefined, 'voltar depois da devolução exige caução nova');
  assert.equal(phoneNodeStatus(again, me, NOW + 10 * 86400).phase, 'needsBond');
  const quit = leave(activate(emptyPhoneNode(), NOW), op, NOW + 1);
  assert.equal(quit.activeSince, null, 'sem caução, sair só desliga');
});

test('limites do modo nó: 200 MB/dia e bateria de 30% (o mais restritivo vence); motivo da pausa', () => {
  assert.deepEqual(nodeModeLimits({ dailyBytes: 1e12, batteryPct: 20 }, true), { dailyBytes: 200 * 1024 * 1024, batteryPct: 30 });
  assert.deepEqual(nodeModeLimits({ dailyBytes: 1e6, batteryPct: 50 }, true), { dailyBytes: 1e6, batteryPct: 50 });
  assert.deepEqual(nodeModeLimits({ dailyBytes: 1e12, batteryPct: 20 }, false), { dailyBytes: 1e12, batteryPct: 20 });
  const base = { relayOn: true, batteryLevel: 0.8, charging: false, batteryPct: 30, chargingOnly: false, dailyExhausted: false, outOfHours: false, peers: 2 };
  assert.equal(pauseReason(base), null);
  assert.equal(pauseReason({ ...base, batteryLevel: 0.3 }), 'battery');
  assert.equal(pauseReason({ ...base, batteryLevel: 0.3, charging: true }), null);
  assert.equal(pauseReason({ ...base, chargingOnly: true }), 'charging');
  assert.equal(pauseReason({ ...base, dailyExhausted: true }), 'dailyLimit');
  assert.equal(pauseReason({ ...base, relayOn: false }), 'off');
  assert.equal(pauseReason({ ...base, peers: 0 }), 'noPeers');
});

test('arquivo de registro: certificados das chaves do dia, registro, avais, saídas e retiradas', () => {
  let s = registered(NOW - 2 * 86400);
  assert.equal(registryFileOf(activate(emptyPhoneNode(), NOW), op, d => deriveNodeKey(seed, d), NOW), null);
  const a = derivePhoneOperatorKey(newSeed());
  s = receiveEndorsement(s, 'ctA', makeEndorsement(a, op.pk, DAY0), me, NOW);
  const f = registryFileOf(s, op, d => deriveNodeKey(seed, d), NOW)!;
  assert.equal(f.certs.length, 2 + 1 + 7);
  assert.ok(f.certs.every(verifyOperatorCert));
  assert.equal(f.certs[2]!.nodePk, toHex(deriveNodeKey(seed, DAY0).pk));
  assert.equal(f.endorsements.length, 1);
  s = leave(s, op, NOW);
  const g = registryFileOf(s, op, d => deriveNodeKey(seed, d), NOW + 5 * 86400)!;
  assert.equal(g.certs.length, 3, 'depois da saída, nenhum certificado novo');
  assert.equal(g.exits.length, 1);
  assert.match(registryFileName(Date.UTC(2026, 10, 6, 12)), /^piu-registro-celular-2026-11-0[67]\.json$/);
  assert.deepEqual(revivePhoneNode(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(revivePhoneNode(null), emptyPhoneNode());
});

test('estimativa de créditos: só recibos desde a ativação, sem os rejeitados, até a saída', () => {
  const s = activate(emptyPhoneNode(), NOW);
  const cs = [{ at: NOW - 7200, credits: 1, state: 'validado' }, { at: NOW + 10, credits: 0.5, state: 'pendente' }, { at: NOW + 20, credits: 1, state: 'rejeitado' }, { at: NOW + 30, credits: 0.25, state: 'validado' }];
  assert.deepEqual(estimateCredits(cs, s), { receipts: 2, credits: 0.75 });
  assert.deepEqual(estimateCredits(cs, emptyPhoneNode()), { receipts: 0, credits: 0 });
  assert.deepEqual(estimateCredits(cs, { ...s, exit: makePhoneExit(op, '0x' + 'cd'.repeat(32), NOW + 25) }), { receipts: 1, credits: 0.5 });
});
