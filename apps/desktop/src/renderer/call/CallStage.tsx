/**
 * Palco da chamada no painel da conversa (a lista continua visível): fundo #0c0c0c, malha de pontos
 * em canvas 2× (o `draw()` do protótipo, com a matemática de callVisual.ts), selos, avatar, nome,
 * status, quem fala, controles, popover de áudio, caixa das 4 palavras e "Continua no …".
 */
import { useEffect, useRef, useState } from 'react';
import type { CallState } from '../../../../mobile/src/calls/callMachine';
import { controls, encChip, routeChip, type CallScene, type ControlId } from '../../../../mobile/src/calls/callView';
import { avatarScale, contour, CONTOUR_STYLE, dotAlpha, dotRadius, END_SECONDS, flashAlpha, rings, voiceNow, type FrameInput } from '../../../../mobile/src/calls/callVisual';
import { F, FM, motionOff, Sym } from '../ui';
import { callKeyLabel, callLines, deviceIcon, HANDOFF, onStage, stageLayout, type AudioDevice } from './callDesktop';
import { type DesktopCallHost, useFrame, useSticky, useTick, useTr } from './CallContext';

const ENTER = 'cubic-bezier(.2,.85,.3,1)';
const BOUNCE = 'cubic-bezier(.3,1.35,.5,1)';
/** Pro celular: varrendo, "Continua no …", e saindo (o palco some com a tela de "Continua" por cima). */
type Handoff = { step: 'go' | 'done' | 'out'; at: number };

/** Amplitude da voz agora (0 fora da chamada ativa e durante a passagem para o celular). */
function ampOf(sc: CallScene, soft: boolean, ho: boolean) {
  const s = sc.state;
  if (s.phase !== 'active' || ho) return { who: null, amp: 0 } as const;
  return voiceNow({ ...sc.levels(), muted: s.muted, switching: !!s.switching, soft });
}

