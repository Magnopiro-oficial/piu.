/** Backup da identidade Desktop no mesmo formato autenticado e cifrado do aplicativo móvel.
 * O arquivo leva somente a frase e metadados; não inclui contatos, conversas nem histórico.
 * A frase e o texto cifrado permanecem no processo principal. */
import { passwordProblem, sealBackup } from '../../../mobile/src/lib/backupFile';
import type { Vault } from './vault';

export { passwordProblem };

/** Gera o conteúdo cifrado, para ser gravado apenas após a escolha explícita do destino. */
export async function createIdentityBackup(vault: Pick<Vault, 'secure' | 'getPhrase'>, password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (!vault.secure) throw new Error('O cofre do sistema não está disponível.');
  const words = await vault.getPhrase();
  if (!words) throw new Error('Nenhuma identidade disponível para backup.');
  try {
    return await sealBackup({ phrase: words, createdAt: Date.now(), from: 'Piu Desktop' }, password);
  } finally {
    words.fill('');
  }
}
