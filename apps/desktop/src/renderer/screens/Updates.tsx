/**
 * Atualização (D3 diálogo · D3b baixando · D3e assinatura não confere · aviso no fim da lista), do
 * "Piu 10 Desktop telas novas.dc.html". Estilos copiados do protótipo; textos ajustados ao que é real:
 * o pacote vem do GitHub (não "pela malha"), a lista de hashes é conferida pela assinatura OpenPGP da
 * chave fixada no app e o pacote pelo SHA-256. No macOS e no .deb, "atualizar" abre o instalador do sistema.
 */
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import type { UpdateState } from '../../shared/types';
import { fmtBytes } from '../format';
import { fmtDate, t as tNow, useT } from '../i18n';
import { F, FM } from '../ui';

const MS = "'Material Symbols Rounded'";
type Ready = Extract<UpdateState, { state: 'ready' }>;

const archLabel = (a: string) => (a === 'arm64' ? 'Apple Silicon / ARM' : a === 'x64' ? tNow('updates.arch.x64') : a);
export function installLabel(s: Ready) {
  return s.install === 'appimage' ? tNow('updates.install.appimage') : s.install === 'dmg' ? tNow('updates.install.dmg') : s.install === 'dev' ? tNow('updates.install.dev') : tNow('updates.install.other');
}
function installNote(s: Ready) {
  switch (s.install) {
    case 'appimage': return tNow('updates.note.appimage');
    case 'dmg': return tNow('updates.note.dmg');
    case 'deb': return tNow('updates.note.deb');
    case 'nsis': return tNow('updates.note.nsis');
    case 'dev': return tNow('updates.note.dev');
  }
}

