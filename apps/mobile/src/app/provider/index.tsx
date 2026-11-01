import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { PROV_DAILY, PROV_PENDING, PROV_REJECTED, type ProvDevice } from '../../data/network';
import { fmtL, useNetwork } from '../../state/network';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { StatusDot, statusOf } from '../../ui/ProvBits';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';


/** Painel do provider no celular: ganhos do mês (14 dias), estados, entregas do dia e equipamentos. */
export default function Provider() {
  const { c } = useTheme();
  const { devices } = useNetwork();
  const month = devices.reduce((a, d) => a + d.month, 0);
  const today = devices.reduce((a, d) => a + d.today, 0);
  const active = devices.filter(d => d.status === 'active').length;
  const bars = [...PROV_DAILY, today];
  const mx = Math.max(...bars);

  return (
    <Screen>
      <BackHeader title="Provider" right={
        <Pressable onPress={() => router.push('/provider/add')} accessibilityRole="button" accessibilityLabel="Adicionar equipamento"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="add" size={22} />
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 4, marginHorizontal: 20, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 16, borderRadius: 26, backgroundColor: c.ink, gap: 16 }}>
          <View style={{ gap: 6 }}>
            <T size={13} color={c.invink} style={{ opacity: 0.7 }}>Ganhos em outubro</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={50} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 52 }}>{fmtL(month)}</T>
              <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>LUNES</T>
            </View>
            <T size={13} color={c.invink} style={{ opacity: 0.75 }}>+{fmtL(today)} hoje · {active} de {devices.length} equipamentos ativos</T>
          </View>
          <View style={{ gap: 6 }}>
            <View accessibilityLabel="Ganhos diários dos últimos 14 dias" style={{ height: 64, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
              {bars.map((v, i) => <Bar key={i} pct={Math.max(4, (v / mx) * 100)} opacity={i === bars.length - 1 ? 1 : 0.42} delay={i * 35} />)}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: 0.6 }}>
              <T size={10.5} mono color={c.invink}>18 out</T><T size={10.5} mono color={c.invink}>hoje</T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)' }}>
            {[[fmtL(month - PROV_PENDING), 'validados'], [fmtL(PROV_PENDING), 'pendentes'], [fmtL(PROV_REJECTED), 'rejeitados']].map(([v, l]) => (
              <View key={l} style={{ flex: 1, gap: 2 }}>
                <T size={16} w={650} tabular color={c.invink}>{v}</T>
                <T size={11.5} color={c.invink} style={{ opacity: 0.7 }}>{l}</T>
              </View>
            ))}
          </View>
        </View>

        <Pressable onPress={() => router.push('/provider/earnings')} accessibilityRole="button"
          style={{ marginTop: 10, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="event_upcoming" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>Próxima liquidação · lote #0047</T>
            <T size={12.5} color={c.ink2}>1º nov, ou quando um gateway alcançar a Mainnet</T>
          </View>
          <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
        </Pressable>

        <SectionLabel>ENTREGAS HOJE</SectionLabel>
        <View style={{ marginHorizontal: 20, flexDirection: 'row', gap: 8 }}>
          {[['18.402', 'pacotes entregues'], ['97,8%', 'confirmados pelo destino'], ['312', 'duplicatas descartadas']].map(([v, l]) => (
            <View key={l} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.bg2, gap: 4 }}>
              <T size={19} w={650} ls={-0.03} tabular>{v}</T>
              <T size={11.5} lh={1.3} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>

        <SectionLabel>{`EQUIPAMENTOS · ${devices.length}`}</SectionLabel>
        <View style={{ marginHorizontal: 20, gap: 8 }}>
          {devices.map(d => <DeviceRow key={d.id} d={d} />)}
        </View>
        <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 18, marginHorizontal: 24 }}>Seus equipamentos só veem envelopes cifrados. Ganhos vêm de recibos confirmados pelo destino e por nós independentes.</T>
      </ScrollView>
    </Screen>
  );
}

function DeviceRow({ d }: { d: ProvDevice }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(d.fresh && !reduceMotion ? 0 : 1)).current;
  useEffect(() => { if (d.fresh && !reduceMotion) Animated.timing(v, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }).start(); }, [d.fresh, reduceMotion, v]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <Pressable onPress={() => router.push({ pathname: '/provider/device/[id]', params: { id: d.id } })} accessibilityRole="button"
        accessibilityLabel={`${d.name}, ${d.cls}, ${statusOf(d.status)}, mais ${fmtL(d.today)} LUNES hoje`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={d.icon} size={23} w={300} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T size={15} w={600} numberOfLines={2}>{d.name}</T>
          <T size={11.5} mono color={c.ink2} numberOfLines={1}>{d.cls} · {d.pub}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StatusDot status={d.status} />
            <T size={12} color={c.ink2} numberOfLines={1} style={{ flex: 1 }}>{statusOf(d.status)}</T>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <T size={14.5} w={650} tabular>+{fmtL(d.today)}</T>
          <T size={11} mono color={c.ink2}>{d.status === 'paused' ? '0' : d.pph} pac/h</T>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function Bar({ pct, opacity, delay }: { pct: number; opacity: number; delay: number }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(v, { toValue: 1, duration: 600, delay, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(); }, [reduceMotion, v, delay]);
  return <Animated.View style={{ flex: 1, borderRadius: 3, backgroundColor: c.invink, opacity, height: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] }) }} />;
}
