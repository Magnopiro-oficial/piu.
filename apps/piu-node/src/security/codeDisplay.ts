import { join } from 'node:path';
import { writeFileAtomic } from '../fsutil.js';

/** Arquivo com o código vigente quando o nó roda como serviço (sem terminal). */
export const PAIRING_CODE_FILE = 'pairing-code';

/**
 * Onde o código de pareamento aparece (auditoria 2026-11-06, M-03).
 * - Terminal interativo (desenvolvimento, console do equipamento): na tela, como sempre.
 * - Sem terminal (systemd, procd): o stdout vira log persistente (journald, logread), que outros
 *   usuários e o envio de log remoto alcançam. O código vai para `<dados>/pairing-code` (0600, pasta
 *   0700), que só o usuário do serviço (ou root) lê; o log diz só onde ler.
 */
export function pairingCodeOutput(o: { tty: boolean; dataDir: string; write: (s: string) => void }) {
  const file = join(o.dataDir, PAIRING_CODE_FILE);
  return (reason: string, code: string) => {
    if (o.tty) {
      o.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`);
      return;
    }
    try {
      writeFileAtomic(file, `${code}\n`);
      o.write(`\n  ${reason}\n  Código de pareamento em ${file} (vale 10 min, uso único). Leia como o usuário do serviço, por exemplo: sudo cat ${file}\n\n`);
    } catch (e) {
      o.write(`\n  ${reason}\n  Não foi possível gravar o código em ${file} (${e instanceof Error ? e.message : String(e)}). Rode o nó num terminal para ver o código.\n\n`);
    }
  };
}
