import { t } from '../i18n';
import type { HoursPolicy } from '../types';
import type { ApiRelay } from './api';
import { fmtDec } from './format';

const GiB = 1024 ** 3, MiB = 1024 ** 2;

/** Padrões dos limites (os mesmos de `DEFAULT_SETTINGS` no piu-node), mostrados como "Padrão: …". */
export const LIMIT_DEFAULTS: { bw: number; sto: number; hours: HoursPolicy } = { bw: 50, sto: 8, hours: 'always' };

/** 268435456 → "256 MB"; 4294967296 → "4 GB" (região do painel). */
const size = (bytes: number) => (bytes < GiB ? t('common.mb', { n: Math.round(bytes / MiB) }) : t('common.gb', { n: fmtDec(bytes / GiB) }));

/**
 * O nó guarda no máximo o menor entre a escolha, as regras do equipamento e a memória que ele reserva
 * para isso (`PIU_LNNP_MEMORY_MB`, 256 MB por padrão). Quando o teto real é menor que a escolha, diz
 * quanto vale e por quê; senão, null.
 */
export function storageNote(stoGB: number, relay: ApiRelay | null | undefined): string | null {
  if (!relay?.enabled) return null;
  const max = relay.store.maxBytes;
  if (max >= stoGB * GiB) return null;
  const byRule = (relay.limits.effective?.stoGB ?? stoGB) < stoGB && max >= (relay.limits.effective?.stoGB ?? 0) * GiB;
  return t(byRule ? 'st.storageCapRule' : 'st.storageCapMem', { size: size(max) });
}

/** Banda que vale de verdade, quando as regras do equipamento pedem menos que a escolha; senão, null. */
export function bandNote(bw: number, relay: ApiRelay | null | undefined): string | null {
  if (!relay?.enabled) return null;
  const eff = relay.limits.effective?.bwMbps ?? bw;
  return eff < bw ? t('st.bandCapRule', { n: eff }) : null;
}
