import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PHRASE, QUIZ, SAVE_OPTS, type SaveOpt } from '../data/settings';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { OptionCard } from '../ui/Settings';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

type Step = 'phrase' | 'confirm' | 'save';

/** Backup das chaves: frase de 12 palavras → confirmar 3 → onde guardar a cópia cifrada. */
export default function Backup() {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { setBackupDone } = useSettings();
  const [step, setStep] = useState<Step>('phrase');
  const [shown, setShown] = useState(false);
  const [quiz, setQuiz] = useState<Record<number, string>>({});
  const [save, setSave] = useState<SaveOpt>('sd');
  const idx = { phrase: 0, confirm: 1, save: 2 }[step];
  const quizOk = QUIZ.every(([n, , a]) => quiz[n] === a);
  const wrong = QUIZ.find(([n, , a]) => quiz[n] && quiz[n] !== a);

  return (
    <Screen>
      <BackHeader title="Backup das chaves" />
      <View accessibilityLabel={`Passo ${idx + 1} de 3`} style={{ paddingHorizontal: 24, flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? c.ink : c.bg3 }} />)}
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }}>
        {step === 'phrase' && (
          <>
            <StepHeader step="PASSO 1 DE 3" title="Sua frase de recuperação" sub="Estas 12 palavras recuperam suas identidades, contatos e carteira em outro aparelho. Quem tiver a frase tem tudo." />
            <Pressable onPress={() => setShown(true)} accessibilityRole={shown ? undefined : 'button'}
              accessibilityLabel={shown ? 'Frase: ' + PHRASE.map((w, i) => `${i + 1} ${w}`).join(', ') : 'Frase oculta. Toque para mostrar'}
              style={{ marginTop: 4, marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PHRASE.map((w, i) => (
                <View key={w} style={{ width: '31%', flexGrow: 1, height: 42, borderRadius: 12, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 }}>
                  <T size={10.5} w={500} mono color={c.ink2}>{i + 1}</T>
                  {/* Oculta: o RN não tem desfoque de texto portátil; mostramos pontos no lugar da palavra. */}
                  <T size={15} w={600} color={shown ? c.ink : c.ink3}>{shown ? w : '•••••'}</T>
                </View>
              ))}
            </Pressable>
            <View style={{ paddingTop: 16, paddingHorizontal: 24, gap: 10 }}>
              {([['no_photography', 'Não tire print nem foto. Anote no papel.'], ['cloud_off', 'O Piu nunca envia esta frase a ninguém, nem à Lunes.']] as const).map(([ic, t]) => (
                <View key={ic} style={{ flexDirection: 'row', gap: 10 }}><Icon name={ic} size={17} w={300} /><T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t}</T></View>
              ))}
            </View>
            <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
              <Button label={shown ? 'Já anotei' : 'Mostrar a frase'} onPress={() => (shown ? setStep('confirm') : setShown(true))} />
            </View>
          </>
        )}

        {step === 'confirm' && (
          <>
            <StepHeader step="PASSO 2 DE 3" title="Confirme 3 palavras" sub="Para ter certeza de que você anotou tudo certo." />
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              {QUIZ.map(([n, opts, a]) => (
                <View key={n} style={{ padding: 14, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
                  <T size={13.5} color={c.ink2}>Palavra nº {n}</T>
                  <View accessibilityRole="radiogroup" accessibilityLabel={`Palavra número ${n}`} style={{ flexDirection: 'row', gap: 6 }}>
                    {opts.map(w => {
                      const pk = quiz[n] === w, ok = w === a;
                      return (
                        <Pressable key={w} onPress={() => setQuiz(q => ({ ...q, [n]: w }))} accessibilityRole="radio" accessibilityState={{ checked: pk }}
                          accessibilityLabel={pk && !ok ? `${w}, não confere` : w}
                          style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderStyle: pk && !ok ? 'dashed' : 'solid', borderColor: pk ? c.ink : c.line2,
                            backgroundColor: pk && ok ? c.ink : c.bg, alignItems: 'center', justifyContent: 'center' }}>
                          <T size={15} w={600} color={pk && ok ? c.invink : c.ink}>{w}</T>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              <T size={13} color={c.ink2} style={{ paddingHorizontal: 4 }} accessibilityLiveRegion="polite">
                {wrong ? `A palavra nº ${wrong[0]} não confere. Confira no papel.` : quizOk ? 'Tudo certo.' : 'Toque na palavra correta de cada posição.'}
              </T>
            </View>
            <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
              <Button label="Confirmar" disabled={!quizOk} onPress={() => setStep('save')} />
            </View>
          </>
        )}

        {step === 'save' && (
          <>
            <StepHeader step="PASSO 3 DE 3" title="Onde guardar a cópia cifrada?" sub="A frase recupera as chaves. A cópia cifrada também traz o histórico de conversas." />
            <View accessibilityRole="radiogroup" accessibilityLabel="Onde guardar" style={{ paddingHorizontal: 20, gap: 10 }}>
              {SAVE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={title} desc={desc} on={save === k} onPress={() => setSave(k)} />)}
            </View>
            <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
              <Button label="Concluir backup" onPress={() => {
                setBackupDone(true);
                router.back();
                showToast({ icon: 'key', title: 'Backup concluído', body: 'Guarde a frase longe do celular. Você pode refazer quando quiser.' });
              }} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
