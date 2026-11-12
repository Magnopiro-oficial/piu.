/**
 * Serviço em primeiro plano do Android (plano "app fechado", fatia 10): quando o PiuRelayService fica
 * ligado. Além do Modo nó em segundo plano e do Ponto Piu, "Receber com o app fechado" segura o
 * processo (e a tarefa sem tela) enquanto há algum meio pedido para escutar.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RECEIVE_CLOSED_DEFAULT, shouldBackground } from '../background';

const off = { relay: false, relayPaused: false, bg: false, state: 'off' as const, point: false, receiveClosed: false, listening: false };

test('Modo nó em segundo plano: só ligado, sem pausa, com "Retransmitir em segundo plano" e o transporte rodando', () => {
  const relay = { ...off, relay: true, bg: true, state: 'running' as const };
  assert.equal(shouldBackground(relay), true);
  assert.equal(shouldBackground({ ...relay, relayPaused: true }), false);
  assert.equal(shouldBackground({ ...relay, bg: false }), false);
  assert.equal(shouldBackground({ ...relay, state: 'starting' }), false);
});

test('Ponto Piu ativo liga o serviço sozinho', () => {
  assert.equal(shouldBackground({ ...off, point: true }), true);
});

test('Receber com o app fechado: liga enquanto há meio pedido, sem piscar quando o transporte religa', () => {
  const rc = { ...off, receiveClosed: true, listening: true };
  assert.equal(shouldBackground(rc), true);
  // Virada do dia (nome novo) passa por "off": o serviço não cai, senão a tarefa sem tela some com o app fechado.
  assert.equal(shouldBackground({ ...rc, state: 'off' }), true);
  assert.equal(shouldBackground({ ...rc, listening: false }), false, 'nada para escutar (antes do onboarding, meios desligados)');
  assert.equal(shouldBackground({ ...off, listening: true }), false, 'ajuste desligado');
});

test('padrão de fábrica: ligado (o aviso fixo do serviço fica visível)', () => {
  assert.equal(RECEIVE_CLOSED_DEFAULT, true);
});

test('a tela decide o serviço por shouldBackground, e parar o transporte não derruba o serviço', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
  const provider = read('state', 'transport.tsx');
  assert.match(provider, /shouldBackground\(\{/);
  assert.match(provider, /setBackgroundRelay\?\.\(background,/);
  // Virada do dia: o stop do P2P não pode desligar o serviço (com o app fechado ninguém religaria).
  const native = read('transport', 'native.ts');
  assert.match(native, /stop: \(\) => mod\.stop\(\)/);
});
