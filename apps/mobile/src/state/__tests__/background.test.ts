/**
 * Serviço em primeiro plano do Android (plano "app fechado", fatia 10): quando o PiuRelayService fica
 * ligado. Além do Modo nó em segundo plano e do Ponto Piu, "Receber com o app fechado" segura o
 * processo (e a tarefa sem tela) enquanto há algum meio pedido para escutar.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RECEIVE_CLOSED_DEFAULT, screenListening, shouldBackground } from '../background';
import type { WifiInfo } from '../../transport/lan/types';

const wifi = (connected: boolean): WifiInfo => ({ connected, ip: connected ? '192.168.0.2' : null } as WifiInfo);

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

test('ao montar, só com a rede local e o Wi-Fi ainda não lido, a tela não opina (o serviço não pisca)', () => {
  const lanOnly = { p2p: false, hasLan: true, lanOn: false };
  assert.equal(screenListening({ ...lanOnly, wifi: null }), undefined, 'Wi-Fi não lido');
  assert.equal(screenListening({ ...lanOnly, lanOn: true, wifi: wifi(true) }), true);
  assert.equal(screenListening({ ...lanOnly, wifi: wifi(false) }), false, 'lido: em dados móveis não há o que escutar');
  // P2P pedido já basta para escutar: não espera o Wi-Fi.
  assert.equal(screenListening({ ...lanOnly, p2p: true, wifi: null }), true);
  // Sem o módulo da rede local (iPhone, binário antigo) não há Wi-Fi a esperar.
  assert.equal(screenListening({ p2p: false, hasLan: false, lanOn: false, wifi: null }), false);
  // Sem opinião sobre o meio: só "Receber com o app fechado" fica sem opinião; Modo nó e Ponto Piu decidem.
  const rc = { ...off, receiveClosed: true, listening: undefined };
  assert.equal(shouldBackground(rc), undefined);
  assert.equal(shouldBackground({ ...rc, point: true }), true);
  assert.equal(shouldBackground({ ...rc, relay: true, bg: true, state: 'running' }), true);
  assert.equal(shouldBackground({ ...rc, receiveClosed: false }), false);
});

test('parar o transporte não derruba o serviço (quem decide é a tela)', () => {
  // createNativeTransport importa os módulos nativos do Expo, que o runner (node --test) não carrega:
  // confere no fonte que o stop do P2P (virada do dia) só para o enlace, sem setBackground.
  const native = readFileSync(join(__dirname, '..', '..', 'transport', 'native.ts'), 'utf8');
  const stop = native.match(/^\s*stop: (.*)$/m)?.[1] ?? '';
  assert.ok(stop.includes('mod.stop()'), stop);
  assert.ok(!stop.includes('setBackground'), stop);
});
