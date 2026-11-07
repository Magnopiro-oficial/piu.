/**
 * Desktop como guardião de ponto Piu (Piu 12): assistente E4d início · E4a rede · E4 teste automático ·
 * E4b nível · E4e antes de ativar (um toque), painel E5 (contagens + QR) com E5a pausado · E5b rede caiu ·
 * E5c roteador isolando · E5d encerrar · E5f cartaz; E4c (resumo) em Ajustes → Rede.
 * Estilos copiados do "Piu 12 Desktop briefing.dc.html". Tudo real (main/guardian/*):
 * - números só do nó do ponto (contagens; nenhum aparelho identificado). Onde o protótipo mostra
 *   "entregas comprovadas", aqui são os recibos de repasse que o ponto assinou (a prova de entrega vai
 *   cifrada ao remetente; o ponto não a vê);
 * - limites reais: até 1 GB e 7 dias (a validade máxima de um envelope), não 10 GB · 30 dias;
 * - QR padrão de Wi-Fi só com a senha que a pessoa digita aqui (o Piu nunca lê a senha do sistema);
 * - "Guardião + app" só com o APK conferido neste computador; senão aparece desligado, com o motivo.
 */
import QRCode from 'qrcode';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAYS_OPTIONS, fmtDays, fmtStorage, type GuardianLevel, type GuardianNetwork, type GuardianState, type GuardianTest, levelName, levelSummary, STORAGE_OPTIONS_MB } from '../../shared/guardian';
import icon192 from '../brand/icon-192.png';
import { fmtBytes } from '../format';
import { fmtNumber, t as tNow, useT } from '../i18n';
import { type DialogSpec, F, FM, motionOff, Sym } from '../ui';
import { Switch46 } from './Updates';

const MS = "'Material Symbols Rounded'";
const ms = (size: number, o: { w?: number; fill?: 0 | 1 } = {}): CSSProperties => ({ fontFamily: MS, fontSize: size, lineHeight: 1, ...(o.w || o.fill ? { fontVariationSettings: [o.fill ? "'FILL' 1" : null, o.w ? `'wght' ${o.w}` : null].filter(Boolean).join(', ') } : {}) });
const label: CSSProperties = { font: `500 12px ${FM}`, color: 'var(--ink2)', letterSpacing: '.04em' };
const btnGhost: CSSProperties = { height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' };
const btnInk: CSSProperties = { height: 40, padding: '0 18px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' };
const pillOutline: CSSProperties = { height: 44, padding: '0 20px', border: 'none', borderRadius: 22, background: 'var(--bg)', color: 'var(--ink)', boxShadow: '0 0 0 1px var(--line2) inset', font: `600 14.5px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
const dots: CSSProperties = { backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' };
const n = (x: number) => fmtNumber(x);

function Pulse({ on = true }: { on?: boolean }) {
  return (
    <div style={{ position: 'relative', width: 8, height: 8, flex: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: on ? 'var(--ink)' : 'transparent', boxShadow: on ? undefined : '0 0 0 1.5px var(--ink2) inset' }} />
      {on && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />}
    </div>
  );
}

/** Cartão de estado (E5a/E5b/E5c): ícone 44px, título 17, texto 13.5, ações à direita. */
export function StateCard({ icon, ink, title, body, children }: { icon: string; ink?: boolean; title: string; body: string; children?: ReactNode }) {
  return (
    <div role={ink ? 'alert' : 'status'} style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: ink ? 'var(--ink)' : 'var(--bg2)', color: ink ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={ms(23, { w: ink ? undefined : 300 })}>{icon}</span></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{body}</div>
        </div>
      </div>
      {children && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

/** QR legível (lib `qrcode`) em SVG: nítido na tela e na impressão. */
export function QrSvg({ text, size, title }: { text: string; size: number; title: string }) {
  const q = useMemo(() => { try { return QRCode.create(text, { errorCorrectionLevel: 'M' }); } catch { return null; } }, [text]);
  if (!q) return null;
  const N = q.modules.size;
  let d = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (q.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  // Fundo branco sempre (no tema escuro também): leitores de QR precisam de módulo escuro em fundo claro.
  return <svg role="img" aria-label={title} width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} style={{ display: 'block', flex: 'none', background: '#ffffff', borderRadius: 6 }} shapeRendering="crispEdges"><path d={d} fill="#0c0c0c" /></svg>;
}

/** PNG do QR (para copiar): desenhado num canvas, com margem branca. */
function qrPng(text: string, px = 640): string | null {
  try {
    const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const N = q.modules.size, cell = Math.floor(px / (N + 4));
    const c = document.createElement('canvas'); c.width = c.height = cell * (N + 4);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#0c0c0c';
    for (let r = 0; r < N; r++) for (let k = 0; k < N; k++) if (q.modules.get(r, k)) g.fillRect((k + 2) * cell, (r + 2) * cell, cell, cell);
    return c.toDataURL('image/png');
  } catch { return null; }
}

// ── assistente (E4d · E4a · E4 · E4b · E4e) ──────────────
type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = ['guardian.step.start', 'guardian.network', 'guardian.step.test', 'guardian.step.level', 'guardian.step.activate'] as const;

function Steps({ step, network }: { step: Step; network: string | null }) {
  const t = useT();
  return (
    <div style={{ width: 280, flex: 'none', borderRight: '1px solid var(--line)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={label}>{t('guardian.wizard.kicker')}</div>
      <div style={{ height: 10 }} />
      {STEPS.map((s, i) => {
        const k = (i + 1) as Step, done = k < step, cur = k === step;
        return (
          <div key={s} aria-current={cur ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', color: done || cur ? 'var(--ink)' : 'var(--ink3)' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 12px ${F}`, ...(done ? { background: 'var(--ink)', color: 'var(--invink)' } : { boxShadow: `0 0 0 2px ${cur ? 'var(--ink)' : 'var(--bg3)'} inset` }) }}>
              {done ? <span style={ms(16)}>check</span> : k}
            </div>
            <span style={{ fontSize: 14.5, fontWeight: cur ? 650 : 500 }}>{k === 2 && network && step > 2 ? t('guardian.step.networkWith', { network }) : t(s)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Page({ title, sub, children, actions }: { title: ReactNode; sub?: ReactNode; children: ReactNode; actions: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '48px 64px 32px', gap: 18, overflowY: 'auto', ...dots }}>
      <div style={{ maxWidth: 560, width: '100%', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.05, textWrap: 'pretty' }}>{title}</div>
          {sub && <div style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.45 }}>{sub}</div>}
        </div>
        {children}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{actions}</div>
      </div>
    </div>
  );
}

