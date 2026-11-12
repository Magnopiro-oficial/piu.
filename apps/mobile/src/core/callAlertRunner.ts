/**
 * Chamada fora do app no Android, no núcleo: src/calls/callAlert.ts decide, o módulo nativo
 * (modules/piu-voice/alert.ts) executa. Toque e vibração, notificação de chamada recebida, tela por
 * cima do bloqueio, serviço do microfone e as ações das notificações (Atender, Recusar, Desligar).
 * Antes era um efeito da tela (state/callAlerts.ts); deslizar o app dos recentes desmontava tudo e a
 * chamada chegava sem tocar. Agora o executor segue o serviço da chamada do mensageiro do processo
 * (`attach`), com ou sem tela, e a tela só lê `locked` (variante da tela bloqueada) e `shown` (chamada
 * aberta pela notificação ou tocada com a tela bloqueada: fica em tela cheia).
 * Sem react-native: roda no app (core/index.ts liga as peças reais) e nos testes.
 */
import type { IncomingNative, OngoingNative } from '../../modules/piu-voice/alert';
import { ALERT_VIBRATION, NO_ALERT, alertAction, alertDiff, alertTexts, askNotifNow, planAlert, type AlertCmd, type AlertEnv, type AlertPlan } from '../calls/callAlert';
import { IDLE, type CallState } from '../calls/callMachine';
import type { CallService } from '../calls/callService';
import { callAlertT } from '../i18n/callAlert';

type Sub = { remove(): void };

/** O que o executor usa do módulo nativo (PiuCallAlert). */
export interface AlertDevice {
  isLocked(): boolean;
  setLockFlags(overLock: boolean, wake: boolean): void;
  startRinging(pattern: readonly number[]): void;
  stopRinging(): void;
  showIncoming(n: IncomingNative): void;
  hideIncoming(): void;
  startOngoing(n: OngoingNative): void;
  stopOngoing(): void;
  addLockListener(fn: (locked: boolean) => void): Sub;
  addActionListener(fn: (e: { action: string; callId: string }) => void): Sub;
}

export interface CallAlertDeps {
  device: AlertDevice;
  /** Android com o módulo nativo; sem ele (iPhone, web, Expo Go) nada toca. */
  enabled: boolean;
  /** App em primeiro plano agora, e o aviso de quando muda (AppState). */
  foreground: () => boolean;
  onForeground: (fn: (foreground: boolean) => void) => Sub;
  /** Nome do contato (conversas do núcleo) e pré-visualização "Nunca" (do salvo): lidos na hora do aviso. */
  nameOf: (peer: string) => string;
  hideName: () => boolean;
  /** Pede a permissão de notificação (Android 13+), se o app ainda não pediu, sem esperar a resposta. */
  askNotif: () => void;
  /** Notificação permitida agora (sem ela os avisos com Atender/Desligar não aparecem). */
  notifyAllowed: () => Promise<boolean>;
}

export interface CallAlertView { locked: boolean; shown: string | null }

export type CallAlertRunner = ReturnType<typeof createCallAlertRunner>;

