/**
 * Entrada (protótipo `isAuth`): coluna de texto à esquerda, palco à direita com órbitas.
 * Passos: start → qr (vínculo com o celular: QR real renovado a cada 30 s) → confirm (escolher a 3ª palavra) → app
 *        · create → work → app · phrase → work → app.
 * O trabalho real (gerar/derivar chaves, guardar no cofre) acontece junto com a animação de progresso.
 */
import { useEffect, useRef, useState } from 'react';
import type { IdentityKind, LinkState, SessionInfo } from '../../shared/types';
import { useT } from '../i18n';
import { F, FM, QrCard, Sym, useSecretScreen } from '../ui';

type Step = 'start' | 'qr' | 'confirm' | 'create' | 'phrase' | 'work';
type WorkKind = 'create' | 'restore';

export function Auth({ session, onEnter, toast }: { session: SessionInfo; onEnter: () => void; toast: (text: string, icon?: string) => void }) {
  const t = useT();
  const mac = session.platform === 'darwin';
  const keychain = mac ? t('auth.keychain.mac') : session.platform === 'win32' ? t('auth.keychain.win') : t('auth.keychain.other');
  const [step, setStepRaw] = useState<Step>('start');
  const [seq, setSeq] = useState(0);
  const [idType, setIdType] = useState<IdentityKind>('public');
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState<string[]>(Array(12).fill(''));
  const [link, setLink] = useState<LinkState>({ state: 'off' });
  const [qrLeft, setQrLeft] = useState(30);
  const [work, setWork] = useState<WorkKind>('create');
  const [workPct, setWorkPct] = useState(0);
  const [workDone, setWorkDone] = useState(false);
  const [workErr, setWorkErr] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const step_ = (s: Step) => { setStepRaw(s); setSeq(x => x + 1); };
  // QR/palavras do vínculo e frase digitada: sem captura de tela nessas etapas (M-02).
  useSecretScreen('link', step === 'qr' || step === 'confirm');
  useSecretScreen('phrase', step === 'phrase');

  // Vínculo com o celular: o processo principal sobe o servidor e renova o QR; aqui só o estado.
  useEffect(() => window.piu.on('link', s => {
    setLink(s);
    if (s.state === 'confirm') step_('confirm');
    if (s.state === 'linked') onEnter();
    if (s.state === 'dropped') { toast(s.reason, 'phonelink_off'); step_('qr'); void window.piu.linkStart().then(setLink).catch(e => toast((e as Error).message, 'error')); }
  }), [onEnter, toast]);
  useEffect(() => {
    if (step !== 'qr' && step !== 'confirm') { if (link.state !== 'off') void window.piu.linkCancel().then(setLink).catch(() => {}); return; }
    if (step === 'qr' && (link.state === 'off' || link.state === 'dropped')) void window.piu.linkStart().then(setLink).catch(e => { toast((e as Error).message, 'error'); step_('start'); });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (link.state !== 'waiting') return;
    const tick = () => setQrLeft(Math.max(0, Math.ceil(((link as { expiresAt: number }).expiresAt - Date.now()) / 1000)));
    tick();
    const i = setInterval(tick, 250);
    return () => clearInterval(i);
  }, [link]);

  /** Progresso como no protótipo (1,6 % a cada 40 ms) enquanto o trabalho real roda; só entra no app com os dois prontos. */
  const startWork = (kind: WorkKind, job: Promise<unknown>) => {
    setWork(kind); setWorkPct(0); setWorkDone(false); setWorkErr(null); step_('work');
    let pct = 0, realDone = false, failed: string | null = null;
    job.then(() => { realDone = true; }, e => { failed = (e as Error).message; });
    const i = setInterval(() => {
      if (failed) { clearInterval(i); setWorkErr(failed); return; }
      pct = Math.min(100, pct + 1.6);
      if (pct >= 100 && !realDone) pct = 99; // segura em 99 % até o cofre responder
      setWorkPct(pct);
      if (pct >= 100) { clearInterval(i); later(() => setWorkDone(true), 150); later(() => onEnter(), 1700); }
    }, 40);
    timers.current.push(i as unknown as ReturnType<typeof setTimeout>);
  };

  const nameOk = idType === 'anon' || name.trim().length > 0;
  const filled = phrase.every(w => w.trim());
  const createId = () => { if (!nameOk || !session.vaultSecure) return; startWork('create', window.piu.createIdentity({ kind: idType, name })); };
  const restore = () => { if (!filled || !session.vaultSecure) return; startWork('restore', window.piu.restoreIdentity({ phrase: phrase.map(w => w.trim().toLowerCase()), name: '' })); };
  const fillPhrase = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
      if (words.length !== 12) { toast(t('auth.toast.pasteNot12'), 'content_paste_off'); return; }
      words.forEach((w, i) => later(() => setPhrase(p => p.map((x, j) => (j === i ? w : x))), i * 70));
    } catch { toast(t('auth.toast.pasteFailed'), 'content_paste_off'); }
  };

  const workCopy = { create: [t('auth.work.create.eyebrow'), t('auth.work.create.title'), t('auth.work.create.desc')], restore: [t('auth.work.restore.eyebrow'), t('auth.work.restore.title'), t('auth.work.restore.desc')] }[work];
  const copy: Record<Step, string[]> = {
    start: [t('auth.start.eyebrow', { os: mac ? 'MAC' : session.platform === 'win32' ? 'WINDOWS' : 'LINUX' }), t('auth.start.title'), t('auth.start.desc')],
    qr: [t('auth.qr.eyebrow'), t('auth.qr.title'), t('auth.qr.desc')],
    confirm: [t('auth.confirm.eyebrow'), t('auth.confirm.title'), t('auth.confirm.desc')],
    create: [t('auth.create.eyebrow'), t('auth.create.title'), t('auth.create.desc')],
    phrase: [t('auth.phrase.eyebrow'), t('auth.phrase.title'), t('auth.phrase.desc')],
    work: workErr ? [workCopy[0]!, t('auth.work.failed'), workErr] : workDone ? [workCopy[0]!, work === 'create' ? t('auth.work.doneCreate') : t('auth.work.doneRestore'), workCopy[2]!] : workCopy,
  };
  const c = copy[step];
  const canBack = step !== 'start' && (step !== 'work' || !!workErr);
  const rows = { create: [['casino', t('auth.row.entropy')], ['key', t('auth.row.keypair')], ['enhanced_encryption', t('auth.row.storing', { keychain })], ['hub', t('auth.row.announce')]], restore: [['spellcheck', t('auth.row.checkWords')], ['key', t('auth.row.derive')], ['enhanced_encryption', t('auth.row.storing', { keychain })], ['hub', t('auth.row.announce')]] }[work];
  const burst = Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2, r = 80 + (i % 3) * 22; return { x: Math.round(Math.cos(a) * r) + 'px', y: Math.round(Math.sin(a) * r) + 'px', d: (i % 4) * 0.03 + 's' }; });
  const startOpts: [string, string, string, Step][] = [
    ['qr_code_scanner', t('auth.opt.qr.title'), t('auth.opt.qr.desc'), 'qr'],
    ['person_add', t('auth.opt.create.title'), t('auth.opt.create.desc'), 'create'],
    ['key', t('auth.opt.phrase.title'), t('auth.opt.phrase.desc'), 'phrase'],
  ];
  const words = link.state === 'confirm' ? link.words : [];
  const options = link.state === 'confirm' ? link.options : [];
  /** M-04: a pessoa escolhe a última palavra; errada, o processo principal cancela e mostra QR novo. */
  const pickWord = (w: string) => void window.piu.linkConfirm(w).then(s => {
    setLink(s);
    if (s.state !== 'linked') { toast(t('auth.toast.wrongWord'), 'error'); step_('qr'); }
  }).catch(e => toast((e as Error).message, 'error'));

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', animation: 'piuReveal .6s cubic-bezier(.2,.85,.3,1) both' }}>
      <div style={{ padding: '52px 64px 40px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {canBack && (
            <button className="h-bg2" onClick={() => { timers.current.forEach(clearTimeout); step_(step === 'work' ? (work === 'create' ? 'create' : 'phrase') : step === 'confirm' ? 'qr' : 'start'); if (step === 'confirm') void window.piu.linkCancel().then(setLink); }} aria-label={t('common.back')}
              style={{ width: 36, height: 36, marginLeft: -8, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .35s both' }}>
              <Sym name="arrow_back" size={20} />
            </button>
          )}
          <div style={{ fontSize: 34, fontWeight: 750, letterSpacing: '-0.07em', lineHeight: 1 }}>piu<span style={{ color: 'var(--ink3)' }}>.</span></div>
        </div>
        <div key={seq} style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `piuPg${seq % 2 ? 'A' : 'B'} .5s cubic-bezier(.2,.85,.3,1) both` }}>
          <div style={{ font: `500 12px ${FM}`, letterSpacing: '.06em', color: 'var(--ink2)' }}>{c[0]}</div>
          <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.02, textWrap: 'pretty' }}>{c[1]}</div>
          <div style={{ fontSize: 16, color: 'var(--ink2)', lineHeight: 1.45, maxWidth: 440, textWrap: 'pretty' }}>{c[2]}</div>
        </div>
        {step === 'qr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* `{b}` no texto marca onde entra a parte em negrito (a ordem das palavras muda entre idiomas). */}
            {([['1', t('auth.qr.step1'), t('auth.qr.step1b')], ['2', t('auth.qr.step2'), t('auth.qr.step2b')], ['3', t('auth.qr.step3'), t('auth.qr.step3b')]] as const).map(([n, text, b], i) => {
              const [pre, post] = text.split('{b}');
              return (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 15, animation: `piuUp .5s ${0.2 + i * 0.1}s both` }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${FM}`, flex: 'none' }}>{n}</div>
                  <div>{pre}<b style={{ fontWeight: 650 }}>{b}</b>{post}</div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 26, borderRadius: 13, background: session.vaultSecure ? 'var(--ink)' : 'var(--bg3)', position: 'relative', flex: 'none', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 3, left: session.vaultSecure ? 19 : 3, width: 20, height: 20, borderRadius: 10, background: session.vaultSecure ? 'var(--invink)' : '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,.15)', transition: 'left .3s cubic-bezier(.2,.9,.3,1.4)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t('auth.keep.title')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{session.vaultSecure ? t('auth.keep.secure', { keychain }) : t('auth.keep.insecure')}</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--side)', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: -320, top: -320, width: 640, height: 640, borderRadius: '50%', border: '1px solid var(--line2)' }} />
          <div style={{ position: 'absolute', left: -230, top: -230, width: 460, height: 460, borderRadius: '50%', border: '1px solid var(--line2)' }} />
          <div style={{ position: 'absolute', left: -320, top: -320, width: 640, height: 640, animation: 'piuSpin 60s linear infinite' }}>
            <div style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: 'var(--ink)', top: -5, left: 315 }} />
            <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ink)', bottom: 90, left: 40 }} />
          </div>
          <div style={{ position: 'absolute', left: -230, top: -230, width: 460, height: 460, animation: 'piuSpinR 40s linear infinite' }}>
            <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--ink)', top: 60, right: 40 }} />
            <div style={{ position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)', bottom: -3, left: 227 }} />
          </div>
        </div>

        {step === 'start' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {startOpts.map(([icon, title, desc, k], i) => {
              const disabled = k !== 'qr' && !session.vaultSecure;
              return (
                <button key={k} className="h-opt" onClick={() => { if (disabled) { toast(t('auth.toast.noVault'), 'lock'); return; } step_(k); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18, border: 'none', borderRadius: 20, background: i ? 'var(--bg)' : 'var(--ink)', color: i ? 'var(--ink)' : 'var(--invink)', cursor: 'pointer', textAlign: 'left', boxShadow: '0 0 0 1px var(--line2) inset', animation: `piuUp .55s ${0.15 + i * 0.09}s cubic-bezier(.2,.85,.3,1) both`, transition: 'transform .25s cubic-bezier(.2,.9,.3,1.4),box-shadow .25s', opacity: disabled ? .5 : 1 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: i ? 'var(--bg2)' : 'var(--invink)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={icon} size={25} wght={300} /></div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ font: `650 16px ${F}` }}>{title}</div>
                    <div style={{ font: `400 13px ${F}`, opacity: .72, lineHeight: 1.35 }}>{desc}</div>
                  </div>
                  <Sym name="arrow_forward" size={20} style={{ opacity: .6 }} />
                </button>
              );
            })}
          </div>
        )}

        {step === 'qr' && (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {/* Cartão do QR (ui.tsx → QrCard): o mesmo componente que a Carteira usa em Receber. */}
            <QrCard text={link.state === 'waiting' ? link.uri : null} label={t('auth.qr.label')} placeholder={link.state === 'dropped' ? t('auth.qr.reconnecting') : t('auth.qr.preparing')} />
            <div style={{ width: 296, display: 'flex', flexDirection: 'column', gap: 8, animation: 'piuUp .5s .6s both' }}>
              <div style={{ height: 3, borderRadius: 2, background: 'var(--bg3)', overflow: 'hidden' }}><div style={{ height: '100%', width: (qrLeft / 30 * 100) + '%', background: 'var(--ink)', transition: 'width 1s linear' }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${FM}`, color: 'var(--ink2)' }}><span>{t('auth.qr.newIn', { s: qrLeft })}</span><span>{link.state === 'waiting' ? t('auth.qr.lanAt', { host: link.host, port: link.port }) : t('auth.qr.lan')}</span></div>
            </div>
            <div style={{ height: 38, padding: '0 16px', borderRadius: 19, border: '1px dashed var(--line2)', background: 'var(--side)', color: 'var(--ink2)', font: `550 13px ${F}`, display: 'flex', alignItems: 'center', gap: 7, animation: 'piuUp .5s .75s both' }}>
              <Sym name="qr_code_scanner" size={18} />{t('auth.qr.waiting')}
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div style={{ position: 'relative', width: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 96, height: 96 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 2.2s ease-out infinite' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 2.2s 1.1s ease-out infinite' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .6s cubic-bezier(.2,.9,.3,1.4) both' }}><Sym name="smartphone" size={42} wght={300} /></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: 'piuUp .5s .15s both' }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em' }}>{t('auth.confirm.heading')}</div>
              <div style={{ fontSize: 14, color: 'var(--ink2)' }}>{t('auth.confirm.hint')}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[...words, '?'].map((w, i) => <div key={i} style={{ height: 54, padding: '0 20px', borderRadius: 16, background: 'var(--bg)', boxShadow: i < words.length ? '0 0 0 1px var(--line2) inset' : '0 0 0 1.5px dashed var(--ink3) inset', color: i < words.length ? 'var(--ink)' : 'var(--ink3)', display: 'flex', alignItems: 'center', font: `600 19px ${FM}`, animation: `piuPop .5s ${0.25 + i * 0.1}s cubic-bezier(.2,.9,.3,1.5) both` }}>{w.toUpperCase()}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, width: '100%', animation: 'piuUp .5s .45s both' }}>
              {options.map(w => <button key={w} className="a-98 h-opt" onClick={() => pickWord(w)} style={{ height: 50, border: 'none', borderRadius: 16, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', color: 'var(--ink)', font: `600 16px ${FM}`, cursor: 'pointer' }}>{w.toUpperCase()}</button>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', animation: 'piuUp .5s .55s both' }}>
              <button onClick={() => { void window.piu.linkCancel().then(setLink); step_('qr'); }} style={{ height: 44, border: 'none', borderRadius: 22, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' }}>{t('auth.confirm.none')}</button>
            </div>
            {link.state === 'linked' && !link.synced && <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{t('auth.confirm.syncing')}</div>}
          </div>
        )}

        {step === 'create' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
              {([['public', 'public', t('auth.id.public'), t('auth.id.publicDesc')], ['anon', 'visibility_off', t('auth.id.anon'), t('auth.id.anonDesc')]] as [IdentityKind, string, string, string][]).map(([k, icon, title, desc], i) => (
                <button key={k} onClick={() => setIdType(k)} aria-pressed={idType === k}
                  style={{ padding: 16, border: 'none', borderRadius: 18, background: idType === k ? 'var(--ink)' : 'var(--bg)', color: idType === k ? 'var(--invink)' : 'var(--ink)', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 0 0 1px var(--line2) inset', transition: 'background .3s,color .3s,transform .3s cubic-bezier(.2,.9,.3,1.4)', transform: idType === k ? 'scale(1.02)' : 'none', animation: `piuUp .5s ${0.1 + i * 0.08}s both` }}>
                  <Sym name={icon} size={24} wght={300} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><div style={{ font: `650 15px ${F}` }}>{title}</div><div style={{ font: `400 12.5px ${F}`, opacity: .72, lineHeight: 1.35 }}>{desc}</div></div>
                </button>
              ))}
            </div>
            {idType === 'public' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'piuUp .4s both' }}>
                <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--ink2)' }}>{t('auth.id.nameLabel')}</div>
                <input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={t('auth.id.namePh')} autoFocus onKeyDown={e => { if (e.key === 'Enter') createId(); }}
                  style={{ height: 48, borderRadius: 14, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 16px', font: `550 16px ${F}`, color: 'var(--ink)', outline: 'none' }} />
              </div>
            ) : (
              <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', display: 'flex', flexDirection: 'column', gap: 4, animation: 'piuUp .4s both' }}>
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('auth.id.anonHint')}</div>
                <div style={{ font: `600 16px ${FM}` }}>{t('auth.id.anonName')}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', background: 'var(--side)', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, animation: 'piuUp .5s .2s both' }}>
              <Sym name="key" size={18} style={{ color: 'var(--ink)' }} />{t('auth.id.keysNote')}
            </div>
            <button className="a-98" onClick={createId} disabled={!nameOk} style={{ height: 52, border: 'none', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', font: `600 15.5px ${F}`, cursor: 'pointer', opacity: nameOk ? 1 : .4, transition: 'opacity .2s', animation: 'piuUp .5s .28s both' }}>{t('auth.id.generate')}</button>
          </div>
        )}

        {step === 'work' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
            <div style={{ position: 'relative', width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--bg3)' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(var(--ink) ${workPct * 3.6}deg, transparent 0)`, WebkitMask: 'radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px))', mask: 'radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px))' }} />
              {!workDone && !workErr && <div style={{ font: `600 26px ${FM}`, fontVariantNumeric: 'tabular-nums' }}>{Math.round(workPct)}%</div>}
              {workErr && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="error" size={44} wght={300} /></div>}
              {workDone && (
                <>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s ease-out both' }} />
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s .2s ease-out both' }} />
                  {burst.map((b, i) => <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, margin: -4, borderRadius: '50%', background: 'var(--ink)', ['--x' as string]: b.x, ['--y' as string]: b.y, animation: `piuBurst .9s ${b.d} cubic-bezier(.1,.8,.3,1) both` }} />)}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .55s cubic-bezier(.2,.9,.3,1.5) both' }}><Sym name="check" size={52} wght={500} /></div>
                </>
              )}
            </div>
            <div style={{ width: '100%', borderRadius: 20, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line) inset', overflow: 'hidden', animation: 'piuUp .5s .1s both' }}>
              {rows.map(([icon, label], i) => {
                const loc = Math.max(0, Math.min(100, (workPct - i * 25) * 4)); const done = loc >= 100, run = loc > 0 && !done;
                return (
                  <div key={label} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}`, opacity: loc > 0 ? 1 : .45, transition: 'opacity .3s' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: done ? 'var(--ink)' : 'var(--bg2)', color: done ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'background .3s,color .3s' }}>
                      <Sym name={done ? 'check' : icon!} size={18} style={{ animation: done ? 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' : run ? 'piuBreath .9s ease-in-out infinite' : 'none' }} />
                    </div>
                    <div style={{ flex: 1, fontSize: 14.5, fontWeight: 550 }}>{label}</div>
                    <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{done ? t('auth.row.done') : run ? Math.round(loc) + '%' : t('auth.row.waiting')}</div>
                    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: run ? loc + '%' : '0%', background: 'var(--ink)', opacity: .5 }} />
                  </div>
                );
              })}
            </div>
            <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{workErr ? t('auth.work.footErr') : workDone ? t('auth.work.footDone') : t('auth.work.footRun')}</div>
          </div>
        )}

        {step === 'phrase' && (
          <div style={{ position: 'relative', width: 450, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
              {phrase.map((v, i) => (
                <div key={i} style={{ height: 42, borderRadius: 12, background: 'var(--bg)', boxShadow: v.trim() ? '0 0 0 1.5px var(--ink) inset' : '0 0 0 1px var(--line2) inset', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', animation: `piuUp .4s ${i * 0.03}s both`, transition: 'box-shadow .25s' }}>
                  <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)', width: 16 }}>{i + 1}</span>
                  <input value={v} aria-label={t('auth.phrase.word', { n: i + 1 })} autoFocus={i === 0} spellCheck={false} autoCapitalize="off"
                    onChange={e => { const val = e.target.value; const parts = val.trim().split(/\s+/); if (parts.length > 1) { setPhrase(p => p.map((x, j) => (j >= i && j < i + parts.length ? parts[j - i]! : x))); } else setPhrase(p => p.map((x, j) => (j === i ? val : x))); }}
                    onKeyDown={e => { if (e.key === 'Enter') restore(); }}
                    style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, animation: 'piuUp .5s .5s both' }}>
              <button onClick={fillPhrase} style={{ height: 50, padding: '0 18px', border: 'none', borderRadius: 25, background: 'var(--bg3)', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><Sym name="content_paste" size={18} />{t('auth.phrase.paste')}</button>
              <button className="a-98" onClick={restore} disabled={!filled} style={{ flex: 1, height: 50, border: 'none', borderRadius: 25, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: 'pointer', opacity: filled ? 1 : .4, transition: 'opacity .2s' }}>{t('auth.phrase.restore')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
