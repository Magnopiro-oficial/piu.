/**
 * SÓ DESENVOLVIMENTO: galeria da chamada de voz (`npm run dev:renderer` → http://localhost:5188/?gallery=call),
 * no navegador e sem o Electron (sem `window.piu`). Recria a janela do protótipo "Piu 15 Chamada Desktop"
 * (1280×800: barra 46, trilho 64, lista 300, painel 916×754) com os 5 cenários (out · in · phone · mesh ·
 * missed), tema claro/escuro e animação intensa/suave, usando os componentes reais de ../ dirigidos por um
 * CallController com portas de exemplo (./demoCall). Os nomes e mensagens daqui são de exemplo.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CallRecord } from '../../../../../mobile/src/calls/callMachine';
import { contactOf, recordCard, type CallScene, type RequestStep } from '../../../../../mobile/src/calls/callView';
import icon192 from '../../brand/icon-192.png';
import { applyLangPref, getLang, LANGS, type Lang, t as tNow, useT } from '../../i18n';
import { F, FM, Sym, Toast } from '../../ui';
import { callKeyLabel, callToastText, HANDOFF, type AudioDevice } from '../callDesktop';
import { CallContext, type DesktopCallHost, useCallHost } from '../CallContext';
import { CallBadge, CallButton, CallLayer, CallOverlay, CallRecordCard, CallRequestCard, CallTitlePill, useCallKeys, WindowTitle } from '..';
import { makeDemo, type DemoHooks } from './demoCall';

type Scenario = 'out' | 'in' | 'phone' | 'mesh' | 'missed';
type Msg = { id: number; time: string } & ({ kind: 'text'; who: 'me' | 'them'; text: string } | { kind: 'rec'; rec: CallRecord } | { kind: 'req' });

const PEOPLE: Record<string, { name: string; group?: boolean }> = { marina: { name: 'Marina Alves' }, ana: { name: 'Ana Souza' }, mutirao: { name: 'Mutirão da rua', group: true } };
const ORDER = ['marina', 'ana', 'mutirao'];
const PHONE = 'Pixel 7a';
const WORDS = ['lua', 'ponte', 'sal', 'rio'];
const LAT = { direct: 18, bt: 42, point: 64 } as const;
const MICS: AudioDevice[] = [{ id: 'builtin', label: 'Microfone embutido', icon: 'laptop' }, { id: 'bt', label: 'Fone Bluetooth', icon: 'headphones' }];
const OUTS: AudioDevice[] = [{ id: 'speakers', label: 'Alto-falantes', icon: 'speaker' }, { id: 'bt', label: 'Fone Bluetooth', icon: 'headphones' }];
const SCENARIOS: [Scenario, string, string][] = [
  ['out', 'Fazer uma chamada', 'Painel da conversa vira palco'], ['in', 'Receber uma chamada', 'Aviso no canto, toca nos dois'],
  ['phone', 'Atendida no celular', 'O computador para de tocar'], ['mesh', 'Sem caminho ao vivo', 'Vira pedido de chamada'], ['missed', 'Chamada perdida', 'Ligar de volta'],
];

let seq = 0;
const clock = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const text = (who: 'me' | 'them', t: string, time: string): Msg => ({ id: ++seq, kind: 'text', who, text: t, time });
function baseMsgs(s: Scenario): Record<string, Msg[]> {
  const m: Record<string, Msg[]> = {
    marina: [text('them', 'Consegui a extensão de 10 m pro mutirão', '14:02'), text('me', 'Boa! Te ligo pra combinar o horário', '14:03')],
    ana: [text('them', 'Chegou o material da horta comunitária', '13:40'), text('me', 'Que ótimo! Passo aí no sábado', '13:42')],
    mutirao: [text('them', 'Lia: Levo uma extensão de 10 m', '12:10')],
  };
  if (s === 'missed') m.marina!.push({ id: ++seq, kind: 'rec', time: '14:05', rec: { callId: 'demo', peer: 'marina', dir: 'in', outcome: 'missed', at: Date.now(), rangMs: 22_000, route: 'direct' } });
  return m;
}

export function CallGallery() {
  const t = useT();
  const [scen, setScen] = useState<Scenario>('out');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [soft, setSoft] = useState(false);
  const [lang, setLangS] = useState<Lang>(getLang());
  const [msgs, setMsgs] = useState(() => baseMsgs('out'));
  const [active, setActive] = useState('marina');
  const [meshFor, setMeshFor] = useState<string | null>(null);
  const [reqStep, setReqStep] = useState<0 | 1 | 2>(0);
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const [elsewhere, setElsewhere] = useState<{ device: string; at: number } | null>(null);
  const [mic, setMic] = useState('builtin');
  const [out, setOut] = useState('speakers');
  const mac = /Mac/.test(navigator.userAgent);

  const hooks = useMemo<DemoHooks>(() => {
    const add = (peer: string, m: Msg) => setMsgs(all => ({ ...all, [peer]: [...(all[peer] ?? []), m] }));
    return {
      record: rec => {
        add(rec.peer, { id: ++seq, kind: 'rec', rec, time: clock() });
        if (rec.outcome === 'elsewhere') setElsewhere({ device: rec.note ?? PHONE, at: Date.now() });
      },
      toast: (x, peer) => {
        const s = ++seq;
        setToast({ text: callToastText((k, v) => tNow(k as never, v), x, peer ? contactOf(PEOPLE[peer]?.name ?? peer) : undefined), seq: s });
        setTimeout(() => setToast(cur => (cur?.seq === s ? null : cur)), 2400);
      },
      request: peer => { setReqStep(0); add(peer, { id: ++seq, kind: 'req', time: clock() }); },
      requestStep: step => { setReqStep(step); if (step === 2) setMeshFor(null); },
    };
  }, []);
  const [demo, setDemo] = useState(() => makeDemo(hooks));
  const state = useSyncExternalStore(fn => demo.ctl.subscribe(fn), () => demo.ctl.state);

  // Cenário: começa como no protótipo (caixa "pre" em 0,8 s; chamada chegando em 0,9 s; celular atende em 3,6 s).
  useEffect(() => {
    if (scen === 'out') demo.later(() => demo.ctl.open('marina', 'direct'), 800);
    if (scen === 'mesh') demo.later(() => demo.ctl.open('ana', null), 800);
    if (scen === 'in' || scen === 'phone') demo.later(() => demo.incoming('marina'), 900);
    if (scen === 'phone') demo.later(() => demo.answeredElsewhere(PHONE), 3600);
    return () => demo.stop();
  }, [demo, scen]);
  const start = (s: Scenario) => {
    demo.dispose();
    setScen(s); setMsgs(baseMsgs(s)); setReqStep(0); setElsewhere(null); setToast(null);
    setActive(s === 'mesh' ? 'ana' : s === 'in' || s === 'phone' ? 'mutirao' : 'marina');
    setMeshFor(s === 'mesh' ? 'ana' : null);
    setDemo(makeDemo(hooks));
  };

  const ph = state.phase;
  const peerName = state.peer ? PEOPLE[state.peer]?.name ?? state.peer : '';
  const route = ph === 'pre' ? state.preRoute : state.route;
  const scene: CallScene | null = ph === 'idle' ? null : {
    state, contact: contactOf(peerName), words: ph === 'active' ? WORDS : null,
    latencyMs: route && !state.switching ? LAT[route] : undefined, hops: 3, levels: demo.levels, soft,
  };
  const host: DesktopCallHost = {
    controller: demo.ctl, scene,
    devices: { mics: MICS, outs: OUTS, mic, out, onMic: setMic, onOut: setOut, micLevel: demo.micLevel },
    phoneName: PHONE,
    onHandoff: () => demo.later(() => demo.ctl.dispatch({ type: 'handoff', device: PHONE, now: Date.now() }), HANDOFF.doneMs),
    routeTo: id => (id === meshFor ? null : 'direct'),
    elsewhere,
  };

  // Como na conversa de verdade: o palco mostra a conversa de quem está na chamada.
  const onStageNow = ph === 'calling' || ph === 'active' || ph === 'ending';
  useEffect(() => { if (onStageNow && !state.mini && state.peer) setActive(state.peer); }, [onStageNow, state.mini, state.peer]);
  const pick = (id: string) => {
    if (ph === 'active' && state.peer) demo.ctl.dispatch({ type: id === state.peer ? 'restore' : 'minimize' });
    setActive(id);
  };

  const person = PEOPLE[active]!;
  const c = contactOf(person.name);
  const head = meshFor === active ? { icon: 'hub', text: t('call.chat.mesh', { hops: 3 }) } : person.group ? { icon: 'groups', text: '14 pessoas' } : { icon: 'wifi', text: t('call.chat.direct') };
  const step: RequestStep = reqStep === 0 ? 'traveling' : reqStep === 1 ? 'delivered' : 'accepted';
  const lastOf = (id: string) => {
    const m = msgs[id]![msgs[id]!.length - 1]!;
    return m.kind === 'text' ? m.text : m.kind === 'req' ? t('call.rec.request') : recordCard((k, v) => t(k as never, v), m.rec, contactOf(PEOPLE[id]!.name), { desktop: true }).title;
  };

  return (
    <CallContext.Provider value={host}>
      <GalleryKeys mac={mac} peer={ph === 'idle' ? active : null} />
      <WindowTitle base={`${person.name} · galeria`} />
      <div style={{ height: '100vh', overflow: 'auto', background: '#e9e9e6', fontFamily: F, color: '#0c0c0c' }}>
        <div style={{ minHeight: '100%', padding: '48px 40px 80px', display: 'flex', flexWrap: 'wrap', gap: 48, justifyContent: 'center', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 26, paddingTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ font: `600 11px ${FM}`, padding: '3px 8px', background: '#0c0c0c', color: '#fff', borderRadius: 5 }}>DEV</span><span style={{ font: `500 12px ${FM}`, color: '#5f5f5c', letterSpacing: '.04em' }}>PIU 15 · DESKTOP</span></div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1 }}>Chamada de voz no computador</div>
              <div style={{ fontSize: 15, color: '#5f5f5c', lineHeight: 1.55 }}>Galeria de desenvolvimento: componentes reais do app, controlador de verdade e o outro lado simulado com os tempos do protótipo.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ font: `500 11.5px ${FM}`, letterSpacing: '.06em', color: '#5f5f5c' }}>CENÁRIOS</div>
              {SCENARIOS.map(([id, title, sub], i) => (
                <button key={id} onClick={() => start(id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', border: 'none', borderRadius: 18, background: scen === id ? '#0c0c0c' : '#fff', color: scen === id ? '#fff' : '#0c0c0c', textAlign: 'left', cursor: 'pointer', transition: 'background .2s,color .2s' }}>
                  <span style={{ font: `500 12px ${FM}`, opacity: .6, width: 18 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 15, fontWeight: 620 }}>{title}</span><span style={{ fontSize: 12.5, opacity: .65 }}>{sub}</span></span>
                  <Sym name="replay" size={20} style={{ opacity: .6 }} />
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill on={theme === 'light'} onClick={() => setTheme('light')}>Claro</Pill>
              <Pill on={theme === 'dark'} onClick={() => setTheme('dark')}>Escuro</Pill>
              <Pill on={!soft} onClick={() => setSoft(false)}>Intensa</Pill>
              <Pill on={soft} onClick={() => setSoft(true)}>Suave</Pill>
              <select value={lang} onChange={e => { const l = e.target.value as Lang; applyLangPref(l, 'auto'); setLangS(l); }} style={{ height: 36, borderRadius: 18, border: 'none', padding: '0 12px', background: '#fff', font: `500 13px ${F}` }}>
                {LANGS.map(l => <option key={l.code} value={l.code}>{l.native}</option>)}
              </select>
            </div>
            {ph === 'active' && (
              <button onClick={demo.weak} style={{ height: 46, padding: '0 16px', border: 'none', borderRadius: 23, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.12) inset', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                <Sym name="wifi_off" size={19} />{state.route === 'bt' ? 'Simular: saiu do alcance do Bluetooth' : 'Simular: o Wi-Fi caiu'}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 22, background: '#fff' }}>
              <div style={{ font: `500 11.5px ${FM}`, letterSpacing: '.06em', color: '#5f5f5c' }}>ATALHOS</div>
              {([['call.action', 'open'], ['call.answer', 'answer'], ['call.decline', 'decline'], ['call.ctl.mute', 'mute'], ['call.ctl.hangup', 'hangup']] as const).map(([k, a]) => (
                <div key={a} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}><span>{t(k)}</span><span style={{ font: `500 12px ${FM}`, padding: '3px 8px', borderRadius: 6, background: '#f3f3f1', boxShadow: '0 1px 0 rgba(0,0,0,.12)' }}>{callKeyLabel(a, mac)}</span></div>
              ))}
            </div>
          </div>

          <div data-piu-theme={theme} style={{ position: 'relative', width: 1280, height: 800, flex: 'none', borderRadius: 12, overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', letterSpacing: '-0.005em', boxShadow: '0 0 0 1px var(--line2),0 40px 80px -30px rgba(0,0,0,.35)' }}>
            <div style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 14px', background: 'var(--side)', borderBottom: '1px solid var(--line)', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}><img src={icon192} alt="" style={{ width: 20, height: 20, borderRadius: 5, display: 'block' }} />Piu</div>
              <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>{person.name}<CallTitlePill /></div>
              <div style={{ display: 'flex', gap: 10 }}>
                {['remove', 'crop_square', 'close'].map(i => <span key={i} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name={i} size={i === 'crop_square' ? 13 : 15} /></span>)}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <div style={{ width: 64, flex: 'none', background: 'var(--side)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 0' }}>
                <img src={icon192} alt="" style={{ width: 36, height: 36, borderRadius: 11, display: 'block', marginBottom: 8 }} />
                <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="forum" size={22} fill={1} /></span>
                <span style={{ width: 44, height: 44, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink2)' }}><Sym name="account_balance_wallet" size={22} /></span>
                <span style={{ width: 44, height: 44, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink2)' }}><Sym name="settings" size={22} /></span>
              </div>
              <div style={{ width: 300, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
                <div style={{ padding: '18px 16px 10px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('chats.title')}</div>
                <div style={{ margin: '0 12px 10px', height: 38, borderRadius: 12, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontSize: 13.5, color: 'var(--ink3)' }}><Sym name="search" size={18} />{t('chats.search')}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 8px', gap: 2 }}>
                  {ORDER.map(id => {
                    const p = contactOf(PEOPLE[id]!.name), L = msgs[id]!;
                    return (
                      <div key={id} role="button" tabIndex={0} className="h-bg2" onClick={() => pick(id)} onKeyDown={e => { if (e.key === 'Enter') pick(id); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, background: active === id ? 'var(--bg3)' : 'transparent', cursor: 'pointer' }}>
                        <span style={{ position: 'relative', width: 44, height: 44, borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 650, flex: 'none' }}>{p.initials}<CallBadge peer={id} /></span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ fontSize: 14, fontWeight: 620, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span><span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)' }}>{L[L.length - 1]!.time}</span></span>
                          <span style={{ fontSize: 12.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastOf(id)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ flex: 1, position: 'relative', overflow: 'clip', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
                <div style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, fontWeight: 650 }}>{c.initials}</span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 650 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 4 }}><Sym name={head.icon} size={14} />{head.text}</span>
                  </span>
                  <CallButton mac={mac} onClick={() => demo.ctl.open(active, host.routeTo(active))} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, padding: '20px 28px', backgroundImage: 'radial-gradient(var(--dot) 1.1px,transparent 1.3px)', backgroundSize: '18px 18px', minHeight: 0, overflow: 'hidden' }}>
                  {msgs[active]!.map(m => m.kind === 'text' ? (
                    <div key={m.id} style={{ alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start', maxWidth: '60%', padding: '10px 14px', borderRadius: 18, background: m.who === 'me' ? 'var(--ink)' : 'var(--bg)', color: m.who === 'me' ? 'var(--invink)' : 'var(--ink)', boxShadow: m.who === 'me' ? 'none' : '0 0 0 1px var(--line2)', fontSize: 14, lineHeight: 1.45, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                      <span>{m.text}</span><span style={{ font: `500 10.5px ${FM}`, opacity: .55 }}>{m.time}</span>
                    </div>
                  ) : m.kind === 'rec' ? (
                    <CallRecordCard key={m.id} record={m.rec} contact={c} time={m.time} onCallBack={() => demo.ctl.open(active, host.routeTo(active))} />
                  ) : (
                    <CallRequestCard key={m.id} step={step} contact={c} hops={3} time={m.time} />
                  ))}
                </div>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px 16px' }}>
                  <div style={{ flex: 1, height: 46, borderRadius: 23, background: 'var(--bg2)', display: 'flex', alignItems: 'center', padding: '0 18px', fontSize: 14, color: 'var(--ink3)' }}>{t('chats.compose.placeholder', { name: c.first })}</div>
                  <span style={{ width: 46, height: 46, borderRadius: 23, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="mic" size={21} /></span>
                </div>
                <CallLayer mac={mac} />
              </div>
            </div>
            <CallOverlay mac={mac} top={46} />
            {toast && <Toast text={toast.text} icon="check" />}
          </div>
        </div>
      </div>
    </CallContext.Provider>
  );
}

/** Ctrl⇧C (⌘⇧C) liga para a conversa aberta, como na conversa do app (dentro do provedor da galeria). */
function GalleryKeys({ mac, peer }: { mac: boolean; peer: string | null }) {
  useCallKeys(useCallHost(), mac, ['open'], peer);
  return null;
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return <button onClick={onClick} aria-pressed={on} style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 18, background: on ? '#0c0c0c' : '#fff', color: on ? '#fff' : '#0c0c0c', font: `600 13px ${F}`, cursor: 'pointer' }}>{children}</button>;
}