export function CallStage({ host, mac }: { host: DesktopCallHost; mac: boolean }) {
  const t = useTr();
  const { scene, controller: ctl } = host;
  const [ho, setHo] = useState<Handoff | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const root = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const av = useRef<HTMLDivElement>(null);
  const hoScene = useRef<CallScene | null>(null);

  const snap = useSticky(scene, x => onStage(x.state.phase));
  const sc = ho ? hoScene.current : snap;
  const visible = (!!scene && onStage(scene.state.phase) && !scene.state.mini) || (!!ho && ho.step !== 'out');
  const now = useTick(visible);
  const L = stageLayout(size.w, size.h);

  // O canvas acompanha o tamanho real do painel.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pro celular: varre 1,2 s → "Continua no …" (1,3 s) → volta à conversa (3,2 s). Se o celular não
  // assumiu (a chamada segue ativa aqui), o palco volta à chamada.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useEffect(() => {
    if (!ho || ho.step === 'out') return;
    const h = ho.step === 'go'
      ? setTimeout(() => setHo(x => (x ? { ...x, step: 'done' } : x)), HANDOFF.doneMs)
      : setTimeout(() => {
        if (sceneRef.current?.state.phase === 'active') setHo(null);
        else setHo(x => (x ? { ...x, step: 'out' } : x));
      }, HANDOFF.closeMs - HANDOFF.doneMs);
    return () => clearTimeout(h);
  }, [ho]);
  // Próxima chamada no palco: esquece a passagem anterior.
  useEffect(() => { if (ho?.step === 'out' && scene && onStage(scene.state.phase)) setHo(null); }, [ho, scene]);

  const phase = scene?.state.phase;
  useEffect(() => { if (phase !== 'active') setAudioOpen(false); }, [phase]);

  // Esc fecha a caixa das palavras ou o popover de áudio.
  const wordsOpen = !!scene && scene.state.phase === 'active' && scene.state.wordsOpen && !ho;
  useEffect(() => {
    if (!visible) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (wordsOpen) ctl.dispatch({ type: 'closeWords' });
      else setAudioOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [visible, wordsOpen, ctl]);

  // Desenho de cada quadro (protótipo `draw()`), só com o palco à vista.
  const drawRef = useRef({ sc, ho, L });
  drawRef.current = { sc, ho, L };
  useFrame(visible, tSec => {
    const { sc: cur, ho: h, L: lay } = drawRef.current;
    const c = cv.current, ctx = c?.getContext('2d');
    if (!cur || !c || !ctx) return;
    const g = lay.g, W = g.width, H = g.height, s = cur.state, ph = s.phase, nowMs = Date.now();
    const soft = cur.soft || motionOff();
    const hoP = h ? (h.step === 'go' ? Math.min(1, (nowMs - h.at) / HANDOFF.sweepMs) : 1) : 0;
    const { amp } = ampOf(cur, soft, !!h);
    const ep = ph === 'ending' && s.endedAt !== undefined ? Math.min(1, (nowMs - s.endedAt) / 1000 / END_SECONDS) : 0;
    const f: FrameInput = {
      ringing: ph === 'calling', speed: 0.7, active: ph === 'active',
      sinceConnect: s.connectedAt !== undefined ? (nowMs - s.connectedAt) / 1000 : Infinity,
      endProgress: ep, amp, switching: !!s.switching, soft, handoff: hoP,
    };
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let gx = 9; gx < W; gx += g.grid) for (let gy = 9; gy < H; gy += g.grid) {
      const a = dotAlpha(g, f, tSec, gx, gy);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(gx, gy, dotRadius(a), 0, 6.2832); ctx.fill();
    }
    ctx.lineWidth = 1.5;
    if (f.ringing) for (const r of rings(g, tSec, f.speed)) {
      ctx.strokeStyle = `rgba(255,255,255,${r.alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, r.r, 0, 6.2832); ctx.stroke();
    }
    if (ph === 'active' || ph === 'ending') {
      const k = (ph === 'ending' ? Math.pow(1 - ep, 2) : 1) * (1 - hoP);
      for (const layer of [0, 1] as const) {
        const pts = contour(g, tSec, amp, layer, k);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = `rgba(255,255,255,${CONTOUR_STYLE[layer].fill})`; ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${(CONTOUR_STYLE[layer].stroke * k).toFixed(3)})`; ctx.stroke();
      }
    }
    const fa = flashAlpha(f);
    if (fa > 0) { ctx.fillStyle = `rgba(255,255,255,${fa.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    const a = av.current;
    if (a) {
      const k = avatarScale({ incoming: false, active: ph === 'active', amp, t: tSec, endProgress: ep, handoff: hoP });
      a.style.transform = `translateX(${(hoP * 380).toFixed(1)}px) scale(${k.toFixed(3)})`;
      a.style.opacity = String(ph === 'ending' ? 1 - ep : 1 - hoP);
    }
  });
  // Fora do palco, a malha some de uma vez (o protótipo limpa o canvas ao desligar).
  useEffect(() => {
    if (visible) return;
    const c = cv.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }, [visible]);

  const s: CallState | undefined = sc?.state;
  const ph = s?.phase;
  const toPhone = () => {
    if (!scene || scene.state.phase !== 'active') return;
    hoScene.current = scene;
    setAudioOpen(false);
    setHo({ step: 'go', at: Date.now() });
    host.onHandoff?.();
  };
  const act = (id: ControlId) => {
    if (id === 'mute') ctl.dispatch({ type: 'mute' });
    else if (id === 'audio') setAudioOpen(o => !o);
    else if (id === 'words') { setAudioOpen(false); ctl.dispatch({ type: 'openWords' }); }
    else if (id === 'toPhone') toPhone();
    else if (id === 'chat') { setAudioOpen(false); ctl.dispatch({ type: 'minimize' }); }
  };

  const soft = !!sc && (sc.soft || motionOff());
  const who = sc ? ampOf(sc, soft, !!ho).who : null;
  const lines = s && sc ? callLines(t, s, sc.contact, now, who) : { status: '', speak: '' };
  const enc = s ? encChip(t, s) : null;
  const rc = s ? routeChip(t, s, sc?.latencyMs) : null;
  const ctl5 = s && (ph === 'calling' || ph === 'active') && !ho ? controls(t, s, { desktop: true, audioOpen, phoneName: host.phoneName, keys: { mute: callKeyLabel('mute', mac) } }) : [];
  const devOpen = audioOpen && ph === 'active' && !ho;
  const words = sc?.words ?? null;

  return (
    <div ref={root} role="region" aria-label={t('call.voice')} aria-hidden={!visible} inert={!visible}
      style={{ position: 'absolute', inset: 0, zIndex: 4, background: '#0c0c0c', color: '#fff', fontFamily: F, opacity: visible ? 1 : 0, transform: `scale(${visible ? 1 : 1.04})`, pointerEvents: visible ? 'auto' : 'none', transition: `opacity .45s ${ENTER},transform .6s ${ENTER}`, overflow: 'hidden' }}>
      <canvas ref={cv} width={L.g.width * 2} height={L.g.height * 2} style={{ position: 'absolute', left: 0, top: 0, width: L.g.width, height: L.g.height }} />
      {sc && s && enc && rc && (
        <>
          <div style={{ position: 'absolute', top: 22, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <span style={{ height: 30, padding: '0 12px', borderRadius: 15, background: 'rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 550 }}><Sym name={enc.icon} size={15} />{enc.text}</span>
            {ph === 'active' && (
              <span style={{ height: 30, padding: '0 12px', borderRadius: 15, boxShadow: '0 0 0 1px rgba(255,255,255,.18) inset', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 550 }}>
                <Sym name={rc.icon} size={15} />{rc.text}{rc.q && <span style={{ fontFamily: FM, opacity: .6 }}>{rc.q}</span>}
              </span>
            )}
          </div>
          <div ref={av} style={{ position: 'absolute', left: L.avatar.left, top: L.avatar.top, width: 120, height: 120, borderRadius: 60, background: '#fff', color: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 700, letterSpacing: '-0.04em' }}>{sc.contact.initials}</div>
          <div style={{ position: 'absolute', top: L.textTop, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1 }}>{sc.contact.name}</span>
            <span role="status" style={{ font: `500 14px ${FM}`, opacity: .7, minHeight: 20 }}>{lines.status}</span>
            <span style={{ fontSize: 13.5, opacity: .6, minHeight: 20 }}>{ho ? '' : lines.speak}</span>
          </div>

          {ctl5.length > 0 && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 14 }}>
              {ctl5.map(k => (
                <button key={k.id} onClick={() => act(k.id)} title={k.tip} aria-pressed={k.id === 'mute' || k.id === 'audio' ? k.on : undefined}
                  style={{ border: 'none', background: 'none', padding: 0, color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontSize: 12, width: 76 }}>
                  <span className="h-s106" style={{ width: 56, height: 56, borderRadius: 28, background: k.on ? '#fff' : 'rgba(255,255,255,.12)', color: k.on ? '#0c0c0c' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .25s,color .25s' }}><Sym name={k.icon} size={24} /></span>{k.label}
                </button>
              ))}
              <button className="a-94" onClick={() => ctl.hangup()} title={t('call.tip.hangup', { keys: callKeyLabel('hangup', mac) })}
                style={{ height: 56, margin: '0 0 28px 10px', padding: '0 24px 0 20px', border: 'none', borderRadius: 28, background: '#fff', color: '#0c0c0c', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 650, boxShadow: '0 10px 30px -8px rgba(255,255,255,.3)' }}>
                <Sym name="call_end" size={24} fill={1} />{t('call.ctl.hangup')}
              </button>
            </div>
          )}

          <AudioPopover host={host} open={devOpen} left={L.audioLeft} />

          <div onClick={() => ctl.dispatch({ type: 'closeWords' })} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', opacity: wordsOpen ? 1 : 0, pointerEvents: wordsOpen ? 'auto' : 'none', transition: 'opacity .3s' }} />
          <div role="dialog" aria-modal="true" aria-label={t('call.words.label')} inert={!wordsOpen}
            style={{ position: 'absolute', left: '50%', top: '50%', width: 440, marginLeft: -220, marginTop: -190, padding: '26px 24px 24px', borderRadius: 28, background: '#1c1c1c', boxShadow: '0 0 0 1px rgba(255,255,255,.08),0 30px 60px -20px rgba(0,0,0,.7)', display: 'flex', flexDirection: 'column', gap: 16, opacity: wordsOpen ? 1 : 0, transform: `scale(${s.wordsOpen ? 1 : .92})`, pointerEvents: wordsOpen ? 'auto' : 'none', transition: `opacity .3s,transform .45s ${BOUNCE}` }}>
            <span style={{ font: `500 11.5px ${FM}`, letterSpacing: '.08em', opacity: .6 }}>{t('call.words.label')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>{t('call.words.titleDesktop', { first: sc.contact.first })}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} className="sel" style={{ height: 60, borderRadius: 16, background: 'rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, font: `600 18px ${FM}` }}>
                  <span style={{ fontSize: 10, opacity: .45 }}>{i + 1}</span>{words?.[i] ?? '…'}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 13.5, opacity: .65, lineHeight: 1.45 }}>{t('call.words.body')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="a-97" onClick={() => ctl.dispatch({ type: 'wordsMatch' })} style={{ flex: 1, height: 48, border: 'none', borderRadius: 24, background: '#fff', color: '#0c0c0c', fontSize: 14.5, fontWeight: 650, cursor: 'pointer' }}>{t('call.words.same')}</button>
              <button className="a-97" onClick={() => ctl.wordsDiffer()} style={{ flex: 1, height: 48, border: 'none', borderRadius: 24, background: 'transparent', boxShadow: '0 0 0 1px rgba(255,255,255,.3) inset', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>{t('call.words.different')}</button>
            </div>
          </div>

          <div aria-hidden={!ho || ho.step === 'go'} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0c0c0c', opacity: ho && ho.step !== 'go' ? 1 : 0, pointerEvents: 'none', transition: 'opacity .5s' }}>
            <span style={{ width: 88, height: 88, borderRadius: 28, background: '#fff', color: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="phonelink_ring" size={44} wght={300} /></span>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('call.handoff.title', { device: host.phoneName ?? '' })}</span>
            <span style={{ fontSize: 14, opacity: .65 }}>{t('call.handoff.sub', { first: sc.contact.first })}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Popover "Áudio": microfone e saída, com check no escolhido. */
function AudioPopover({ host, open, left }: { host: DesktopCallHost; open: boolean; left: number }) {
  const t = useTr();
  const d = host.devices;
  const row = (kind: 'mic' | 'out', x: AudioDevice, on: boolean, pick: () => void) => (
    <button key={kind + x.id} onClick={pick} aria-pressed={on}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: 'none', borderRadius: 12, background: on ? 'rgba(255,255,255,.08)' : 'transparent', color: '#fff', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
      <Sym name={deviceIcon(kind, x)} size={18} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.label}</span><Sym name="check" size={18} style={{ opacity: on ? 1 : 0 }} />
    </button>
  );
  // Sem lista do sistema: uma linha "Padrão do sistema" marcada.
  const list = (kind: 'mic' | 'out', xs: AudioDevice[], cur: string, pick: (id: string) => void) =>
    xs.length ? xs.map(x => row(kind, x, x.id === cur, () => pick(x.id))) : [row(kind, { id: 'default', label: t('call.dev.default') }, true, () => {})];
  const head = (k: string) => <span style={{ padding: '8px 10px 4px', font: `500 10.5px ${FM}`, letterSpacing: '.06em', opacity: .55 }}>{t(k)}</span>;
  return (
    <div role="menu" aria-label={t('call.tip.audio')} inert={!open}
      style={{ position: 'absolute', left, bottom: 132, width: 300, padding: 8, borderRadius: 20, background: '#1c1c1c', boxShadow: '0 0 0 1px rgba(255,255,255,.1),0 20px 40px -10px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 2, opacity: open ? 1 : 0, transform: `translateY(${open ? 0 : 10}px)`, pointerEvents: open ? 'auto' : 'none', transition: `opacity .2s,transform .3s ${ENTER}` }}>
      {head('call.dev.mic')}
      {list('mic', d.mics, d.mic, id => d.onMic(id))}
      {head('call.dev.out')}
      {list('out', d.outs, d.out, id => d.onOut(id))}
    </div>
  );
}
