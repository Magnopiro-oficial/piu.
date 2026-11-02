import { ScrollView, Share, View } from 'react-native';
import type { IconName } from '../ui/Icon';
import { type Stats, useStats } from '../state/messaging';
import { useStore } from '../state/store';
import { useTransport } from '../state/transport';
import { useTheme } from '../theme/ThemeProvider';
import { GrowBar, GrowCol } from '../ui/Bars';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/** Diagnóstico local (NFR-008): entrega, latência, fila e expiradas, por transporte e por saltos. Nada sai do aparelho. */
export default function Diagnostics() {
  const { c } = useTheme();
  const { showToast } = useStore();
  const st = useStats();
  const d = st ? diag(st) : null;
  const exportReport = async () => {
    if (!st) return;
    // Só métricas agregadas deste aparelho: sem conteúdo, contatos nem ids de envelope.
    const report = JSON.stringify({ geradoEm: new Date().toISOString(), ultimos7dias: { ...st.metrics }, creditos: st.credits.totals, lotes: st.credits.lots, retransmissao: st.relay }, null, 2);
    try { await Share.share({ title: 'piu-diagnostico.json', message: report }); }
    catch { showToast({ icon: 'error', title: 'Não foi possível exportar', body: 'Tente de novo.' }); }
  };
  return (
    <Screen>
      <BackHeader title="Diagnóstico" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 24, paddingBottom: 12 }}>ÚLTIMOS 7 DIAS · CALCULADO NESTE APARELHO</T>
        <View style={{ marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(d?.kpis ?? []).map(([l, v, d, hi]) => (
            <View key={l} style={{ width: '48.5%', flexGrow: 1, padding: 14, borderRadius: 18, backgroundColor: hi ? c.ink : c.bg2, gap: 4 }}>
              <T size={12} color={hi ? c.invink : c.ink} style={{ opacity: 0.75 }}>{l}</T>
              <T size={26} w={650} ls={-0.035} color={hi ? c.invink : c.ink}>{v}</T>
              <T size={11} mono color={hi ? c.invink : c.ink} style={{ opacity: 0.7 }}>{d}</T>
            </View>
          ))}
        </View>

        <TransportCard />

        <SectionLabel>POR TRANSPORTE</SectionLabel>
        <View style={{ marginHorizontal: 20, paddingVertical: 4, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.bg2 }}>
          {d && d.tx.length === 0 && <T size={13} color={c.ink2} style={{ paddingVertical: 14 }}>Ainda sem envios por perto nesta semana.</T>}
          {(d?.tx ?? []).map(([icon, n, rate, lat], i) => (
            <View key={n} accessibilityLabel={`${n}: ${rate}% entregues, latência ${lat}`} style={{ gap: 7, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name={icon} size={19} w={300} />
                <T size={14} w={550} style={{ flex: 1 }}>{n}</T>
                <T size={12} w={500} mono>{rate}%</T>
                <T size={12} mono color={c.ink2} align="right" style={{ width: 54 }}>{lat}</T>
              </View>
              <GrowBar pct={rate} />
            </View>
          ))}
        </View>

        <SectionLabel>MENSAGENS RECEBIDAS POR NÚMERO DE SALTOS</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'flex-end', gap: 12, height: 150 }}>
          {(d?.hops ?? []).map(([l, v], i) => (
            <View key={l} accessibilityLabel={`${l === '1 salto' ? l : l + ' saltos'}: ${v}% das mensagens recebidas`} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <T size={11.5} w={500} mono>{v}%</T>
              <GrowCol pct={v * 0.85} opacity={1 - i * 0.18} delay={i * 35} />
              <T size={11.5} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>

        <SectionLabel>ESTE APARELHO COMO NÓ</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {(d?.node ?? []).map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <T size={14.5} style={{ flex: 1 }}>{l}</T>
              <T size={13} w={500} mono>{v}</T>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 16, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="shield" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Nenhum dado sai deste aparelho. O Piu não envia telemetria; só você decide exportar.</T>
        </View>
        <View style={{ paddingTop: 16, paddingHorizontal: 20 }}>
          <Button label="Exportar relatório local" variant="outline" height={48} disabled={!st} onPress={() => void exportReport()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const KIND_LABEL = { nearby: 'Nearby Connections · Bluetooth e Wi-Fi Direct', ble: 'Bluetooth LE', sim: 'Simulado · sem módulo nativo' } as const;
const STATE_LABEL = { off: 'desligado', starting: 'iniciando…', running: 'ativo', unavailable: 'indisponível' } as const;

/** Transporte P2P real deste aparelho: tipo, estado e vizinhos (simulado no navegador e no Expo Go). */
function TransportCard() {
  const { c } = useTheme();
  const { kind, state, reason, peers, nodeName } = useTransport();
  const on = peers.filter(p => p.connected).length;
  return (
    <>
      <SectionLabel>TRANSPORTE NESTE APARELHO</SectionLabel>
      <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, gap: 10,
        backgroundColor: kind === 'sim' ? 'transparent' : c.bg2, borderWidth: kind === 'sim' ? 1 : 0, borderStyle: 'dashed', borderColor: c.line2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name={kind === 'nearby' ? 'wifi_tethering' : 'bluetooth'} size={20} w={300} />
          <T size={14.5} w={600} style={{ flex: 1 }}>{KIND_LABEL[kind]}</T>
          <T size={12} w={500} mono color={c.ink2}>{STATE_LABEL[state]}</T>
        </View>
        {reason ? <T size={12.5} lh={1.4} color={c.ink2}>{reason}</T> : null}
        <T size={12} mono color={c.ink2}>{`nó ${nodeName} · ${peers.length} por perto · ${on} conectados`}</T>
        {peers.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {peers.map(p => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 99,
                borderWidth: 1, borderColor: c.line2, borderStyle: p.connected ? 'solid' : 'dashed' }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink, opacity: p.connected ? 1 : 0.3 }} />
                <T size={11.5} w={500}>{p.name.split(' · ')[0]}</T>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  );
}

const pctStr = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('pt-BR')}%`;
function dur(sec: number | null) {
  if (sec == null) return '—';
  if (sec < 1) return '< 1 s'; // o relógio do protocolo conta em segundos inteiros
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
const MEDIUM: Record<string, [IconName, string]> = { ble: ['bluetooth', 'Bluetooth LE'], direct: ['wifi_tethering', 'Wi-Fi Direct'], mesh: ['hub', 'Wi-Fi Mesh'], lora: ['settings_input_antenna', 'LoRa 915 MHz'], eth: ['lan', 'Ethernet'] };

/** Números do diagnóstico a partir das métricas reais deste aparelho (últimos 7 dias). */
function diag(st: Stats) {
  const m = st.metrics;
  const done = m.delivered + m.expired;
  const kpis: [string, string, string, boolean][] = [
    ['Taxa de entrega', m.sent ? pctStr(m.delivered / m.sent) : '—', `${m.delivered.toLocaleString('pt-BR')} de ${m.sent.toLocaleString('pt-BR')}`, true],
    ['Latência mediana', dur(m.latencyMedian), `p95: ${dur(m.latencyP95)}`, false],
    ['Tempo médio na fila', dur(m.queueMean), `máx.: ${dur(m.queueMax)}`, false],
    ['Expiradas', done ? pctStr(m.expired / Math.max(1, m.sent)) : '—', `${m.expired} ${m.expired === 1 ? 'mensagem' : 'mensagens'}`, false],
  ];
  const tx = Object.entries(m.via).filter(([, v]) => v.ok + v.fail > 0).map(([k, v]) => {
    const [icon, name] = MEDIUM[k] ?? ['sensors', k];
    return [icon, name, Math.round((v.ok / (v.ok + v.fail)) * 100), dur(v.median)] as [IconName, string, number, string];
  });
  const total = Object.values(m.hops).reduce((a, b) => a + b, 0);
  const hops = (['1', '2', '3', '4+'] as const).map((k, i) => [i === 0 ? '1 salto' : k, total ? Math.round(((m.hops[k] ?? 0) / total) * 100) : 0] as [string, number]);
  const mb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${Math.round(b / 1048576)} MB`);
  const node: [string, string][] = [
    ['Pacotes retransmitidos hoje', m.relayedToday.toLocaleString('pt-BR')],
    ['Na fila agora (suas)', String(m.queued)],
    ['Armazenamento de terceiros', mb(m.thirdPartyBytes)],
    ['Rotas alternativas usadas', String(m.altRoutes)],
    ['Retransmitindo agora', st.relay.relaying ? 'sim' : st.relay.reason === 'hours' ? 'fora do horário' : st.relay.reason === 'daily' ? 'limite do dia' : 'não'],
  ];
  return { kpis, tx, hops, node };
}
