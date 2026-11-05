import { createPortal } from 'react-dom';
import { useT } from '../i18n/react';
import { useStore } from '../state/store';
import { Icon, useEscape } from './ui';

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div key={toast.seq} role="status" aria-live="polite" className="toast" style={{ position: 'fixed', right: 24, bottom: 24, width: 380, zIndex: 50, borderRadius: 18, background: 'var(--ink)', color: 'var(--invink)', padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 20px 50px rgba(0,0,0,.3)', animation: 'piuToast .4s cubic-bezier(.2,.9,.3,1.15) both' }}>
      <Icon name={toast.icon} size={22} style={{ display: 'inline-block', animation: 'piuPop .4s .1s var(--ease-pop) both' }} />
      <div className="col grow" style={{ gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>{toast.title}</div>
        <div style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.35 }}>{toast.body}</div>
      </div>
    </div>
  );
}

export interface DialogProps {
  icon: string; title: string; body: string; code?: string; waiting?: boolean;
  primaryLabel: string; onPrimary: () => void; onClose: () => void;
}

/** Diálogo de confirmação 420px (assinatura no celular, revogação). */
export function Dialog({ icon, title, body, code, waiting, primaryLabel, onPrimary, onClose }: DialogProps) {
  const t = useT();
  useEscape(true, onClose);
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45, animation: 'piuFade .2s ease-out both' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="dlg" style={{ position: 'fixed', left: '50%', top: '50%', width: 420, marginLeft: -210, transform: 'translateY(-50%)', zIndex: 46 }}>
        <div className="col" style={{ borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '28px 24px 20px', alignItems: 'center', gap: 14, textAlign: 'center', animation: 'piuDialog .3s cubic-bezier(.2,.9,.3,1.2) both' }}>
          <div style={{ position: 'relative', width: 62, height: 62 }}>
            {waiting && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 1.8s ease-out infinite' }} />}
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .4s .05s var(--ease-pop) both' }}>
              <Icon name={icon} size={30} wght={300} />
            </div>
          </div>
          <div id="dlg-title" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.025em' }}>{title}</div>
          <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{body}</div>
          {code && <div className="mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '.08em', padding: '8px 0' }}>{code}</div>}
          <div className="col" style={{ gap: 8, width: '100%', marginTop: 6 }}>
            <button type="button" className="btn btn-primary" autoFocus onClick={onPrimary} style={{ height: 48, borderRadius: 24, fontSize: 15 }}>{primaryLabel}</button>
            <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 44, borderRadius: 22, fontSize: 14.5 }}>{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
