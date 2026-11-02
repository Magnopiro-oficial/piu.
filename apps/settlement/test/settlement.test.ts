import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeAddress } from '@polkadot/util-crypto';
import { preflight } from '../src/chain.js';
import { Journal } from '../src/journal.js';
import { planLot } from '../src/lot.js';
import { payLot, SettlementError } from '../src/settler.js';
import { lunesToPlanck, planckToLunes } from '../src/units.js';
import { FakeChain } from './fake-chain.js';

const addr = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const TREASURY = addr(250);
const L = (s: string) => lunesToPlanck(s);
const lotInput = (id = '2026-W44') => ({ id, payouts: [{ address: addr(1), lunes: '12.5' }, { address: addr(2), lunes: '5' }, { address: encodeAddress(new Uint8Array(32).fill(1), 57), lunes: '0,25' }] });

function setup(balance = '1000') {
  const chain = new FakeChain();
  chain.balances.set(TREASURY, L(balance));
  const journal = new Journal(mkdtempSync(join(tmpdir(), 'piu-lote-')));
  return { chain, journal, opts: { from: TREASURY, signer: TREASURY, wait: async () => { chain.mine(); } } };
}

test('valores: 8 casas sem ponto flutuante', () => {
  assert.equal(lunesToPlanck('12.34'), 1_234_000_000n);
  assert.equal(lunesToPlanck('0,00000001'), 1n);
  assert.equal(lunesToPlanck(5), 500_000_000n);
  assert.equal(planckToLunes(1_234_000_000n), '12.34');
  assert.equal(planckToLunes(140_000n), '0.0014');
  for (const bad of ['-1', '1.123456789', 'abc', '1e3', '']) assert.throws(() => lunesToPlanck(bad));
  assert.equal(lunesToPlanck('0.1') + lunesToPlanck('0.2'), lunesToPlanck('0.3')); // o clássico 0.1 + 0.2
});

test('lote: endereços normalizados e somados, mínimo, remark com hash dos pagamentos', () => {
  const lot = planLot(lotInput());
  assert.equal(lot.payouts.length, 2, 'o mesmo dono em formato 42 e 57 vira um pagamento só');
  assert.equal(lot.payouts.find(p => p.address === addr(1))!.planck, L('12.75'));
  assert.equal(lot.total, L('17.75'));
  assert.match(lot.remark, /^piu\/lote\/v1 2026-W44 [0-9a-f]{64}$/);
  // O hash não depende da ordem nem do formato do endereço.
  const again = planLot({ id: '2026-W44', payouts: [...lotInput().payouts].reverse() });
  assert.equal(again.digest, lot.digest);
  assert.throws(() => planLot({ id: 'x', payouts: [{ address: addr(1), lunes: '4.99' }] }), /mínimo/);
  assert.throws(() => planLot({ id: 'x', payouts: [{ address: 'lunes:abc', lunes: '10' }] }), /Endereço inválido/);
  assert.throws(() => planLot({ id: '../etc', payouts: [{ address: addr(1), lunes: '10' }] }), /id válido/);
  assert.throws(() => planLot({ id: 'x', payouts: Array.from({ length: 3 }, (_, i) => ({ address: addr(i + 1), lunes: '10' })) }, { maxPayouts: 2 }), /divida/);
});

