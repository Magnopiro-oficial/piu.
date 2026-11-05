import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { StepUpDialog } from '../components/Pair';
import { Icon, Segmented, growX } from '../components/ui';
import { useT } from '../i18n/react';
import { ApiError, NeedsReauth, type ApiClaims } from '../lib/api';
import { downloadText } from '../lib/io';
import { fmt, fmtInt } from '../lib/format';
import { dayKeyOf, dayLabel, historyOn, monthDays, monthName, receiptsOn, relayOn, sum, weeks } from '../lib/live';
import { useStore } from '../state/store';

const DAY_COLS = 'minmax(0,1.1fr) repeat(4,minmax(0,1fr))';
const head = { padding: '10px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' } as const;

/**
 * Ganhos com o piu-node: o que o nó comprova (recibos por dia e por semana) e o que já foi pago
 * (entradas reais da carteira). Valor por recibo, validados e rejeitados dependem do validador.
 */
export function EarningsLive() {
  const t = useT();
  const { live, txs } = useStore();
  const h = historyOn(live), rc = receiptsOn(live);
  const month = sum(monthDays(h));
  const paid = txs.filter(t => (t.amount ?? 0) > 0);
  const paidTotal = paid.reduce((a, t) => a + (t.amount ?? 0), 0);
  const days = [...(h?.days ?? [])].reverse().slice(0, 14);
  const ws = weeks(h);
  const wmax = Math.max(1, ...ws.map(w => w.totals.receipts));
  const mon = h ? monthName(h.today) : t('ovl.thisMonth');

  const tiles: [string, string, string, boolean, number][] = [
    [t('ea.paid'), fmt(paidTotal), paid.length ? t('el.paidSub', { count: paid.length }) : t('el.noLotPaid'), true, 1],
    [t('el.receiptsIn', { month: mon }), fmtInt(month.receipts), t('el.signedBy'), false, 0.6],
    [t('el.awaitingValidation'), fmtInt(rc?.keptOwn ?? 0), t('el.keptUntil'), false, 0.32],
    [t('ea.rejected'), '—', t('el.validatorSilent'), false, 0.14],
  ];

  return (
    <div className="grid12 page-body">
      {tiles.map(([l, v, d, ink, op]) => (
        <div key={l} className="span3 col" style={{ padding: 18, borderRadius: 20, background: ink ? 'var(--ink)' : 'var(--bg2)', color: ink ? 'var(--invink)' : 'var(--ink)', gap: 8 }}>
          <div className="row" style={{ gap: 8, fontSize: 12.5, opacity: 0.75 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor', opacity: op }} />{l}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.04em' }}>{v}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{d}</div>
        </div>
      ))}

      <section className="span7 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>{t('el.byDay')}</h2>
        <div className="mono tbl-head" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, ...head }}>
          <span>{t('el.colDay')}</span><span style={{ textAlign: 'right' }}>{t('el.colReceived')}</span><span style={{ textAlign: 'right' }}>{t('el.colFwd')}</span><span style={{ textAlign: 'right' }}>{t('el.colDup')}</span><span style={{ textAlign: 'right' }}>{t('el.colReceipts')}</span>
        </div>
        {days.map(d => (
          <div key={d.day} className="tbl-row" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
            <span style={{ fontWeight: 600 }}>{d.day === h?.today ? t('common.today') : dayLabel(d.day)}</span>
            <span className="tnum" data-label={t('el.lblReceived')} style={{ textAlign: 'right' }}>{fmtInt(d.received)}</span>
            <span className="tnum" data-label={t('el.lblFwd')} style={{ textAlign: 'right' }}>{fmtInt(d.forwarded)}</span>
            <span className="tnum" data-label={t('el.lblDup')} style={{ textAlign: 'right', color: 'var(--ink2)' }}>{fmtInt(d.duplicates)}</span>
            <span className="tnum" data-label={t('el.lblReceipts')} style={{ textAlign: 'right', fontWeight: 650 }}>{fmtInt(d.receipts)}</span>
          </div>
        ))}
        {!days.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>{h ? t('el.noDays') : t('el.relayOff')}</div>}
        <div className="mono" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink2)' }}>{t('el.footNote')}</div>
      </section>

      <section className="span5 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <h2 className="h-card" style={{ margin: 0 }}>{t('el.byWeek')}</h2>
        {ws.map(w => (
          <div key={w.start} className="col" style={{ gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>{t('el.weekOf', { d: dayLabel(w.start) })}</span>
              <span className="tnum" style={{ fontWeight: 650 }}>{t('el.receiptsN', { n: fmtInt(w.totals.receipts) })}</span>
            </div>
            <div className="track" style={{ height: 6 }}><div style={{ width: ((w.totals.receipts / wmax) * 100).toFixed(0) + '%', animation: growX() }} /></div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{t('el.weekMeta', { fwd: fmtInt(w.totals.forwarded), dup: fmtInt(w.totals.duplicates) })}</div>
          </div>
        ))}
        {!ws.length && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('el.noWeeks')}</div>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('el.onlySelf')}</div>
      </section>

      <section className="span12 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>{t('ea.lots')}</h2>
        {paid.map(t => (
          <div key={t.id} className="row" style={{ gap: 12, padding: '13px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5, flexWrap: 'wrap' }}>
            <Icon name="check_circle" size={17} fill={1} />
            <span className="grow" style={{ fontWeight: 600 }}>{t.title}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{t.date}</span>
            <span className="tnum" style={{ fontWeight: 650 }}>{t.value}</span>
          </div>
        ))}
        {!paid.length && (
          <div style={{ padding: '18px', borderTop: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
            {t('el.noLots')}
          </div>
        )}
      </section>

      <LotWallet />

      <div className="span12" style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
        <Icon name="policy" size={17} style={{ color: 'var(--ink)' }} />
        <span>{t('ea.policyNote')}</span>
      </div>
    </div>
  );
}

/** Forma de um endereço SS58 de 32 bytes (base58, 47–48 caracteres). O nó confere a soma de verificação. */
const looksLikeAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(a.trim());
const shortAddress = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/**
 * Carteira do lote (proposta econômica, seção 7): o nó assina, com a chave técnica dele, a carteira
 * LUNES que recebe o lote desta semana ou da próxima, e o operador leva ao validador esse arquivo e
 * o das evidências (recibos).
 */
function LotWallet() {
  const t = useT();
  const { api, live, showToast, stepUp } = useStore();
  const receiptsCount = receiptsOn(live)?.kept ?? 0;
  const [claims, setClaims] = useState<ApiClaims | null>(null);
  const [epoch, setEpoch] = useState<string>('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const load = useCallback(() => { api?.claims().then(c => { setClaims(c); setEpoch(e => e || c.epochs[0] || ''); }).catch(() => {}); }, [api]);
  useEffect(load, [load]);
  const node = relayOn(live)?.node ?? '';
  if (!api || !claims) return null;

  const declared = claims.claims.find(c => c.epoch === epoch);
  const declare = async () => {
    setBusy(true); setErr(null);
    try {
      setClaims(await api.declareClaim(epoch, address.trim()));
      setAddress('');
      showToast({ icon: 'verified', title: t('lw.toast.signed'), body: t('lw.toast.signedBody', { epoch, addr: shortAddress(address.trim()) }) });
    } catch (e) {
      if (e instanceof NeedsReauth) setStepUpOpen(true);
      else setErr(e instanceof ApiError ? e.message : t('lw.cantSign'));
    } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (looksLikeAddress(address) && epoch && !busy) void declare(); };
  const download = async (kind: 'evidence' | 'claims') => {
    try {
      if (kind === 'evidence') downloadText(`piu-evidencias-${node.slice(0, 8)}-${dayKeyOf(Date.now())}.json`, JSON.stringify(await api.evidence(), null, 2));
      else downloadText(`piu-carteira-${node.slice(0, 8)}.json`, JSON.stringify(await api.claimsFile(), null, 2));
    } catch (e) {
      showToast({ icon: 'error', title: t('lw.toast.fileFail'), body: e instanceof ApiError ? e.message : t('common.tryAgain') });
    }
  };
  const label = (e: string, i: number) => `${i === 0 ? t('lw.thisWeek') : t('lw.next')} · ${e}`;
  const okShape = looksLikeAddress(address);

  return (
    <section className="span12 card-line lot-wallet" style={{ borderRadius: 22, padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 22 }}>
      <form className="col" onSubmit={submit} style={{ gap: 12 }}>
        <div className="col" style={{ gap: 3 }}>
          <h2 className="h-card" style={{ margin: 0 }}>{t('lw.title')}</h2>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('lw.sub')}</div>
        </div>
        {claims.enabled ? (
          <>
            <Segmented variant="bg2" label={t('lw.lot')} value={epoch} onChange={setEpoch} options={claims.epochs.map((e, i) => ({ value: e, label: label(e, i) }))} />
            <label className="col" style={{ gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('lw.addr')}</span>
              <input value={address} onChange={e => { setAddress(e.target.value.trim()); setErr(null); }} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder={t('lw.ph')}
                className="mono" aria-describedby="lot-msg" style={{ height: 44, borderRadius: 14, border: 'none', background: 'var(--bg2)', padding: '0 14px', fontSize: 13.5, color: 'var(--ink)', outline: 'none', minWidth: 0 }} />
            </label>
            <div id="lot-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: err ? 'var(--ink)' : 'var(--ink2)' }}>
              {err ?? (address && !okShape ? t('lw.checkAddr')
                : declared ? t('lw.declared', { epoch, addr: shortAddress(declared.address) })
                : t('lw.checks'))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={!okShape || busy} style={{ alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 19, fontSize: 13, opacity: okShape ? 1 : 0.4 }}>{busy ? t('lw.signing') : t('lw.sign')}</button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('lw.relayOff')}</div>
        )}
      </form>
      <div className="col" style={{ gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{t('lw.declaredTitle')}</div>
        {claims.claims.map(c => (
          <div key={c.epoch} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
            <Icon name="verified" size={16} fill={1} />
            <span style={{ fontWeight: 600 }}>{c.epoch}</span>
            <span className="mono ellipsis grow" style={{ fontSize: 12, color: 'var(--ink2)' }}>{shortAddress(c.address)}</span>
          </div>
        ))}
        {!claims.claims.length && <div style={{ fontSize: 12.5, color: 'var(--ink2)', padding: '8px 0', borderTop: '1px solid var(--line)' }}>{t('lw.none')}</div>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('lw.bring')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => void download('evidence')} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('lw.dlEvidence', { n: fmtInt(receiptsCount) })}</button>
          <button type="button" className="btn btn-outline" disabled={!claims.claims.length} onClick={() => void download('claims')} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: claims.claims.length ? 1 : 0.4 }}>{t('lw.dlClaim')}</button>
        </div>
      </div>
      {stepUpOpen && (
        <StepUpDialog reason={t('lw.stepup')} confirmLabel={t('lw.stepupBtn')} onClose={() => setStepUpOpen(false)}
          onConfirm={async code => { const p = await stepUp(code); if (p) return p; setStepUpOpen(false); await declare(); return null; }} />
      )}
    </section>
  );
}

