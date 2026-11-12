/**
 * Quando o serviço em primeiro plano do Android (PiuRelayService, aviso fixo) fica ligado. Ele segura o
 * processo e a tarefa sem tela `PiuCore` (core/coreTask.ts): sem ele, deslizar o app dos recentes deixa
 * o núcleo sem timers e o sistema pode matar o processo. Puro: usado por state/transport.tsx e testado.
 * - Modo nó: ligado, não pausado, "Retransmitir em segundo plano" e o transporte rodando.
 * - Ponto Piu ativo (state/point.tsx): mesmo só com o Wi-Fi local.
 * - "Receber com o app fechado" (aba Rede): enquanto algum meio está pedido (`listening`), sem olhar o
 *   estado do momento: na virada do dia o transporte passa por "off" e o serviço não pode cair junto.
 */
import type { TransportState } from '../transport/types';

/** "Receber com o app fechado" de fábrica: ligado (vale depois do onboarding, com o aviso fixo visível). */
export const RECEIVE_CLOSED_DEFAULT = true;

export function shouldBackground(i: {
  relay: boolean; relayPaused: boolean; bg: boolean; state: TransportState; point: boolean;
  receiveClosed: boolean;
  /** Algum meio pedido para escutar: P2P (onboarding feito, meio ligado e não negado) ou a rede local. */
  listening: boolean;
}): boolean {
  return (i.relay && !i.relayPaused && i.bg && i.state === 'running') || i.point || (i.receiveClosed && i.listening);
}
