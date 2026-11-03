import { DeviceStatusCell } from '../components/DeviceBits';
import type { ApiAlert, ApiAlerts } from '../lib/api';
import { Bar, Icon, growX, pressable } from '../components/ui';
import { deviceLabels } from '../lib/devices';
import { fmtInt } from '../lib/format';
import { ago, dayLabel, historyOn, MEDIUM, MEDIUM_ICON, monthDays, monthName, receiptsOn, relayOn, sum, todayTotals } from '../lib/live';
import { useStore } from '../state/store';

/** Visão geral com o piu-node: contagens reais do motor. LUNES só depois da validação e da liquidação. */
export function OverviewLive() {
  const { devices, navigate, live, txs } = useStore();
  const r = relayOn(live), h = historyOn(live), rc = receiptsOn(live);
  const days = monthDays(h);
  const month = sum(days);
  const today = todayTotals(h);
  const mon = h ? monthName(h.today) : '';
  const bars = days.map(d => d.receipts);
  const mx = Math.max(1, ...bars);
  const withData = devices.filter(d => d.telemetry === 'live').length;
  const state = !r ? 'retransmissão desligada' : r.paused ? 'retransmissão pausada' : r.relaying ? 'retransmitindo agora' : 'fora do horário de operação';
  const loading = live === null;

  const nb = r?.neighbors ?? [];
  const byMedium = Object.entries(nb.reduce<Record<string, number>>((a, n) => ({ ...a, [n.link]: (a[n.link] ?? 0) + 1 }), {}));
  const kpis: [string, string, string, string][] = [
    ['call_received', 'Recebidos hoje', fmtInt(today.received), `${fmtInt(today.stored)} guardados para repassar`],
    ['swap_vert', 'Encaminhados hoje', fmtInt(today.forwarded), 'cópias enviadas a vizinhos'],
    ['content_copy', 'Duplicatas descartadas', fmtInt(today.duplicates), 'não geram crédito'],
    ['hub', 'Vizinhos agora', fmtInt(nb.length), nb.length ? byMedium.map(([m, n]) => `${n} ${MEDIUM[m] ?? m}`).join(' · ') : 'nenhum ainda'],
  ];
  const outcomes: [string, string, number][] = [
    ['inventory_2', 'Guardados para repassar', today.stored], ['swap_vert', 'Encaminhados', today.forwarded],
    ['content_copy', 'Duplicatas', today.duplicates], ['block', 'Recusados', today.rejected],
    ['schedule', 'Sem retransmitir (pausa ou horário)', today.relayOff], ['storage', 'Sem espaço', today.full], ['timer_off', 'Vencidos', today.expired],
  ];
  const omax = Math.max(1, ...outcomes.map(o => o[2]));

  // Atividade: o que de fato aconteceu neste nó (vizinhos, recibos, transferências), do mais novo ao mais antigo.
  const feed: [string, string, string, number][] = [
    ...nb.map(n => ['link', `Vizinho ${n.id.slice(0, 8)} conectado`, `${MEDIUM[n.link] ?? n.link} · LNNP v${n.version} · MTU ${fmtInt(n.mtu)}`, n.since] as [string, string, string, number]),
    ...(rc?.recent ?? []).slice(0, 3).map(x => ['receipt_long', x.own ? 'Recibo assinado' : 'Recibo de vizinho recebido', 'guardado para o validador', x.at] as [string, string, string, number]),
    ...txs.slice(0, 3).map(t => [t.icon, t.title, `${t.value} LUNES · ${t.status}`, t.at ?? 0] as [string, string, string, number]),
  ].sort((a, b) => b[3] - a[3]).slice(0, 6);

  return (
    <div className="grid12 page-body">
      <section className="span8 card-ink col" style={{ padding: 24, borderRadius: 24, gap: 20, animation: 'piuUp .45s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="col" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Recibos assinados em {mon || 'este mês'}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="tnum hero-num" style={{ fontSize: 60, fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1 }}>{loading ? '—' : fmtInt(month.receipts)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.75 }}>recibos</span>
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.75 }}>+{fmtInt(today.receipts)} hoje · {state} · {withData} de {devices.length} equipamentos com dados</div>
          </div>
          <div style={{ display: 'flex', gap: 22 }}>
            {[[fmtInt(month.forwarded), 'encaminhados'], [fmtInt(month.duplicates), 'duplicatas'], [fmtInt(month.rejected), 'recusados']].map(([v, l]) => (
              <div key={l} className="col" style={{ gap: 3, alignItems: 'flex-end' }}>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 650 }}>{v}</div>
                <div style={{ fontSize: 11.5, opacity: 0.7 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div role="img" aria-label={`Recibos por dia em ${mon}`} style={{ height: 132, display: 'flex', alignItems: 'flex-end', gap: 5 }}>
            {days.map((d, i) => (
              <div key={d.day} title={`${dayLabel(d.day)} · ${fmtInt(d.receipts)} recibos`}
                style={{ flex: 1, height: Math.max(3, (d.receipts / mx) * 100).toFixed(0) + '%', borderRadius: 3, background: 'currentColor', opacity: i === days.length - 1 ? 1 : 0.4, transformOrigin: 'bottom', animation: `piuGrow .6s ${(i * 0.02).toFixed(2)}s var(--ease-out) both` }} />
            ))}
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6 }}>
            <span>{days[0] ? dayLabel(days[0].day) : ''}</span><span>{month.receipts ? '' : 'nenhum recibo ainda neste mês'}</span><span>hoje</span>
          </div>
        </div>
      </section>

      <section className="span4 card-soft col" style={{ padding: 22, borderRadius: 24, gap: 14, animation: 'piuUp .45s .05s both' }}>
        <div className="row mono" style={{ gap: 8, fontSize: 11.5, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' }}><Icon name="hourglass_top" size={16} />PRÓXIMA LIQUIDAÇÃO</div>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Sem lote ainda</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="tnum" style={{ fontSize: 36, fontWeight: 650, letterSpacing: '-0.045em' }}>{fmtInt(rc?.keptOwn ?? 0)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>recibos guardados</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
          <span className="muted">Valor</span><span style={{ fontWeight: 550 }}>definido pelo validador, depois da confirmação de entrega</span>
          <span className="muted">Liquida</span><span style={{ fontWeight: 550 }}>quando um gateway alcançar a Mainnet</span>
          <span className="muted">Guarda</span><span style={{ fontWeight: 550 }}>os {fmtInt(rc?.max ?? 1000)} recibos mais recentes</span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline" onClick={() => navigate('earnings')} style={{ height: 40, borderRadius: 20, fontSize: 13.5 }}>Ver ganhos detalhados</button>
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
          <h2 className="h-card" style={{ margin: 0 }}>Equipamentos</h2>
          <button type="button" className="btn" onClick={() => navigate('devices')} style={{ color: 'var(--ink2)', fontSize: 13, fontWeight: 550, gap: 4 }}>Ver todos<Icon name="chevron_right" size={17} /></button>
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
                  <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls}{d.pub ? ` · ${d.pub}` : d.telemetry === 'live' ? ' · este nó' : ''}</div>
                </div>
              </div>
              <DeviceStatusCell d={d} />
              <div className="mono col-sec" title="encaminhados na última hora" style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right' }}>{v.pph}</div>
              <div className="tnum" style={{ fontSize: 13, fontWeight: 650, textAlign: 'right' }}>{v.today}</div>
            </div>
          );
        })}
        {!devices.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>Nenhum equipamento registrado ainda.</div>}
      </section>

      <section className="span4 card-line col" style={{ borderRadius: 22, padding: '16px 18px', gap: 4 }}>
        <h2 className="h-card" style={{ margin: 0, paddingBottom: 6 }}>Atividade</h2>
        {feed.map(([icon, t, d, at], i) => (
          <div key={t + i} style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={icon} size={19} wght={300} />
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{t}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.35 }}>{d}</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{at ? ago(at) : ''}</div>
          </div>
        ))}
        {!feed.length && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45, padding: '6px 0' }}>Nada aconteceu ainda neste nó. Vizinhos, recibos e transferências aparecem aqui.</div>}
      </section>

      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <h2 className="h-card" style={{ margin: 0 }}>Vizinhos por meio</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>agora · {fmtInt(nb.length)} enlaces</div>
        </div>
        {byMedium.map(([m, n], i) => (
          <div key={m} className="col" style={{ gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="row" style={{ gap: 8, fontWeight: 550 }}><Icon name={MEDIUM_ICON[m] ?? 'link'} size={17} wght={300} />{MEDIUM[m] ?? m}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{n}</span>
            </div>
            <Bar pct={((n / nb.length) * 100).toFixed(0) + '%'} height={6} anim={growX(i * 0.06)} />
          </div>
        ))}
        {!nb.length && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>Sem vizinhos ainda. Outro piu-node na mesma rede aparece sozinho pela descoberta; vizinhos fixos vêm de PIU_LNNP_PEERS.</div>}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>O nó conta enlaces por meio; o volume por meio ainda não é medido.</div>
      </section>

      <section className="span6 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
          <h2 className="h-card" style={{ margin: 0 }}>Envelopes hoje, por resultado</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{fmtInt(today.received)} recebidos</div>
        </div>
        {outcomes.map(([icon, t, n], i) => (
          <div key={t} className="row" style={{ gap: 12, padding: '7px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={icon} size={19} wght={300} />
            <div className="grow" style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{t}</div>
            <div className="hide-sm" style={{ width: 110 }}><Bar pct={((n / omax) * 100).toFixed(0) + '%'} height={5} radius={3} /></div>
            <div className="tnum" style={{ width: 64, textAlign: 'right', fontSize: 13.5, fontWeight: 650 }}>{fmtInt(n)}</div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, paddingTop: 6 }}>O nó não lê o conteúdo: o tipo de entrega e o valor em LUNES vêm do validador.</div>
      </section>

      <OfficialAlerts alerts={live?.alerts ?? null} loading={loading} />
    </div>
  );
}

const SEVERITY: Record<ApiAlert['info']['severity'], string> = { Extreme: 'extrema', Severe: 'severa', Moderate: 'moderada', Minor: 'baixa', Unknown: 'sem gravidade informada' };
const MSG: Record<ApiAlert['msgType'], string> = { Alert: 'alerta', Update: 'atualização', Cancel: 'cancelamento' };
const until = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null; };
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/**
 * Alertas oficiais (CAP) vigentes que este nó leu dos feeds configurados (`GET /api/alerts`), com a
 * origem de cada um. O nó só repassa o que o órgão publicou: não há assinatura do órgão para conferir.
 */
function OfficialAlerts({ alerts, loading }: { alerts: ApiAlerts | null; loading: boolean }) {
  const list = alerts?.alerts ?? [];
  const failing = (alerts?.feeds ?? []).filter(f => f.lastError);
  return (
    <section className="span12 card-line col" style={{ borderRadius: 22, padding: '16px 18px', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingBottom: 6, flexWrap: 'wrap' }}>
        <h2 className="h-card" style={{ margin: 0 }}>Alertas oficiais</h2>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>
          {!alerts ? (loading ? 'lendo…' : 'indisponível') : !alerts.enabled ? 'desligados neste nó' : `${fmtInt(list.length)} ${list.length === 1 ? 'vigente' : 'vigentes'} · ${alerts.feeds.length} ${alerts.feeds.length === 1 ? 'fonte' : 'fontes'}`}
        </div>
      </div>
      {alerts && !alerts.enabled && (
        <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>Nenhuma fonte de alertas configurada (PIU_ALERT_FEEDS vazio). Com uma fonte CAP (por exemplo, a da Defesa Civil ou do INMET), os alertas vigentes aparecem aqui.</div>
      )}
      {list.slice(0, 6).map((a, i) => {
        const exp = until(a.info.expires);
        return (
          <div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
            <Icon name={a.msgType === 'Cancel' ? 'notifications_off' : 'campaign'} size={20} wght={300} />
            <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{a.info.headline || a.info.event || 'Alerta sem título'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>
                {[MSG[a.msgType], `gravidade ${SEVERITY[a.info.severity]}`, a.info.areas.map(x => x.areaDesc).filter(Boolean).slice(0, 3).join(', '), exp ? `até ${exp}` : ''].filter(Boolean).join(' · ')}
              </div>
              <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--ink2)' }}>{a.info.senderName || a.sender} · via {host(a.source.feed)}</div>
            </div>
          </div>
        );
      })}
      {alerts?.enabled && !list.length && <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>Nenhum alerta vigente nas fontes configuradas.</div>}
      {list.length > 6 && <div style={{ fontSize: 12, color: 'var(--ink2)' }}>+ {fmtInt(list.length - 6)} alertas vigentes não mostrados.</div>}
      {failing.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Sem leitura recente de {failing.map(f => host(f.url)).join(', ')}: {failing[0]!.lastError}</div>}
      {alerts?.enabled && <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, paddingTop: 4 }}>O nó repassa o que o órgão publicou na fonte; o alerta não traz assinatura do órgão para conferir aqui.</div>}
    </section>
  );
}
