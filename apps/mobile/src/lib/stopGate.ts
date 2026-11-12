/**
 * Religar um meio de transporte (nome novo na virada do dia UTC, outro Wi-Fi): o `stop` é assíncrono
 * e o motor só fica desligado quando ele termina. Um `start` disparado antes disso é ignorado pelo
 * motor (ainda "rodando") e o `stop` que termina em seguida deixa tudo desligado, sem nada que religue.
 * Aqui o `stop` continua saindo na hora (limpeza do efeito) e o próximo `start` espera por `idle()`.
 * Sem react-native: roda no app e nos testes.
 */
export interface StopGate {
  /** Dispara o `stop` agora e guarda a espera; falha do `stop` não trava o próximo `start`. */
  stop(fn: () => Promise<unknown> | unknown): void;
  /** Resolve quando todos os `stop` disparados terminaram (na hora, se não há nenhum pendente). */
  idle(): Promise<void>;
}

export function createStopGate(): StopGate {
  let pending: Promise<void> = Promise.resolve();
  return {
    stop(fn) {
      const prev = pending;
      const cur = (async () => { await fn(); })().catch(() => {});
      pending = prev.then(() => cur);
    },
    idle: () => pending,
  };
}