function Feature({ icon, title, body, first }: { icon: string; title: string; body: string; first?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '12px 0', borderTop: first ? undefined : '1px solid var(--line)' }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={ms(21, { w: 300 })}>{icon}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.38, textWrap: 'pretty' }}>{body}</div>
      </div>
    </div>
  );
}

function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={{ padding: '13px 15px', borderRadius: 18, boxShadow: '0 0 0 1px var(--line2) inset', display: 'flex', gap: 12 }}>
      <span style={ms(20, { w: 300 })}>{icon}</span>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4, textWrap: 'pretty' }}>{children}</div>
    </div>
  );
}

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ borderRadius: 20, background: 'var(--bg2)', padding: '2px 16px' }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', fontSize: 14, borderTop: i ? '1px solid var(--line)' : undefined }}>
          <span style={{ color: 'var(--ink2)', flex: 'none' }}>{k}</span><span style={{ fontWeight: 550, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const STEP_MS = 1100;

/** E4: quatro etapas, uma a cada 1,1 s (resultado real; se demorar, a etapa espera). "Continuar" acende no fim. */
function TestStep({ net, onDone, onBack, test, setTest }: { net: GuardianNetwork | null; onDone: () => void; onBack: () => void; test: GuardianTest | null; setTest: (t: GuardianTest | null) => void }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [run, setRun] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTick(0); setErr(null); setTest(null);
    void window.piu.guardianTest().then(r => { if (alive) setTest(r); }).catch(e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [run, setTest]);
  // Com o resultado na mão, uma etapa a cada 1,1 s (sem movimento: tudo de uma vez).
  useEffect(() => {
    if (!test) return;
    if (motionOff()) { setTick(4); return; }
    setTick(0);
    const iv = setInterval(() => setTick(x => Math.min(x + 1, 4)), STEP_MS);
    return () => clearInterval(iv);
  }, [test]);
  const steps = test?.steps ?? (['guardian.test.peers', 'guardian.test.home', 'guardian.test.internet', 'guardian.test.capacity'] as const).map(l => ({ label: t(l), detail: '', level: 'ok' as const }));
  const shown = test ? tick : 0;
  const ready = !!test && tick >= 4;
  const name = net?.label ?? t('guardian.test.thisNetwork');
  const status = err ? t('guardian.test.failed') : ready ? (test!.verdict === 'ok' ? t('guardian.test.ok') : test!.verdict === 'warn' ? t('guardian.test.warn') : t('guardian.test.fail')) : t('guardian.test.progress', { current: Math.min(shown, 3) + 1, total: 4 });
  const verdict = test?.verdict ?? 'ok';
  return (
    <Page title={t('guardian.test.title', { name })} sub={status}
      actions={<>
        <button className="h-bg2" onClick={onBack} style={btnGhost}>{t('common.back')}</button>
        {ready && verdict !== 'ok' && <button className="h-bg2" onClick={() => setRun(r => r + 1)} style={btnGhost}>{t('guardian.test.again')}</button>}
        <button className="a-97" onClick={onDone} disabled={!ready || verdict === 'fail'} style={{ ...btnInk, opacity: ready && verdict !== 'fail' ? 1 : 0.25, cursor: ready && verdict !== 'fail' ? 'pointer' : 'default', transition: 'opacity .4s' }}>{t('common.continue')}</button>
      </>}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={Math.min(shown, 4)} style={{ height: 6, borderRadius: 3, background: 'var(--bg3)', overflow: 'hidden' }}>
        <div style={{ width: `${(Math.min(shown, 4) / 4) * 100}%`, height: '100%', borderRadius: 3, background: 'var(--ink)', transition: 'width .4s' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderRadius: 20, padding: '4px 20px', boxShadow: '0 0 0 1px var(--line)' }}>
        {steps.map((s, i) => {
          const done = i < shown, running = i === shown && !err;
          const icon = s.level === 'fail' ? 'cancel' : s.level === 'warn' ? 'error' : 'check_circle';
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i ? '1px solid var(--line)' : undefined, opacity: done || running ? 1 : 0.45, transition: 'opacity .3s' }}>
              <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                {done ? <span style={{ ...ms(22, { fill: 1 }), animation: 'piuPop .35s cubic-bezier(.2,.9,.3,1.5) both' }}>{icon}</span>
                  : running ? <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--bg3)', borderTopColor: 'var(--ink)', animation: 'piuSpin .9s linear infinite', flex: 'none' }} />
                  : <span style={ms(22)}>radio_button_unchecked</span>}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>{done ? s.detail : running ? t('guardian.test.running') : t('guardian.test.waiting')}</div>
              </div>
            </div>
          );
        })}
      </div>
      {err ? <StateCard icon="error" ink title={t('guardian.test.failed')} body={err} /> : (
        <div style={{ opacity: ready ? 1 : 0.25, transition: 'opacity .4s', padding: '14px 16px', borderRadius: 18, background: 'var(--bg2)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={ms(22, { fill: 1 })}>{ready && verdict === 'fail' ? 'cancel' : ready && verdict === 'warn' ? 'error' : 'check_circle'}</span>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{ready && verdict === 'fail' ? t('guardian.test.verdictFail') : ready && verdict === 'warn' ? t('guardian.test.verdictWarn') : t('guardian.test.verdictOk')}</div>
        </div>
      )}
    </Page>
  );
}

