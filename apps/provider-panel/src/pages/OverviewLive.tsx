import { DeviceStatusCell } from '../components/DeviceBits';
import { SetupGuide } from '../components/Guide';
import { Bar, Icon, growX, pressable } from '../components/ui';
import { useT } from '../i18n/react';
import { deviceLabels } from '../lib/devices';
import { fmtInt } from '../lib/format';
import { ago, dayLabel, historyOn, MEDIUM_ICON, medium, monthDays, monthName, receiptsOn, relayOn, sum, todayTotals } from '../lib/live';
import { useStore } from '../state/store';

/** Visão geral com o piu-node: contagens reais do motor. LUNES só depois da validação e da liquidação. */
export function OverviewLive() {
  const t = useT();
  const { devices, navigate, live, txs } = useStore();
  const r = relayOn(live), h = historyOn(live), rc = receiptsOn(live);
  const days = monthDays(h);
  const month = sum(days);
  const today = todayTotals(h);
  const mon = h ? monthName(h.today) : '';
  const bars = days.map(d => d.receipts);
  const mx = Math.max(1, ...bars);
  const withData = devices.filter(d => d.telemetry === 'live').length;
  const state = !r ? t('ovl.stateOff') : r.paused ? t('ovl.statePaused') : r.relaying ? t('ovl.stateRelaying') : t('ovl.stateOffHours');
  const loading = live === null;

  const nb = r?.neighbors ?? [];
  const byMedium = Object.entries(nb.reduce<Record<string, number>>((a, n) => ({ ...a, [n.link]: (a[n.link] ?? 0) + 1 }), {}));
  const kpis: [string, string, string, string][] = [
    ['call_received', t('ovl.receivedToday'), fmtInt(today.received), t('ovl.storedToRelay', { n: fmtInt(today.stored) })],
    ['swap_vert', t('ovl.fwdToday'), fmtInt(today.forwarded), t('ovl.copiesSent')],
    ['content_copy', t('ovl.dupes'), fmtInt(today.duplicates), t('ovl.noCredit')],
    ['hub', t('ovl.neighborsNow'), fmtInt(nb.length), nb.length ? byMedium.map(([m, n]) => `${n} ${medium(m)}`).join(' · ') : t('ovl.noneYet')],
  ];
  const outcomes: [string, string, number][] = [
    ['inventory_2', t('ovl.outStored'), today.stored], ['swap_vert', t('ovl.outFwd'), today.forwarded],
    ['content_copy', t('ovl.outDup'), today.duplicates], ['block', t('ovl.outRejected'), today.rejected],
    ['schedule', t('ovl.outRelayOff'), today.relayOff], ['storage', t('ovl.outFull'), today.full], ['timer_off', t('ovl.outExpired'), today.expired],
  ];
  const omax = Math.max(1, ...outcomes.map(o => o[2]));

  // Atividade: o que de fato aconteceu neste nó (vizinhos, recibos, transferências), do mais novo ao mais antigo.
  const feed: [string, string, string, number][] = [
    ...nb.map(n => ['link', t('ovl.feedNeighbor', { id: n.id.slice(0, 8) }), t('ovl.feedNeighborBody', { medium: medium(n.link), v: n.version, mtu: fmtInt(n.mtu) }), n.since] as [string, string, string, number]),
    ...(rc?.recent ?? []).slice(0, 3).map(x => ['receipt_long', x.own ? t('ovl.feedReceiptOwn') : t('ovl.feedReceiptPeer'), t('ovl.feedReceiptBody'), x.at] as [string, string, string, number]),
    ...txs.slice(0, 3).map(x => [x.icon, x.title, t('ovl.feedTx', { value: x.value, status: x.status }), x.at ?? 0] as [string, string, string, number]),
  ].sort((a, b) => b[3] - a[3]).slice(0, 6);

  return (
    <div className="grid12 page-body" style={{ paddingTop: 24 }}>
      <SetupGuide />
      <section className="span8 card-ink col" style={{ padding: 24, borderRadius: 24, gap: 20, animation: 'piuUp .45s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="col" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>{t('ovl.receiptsIn', { month: mon || t('ovl.thisMonth') })}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="tnum hero-num" style={{ fontSize: 60, fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1 }}>{loading ? '—' : fmtInt(month.receipts)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.75 }}>{t('ovl.receipts')}</span>
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.75 }}>{t('ovl.heroSub', { today: fmtInt(today.receipts), state, withData, total: devices.length })}</div>
          </div>
          <div style={{ display: 'flex', gap: 22 }}>
            {[[fmtInt(month.forwarded), t('ovl.fwd')], [fmtInt(month.duplicates), t('ovl.dup')], [fmtInt(month.rejected), t('ovl.rej')]].map(([v, l]) => (
              <div key={l} className="col" style={{ gap: 3, alignItems: 'flex-end' }}>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 650 }}>{v}</div>
                <div style={{ fontSize: 11.5, opacity: 0.7 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div role="img" aria-label={t('ovl.barsAria', { month: mon })} style={{ height: 132, display: 'flex', alignItems: 'flex-end', gap: 5 }}>
            {days.map((d, i) => (
              <div key={d.day} title={t('ovl.barTitle', { day: dayLabel(d.day), n: fmtInt(d.receipts) })}
                style={{ flex: 1, height: Math.max(3, (d.receipts / mx) * 100).toFixed(0) + '%', borderRadius: 3, background: 'currentColor', opacity: i === days.length - 1 ? 1 : 0.4, transformOrigin: 'bottom', animation: `piuGrow .6s ${(i * 0.02).toFixed(2)}s var(--ease-out) both` }} />
            ))}
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6 }}>
            <span>{days[0] ? dayLabel(days[0].day) : ''}</span><span>{month.receipts ? '' : t('ovl.noneThisMonth')}</span><span>{t('common.today')}</span>
          </div>
        </div>
      </section>

      <section className="span4 card-soft col" style={{ padding: 22, borderRadius: 24, gap: 14, animation: 'piuUp .45s .05s both' }}>
        <div className="row mono" style={{ gap: 8, fontSize: 11.5, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' }}><Icon name="hourglass_top" size={16} />{t('ov.nextSettle')}</div>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{t('ovl.noLot')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="tnum" style={{ fontSize: 36, fontWeight: 650, letterSpacing: '-0.045em' }}>{fmtInt(rc?.keptOwn ?? 0)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>{t('ovl.receiptsKept')}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
          <span className="muted">{t('ovl.value')}</span><span style={{ fontWeight: 550 }}>{t('ovl.valueBy')}</span>
          <span className="muted">{t('ov.settles')}</span><span style={{ fontWeight: 550 }}>{t('ov.whenGateway')}</span>
          <span className="muted">{t('ovl.keeps')}</span><span style={{ fontWeight: 550 }}>{t('ovl.keepsN', { n: fmtInt(rc?.max ?? 1000) })}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline" onClick={() => navigate('earnings')} style={{ height: 40, borderRadius: 20, fontSize: 13.5 }}>{t('ov.seeEarnings')}</button>
      </section>

      {kpis.map(([icon, l, v, d], i) => (
        <div key={l} className="span3 card-soft col" style={{ padding: 18, borderRadius: 20, gap: 6, animation: `piuUp .45s ${(0.1 + i * 0.05).toFixed(2)}s both` }}>
          <div className="row" style={{ gap: 8, fontSize: 12.5, color: 'var(--ink2)' }}><Icon name={icon} size={17} wght={300} style={{ color: 'var(--ink)' }} />{l}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.04em' }}>{loading ? '—' : v}</div>
          <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d}</div>
        </div>
      ))}

      <section className="span8 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px' }}>
          <h2 className="h-card" style={{ margin: 0 }}>{t('nav.devices')}</h2>
          <button type="button" className="btn" onClick={() => navigate('devices')} style={{ color: 'var(--ink2)', fontSize: 13, fontWeight: 550, gap: 4 }}>{t('ov.seeAll')}<Icon name="chevron_right" size={17} /></button>
        </div>
        {devices.map(d => {
          const v = deviceLabels(d);
          return (
            <div key={d.id} className="click-row dev-row" {...pressable(() => navigate('devices', d.id), d.name)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,1.2fr) 90px 90px', gap: 16, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={d.icon} size={20} wght={300} /></div>
                <div className="col" style={{ minWidth: 0, gap: 2 }}>
                  <div className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</div>
                  <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls}{d.pub ? ` · ${d.pub}` : d.telemetry === 'live' ? ` · ${t('common.thisNode')}` : ''}</div>
                </div>
              </div>
              <DeviceStatusCell d={d} />
              <div className="mono col-sec" title={t('ovl.fwdLastHour')} style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right' }}>{v.pph}</div>
              <div className="tnum" style={{ fontSize: 13, fontWeight: 650, textAlign: 'right' }}>{v.today}</div>
            </div>
          );
        })}
        {!devices.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>{t('ovl.noDevices')}</div>}
      </section>

      <section className="span4 card-line col" style={{ borderRadius: 22, padding: '16px 18px', gap: 4 }}>
        <h2 className="h-card" style={{ margin: 0, paddingBottom: 6 }}>{t('ov.activity')}</h2>
        {feed.map(([icon, x, d, at], i) => (
          <div key={x + i} style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={icon} size={19} wght={300} />
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{x}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.35 }}>{d}</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{at ? ago(at) : ''}</div>
          </div>
        ))}
        {!feed.length && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45, padding: '6px 0' }}>{t('ovl.nothingYet')}</div>}
      </section>

      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <h2 className="h-card" style={{ margin: 0 }}>{t('ovl.byMedium')}</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{t('ovl.nowLinks', { n: fmtInt(nb.length) })}</div>
        </div>
        {byMedium.map(([m, n], i) => (
          <div key={m} className="col" style={{ gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="row" style={{ gap: 8, fontWeight: 550 }}><Icon name={MEDIUM_ICON[m] ?? 'link'} size={17} wght={300} />{medium(m)}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{n}</span>
            </div>
            <Bar pct={((n / nb.length) * 100).toFixed(0) + '%'} height={6} anim={growX(i * 0.06)} />
          </div>
        ))}
        {!nb.length && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('ovl.noNeighbors')}</div>}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('ovl.countsNote')}</div>
      </section>

      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
          <h2 className="h-card" style={{ margin: 0 }}>{t('ovl.envelopesToday')}</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{t('ovl.received', { n: fmtInt(today.received) })}</div>
        </div>
        {outcomes.map(([icon, x, n], i) => (
          <div key={x} className="row" style={{ gap: 12, padding: '7px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={icon} size={19} wght={300} />
            <div className="grow" style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{x}</div>
            <div className="hide-sm" style={{ width: 110 }}><Bar pct={((n / omax) * 100).toFixed(0) + '%'} height={5} radius={3} /></div>
            <div className="tnum" style={{ width: 64, textAlign: 'right', fontSize: 13.5, fontWeight: 650 }}>{fmtInt(n)}</div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, paddingTop: 6 }}>{t('ovl.contentNote')}</div>
      </section>
    </div>
  );
}
