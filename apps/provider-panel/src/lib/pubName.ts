import { TAKEN_NAMES } from '../data/seed';
import { t } from '../i18n';

export const PUB_MAX = 28;

/** Normaliza o que a pessoa digita para o formato `[a-z0-9-]`, até 28 caracteres. */
export function sanitizePub(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ +/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, PUB_MAX);
}

export type PubCheck = { ok: boolean; icon: string; msg: string; tone: 'muted' | 'strong'; ring: 'none' | 'soft' | 'strong' };

/**
 * Checagem de disponibilidade do nome público `piu.*`.
 * `own` = nomes (sem prefixo) que este operador já usa.
 * `real` (com piu-node): sem a lista de exemplo; a consulta aos nomes da malha e a assinatura ainda não existem.
 */
export function checkPub(p: string, own: string[], real = false): PubCheck {
  if (!p) return { ok: false, icon: 'edit', msg: t('pub.choose'), tone: 'muted', ring: 'none' };
  if (real && own.includes(p)) return { ok: false, icon: 'error', msg: t('pub.usedByYours', { name: p }), tone: 'strong', ring: 'strong' };
  if (!real && (TAKEN_NAMES.includes(p) || own.includes(p)))
    return { ok: false, icon: 'error', msg: t('pub.usedByMesh', { name: p }), tone: 'strong', ring: 'strong' };
  if (/cardeal|casa|rua|apto|apartamento|numero/.test(p))
    return { ok: true, icon: 'warning', msg: t('pub.avoidPersonal'), tone: 'strong', ring: 'soft' };
  if (real) return { ok: true, icon: 'check', msg: t('pub.notUsedReal'), tone: 'muted', ring: 'none' };
  return { ok: true, icon: 'verified', msg: t('pub.available'), tone: 'muted', ring: 'none' };
}
