import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/** Codec de um pedaço de 20 ms: Opus (MediaCodec, Android 10+) ou G.711 µ-law 8 kHz (160 bytes). */
export type Codec = 'opus' | 'pcmu';

type PiuVoiceEvents = {
  /** Pedaço de 20 ms da minha voz, codificado. Bytes como `Uint8Array` (sem base64). */
  onFrame: (e: { codec: Codec; data: Uint8Array }) => void;
};

declare class PiuVoiceNativeModule extends NativeModule<PiuVoiceEvents> {
  isAvailable(): boolean;
  codec(): Codec;
  /** Rejeita com `code === 'PERMISSION'` sem RECORD_AUDIO; `ERR_AUDIO` se o microfone/saída não abrirem. */
  start(): Promise<void>;
  stop(): void;
  play(codec: Codec, payload: Uint8Array, seq: number): void;
  setMuted(muted: boolean): void;
  setSpeaker(on: boolean): void;
  levels(): { mine: number; theirs: number };
}

/** `null` fora do Android com o app instalado (iPhone, web, Expo Go). */
const native = requireOptionalNativeModule<PiuVoiceNativeModule>('PiuVoice');
const ZERO = Object.freeze({ mine: 0, theirs: 0 });

/**
 * Áudio da chamada de voz (captura com cancelamento de eco, Opus/PCMU em pedaços de 20 ms, reprodução
 * com buffer anti-jitter de 60–200 ms, mudo, alto-falante, níveis). O app embrulha num `AudioEngine`
 * (src/calls/callService.ts). Sem o módulo nativo, tudo vira no-op e `start()` rejeita.
 */
export const PiuVoice = {
  /** false no Expo Go, na web e no iPhone. */
  isAvailable(): boolean {
    return !!native && native.isAvailable();
  },
  /** 'opus' se o aparelho tem codificador Opus (Android 10+), senão 'pcmu'. */
  codec(): Codec {
    return native ? native.codec() : 'pcmu';
  },
  /** Abre microfone e saída (modo de comunicação, foco de áudio, efeitos). */
  start(): Promise<void> {
    if (!native) return Promise.reject(Object.assign(new Error('Áudio da chamada indisponível.'), { code: 'UNAVAILABLE' }));
    return native.start();
  },
  /** Libera tudo e restaura o áudio do aparelho. Idempotente. */
  stop(): void {
    native?.stop();
  },
  /** Pedaço que chegou (pode vir fora de ordem, repetido ou nunca). `seq` = sequência do quadro de voz. */
  play(codec: Codec, payload: Uint8Array, seq: number): void {
    native?.play(codec, payload, seq);
  },
  /** Mudo: não emite quadros e o meu nível fica 0 (o microfone segue aberto, para voltar na hora). */
  setMuted(muted: boolean): void {
    native?.setMuted(muted);
  },
  /** Alto-falante; senão Bluetooth (se houver fone), fone com fio ou o fone do aparelho. */
  setSpeaker(on: boolean): void {
    native?.setSpeaker(on);
  },
  /** Níveis 0..1 suavizados (ataque rápido, queda ~150 ms). Síncrono e barato: pode ler a 60 Hz. */
  levels(): { mine: number; theirs: number } {
    return native ? native.levels() : ZERO;
  },
  /** Cada pedaço de 20 ms codificado da minha voz. */
  addFrameListener(fn: (codec: Codec, payload: Uint8Array) => void): { remove(): void } {
    if (!native) return { remove() {} };
    return native.addListener('onFrame', e => fn(e.codec, e.data));
  },
};

export default PiuVoice;
