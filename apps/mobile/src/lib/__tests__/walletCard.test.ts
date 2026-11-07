/// <reference types="node" />
/**
 * Cartão de saldo da Carteira (design §1): uma única linha sob o saldo, como "+ 60,00 a liberar · bônus em validação".
 * Com leitura recente da Mainnet, a linha é a dos créditos a liberar; sem leitura ou com leitura antiga, a linha
 * explica o estado do saldo (honestidade: o número mostrado não é um saldo ao vivo).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceCardLine } from '../walletCore';

test('cartão: leitura recente → linha dos créditos; sem leitura ou antiga → linha do estado da Mainnet', () => {
  const view = { pill: 'p', pillIcon: 'cloud' as const, line: 'estado', has: true, stale: false };
  assert.equal(balanceCardLine(view, '+ 1,20 a liberar'), '+ 1,20 a liberar');
  assert.equal(balanceCardLine({ ...view, stale: true }, '+ 1,20 a liberar'), 'estado');
  assert.equal(balanceCardLine({ ...view, has: false }, '+ 1,20 a liberar'), 'estado');
});
