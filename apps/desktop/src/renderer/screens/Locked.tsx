/**
 * Cofre bloqueado (A-01): o Keychain/chaveiro recusou abrir as chaves guardadas (ou a frase não abriu).
 * Nada foi recriado nem apagado; a pessoa libera o acesso no sistema e toca em "Tentar de novo".
 * Sem atalho para "criar identidade" aqui: isso sobrescreveria a frase guardada.
 */
import { useState } from 'react';
import type { SessionInfo } from '../../shared/types';
import { useT } from '../i18n';
import { F, FM, Sym } from '../ui';

export function Locked({ session, onSession, toast }: { session: SessionInfo; onSession: (s: SessionInfo) => void; toast: (text: string, icon?: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const mac = session.platform === 'darwin';
  const where = mac ? t('app.vault.where.mac') : session.platform === 'win32' ? t('app.vault.where.win') : t('app.vault.where.linux');
  const retry = async () => {
    setBusy(true);
    try {
      const s = await window.piu.retryVault();
      onSession(s);
      if (s.state === 'locked') toast(t('app.vault.stillLocked'), 'lock');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, animation: 'piuReveal .6s cubic-bezier(.2,.85,.3,1) both' }}>
      <div style={{ width: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="lock" size={40} wght={300} /></div>
        <div style={{ font: `500 12px ${FM}`, letterSpacing: '.06em', color: 'var(--ink2)' }}>{t('app.vault.kicker')}</div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1 }}>{t('app.vault.title')}</div>
        <div style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.45 }}>{session.lockedReason ?? t('app.vault.reason')}</div>
        <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', background: 'var(--side)', fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>
          {t('app.vault.hint', { where })}
        </div>
        <button className="a-98" onClick={() => void retry()} disabled={busy} style={{ height: 50, padding: '0 28px', border: 'none', borderRadius: 25, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>{busy ? t('app.vault.opening') : t('app.retry')}</button>
      </div>
    </div>
  );
}
