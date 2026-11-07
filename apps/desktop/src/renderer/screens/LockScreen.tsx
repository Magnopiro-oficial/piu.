/**
 * Piu bloqueado (Piu 12: E1 Touch ID · E1b sem Touch ID · E1c recusado ou erro · E1d motivo na linha
 * de baixo), do "Piu 12 Desktop briefing.dc.html". Estilos copiados do protótipo.
 * Adaptação honesta do E1b: o protótipo chama a "confirmação do próprio sistema", mas o Electron não
 * confere a senha do sistema; "Desbloquear" abre o campo da SENHA DO PIU (criada em Ajustes → Privacidade
 * → Bloqueio). No macOS com Touch ID, o Touch ID é o caminho principal (E1). Recusa, cancelamento ou
 * falha: o mesmo texto do E1c ("Não deu para confirmar que é você."); com a senha, também quantas
 * tentativas restam. Depois de 5 erros, a espera (D1x do Piu 10) continua.
 * Nada de nome nem conteúdo aqui.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppLockState } from '../../shared/types';
import icon192 from '../brand/icon-192.png';
import { fmtDate, t as tNow, useT } from '../i18n';
import { F, FM } from '../ui';

const MS = "'Material Symbols Rounded'";

function when(ms: number) {
  const d = new Date(ms), now = new Date();
  const time = fmtDate(d, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? tNow('common.today', { time }) : tNow('common.dateTime', { date: fmtDate(d, { day: 'numeric', month: 'short' }).replace('.', ''), time });
}
/** E1d: "Bloqueado ao suspender · hoje, 14:32", "15 min sem uso · hoje, 14:47", "Bloqueado por você · …". */
export function lockSubtitle(s: AppLockState) {
  const r = s.reason === 'suspend' ? tNow('app.lock.reason.suspend') : s.reason === 'idle' ? tNow('app.lock.reason.idle', { min: s.idleMin ?? '' }).trim() : s.reason === 'start' ? tNow('app.lock.reason.start') : tNow('app.lock.reason.you');
  return tNow('app.lock.subtitle', { reason: r, when: when(s.at) });
}
const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Botão pílula 44px do E1b/E1c (ícone lock_open). */
function Pill({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="a-97" onClick={onClick} disabled={disabled} style={{ height: 44, padding: '0 22px', border: 'none', borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: disabled ? .6 : 1 }}>
      <span style={{ fontFamily: MS, fontSize: 19, lineHeight: 1 }}>lock_open</span>{label}
    </button>
  );
}

/** E1c: linha de erro que chacoalha uma vez (0,45 s). `k` remonta para chacoalhar de novo. */
function Refused({ k, extra }: { k: number; extra?: string | null }) {
  const t = useT();
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, animation: 'piuShake .45s ease-in-out both' }}>
        <span style={{ fontFamily: MS, fontSize: 18, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>error</span>{t('app.lock.refused')}
      </div>
      {extra && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{extra}</div>}
    </div>
  );
}

