import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/** Aviso de chamada recebida (textos prontos, no idioma do app: src/calls/callAlert.ts `alertTexts`). */
export type IncomingNative = {
  callId: string;
  /** Abre a tela cheia (só no começo do toque). */
  full: boolean;
  title: string; body: string; answer: string; decline: string;
  /** Tela bloqueada que esconde conteúdo: sem o nome. */
  publicTitle: string; publicBody: string;
  channel: string; channelDesc: string;
};

/** Aviso contínuo do serviço do microfone. `since`: início da conversa (ms, `Date.now()`), para o cronômetro. */
export type OngoingNative = {
  callId: string; since: number;
  title: string; body: string; hangup: string; publicTitle: string;
  channel: string; channelDesc: string;
};

/** Ação tocada numa notificação da chamada (`show` = tocar no aviso ou a tela cheia abriu o app). */
export type AlertActionEvent = { action: string; callId: string };

type PiuCallAlertEvents = {
  onAction: (e: AlertActionEvent) => void;
  onLockChange: (e: { locked: boolean }) => void;
};

declare class PiuCallAlertNativeModule extends NativeModule<PiuCallAlertEvents> {
  isLocked(): boolean;
  setLockFlags(overLock: boolean, wake: boolean): void;
  startRinging(pattern: number[]): void;
  stopRinging(): void;
  showIncoming(n: IncomingNative): void;
  hideIncoming(): void;
  startOngoing(n: OngoingNative): void;
  stopOngoing(): void;
}

/** `null` fora do Android com o app instalado (iPhone, web, Expo Go). */
const native = requireOptionalNativeModule<PiuCallAlertNativeModule>('PiuCallAlert');
const NONE = { remove() {} };

/**
 * A chamada fora do app no Android: toque e vibração, notificação de chamada recebida em tela cheia,
 * tela por cima do bloqueio e serviço em primeiro plano do microfone. Só executa; quem decide é
 * src/calls/callAlert.ts. Sem o módulo nativo, tudo vira no-op.
 */
export const PiuCallAlert = {
  isAvailable(): boolean {
    return !!native;
  },
  /** Tela de bloqueio ativa agora. */
  isLocked(): boolean {
    return native ? native.isLocked() : false;
  },
  /** A Activity aparece por cima do bloqueio (`overLock`) e acende a tela ao abrir (`wake`). */
  setLockFlags(overLock: boolean, wake: boolean): void {
    native?.setLockFlags(overLock, wake);
  },
  /** Toque do sistema + vibração no padrão (ms: pausa, vibra, pausa…), repetidos até `stopRinging`. */
  startRinging(pattern: readonly number[]): void {
    native?.startRinging([...pattern]);
  },
  stopRinging(): void {
    native?.stopRinging();
  },
  showIncoming(n: IncomingNative): void {
    native?.showIncoming(n);
  },
  hideIncoming(): void {
    native?.hideIncoming();
  },
  /** Sobe o serviço do microfone (espera a permissão RECORD_AUDIO, se ainda não houver). */
  startOngoing(n: OngoingNative): void {
    native?.startOngoing(n);
  },
  stopOngoing(): void {
    native?.stopOngoing();
  },
  addActionListener(fn: (e: AlertActionEvent) => void): { remove(): void } {
    return native ? native.addListener('onAction', fn) : NONE;
  },
  addLockListener(fn: (locked: boolean) => void): { remove(): void } {
    return native ? native.addListener('onLockChange', e => fn(e.locked)) : NONE;
  },
};

export default PiuCallAlert;
