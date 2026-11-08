/**
 * Aviso de chamada recebida: escuro, 360 px, canto superior direito da janela (translateX 400 → 0 em
 * .55 s com quique), anel pulsando no avatar, "Tocando também no …" com celular vinculado e
 * Recusar/Atender num clique. Se o celular atende, vira "Atendida no … · O computador parou de tocar"
 * e some em 2,4 s. Um pedido de chamada pela malha (fase reqIn) usa o mesmo aviso: Mais tarde / Posso agora.
 */
import { useEffect, useRef, useState } from 'react';
import { routeVia } from '../../../../mobile/src/calls/callView';
import { noteRing } from '../../../../mobile/src/calls/callVisual';
import { F, Sym } from '../ui';
import { callKeyLabel, ELSEWHERE_MS } from './callDesktop';
import { type DesktopCallHost, useFrame, useSticky, useTr } from './CallContext';

export function CallNote({ host, mac, top }: { host: DesktopCallHost; mac: boolean; top: number }) {
  const t = useTr();
  const { scene, controller: ctl } = host;
  const ph = scene?.state.phase;
  const ringing = ph === 'ringing' || ph === 'reqIn';
  const sc = useSticky(scene, x => x.state.phase === 'ringing' || x.state.phase === 'reqIn');
  const [phoneShow, setPhoneShow] = useState(false);
  const el = host.elsewhere;
  useEffect(() => {
    if (!el) return;
    const left = el.at + ELSEWHERE_MS - Date.now();
    if (left <= 0) return;
    setPhoneShow(true);
    const h = setTimeout(() => setPhoneShow(false), left);
    return () => clearTimeout(h);
  }, [el]);
  const phone = phoneShow && !ringing;
  const show = ringing || phone;
  const ring = useRef<HTMLSpanElement>(null);
  useFrame(show, tSec => {
    const r = ring.current;
    if (!r) return;
    const p = noteRing(tSec);
    r.style.transform = `scale(${p.scale.toFixed(3)})`;
    r.style.opacity = phone ? '0' : String(p.alpha);
  });

  const s = sc?.state;
  const reqIn = s?.phase === 'reqIn';
  const c = sc?.contact;
  const sub = !s || !c ? '' : reqIn ? t('call.req.body') : phone ? t('call.note.answeredOn', { device: el?.device ?? '' }) : t('call.incoming.banner', { via: routeVia(t, s.route) });
  const dev = phone ? { icon: 'phonelink_ring', text: t('call.note.stopped') } : !reqIn && host.phoneName ? { icon: 'devices', text: t('call.note.ringingAlso', { device: host.phoneName }) } : null;
  const btn = { flex: 1, height: 44, border: 'none', borderRadius: 22, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } as const;

  return (
    // Fora da tela o aviso fica 400 px à direita: o recorte (overflow-x: clip) impede que ele faça a janela rolar de lado.
    <div style={{ position: 'absolute', top: top + 12, right: 0, zIndex: 60, width: 440, overflowX: 'clip', pointerEvents: 'none', display: 'flex', justifyContent: 'flex-end' }}>
    <div role="alertdialog" aria-label={c ? (reqIn ? t('call.req.title', { name: c.name }) : `${c.name} · ${t('call.voice')}`) : undefined} aria-hidden={!show} inert={!show}
      style={{ marginRight: 14, pointerEvents: 'auto', width: 360, padding: 16, borderRadius: 22, background: '#0c0c0c', color: '#fff', fontFamily: F, boxShadow: '0 24px 48px -14px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', gap: 14, transform: `translateX(${show ? 0 : 400}px)`, transition: 'transform .55s cubic-bezier(.3,1.35,.5,1)' }}>
      {c && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ position: 'relative', width: 48, height: 48, flex: 'none' }}>
              <span ref={ring} style={{ position: 'absolute', inset: 0, borderRadius: 24, boxShadow: '0 0 0 2px rgba(255,255,255,.5)', opacity: 0 }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: 24, background: '#fff', color: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{c.initials}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15.5, fontWeight: 650 }}>{reqIn ? t('call.req.title', { name: c.name }) : c.name}</span>
              <span style={{ fontSize: 12.5, opacity: .65, lineHeight: reqIn ? 1.4 : undefined }}>{sub}</span>
            </span>
          </div>
          {dev && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.08)', fontSize: 12, opacity: .85 }}>
              <Sym name={dev.icon} size={16} />{dev.text}
            </div>
          )}
          {!phone && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="a-97" onClick={() => (reqIn ? ctl.dispatch({ type: 'requestLater' }) : ctl.decline())} title={t('call.tip.decline', { keys: callKeyLabel('decline', mac) })}
                style={{ ...btn, background: 'rgba(255,255,255,.14)', color: '#fff', fontWeight: 600 }}>
                <Sym name={reqIn ? 'schedule' : 'call_end'} size={19} fill={1} />{reqIn ? t('call.req.later') : t('call.decline')}
              </button>
              <button className="a-97" onClick={() => (reqIn ? ctl.requestNow() : ctl.answer())} title={t('call.tip.answer', { keys: callKeyLabel('answer', mac) })}
                style={{ ...btn, background: '#fff', color: '#0c0c0c', fontWeight: 650 }}>
                <Sym name="call" size={19} fill={1} />{reqIn ? t('call.req.now') : t('call.answer')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </div>
  );
}
