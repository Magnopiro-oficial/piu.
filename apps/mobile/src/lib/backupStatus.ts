/**
 * Data do último backup (TypeScript puro, testado no Node). Guarda quando a frase foi confirmada
 * (Backup → passo 2) e quando um arquivo cifrado foi salvo; o Perfil mostra "Feito em …".
 */
export type BackupHow = 'phrase' | 'file';
export interface BackupRecord { at: number; how: BackupHow }

/** Último backup: o mais recente dos registros. `legacyDone`: versões antigas só guardavam "feito", sem data. */
export function backupLabel(last: BackupRecord | null | undefined, legacyDone: boolean, now = Date.now()): string {
  if (!last || !Number.isFinite(last.at)) return legacyDone ? 'Feito (data não registrada)' : 'Ainda não feito';
  const day = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(last.at)) / 86_400_000);
  const what = last.how === 'file' ? ' · arquivo' : ' · frase';
  if (diff <= 0) return 'Feito hoje' + what;
  if (diff === 1) return 'Feito ontem' + what;
  const d = new Date(last.at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  return `Feito em ${dd}/${mm}${sameYear ? '' : '/' + d.getFullYear()}${what}`;
}

