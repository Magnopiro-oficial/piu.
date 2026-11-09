/**
 * O "piu": som curto (0,15 s, gerado para o projeto, assets/sounds/piu.wav) que toca quando chega
 * algo com o app aberto e ao abrir o app (quando toca: lib/piuChirp.ts). O arquivo começa com 0,3 s de silêncio: no Android o alto-falante leva
 * ~130 ms para ligar e, sem essa folga, o piu inteiro tocava antes (e ninguém ouvia).
 * Notificações com o app fechado usam o mesmo arquivo (lib/notifications.ts).
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
    // Volume cheio: o piu dura 0,15 s e já respeita o volume de mídia do aparelho (a 70% mal se ouvia).
    player.volume = 1;
  })().catch(e => { console.warn('[piu-som] load falhou', String(e)); ready = null; });
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
  } catch (e) { console.warn('[piu-som]', String(e)); /* sem áudio neste aparelho: segue em silêncio */ }
}

/** Abre o arquivo antes da primeira vez (nada toca). */
export const preloadPiu = () => { void load(); };

/** Para testar nos ajustes: toca mesmo que tenha tocado há pouco. */
export const previewPiu = () => { lastAt = 0; return playPiu(); };

/** Web: o navegador só toca depois de um toque na página; não força. */
export const piuSupported = Platform.OS !== 'web' || typeof Audio !== 'undefined';
