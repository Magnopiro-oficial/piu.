import { t } from '../i18n';
import type { HoursPolicy } from '../types';
import type { ApiRelay, ApiSettings } from './api';
import { fmtDec } from './format';

const GiB = 1024 ** 3, MiB = 1024 ** 2;

/** Padrões dos limites (os mesmos de `DEFAULT_SETTINGS` no piu-node), mostrados como "Padrão: …". Espaço em MB. */
export const LIMIT_DEFAULTS: { bw: number; sto: number; hours: HoursPolicy } = { bw: 50, sto: 256, hours: 'always' };

/**
 * Espaço para guardar mensagens, em MB (`STORAGE_OPTIONS_MB` no piu-node). O roteador guarda no máximo
 * 20 mil mensagens de até 32 KB (~625 MB): opções acima disso nunca valeriam.
 */
export const STORAGE_OPTIONS_MB = [128, 256, 512] as const;

/** 268435456 → "256 MB"; 4294967296 → "4 GB" (região do painel). */
const size = (bytes: number) => (bytes < GiB ? t('common.mb', { n: Math.round(bytes / MiB) }) : t('common.gb', { n: fmtDec(bytes / GiB) }));

/**
 * O nó guarda no máximo o menor entre a escolha, as regras do equipamento e a memória que ele reserva
 * para isso (`PIU_LNNP_MEMORY_MB`, 512 MB por padrão). Quando o teto real é menor que a escolha, diz
 * quanto vale e por quê; senão, null.
 */
export function storageNote(stoMB: number, relay: ApiRelay | null | undefined): string | null {
  if (!relay?.enabled) return null;
  const max = relay.store.maxBytes;
  if (max >= stoMB * MiB) return null;
  const rule = relay.limits.effective?.stoMB ?? stoMB;
  return t(rule < stoMB && max >= rule * MiB ? 'st.storageCapRule' : 'st.storageCapMem', { size: size(max) });
}

/** Banda que vale de verdade, quando as regras do equipamento pedem menos que a escolha; senão, null. */
export function bandNote(bw: number, relay: ApiRelay | null | undefined): string | null {
  if (!relay?.enabled) return null;
  const eff = relay.limits.effective?.bwMbps ?? bw;
  return eff < bw ? t('st.bandCapRule', { n: eff }) : null;
}

/**
 * Regra de espaço de um equipamento (1, 4 ou 8 GB, assinada e levada pela malha). Um nó guarda hoje no
 * máximo a maior opção de Configurações, então essas regras ainda não limitam nada: a tela diz o teto
 * real em vez de deixar parecer que 8 GB valem. Regra abaixo do teto limitaria de verdade: null.
 */
export function deviceStorageRuleNote(ruleGB: number): string | null {
  const max = STORAGE_OPTIONS_MB[STORAGE_OPTIONS_MB.length - 1]!;
  return ruleGB * 1024 < max ? null : t('dv.storageRuleNote', { size: size(max * MiB) });
}

interface SettingsValue { limits: { bw: number; sto: number; hours: string }; policies: ApiSettings['policies'] }

/** O que está na tela é o que o nó já tem? Então não há o que salvar (nem "Salvo" para mostrar). */
export function sameSettings(saved: SettingsValue | null, now: SettingsValue): boolean {
  if (!saved) return false;
  const a = saved.limits, b = now.limits, p = saved.policies, q = now.policies;
  return a.bw === b.bw && a.sto === b.sto && a.hours === b.hours && p.media === q.media && p.unknown === q.unknown && p.community === q.community;
}
