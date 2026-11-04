/**
 * O "piu": som curto (0,12 s, gerado para o projeto, assets/sounds/piu.wav) que toca quando chega
 * algo com o app aberto. Notificações com o app fechado usam o mesmo arquivo (lib/notifications.ts).
 * - Respeita o modo silencioso do iPhone e mistura com outros áudios (não pausa música).
 * - No máximo um piu a cada 1,5 s, para uma rajada de mensagens não virar um coro.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

const MIN_GAP_MS = 1500;
let player: AudioPlayer | null = null;
let ready: Promise<void> | null = null;
let lastAt = 0;

function load() {
  ready ??= (async () => {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(() => {});
    player = createAudioPlayer(require('../../assets/sounds/piu.wav'));
    player.volume = 0.7;
  })().catch(() => { ready = null; });
  return ready;
}

/** Toca o piu (ignora se tocou há menos de 1,5 s). Nunca lança erro. */
export async function playPiu(now = Date.now()) {
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  try {
    await load();
    if (!player) return;
    await player.seekTo(0);
    player.play();
  } catch { /* sem áudio neste aparelho: segue em silêncio */ }
}

/** Para testar nos ajustes: toca mesmo que tenha tocado há pouco. */
export const previewPiu = () => { lastAt = 0; return playPiu(); };

/** Web: o navegador só toca depois de um toque na página; não força. */
export const piuSupported = Platform.OS !== 'web' || typeof Audio !== 'undefined';
