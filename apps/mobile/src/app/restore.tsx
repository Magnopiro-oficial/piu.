import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { PHRASE, RESTORE_OPTS } from '../data/settings';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Screen } from '../ui/Screen';
import { OptionCard } from '../ui/Settings';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

/** Restaurar: as chaves vêm de outro aparelho seu, da frase ou de um arquivo. Sem servidor. */
export default function Restore() {
  const { c } = useTheme();
  const { restoreMode, setRestoreMode } = useSettings();
  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <StepHeader step="RECUPERAR" title="Traga suas chaves para este aparelho." sub="Sem servidor: elas vêm de outro aparelho seu, da sua frase ou de um arquivo de backup." />
        <View accessibilityRole="radiogroup" accessibilityLabel="Como recuperar" style={{ paddingHorizontal: 20, gap: 10 }}>
          {RESTORE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={title} desc={desc} on={restoreMode === k} onPress={() => setRestoreMode(k)} />)}
        </View>
        {restoreMode === 'phrase' && (
          <View accessibilityLabel="Digitando a frase: 5 de 12 palavras" style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PHRASE.map((w, i) => (
              <View key={i} style={{ width: '31%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, borderWidth: 1, borderColor: i === 5 ? c.ink : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 }}>
                <T size={10.5} w={500} mono color={c.ink2}>{i + 1}</T>
                <T size={14.5} w={600}>{i < 5 ? w : i === 5 ? 'lu|' : ''}</T>
              </View>
            ))}
          </View>
        )}
        <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
          <Button label="Continuar" onPress={() => router.push('/migrate')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
