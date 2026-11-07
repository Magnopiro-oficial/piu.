/**
 * Quando o Piu avisa (notificação nativa) e qual número vai no ícone, como funções puras (testadas em
 * test/notifyPolicy.test.ts). O processo principal só liga isto às APIs do Electron.
 * - Cada tipo segue o próprio interruptor de Ajustes → Notificações, como no celular (data/settings.ts).
 * - Conversa silenciada e Não perturbe calam tudo, exceto alertas Graves da comunidade (`communityAlert` do
 *   mensageiro do celular, ligado em main/mesh.ts), como no celular: Graves tocam mesmo no modo noturno.
 * - O contador soma as não lidas das conversas não silenciadas (o trilho mostra o mesmo total).
 */
import { t, type Key } from './i18n';
import type { ContactInfo, ConversationSummary, Prefs, WalletState } from './types';

export type NotifKind = 'direct' | 'group' | 'channel' | 'wallet' | 'test';

export const BADGE_MAX = 999;

export function notifKindOf(c: Pick<ContactInfo, 'kind'>): Exclude<NotifKind, 'wallet' | 'test'> {
  const k = c.kind ?? 'direct';
  if (k === 'direct') return 'direct';
  if (k === 'channel') return 'channel';
  return 'group';
}

/** `focused`: a janela do Piu está em foco (a pessoa já está vendo). `test`: botão "Testar notificação". */
export function shouldNotify(p: Prefs, o: { kind: NotifKind; muted?: boolean; focused?: boolean }): boolean {
  if (o.kind === 'test') return true;
  if (p.dnd || o.muted || o.focused) return false;
  switch (o.kind) {
    case 'direct': return p.notifications;
    case 'group': return p.notifGroups;
    case 'channel': return p.notifChannels;
    case 'wallet': return p.notifWallet;
  }
}

export function badgeCount(p: Prefs, rows: readonly ConversationSummary[]): number {
  if (!p.badge || p.dnd) return 0;
  const n = rows.reduce((a, r) => a + (r.muted ? 0 : Math.max(0, r.unread | 0)), 0);
  return Math.min(n, BADGE_MAX);
}

const planck = (v: string | null) => { try { return v === null ? null : BigInt(v); } catch { return null; } };

/**
 * Quanto entrou entre duas leituras do saldo (livre + reservado) do mesmo endereço, em planck; `null` se
 * não subiu, se alguma leitura não foi bem-sucedida ou se o endereço mudou (troca não é recebimento).
 */
export function walletReceived(prev: WalletState, next: WalletState): bigint | null {
  if (!prev.address || prev.address !== next.address || prev.status !== 'ok' || next.status !== 'ok') return null;
  const a = planck(prev.free), ar = planck(prev.reserved ?? '0'), b = planck(next.free), br = planck(next.reserved ?? '0');
  if (a === null || ar === null || b === null || br === null) return null;
  const diff = b + br - (a + ar);
  return diff > 0n ? diff : null;
}

// ── alertas da comunidade ───────────────────────────────

/** O que o mensageiro diz que merece aviso (`noticeFor` em apps/mobile/src/messaging/communityAlerts.ts). */
export interface AlertNoticeLevel { level: 'critical' | 'normal'; update: boolean }
export interface AlertSummary { sev: 'info' | 'warn' | 'grave'; cat: string; title: string; area: string; communityName: string }

/**
 * Alerta da comunidade: `notify` (aviso nativo), `toast` (janela em foco: aviso dentro do Piu) ou `null`.
 * Comunidade silenciada e "Alertas de emergência" desligado calam. Não perturbe só deixa passar os Graves.
 */
export function shouldNotifyAlert(p: Prefs, o: { level: AlertNoticeLevel['level']; muted?: boolean; focused?: boolean }): 'notify' | 'toast' | null {
  if (o.muted || !p.notifAlerts) return null;
  if (p.dnd && o.level !== 'critical') return null;
  return o.focused ? 'toast' : 'notify';
}

const CATS = new Set(['clima', 'agua', 'fogo', 'via', 'seguranca', 'saude', 'servico', 'outro']);

/** Título e corpo do aviso. Bloqueado ou "Mostrar no aviso: Nada": não diz qual alerta nem de qual comunidade. */
export function alertText(v: AlertSummary, n: AlertNoticeLevel, o: { locked: boolean; preview: Prefs['notifPreview'] }): { title: string; body: string } {
  if (o.locked || o.preview === 'never') return { title: t('main.alert.hiddenTitle'), body: t('main.alert.hiddenBody') };
  const label = n.update ? t('main.alert.confirmed') : t(`main.alert.sev.${v.sev}` as Key);
  const where = v.area.trim() || t(`main.alert.cat.${CATS.has(v.cat) ? v.cat : 'outro'}` as Key);
  return {
    title: t('main.alert.title', { label, title: v.title.slice(0, 80) }),
    body: t('main.alert.body', { community: v.communityName || t('main.alert.community'), where: where.slice(0, 80), note: t('main.alert.officialNote') }),
  };
}
