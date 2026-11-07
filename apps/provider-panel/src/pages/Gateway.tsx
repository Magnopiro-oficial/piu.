/**
 * Painel do Piu Node · gateway (Piu 12 · E3, E3a desligado, E3b caixa vazia, E3c nada na fila), com o
 * piu-node de verdade (`GET/PUT /api/gateway`). Estilos copiados do "Piu 12 Desktop briefing.dc.html".
 * Honesto: os contadores são os do gateway desde que o nó subiu (em memória; reiniciar zera), não "últimos
 * 7 dias"; a lista mostra o tipo da carga (o gateway não sabe por quantos saltos ela veio). Na demonstração
 * (sem piu-node), nenhum número de exemplo: só o aviso.
 * Ligar/desligar e a caixa do validador são do equipamento: só o dono, com código novo (step-up).
 */
import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { StepUpDialog } from '../components/Pair';
import { Icon, Toggle, useEscape } from '../components/ui';
import { useT } from '../i18n/react';
import { ApiError, type ApiGateway, type ApiGatewayItem, NeedsReauth } from '../lib/api';
import { fmtInt } from '../lib/format';
import { clock, fullDate } from '../lib/live';
import { useNode } from '../state/node';
import { useStore } from '../state/store';

const MONO = 'var(--mono)';
const card: CSSProperties = { borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 28, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 880 };
const label: CSSProperties = { font: `500 12px ${MONO}`, color: 'var(--ink2)', letterSpacing: '.04em' };
const stat: CSSProperties = { padding: '16px 18px', borderRadius: 18, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 2 };
const btnPrimary: CSSProperties = { height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: '600 14px var(--sans)', cursor: 'pointer' };

/** "8E41 … C07A": começo e fim da referência (hash da transação ou do pacote). */
export const shortRef = (ref: string) => { const h = ref.replace(/^0x/, '').toUpperCase(); return h.length > 8 ? `${h.slice(0, 4)} … ${h.slice(-4)}` : h; };
/** Caixa do validador sem o esquema, para caber na linha. */
export const shortInbox = (url: string) => url.replace(/^https:\/\//i, '').replace(/\/$/, '');

function Pulse() {
  return (
    <div style={{ position: 'relative', width: 8, height: 8, flex: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)' }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />
    </div>
  );
}

/** E3a / E3b: cartão de estado com ícone 44px, título, texto e uma ação. */
function StateCard({ icon, dark, title, body, cta, onCta }: { icon: string; dark?: boolean; title: string; body: string; cta?: string; onCta?: () => void }) {
  return (
    <div role={dark ? 'alert' : 'status'} style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: dark ? 'var(--ink)' : 'var(--bg2)', color: dark ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon name={icon} size={23} wght={dark ? undefined : 300} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{body}</div>
        </div>
      </div>
      {cta && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><button type="button" className="btn" onClick={onCta} style={btnPrimary}>{cta}</button></div>}
    </div>
  );
}

function Status({ it }: { it: ApiGatewayItem }) {
  const t = useT();
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
  if (it.status === 'queued') return <span style={row}><div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--bg3)', borderTopColor: 'var(--ink)', animation: 'piuSpin .9s linear infinite', flex: 'none' }} />{t('gw.row.queued')}</span>;
  const [icon, text] = it.status === 'invalid' ? ['cancel', it.reason ? t('gw.row.invalidWhy', { reason: it.reason }) : t('gw.row.invalid')]
    : it.status === 'error' ? ['error', t('gw.row.error', { reason: it.reason ?? '—' })]
    : it.status === 'finalized' ? ['verified', t('gw.row.finalized')]
    : it.status === 'included' ? ['check_circle', t('gw.row.included')]
    : it.status === 'accepted' ? ['inbox', t('gw.row.accepted')]
    : ['check_circle', t('gw.row.pool')];
  return <span style={row} title={it.reason ?? undefined}><Icon name={icon} size={16} fill={1} />{text}</span>;
}

/** Caixa do validador: https:// só (o nó confere de novo e devolve o motivo). */
function InboxDialog({ current, onSave, onClose }: { current: string | null; onSave: (url: string | null) => Promise<string | null>; onClose: () => void }) {
  const t = useT();
  const [v, setV] = useState(current ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(true, onClose);
  const save = async (url: string | null) => {
    if (busy) return;
    setBusy(true);
    const problem = await onSave(url);
    setBusy(false);
    if (problem) setErr(problem);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (v.trim()) void save(v.trim()); };
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45 }} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="gw-inbox-title" className="col dlg"
        style={{ position: 'fixed', left: '50%', top: '50%', width: 440, marginLeft: -220, transform: 'translateY(-50%)', zIndex: 46, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '26px 24px 20px', gap: 14 }}>
        <div className="row" style={{ gap: 10 }}><Icon name="inbox" size={26} wght={300} /><h2 id="gw-inbox-title" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{t('gw.dlg.title')}</h2></div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink2)' }}>{t('gw.dlg.body')}</p>
        <input value={v} onChange={e => { setV(e.target.value); setErr(null); }} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" aria-label={t('gw.dlg.title')} maxLength={512}
          className="mono" style={{ height: 46, borderRadius: 14, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 14px', fontSize: 13.5 }} autoFocus />
        {err && <div role="alert" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 12, border: '1px dashed var(--line2)' }}>{err}</div>}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {current && <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void save(null)} style={{ height: 40, padding: '0 16px', borderRadius: 20, marginRight: 'auto' }}>{t('gw.dlg.remove')}</button>}
          <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 40, padding: '0 16px', borderRadius: 20 }}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !v.trim()} style={{ height: 40, padding: '0 18px', borderRadius: 20, opacity: v.trim() ? 1 : 0.4 }}>{busy ? t('common.checking') : t('gw.dlg.save')}</button>
        </div>
      </form>
    </>,
    document.body,
  );
}

