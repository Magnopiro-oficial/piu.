import { ScrollView, Share, View } from 'react-native';
import type { IconName } from '../ui/Icon';
import { fmtNumber, useT } from '../i18n';
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
  const t = useT();
  const { showToast } = useStore();
  const st = useStats();
  const d = st ? diag(st, t) : null;
  const exportReport = async () => {
    if (!st) return;
    // Só métricas agregadas deste aparelho: sem conteúdo, contatos nem ids de envelope.
    const report = JSON.stringify({ geradoEm: new Date().toISOString(), ultimos7dias: { ...st.metrics }, creditos: st.credits.totals, lotes: st.credits.lots, retransmissao: st.relay }, null, 2);
    try { await Share.share({ title: 'piu-diagnostico.json', message: report }); }
    catch { showToast({ icon: 'error', title: t('diag.exportFail'), body: t('common.tryAgain') }); }
  };
  return (
    <Screen>
      <BackHeader title={t('diag.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 24, paddingBottom: 12 }}>{t('diag.last7')}</T>
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

        <SectionLabel>{t('diag.byTransport')}</SectionLabel>
        <View style={{ marginHorizontal: 20, paddingVertical: 4, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.bg2 }}>
          {d && d.tx.length === 0 && <T size={13} color={c.ink2} style={{ paddingVertical: 14 }}>{t('diag.noSends')}</T>}
          {(d?.tx ?? []).map(([icon, n, rate, lat], i) => (
            <View key={n} accessibilityLabel={t('diag.tx.a11y', { name: n, rate, lat })} style={{ gap: 7, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
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

        <SectionLabel>{t('diag.byHops')}</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'flex-end', gap: 12, height: 150 }}>
          {(d?.hops ?? []).map(([l, v], i) => (
            <View key={l} accessibilityLabel={t('diag.hops.a11y', { hops: l, pct: v })} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <T size={11.5} w={500} mono>{v}%</T>
              <GrowCol pct={v * 0.85} opacity={1 - i * 0.18} delay={i * 35} />
              <T size={11.5} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>

        <SectionLabel>{t('diag.asNode')}</SectionLabel>
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
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('diag.note')}</T>
        </View>
        <View style={{ paddingTop: 16, paddingHorizontal: 20 }}>
          <Button label={t('diag.export')} variant="outline" height={48} disabled={!st} onPress={() => void exportReport()} />
        </View>
      </ScrollView>
    </Screen>
  );
}



/** Transporte P2P real deste aparelho: tipo, estado e vizinhos (simulado no navegador e no Expo Go). */
function TransportCard() {
  const { c } = useTheme();
  const t = useT();
  const { kind, state, reason, peers, nodeName } = useTransport();
  const KIND_LABEL = { nearby: t('diag.kind.nearby'), ble: 'Bluetooth LE', sim: t('diag.kind.sim') } as const;
  const STATE_LABEL = { off: t('diag.state.off'), starting: t('diag.state.starting'), running: t('diag.state.running'), unavailable: t('network.unavailable') } as const;
  const on = peers.filter(p => p.connected).length;
  return (
    <>
      <SectionLabel>{t('diag.transportHere')}</SectionLabel>
      <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, gap: 10,
        backgroundColor: kind === 'sim' ? 'transparent' : c.bg2, borderWidth: kind === 'sim' ? 1 : 0, borderStyle: 'dashed', borderColor: c.line2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name={kind === 'nearby' ? 'wifi_tethering' : 'bluetooth'} size={20} w={300} />
          <T size={14.5} w={600} style={{ flex: 1 }}>{KIND_LABEL[kind]}</T>
          <T size={12} w={500} mono color={c.ink2}>{STATE_LABEL[state]}</T>
        </View>
        {reason ? <T size={12.5} lh={1.4} color={c.ink2}>{reason}</T> : null}
        <T size={12} mono color={c.ink2}>{t('diag.nodeLine', { node: nodeName, nearby: peers.length, connected: on })}</T>
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

const pctStr = (n: number) => `${fmtNumber(Math.round(n * 1000) / 10)}%`;
function dur(sec: number | null) {
  if (sec == null) return '—';
  if (sec < 1) return '< 1 s'; // o relógio do protocolo conta em segundos inteiros
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
type Tr = ReturnType<typeof useT>;
const MEDIUM: Record<string, [IconName, string]> = { ble: ['bluetooth', 'Bluetooth LE'], direct: ['wifi_tethering', 'Wi-Fi Direct'], mesh: ['hub', 'Wi-Fi Mesh'], lora: ['settings_input_antenna', 'LoRa 915 MHz'], eth: ['lan', 'Ethernet'] };

/** Números do diagnóstico a partir das métricas reais deste aparelho (últimos 7 dias), no idioma em uso. */
function diag(st: Stats, t: Tr) {
  const m = st.metrics;
  const done = m.delivered + m.expired;
  const kpis: [string, string, string, boolean][] = [
    [t('diag.kpi.delivery'), m.sent ? pctStr(m.delivered / m.sent) : '—', t('diag.kpi.ofSent', { delivered: fmtNumber(m.delivered), sent: fmtNumber(m.sent) }), true],
    [t('diag.kpi.latency'), dur(m.latencyMedian), `p95: ${dur(m.latencyP95)}`, false],
    [t('diag.kpi.queue'), dur(m.queueMean), `${t('diag.kpi.max')} ${dur(m.queueMax)}`, false],
    [t('diag.kpi.expired'), done ? pctStr(m.expired / Math.max(1, m.sent)) : '—', t('diag.kpi.messages', { count: m.expired }), false],
  ];
  const tx = Object.entries(m.via).filter(([, v]) => v.ok + v.fail > 0).map(([k, v]) => {
    const [icon, name] = MEDIUM[k] ?? ['sensors', k];
    return [icon, name, Math.round((v.ok / (v.ok + v.fail)) * 100), dur(v.median)] as [IconName, string, number, string];
  });
  const total = Object.values(m.hops).reduce((a, b) => a + b, 0);
  const hops = (['1', '2', '3', '4+'] as const).map((k, i) => [i === 0 ? t('diag.oneHop') : k, total ? Math.round(((m.hops[k] ?? 0) / total) * 100) : 0] as [string, number]);
  const mb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${Math.round(b / 1048576)} MB`);
  const node: [string, string][] = [
    [t('diag.node.relayedToday'), fmtNumber(m.relayedToday)],
    [t('diag.node.queued'), String(m.queued)],
    [t('diag.node.thirdParty'), mb(m.thirdPartyBytes)],
    [t('diag.node.altRoutes'), String(m.altRoutes)],
    [t('diag.node.relaying'), st.relay.relaying ? t('common.yes').toLowerCase() : st.relay.reason === 'hours' ? t('diag.node.offHours') : st.relay.reason === 'daily' ? t('diag.node.dailyLimit') : t('common.no').toLowerCase()],
  ];
  return { kpis, tx, hops, node };
}
