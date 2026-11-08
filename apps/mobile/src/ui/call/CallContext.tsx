import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CallController } from '../../calls/callController';
import type { CallState } from '../../calls/callMachine';
import type { CallScene, Tr } from '../../calls/callView';
import { useT } from '../../i18n';

/**
 * O que a interface da chamada precisa do aparelho. Sem provedor (`null`), nada da chamada aparece:
 * nem o botão ligar na conversa, nem o que fica por cima do app (src/ui/call/CallOverlay.tsx).
 * A integração com o back-end monta o provedor; a galeria de desenvolvimento monta um de exemplo.
 */
export type CallApi = {
  controller: CallController;
  /** Cena da chamada atual (`null` sem chamada). */
  scene: CallScene | null;
  /** Abre a folha "pre" para a conversa (o provedor sabe o contato, o caminho e a latência). */
  callChat(chatId: string): void;
  /** A conversa pode ligar? Sem isto, toda conversa direta mostra o botão. */
  canCall?(chatId: string): boolean;
  /** Aviso escuro da chamada (efeito `toast`); `seq` muda a cada aviso novo. */
  toast?: { text: string; seq: number } | null;
  /** Tela de toque aberta com o celular bloqueado: vai direto à tela cheia e pede para desbloquear. */
  locked?: boolean;
  /** "Gravar um áudio" na folha em modo malha (sem isto, só fecha a folha). */
  onRecordAudio?(): void;
  /** Relógio das marcas de tempo do estado (o mesmo `now` das portas do controlador). */
  now?(): number;
};

export const CallContext = createContext<CallApi | null>(null);

/** A chamada do aparelho, ou `null` quando não há provedor. */
export const useCall = () => useContext(CallContext);

/** Estado do controlador como estado do React (para o provedor montar a cena). */
export function useCallState(controller: CallController): CallState {
  return useSyncExternalStore(fn => controller.subscribe(fn), () => controller.state, () => controller.state);
}

/** `t` para as funções de src/calls/callView.ts (chaves montadas em tempo de execução, todas `call.*`). */
export const useCallT = (): Tr => useT() as unknown as Tr;