export function LockScreen({ state, onState }: { state: AppLockState; links?: number; relay?: boolean; onState: (s: AppLockState) => void }) {
  const t = useT();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  /** Sem Touch ID (E1b): o campo da senha do Piu aparece depois de "Desbloquear". */
  const [usePassword, setUsePassword] = useState(false);
  /** E1c: recusa/cancelamento/erro; `extra` = tentativas restantes (senha). */
  const [refused, setRefused] = useState<{ n: number; extra: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const wait = state.wait && state.wait.until > now ? state.wait : null;
  const remaining = wait ? Math.min(wait.totalSec, Math.max(0, Math.ceil((wait.until - now) / 1000))) : 0;

  // Espera depois de 5 erros: o anel anda a cada segundo; acabou, pergunta o estado de novo.
  useEffect(() => {
    if (!state.wait) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= state.wait!.until) { clearInterval(t); void window.piu.appLockState().then(onState).catch(() => {}); }
    }, 1000);
    return () => clearInterval(t);
  }, [state.wait, onState]);
  useEffect(() => { if (usePassword && !wait) input.current?.focus(); }, [usePassword, wait, refused]);

  const fail = (extra: string | null) => setRefused(r => ({ n: (r?.n ?? 0) + 1, extra }));
  const submit = async () => {
    if (busy || !pw || wait) return;
    setBusy(true);
    try {
      const s = await window.piu.unlockApp(pw);
      onState(s);
      if (s.locked && s.last === 'wrong') fail(t('app.lock.wrong', { count: s.triesLeft }));
      else if (s.locked) fail(null);
    } catch { fail(null); }
    finally { setPw(''); setBusy(false); }
  };
  const touch = async () => {
    if (busy || wait) return;
    setBusy(true);
    try { const s = await window.piu.unlockApp(); onState(s); if (s.locked) fail(null); } catch { fail(null); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px', animation: 'piuFade .3s both' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, textAlign: 'center', width: 380 }}>
        <div style={{ position: 'relative', width: 84, height: 84 }}>
          <img src={icon192} alt="Piu" style={{ width: 84, height: 84, borderRadius: 22, display: 'block' }} />
          <div style={{ position: 'absolute', right: -8, bottom: -8, width: 34, height: 34, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg)' }}><span style={{ fontFamily: MS, fontSize: 18, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>lock</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.045em' }}>{t('app.lock.title')}</div>
          <div style={{ fontSize: 14.5, color: 'var(--ink2)' }}>{lockSubtitle(state)}</div>
        </div>

        {wait ? (
          // Espera (D1x): substitui o campo e pausa o Touch ID até acabar.
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }} role="status" aria-live="polite">
            <div style={{ position: 'relative', width: 92, height: 92, borderRadius: '50%', background: `conic-gradient(var(--ink) 0 ${(remaining / wait.totalSec) * 100}%,var(--bg3) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 22px ${F}`, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{fmtClock(remaining)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('app.lock.tooMany')}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{state.touchId ? t('app.lock.waitBodyTouch') : t('app.lock.waitBody')}</div>
            </div>
          </div>
        ) : state.touchId && !usePassword ? (
          // E1 (Touch ID) · E1c depois de recusa: a linha de erro e "Tentar de novo".
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 6 }}>
            {refused ? <>
              <Refused k={refused.n} />
              <Pill label={t('app.retry')} onClick={() => void touch()} disabled={busy} />
            </> : <>
              <button onClick={() => void touch()} disabled={busy} aria-label={t('app.lock.touchId')} style={{ position: 'relative', width: 72, height: 72, border: 'none', borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 2.4s ease-out infinite' }} />
                <span style={{ fontFamily: MS, fontSize: 34, lineHeight: 1, fontVariationSettings: "'wght' 300" }}>fingerprint</span>
              </button>
              <div style={{ fontSize: 14, fontWeight: 550 }}>{t('app.lock.touchId')}</div>
            </>}
            <button className="h-bg2" onClick={() => { setRefused(null); setUsePassword(true); }} style={{ height: 30, padding: '0 12px', border: 'none', borderRadius: 15, background: 'transparent', color: 'var(--ink2)', font: `550 12.5px ${F}`, cursor: 'pointer' }}>{t('app.lock.usePassword')}</button>
          </div>
        ) : !usePassword ? (
          // E1b (sem Touch ID: Linux, Windows, Mac sem sensor) · E1c.
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            {refused && <Refused k={refused.n} extra={refused.extra} />}
            <Pill label={refused ? t('app.retry') : t('app.lock.unlock')} onClick={() => { setRefused(null); setUsePassword(true); }} />
          </div>
        ) : (
          // "Desbloquear" → senha do Piu (o Electron não confere a do sistema). Errou: E1c + tentativas.
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {refused && <Refused k={refused.n} extra={refused.extra} />}
            <form onSubmit={e => { e.preventDefault(); void submit(); }} style={{ width: '100%' }}>
              <div style={{ height: 48, borderRadius: 14, background: refused ? 'var(--bg)' : 'var(--bg2)', boxShadow: refused ? '0 0 0 2px var(--ink) inset' : 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 14px' }}>
                <span style={{ fontFamily: MS, fontSize: 19, lineHeight: 1, color: 'var(--ink2)' }}>key</span>
                <input ref={input} type="password" value={pw} onChange={e => setPw(e.target.value)} disabled={busy} placeholder={t('app.lock.password')} aria-label={t('app.lock.password')} autoComplete="off" spellCheck={false}
                  style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: pw ? 20 : 14, letterSpacing: pw ? '.2em' : 'normal', color: 'var(--ink)', textAlign: 'left' }} />
                <button type="submit" disabled={busy || !pw} aria-label={t('app.lock.unlock')} style={{ width: 34, height: 34, border: 'none', borderRadius: 10, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: pw ? 1 : .4 }}>
                  <span style={{ fontFamily: MS, fontSize: 20, lineHeight: 1 }}>arrow_forward</span>
                </button>
              </div>
            </form>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
              {t('app.lock.confirmHint')}
              {state.touchId && <> · <button onClick={() => { setRefused(null); setUsePassword(false); }} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--ink)', font: `550 12.5px ${F}`, cursor: 'pointer' }}>{t('app.lock.useTouchId')}</button></>}
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 22, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `500 11.5px ${FM}`, color: 'var(--ink2)' }}>
          <div style={{ position: 'relative', width: 8, height: 8, flex: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />
          </div>
          {t('app.lock.mesh')}
        </div>
      </div>
    </div>
  );
}
