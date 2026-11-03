import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, pair } from '../lib/api';
import { useNode } from '../state/node';
import { Icon } from './ui';

const onlyDigits = (s: string) => s.replace(/\D/g, '').slice(0, 8);

const field = { height: 46, borderRadius: 14, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 14px', fontSize: 15 } as const;

/**
 * Pareamento do navegador com o piu-node: o código de 8 dígitos aparece só na tela/console do
 * equipamento (prova de acesso físico). Sem ele, nenhuma ação do painel é possível.
 */
export function PairScreen() {
  const { mode, enter } = useNode();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(mode.kind === 'pair' ? mode.reason ?? null : null);
  const ok = code.length === 8 && name.trim().length > 0 && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const r = await pair(code, name.trim());
      enter(r.operator, r.csrf);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Não foi possível falar com o equipamento.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--ink)' }}>
      <form onSubmit={submit} className="col pair-form" aria-labelledby="pair-title" style={{ width: 420, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', gap: 18, padding: 32, borderRadius: 28, boxShadow: '0 0 0 1px var(--line2) inset' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: '-0.07em', lineHeight: 1 }}>piu<span style={{ color: 'var(--ink3)' }}>.</span></div>
          <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '.06em', padding: '2px 7px', borderRadius: 6, border: '1px solid var(--line2)', color: 'var(--ink2)' }}>PROVIDER</div>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <h1 id="pair-title" style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em' }}>Parear este navegador</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--ink2)' }}>Digite o código de 8 dígitos que aparece na tela ou no console do equipamento. Ele vale 10 minutos e uma única vez.</p>
        </div>
        <label className="col" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 550 }}>Código do equipamento</span>
          <input value={code} onChange={e => setCode(onlyDigits(e.target.value))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000 0000" aria-describedby={err ? 'pair-err' : undefined}
            className="mono" style={{ ...field, fontSize: 22, letterSpacing: '.18em', textAlign: 'center' }} autoFocus />
        </label>
        <label className="col" style={{ gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 550 }}>Seu nome</span>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} autoComplete="name" placeholder="Como o equipamento vai identificar você" style={field} />
        </label>
        {err && (
          <div id="pair-err" role="alert" className="row" style={{ gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 13, lineHeight: 1.4 }}>
            <Icon name="error" size={18} />{err}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={!ok} style={{ height: 48, borderRadius: 24, fontSize: 15, fontWeight: 600, opacity: ok ? 1 : 0.4 }}>
          {busy ? 'Conferindo…' : 'Parear'}
        </button>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
          <Icon name="verified_user" size={17} />
          <span>Antes de digitar, confira se a impressão digital do certificado (no cadeado do navegador) é a mesma mostrada pelo equipamento.</span>
        </div>
      </form>
    </main>
  );
}

/** Confirmação com um código novo do equipamento antes de uma operação sensível (transferir LUNES, backup e rotação da chave). */
export function StepUpDialog({ onConfirm, onClose, reason = 'Transferências exigem uma confirmação recente.', confirmLabel = 'Confirmar e transferir' }: {
  onConfirm: (code: string) => Promise<string | null>; onClose: () => void; reason?: string; confirmLabel?: string;
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 8 || busy) return;
    setBusy(true);
    const problem = await onConfirm(code);
    setBusy(false);
    if (problem) { setErr(problem); setCode(''); }
  };
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45 }} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="stepup-title" className="col dlg"
        style={{ position: 'fixed', left: '50%', top: '50%', width: 400, marginLeft: -200, transform: 'translateY(-50%)', zIndex: 46, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '26px 24px 20px', gap: 14 }}>
        <div className="row" style={{ gap: 10 }}><Icon name="lock_clock" size={26} wght={300} /><h2 id="stepup-title" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Confirme no equipamento</h2></div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink2)' }}>{reason} Digite o código novo que aparece na tela do equipamento.</p>
        <input value={code} onChange={e => setCode(onlyDigits(e.target.value))} inputMode="numeric" autoComplete="one-time-code" aria-label="Código do equipamento" placeholder="0000 0000"
          className="mono" style={{ ...field, fontSize: 22, letterSpacing: '.18em', textAlign: 'center' }} autoFocus />
        {err && <div role="alert" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 12, border: '1px dashed var(--line2)' }}>{err}</div>}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 40, padding: '0 16px', borderRadius: 20 }}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={code.length !== 8 || busy} style={{ height: 40, padding: '0 18px', borderRadius: 20, opacity: code.length === 8 ? 1 : 0.4 }}>{busy ? 'Conferindo…' : confirmLabel}</button>
        </div>
      </form>
    </>,
    document.body,
  );
}

