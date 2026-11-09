/**
 * Quando o piu toca (regras puras, testadas em __tests__/piuChirp.test.ts). Quem toca é
 * lib/piuSound.ts (app aberto) e o canal do Android / o som da notificação (lib/notifications.ts).
 * - App aberto: quando chega algo de um tipo ligado (também na conversa aberta) e uma vez ao abrir o app.
 * - App fechado: a notificação usa o canal com o piu, salvo noturno, vibração discreta ou "Som de piu" desligado.
 */
import type { NotifKey } from '../data/settings';

/** Padrões de fábrica de Ajustes → Notificações → Som e Silêncio (state/settings.tsx). */
export const SOUND_DEFAULTS = { piu: true, quiet: false, discreet: false } as const;

export interface ChirpCfg { onboarded: boolean; piu: boolean; quiet: boolean; discreet: boolean; notifs: Record<NotifKey, boolean> }
/** Modo do toque do Android (`null`: sem leitura, como no iPhone e na web). */
export type Ringer = 'normal' | 'vibrate' | 'silent';
/** Canais do Android (importância e som são fixos depois de criados, por isso um canal por modo). */
export type Mode = 'normal' | 'piu' | 'discreet' | 'quiet' | 'critical';

export const isQuietHour = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 7;

/** Canal da notificação do sistema. */
export const notifyMode = (c: ChirpCfg, critical: boolean, now = new Date()): Mode =>
  critical ? 'critical' : c.quiet && isQuietHour(now) ? 'quiet' : c.discreet ? 'discreet' : c.piu ? 'piu' : 'normal';

/**
 * Piu com o app aberto: chegou algo (`kind`) ou o app acabou de abrir (sem `kind`). No Android o piu
 * sai pelo volume de mídia, que toca até no silencioso, por isso fica quieto fora do modo normal.
 */
export function canChirp(c: ChirpCfg | null, o: { kind?: NotifKey; active: boolean; ringer: Ringer | null; now?: Date }): boolean {
  if (!c?.onboarded || !c.piu || !o.active) return false;
  if (o.kind && !c.notifs[o.kind]) return false;
  if (c.quiet && isQuietHour(o.now)) return false;
  return o.ringer === null || o.ringer === 'normal';
}

/**
 * Mensagem que chegou: fora da conversa, o banner (que toca o piu e vira notificação em segundo plano);
 * na conversa aberta, só o piu. `quiet`: chegou sem aviso (histórico, sincronização).
 */
export function incomingAlert(o: { fromThem: boolean; viewing: boolean; exists: boolean; quiet?: boolean; muted?: boolean }) {
  const ok = o.fromThem && o.exists && !o.quiet && !o.muted;
  return { banner: ok && !o.viewing, chirp: ok && o.viewing };
}
