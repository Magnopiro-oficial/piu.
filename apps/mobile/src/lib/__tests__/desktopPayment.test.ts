/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDesktopSend, parseDesktopPayment, validPaymentId } from '../desktopPayment';
import { ALICE_57 } from './lunesFake';
import { DEV_ADDR_57 } from './walletFixture';
const valid = { t: 'payment_request', id: '338db8af-4e41-4f53-9fc1-7da12de68e01', expectedFrom: DEV_ADDR_57, dest: ALICE_57, amount: '1,001' };
test('valida ID, endereço e quantia decimal canônica', () => {
  assert.equal(parseDesktopPayment(valid, 2, 100)?.expiresAt, 120100);
  for (const patch of [{ amount: '1.001' }, { amount: '0' }, { amount: '1,000000001' }, { dest: 'invalido' }, { id: 'x' }, { t: 'cmd' }]) assert.equal(parseDesktopPayment({ ...valid, ...patch }, 2, 100), null);
  assert.equal(validPaymentId(valid.id), true);
});
test('comandos respeitam a mesma permissão de publicação do chat', () => {
  assert.equal(canDesktopSend({}), true);
  assert.equal(canDesktopSend({ group: 'canal' }), false);
  assert.equal(canDesktopSend({ group: 'canal', owner: false }), false);
  assert.equal(canDesktopSend({ group: 'canal', owner: true }), true);
});
