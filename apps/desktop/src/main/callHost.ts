/**
 * Áudio da chamada visto do processo principal: o `CallService` (junto da malha) fala com o microfone e o
 * alto-falante, que moram no renderer (Web Audio). Cada pedido vira um `CallAudioCmd` para a janela e cada
 * pedaço do microfone volta por `frame` (IPC `callFrame`). Testado em test/meshCall.test.ts e callBridge.test.ts.
 */
import type { AudioEngine } from '../../../mobile/src/calls/callService';
import type { Codec } from '../../../mobile/src/calls/callMedia';
import type { CallAudioCmd } from '../shared/callBridge';

export class RemoteAudio implements AudioEngine {
  private onFrame?: (codec: Codec, payload: Uint8Array) => void;
  private muted = false;
  constructor(private readonly send: (cmd: CallAudioCmd) => void, private readonly beforeStart: () => Promise<void> = async () => {}) {}

  async start(onFrame: (codec: Codec, payload: Uint8Array) => void) {
    this.onFrame = onFrame;
    await this.beforeStart();
    if (this.onFrame !== onFrame) return;
    this.send({ op: 'start' });
    // Mudo escolhido antes de o microfone abrir (ex.: durante a permissão do sistema) vale já.
    if (this.muted) this.send({ op: 'mute', on: true });
  }
  stop() { this.onFrame = undefined; this.send({ op: 'stop' }); }
  play(codec: Codec, payload: Uint8Array, seq: number) { this.send({ op: 'play', codec, payload, seq }); }
  setMuted(on: boolean) { this.muted = on; this.send({ op: 'mute', on }); }
  /** Os níveis da animação são lidos no próprio renderer, onde o som está. */
  levels() { return { mine: 0, theirs: 0 }; }

  /** Pedaço do microfone vindo da janela; fora de chamada (microfone fechado) é descartado. */
  frame(codec: Codec, payload: Uint8Array) { this.onFrame?.(codec, payload); }
  get open() { return !!this.onFrame; }
}
