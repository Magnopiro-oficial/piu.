/**
 * Quando o serviço em primeiro plano do Android (PiuRelayService, aviso fixo) fica ligado. Ele segura o
 * processo e a tarefa sem tela `PiuCore` (core/coreTask.ts): sem ele, deslizar o app dos recentes deixa
 * o núcleo sem timers e o sistema pode matar o processo. Puro: usado por state/transport.tsx e testado.
 * - Modo nó: ligado, não pausado, "Retransmitir em segundo plano" e o transporte rodando.
 * - Ponto Piu ativo (state/point.tsx): mesmo só com o Wi-Fi local.
 * - "Receber com o app fechado" (aba Rede): enquanto algum meio está pedido (`listening`), sem olhar o
 *   estado do momento: na virada do dia o transporte passa por "off" e o serviço não pode cair junto.
 *   `undefined` = a tela ainda não sabe (Wi-Fi não lido ao montar): não opina, senão o serviço pisca.
 */
import type { WifiInfo } from '../transport/lan/types';
import type { TransportState } from '../transport/types';

/** "Receber com o app fechado" de fábrica: ligado (vale depois do onboarding, com o aviso fixo visível). */
export const RECEIVE_CLOSED_DEFAULT = true;

export function shouldBackground(i: {
  relay: boolean; relayPaused: boolean; bg: boolean; state: TransportState; point: boolean;
  receiveClosed: boolean;
  /** Algum meio pedido para escutar (screenListening); `undefined` = ainda não se sabe. */
  listening: boolean | undefined;
}): boolean | undefined {
  if ((i.relay && !i.relayPaused && i.bg && i.state === 'running') || i.point) return true;
  if (!i.receiveClosed) return false;
  return i.listening;
}

/**
 * Algum meio pedido para escutar: P2P (onboarding feito, meio ligado e não negado) ou a rede local.
 * Só com a rede local, até o primeiro `networkInfo()` a tela não sabe se há Wi-Fi (`undefined`, como
 * screenLan em core/node.ts): reabrir o app não derruba e religa o serviço.
 */
export function screenListening(i: { p2p: boolean; hasLan: boolean; lanOn: boolean; wifi: WifiInfo | null }): boolean | undefined {
  if (i.p2p) return true;
  if (i.hasLan && i.wifi === null) return undefined;
  return i.lanOn;
}
