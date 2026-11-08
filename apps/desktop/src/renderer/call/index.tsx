/**
 * Chamada de voz no Piu Desktop (design "Piu 15 Chamada Desktop"). Tudo depende do provedor
 * (CallContext): sem ele, `CallLayer` e `CallOverlay` não desenham nada e os atalhos não agem.
 * - `CallLayer`: dentro do painel da conversa (position: relative): caixa "pre", palco e cartão minimizado.
 * - `CallOverlay`: na raiz da janela: aviso de chamada recebida e os atalhos de atender/recusar/mudo/desligar.
 */
import { useEffect, useRef } from 'react';
import { type CallAction, matchCallKey } from './callDesktop';
import { CallMini } from './CallMini';
import { CallNote } from './CallNote';
import { CallPre } from './CallPre';
import { CallStage } from './CallStage';
import { type DesktopCallHost, useCallHost } from './CallContext';

export { CallBadge, CallButton, CallTitlePill, WindowTitle } from './CallChrome';
export { CallRecordCard, CallRequestCard } from './CallCards';
export { CallContext, useCallHost, type CallDevices, type DesktopCallHost } from './CallContext';
export { callToastText, declineDraft, inCall, onStage } from './callDesktop';

/** Atalhos da chamada (Ctrl⇧C · Ctrl⇧A · Ctrl⇧D · Ctrl D · Ctrl⇧E; ⌘ no macOS). `open` liga para `openPeer`. */
export function useCallKeys(host: DesktopCallHost | null, mac: boolean, only: readonly CallAction[], openPeer?: string | null) {
  const ref = useRef({ host, openPeer });
  ref.current = { host, openPeer };
  const key = only.join();
  useEffect(() => {
    if (!host) return;
    const k = (e: KeyboardEvent) => {
      const { host: h, openPeer: peer } = ref.current;
      if (!h) return;
      const ctl = h.controller;
      const a = matchCallKey(e, mac, ctl.state.phase);
      if (!a || !key.split(',').includes(a)) return;
      if (a === 'open' && !peer) return;
      e.preventDefault();
      const reqIn = ctl.state.phase === 'reqIn';
      if (a === 'open') ctl.open(peer!, h.routeTo(peer!));
      else if (a === 'answer') { if (reqIn) ctl.requestNow(); else ctl.answer(); }
      else if (a === 'decline') { if (reqIn) ctl.dispatch({ type: 'requestLater' }); else ctl.decline(); }
      else if (a === 'mute') ctl.dispatch({ type: 'mute' });
      else ctl.hangup();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [!!host, mac, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Caixa "pre", palco e cartão minimizado, ocupando só o painel da conversa. */
export function CallLayer({ mac }: { mac: boolean }) {
  const host = useCallHost();
  if (!host) return null;
  return (
    <>
      <CallStage host={host} mac={mac} />
      <CallPre host={host} />
      <CallMini host={host} mac={mac} />
    </>
  );
}

/** Aviso de chamada recebida (abaixo da barra de título, `top`) e atalhos globais da chamada. */
export function CallOverlay({ mac, top }: { mac: boolean; top: number }) {
  const host = useCallHost();
  useCallKeys(host, mac, ['answer', 'decline', 'mute', 'hangup']);
  if (!host) return null;
  return <CallNote host={host} mac={mac} top={top} />;
}
