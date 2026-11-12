/**
 * Regra da pré-visualização nas notificações do sistema (Notificações → Pré-visualização), separada
 * do expo-notifications para ser testável. Quem lê o estado do aparelho é lib/notifications.ts.
 */
import type { Preview } from '../data/settings';

export interface PreviewEnv {
  /** `Platform.OS`. */
  os: string;
  /** Android: tela de bloqueio ativa agora; `null` quando não deu para ler. */
  locked: boolean | null;
  /** Entrega agendada: o estado do bloqueio na hora em que ela chegar é desconhecido. */
  scheduled: boolean;
  /** iPhone: prévias do sistema em "Quando desbloqueado". */
  iosPreviewsWhenUnlocked: boolean;
}

/**
 * `true`: a notificação sai com remetente e texto; `false`: sai o texto genérico.
 * - "Sempre" mostra; "Nunca" esconde.
 * - "Desbloqueado" no Android: só com o aparelho comprovadamente desbloqueado na hora de publicar.
 *   O canal PRIVATE sozinho não garante (o padrão do sistema é mostrar tudo na tela bloqueada);
 *   bloqueado, sem leitura do bloqueio ou agendada, vale como bloqueado.
 * - "Desbloqueado" no iPhone: só se o próprio sistema esconde as prévias na tela bloqueada.
 * - Onde não dá para garantir (web), genérico.
 */
export function showsContent(preview: Preview, env: PreviewEnv): boolean {
  if (preview === 'always') return true;
  if (preview !== 'unlocked') return false;
  if (env.os === 'android') return env.locked === false && !env.scheduled;
  return env.os === 'ios' && env.iosPreviewsWhenUnlocked;
}
