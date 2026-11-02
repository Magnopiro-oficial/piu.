import { router } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { NEIGHBORS, TRANSPORTS } from '../../data/network';
import { fmtL, useNetwork } from '../../state/network';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel, Segmented, Toggle } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Rede: radar de nós, Modo nó (FUN-016), provider, diagnóstico, transportes, limites e nós alcançáveis. */
export default function Network() {
  const { c } = useTheme();
  const n = useNetwork();
  const live = (t: keyof typeof n.tx) => n.tx[t];
  const liveCount = NEIGHBORS.filter(x => live(x.t) && !x.spoof).length;
  const month = n.devices.reduce((a, d) => a + d.month, 0);
  const today = n.devices.reduce((a, d) => a + d.today, 0);
  const has = n.devices.length > 0;
  const stats = n.relay ? [['342', 'pacotes hoje'], ['98%', 'entregues'], ['61 MB', 'em uso']] : [['—', 'pacotes hoje'], ['—', 'entregues'], ['0 MB', 'em uso']];
  const fg = n.relay ? c.invink : c.ink;

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8, gap: 4 }}>
          <T size={36} w={700} ls={-0.045} style={{ lineHeight: 38 }} accessibilityRole="header">Rede</T>
          <T size={14} color={c.ink2}>Sem internet · malha local ativa</T>
        </View>

        <Radar liveCount={liveCount} />

        {/* Modo nó */}
        <View style={{ marginTop: 14, marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: n.relay ? c.ink : c.bg2, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <T size={17} w={650} ls={-0.02} color={fg}>Modo nó</T>
              <T size={13} lh={1.35} color={fg} style={{ opacity: 0.75 }}>Retransmitir mensagens cifradas de outras pessoas. No iPhone, só enquanto o app está aberto.</T>
            </View>
            <RelaySwitch on={n.relay} onChange={() => n.setRelay(!n.relay)} />
          </View>
          <View style={{ height: 1, backgroundColor: fg, opacity: 0.15 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {stats.map(([v, l]) => (
              <View key={l} style={{ flex: 1, gap: 2 }}>
                <T size={20} w={650} ls={-0.03} tabular color={fg}>{v}</T>
                <T size={11.5} color={fg} style={{ opacity: 0.7 }}>{l}</T>
              </View>
            ))}
          </View>
        </View>

        {/* provider */}
        <Pressable onPress={() => router.push(has ? '/provider' : '/provider/intro')} accessibilityRole="button"
          style={({ pressed }) => ({ marginTop: 12, marginHorizontal: 20, padding: 16, borderRadius: 22, borderWidth: 1.5, borderColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 14, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="router" size={23} w={300} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T size={16} w={650} ls={-0.015}>{has ? `Provider · ${n.devices.length} ${n.devices.length > 1 ? 'equipamentos' : 'equipamento'}` : 'Seja um provider'}</T>
            <T size={12.5} lh={1.35} color={c.ink2}>{has ? `+${fmtL(today)} LUNES hoje · ${fmtL(month)} no mês` : 'Use seu roteador ou antena para transmitir e ganhar LUNES'}</T>
          </View>
          <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
        </Pressable>

        <Pressable onPress={() => router.push('/diagnostics')} accessibilityRole="button"
          style={{ marginTop: 10, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="monitoring" size={22} w={300} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T size={15} w={600}>Diagnóstico local</T>
            <T size={12.5} color={c.ink2}>96,4% entregues em 7 dias · sem telemetria</T>
          </View>
          <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
        </Pressable>

        <SectionLabel>TRANSPORTES</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {TRANSPORTS.map(([k, icon, name, desc, descOn], i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={550}>{name}</T>
                <T size={12.5} lh={1.3} color={c.ink2}>{n.tx[k] && descOn ? descOn : desc}</T>
              </View>
              <Toggle on={n.tx[k]} onChange={() => n.toggleTx(k)} label={name} />
            </View>
          ))}
        </View>

        <SectionLabel>LIMITES DO NÓ</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 16 }}>
          <LimitRow title="Parar abaixo de" hint="bateria">
            <Segmented label="Parar abaixo de" value={String(n.battery)} onChange={v => n.setBattery(Number(v) as 20 | 30 | 50)} options={[['20', '20%'], ['30', '30%'], ['50', '50%']]} />
          </LimitRow>
          <LimitRow title="Espaço para terceiros" hint="armazenamento">
            <Segmented label="Espaço para terceiros" value={String(n.storage)} onChange={v => n.setStorage(Number(v) as 256 | 512 | 1024)} options={[['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB']]} />
          </LimitRow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={14} w={550}>Só retransmitir carregando</T>
              <T size={12.5} color={c.ink2}>Preserva a bateria em segundo plano</T>
            </View>
            <Toggle on={n.chargingOnly} onChange={() => n.setChargingOnly(!n.chargingOnly)} label="Só retransmitir carregando" />
          </View>
        </View>

        <SectionLabel>NÓS ALCANÇÁVEIS</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {NEIGHBORS.map(x => (
            <View key={x.name} accessibilityLabel={`${x.name}, ${x.cls}, ${x.via}, ${x.dist}${x.spoof ? ', imitação ignorada' : live(x.t) ? '' : ', transporte desligado'}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line, opacity: x.spoof ? 0.55 : live(x.t) ? 1 : 0.4 }}>
              <Icon name={x.icon} size={22} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={550}>{x.name}</T>
                <T size={11.5} mono color={c.ink2}>{x.cls} · {x.via}</T>
              </View>
              <T size={12} w={500} mono color={c.ink2}>{x.dist}</T>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function LimitRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={14} w={550}>{title}</T><T size={14} color={c.ink2}>{hint}</T></View>
      {children}
    </View>
  );
}

/** Toggle invertido do cartão do Modo nó (50×30). */
function RelaySwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  const { c, reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { x.setValue(on ? 1 : 0); return; }
    Animated.timing(x, { toValue: on ? 1 : 0, duration: 250, easing: Easing.bezier(0.2, 0.9, 0.3, 1.3), useNativeDriver: true }).start();
  }, [on, reduceMotion, x]);
  return (
    <Pressable onPress={onChange} accessibilityRole="switch" accessibilityLabel="Modo nó" accessibilityState={{ checked: on }} aria-checked={on}
      style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? c.invink : c.bg3 }}>
      <Animated.View style={{ position: 'absolute', top: 3, left: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: on ? c.ink : c.knob,
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }} />
    </Pressable>
  );
}

/** Radar 230 px: anéis fixos, “você” no centro com pulso contínuo (3,2 s) e nós ao redor. */
function Radar({ liveCount }: { liveCount: number }) {
  const { c, reduceMotion } = useTheme();
  const { tx } = useNetwork();
  const rings = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loops = rings.map((r, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 1600),
      Animated.timing(r, { toValue: 1, duration: 3200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduceMotion, rings]);

  return (
    <View accessibilityLabel={`Radar: ${liveCount} nós alcançáveis, sem internet`}
      style={{ marginTop: 10, marginHorizontal: 20, height: 230, borderRadius: 24, backgroundColor: c.bg2, overflow: 'hidden' }}>
      {[300, 200, 100].map(s => (
        <View key={s} style={{ position: 'absolute', left: '50%', top: '50%', width: s, height: s, marginLeft: -s / 2, marginTop: -s / 2, borderRadius: s / 2, borderWidth: 1, borderColor: c.line2 }} />
      ))}
      {NEIGHBORS.map(x => {
        const on = tx[x.t] && !x.spoof;
        const size = x.big ? 14 : 10;
        // Rótulo de 80 px: centralizado no ponto, ou alinhado para dentro perto das bordas.
        const edge = x.x < 22 ? 'flex-start' : x.x > 78 ? 'flex-end' : 'center';
        const dx = edge === 'flex-start' ? -size / 2 : edge === 'flex-end' ? -80 + size / 2 : -40;
        return (
          <View key={x.name} style={{ position: 'absolute', left: `${x.x}%`, top: `${x.y}%`, alignItems: edge, gap: 4, opacity: x.spoof ? 0.35 : tx[x.t] ? 1 : 0.45, transform: [{ translateX: dx }, { translateY: -size / 2 }], width: 80 }}>
            <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: on ? c.ink : 'transparent', borderWidth: 1.5, borderColor: c.ink }} />
            <T size={10} w={500} mono color={c.ink2} numberOfLines={1}>{x.name.split(' · ')[0]}</T>
          </View>
        );
      })}
      {rings.map((r, i) => (
        <Animated.View key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink,
          opacity: r.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 0.5, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 6] }) }] }} />
      ))}
      <View style={{ position: 'absolute', left: '50%', top: '50%', width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: 26, backgroundColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={11} w={600} color={c.invink}>você</T></View>
      </View>
      <T size={11} w={500} mono color={c.ink2} style={{ position: 'absolute', left: 14, top: 12 }}>{liveCount} nós alcançáveis · 0 internet</T>
    </View>
  );
}
