/** A write started before a reset cannot authorize a subsequent irreversible action. */
export const persistedWriteStillValid = (startedEpoch: number, currentEpoch: number) => startedEpoch === currentEpoch;

/** Missing is safe only after a successful read; malformed or unreadable records fail closed. */
export function mustBlockWalletRecovery(readFailed: boolean, value: unknown, validate: (value: unknown) => boolean): boolean {
  if (readFailed) return true;
  if (value === undefined) return false;
  try { return !validate(value); } catch { return true; }
}

/** Confirma a gravação somente se a geração de dados não mudou durante o I/O. */
export async function completePersistedWrite(startedEpoch: number, getEpoch: () => number, write: () => Promise<unknown>, remove: () => Promise<unknown>, commit: () => void): Promise<void> {
  await write();
  if (!persistedWriteStillValid(startedEpoch, getEpoch())) {
    await remove();
    throw new Error('Dados apagados durante a gravação.');
  }
  commit();
}

/** Uma leitura que omite uma chave listada não prova que ela inexiste. */
export function missingStoredKeys(expected: readonly string[], returned: readonly string[]): string[] {
  const present = new Set(returned);
  return expected.filter(key => !present.has(key));
}
