import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { PROV_FAMILIES } from '../../data/network';
import { useNetwork } from '../../state/network';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { StepHeader } from '../../ui/StepHeader';
import { T } from '../../ui/T';

const CHECK_MS = 800;

/** Passo 3 de 4 (INF-010): teste real com vizinhos independentes; capacidade anunciada não basta. */
export default function ProvTest() {
  const { c, reduceMotion } = useTheme();
  const { draft, devices } = useNetwork();
  const fam = PROV_FAMILIES.find(f => f.id === draft.fam) ?? PROV_FAMILIES[0];
  const parent = devices.find(d => d.id === draft.parent)?.name ?? 'nó pai';
  const [n, setN] = useState(0);
  const done = n >= 5;
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => setN(x => { const v = x + 1; if (v >= 5) clearInterval(t); return Math.min(v, 5); }), CHECK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!done) return;
    if (reduceMotion) card.setValue(1); else Animated.timing(card, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [done, reduceMotion, card]);

  const checks: [string, string][] = fam.isAp
    ? [['Sinal no local', '−58 dBm · cobertura estimada de 25 m'], ['Isolamento de clientes', 'desativado · celulares se enxergam'], ['Descoberta local', 'mDNS e multicast passando'],
       ['Ligação ao nó pai', `${parent} · 9 ms`], ['Teste com celulares', '2 celulares trocaram 40 pacotes pelo repetidor · 100% ok']]
    : [[fam.install ? 'Pacote Piu Node' : 'Adapter de rádio', `${fam.pkg} · assinatura Lunes conferida`], ['Hardware', fam.hw ?? ''], ['Interfaces', fam.ifs ?? ''],
       ['Identidade técnica do nó', 'chave gerada no equipamento · separada da sua identidade'],
       ['Encaminhamento real', fam.isRadio ? 'alcance medido por 2 nós independentes · 4,1 km' : '120 pacotes de teste por 3 vizinhos independentes · 99% ok']];
  const measured = fam.isAp ? [[fam.bw, 'cobertura'], [fam.lat, 'até o nó pai'], [fam.nb, 'celulares']] : [[fam.bw, 'banda medida'], [fam.lat, 'latência'], [fam.nb, 'vizinhos']];

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
        <StepHeader step="PASSO 3 DE 4 · TESTE REAL" title={done ? 'Aprovado para a malha.' : 'Testando seu equipamento…'}
          sub="Capacidade anunciada não basta. Medimos de verdade, com nós vizinhos independentes." />
        <View accessibilityLiveRegion="polite" style={{ paddingTop: 6, paddingHorizontal: 24 }}>
          {checks.map(([t, d], i) => {
            const ok = i < n, cur = i === n;
            return (
              <View key={t} accessibilityLabel={`${t}: ${ok ? 'concluído' : cur ? 'em andamento' : 'aguardando'}`}
                style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line, opacity: ok || cur ? 1 : 0.4 }}>
                <Icon name={ok ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={22} fill={ok} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={15} w={600}>{t}</T>
                  <T size={11.5} mono lh={1.45} color={c.ink2}>{d}</T>
                </View>
              </View>
            );
          })}
        </View>
        {done && (
          <Animated.View style={{ marginTop: 16, marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.ink, gap: 14, opacity: card,
            transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
            <View style={{ gap: 4 }}>
              <T size={12.5} color={c.invink} style={{ opacity: 0.7 }}>Classe aprovada</T>
              <T size={21} w={650} ls={-0.025} color={c.invink}>{fam.result}</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {measured.map(([v, l]) => (
                <View key={l} style={{ flex: 1, gap: 2 }}>
                  <T size={18} w={650} ls={-0.02} color={c.invink}>{v}</T>
                  <T size={11.5} color={c.invink} style={{ opacity: 0.7 }}>{l}</T>
                </View>
              ))}
            </View>
          </Animated.View>
        )}
        <View style={{ flex: 1 }} />
        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Configurar regras" disabled={!done} onPress={() => router.push('/provider/config')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
