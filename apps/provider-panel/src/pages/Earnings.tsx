import { Icon, growX } from '../components/ui';
import { LOTS, PAID_TOTAL, PENDING, PERIOD, RATES, REJECTED } from '../data/seed';
import { fmt } from '../lib/format';
import { useStore } from '../state/store';

const RATE_COLS = 'minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1fr) 90px';
const LOT_COLS = '110px minmax(0,1fr) minmax(0,1fr) 120px minmax(0,1.2fr) minmax(0,1fr)';
const head = { padding: '10px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' } as const;

export function Earnings() {
  const { devices, totals } = useStore();
  const tiles: [string, string, string, boolean, number][] = [
    ['Pagos até hoje', PAID_TOTAL, '3 lotes · desde julho', true, 1],
    ['Validados', fmt(totals.validated), `prontos para o lote ${PERIOD.lot}`, false, 0.6],
    ['Pendentes', fmt(PENDING), 'aguardando confirmações', false, 0.32],
    ['Rejeitados', fmt(REJECTED), 'duplicatas e rotas circulares', false, 0.14],
  ];
  const earning = devices.filter(d => !d.passive);

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
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Créditos por tipo de entrega · {PERIOD.month}</h2>
        <div className="mono" style={{ display: 'grid', gridTemplateColumns: RATE_COLS, gap: 12, ...head }}><span>TIPO</span><span>REGRA</span><span>VOLUME</span><span style={{ textAlign: 'right' }}>LUNES</span></div>
        {RATES.map(r => (
          <div key={r.title} style={{ display: 'grid', gridTemplateColumns: RATE_COLS, gap: 12, alignItems: 'center', padding: '13px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
            <span className="row" style={{ gap: 10, fontWeight: 600 }}><Icon name={r.icon} size={19} wght={300} />{r.title}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{r.rule}</span>
            <span className="mono" style={{ fontSize: 12 }}>{r.volume}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{fmt(r.lunes)}</span>
          </div>
        ))}
        <div className="mono" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink2)' }}>100 créditos = 1 LUNES · taxas ilustrativas</div>
      </section>

      <section className="span5 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <h2 className="h-card" style={{ margin: 0 }}>Por equipamento</h2>
        {earning.map(d => {
          const share = (totals.month ? (d.month / totals.month) * 100 : 0).toFixed(0) + '%';
          return (
            <div key={d.id} className="col" style={{ gap: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                <span className="row" style={{ gap: 8, fontWeight: 600 }}><Icon name={d.icon} size={18} wght={300} />{d.name}</span>
                <span className="tnum" style={{ fontWeight: 650 }}>{fmt(d.month)}</span>
              </div>
              <div className="track" style={{ height: 6 }}><div style={{ width: share, animation: growX() }} /></div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{d.cls} · {share} do total</div>
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Ganha mais quem entrega onde há pouca cobertura: rotas novas entre áreas valem 10× um texto.</div>
      </section>

      <section className="span12 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Lotes de liquidação</h2>
        <div className="mono" style={{ display: 'grid', gridTemplateColumns: LOT_COLS, gap: 12, ...head }}><span>LOTE</span><span>PERÍODO</span><span>ENTREGAS</span><span style={{ textAlign: 'right' }}>LUNES</span><span>ESTADO</span><span>TRANSAÇÃO</span></div>
        {LOTS.map(l => (
          <div key={l.id} style={{ display: 'grid', gridTemplateColumns: LOT_COLS, gap: 12, alignItems: 'center', padding: '13px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{l.id}</span>
            <span>{l.period}</span>
            <span className="mono" style={{ fontSize: 12 }}>{l.deliveries}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{l.value ?? fmt(totals.month)}</span>
            <span className="row" style={{ gap: 7 }}><Icon name={l.icon} size={17} fill={l.done ? 1 : 0} />{l.state}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{l.tx}</span>
          </div>
        ))}
      </section>

      <div className="span12" style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
        <Icon name="policy" size={17} style={{ color: 'var(--ink)' }} />
        <span>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados. Tempo ligado e capacidade anunciada não geram crédito.</span>
      </div>
    </div>
  );
}