/** D3: só com o pacote baixado e conferido. "Depois" fecha; o aviso continua no fim da lista. */
export function UpdateDialog({ s, top, onClose, onInstall }: { s: Ready; top: number; onClose: () => void; onInstall: () => void }) {
  const t = useT();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const i = s.info;
  return (
    <div style={{ position: 'absolute', inset: `${top}px 0 0 0`, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, animation: 'piuFade .25s both' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('updates.dialog.ready', { version: i.version })} onClick={e => e.stopPropagation()} style={{ width: 480, borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px -20px rgba(0,0,0,.45)', padding: 26, display: 'flex', flexDirection: 'column', gap: 18, animation: 'piuDialog .4s cubic-bezier(.2,.9,.3,1.25) both' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ fontFamily: MS, fontSize: 25, lineHeight: 1, fontVariationSettings: "'wght' 300" }}>system_update_alt</span></div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('updates.dialog.ready', { version: i.version })}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('updates.youAreOn', { current: i.current })} {installNote(s)}</div>
          </div>
        </div>
        <div style={{ borderRadius: 18, background: 'var(--bg2)', padding: '2px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13.5 }}><span style={{ color: 'var(--ink2)' }}>{t('updates.dialog.from')}</span><span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 550 }}><span style={{ fontFamily: MS, fontSize: 16, lineHeight: 1 }}>cloud_download</span>{t('updates.dialog.fromValue')}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13.5, borderTop: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>{t('updates.dialog.signature')}</span><span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 550 }}><span style={{ fontFamily: MS, fontSize: 16, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>verified</span>{t('updates.dialog.signatureValue', { signer: s.signer })}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 13.5, borderTop: '1px solid var(--line)' }}><span style={{ color: 'var(--ink2)' }}>{t('updates.dialog.size')}</span><span style={{ fontWeight: 550 }}>{fmtBytes(i.size)} · {archLabel(i.arch)}</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{t('updates.dialog.changes')}</div>
          {(i.notes.length ? i.notes : [t('updates.dialog.noNotes')]).map((n, k) => (
            <div key={k} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.4 }}><span style={{ color: 'var(--ink3)' }}>—</span>{n}</div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink2)' }}>{t('updates.dialog.keep')}</div>
          {s.install !== 'dev' && <button className="h-bg2" onClick={onClose} style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' }}>{t('updates.dialog.later')}</button>}
          <button className="a-97" onClick={s.install === 'dev' ? onClose : onInstall} style={{ height: 40, padding: '0 18px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' }}>{installLabel(s)}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Aviso no fim da lista de conversas: E2f "Piu X disponível · Você está na Y · Ver" (com "Avisar" ligado)
 * e, depois de baixado e conferido a pedido da pessoa, "Piu X pronto" (D3). "Ver" abre Sistema → Atualizações.
 */
export function UpdateBanner({ s, onOpen }: { s: Extract<UpdateState, { state: 'available' | 'ready' }>; onOpen: () => void }) {
  const t = useT();
  const ready = s.state === 'ready';
  return (
    <div style={{ margin: '0 12px 14px', padding: '12px 14px', borderRadius: 16, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', gap: 10, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' }}>
      <span style={{ fontFamily: MS, fontSize: 20, lineHeight: 1 }}>system_update_alt</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ready ? t('updates.banner.ready', { version: s.info.version }) : t('updates.available', { version: s.info.version })}</div>
        <div style={{ fontSize: 12, opacity: .72 }}>{ready ? (s.install === 'appimage' ? t('updates.banner.installOnRestart') : t('updates.banner.signed')) : t('updates.banner.youAreOn', { current: s.info.current })}</div>
      </div>
      <button className="a-94" onClick={onOpen} style={{ height: 28, padding: '0 11px', border: 'none', borderRadius: 14, background: 'var(--invink)', color: 'var(--ink)', display: 'flex', alignItems: 'center', font: `600 12px ${F}`, cursor: 'pointer' }}>{ready ? (s.install === 'appimage' ? t('updates.banner.restart') : t('updates.banner.install')) : t('updates.see')}</button>
    </div>
  );
}

/** Aviso de disco quase cheio no fim da lista (D4e). */
export function DiskBanner({ free, onOpen }: { free: number; onOpen: () => void }) {
  const t = useT();
  return (
    <div style={{ margin: '0 12px 14px', padding: '12px 14px', borderRadius: 16, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', gap: 10, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' }}>
      <span style={{ fontFamily: MS, fontSize: 20, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>hard_drive</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t('updates.disk.low', { free: fmtBytes(free) })}</div>
        <div style={{ fontSize: 12, opacity: .72 }}>{t('updates.disk.see')}</div>
      </div>
      <button className="a-94" onClick={onOpen} style={{ height: 28, padding: '0 11px', border: 'none', borderRadius: 14, background: 'var(--invink)', color: 'var(--ink)', display: 'flex', alignItems: 'center', font: `600 12px ${F}`, cursor: 'pointer' }}>{t('updates.see')}</button>
    </div>
  );
}

const card = { borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 16, marginTop: 14, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' };

/** D3b: só aparece em Sistema → Atualizações enquanto baixa e confere. */
export function UpdateProgress({ s }: { s: Extract<UpdateState, { state: 'downloading' }> }) {
  const t = useT();
  const start = useRef<{ t: number; b: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  if (s.step === 'package' && !start.current) start.current = { t: Date.now(), b: s.received };
  const pct = s.total ? Math.min(100, (s.received / s.total) * 100) : 0;
  let eta = '';
  if (s.step === 'package' && start.current) {
    const dt = (Date.now() - start.current.t) / 1000, db = s.received - start.current.b;
    if (dt > 2 && db > 0) { const sec = (s.total - s.received) / (db / dt); eta = sec < 60 ? t('updates.eta.lt1') : t('updates.eta.min', { n: Math.round(sec / 60) }); }
  }
  const order = ['sums', 'package', 'hash'] as const;
  const at = order.indexOf(s.step);
  // Concluído, em andamento e por fazer (o "por fazer" é o concluído sem "conferido").
  const steps: [string, string, string][] = order.map(k => [t(`updates.step.${k}.done` as const), t(`updates.step.${k}.doing` as const), t(`updates.step.${k}.todo` as const)]);
  return (
    <div style={card} role="status" aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ fontFamily: MS, fontSize: 25, lineHeight: 1, fontVariationSettings: "'wght' 300" }}>downloading</span></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}><div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('updates.progress.title', { version: s.info.version })}</div><div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('updates.progress.from', { asset: s.info.asset ?? '' })}</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}><div style={{ width: `${s.step === 'hash' ? 100 : pct}%`, height: '100%', borderRadius: 4, background: 'var(--ink)', transition: 'width .3s' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${FM}`, color: 'var(--ink2)' }}><span>{t('updates.progress.bytes', { received: fmtBytes(s.received), total: fmtBytes(s.total) })}</span><span>{eta}</span></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
        {steps.map(([done, doing, todo], k) => k < at ? (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontFamily: MS, fontSize: 18, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}>check_circle</span>{done}</div>
        ) : k === at ? (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--bg3)', borderTopColor: 'var(--ink)', animation: 'piuSpin .9s linear infinite' }} />{doing}</div>
        ) : (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink3)' }}><span style={{ fontFamily: MS, fontSize: 18, lineHeight: 1 }}>radio_button_unchecked</span>{todo}</div>
        ))}
      </div>
    </div>
  );
}

/** D3e: o arquivo já foi apagado; nada foi instalado. */
export function UpdateRejected({ s, onClose, onPage }: { s: Extract<UpdateState, { state: 'bad' }>; onClose: () => void; onPage: () => void }) {
  const t = useT();
  const why = s.reason === 'signature' ? t('updates.bad.signature') : s.reason === 'hash' ? t('updates.bad.hash') : t('updates.bad.missing');
  return (
    <div style={card} role="alert">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ fontFamily: MS, fontSize: 25, lineHeight: 1 }}>gpp_bad</span></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('updates.bad.title')}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{t('updates.bad.body', { why, current: s.info.current })}</div>
        </div>
      </div>
      <div className="sel" style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--bg2)', font: `400 11.5px ${FM}`, color: 'var(--ink2)', lineHeight: 1.6 }}>{t('updates.bad.detail', { expected: s.expected, got: s.got, ellipsis: /^[0-9a-f]+$/.test(s.got) ? '…' : '' })}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="h-bg2" onClick={onClose} style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' }}>{t('common.close')}</button>
        <button className="a-97" onClick={onPage} style={{ height: 40, padding: '0 18px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' }}>{t('updates.bad.otherSource')}</button>
      </div>
    </div>
  );
}

// ── E2 Sistema → Atualizações (Piu 12) ─────────────────────
const MSf = (w?: number, fill?: 0 | 1): CSSProperties => ({ fontFamily: MS, lineHeight: 1, ...(w || fill ? { fontVariationSettings: [fill ? "'FILL' 1" : null, w ? `'wght' ${w}` : null].filter(Boolean).join(', ') } : {}) });
const resultCard: CSSProperties = { borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' };
const btnGhost: CSSProperties = { height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' };
const btnInk: CSSProperties = { height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' };

/** "hoje, 09:12" / "6 nov., 09:12". */
export function whenShort(ms: number, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const time = fmtDate(d, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === n.toDateString() ? tNow('common.today', { time }) : tNow('common.dateTime', { date: fmtDate(d, { day: 'numeric', month: 'short' }).replace('.', ''), time });
}

/** Interruptor do Piu 12 (46×28, botão 22). */
export function Switch46({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <div role="switch" aria-checked={on} aria-label={label} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={() => !disabled && onChange(!on)} onKeyDown={e => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!on); } }}
      style={{ width: 46, height: 28, borderRadius: 14, background: on ? 'var(--ink)' : 'var(--bg3)', position: 'relative', flex: 'none', cursor: disabled ? 'default' : 'pointer', transition: 'background .25s', opacity: disabled ? .4 : 1 }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: on ? 'var(--invink)' : '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .35s cubic-bezier(.2,.9,.3,1.5)' }} />
    </div>
  );
}

/** Linha do Piu 12: ícone 21 (wght 300) solto, nome 15/550, descrição 12.5. */
export function Line({ icon, name, desc, first, children }: { icon: string; name: string; desc?: ReactNode; first?: boolean; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: first ? undefined : '1px solid var(--line)' }}>
      <span style={{ ...MSf(300), fontSize: 21 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 550 }}>{name}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35, textWrap: 'pretty' }}>{desc}</div>}
      </div>
      {children}
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

function Head({ icon, ink, spin, title, body }: { icon?: string; ink?: boolean; spin?: boolean; title: string; body?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: spin ? 14 : 13, background: ink ? 'var(--ink)' : 'var(--bg2)', color: ink ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        {spin ? <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--bg3)', borderTopColor: 'var(--ink)', animation: 'piuSpin .9s linear infinite', flex: 'none' }} /> : <span style={{ ...MSf(ink ? undefined : 300), fontSize: 23 }}>{icon}</span>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
        {body !== undefined && <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{body}</div>}
      </div>
    </div>
  );
}

/**
 * Resultado de "Verificar agora" (E2a verificando · E2b em dia · E2c versão nova · E2d sem internet ·
 * E2e erro do GitHub), logo abaixo das linhas. Versão nova: abre a página da versão; com a chave do
 * projeto no app e pacote deste sistema assinado, também "Baixar e conferir" (assinatura OpenPGP + SHA-256),
 * e só depois pergunta antes de reiniciar (D3). Nada instala sozinho.
 */
export function UpdateResult({ u, version, onClose, onCheck, onPage, onDownload }: { u: UpdateState; version: string; onClose: () => void; onCheck: () => void; onPage: (url: string) => void; onDownload: () => void }) {
  const t = useT();
  switch (u.state) {
    case 'checking': return <div style={resultCard} role="status" aria-live="polite"><Head spin title={t('updates.checking')} body={t('updates.checking.body')} /></div>;
    case 'latest': return (
      <div style={resultCard} role="status">
        <Head icon="check_circle" title={t('updates.latest.title')} body="" />
        <Kv rows={[[t('updates.kv.installed'), u.current], [t('updates.kv.newest'), u.current]]} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><button className="a-97" onClick={onClose} style={btnInk}>{t('common.close')}</button></div>
      </div>
    );
    case 'available': {
      const canVerify = u.verify === 'ok';
      return (
        <div style={{ padding: '18px 20px', borderRadius: 20, boxShadow: '0 0 0 1.5px var(--ink) inset', display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .45s cubic-bezier(.2,.85,.3,1) both' }} role="status">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ ...MSf(), fontSize: 23 }}>system_update_alt</span></div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('updates.available', { version: u.info.version })}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{canVerify
                ? t('updates.available.verify', { current: u.info.current })
                : t('updates.available.manual', { current: u.info.current })}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button className="h-bg2" onClick={onClose} style={btnGhost}>{t('common.close')}</button>
            {canVerify ? <>
              <button className="h-bg2" onClick={() => onPage(u.info.url)} style={btnGhost}>{t('updates.openPage')}</button>
              <button className="a-97" onClick={onDownload} style={btnInk}>{t('updates.downloadVerify')}</button>
            </> : <button className="a-97" onClick={() => onPage(u.info.url)} style={btnInk}>{t('updates.openPage')}</button>}
          </div>
        </div>
      );
    }
    case 'error': {
      const offline = u.kind === 'offline';
      return (
        <div style={{ ...resultCard, animation: 'piuShake .45s ease-in-out both' }} role="alert">
          {offline ? <Head icon="wifi_off" ink title={t('updates.offline.title')} body={t('updates.offline.body')} />
            : u.kind === 'github' ? <Head icon="cloud_off" ink title={t('updates.github.title')} body={t('updates.github.body')} />
            : <Head icon="error" ink title={t('updates.error.title')} body={u.message} />}
          <Kv rows={[[t('updates.kv.installed'), version]]} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {offline ? <button className="h-bg2" onClick={onClose} style={btnGhost}>{t('common.close')}</button>
              : <button className="h-bg2" onClick={() => onPage(u.info?.url ?? RELEASES_PAGE)} style={btnGhost}>{t('updates.openPage')}</button>}
            <button className="a-97" onClick={onCheck} style={btnInk}>{t('updates.retry')}</button>
          </div>
        </div>
      );
    }
    default: return null;
  }
}

/** Página de releases do projeto (o main só abre endereços do próprio repositório). */
export const RELEASES_PAGE = 'https://github.com/Magnopiro-oficial/piu./releases/';
