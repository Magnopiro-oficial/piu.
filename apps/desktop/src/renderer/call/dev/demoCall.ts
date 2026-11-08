/**
 * SÓ DESENVOLVIMENTO (galeria `?gallery=call`): um CallController de verdade com portas de exemplo
 * que fazem o papel do outro lado com os tempos do protótipo (tocando em 1,5 s, conecta em 4,6 s;
 * pedido entregue em 1,9 s, aceito em 4,0 s, liga em 5,6 s) e a fórmula de voz simulada do protótipo (§5.4).
 * Nada disto entra no build de produção (main.tsx só importa a galeria atrás de `import.meta.env.DEV`).
 */
import { CallController } from '../../../../../mobile/src/calls/callController';
import type { CallRecord, Effect, LiveRoute } from '../../../../../mobile/src/calls/callMachine';

export type DemoHooks = {
  record(rec: CallRecord): void;
  toast(text: Extract<Effect, { kind: 'toast' }>['text'], peer?: string): void;
  /** Pedido de chamada saiu (cartão na conversa) e avançou (0 viajando · 1 entregue · 2 aceito). */
  request(peer: string): void;
  requestStep(step: 0 | 1 | 2): void;
};

const uuid = () => crypto.randomUUID();

export function makeDemo(h: DemoHooks) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const stop = () => { timers.forEach(clearTimeout); timers.clear(); };
  const ctl: CallController = new CallController({
    now: () => Date.now(),
    newId: uuid,
    send: (peer, sig) => {
      if (sig.t === 'invite') {
        later(() => ctl.dispatch({ type: 'peerRinging', callId: sig.callId }), 1500);
        later(() => ctl.dispatch({ type: 'connected', callId: sig.callId, now: Date.now() }), 4600);
      }
      if (sig.t === 'cancel' || sig.t === 'end') stop();
      if (sig.t === 'request') {
        h.request(peer);
        later(() => h.requestStep(1), 1900);
        later(() => h.requestStep(2), 4000);
        later(() => ctl.dispatch({ type: 'requestAccepted', requestId: sig.requestId, peer, route: 'direct', callId: uuid(), now: Date.now() }), 5600);
      }
    },
    record: rec => h.record(rec),
    media: () => {},
    toast: (text, peer) => h.toast(text, peer),
  });

  /** Voz simulada do protótipo: o turno `g` decide quem fala; a amplitude vem de dois senos. */
  const levels = () => {
    const s = ctl.state;
    if (s.phase !== 'active' || s.connectedAt === undefined) return { mine: 0, theirs: 0 };
    const t = (Date.now() - s.connectedAt) / 1000;
    const g = Math.sin(t * 0.55 + 0.3);
    const raw = 0.35 + 0.65 * Math.abs(Math.sin(t * 11.3) * Math.sin(t * 6.1 + 0.7));
    const amp = raw * Math.min(1, Math.max(0, (Math.abs(g) - 0.12) * 5));
    return g > 0.12 ? { mine: 0, theirs: amp } : g < -0.12 ? { mine: amp, theirs: 0 } : { mine: 0, theirs: 0 };
  };
  /** Medidor do microfone na caixa "pre" (fórmula do protótipo). */
  const micLevel = () => { const t = performance.now() / 1000; return 0.3 + 0.7 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 3.3)); };

  /** "Simular: o Wi-Fi caiu": troca de caminho em 2,2 s (Wi-Fi → Bluetooth → Ponto Piu). */
  const weak = () => {
    const s = ctl.state;
    if (s.phase !== 'active' || s.switching || !s.route) return;
    const next: LiveRoute = s.route === 'bt' ? 'point' : 'bt';
    ctl.dispatch({ type: 'routeLost', now: Date.now() });
    later(() => ctl.dispatch({ type: 'routeFound', route: next }), 2200);
  };

  const incoming = (peer: string) => ctl.dispatch({ type: 'incoming', callId: uuid(), peer, route: 'direct', now: Date.now() });
  const answeredElsewhere = (device: string) => { const id = ctl.state.callId; if (id) ctl.dispatch({ type: 'answeredElsewhere', callId: id, device, now: Date.now() }); };

  return { ctl, later, stop, levels, micLevel, weak, incoming, answeredElsewhere, dispose: () => { stop(); ctl.dispose(); } };
}
export type Demo = ReturnType<typeof makeDemo>;
