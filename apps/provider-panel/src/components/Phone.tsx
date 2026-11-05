import { type FormEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/react';
import { QrCode } from './QrCode';
import { Icon, useEscape } from './ui';

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

function Shell({ title, body, onClose, children }: { title: string; body: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(true, onClose);
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45, animation: 'piuFade .2s ease-out both' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="phone-title" className="dlg" style={{ position: 'fixed', left: '50%', top: '50%', width: 460, marginLeft: -230, transform: 'translateY(-50%)', zIndex: 46 }}>
        <div className="col" style={{ borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '28px 24px 20px', alignItems: 'center', gap: 14, textAlign: 'center', animation: 'piuDialog .3s cubic-bezier(.2,.9,.3,1.2) both' }}>
          <div style={{ position: 'relative', width: 62, height: 62 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 1.8s ease-out infinite' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="smartphone" size={30} wght={300} /></div>
          </div>
          <div id="phone-title" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.025em' }}>{title}</div>
          <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{body}</div>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * "Confirme no seu celular" (design) com o pedido real: o celular pareado lê o QR, mostra o mesmo
 * código e, depois da biometria, mostra o código de aprovação que a pessoa digita aqui.
 */
export function ApproveOnPhone({ request, code, phone, body, onApprove, onClose }: {
  request: string; code: string; phone: string; body: string; onApprove: (approval: string) => Promise<string | null>; onClose: () => void;
}) {
  const t = useT();
  const [approval, setApproval] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = approval.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (clean.length !== 16 || busy) return;
    setBusy(true);
    const problem = await onApprove(clean);
    setBusy(false);
    if (problem) setErr(problem);
  };
  return (
    <Shell title={t('phone.approveTitle')} body={t('phone.approveBody', { body, phone })} onClose={onClose}>
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <QrCode value={request} size={132} label={t('phone.qrTransfer')} />
        <div className="col" style={{ gap: 4, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{t('phone.checkCode')}</span>
          <span className="mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '.08em' }} aria-label={t('phone.codeAria', { code: code.split('').join(' ') })}>{spaced(code)}</span>
          <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{t('phone.valid5')}</span>
        </div>
      </div>
      <form onSubmit={submit} className="col" style={{ gap: 8, width: '100%', marginTop: 6 }}>
        <label className="col" style={{ gap: 6, textAlign: 'left' }}>
          <span style={{ fontSize: 13, fontWeight: 550 }}>{t('phone.approvalLabel')}</span>
          <input value={approval} onChange={e => { setApproval(e.target.value); setErr(null); }} autoFocus spellCheck={false} autoComplete="off" maxLength={24} placeholder="XXXX XXXX XXXX XXXX"
            className="mono" aria-invalid={!!err} style={{ height: 46, padding: '0 14px', borderRadius: 14, border: 'none', background: 'var(--bg2)', fontSize: 17, letterSpacing: '.08em', color: 'var(--ink)', outline: 'none', boxShadow: `0 0 0 1px ${err ? 'var(--ink)' : 'var(--line2)'} inset` }} />
        </label>
        {err && <div role="alert" style={{ fontSize: 13, textAlign: 'left' }}>{err}</div>}
        <button type="submit" className="btn btn-primary" disabled={clean.length !== 16 || busy} style={{ height: 48, borderRadius: 24, fontSize: 15, opacity: clean.length === 16 ? 1 : 0.4 }}>{busy ? t('common.checking') : t('phone.finish')}</button>
        <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 44, borderRadius: 22, fontSize: 14.5 }}>{t('common.cancel')}</button>
      </form>
    </Shell>
  );
}

/** Parear um celular que aprova transferências: QR com o segredo + código de 6 dígitos de volta. */
export function PairPhone({ qr, onConfirm, onClose }: { qr: string; onConfirm: (code: string) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    const problem = await onConfirm(code);
    if (problem) { setErr(problem); setCode(''); }
  };
  return (
    <Shell title={t('phone.pairTitle')} body={t('phone.pairBody')} onClose={onClose}>
      <QrCode value={qr} size={168} label={t('phone.qrPair')} />
      <form onSubmit={submit} className="col" style={{ gap: 8, width: '100%' }}>
        <input value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null); }} inputMode="numeric" autoFocus aria-label={t('phone.code6Aria')}
          placeholder="000 000" className="mono" style={{ height: 50, textAlign: 'center', borderRadius: 14, border: 'none', background: 'var(--bg2)', fontSize: 24, letterSpacing: '.1em', color: 'var(--ink)', outline: 'none' }} />
        {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
        <button type="submit" className="btn btn-primary" disabled={code.length !== 6} style={{ height: 48, borderRadius: 24, fontSize: 15, opacity: code.length === 6 ? 1 : 0.4 }}>{t('common.confirm')}</button>
        <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 44, borderRadius: 22, fontSize: 14.5 }}>{t('common.cancel')}</button>
      </form>
    </Shell>
  );
}
