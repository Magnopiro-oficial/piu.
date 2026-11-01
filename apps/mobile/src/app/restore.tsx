import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { RESTORE_OPTS } from '../data/settings';
import { isValidPhrase, PHRASE_WORDS, WORDLIST } from '../protocol';
import { useKeys } from '../state/keys';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { PhraseInput } from '../ui/PhraseInput';
import { Screen } from '../ui/Screen';
import { OptionCard } from '../ui/Settings';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

/**
 * Restaurar: as chaves vêm de outro aparelho seu, da frase ou de um arquivo. Sem servidor.
 * A frase é real (recria as mesmas chaves); "outro aparelho" e "arquivo" ainda são simulados
 * e, por enquanto, geram chaves novas.
 */
export default function Restore() {
  const { c } = useTheme();
  const { restoreMode, setRestoreMode } = useSettings();
  const { restore, create, identities } = useKeys();
  const [words, setWords] = useState<string[]>(Array(PHRASE_WORDS).fill(''));
  const [err, setErr] = useState<string | null>(null);
  const filled = words.every(Boolean);
  const unknown = words.filter(w => w && !WORDLIST.includes(w)).length;
  const valid = isValidPhrase(words);
  const hint = !filled ? `${words.filter(Boolean).length} de ${PHRASE_WORDS} palavras`
    : unknown ? `${unknown} ${unknown > 1 ? 'palavras não estão' : 'palavra não está'} na lista`
      : valid ? 'Frase confere.' : 'As palavras não formam uma frase válida. Confira a ordem e cada palavra.';
  const canGo = restoreMode !== 'phrase' || valid;

  const go = async () => {
    setErr(null);
    try {
      if (restoreMode === 'phrase') await restore(words);
      else if (!identities) await create();
      router.push('/migrate');
    } catch {
      setErr('Não foi possível guardar as chaves no cofre do aparelho.');
    }
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step="RECUPERAR" title="Traga suas chaves para este aparelho." sub="Sem servidor: elas vêm de outro aparelho seu, da sua frase ou de um arquivo de backup." />
        <View accessibilityRole="radiogroup" accessibilityLabel="Como recuperar" style={{ paddingHorizontal: 20, gap: 10 }}>
          {RESTORE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={title} desc={desc} on={restoreMode === k} onPress={() => setRestoreMode(k)} />)}
        </View>
        {restoreMode === 'phrase' && (
          <View style={{ marginTop: 14, marginHorizontal: 20, gap: 8 }}>
            <PhraseInput words={words} onChange={setWords} />
            <T size={13} color={valid ? c.ink : c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 4 }}>{hint}</T>
          </View>
        )}
        {err && <T size={13} style={{ paddingTop: 12, paddingHorizontal: 24 }}>{err}</T>}
        <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
          <Button label="Continuar" disabled={!canGo} onPress={go} />
        </View>
      </ScrollView>
    </Screen>
  );
}
