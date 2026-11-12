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

/**
 * Guarda do "Apagar dados locais": a geração dos dados muda a cada reset e, enquanto ele roda,
 * nenhuma gravação é aceita (ex.: o desmonte de um provedor regravando o estado da identidade apagada).
 * `wipe` limpa a memória no começo (síncrono) e de novo no fim, depois de apagar o armazenamento.
 */
export function createResetGuard() {
  let epoch = 0, running = 0;
  return {
    epoch: () => epoch,
    resetting: () => running > 0,
    assertWritable() { if (running > 0) throw new Error('Dados sendo apagados.'); },
    async run(wipe: () => void, erase: () => Promise<void>): Promise<void> {
      epoch += 1; running += 1;
      wipe();
      try { await erase(); } finally { wipe(); running -= 1; }
    },
  };
}

/**
 * Lê um valor do armazenamento: só vale o que abre com a chave de dados (AES-GCM).
 * Texto puro (sem o prefixo cifrado) é ilegível: aceitá-lo deixaria quem escreve no disco,
 * sem a chave, injetar estado (ex.: desligar o bloqueio). Toda versão publicada já gravava cifrado.
 */
export function readSealedValue(stored: string, open: (stored: string) => unknown): { ok: true; value: unknown } | { ok: false } {
  const value = open(stored);
  return value === undefined ? { ok: false } : { ok: true, value };
}

/**
 * Uma execução por processo: a segunda chamada devolve a mesma promessa. Reabrir o app (Activity nova
 * sobre o mesmo runtime JS) não relê o disco por cima do que já está em memória.
 * `fn` que resolve `false` (leitura falhou) é tentada de novo na próxima chamada.
 */
export function oncePerProcess(fn: () => Promise<boolean | void>): () => Promise<void> {
  let run: Promise<void> | null = null;
  return () => (run ??= fn().then(ok => { if (ok === false) run = null; }));
}

/**
 * Saúde da leitura do armazenamento: falha geral ou campo ilegível impedem assumir ausência
 * (ex.: a carteira não envia sem saber se havia uma transferência em andamento).
 * `wiped`: o "Apagar dados locais" terminou; o vazio agora é de propósito, não falha de leitura.
 */
export function createReadHealth() {
  let general = true;
  const bad = new Set<string>();
  return {
    failed: (key: string) => general || bad.has(key),
    begin() { general = true; bad.clear(); },
    unreadable(key: string) { bad.add(key); },
    succeeded() { general = false; },
    wiped() { general = false; bad.clear(); },
  };
}

/**
 * Gravações com atraso (`usePersisted`, `schedulePersisted`): a memória muda na hora, o disco depois
 * de `delay` (uma gravação só por campo). O núcleo lê a memória (`readPersisted`): mudar
 * "Pré-visualização" para "Nunca" vale já para o próximo aviso, não só depois do atraso. Durante o
 * "Apagar dados locais" nada entra na memória apagada; a gravação espera o apagamento terminar.
 */
export function createDelayedWrites(d: {
  delay: number;
  guard: { epoch(): number; resetting(): boolean };
  mem: (key: string, value: unknown) => void;
  write: (key: string, value: unknown) => void;
}) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  function schedule(key: string, value: unknown) {
    clearTimeout(pending.get(key));
    if (!d.guard.resetting()) d.mem(key, value);
    const at = d.guard.epoch();
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      if (at !== d.guard.epoch()) return; // apagado no meio do caminho
      if (d.guard.resetting()) { schedule(key, value); return; } // estado novo: espera o apagamento terminar
      d.mem(key, value);
      d.write(key, value);
    }, d.delay));
  }
  return {
    schedule,
    cancel: (key: string) => { clearTimeout(pending.get(key)); pending.delete(key); },
    cancelAll: () => { pending.forEach(clearTimeout); pending.clear(); },
  };
}
