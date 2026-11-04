/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE_MASK, AMOUNT_MASK, maskAmount, maskBalance, balanceEye } from '../balanceMask';

test('carteira: saldo escondido vira "••••••", visível fica como está', () => {
  assert.equal(maskBalance('1.234,56', true), '••••••');
  assert.equal(maskBalance('1.234,56', false), '1.234,56');
  assert.equal(BALANCE_MASK, '••••••');
  // Sem leitura da Mainnet o traço também se esconde: nada deve denunciar o estado.
  assert.equal(maskBalance('—', true), '••••••');
});

test('carteira: valores menores (a liberar, reservado) escondidos viram "••••"', () => {
  assert.equal(maskAmount('60,00', true), '••••');
  assert.equal(maskAmount('60,00', false), '60,00');
  assert.equal(AMOUNT_MASK, '••••');
});

test('carteira: botão do olho troca ícone e rótulo de acessibilidade conforme o estado', () => {
  assert.deepEqual(balanceEye(false), { icon: 'visibility', label: 'Esconder saldo' });
  assert.deepEqual(balanceEye(true), { icon: 'visibility_off', label: 'Mostrar saldo' });
});
