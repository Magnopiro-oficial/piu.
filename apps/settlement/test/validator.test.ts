import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeAddress } from '@polkadot/util-crypto';
import { Journal } from '../src/journal.js';
import { planLot } from '../src/lot.js';
import { toHex } from '../src/protocol/bytes.js';
import type { KeyPair } from '../src/protocol/keys.js';
import { makePayoutClaim } from '../src/protocol/receipts.js';
import { payLot } from '../src/settler.js';
import { lunesToPlanck } from '../src/units.js';
import {
  type AuditFile, closeEpoch, emptyState, epochEnd, epochOf, epochStart, type EvidenceFile, settleLot, toClaims, toEvidence, type ValidatorState,
} from '../src/validator.js';
import { FakeChain } from './fake-chain.js';
import { buildLedger, delivery, evidence, node } from './v2-helpers.js';

const L = (s: string) => lunesToPlanck(s);
const E1 = '2026-S40', E2 = '2026-S41', E3 = '2026-S42';
const inE = (e: string, h = 12) => epochStart(e) + h * 3600;
const closeAt = (e: string) => epochEnd(e) + 7 * 86400 + 60; // depois da janela das provas
const wallet = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);

// Entregas, nós (registrados, cada um com o seu operador) e provas v2: test/v2-helpers.ts.

function close(epoch: string, ev: EvidenceFile[], state: ValidatorState, claims: { node: KeyPair; addr: string }[] = [], budget = '1000', audits: AuditFile[] = []) {
  const now = closeAt(epoch);
  return closeEpoch({
    epoch, budget: L(budget), now, state, ledger: buildLedger(ev, audits, now),
    claims: [toClaims(claims.map(c => makePayoutClaim(c.node, epoch, c.addr)))],
  });
}

test('épocas: semana ISO em UTC, início na segunda, virada de ano', () => {
  assert.equal(epochOf(Date.UTC(2026, 0, 1) / 1000), '2026-S01');
  assert.equal(epochOf(Date.UTC(2027, 0, 1) / 1000), '2026-S53');
  assert.equal(new Date(epochStart('2026-S40') * 1000).getUTCDay(), 1);
  assert.equal(epochOf(epochStart(E1)), E1);
  assert.equal(epochOf(epochEnd(E1) - 1), E1);
  assert.equal(epochOf(epochEnd(E1)), E2);
  assert.throws(() => epochStart('2026-S99'), /inexistente/);
});

test('validador: entrega dividida entre relays, orçamento respeitado, carência de 1 época, lote para o liquidante', () => {
  const a = node(), b = node(), c = node();
  // E1: 10 entregas por A e B juntos (2 relays) e 10 só por C.
  const ds = [...Array.from({ length: 10 }, () => delivery([a, b], inE(E1))), ...Array.from({ length: 10 }, () => delivery([c], inE(E1)))];
  const ev = [evidence(ds)];
  const r1 = close(E1, ev, emptyState(), [], '1000');
  assert.equal(r1.lot, null, 'o que E1 rende só entra no lote seguinte');
  assert.equal(r1.report.deliveries, 20);
  // Unidades: A 5, B 5, C 10 → 1000 LUNES × (5/20, 5/20, 10/20), mas com teto de 2% = 20 LUNES por nó.
  assert.deepEqual(r1.report.accrued.map(x => x.lunes).sort(), ['20', '20', '20']);
  assert.ok(r1.report.accrued.every(x => x.capped));

  // E2 fecha: paga o que E1 rendeu, para quem declarou carteira deste lote.
  const r2 = close(E2, ev, r1.state, [{ node: a, addr: wallet(1) }, { node: b, addr: wallet(2) }, { node: c, addr: wallet(1) }]);
  assert.ok(r2.lot);
  assert.equal(r2.lot.id, `piu-lote-${E2}`);
  const byAddr = Object.fromEntries(r2.lot.payouts.map(p => [p.address, p.lunes]));
  assert.deepEqual(byAddr, { [wallet(1)]: '40', [wallet(2)]: '20' }, 'A e C usam a mesma carteira: somam');
  // O lote passa direto no plano do liquidante.
  assert.equal(planLot(r2.lot).total, L('60'));
  assert.ok(r2.state.accruals.every(x => x.state === 'em-lote'));
  assert.throws(() => close(E2, ev, r2.state), /já foi fechada/);
});

