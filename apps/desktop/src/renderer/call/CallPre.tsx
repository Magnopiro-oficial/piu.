/**
 * Caixa "pre" no centro do painel da conversa (420 px, escala .94 → 1 em .45 s com quique, fundo
 * escurecido .28). Modo direto: caminho, microfone com medidor de 4 barras (nível real) e "Chamar".
 * Modo malha (sem caminho ao vivo): "Pela malha · N saltos", explicação e "Enviar pedido de chamada".
 */
import { useEffect, useRef } from 'react';
import { ROUTE_ICON } from '../../../../mobile/src/calls/callView';
import { micBarHeight } from '../../../../mobile/src/calls/callVisual';
import { Sym } from '../ui';
import { type DesktopCallHost, useFrame, useSticky, useTr } from './CallContext';

const BOUNCE = 'cubic-bezier(.3,1.35,.5,1)';

export function CallPre({ host }: { host: DesktopCallHost }) {
  const t = useTr();
  const { scene, controller: ctl, devices } = host;
  const open = scene?.state.phase === 'pre';
  const sc = useSticky(scene, x => x.state.phase === 'pre');
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const close = () => ctl.dispatch({ type: 'closePre' });

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') ctl.dispatch({ type: 'closePre' }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, ctl]);
  useFrame(open && !!sc?.state.preRoute, tSec => {
    const lv = Math.max(0, Math.min(1, devices.micLevel()));
    bars.current.forEach((b, i) => { if (b) b.style.height = micBarHeight(i, tSec, lv).toFixed(1) + 'px'; });
  });

  const route = sc?.state.preRoute ?? null;
  const c = sc?.contact;
  const ms = sc?.latencyMs !== undefined ? t('call.ms', { ms: Math.round(sc.latencyMs) }) : null;
  const sub = route === 'bt' ? t('call.pre.bt.sub') : route === 'point' ? t('call.pre.point.sub') : ms ? t('call.pre.direct.sub', { ms }) : t('call.pre.direct.subNoQ');
  const micName = devices.mics.find(m => m.id === devices.mic)?.label ?? t('call.dev.default');

  return (
    <>
      <div onClick={close} style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,.28)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .3s' }} />
      <div role="dialog" aria-modal="true" aria-label={t('call.voice')} inert={!open}
        style={{ position: 'absolute', left: '50%', top: '50%', zIndex: 6, width: 420, marginLeft: -210, marginTop: -200, padding: 24, borderRadius: 28, background: 'var(--bg)', color: 'var(--ink)', boxShadow: '0 0 0 1px var(--line2),0 30px 60px -20px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', gap: 16, opacity: open ? 1 : 0, transform: `scale(${open ? 1 : .94})`, pointerEvents: open ? 'auto' : 'none', transition: `opacity .25s,transform .45s ${BOUNCE}` }}>
        {c && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 650, flex: 'none' }}>{c.initials}</span>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('call.voice')}</span>
              </span>
            </div>
            {route ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, background: 'var(--bg2)' }}>
                  <span style={{ width: 42, height: 42, borderRadius: 21, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={ROUTE_ICON[route]} size={21} /></span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 650 }}>{t(`call.route.${route}`)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{sub}</span>
                  </span>
                </div>
                <div aria-label={t('call.pre.mic')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 18, boxShadow: '0 0 0 1px var(--line2) inset' }}>
                  <Sym name="headphones" size={20} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{micName}</span>
                  <span aria-hidden="true" style={{ display: 'flex', gap: 2, alignItems: 'center', height: 16 }}>
                    {[0, 1, 2, 3].map(i => <span key={i} ref={el => { bars.current[i] = el; }} style={{ width: 3, height: 4, borderRadius: 2, background: 'var(--ink)' }} />)}
                  </span>
                </div>
                <button className="a-97" onClick={() => ctl.dial()} style={{ height: 52, border: 'none', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', fontSize: 15.5, fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Sym name="call" size={21} fill={1} />{t('call.callName', { first: c.first })}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 18, background: 'var(--bg2)' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sym name="hub" size={19} />{sc?.hops ? t('call.pre.mesh.title', { hops: sc.hops }) : t('call.pre.mesh.titleNoHops')}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('call.pre.mesh.bodyDesktop')}</span>
                </div>
                <button className="a-97" onClick={() => ctl.sendRequest()} style={{ height: 52, border: 'none', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', fontSize: 15.5, fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Sym name="schedule_send" size={21} />{t('call.pre.sendRequest')}
                </button>
                <button className="a-97" onClick={close} style={{ height: 46, border: 'none', borderRadius: 23, background: 'var(--bg2)', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>{t('common.cancel')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
