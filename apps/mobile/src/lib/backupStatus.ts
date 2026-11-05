/**
 * Data do último backup (TypeScript puro, testado no Node). Guarda quando a frase foi confirmada
 * (Backup → passo 2) e quando um arquivo cifrado foi salvo; o Perfil mostra "Feito em …".
 */
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

export type BackupHow = 'phrase' | 'file';
export interface BackupRecord { at: number; how: BackupHow }

/** Último backup: o mais recente dos registros. `legacyDone`: versões antigas só guardavam "feito", sem data. */
export function backupLabel(last: BackupRecord | null | undefined, legacyDone: boolean, now = Date.now(), t: Tr = tGlobal): string {
  if (!last || !Number.isFinite(last.at)) return legacyDone ? t('backupStatus.legacy') : t('backupStatus.none');
  const day = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(last.at)) / 86_400_000);
  const what = ' · ' + (last.how === 'file' ? t('backupStatus.file') : t('backupStatus.phrase'));
  if (diff <= 0) return t('backupStatus.today') + what;
  if (diff === 1) return t('backupStatus.yesterday') + what;
  const d = new Date(last.at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  return t('backupStatus.onDate', { date: `${dd}/${mm}${sameYear ? '' : '/' + d.getFullYear()}` }) + what;
}

