/**
 * Chamada minimizada ("Conversas"): cartão flutuante de 300 px no canto inferior direito do painel,
 * com avatar, nome, barras de áudio, cronômetro, mudo e desligar. Clicar no cartão volta à chamada.
 */
import { useRef } from 'react';
import { fmtDuration } from '../../../../mobile/src/calls/callMachine';
import { barHeight, voiceNow } from '../../../../mobile/src/calls/callVisual';
import { FM, motionOff, Sym } from '../ui';
import { callKeyLabel } from './callDesktop';
import { type DesktopCallHost, useFrame, useSticky, useTick, useTr } from './CallContext';

export function CallMini({ host, mac }: { host: DesktopCallHost; mac: boolean }) {
  const t = useTr();
  const { scene, controller: ctl } = host;
  const open = !!scene && scene.state.phase === 'active' && scene.state.mini;
  const sc = useSticky(scene, x => x.state.phase === 'active');
  const now = useTick(open);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const scRef = useRef(sc);
  scRef.current = sc;
  useFrame(open, tSec => {
    const cur = scRef.current;
    if (!cur) return;
    const s = cur.state;
    const { amp } = voiceNow({ ...cur.levels(), muted: s.muted, switching: !!s.switching, soft: cur.soft || motionOff() });
    bars.current.forEach((b, i) => { if (b) b.style.height = barHeight(i, tSec, amp, 3, 11).toFixed(1) + 'px'; });
  });
  const s = sc?.state;
  const restore = () => ctl.dispatch({ type: 'restore' });

  return (
    <div role="button" tabIndex={open ? 0 : -1} aria-label={sc ? `${sc.contact.name} · ${t('call.voice')}` : undefined} inert={!open}
      onClick={restore} onKeyDown={e => { if (e.key === 'Enter') restore(); }}
      style={{ position: 'absolute', right: 20, bottom: 84, zIndex: 7, width: 300, padding: 12, borderRadius: 22, background: '#0c0c0c', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', boxShadow: '0 20px 40px -12px rgba(0,0,0,.45)', transform: `translateY(${open ? 0 : 30}px) scale(${open ? 1 : .9})`, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'transform .5s cubic-bezier(.3,1.35,.5,1),opacity .3s' }}>
      {sc && s && (
        <>
          <span style={{ width: 44, height: 44, borderRadius: 22, background: '#fff', color: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flex: 'none' }}>{sc.contact.initials}</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sc.contact.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14 }}>
                {[0, 1, 2, 3, 4].map(i => <span key={i} ref={el => { bars.current[i] = el; }} style={{ width: 3, height: 4, borderRadius: 2, background: '#fff' }} />)}
              </span>
              <span style={{ font: `500 12px ${FM}`, opacity: .7 }}>{fmtDuration(now - (s.connectedAt ?? now))}</span>
            </span>
          </span>
          <button onClick={e => { e.stopPropagation(); ctl.dispatch({ type: 'mute' }); }} title={t('call.tip.mute', { keys: callKeyLabel('mute', mac) })} aria-pressed={s.muted}
            style={{ width: 38, height: 38, border: 'none', borderRadius: 19, background: s.muted ? '#fff' : 'rgba(255,255,255,.14)', color: s.muted ? '#0c0c0c' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'background .25s,color .25s' }}>
            <Sym name={s.muted ? 'mic_off' : 'mic'} size={19} />
          </button>
          <button onClick={e => { e.stopPropagation(); ctl.hangup(); }} title={t('call.tip.hangup', { keys: callKeyLabel('hangup', mac) })}
            style={{ width: 38, height: 38, border: 'none', borderRadius: 19, background: '#fff', color: '#0c0c0c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Sym name="call_end" size={19} fill={1} />
          </button>
        </>
      )}
    </div>
  );
}
