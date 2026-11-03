/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStatusBack, tempSeconds } from '../status';

test('2.2 estado da mensagem não volta atrás: entregue e lida ficam', () => {
  assert.equal(isStatusBack('lida', 'entregue'), true, 'confirmação de entrega atrasada não desfaz "lida"');
  assert.equal(isStatusBack('entregue', 'encaminhada'), true);
  assert.equal(isStatusBack('entregue', 'lida'), false);
  assert.equal(isStatusBack('encaminhada', 'entregue'), false);
  assert.equal(isStatusBack('expirada', 'aguardando'), false, 'Reenviar continua valendo');
  assert.equal(isStatusBack(undefined, 'criada'), false);
});

test('2.4 prazos das mensagens temporárias do design: Desligado, 7 dias, 24 h', () => {
  assert.equal(tempSeconds('off'), undefined);
  assert.equal(tempSeconds(undefined), undefined);
  assert.equal(tempSeconds('7d'), 7 * 86400);
  assert.equal(tempSeconds('24h'), 86400);
});
