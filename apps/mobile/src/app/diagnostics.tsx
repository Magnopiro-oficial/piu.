import { ScrollView, View } from 'react-native';
import { DIAG } from '../data/network';
import { useStore } from '../state/store';
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
  return (
    <Screen>
      <BackHeader title="Diagnóstico" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 24, paddingBottom: 12 }}>ÚLTIMOS 7 DIAS · CALCULADO NESTE APARELHO</T>
        <View style={{ marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DIAG.kpis.map(([l, v, d, hi]) => (
            <View key={l} style={{ width: '48.5%', flexGrow: 1, padding: 14, borderRadius: 18, backgroundColor: hi ? c.ink : c.bg2, gap: 4 }}>
              <T size={12} color={hi ? c.invink : c.ink} style={{ opacity: 0.75 }}>{l}</T>
              <T size={26} w={650} ls={-0.035} color={hi ? c.invink : c.ink}>{v}</T>
              <T size={11} mono color={hi ? c.invink : c.ink} style={{ opacity: 0.7 }}>{d}</T>
            </View>
          ))}
        </View>

        <SectionLabel>POR TRANSPORTE</SectionLabel>
        <View style={{ marginHorizontal: 20, paddingVertical: 4, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.bg2 }}>
          {DIAG.tx.map(([icon, n, rate, lat], i) => (
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

        <SectionLabel>ENTREGA POR NÚMERO DE SALTOS</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'flex-end', gap: 12, height: 150 }}>
          {DIAG.hops.map(([l, v], i) => (
            <View key={l} accessibilityLabel={`${l === '1 salto' ? l : l + ' saltos'}: ${v}% entregues`} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <T size={11.5} w={500} mono>{v}%</T>
              <GrowCol pct={v * 0.85} opacity={1 - i * 0.18} delay={i * 35} />
              <T size={11.5} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>

        <SectionLabel>ESTE APARELHO COMO NÓ</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {DIAG.node.map(([l, v], i) => (
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
          <Button label="Exportar relatório local" variant="outline" height={48}
            onPress={() => showToast({ icon: 'download', title: 'Relatório salvo no aparelho', body: 'piu-diagnostico.json · você decide com quem compartilhar.' })} />
        </View>
      </ScrollView>
    </Screen>
  );
}
