import { DeviceStatusCell } from '../components/DeviceBits';
import { Bar, Icon, growX, pressable } from '../components/ui';
import { DAILY, FEED, KPIS, PENDING, PERIOD, RATES, REJECTED, TRANSPORTS, WALLETS } from '../data/seed';
import { fmt } from '../lib/format';
import { deviceLabels } from '../lib/devices';
import { useStore } from '../state/store';
import { OverviewLive } from './OverviewLive';

/** Com piu-node, os dados reais do nó; sem ele (site, prévia), a demonstração. */
export function Overview() {
  return useStore().nodeMode === 'node' ? <OverviewLive /> : <OverviewDemo />;
}

function OverviewDemo() {
  const { devices, totals, navigate } = useStore();
  const bars = [...DAILY, totals.today];
  const mx = Math.max(...bars);
  const rateMax = Math.max(...RATES.map(r => r.lunes));

  return (
    <div className="grid12" style={{ padding: '24px 32px 36px' }}>
      {/* herói: ganhos do mês */}
      <section className="span8 card-ink col" style={{ padding: 24, borderRadius: 24, gap: 20, animation: 'piuUp .45s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Ganhos em {PERIOD.month}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="tnum" style={{ fontSize: 60, fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1 }}>{fmt(totals.month)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.75 }}>LUNES</span>
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.75 }}>+{fmt(totals.today)} hoje · {totals.active} de {devices.length} equipamentos ativos</div>
          </div>
          <div style={{ display: 'flex', gap: 22 }}>
            {[[fmt(totals.validated), 'validados'], [fmt(PENDING), 'pendentes'], [fmt(REJECTED), 'rejeitados']].map(([v, l]) => (
              <div key={l} className="col" style={{ gap: 3, alignItems: 'flex-end' }}>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 650 }}>{v}</div>
                <div style={{ fontSize: 11.5, opacity: 0.7 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div role="img" aria-label={`Ganhos diários de ${PERIOD.month}`} style={{ height: 132, display: 'flex', alignItems: 'flex-end', gap: 5 }}>
            {bars.map((v, i) => (
              <div key={i} title={`${i + 1} out · ${fmt(v)} LUNES`}
                style={{ flex: 1, height: Math.max(3, (v / mx) * 100).toFixed(0) + '%', borderRadius: 3, background: 'currentColor', opacity: i === bars.length - 1 ? 1 : 0.4, transformOrigin: 'bottom', animation: `piuGrow .6s ${(i * 0.02).toFixed(2)}s var(--ease-out) both` }} />
            ))}
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6 }}><span>1 out</span><span>15 out</span><span>hoje</span></div>
        </div>
      </section>

      {/* próxima liquidação */}
      <section className="span4 card-soft col" style={{ padding: 22, borderRadius: 24, gap: 14, animation: 'piuUp .45s .05s both' }}>
        <div className="row mono" style={{ gap: 8, fontSize: 11.5, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' }}><Icon name="hourglass_top" size={16} />PRÓXIMA LIQUIDAÇÃO</div>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Lote {PERIOD.lot} · {PERIOD.month}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="tnum" style={{ fontSize: 36, fontWeight: 650, letterSpacing: '-0.045em' }}>{fmt(totals.month)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>LUNES</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
          <span className="muted">Fecha em</span><span style={{ fontWeight: 550 }}>{PERIOD.closes}</span>
          <span className="muted">Liquida</span><span style={{ fontWeight: 550 }}>quando um gateway alcançar a Mainnet</span>
          <span className="muted">Destino</span><span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{WALLETS.provider.short}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline" onClick={() => navigate('earnings')} style={{ height: 40, borderRadius: 20, fontSize: 13.5 }}>Ver ganhos detalhados</button>
      </section>

      {/* KPIs */}
      {KPIS.map(([icon, l, v, d], i) => (
        <div key={l} className="span3 card-soft col" style={{ padding: 18, borderRadius: 20, gap: 6, animation: `piuUp .45s ${(0.1 + i * 0.05).toFixed(2)}s both` }}>
          <div className="row" style={{ gap: 8, fontSize: 12.5, color: 'var(--ink2)' }}><Icon name={icon} size={17} wght={300} style={{ color: 'var(--ink)' }} />{l}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.04em' }}>{v}</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d}</div>
        </div>
      ))}

      {/* equipamentos */}
      <section className="span8 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px' }}>
          <h2 className="h-card" style={{ margin: 0 }}>Equipamentos</h2>
          <button type="button" className="btn" onClick={() => navigate('devices')} style={{ color: 'var(--ink2)', fontSize: 13, fontWeight: 550, gap: 4 }}>Ver todos<Icon name="chevron_right" size={17} /></button>
        </div>
        {devices.map(d => {
          const v = deviceLabels(d);
          return (
            <div key={d.id} className="click-row" {...pressable(() => navigate('devices', d.id), d.name)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,1.2fr) 90px 90px', gap: 16, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={d.icon} size={20} wght={300} /></div>
                <div className="col" style={{ minWidth: 0, gap: 2 }}>
                  <div className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</div>
                  <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls} · {d.pub}</div>
                </div>
              </div>
              <DeviceStatusCell d={d} />
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right' }}>{v.pph}</div>
              <div className="tnum" style={{ fontSize: 14, fontWeight: 650, textAlign: 'right' }}>{v.today}</div>
            </div>
          );
        })}
      </section>

      {/* atividade */}
      <section className="span4 card-line col" style={{ borderRadius: 22, padding: '16px 18px', gap: 4 }}>
        <h2 className="h-card" style={{ margin: 0, paddingBottom: 6 }}>Atividade</h2>
        {FEED.map(([icon, t, d, time], i) => (
          <div key={t} style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={icon} size={19} wght={300} />
            <div className="col grow" style={{ gap: 2 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{t}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.35 }}>{d}</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{time}</div>
          </div>
        ))}
      </section>

      {/* tráfego por transporte */}
      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="h-card" style={{ margin: 0 }}>Tráfego por transporte</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>hoje · 24.880 pacotes</div>
        </div>
        {TRANSPORTS.map(([icon, n, p], i) => (
          <div key={n} className="col" style={{ gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="row" style={{ gap: 8, fontWeight: 550 }}><Icon name={icon} size={17} wght={300} />{n}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{p}</span>
            </div>
            <Bar pct={p} height={6} anim={growX(i * 0.06)} />
          </div>
        ))}
      </section>

      {/* ganhos por tipo */}
      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
          <h2 className="h-card" style={{ margin: 0 }}>Ganhos por tipo de entrega</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{PERIOD.month}</div>
        </div>
        {RATES.map((r, i) => (
          <div key={r.title} className="row" style={{ gap: 12, padding: '9px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={r.icon} size={19} wght={300} />
            <div className="col grow" style={{ gap: 2 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.title}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{r.volume}</div>
            </div>
            <div style={{ width: 110 }}><Bar pct={((r.lunes / rateMax) * 100).toFixed(0) + '%'} height={5} radius={3} /></div>
            <div className="tnum" style={{ width: 64, textAlign: 'right', fontSize: 13.5, fontWeight: 650 }}>{fmt(r.lunes)}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
