/**
 * Textos dos alertas da comunidade no idioma em uso. A lógica (messaging/communityAlerts.ts) segue em
 * pt-BR por causa dos testes; aqui só se traduzem ids/códigos para a tela.
 */
import { type AlertCategory, type AlertSeverity, type AlertStatus, type DraftIssue, AREA_MAX, LIMIT_MSG, MAX_ACTIVE_PER_MEMBER, TEXT_MAX, TITLE_MAX } from '../messaging/communityAlerts';
import { t as tGlobal, type Key, type Vars } from './core';

type Tr = (key: Key, vars?: Vars) => string;

export const alertCategoryName = (id: AlertCategory, t: Tr = tGlobal) => t(`alertCat.${id}` as Key);
export const alertSeverityName = (id: AlertSeverity, t: Tr = tGlobal) => t(`alertSev.${id}` as Key);
export const alertStatusName = (id: AlertStatus, t: Tr = tGlobal) => t(`alertStatus.${id}` as Key);
export const officialNote = (t: Tr = tGlobal) => t('alerts.officialNote');

/** Mensagem de `checkDraft`/`draftIssue` traduzida. */
export function draftIssueText(k: DraftIssue | null, t: Tr = tGlobal): string | null {
  if (!k) return null;
  if (k === 'titleLong') return t('alerts.draft.titleLong', { max: TITLE_MAX });
  if (k === 'textLong') return t('alerts.draft.textLong', { max: TEXT_MAX });
  if (k === 'areaLong') return t('alerts.draft.areaLong', { max: AREA_MAX });
  return t(`alerts.draft.${k}` as Key);
}

/** Motivo do limite (`alerts.limit`) traduzido; texto desconhecido volta como veio. */
export function limitText(msg: string | null, t: Tr = tGlobal): string | null {
  if (!msg) return null;
  if (msg === LIMIT_MSG.wait) return t('alerts.limit.wait');
  if (msg === LIMIT_MSG.max) return t('alerts.limit.max', { max: MAX_ACTIVE_PER_MEMBER });
  if (msg === LIMIT_MSG.member) return t('alerts.limit.member');
  return msg;
}