test('validador: sem teto atingido, cada nó recebe a fração exata das unidades', () => {
  const a = node(), b = node(), c = node();
  const ds = [...Array.from({ length: 3 }, () => delivery([a, b, c], inE(E1)))];
  const r = close(E1, [evidence(ds)], emptyState(), [], '100');
  // 3 entregas × 1/3 para cada um = 1 unidade cada; 100 LUNES ÷ 3 = 33,33333333 (teto 2 LUNES? não: 2% de 100 = 2).
  assert.deepEqual(r.report.accrued.map(x => x.lunes), ['2', '2', '2']);
  const big = close(E1, [evidence(ds)], emptyState(), [], '1000', []);
  assert.deepEqual(big.report.accrued.map(x => x.lunes), ['20', '20', '20']);
  const noCap = closeEpoch({ epoch: E1, budget: L('90'), now: closeAt(E1), state: emptyState(), ledger: buildLedger([evidence(ds)], [], closeAt(E1)), claims: [], params: { capPercent: 100 } });
  assert.deepEqual(noCap.report.accrued.map(x => x.lunes), ['30', '30', '30']);
});

test('ataques: Sybil no caminho não aumenta o total por entrega; recibo sem entrega e duplicata não rendem', () => {
  const honest = node();
  const sybils = Array.from({ length: 7 }, node);
  const params = { capPercent: 100 };
  // Sem ataque: o honesto sozinho em 10 entregas.
  const clean = Array.from({ length: 10 }, () => delivery([honest], inE(E1)));
  const r0 = closeEpoch({ epoch: E1, budget: L('100'), now: closeAt(E1), state: emptyState(), ledger: buildLedger([evidence(clean)], [], closeAt(E1)), claims: [], params });
  assert.deepEqual(r0.report.accrued.map(x => x.lunes), ['100']);
  // Com ataque: o atacante põe 7 nós falsos nos mesmos envelopes (assinam recibos que nunca repassaram).
  const attacked = Array.from({ length: 10 }, () => delivery([honest, ...sybils], inE(E1)));
  const ev = evidence(attacked);
  // + recibos de entregas que nunca aconteceram (tráfego sem prova) e duplicatas de recibos válidos.
  const fake = Array.from({ length: 50 }, () => delivery(sybils.slice(0, 2), inE(E1), false));
  const dup = attacked[0]!.receipts;
  const ledger = buildLedger([ev, evidence(fake), toEvidence(dup, [])], [], closeAt(E1));
  const r = closeEpoch({ epoch: E1, budget: L('100'), now: closeAt(E1), state: emptyState(), ledger, claims: [], params });
  const total = r.report.accrued.reduce((s, x) => s + L(x.lunes), 0n);
  assert.ok(total <= L('100'), 'o total nunca passa do orçamento');
  assert.equal(r.report.deliveries, 10, 'entrega sem prova não conta');
  assert.equal(r.report.receipts.noProof, 100, 'os 100 recibos sem prova ficam sem crédito');
  // Teto de 8 relays por envelope: os 8 dividem; o atacante leva 7/8 — o ataque não cria valor novo,
  // só tira dos honestos. Por isso a auditoria por amostragem é obrigatória (teste abaixo).
  assert.equal(r.report.accrued.length, 8);
});

test('ataques: nó reprovado em auditoria perde o que não foi pago; os outros recebem', () => {
  const good = node(), bad = node();
  const ev = [evidence(Array.from({ length: 4 }, () => delivery([good, bad], inE(E1))))];
  const r1 = close(E1, ev, emptyState(), [], '500'); // teto de 2% = 10 LUNES por nó
  assert.equal(r1.report.accrued.length, 2);
  const audit: AuditFile = { v: 1, results: [{ nodePk: toHex(bad.pk), passed: false, reason: 'não retransmitiu o desafio' }] };
  const claims = [{ node: good, addr: wallet(5) }, { node: bad, addr: wallet(6) }];
  const r2 = close(E2, ev, r1.state, claims, '500', [audit]);
  assert.equal(r2.report.lost, 1);
  assert.deepEqual(r2.lot!.payouts, [{ address: wallet(5), lunes: '10' }]);
  assert.ok(r2.state.accruals.some(a => a.node === toHex(bad.pk) && a.state === 'perdido'));
});

