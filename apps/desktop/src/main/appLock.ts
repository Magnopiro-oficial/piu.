/**
 * Bloqueio do Piu (Ajustes → Privacidade → Bloqueio; atalho ⌘L / Ctrl L), sem Electron.
 * O main.ts liga `powerMonitor` ('suspend', 'lock-screen' e o tempo ocioso do sistema) a `lockTrigger`.
 * Desbloquear pede a senha do Piu (lockPassword.ts) ou, no macOS, o Touch ID.
 * Os gatilhos só valem com a senha do Piu criada (sem ela, a interface não deixa ligar os ajustes).
 * Bloqueado, o Piu continua recebendo e repassando; a janela mostra só a contagem de mensagens novas.
 * Chamada que toca com o Piu bloqueado não chega à janela e termina como perdida: quem ligou fica guardado
 * aqui e, ao desbloquear, o main.ts avisa "Chamada perdida de X" (`takeMissedCalls`).
 */
import type { Prefs } from '../shared/types';

export type LockEvent = { kind: 'suspend' } | { kind: 'lock-screen' } | { kind: 'idle'; idleSec: number } | { kind: 'manual' } | { kind: 'start' };
export type LockReason = 'suspend' | 'idle' | 'manual' | 'start';

export function lockTrigger(p: Pick<Prefs, 'lockOnSuspend' | 'lockAfter'>, ev: LockEvent): boolean {
  switch (ev.kind) {
    case 'manual': return true;
    case 'suspend': case 'lock-screen': return p.lockOnSuspend;
    case 'idle': return p.lockAfter !== 'never' && Number.isFinite(ev.idleSec) && ev.idleSec >= Number(p.lockAfter) * 60;
    // Ao abrir: com algum bloqueio automático ligado, fechar e abrir o Piu não pode ser um atalho para entrar.
    case 'start': return p.lockOnSuspend || p.lockAfter !== 'never';
  }
}

export const reasonOf = (ev: LockEvent): LockReason => (ev.kind === 'lock-screen' ? 'suspend' : ev.kind);

export class AppLock {
  private on = false;
  /** Por que e quando bloqueou; mensagens recebidas desde então (só a contagem aparece). */
  reason: LockReason = 'manual';
  at = 0;
  newMessages = 0;
  /** Quem ligou (chamada perdida) desde que bloqueou, na ordem, sem repetir. */
  private missed: string[] = [];
  constructor(private onChange: (locked: boolean) => void, private now: () => number = Date.now) {}
  get locked() { return this.on; }
  lock(reason: LockReason = 'manual') {
    if (this.on) return;
    this.on = true; this.reason = reason; this.at = this.now(); this.newMessages = 0; this.missed = [];
    this.onChange(true);
  }
  /** Conta uma mensagem recebida enquanto bloqueado. */
  received() { if (this.on) this.newMessages++; }
  /** Guarda quem ligou enquanto bloqueado (a chamada terminou como perdida). */
  missedCall(peer: string) { if (this.on && !this.missed.includes(peer)) this.missed.push(peer); }
  /** Quem ligou enquanto estava bloqueado; lido uma vez (no aviso ao desbloquear). */
  takeMissedCalls(): string[] { const m = this.missed; this.missed = []; return m; }
  /** `reauth`: senha do Piu ou Touch ID. Recusa ou erro: continua bloqueado. */
  async unlock(reauth: () => Promise<boolean>): Promise<boolean> {
    if (!this.on) return true;
    let ok = false;
    try { ok = (await reauth()) === true; } catch { ok = false; }
    if (!ok) return false;
    if (!this.on) return true; // outro caminho já desbloqueou enquanto a confirmação corria
    this.on = false; this.newMessages = 0; this.onChange(false);
    return true;
  }
}
