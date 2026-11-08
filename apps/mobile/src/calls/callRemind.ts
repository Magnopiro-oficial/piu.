/**
 * Lembrete do "Em 10 min" (recusar a chamada): uma notificação local agendada no sistema, que chega
 * mesmo com o app fechado, e um timer enquanto o app está vivo. Se na hora o app estiver em primeiro
 * plano (onde o sistema não mostra o banner), a notificação sai da lista e o aviso aparece dentro do
 * app. Um lembrete por contato: recusar de novo troca o anterior; `cancel` tira os dois.
 * Puro (testado em __tests__/callRemind.test.ts); o celular passa as portas (state/calls.tsx).
 */
export type RemindPorts = {
  /** Agenda a notificação do sistema daqui a `delaySec` s; `null` se não deu (permissão, ajustes). */
  schedule(peer: string, delaySec: number): Promise<string | null>;
  /** Desagenda e, se já chegou, tira da lista. */
  cancel(id: string): void;
  /** App em primeiro plano agora? */
  active(): boolean;
  /** Aviso dentro do app, na hora do lembrete. */
  show(peer: string): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
};

type Pending = { timer: unknown; id: Promise<string | null> };

export class CallReminders {
  private byPeer = new Map<string, Pending>();

  constructor(private readonly p: RemindPorts) {}

  has(peer: string) { return this.byPeer.has(peer); }

  add(peer: string, ms: number) {
    this.cancel(peer);
    const id = this.p.schedule(peer, Math.max(1, Math.round(ms / 1000))).catch(() => null);
    const set = this.p.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    const timer = set(() => {
      if (this.byPeer.get(peer)?.timer !== timer) return;
      this.byPeer.delete(peer);
      if (!this.p.active()) return; // fora do primeiro plano quem avisa é a notificação do sistema
      void id.then(x => { if (x) this.p.cancel(x); });
      this.p.show(peer);
    }, ms);
    this.byPeer.set(peer, { timer, id });
  }

  /** Tira o lembrete do contato (o timer e a notificação agendada). */
  cancel(peer: string) {
    const r = this.byPeer.get(peer);
    if (!r) return;
    this.byPeer.delete(peer);
    this.clear(r.timer);
    void r.id.then(x => { if (x) this.p.cancel(x); });
  }

  /** O serviço da chamada acabou (outro mensageiro): solta os timers; o que o sistema já agendou continua. */
  dispose() {
    for (const r of this.byPeer.values()) this.clear(r.timer);
    this.byPeer.clear();
  }

  private clear(h: unknown) { (this.p.clearTimer ?? ((x: unknown) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h); }
}
