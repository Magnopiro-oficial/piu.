import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { PiuCallAlert } from '../../modules/piu-voice/alert';
import { ALERT_VIBRATION, NO_ALERT, alertAction, alertDiff, alertTexts, askNotifNow, planAlert, type AlertCmd, type AlertEnv, type AlertPlan } from '../calls/callAlert';
import { IDLE, type CallState } from '../calls/callMachine';
import type { CallService } from '../calls/callService';
import { callAlertT } from '../i18n/callAlert';
import { notificationPermission, requestNotificationPermission } from '../lib/notifications';
import { readPersisted } from '../lib/persist';

/**
 * Chamada fora do app no Android: src/calls/callAlert.ts decide, o módulo nativo (modules/piu-voice/alert.ts)
 * executa. Toque e vibração, notificação de chamada recebida, tela por cima do bloqueio, serviço do
 * microfone e as ações das notificações (Atender, Recusar, Desligar). Devolve `locked` (variante da tela
 * bloqueada) e `shown` (chamada aberta pela notificação ou tocada com a tela bloqueada: fica em tela cheia).
 */
export function useCallAlerts(svc: CallService | null, nameOf: (peer: string) => string, hideName: boolean): { locked: boolean; shown: string | null } {
  const on = Platform.OS === 'android' && !!svc && PiuCallAlert.isAvailable();
  const [locked, setLocked] = useState(() => Platform.OS === 'android' && PiuCallAlert.isAvailable() && PiuCallAlert.isLocked());
  const [shown, setShown] = useState<string | null>(null);
  // Nome e pré-visualização do render mais recente: o serviço avisa fora do render.
  const who = useRef({ nameOf, hideName });
  useEffect(() => { who.current = { nameOf, hideName }; });

  useEffect(() => {
    if (!on || !svc) return;
    let env: AlertEnv = { foreground: AppState.currentState === 'active', locked: PiuCallAlert.isLocked() };
    let plan: AlertPlan = NO_ALERT;
    let last: CallState = IDLE;
    let asked = false;

    const texts = (s: CallState) => alertTexts(callAlertT, { name: s.peer ? who.current.nameOf(s.peer) : '', route: s.route, hideName: who.current.hideName });
    const run = (c: AlertCmd, s: CallState) => {
      // Falha do aparelho nunca derruba a chamada.
      try {
        switch (c.do) {
          case 'ring': if (c.on) PiuCallAlert.startRinging(ALERT_VIBRATION); else PiuCallAlert.stopRinging(); break;
          case 'lock': PiuCallAlert.setLockFlags(c.overLock, c.wake); break;
          case 'incoming': {
            if (!c.note) { PiuCallAlert.hideIncoming(); break; }
            const x = texts(s);
            PiuCallAlert.showIncoming({ callId: c.note.callId, full: c.note.full, ...x.incoming, channel: x.channels.incoming, channelDesc: x.channels.incomingDesc });
            break;
          }
          case 'ongoing': {
            if (!c.callId) { PiuCallAlert.stopOngoing(); break; }
            const x = texts(s);
            PiuCallAlert.startOngoing({ callId: c.callId, since: s.connectedAt ?? Date.now(), ...x.ongoing, channel: x.channels.ongoing, channelDesc: x.channels.ongoingDesc });
            break;
          }
        }
      } catch {}
    };
    // Permissão de notificação (Android 13+): uma vez, se o app ainda não pediu, sem esperar a resposta.
    const askNotif = () => {
      if (asked || Number(Platform.Version) < 33 || readPersisted<boolean>('notif.asked')) return;
      asked = true;
      void notificationPermission().then(p => { if (p === 'undetermined') void requestNotificationPermission(); }).catch(() => {});
    };
    const sync = () => {
      const s = svc.state, prev = last;
      last = s;
      // A tela pode ter bloqueado depois de apagar (sem aviso do sistema): confere a cada fase nova.
      if (s.phase !== prev.phase) {
        const l = PiuCallAlert.isLocked();
        if (l !== env.locked) { env = { ...env, locked: l }; setLocked(l); }
      }
      const next = planAlert(s, env, plan);
      const cmds = alertDiff(plan, next);
      plan = next;
      for (const c of cmds) run(c, s);
      if (s.phase === 'ringing' && env.locked && s.callId) setShown(s.callId);
      if (askNotifNow(prev, s, env)) askNotif();
    };

    const subs = [
      { remove: svc.subscribe(sync) },
      AppState.addEventListener('change', st => { env = { ...env, foreground: st === 'active' }; sync(); }),
      PiuCallAlert.addLockListener(l => { env = { ...env, locked: l }; setLocked(l); sync(); }),
      PiuCallAlert.addActionListener(({ action, callId }) => {
        const s = svc.state;
        switch (alertAction(s, action, callId)) {
          case 'answer': setShown(callId); svc.controller.answer(); break;
          case 'decline': svc.controller.decline(); break;
          case 'hangup': svc.controller.hangup(); break;
          case 'show':
            setShown(callId);
            if (s.phase === 'active' && s.mini) svc.controller.dispatch({ type: 'restore' });
            break;
        }
      }),
    ];
    sync();
    return () => {
      for (const x of subs) x.remove();
      for (const c of alertDiff(plan, NO_ALERT)) run(c, last);
    };
  }, [on, svc]);

  return { locked: on && locked, shown };
}