export function createCallAlertRunner(deps: CallAlertDeps) {
  const { device } = deps;
  const subs = new Set<() => void>();
  let locked = deps.enabled && device.isLocked();
  let shown: string | null = null;
  let svc: CallService | null = null;
  let view: CallAlertView = { locked: false, shown: null };
  let release: (() => void) | null = null;
  let notifyOk = false;
  // Relida ao seguir um serviço e ao voltar ao primeiro plano (a pessoa pode ter mudado nos ajustes do sistema).
  const checkNotify = () => { deps.notifyAllowed().then(v => { notifyOk = v; }, () => { notifyOk = false; }); };

  const emit = () => {
    const next = { locked: !!svc && locked, shown };
    if (next.locked === view.locked && next.shown === view.shown) return;
    view = next;
    subs.forEach(fn => { try { fn(); } catch { /* ouvinte */ } });
  };
  const setLocked = (l: boolean) => { locked = l; emit(); };
  const setShown = (id: string) => { shown = id; emit(); };

  const run = (s: CallService) => {
    let env: AlertEnv = { foreground: deps.foreground(), locked: device.isLocked() };
    let plan: AlertPlan = NO_ALERT;
    let last: CallState = IDLE;
    let asked = false;

    const texts = (st: CallState) => alertTexts(callAlertT, { name: st.peer ? deps.nameOf(st.peer) : '', route: st.route, hideName: deps.hideName() });
    const exec = (c: AlertCmd, st: CallState) => {
      // Falha do aparelho nunca derruba a chamada.
      try {
        switch (c.do) {
          case 'ring': if (c.on) device.startRinging(ALERT_VIBRATION); else device.stopRinging(); break;
          case 'lock': device.setLockFlags(c.overLock, c.wake); break;
          case 'incoming': {
            if (!c.note) { device.hideIncoming(); break; }
            const x = texts(st);
            device.showIncoming({ callId: c.note.callId, full: c.note.full, ...x.incoming, channel: x.channels.incoming, channelDesc: x.channels.incomingDesc });
            break;
          }
          case 'ongoing': {
            if (!c.callId) { device.stopOngoing(); break; }
            const x = texts(st);
            device.startOngoing({ callId: c.callId, since: st.connectedAt ?? Date.now(), ...x.ongoing, channel: x.channels.ongoing, channelDesc: x.channels.ongoingDesc });
            break;
          }
        }
      } catch {}
    };
    // Permissão de notificação: uma vez por serviço, quando a primeira chamada termina.
    const askNotif = () => {
      if (asked) return;
      asked = true;
      try { deps.askNotif(); } catch {}
    };
    const sync = () => {
      const st = s.state, prev = last;
      last = st;
      // A tela pode ter bloqueado depois de apagar (sem aviso do sistema): confere a cada fase nova.
      if (st.phase !== prev.phase) {
        const l = device.isLocked();
        if (l !== env.locked) { env = { ...env, locked: l }; setLocked(l); }
      }
      const next = planAlert(st, env, plan);
      const cmds = alertDiff(plan, next);
      plan = next;
      for (const c of cmds) exec(c, st);
      if (st.phase === 'ringing' && env.locked && st.callId) setShown(st.callId);
      if (askNotifNow(prev, st, env)) askNotif();
    };

    const off: Sub[] = [
      { remove: s.subscribe(sync) },
      deps.onForeground(f => { env = { ...env, foreground: f }; if (f) checkNotify(); sync(); }),
      device.addLockListener(l => { env = { ...env, locked: l }; setLocked(l); sync(); }),
      device.addActionListener(({ action, callId }) => {
        const st = s.state;
        switch (alertAction(st, action, callId)) {
          case 'answer': setShown(callId); s.controller.answer(); break;
          case 'decline': s.controller.decline(); break;
          case 'hangup': s.controller.hangup(); break;
          case 'show':
            setShown(callId);
            if (st.phase === 'active' && st.mini) s.controller.dispatch({ type: 'restore' });
            break;
        }
      }),
    ];
    setLocked(env.locked);
    sync();
    return () => {
      for (const x of off) x.remove();
      for (const c of alertDiff(plan, NO_ALERT)) exec(c, last);
    };
  };

  return {
    /**
     * Segue o serviço da chamada do mensageiro do processo (`null`: sem mensageiro ou sem áudio). Trocar
     * de serviço tira o aviso do anterior; o mesmo serviço não faz nada.
     */
    attach: (next: CallService | null) => {
      if (next === svc) return;
      const r = release;
      release = null;
      r?.();
      svc = deps.enabled ? next : null;
      if (svc) { checkNotify(); release = run(svc); }
      emit();
    },
    /**
     * A chamada nesta fase tem aviso com botão sem a tela (tocando: Atender/Recusar; em curso:
     * Desligar)? Chamando, o plano não mostra aviso. Quem pergunta é o mensageiro quando a tela
     * desmonta (messengerRuntime `detach`): sem controle, a chamada não segue.
     */
    keepCall: (phase: string): boolean => !!svc && notifyOk && (phase === 'ringing' || phase === 'active'),
    getSnapshot: (): CallAlertView => view,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
