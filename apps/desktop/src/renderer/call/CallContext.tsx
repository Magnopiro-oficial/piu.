/**
 * Provedor da chamada de voz no renderer. Sem provedor (`null`, o padrão) nada de chamada aparece:
 * nem o botão Ligar, nem o palco, nem o aviso. A integração com o processo principal cria um
 * `CallController` (apps/mobile/src/calls) com as portas do Desktop, monta a `CallScene` do estado
 * atual e envolve o App com `<CallContext.Provider value={…}>`; a galeria de desenvolvimento faz o
 * mesmo com portas de exemplo (./dev).
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CallController } from '../../../../mobile/src/calls/callController';
import type { LiveRoute } from '../../../../mobile/src/calls/callMachine';
import type { CallScene, Tr } from '../../../../mobile/src/calls/callView';
import { type Key, useT } from '../i18n';
import type { AudioDevice } from './callDesktop';

export type CallDevices = {
  mics: AudioDevice[];
  outs: AudioDevice[];
  /** Ids escolhidos agora. */
  mic: string;
  out: string;
  onMic(id: string): void;
  onOut(id: string): void;
  /** Nível real do microfone 0..1 (medidor da caixa "pre"), lido a cada quadro. */
  micLevel(): number;
};

/** O que a tela usa do controlador: o `CallController` do núcleo (galeria) ou o espelho do processo principal. */
export type CallControl = Pick<CallController, 'state' | 'subscribe' | 'dispatch' | 'open' | 'dial' | 'sendRequest' | 'answer' | 'decline' | 'hangup' | 'wordsDiffer' | 'requestNow'>;

export type DesktopCallHost = {
  controller: CallControl;
  /** Cena da chamada do estado atual; `null` sem chamada (fase idle). `state.peer` é o id do contato. */
  scene: CallScene | null;
  devices: CallDevices;
  /** Celular vinculado: "Tocando também no …", botão "Pro celular", "Continua no …". */
  phoneName?: string;
  /** "Pro celular": quem integra passa a chamada e, quando o celular assumir, despacha `handoff`. */
  onHandoff?(): void;
  /** Caminho ao vivo até o contato agora; `null` = só pela malha (a caixa vira pedido de chamada). */
  routeTo(peer: string): LiveRoute | null;
  /** O celular atendeu enquanto tocava aqui (registro `elsewhere`): o aviso mostra "Atendida no …" por 2,4 s. */
  elsewhere?: { device: string; at: number } | null;
};

export const CallContext = createContext<DesktopCallHost | null>(null);
export const useCallHost = () => useContext(CallContext);

/** `t` do Desktop no formato que o núcleo da chamada recebe (chaves `call.*`). */
export function useTr(): Tr {
  const t = useT();
  return (k, v) => t(k as Key, v);
}

/** Último valor que passou no filtro: o conteúdo fica na tela enquanto a caixa some (transições de saída). */
export function useSticky<T>(v: T | null | undefined, keep: (v: T) => boolean): T | null {
  const ref = useRef<T | null>(null);
  if (v && keep(v)) ref.current = v;
  return ref.current;
}

/** Laço de animação (requestAnimationFrame) enquanto `on`; `fn` recebe o tempo em segundos. */
export function useFrame(on: boolean, fn: (t: number) => void) {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const loop = () => { f.current(performance.now() / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [on]);
}

/** Relógio da tela (cronômetro, quem fala): atualiza a cada 250 ms enquanto `on`. */
export function useTick(on: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [on, ms]);
  return now;
}
