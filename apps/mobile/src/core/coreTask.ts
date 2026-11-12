/**
 * Tarefa sem tela `PiuCore` (Headless JS, registrada em core/headless.ts pela entrada index.ts). O
 * PiuRelayService a inicia: sobe o núcleo do processo (o mesmo da tela) e só termina quando o núcleo
 * para. Enquanto ela está ativa, o React Native não pausa os timers JS com o app em segundo plano
 * (beacon e varredura da rede local, `messenger.tick`).
 * Sem react-native: roda no app e nos testes.
 */
export const CORE_TASK = 'PiuCore';

export const coreTask = (c: { boot: () => Promise<void>; untilStopped: () => Promise<void> }) => async (_data?: unknown): Promise<void> => {
  await c.boot();
  await c.untilStopped();
};

/**
 * `bootCore` (core/index.ts): liga o núcleo e depois o que vive sobre ele (mensageiro, alertas de
 * chamada). A tarefa sem tela e a tela chamam juntas: `boot` é memoizado e cada passo é idempotente.
 */
export const bootThen = (boot: () => Promise<void>, ...next: Array<() => unknown>) => async (): Promise<void> => {
  await boot();
  for (const f of next) f();
};
