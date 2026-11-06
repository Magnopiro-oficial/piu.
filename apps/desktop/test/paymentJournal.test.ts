import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentJournal, parsePaymentStatus, validatePaymentInput } from '../src/main/paymentJournal';
const from = '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse';
const dest = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const hash = `0x${'ab'.repeat(32)}`;
test('quantia canônica preserva os plancks e valida as contas', () => {
  assert.equal(validatePaymentInput(from, dest, '1,0010').amount, '1,001');
  assert.equal(validatePaymentInput(from, dest, '1,000').amount, '1');
  assert.throws(() => validatePaymentInput(from, from, '1'));
  assert.throws(() => validatePaymentInput(from, dest, '0'));
});
test('pedido é cifrado, persiste antes do envio e bloqueia duplicação após desconexão', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-pay-test-')), file = join(dir, 'journal');
  try {
    const key = Buffer.alloc(32, 7), j = new PaymentJournal(file, key);
    assert.deepEqual(j.state, { state: 'empty' });
    const p = j.create(from, { dest, amount: '0,001' });
    assert.equal(readFileSync(file).includes(Buffer.from(dest)), false);
    assert.throws(() => j.create(from, { dest, amount: '1' }));
    assert.equal(new PaymentJournal(file, key).state.state, 'payment');
    j.disconnected();
    const resumed = new PaymentJournal(file, key);
    assert.equal(resumed.state.state === 'payment' && resumed.state.payment.status, 'unknown');
    assert.throws(() => resumed.create(from, { dest, amount: '1' }));
    resumed.update({ t: 'payment_status', id: p.id, status: 'finalized', hash });
    assert.equal(resumed.state.state === 'payment' && resumed.state.payment.status, 'finalized');
    resumed.update({ t: 'payment_status', id: p.id, status: 'review' });
    assert.equal(resumed.state.state === 'payment' && resumed.state.payment.status, 'finalized');
    resumed.create(from, { dest, amount: '1' });
    writeFileSync(file, 'damaged');
    const damaged = new PaymentJournal(file, key);
    assert.equal(damaged.state.state, 'blocked');
    assert.throws(() => damaged.create(from, { dest, amount: '1' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('ignora eventos inválidos e mantém incerteza em hash divergente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-pay-test-'));
  try {
    const j = new PaymentJournal(join(dir, 'journal'), Buffer.alloc(32, 4));
    const p = j.create(from, { dest, amount: '1' });
    assert.equal(parsePaymentStatus({ t: 'payment_status', id: p.id, status: 'finalized' }), null);
    j.update({ t: 'payment_status', id: p.id, status: 'signed', hash });
    j.update({ t: 'payment_status', id: p.id, status: 'finalized', hash: `0x${'cd'.repeat(32)}` });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'unknown');
    j.update({ t: 'payment_status', id: p.id, status: 'cancelled' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'unknown');
    assert.throws(() => j.create(from, { dest, amount: '1' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('eventos repetidos, de outro pedido ou sem prova não liberam novo envio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-pay-test-'));
  try {
    const j = new PaymentJournal(join(dir, 'journal'), Buffer.alloc(32, 9));
    const p = j.create(from, { dest, amount: '1' });
    j.update({ t: 'payment_status', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'cancelled' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'waiting');
    j.update({ t: 'payment_status', id: p.id, status: 'error', error: 'indisponível' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'unknown');
    j.update({ t: 'payment_status', id: p.id, status: 'failed' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'unknown');
    assert.throws(() => j.create(from, { dest, amount: '1' }));
    j.update({ t: 'payment_status', id: p.id, status: 'cancelled' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'cancelled');
    j.update({ t: 'payment_status', id: p.id, status: 'review' });
    assert.equal(j.state.state === 'payment' && j.state.payment.status, 'cancelled');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
