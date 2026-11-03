import { Icon, growX } from '../components/ui';
import { fmt, fmtInt } from '../lib/format';
import { dayLabel, historyOn, monthDays, monthName, receiptsOn, sum, weeks } from '../lib/live';
import { useStore } from '../state/store';

const DAY_COLS = 'minmax(0,1.1fr) repeat(4,minmax(0,1fr))';
const head = { padding: '10px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' } as const;

/**
 * Ganhos com o piu-node: o que o nó comprova (recibos por dia e por semana) e o que já foi pago
 * (entradas reais da carteira). Valor por recibo, validados e rejeitados dependem do validador.
 */
export function EarningsLive() {
  const { live, txs } = useStore();
  const h = historyOn(live), rc = receiptsOn(live);
  const month = sum(monthDays(h));
  const paid = txs.filter(t => (t.amount ?? 0) > 0);
  const paidTotal = paid.reduce((a, t) => a + (t.amount ?? 0), 0);
  const days = [...(h?.days ?? [])].reverse().slice(0, 14);
  const ws = weeks(h);
  const wmax = Math.max(1, ...ws.map(w => w.totals.receipts));
  const mon = h ? monthName(h.today) : 'este mês';

  const tiles: [string, string, string, boolean, number][] = [
    ['Pagos até hoje', fmt(paidTotal), paid.length ? `${paid.length} ${paid.length === 1 ? 'liquidação recebida' : 'liquidações recebidas'}` : 'nenhum lote liquidado ainda', true, 1],
    [`Recibos em ${mon}`, fmtInt(month.receipts), 'assinados por este nó', false, 0.6],
    ['Aguardando validação', fmtInt(rc?.keptOwn ?? 0), 'guardados até um gateway alcançar o validador', false, 0.32],
    ['Rejeitados', '—', 'o validador ainda não respondeu', false, 0.14],
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
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Recibos por dia</h2>
        <div className="mono table-head" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, ...head }}>
          <span>DIA</span><span style={{ textAlign: 'right' }}>RECEBIDOS</span><span style={{ textAlign: 'right' }}>ENCAMINHADOS</span><span style={{ textAlign: 'right' }}>DUPLICATAS</span><span style={{ textAlign: 'right' }}>RECIBOS</span>
        </div>
        {days.map(d => (
          <div key={d.day} className="table-row" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
            <span style={{ fontWeight: 600 }}>{d.day === h?.today ? 'hoje' : dayLabel(d.day)}</span>
            <span className="tnum" data-label="recebidos" style={{ textAlign: 'right' }}>{fmtInt(d.received)}</span>
            <span className="tnum" data-label="encaminhados" style={{ textAlign: 'right' }}>{fmtInt(d.forwarded)}</span>
            <span className="tnum" data-label="duplicatas" style={{ textAlign: 'right', color: 'var(--ink2)' }}>{fmtInt(d.duplicates)}</span>
            <span className="tnum" data-label="recibos" style={{ textAlign: 'right', fontWeight: 650 }}>{fmtInt(d.receipts)}</span>
          </div>
        ))}
        {!days.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>{h ? 'Nenhum dia registrado ainda: o histórico grava a cada rodada do nó.' : 'Retransmissão LNNP desligada neste nó.'}</div>}
        <div className="mono" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink2)' }}>Um recibo por envelope de terceiro repassado · valor em LUNES só depois da validação</div>
      </section>

      <section className="span5 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <h2 className="h-card" style={{ margin: 0 }}>Por semana</h2>
        {ws.map(w => (
          <div key={w.start} className="col" style={{ gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>semana de {dayLabel(w.start)}</span>
              <span className="tnum" style={{ fontWeight: 650 }}>{fmtInt(w.totals.receipts)} recibos</span>
            </div>
            <div className="track" style={{ height: 6 }}><div style={{ width: ((w.totals.receipts / wmax) * 100).toFixed(0) + '%', animation: growX() }} /></div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{fmtInt(w.totals.forwarded)} encaminhados · {fmtInt(w.totals.duplicates)} duplicatas</div>
          </div>
        ))}
        {!ws.length && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Sem semanas registradas ainda.</div>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Só o nó que serve este painel tem recibos aqui. Os outros equipamentos ainda não mandam estatísticas a ele.</div>
      </section>

      <section className="span12 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Lotes de liquidação</h2>
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
            Nenhum lote ainda. Um lote só existe depois que o validador confere os recibos com as confirmações de entrega e a Mainnet liquida. Até lá, os recibos ficam guardados neste nó.
          </div>
        )}
      </section>

      <div className="span12" style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
        <Icon name="policy" size={17} style={{ color: 'var(--ink)' }} />
        <span>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados. Tempo ligado e capacidade anunciada não geram crédito.</span>
      </div>
    </div>
  );
}