export function Gateway() {
  const t = useT();
  const node = useNode();
  const { api, devices, showToast, stepUp, settingsOwner } = useStore();
  const [g, setG] = useState<ApiGateway | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Mudança esperando o código novo do equipamento (step-up). */
  const [pending, setPending] = useState<{ enabled: boolean; inboxUrl: string | null } | null>(null);
  const load = useCallback(() => {
    if (!api) return;
    node.guard(api.gateway()).then(v => { setG(v); setFailed(false); }).catch(() => setFailed(true));
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); if (!api) return; const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [api, load]);

  /** Grava; `null` = deu certo; texto = motivo para mostrar. Pede o código quando o nó exige. */
  const save = async (v: { enabled: boolean; inboxUrl: string | null }): Promise<string | null> => {
    if (!api) return null;
    try {
      const r = await node.guard(api.setGateway(v));
      setG(cur => (cur && cur.available ? { ...cur, enabled: r.enabled, inboxUrl: r.inboxUrl, changedAt: r.changedAt } : cur));
      const before = g && g.available ? g : null;
      showToast({ icon: v.enabled ? 'cell_tower' : 'portable_wifi_off', title: before && before.enabled !== r.enabled ? (r.enabled ? t('gw.toast.on') : t('gw.toast.off')) : r.inboxUrl ? t('gw.toast.inbox') : t('gw.toast.inboxOff'), body: r.inboxUrl ? shortInbox(r.inboxUrl) : t('gw.toggleDesc') });
      setEditing(false);
      load();
      return null;
    } catch (e) {
      if (e instanceof NeedsReauth) { setPending(v); return null; }
      const msg = e instanceof ApiError ? e.message : t('common.tryAgain');
      showToast({ icon: 'error', title: t('gw.toast.fail'), body: msg });
      return msg;
    }
  };
  const confirmStepUp = async (code: string) => {
    const problem = await stepUp(code);
    if (problem) return problem;
    const v = pending;
    setPending(null);
    if (v) await save(v);
    return null;
  };

  const self = devices.find(d => d.telemetry === 'live');
  const name = self?.name ?? t('common.thisNode');
  const notOwner = !!api && settingsOwner === false;

  if (!api || failed || !g || !g.available) {
    const body = !api ? t('gw.na.demo') : !g ? '' : !g.available ? (g.reason === 'config' ? t('gw.na.config') : t('gw.na.relay')) : '';
    return (
      <div className="page-body" style={{ padding: '24px 32px 40px' }}>
        <div style={{ maxWidth: 880 }}>{(!api || (g && !g.available)) ? <StateCard icon="cell_tower" title={t('gw.na.title')} body={body} /> : failed ? <StateCard icon="error" dark title={t('gw.toast.fail')} body={t('common.tryAgain')} /> : <div aria-busy="true" style={{ height: 120 }} />}</div>
      </div>
    );
  }

  const on = g.enabled;
  const statusLine = !on ? t('gw.st.off') : g.online ? t('gw.st.on') : t('gw.st.noRoute');
  const c = g.counters;
  const toggle = () => { if (!notOwner) void save({ enabled: !on, inboxUrl: g.inboxUrl }); };

  return (
    <div className="page-body" style={{ padding: '24px 32px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-label={t('nav.gateway')} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--bg2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="dns" size={25} wght={300} /></div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div className="ellipsis" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('gw.title', { name })}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink2)' }}>{on && g.online ? <Pulse /> : <div style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ink2)', flex: 'none' }} />}{statusLine}</div>
          </div>
        </div>

        {!on ? (
          <StateCard icon="cell_tower" title={t('gw.off.title')} body={t('gw.off.body')} cta={notOwner ? undefined : t('gw.off.cta')} onCta={toggle} />
        ) : (
          <>
            <div style={label}>{t('gw.since', { date: g.startedAt ? `${fullDate(g.startedAt).toUpperCase()} · ${clock(g.startedAt)}` : '—' })}</div>
            <div className="gw-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
              {([[c.sent, t('gw.sent')], [c.refused, t('gw.refused')], [c.queued, t('gw.queued')]] as const).map(([n, l]) => (
                <div key={l} style={stat}><span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(n)}</span><span style={{ fontSize: 13, color: 'var(--ink2)' }}>{l}</span></div>
              ))}
            </div>
            {g.recent.length === 0 ? (
              // E3c: substitui a lista.
              <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', padding: '16px 8px' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="cell_tower" size={30} wght={300} /></div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('gw.empty.title')}</div>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, maxWidth: 300, textWrap: 'pretty' }}>{t('gw.empty.body')}</div>
              </div>
            ) : (
              <div role="list" style={{ display: 'flex', flexDirection: 'column' }}>
                {g.recent.slice(0, 8).map((it, i) => (
                  <div role="listitem" key={it.ref} className="gw-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 70px', alignItems: 'center', gap: 12, padding: '11px 0', fontSize: 13.5, borderTop: i ? '1px solid var(--line)' : undefined }}>
                    <span title={it.ref} style={{ font: `500 12.5px ${MONO}`, color: 'var(--ink)' }}>{shortRef(it.ref)}</span>
                    <span style={{ color: 'var(--ink2)' }}>{it.kind === 'tx' ? t('gw.kind.tx') : t('gw.kind.evidence')}</span>
                    <Status it={it} />
                    <span style={{ font: `500 12px ${MONO}`, color: 'var(--ink2)' }}>{clock(it.at * 1000)}</span>
                  </div>
                ))}
              </div>
            )}
            {!g.inboxUrl && <StateCard icon="inbox" dark title={t('gw.noInbox.title')} body={t('gw.noInbox.body')} cta={notOwner ? undefined : t('gw.noInbox.cta')} onCta={() => setEditing(true)} />}
          </>
        )}

        <div style={label}>{t('gw.settings')}</div>
        <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
            <Icon name="cell_tower" size={21} wght={300} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 550 }}>{t('gw.toggle')}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35, textWrap: 'pretty' }}>{notOwner ? t('gw.notOwner') : t('gw.toggleDesc')}</div>
            </div>
            <Toggle on={on} onChange={toggle} label={t('gw.toggle')} disabled={notOwner} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: '1px solid var(--line)' }}>
            <Icon name="inbox" size={21} wght={300} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 550 }}>{t('gw.inbox')}</div>
              <div className="ellipsis" style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>
                {g.inboxUrl ? <><span title={g.inboxUrl} style={{ fontFamily: MONO }}>{shortInbox(g.inboxUrl)}</span> · {t('gw.inboxDesc')}</> : <>{t('gw.inboxNone')} · {t('gw.inboxDesc')}</>}
              </div>
            </div>
            {!notOwner && <button type="button" className="btn" onClick={() => setEditing(true)} style={{ height: 32, padding: '0 13px', border: 'none', borderRadius: 16, background: 'var(--bg)', color: 'var(--ink)', boxShadow: '0 0 0 1px var(--line2) inset', font: '600 13px var(--sans)', flex: 'none', whiteSpace: 'nowrap' }}>{t('gw.edit')}</button>}
          </div>
        </div>
      </section>
      {editing && <InboxDialog current={g.inboxUrl} onClose={() => setEditing(false)} onSave={url => save({ enabled: on, inboxUrl: url })} />}
      {pending && <StepUpDialog reason={t('gw.stepup')} confirmLabel={t('gw.confirm')} onConfirm={confirmStepUp} onClose={() => setPending(null)} />}
    </div>
  );
}
