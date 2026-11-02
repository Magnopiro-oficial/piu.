import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { NEAR_PROFILES, REQUESTS } from '../../data/wallet';
import { useWallet } from '../../state/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { Stripes } from '../../ui/Stripes';
import { T } from '../../ui/T';

/** Por perto: visibilidade recíproca (desliga sozinha em 1 h), perfis públicos com proximidade aproximada. */
export default function Nearby() {
  const { c } = useTheme();
  const { visible, setVisible, visibleMinutesLeft, inviteState, reqStatus } = useWallet();
  const pending = REQUESTS.filter(r => !reqStatus[r.id]).length;
  const fg = visible ? c.invink : c.ink;

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <T size={36} w={700} ls={-0.045} style={{ lineHeight: 38 }} accessibilityRole="header">Por perto</T>
          <Pressable onPress={() => router.push('/nearby/requests')} accessibilityRole="button" accessibilityLabel={`Pedidos de conversa, ${pending} pendentes`}
            style={{ height: 34, paddingLeft: 12, paddingRight: 6, borderRadius: 17, borderWidth: 1, borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T size={13} w={550}>Pedidos</T>
            <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={11.5} w={600} color={c.invink}>{pending}</T></View>
          </Pressable>
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: visible ? c.ink : c.bg2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name={visible ? 'visibility' : 'visibility_off'} size={24} w={300} color={fg} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15} w={600} color={fg}>{visible ? 'Você está visível' : 'Você está invisível'}</T>
            <T size={12.5} color={fg} style={{ opacity: 0.75 }}>{visible ? `Perfil público · desliga sozinho em ${visibleMinutesLeft} min` : 'Identidade anônima nunca aparece aqui'}</T>
          </View>
          <VisSwitch on={visible} onChange={() => setVisible(!visible)} />
        </View>

        {visible ? (
          <>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 20, paddingHorizontal: 24, paddingBottom: 10 }}>{`${NEAR_PROFILES.length} PERFIS PÚBLICOS · SEM LOCALIZAÇÃO EXATA`}</T>
            <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {NEAR_PROFILES.map(p => (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/nearby/[id]', params: { id: p.id } })} accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${p.age} anos, ${p.prox}. ${p.bio}${inviteState(p.id).kind === 'pending' ? '. Convite enviado' : ''}`}
                  style={({ pressed }) => ({ width: '47.5%', flexGrow: 1, gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Stripes period={16} style={{ height: 180, borderRadius: 22 }}>
                    <T size={10} w={500} mono color={c.ink2}>foto de perfil</T>
                    <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 99, backgroundColor: c.bg }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink, opacity: p.prox === 'muito perto' ? 1 : p.prox === 'perto' ? 0.6 : 0.3 }} />
                      <T size={11} w={550}>{p.prox}</T>
                    </View>
                    {inviteState(p.id).kind === 'pending' && (
                      <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, height: 30, borderRadius: 15, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <Icon name="schedule_send" size={15} color={c.invink} />
                        <T size={12} w={600} color={c.invink}>Convite enviado</T>
                      </View>
                    )}
                  </Stripes>
                  <View style={{ gap: 2, paddingHorizontal: 4 }}>
                    <T size={15.5} w={650} ls={-0.015}>{p.name}, {p.age}</T>
                    <T size={12.5} lh={1.35} color={c.ink2} numberOfLines={2}>{p.bio}</T>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={{ paddingVertical: 56, paddingHorizontal: 40, alignItems: 'center', gap: 10 }}>
            <Icon name="visibility_off" size={40} w={300} color={c.ink2} />
            <T size={17} w={650} align="center">Ninguém vê você, e você não vê ninguém</T>
            <T size={13.5} lh={1.45} color={c.ink2} align="center">Por perto é recíproco: para descobrir pessoas, seu perfil público também fica visível.</T>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Toggle invertido 50×30 (cartão de visibilidade). */
function VisSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  const { c, reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { x.setValue(on ? 1 : 0); return; }
    Animated.timing(x, { toValue: on ? 1 : 0, duration: 250, easing: Easing.bezier(0.2, 0.9, 0.3, 1.3), useNativeDriver: true }).start();
  }, [on, reduceMotion, x]);
  return (
    <Pressable onPress={onChange} accessibilityRole="switch" accessibilityLabel="Visível em Por perto" accessibilityState={{ checked: on }} aria-checked={on}
      style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? c.invink : c.bg3 }}>
      <Animated.View style={{ position: 'absolute', top: 3, left: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: on ? c.ink : c.knob,
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }} />
    </Pressable>
  );
}