test('lote: abaixo do mínimo e sem carteira ficam para o próximo; carteira forjada ou conflitante não vale; expira em 180 dias', () => {
  const a = node(), b = node(), c = node(), d = node();
  const ev = [evidence([...Array.from({ length: 10 }, () => delivery([a], inE(E1))), delivery([b], inE(E1)), ...Array.from({ length: 10 }, () => delivery([c], inE(E1))), ...Array.from({ length: 10 }, () => delivery([d], inE(E1)))])];
  const r1 = closeEpoch({ epoch: E1, budget: L('100'), now: closeAt(E1), state: emptyState(), ledger: buildLedger(ev, [], closeAt(E1)), claims: [], params: { capPercent: 100 } });
  const forged = makePayoutClaim(node(), E2, wallet(9)); forged.nodePk = c.pk; // assinatura de outro nó
  const claims = [toClaims([makePayoutClaim(a, E2, wallet(1)), makePayoutClaim(b, E2, wallet(2)), forged, makePayoutClaim(d, E2, wallet(3)), makePayoutClaim(d, E2, wallet(4))])];
  const r2 = closeEpoch({ epoch: E2, budget: L('100'), now: closeAt(E2), state: r1.state, ledger: buildLedger(ev, [], closeAt(E2)), claims, params: { capPercent: 100 } });
  assert.deepEqual(r2.lot!.payouts.map(p => p.address), [wallet(1)]);
  const reasons = Object.fromEntries(r2.report.carried.map(c => [c.lunes, c.reason]));
  assert.equal(reasons['3.22580645'], 'abaixo do mínimo');
  assert.ok(r2.report.carried.some(x => x.reason === 'sem carteira declarada para este lote'), 'carteira forjada não conta');
  assert.ok(r2.report.carried.some(x => x.reason === 'carteiras conflitantes'));
  // 180 dias depois, o que ficou aguardando expira.
  const late = '2027-S20';
  const r3 = closeEpoch({ epoch: late, budget: L('100'), now: closeAt(late), state: r2.state, ledger: buildLedger(ev, [], closeAt(late)), claims: [], params: { capPercent: 100 } });
  assert.equal(r3.report.expired, 3);
});

test('ciclo completo: fechar → pagar na chain (simulada) → marcar pago; falha volta a aguardar', async () => {
  const a = node(), b = node();
  const ev = [evidence([...Array.from({ length: 6 }, () => delivery([a], inE(E1))), ...Array.from({ length: 4 }, () => delivery([b], inE(E1)))])];
  const r1 = closeEpoch({ epoch: E1, budget: L('100'), now: closeAt(E1), state: emptyState(), ledger: buildLedger(ev, [], closeAt(E1)), claims: [], params: { capPercent: 100 } });
  const claims = [toClaims([makePayoutClaim(a, E2, wallet(1)), makePayoutClaim(b, E2, wallet(2))])];
  const r2 = closeEpoch({ epoch: E2, budget: L('100'), now: closeAt(E2), state: r1.state, ledger: buildLedger(ev, [], closeAt(E2)), claims, params: { capPercent: 100 } });
  const lot = planLot(r2.lot!);
  assert.equal(lot.total, L('100'));

  const treasury = wallet(250);
  const chain = new FakeChain(); chain.balances.set(treasury, L('1000'));
  const journal = new Journal(mkdtempSync(join(tmpdir(), 'piu-ciclo-')));
  chain.failDispatch = 'balances.KeepAlive';
  const failed = await payLot(chain, journal, lot, { from: treasury, signer: treasury, wait: async () => chain.mine() });
  assert.equal(failed.state, 'falhou');
  const back = settleLot(r2.state, lot.id, 'falhou');
  assert.equal(back.changed, 2);
  assert.ok(back.state.accruals.every(x => x.state === 'aguardando' && !x.lot));

  // No lote seguinte (E3), o que falhou entra de novo e é pago.
  chain.failDispatch = null;
  const claims3 = [toClaims([makePayoutClaim(a, E3, wallet(1)), makePayoutClaim(b, E3, wallet(2))])];
  const r3 = closeEpoch({ epoch: E3, budget: L('100'), now: closeAt(E3), state: back.state, ledger: buildLedger(ev, [], closeAt(E3)), claims: claims3, params: { capPercent: 100 } });
  const lot3 = planLot(r3.lot!);
  const paid = await payLot(chain, journal, lot3, { from: treasury, signer: treasury, wait: async () => chain.mine() });
  assert.equal(paid.state, 'finalizado');
  assert.equal(chain.paidTo(wallet(1)), L('60'));
  assert.equal(chain.paidTo(wallet(2)), L('40'));
  const done = settleLot(r3.state, lot3.id, 'finalizado');
  assert.ok(done.state.accruals.every(x => x.state === 'pago'));
});

test('cedo demais: a época só fecha depois da janela das provas', () => {
  assert.throws(() => closeEpoch({ epoch: E1, budget: L('1'), now: epochEnd(E1) + 3600, state: emptyState(), ledger: buildLedger([], [], 0), claims: [] }), /Cedo demais/);
});
