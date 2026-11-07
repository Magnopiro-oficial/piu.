/// <reference types="node" />
/**
 * Cartão "fora de alcance" da conversa (design `queue`): quantas horas faltam para a mensagem mais
 * antiga da fila expirar (validade de 48 h do envelope), sem inventar prazo quando não há data.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queueHoursLeft } from '../chatCore';

const H = 3600_000;
const TTL = 48 * 3600;

test('conta a partir da mensagem mais antiga da fila', () => {
  const now = 100 * H;
  assert.equal(queueHoursLeft([{ at: now - 1 * H }, { at: now - 10 * H }], now, TTL), 38);
});

test('arredonda para cima e nunca mostra menos de 1 h', () => {
  const now = 100 * H;
  assert.equal(queueHoursLeft([{ at: now - 0.5 * H }], now, TTL), 48);
  assert.equal(queueHoursLeft([{ at: now - 47.9 * H }], now, TTL), 1);
  assert.equal(queueHoursLeft([{ at: now - 60 * H }], now, TTL), 1);
});

test('sem data nas mensagens, sem prazo', () => {
  assert.equal(queueHoursLeft([{}], 0, TTL), null);
  assert.equal(queueHoursLeft([], 0, TTL), null);
});