interface Draft { level: GuardianLevel; storageMB: number; days: number; gateway: boolean; name: string }

function Seg<T extends string | number>({ value, opts, onChange, label: aria }: { value: T; opts: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={aria} style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--bg3)' }}>
      {opts.map(([v, l]) => (
        <button key={String(v)} role="radio" aria-checked={v === value} onClick={() => onChange(v)} style={{ flex: 1, height: 30, border: 'none', borderRadius: 8, background: v === value ? 'var(--bg)' : 'transparent', boxShadow: v === value ? '0 1px 3px rgba(0,0,0,.12)' : 'none', color: 'var(--ink)', font: `${v === value ? 600 : 500} 13px ${F}`, cursor: 'pointer' }}>{l}</button>
      ))}
    </div>
  );
}

/** E4b: radio dos níveis; Gateway é um papel a mais (caixa), só com internet. */
function LevelPicker({ d, set, internet, apk }: { d: Draft; set: (p: Partial<Draft>) => void; internet: boolean; apk: GuardianState['apk'] }) {
  const t = useT();
  const Row = ({ k, title, desc, disabled, check, first }: { k: GuardianLevel | 'gateway'; title: string; desc: string; disabled?: boolean; check?: boolean; first?: boolean }) => {
    const on = k === 'gateway' ? d.gateway : d.level === k;
    const click = () => { if (disabled) return; if (k === 'gateway') set({ gateway: !d.gateway }); else set({ level: k }); };
    return (
      <div role={check ? 'checkbox' : 'radio'} aria-checked={on} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={click} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); click(); } }}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: first ? '0 0 12px' : '12px 0', borderTop: first ? undefined : '1px solid var(--line)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
        {check ? (
          <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? 'var(--ink)' : 'var(--line2)'}`, background: on ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{on && <span style={ms(16)}>check</span>}</div>
        ) : (
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${on ? 'var(--ink)' : 'var(--line2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{on && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ink)' }} />}</div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>{desc}</div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row first k="multiplier" title={t('guardian.level.multiplier')} desc={t('guardian.pick.multiplierDesc')} />
        <Row k="guardian" title={t('guardian.level.guardian')} desc={t('guardian.pick.guardianDesc', { storage: fmtStorage(d.storageMB), days: fmtDays(d.days) })} />
        <Row k="guardian-app" title={t('guardian.level.guardianApp')} desc={apk.available ? t('guardian.pick.appDesc') : apk.reason} disabled={!apk.available} />
        <Row k="gateway" check title={t('guardian.gateway')} desc={internet ? t('guardian.pick.gatewayDesc') : t('guardian.pick.gatewayNoNet')} disabled={!internet} />
      </div>
      {d.level === 'guardian' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('guardian.space')}</span>
            <Seg label={t('guardian.space')} value={d.storageMB} opts={STORAGE_OPTIONS_MB.map(v => [v, fmtStorage(v)] as [number, string])} onChange={v => set({ storageMB: v })} />
            <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('guardian.pick.days')}</span>
            <Seg label={t('guardian.pick.days')} value={d.days} opts={DAYS_OPTIONS.map(v => [v, fmtDays(v)] as [number, string])} onChange={v => set({ days: v })} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('guardian.pick.maxNote')}</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12.5, color: 'var(--ink2)' }}>{t('guardian.pick.energy')}<br /><b style={{ color: 'var(--ink)', fontSize: 14 }}>{d.gateway ? t('guardian.pick.energyGateway') : t('guardian.pick.energyLow')}</b></div>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12.5, color: 'var(--ink2)' }}>{t('guardian.space')}<br /><b style={{ color: 'var(--ink)', fontSize: 14 }}>{d.level === 'multiplier' ? t('guardian.nothingStored') : t('guardian.upTo', { storage: fmtStorage(d.storageMB) })}</b></div>
      </div>
    </div>
  );
}

function Wizard({ s, hostname, onCancel, onActivated, toast }: { s: GuardianState; hostname: string; onCancel: () => void; onActivated: () => void; toast: (t: string, i?: string) => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>(1);
  const [net, setNet] = useState<GuardianNetwork | null>(null);
  const [test, setTest] = useState<GuardianTest | null>(null);
  const [d, setD] = useState<Draft>({ level: 'guardian', storageMB: 512, days: 7, gateway: false, name: `Piu · ${hostname}`.slice(0, 40) });
  const [busy, setBusy] = useState(false);
  const set = useCallback((p: Partial<Draft>) => setD(x => ({ ...x, ...p })), []);
  useEffect(() => { if (step === 2) void window.piu.guardianNetwork().then(setNet).catch(() => setNet(null)); }, [step]);
  const internet = !!test?.internet;
  const activate = async () => {
    if (busy) return;
    setBusy(true);
    try { await window.piu.guardianActivate({ name: d.name, level: d.level, storageMB: d.storageMB, days: d.days, gateway: d.gateway && internet, autoStart: true }); toast(tNow('guardian.toast.active'), 'hub'); onActivated(); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', animation: 'piuUp .4s cubic-bezier(.2,.85,.3,1) both' }}>
      <Steps step={step} network={net?.label ?? null} />
      {step === 1 && (
        // E4d: início.
        <Page title={t('guardian.start.title')} sub={t('guardian.start.sub')}
          actions={<><button className="h-bg2" onClick={onCancel} style={btnGhost}>{t('guardian.start.notNow')}</button><button className="a-97" onClick={() => setStep(2)} disabled={!s.canStore} style={{ ...btnInk, opacity: s.canStore ? 1 : 0.4 }}>{t('guardian.start.begin')}</button></>}>
          <div style={{ ...label, order: -1 }}>{t('guardian.start.kicker')}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Feature icon="device_hub" title={t('guardian.level.multiplier')} body={t('guardian.start.multiplierBody')} />
            <Feature icon="inventory_2" title={t('guardian.level.guardian')} body={t('guardian.start.guardianBody')} />
            <Feature icon="tune" title={t('guardian.start.control')} body={t('guardian.start.controlBody')} />
            <Feature icon="visibility_off" title={t('guardian.start.privacy')} body={t('guardian.start.privacyBody')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink2)' }}><span style={ms(16)}>toll</span>{t('guardian.start.rewardsOff')}</div>
          {!s.canStore && <StateCard icon="key_off" ink title={t('guardian.start.noVault')} body={t('guardian.start.noVaultBody')} />}
        </Page>
      )}
      {step === 2 && (
        // E4a: a rede em que o computador já está (não existe "Criar a rede" no computador).
        <Page title={t('guardian.network')} sub={t('guardian.net.sub')}
          actions={<><button className="h-bg2" onClick={() => setStep(1)} style={btnGhost}>{t('common.back')}</button><button className="a-97" onClick={() => setStep(3)} disabled={!net?.up} style={{ ...btnInk, opacity: net?.up ? 1 : 0.25 }}>{t('guardian.net.testThis')}</button></>}>
          <div style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--bg2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={ms(23, { w: 300 })}>{net && !net.up ? 'wifi_off' : 'lan'}</span></div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{!net ? t('guardian.net.reading') : net.up ? t('guardian.net.uses') : t('guardian.net.none')}</div>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{!net ? '' : net.up ? t(net.wired ? 'guardian.net.detailWired' : 'guardian.net.detailWifi', { label: net.label }) : t('guardian.net.connectHint')}</div>
              </div>
            </div>
            <Note icon="visibility_off">{t('guardian.privacyNote')}</Note>
          </div>
        </Page>
      )}
      {step === 3 && <TestStep net={net} test={test} setTest={setTest} onBack={() => setStep(2)} onDone={() => setStep(4)} />}
      {step === 4 && (
        <Page title={t('guardian.howMuch')} actions={<><button className="h-bg2" onClick={() => setStep(3)} style={btnGhost}>{t('common.back')}</button><button className="a-97" onClick={() => setStep(5)} style={btnInk}>{t('common.continue')}</button></>}>
          <LevelPicker d={d} set={set} internet={internet} apk={s.apk} />
        </Page>
      )}
      {step === 5 && (
        // E4e: antes de ativar; um toque (não move LUNES).
        <Page title={t('guardian.activate.title')} actions={<><button className="h-bg2" onClick={() => setStep(4)} style={btnGhost}>{t('common.back')}</button><button className="a-97" onClick={() => void activate()} disabled={busy || !d.name.trim()} style={{ ...btnInk, opacity: busy || !d.name.trim() ? 0.5 : 1 }}>{busy ? t('guardian.activate.busy') : t('guardian.activate.go')}</button></>}>
          <Kv rows={[[t('guardian.network'), net?.label ?? '—'], [t('guardian.kv.level'), levelName(d.level)], [t('guardian.space'), d.level === 'multiplier' ? t('guardian.nothingStored') : t('guardian.kv.storageDays', { storage: fmtStorage(d.storageMB), days: fmtDays(d.days) })], [t('guardian.kv.internet'), d.gateway && internet ? t('guardian.kv.gatewayOnly') : t('guardian.kv.off')], [t('guardian.rewards'), t('guardian.rewardsOff')]]} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>{t('guardian.activate.nameLabel')}</span>
            <input value={d.name} onChange={e => set({ name: e.target.value.slice(0, 40) })} maxLength={40} aria-label={t('guardian.activate.nameAria')} spellCheck={false}
              style={{ height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `550 14.5px ${F}`, color: 'var(--ink)', outline: 'none' }} />
          </label>
          <Note icon="key">{t('guardian.activate.keyNote')}</Note>
        </Page>
      )}
    </div>
  );
}

// ── painel (E5 · E5a · E5b · E5c · E5d · E5f) ─────────────
function Stat({ v, l }: { v: string; l: string }) {
  return <div style={{ padding: '16px 18px', borderRadius: 18, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{v}</span><span style={{ fontSize: 13, color: 'var(--ink2)' }}>{l}</span></div>;
}

function Line({ icon, name, desc, first, children, onClick }: { icon: string; name: string; desc?: string; first?: boolean; children?: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? e => { if (e.key === 'Enter') onClick(); } : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: first ? undefined : '1px solid var(--line)', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={ms(21, { w: 300 })}>{icon}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14.5, fontWeight: 550 }}>{name}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** QR do ponto: o QR de Wi-Fi só com a senha digitada aqui (nunca a do sistema). */
function QrSide({ s, toast, onPoster }: { s: GuardianState; toast: (t: string, i?: string) => void; onPoster: () => void }) {
  const t = useT();
  const p = s.point!;
  const [pw, setPw] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (w: { password: string | null; open: boolean }) => {
    try { await window.piu.guardianSetWifi(w); setPw(''); setEditing(false); setErr(null); if (w.password || w.open) toast(tNow('guardian.qr.ready'), 'qr_code_2'); }
    catch (e) { setErr((e as Error).message); }
  };
  const copy = async () => {
    const png = p.qr ? qrPng(p.qr) : null;
    if (!png) return;
    try { await window.piu.copyImage(png); toast(tNow('guardian.qr.copied'), 'content_copy'); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const showForm = (!p.qr || editing) && !!p.network.ssid;
  // Frase com o nome da rede em negrito no meio: `{ssid}` sem interpolar, partido em volta do <b>.
  const askPw = t('guardian.qr.askPw').split('{ssid}');
  return (
    <div style={{ width: 340, flex: 'none', alignSelf: 'flex-start', padding: 28, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 20px 50px -30px rgba(0,0,0,.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', animation: 'piuUp .5s .1s cubic-bezier(.2,.85,.3,1) both' }}>
      <div style={label}>{t('guardian.qr.kicker')}</div>
      {p.qr && !editing ? <div style={{ animation: 'piuPop .4s cubic-bezier(.2,.9,.3,1.3) both' }}><QrSvg text={p.qr} size={220} title={t('guardian.qr.wifiTitle', { ssid: p.network.ssid ?? '' })} /></div> : !p.network.ssid ? (
        <div style={{ width: 220, height: 220, borderRadius: 18, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 }}>
          <span style={ms(30, { w: 300 })}>cable</span>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('guardian.qr.noSsid')}</div>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void save({ password: open ? null : pw, open }); }} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{askPw[0]}<b style={{ color: 'var(--ink)' }}>{p.network.ssid}</b>{askPw[1]}</div>
          <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(null); }} disabled={open} placeholder={t('guardian.qr.pwPlaceholder')} aria-label={t('guardian.qr.pwAria')} autoComplete="off" spellCheck={false}
            style={{ height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `500 14px ${F}`, color: 'var(--ink)', outline: 'none', opacity: open ? .5 : 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} />{t('guardian.qr.open')}</label>
          {err && <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, animation: 'piuShake .45s ease-in-out both' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editing && <button type="button" className="h-bg2" onClick={() => { setEditing(false); setErr(null); }} style={btnGhost}>{t('common.cancel')}</button>}
            <button type="submit" className="a-97" disabled={!open && !pw} style={{ ...btnInk, opacity: open || pw ? 1 : 0.4 }}>{t('guardian.qr.generate')}</button>
          </div>
        </form>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{p.name}</div>
        <span style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{p.network.ssid ? t('guardian.qr.wifiLine', { ssid: p.network.ssid }) : p.network.label}</span>
        <span className="sel" style={{ font: `500 11px ${FM}`, color: 'var(--ink3)' }}>{t('guardian.qr.pointId', { id: `${p.id.slice(0, 4)} ${p.id.slice(4, 8)} ${p.id.slice(8, 12)} ${p.id.slice(12, 16)}` })}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4 }}>{p.qr ? t('guardian.qr.scanHint') : t('guardian.qr.sameNetHint')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
        <button className="a-97" onClick={() => void copy()} disabled={!p.qr} style={{ ...pillOutline, padding: '0 14px', opacity: p.qr ? 1 : 0.4 }}><span style={ms(19)}>ios_share</span>{t('common.copy')}</button>
        <button className="a-97" onClick={onPoster} style={{ ...pillOutline, padding: '0 14px' }}><span style={ms(19)}>print</span>{t('guardian.qr.poster')}</button>
      </div>
      {p.qr && <button className="h-bg2" onClick={() => setEditing(true)} style={{ ...btnGhost, height: 30, fontSize: 12.5, color: 'var(--ink2)' }}>{t('guardian.qr.change')}</button>}
    </div>
  );
}

/** E5f: cartaz para imprimir (diálogo de impressão do sistema). Só o cartaz sai no papel (styles.css @media print). */
function Poster({ s, onClose }: { s: GuardianState; onClose: () => void }) {
  const t = useT();
  const p = s.point!;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <>
      <div className="no-print" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', zIndex: 70, animation: 'piuFade .25s both' }} />
      <div role="dialog" aria-modal="true" aria-label={t('guardian.poster.aria')} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 71, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <div className="piu-poster" style={{ width: 360, borderRadius: 24, background: '#ffffff', color: '#0c0c0c', boxShadow: '0 0 0 1px rgba(0,0,0,.16)', overflow: 'hidden' }}>
          <div style={{ aspectRatio: '1 / 1.414', padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
            <img src={icon192} alt="" style={{ width: 52, height: 52, borderRadius: 14, display: 'block' }} />
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.05 }}>{t('guardian.poster.title').split('\n').map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}</div>
            <div style={{ fontSize: 13, color: '#5f5f5c', lineHeight: 1.4, maxWidth: 240 }}>{p.qr ? t('guardian.poster.scan') : t('guardian.poster.join', { network: p.network.label })}</div>
            {p.qr ? <QrSvg text={p.qr} size={170} title={t('guardian.poster.qrTitle')} /> : <div style={{ width: 170, height: 170, borderRadius: 14, border: '1.5px dashed #9b9b97', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 650 }}>{p.network.label}</div>}
            <div style={{ fontSize: 15, fontWeight: 650 }}>{p.name}</div>
            <div style={{ flex: 1 }} />
            <span style={{ font: `500 10.5px ${FM}`, color: '#5f5f5c' }}>{t('guardian.poster.footer', { id: p.id.slice(0, 8) })}</span>
          </div>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 8 }}>
          <button className="a-97" onClick={onClose} style={{ ...btnGhost, background: 'var(--bg)' }}>{t('common.close')}</button>
          <button className="a-97" onClick={() => window.print()} style={btnInk}><span style={{ ...ms(18), verticalAlign: '-4px', marginRight: 6 }}>print</span>{t('guardian.poster.print')}</button>
        </div>
      </div>
    </>
  );
}

function Panel({ s, toast, setDialog, onEdit }: { s: GuardianState; toast: (t: string, i?: string) => void; setDialog: (d: DialogSpec | null) => void; onEdit: () => void }) {
  const t = useT();
  const p = s.point!, st = s.stats!;
  const [poster, setPoster] = useState(false);
  const act = (f: () => Promise<unknown>) => () => void f().catch(e => toast((e as Error).message, 'error'));
  const askEnd = () => setDialog({
    icon: 'delete_forever', title: tNow('guardian.end.title', { name: p.name }),
    body: st.stored === 1 ? tNow('guardian.end.bodyOne') : tNow('guardian.end.bodyMany', { count: n(st.stored) }),
    primary: tNow('guardian.end.primary'), danger: true,
    act: () => { void window.piu.guardianEnd().then(() => { setDialog(null); toast(tNow('guardian.toast.ended'), 'delete_forever'); }).catch(e => toast((e as Error).message, 'error')); },
  });
  const statusWord = t(s.status === 'active' ? 'guardian.status.active' : s.status === 'paused' ? 'guardian.status.paused' : s.status === 'down' ? 'guardian.status.down' : s.status === 'changed' ? 'guardian.status.changed' : 'guardian.status.isolating');
  const usedPct = st.maxBytes ? Math.min(100, (st.storedBytes / st.maxBytes) * 100) : 0;
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', padding: '40px 56px', gap: 48, overflowY: 'auto', ...dots, animation: 'piuUp .4s cubic-bezier(.2,.85,.3,1) both' }}>
      {/* Cresce com o conteúdo (estados extras): a área rola em vez de espremer os cartões. */}
      <div style={{ flex: 1, maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 18, alignSelf: 'flex-start', minHeight: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.045em' }}>{p.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Pulse on={s.status === 'active'} />{statusWord} · {levelName(p.level)} · {p.network.label}</div>
        </div>
        {s.status === 'paused' && <StateCard icon="pause" title={t('guardian.paused.title')} body={t('guardian.paused.body')}><button className="a-97" onClick={act(() => window.piu.guardianPause(false))} style={btnInk}>{t('guardian.resume')}</button></StateCard>}
        {s.status === 'down' && <StateCard icon="wifi_off" ink title={t('guardian.down.title', { network: p.network.label })} body={t('guardian.down.body')} />}
        {s.status === 'changed' && <StateCard icon="swap_horiz" ink title={t('guardian.changed.title')} body={t('guardian.changed.body', { reason: s.reason ?? '' })}>
          <button className="h-bg2" onClick={askEnd} style={btnGhost}>{t('guardian.endPoint')}</button>
          <button className="a-97" onClick={act(() => window.piu.guardianAdoptNetwork())} style={btnInk}>{t('guardian.changed.continue')}</button>
        </StateCard>}
        {s.status === 'isolating' && <StateCard icon="router" ink title={t('guardian.isolating.title')} body={t('guardian.isolating.body')}>
          <button className="a-97" onClick={act(async () => { const r = await window.piu.guardianTest(); toast(r.steps[0]!.level === 'ok' ? tNow('guardian.isolating.back') : tNow('guardian.isolating.still'), r.steps[0]!.level === 'ok' ? 'check' : 'router'); })} style={btnInk}>{t('guardian.test.again')}</button>
        </StateCard>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10 }}>
          <Stat v={n(st.peersToday)} l={t('guardian.stat.peersToday')} />
          <Stat v={n(st.receipts)} l={t('guardian.stat.receipts')} />
          <Stat v={n(st.stored)} l={t('guardian.stat.stored')} />
          <Stat v={n(st.forwarded)} l={t('guardian.stat.forwarded')} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', borderRadius: 18, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}><span>{t('guardian.space')}</span><span style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{p.level === 'multiplier' ? t('guardian.panel.nothingOnDisk') : t('guardian.usedOf', { used: fmtBytes(st.storedBytes), total: fmtStorage(p.storageMB) })}</span></div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg3)', overflow: 'hidden' }}><div style={{ width: `${usedPct}%`, minWidth: st.storedBytes ? 3 : 0, height: '100%', borderRadius: 3, background: 'var(--ink)', transition: 'width .5s' }} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}><span>{t('guardian.panel.dataToday')}</span><span style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{t('guardian.panel.dataTodayValue', { bytes: fmtBytes(st.bytesToday), count: st.peersNow })}</span></div>
        </div>
        <div style={{ borderRadius: 18, background: 'var(--bg2)', overflow: 'hidden' }}>
          <Line first icon="toll" name={t('guardian.rewards')} desc={t('guardian.rewards.notOpen')}><span style={{ height: 20, padding: '0 7px', borderRadius: 10, boxShadow: '0 0 0 1px var(--line2) inset', color: 'var(--ink2)', display: 'inline-flex', alignItems: 'center', font: `500 10.5px ${FM}`, whiteSpace: 'nowrap', flex: 'none' }}>{t('guardian.rewards.badge')}</span></Line>
          <Line icon="tune" name={t('guardian.panel.levelLimits')} desc={p.gateway ? t('guardian.summary.withGateway', { summary: levelSummary(p) }) : levelSummary(p)} onClick={onEdit}><span style={{ ...ms(20), color: 'var(--ink3)' }}>chevron_right</span></Line>
          {p.gateway && <Line icon="cell_tower" name={t('guardian.gateway')} desc={st.gatewayOnline ? t('guardian.gateway.online', { count: st.gatewaySent, n: n(st.gatewaySent) }) : t('guardian.gateway.offline')} />}
          <Line icon="login" name={t('guardian.autoStart')} desc={t('guardian.autoStart.desc')}>
            <Switch46 on={p.autoStart} onChange={v => void window.piu.guardianUpdate({ autoStart: v }).catch(e => toast((e as Error).message, 'error'))} label={t('guardian.autoStart')} />
          </Line>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {s.status !== 'paused' && s.status !== 'changed' && <button className="a-97" onClick={act(() => window.piu.guardianPause(true))} style={pillOutline}><span style={ms(19)}>pause</span>{t('guardian.pause')}</button>}
          <button className="h-bg2" onClick={askEnd} style={{ height: 44, padding: '0 18px', border: 'none', borderRadius: 22, background: 'transparent', color: 'var(--ink)', font: `600 14.5px ${F}`, cursor: 'pointer' }}>{t('guardian.endPoint')}</button>
        </div>
      </div>
      <QrSide s={s} toast={toast} onPoster={() => setPoster(true)} />
      {poster && <Poster s={s} onClose={() => setPoster(false)} />}
    </div>
  );
}

/** "Nível e limites" depois de ativo (E4b com Salvar). */
function EditLevel({ s, onDone, toast }: { s: GuardianState; onDone: () => void; toast: (t: string, i?: string) => void }) {
  const t = useT();
  const p = s.point!;
  const [d, setD] = useState<Draft>({ level: p.level, storageMB: p.storageMB, days: p.days, gateway: p.gateway, name: p.name });
  const [internet, setInternet] = useState(p.gateway);
  useEffect(() => { if (!p.gateway) void window.piu.guardianTest().then(r => setInternet(r.internet)).catch(() => {}); }, [p.gateway]);
  const save = async () => {
    try { await window.piu.guardianUpdate({ name: d.name, level: d.level, storageMB: d.storageMB, days: d.days, gateway: d.gateway && internet }); toast(tNow('guardian.toast.saved'), 'tune'); onDone(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
      <Page title={t('guardian.howMuch')} sub={`${p.name} · ${p.network.label}`} actions={<><button className="h-bg2" onClick={onDone} style={btnGhost}>{t('common.back')}</button><button className="a-97" onClick={() => void save()} style={btnInk}>{t('common.save')}</button></>}>
        <LevelPicker d={d} set={x => setD(v => ({ ...v, ...x }))} internet={internet} apk={s.apk} />
        {d.level === 'multiplier' && p.level !== 'multiplier' && <Note icon="info">{t('guardian.edit.multiplierNote')}</Note>}
      </Page>
    </div>
  );
}

/** Tela "Ponto Piu" (rail): assistente enquanto não há ponto; painel depois. */
export function Guardian({ hostname, toast, setDialog, onCancel }: { hostname: string; toast: (t: string, i?: string) => void; setDialog: (d: DialogSpec | null) => void; onCancel: () => void }) {
  const [s, setS] = useState<GuardianState | null>(null);
  const [edit, setEdit] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void window.piu.guardianState().then(x => { if (live.current) setS(x); }).catch(() => {});
    const off = window.piu.on('guardian', setS);
    return () => { live.current = false; off(); };
  }, []);
  if (!s) return <div aria-busy="true" style={{ flex: 1, ...dots }} />;
  if (!s.point) return <Wizard s={s} hostname={hostname} onCancel={onCancel} onActivated={() => { void window.piu.guardianState().then(setS); }} toast={toast} />;
  if (edit) return <EditLevel s={s} toast={toast} onDone={() => setEdit(false)} />;
  return <Panel s={s} toast={toast} setDialog={setDialog} onEdit={() => setEdit(true)} />;
}

/** E4c: resumo do ponto em Ajustes → Rede (pausar e QR e cartaz). */
export function GuardianCard({ s, onOpen, toast }: { s: GuardianState; onOpen: () => void; toast: (t: string, i?: string) => void }) {
  const t = useT();
  const p = s.point!, st = s.stats!;
  return (
    <div style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Pulse on={s.status === 'active'} />{t(s.status === 'active' ? 'guardian.card.active' : s.status === 'paused' ? 'guardian.card.paused' : 'guardian.card.stopped', { level: levelName(p.level) })} · {p.network.label}</div>
      <Kv rows={[[t('guardian.card.peersToday'), n(st.peersToday)], [t('guardian.card.stored'), n(st.stored)], [t('guardian.space'), p.level === 'multiplier' ? t('guardian.nothingStored') : t('guardian.usedOf', { used: fmtBytes(st.storedBytes), total: fmtStorage(p.storageMB) })], [t('guardian.rewards'), t('guardian.rewardsOff')]]} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {s.status === 'paused'
          ? <button className="h-bg2" onClick={() => void window.piu.guardianPause(false).catch(e => toast((e as Error).message, 'error'))} style={btnGhost}>{t('guardian.resume')}</button>
          : <button className="h-bg2" onClick={() => void window.piu.guardianPause(true).catch(e => toast((e as Error).message, 'error'))} style={btnGhost}>{t('guardian.pause')}</button>}
        <button className="a-97" onClick={onOpen} style={{ ...btnInk, padding: '0 16px' }}>{t('guardian.card.qrPoster')}</button>
      </div>
    </div>
  );
}
