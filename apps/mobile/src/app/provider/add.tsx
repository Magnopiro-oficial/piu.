import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PROV_FAMILIES } from '../../data/network';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { RadioDot, StepHeader } from '../../ui/StepHeader';
import { T } from '../../ui/T';

/** Passo 1: tipo de equipamento (o selo mostra o quanto cada suporte está pronto). */
export default function ProvAdd() {
  const { c } = useTheme();
  const [fam, setFam] = useState(PROV_FAMILIES[0].id);
  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <StepHeader step="PASSO 1 · EQUIPAMENTO" title="O que você vai conectar?" />
        <View accessibilityRole="radiogroup" style={{ paddingHorizontal: 20, gap: 8 }}>
          {PROV_FAMILIES.map(f => {
            const on = fam === f.id;
            return (
              <Pressable key={f.id} disabled={f.disabled} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: f.disabled }} aria-checked={on}
                onPress={() => setFam(f.id)}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.bg2 : 'transparent', opacity: f.disabled ? 0.45 : 1 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><Icon name={f.icon} size={22} w={300} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <T size={15.5} w={600}>{f.name}</T>
                    <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: c.line2 }}><T size={10.5} w={500} mono color={c.ink2}>{f.badge}</T></View>
                  </View>
                  <T size={12} mono color={c.ink2}>{f.cls}</T>
                  <T size={13} lh={1.35} color={c.ink2}>{f.desc}</T>
                </View>
                <RadioDot on={on} />
              </Pressable>
            );
          })}
        </View>
        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Continuar" onPress={() => router.push({ pathname: '/provider/connect', params: { fam } })} />
        </View>
      </ScrollView>
    </Screen>
  );
}
