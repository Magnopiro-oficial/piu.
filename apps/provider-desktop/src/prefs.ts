import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Preferências do app desktop (não do nó): ficam em <userData>/desktop.json, com permissão 0600. */
export interface Prefs {
  /** O nó responde também pela rede local (piu-node.local), não só neste computador. */
  lan: boolean;
  /** Já avisou que fechar a janela mantém o nó ligado na bandeja. */
  trayHintShown: boolean;
  /** Procurar versão nova ao abrir (no máximo 1x por dia) e avisar. Ligado por padrão, como no Piu Desktop. */
  updateNotify: boolean;
  /** Quando foi a última checagem automática (ms desde 1970; 0 = nunca). */
  lastUpdateCheck: number;
}

const DEFAULTS: Prefs = { lan: false, trayHintShown: false, updateNotify: true, lastUpdateCheck: 0 };
let file = '';

export function loadPrefs(dir: string): Prefs {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  file = join(dir, 'desktop.json');
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Prefs>;
    const last = j.lastUpdateCheck;
    return {
      lan: j.lan === true,
      trayHintShown: j.trayHintShown === true,
      updateNotify: j.updateNotify !== false,
      lastUpdateCheck: typeof last === 'number' && Number.isSafeInteger(last) && last > 0 ? last : 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): Prefs {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(p), { mode: 0o600 });
  renameSync(tmp, file);
  return p;
}
