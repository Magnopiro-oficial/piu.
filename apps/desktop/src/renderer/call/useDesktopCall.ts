/**
 * Chamada de voz de verdade no renderer: o `CallService` roda no processo principal (junto da malha) e
 * aqui ficam só a tela e o som. `RemoteCall` espelha o estado que chega por `call` e manda cada botão
 * como `CallAct` (shared/callBridge.ts); o `WebAudioEngine` abre o microfone quando o principal pede
 * (`callAudio`) e devolve cada pedaço codificado por `callFrame`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { type CallEvent, type CallState, IDLE, type LiveRoute } from '../../../../mobile/src/calls/callMachine';
import { contactOf } from '../../../../mobile/src/calls/callView';
import type { CallAct, CallSnapshot } from '../../shared/callBridge';
import { listDevices, MicMeter, WebAudioEngine } from '../callAudio';
import { motionOff } from '../ui';
import type { CallControl, CallDevices, DesktopCallHost } from './CallContext';

const UI_EVENTS: ReadonlySet<CallEvent['type']> = new Set(['closePre', 'mute', 'speaker', 'openWords', 'closeWords', 'wordsMatch', 'minimize', 'restore', 'requestLater']);

export class RemoteCall implements CallControl {
  private s: CallState = IDLE;
  private fns = new Set<(s: CallState) => void>();
  constructor(private readonly act: (a: CallAct) => void) {}
  get state() { return this.s; }
  set(s: CallState) { this.s = s; this.fns.forEach(f => f(s)); }
  subscribe(fn: (s: CallState) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  /** Só os eventos de tela; os da rede (`incoming`, `connected`…) vêm do principal. */
  dispatch(e: CallEvent) { if (UI_EVENTS.has(e.type)) this.act({ a: 'event', event: { type: e.type } as never }); }
  /** O caminho ao vivo é medido no principal; o da tela é só o que ela mostrou. */
  open(peer: string, _route?: LiveRoute | null) { this.act({ a: 'open', peer }); }
  dial() { this.act({ a: 'dial' }); }
  sendRequest() { this.act({ a: 'sendRequest' }); }
  answer() { this.act({ a: 'answer' }); }
  decline(how?: 'message' | 'later') { this.act(how ? { a: 'decline', how } : { a: 'decline' }); }
  hangup() { this.act({ a: 'hangup' }); }
  wordsDiffer() { this.act({ a: 'wordsDiffer' }); }
  requestNow() { this.act({ a: 'requestNow' }); }
}

/**
 * Provedor da chamada para o App: `null` enquanto este computador não faz chamadas (sem identidade
 * própria, espelhando o celular, bloqueado). `nameOf`: nome do contato pela lista de conversas.
 */
export function useDesktopCall(on: boolean, nameOf: (peer: string) => string, onError: (text: string) => void): DesktopCallHost | null {
  const [snap, setSnap] = useState<CallSnapshot | null>(null);
  const err = useRef(onError);
  err.current = onError;
  const ctl = useMemo(() => new RemoteCall(a => { void window.piu.callAct(a).catch(e => err.current((e as Error).message)); }), []);
  const engine = useRef<WebAudioEngine | null>(null);
  const meter = useRef<MicMeter | null>(null);
  const [mics, setMics] = useState<CallDevices['mics']>([]);
  const [outs, setOuts] = useState<CallDevices['outs']>([]);
  const [mic, setMic] = useState('default');
  const [out, setOut] = useState('default');
  const chosen = useRef({ mic, out });
  chosen.current = { mic, out };

  // Estado vindo do principal (e o atual ao ligar: a janela pode ter recarregado no meio da chamada).
  useEffect(() => {
    if (!on) { setSnap(null); return; }
    const apply = (s: CallSnapshot | null) => { setSnap(s); ctl.set(s?.state ?? IDLE); };
    void window.piu.callState().then(apply).catch(() => {});
    return window.piu.on('call', apply);
  }, [on, ctl]);

  // Microfone e alto-falante: só quando o principal pede (chamada conectada).
  useEffect(() => {
    if (!on) return;
    const off = window.piu.on('callAudio', cmd => {
      if (cmd.op === 'start') {
        engine.current?.stop();
        const { mic: m, out: o } = chosen.current;
        const e = engine.current = new WebAudioEngine(m === 'default' ? undefined : m, o === 'default' ? undefined : o);
        e.start((codec, payload) => { void window.piu.callFrame(codec, payload).catch(() => {}); })
          .catch(x => err.current((x as Error).message));
      } else if (cmd.op === 'stop') { engine.current?.stop(); engine.current = null; }
      else if (cmd.op === 'mute') engine.current?.setMuted(cmd.on);
      else engine.current?.play(cmd.codec, cmd.payload, cmd.seq);
    });
    return () => { off(); engine.current?.stop(); engine.current = null; };
  }, [on]);

  // Caixa "pre": medidor do microfone e a lista de aparelhos (os nomes só vêm depois da permissão).
  const phase = snap?.state.phase ?? 'idle';
  useEffect(() => {
    if (phase !== 'pre') return;
    const m = meter.current = new MicMeter();
    let alive = true;
    m.start(mic === 'default' ? undefined : mic)
      .then(() => listDevices())
      .then(ds => { if (!alive) return; setMics(ds.filter(d => d.kind === 'mic')); setOuts(ds.filter(d => d.kind === 'out')); })
      .catch(() => {});
    return () => { alive = false; m.stop(); if (meter.current === m) meter.current = null; };
  }, [phase, mic]);

  const devices: CallDevices = {
    mics: mics.map(d => ({ id: d.id, label: d.label })), outs: outs.map(d => ({ id: d.id, label: d.label })), mic, out,
    onMic: id => { setMic(id); void engine.current?.setMic(id); },
    onOut: id => { setOut(id); void engine.current?.setOutput(id); },
    micLevel: () => meter.current?.level() ?? 0,
  };

  if (!snap) return null;
  const s = snap.state;
  return {
    controller: ctl,
    scene: s.phase === 'idle' || !s.peer ? null : {
      state: s, contact: contactOf(nameOf(s.peer)), words: snap.words,
      ...(snap.latencyMs !== undefined ? { latencyMs: snap.latencyMs } : {}),
      levels: () => engine.current?.levels() ?? { mine: 0, theirs: 0 },
      soft: motionOff(),
    },
    devices,
    routeTo: peer => snap.routes[peer] ?? null,
  };
}