test('liquidação: paga uma vez, finaliza e grava o diário (0600)', async () => {
  const { chain, journal, opts } = setup();
  const lot = planLot(lotInput());
  const e = await payLot(chain, journal, lot, opts);
  assert.equal(e.state, 'finalizado');
  assert.equal(chain.paidTo(addr(1)), L('12.75'));
  assert.equal(chain.paidTo(addr(2)), L('5'));
  // Rodar de novo não paga de novo.
  const again = await payLot(chain, journal, lot, opts);
  assert.equal(again.state, 'finalizado');
  assert.equal(chain.paidTo(addr(1)), L('12.75'));
  const file = join((journal as unknown as { dir: string }).dir, '2026-W44.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(file, 'utf8').includes('seed'));
});

test('queda depois de entrar na chain: a retomada acha a transação e não paga de novo', async () => {
  const { chain, journal, opts } = setup();
  const lot = planLot(lotInput());
  chain.crashAfterInclude = true;
  await assert.rejects(payLot(chain, journal, lot, opts), /conexão perdida/);
  assert.equal(journal.get(lot.id)!.state, 'assinado');
  const e = await payLot(chain, journal, lot, opts);
  assert.equal(e.state, 'finalizado');
  assert.equal(e.attempts.length, 1);
  assert.equal(chain.paidTo(addr(1)), L('12.75'), 'pago uma vez só');
});

test('queda antes de chegar ao nó: reenvia os MESMOS bytes (mesmo nonce)', async () => {
  const { chain, journal, opts } = setup();
  const lot = planLot(lotInput());
  chain.dropSubmits = 1;
  await assert.rejects(payLot(chain, journal, lot, opts), /conexão perdida/);
  const signed = journal.get(lot.id)!.attempts[0]!;
  const e = await payLot(chain, journal, lot, opts);
  assert.equal(e.state, 'finalizado');
  assert.equal(e.attempts.length, 1);
  assert.equal(e.attempts[0]!.hash, signed.hash);
  assert.equal(chain.paidTo(addr(2)), L('5'));
});

test('tentativa vencida sem entrar: só então assina de novo (nonce novo), e paga uma vez', async () => {
  const { chain, journal, opts } = setup();
  const lot = planLot(lotInput());
  chain.dropSubmits = 1;
  await assert.rejects(payLot(chain, journal, lot, opts));
  for (let i = 0; i < 70; i++) chain.mine(); // passa a validade (64 blocos)
  const e = await payLot(chain, journal, lot, opts);
  assert.equal(e.state, 'finalizado');
  assert.equal(e.attempts.length, 2);
  assert.equal(chain.paidTo(addr(1)), L('12.75'));
});

test('falha na chain (batchAll tudo ou nada) fica registrada e não repete sozinha', async () => {
  const { chain, journal, opts } = setup();
  chain.failDispatch = 'balances.KeepAlive';
  const lot = planLot(lotInput());
  const e = await payLot(chain, journal, lot, opts);
  assert.equal(e.state, 'falhou');
  assert.equal(e.result!.error, 'balances.KeepAlive');
  assert.equal(chain.paidTo(addr(1)), 0n, 'ninguém recebeu');
  chain.failDispatch = null;
  assert.equal((await payLot(chain, journal, lot, opts)).state, 'falhou', 'repetir exige decisão de quem opera (lote novo)');
});

test('recusas antes de assinar: saldo, chain errada e lote com o mesmo id e outros pagamentos', async () => {
  const s1 = setup('10');
  await assert.rejects(payLot(s1.chain, s1.journal, planLot(lotInput()), s1.opts), (e: Error) => e instanceof SettlementError && /Saldo insuficiente/.test(e.message));
  assert.equal(s1.journal.get('2026-W44'), null, 'nada assinado');

  const s2 = setup();
  s2.chain.info_ = { decimals: 12 };
  await assert.rejects(payLot(s2.chain, s2.journal, planLot(lotInput()), s2.opts), /12 casas decimais/);
  assert.deepEqual(preflight({ ...(await new FakeChain().info()), specName: 'polkadot' }), ['runtime "polkadot" (esperado "lunes-nightly")']);

  const s3 = setup();
  await payLot(s3.chain, s3.journal, planLot(lotInput()), s3.opts);
  const other = planLot({ id: '2026-W44', payouts: [{ address: addr(9), lunes: '50' }] });
  await assert.rejects(payLot(s3.chain, s3.journal, other, s3.opts), /já existe no diário/);
});