/** Senha do backup cifrado da chave de operador (escolhida aqui; o nó cifra com ela e não guarda). */
export function PasswordDialog({ onConfirm, onClose }: { onConfirm: (password: string) => Promise<string | null>; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = pw.length < 10 ? 'Use pelo menos 10 caracteres.' : new Set(pw).size < 5 ? 'Senha repetitiva demais.' : pw !== again ? 'As duas senhas não conferem.' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    const p = await onConfirm(pw);
    setBusy(false);
    if (p) setErr(p);
  };
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45 }} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="pw-title" className="col dlg"
        style={{ position: 'fixed', left: '50%', top: '50%', width: 400, marginLeft: -200, transform: 'translateY(-50%)', zIndex: 46, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '26px 24px 20px', gap: 12 }}>
        <div className="row" style={{ gap: 10 }}><Icon name="key" size={26} wght={300} /><h2 id="pw-title" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Exportar backup cifrado</h2></div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink2)' }}>Escolha uma senha para proteger o arquivo. Sem ela, ninguém abre o backup, nem você: guarde-a separada do arquivo.</p>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(null); }} autoComplete="new-password" aria-label="Senha do backup" placeholder="Senha (10 caracteres ou mais)" style={field} autoFocus />
        <input type="password" value={again} onChange={e => { setAgain(e.target.value); setErr(null); }} autoComplete="new-password" aria-label="Repita a senha" placeholder="Repita a senha" style={field} />
        <div aria-live="polite" style={{ fontSize: 12.5, color: 'var(--ink2)', minHeight: 17 }}>{err ?? (pw ? problem ?? 'Senha boa.' : '')}</div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 40, padding: '0 16px', borderRadius: 20 }}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!!problem || busy} style={{ height: 40, padding: '0 18px', borderRadius: 20, opacity: problem ? 0.4 : 1 }}>{busy ? 'Cifrando…' : 'Exportar'}</button>
        </div>
      </form>
    </>,
    document.body,
  );
}

/** Tamanho máximo do arquivo de backup que o nó aceita (`POST /api/operator/restore`). */
const MAX_BACKUP_BYTES = 256 * 1024;

/**
 * Restaurar o backup cifrado da chave de operador neste nó (`piu-operador.backup` + a senha dele).
 * O nó confere a senha e o arquivo; a chave deste operador neste nó passa a ser a do arquivo. A
 * confirmação recente (step-up) é pedida por quem abre o diálogo, quando o nó exigir.
 */
export function RestoreDialog({ onConfirm, onClose }: { onConfirm: (backup: string, password: string) => Promise<string | null>; onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    setErr(null); setFile(null);
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) { setErr('Arquivo grande demais para um backup de operador.'); return; }
    try { setFile({ name: f.name, text: await f.text() }); } catch { setErr('Não foi possível ler o arquivo.'); }
  };
  const problem = !file ? 'Escolha o arquivo do backup.' : !pw ? 'Digite a senha do backup.' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || busy || !file) return;
    setBusy(true);
    const p = await onConfirm(file.text, pw);
    setBusy(false);
    if (p) setErr(p);
  };
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45 }} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="restore-title" className="col dlg"
        style={{ position: 'fixed', left: '50%', top: '50%', width: 420, marginLeft: -210, transform: 'translateY(-50%)', zIndex: 46, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '26px 24px 20px', gap: 12 }}>
        <div className="row" style={{ gap: 10 }}><Icon name="settings_backup_restore" size={26} wght={300} /><h2 id="restore-title" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Restaurar backup da chave</h2></div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
          A chave de operador deste nó passa a ser a do arquivo. Use para pôr outro nó seu sob a mesma chave, ou para trazer a chave nova depois de uma rotação feita em outro equipamento. Os equipamentos registrados aqui são assinados de novo.
        </p>
        <label className="col" style={{ gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Arquivo do backup (piu-operador.backup)</span>
          <input type="file" accept=".backup,application/octet-stream,application/json,text/plain" onChange={e => void pick(e.target.files?.[0])}
            style={{ fontSize: 13, color: 'var(--ink)', maxWidth: '100%' }} />
        </label>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(null); }} autoComplete="current-password" aria-label="Senha do backup" placeholder="Senha do backup" style={field} />
        <div aria-live="polite" style={{ fontSize: 12.5, color: 'var(--ink2)', minHeight: 17 }}>{err ?? (file ? `${file.name} · ${Math.max(1, Math.ceil(file.text.length / 1024))} KB` : '')}</div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 40, padding: '0 16px', borderRadius: 20 }}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!!problem || busy} style={{ height: 40, padding: '0 18px', borderRadius: 20, opacity: problem ? 0.4 : 1 }}>{busy ? 'Conferindo…' : 'Restaurar'}</button>
        </div>
      </form>
    </>,
    document.body,
  );
}
