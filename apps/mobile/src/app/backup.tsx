import { router } from 'expo-router';
import { usePreventCapture } from '../lib/screenCapture';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SAVE_OPTS, type SaveOpt } from '../data/settings';
import { backupFileName, MIN_PASSWORD, passwordProblem, sealBackup } from '../lib/backupFile';
import { confirmDevice } from '../lib/deviceAuth';
import { PLATFORM_LABEL, thisPlatform } from '../lib/devices';
import { saveBackupFile } from '../lib/migrationIO';
import { collectBackupData } from '../lib/migrationState';
import { fontFamily } from '../theme/fonts';
import { vaultIsSecure } from '../lib/vault';
import { WORDLIST } from '../protocol';
import { useKeys } from '../state/keys';
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

/** Sorteia 3 posições da frase; cada uma com a palavra certa e 2 da lista oficial (embaralhadas). */
function makeQuiz(phrase: string[]): [number, string[], string][] {
  const pick = <X,>(xs: X[]) => xs[Math.floor(Math.random() * xs.length)];
  const positions = new Set<number>();
  while (positions.size < 3) positions.add(Math.floor(Math.random() * phrase.length));
  return [...positions].sort((a, b) => a - b).map(i => {
    const answer = phrase[i];
    const opts = new Set([answer]);
    while (opts.size < 3) { const w = pick(WORDLIST as string[]); if (!phrase.includes(w)) opts.add(w); }
    return [i + 1, [...opts].sort(() => Math.random() - 0.5), answer];
  });
}

/** Backup das chaves: frase de 12 palavras → confirmar 3 → onde guardar a cópia cifrada. */
export default function Backup() {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { setBackupDone, setBackupAt } = useSettings();
  const { phrase: words } = useKeys();
  const PHRASE = words ?? [];
  const [QUIZ] = useState(() => makeQuiz(PHRASE.length ? PHRASE : Array(12).fill('')));
  const [step, setStep] = useState<Step>('phrase');
  // Bloqueia prints e gravação de tela enquanto a frase pode aparecer (Android: FLAG_SECURE).
  usePreventCapture('backup');
  const [noLock, setNoLock] = useState(false);
  const [denied, setDenied] = useState(false);
  /** Quem tem a frase tem tudo: só mostra depois de confirmar que é o dono do aparelho. */
  const reveal = async () => {
    setDenied(false);
    const r = await confirmDevice('Mostrar a frase de recuperação');
    if (r === 'denied') { setDenied(true); return; }
    setNoLock(r === 'unavailable');
    setShown(true);
  };
  const [shown, setShown] = useState(false);
  const [quiz, setQuiz] = useState<Record<number, string>>({});
  const [save, setSave] = useState<SaveOpt>('sd');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const done = (how: 'phrase' | 'file', body: string) => {
    setBackupDone(true);
    setBackupAt({ at: Date.now(), how });
    router.back();
    showToast({ icon: 'key', title: 'Backup concluído', body });
  };
  /** Passo 3: arquivo cifrado com senha, outro aparelho (pareamento) ou só a frase no papel. */
  const finish = async () => {
    if (save === 'paper') { done('phrase', 'Guarde a frase longe do celular. Você pode refazer quando quiser.'); return; }
    if (save === 'device') { router.replace({ pathname: '/devices', params: { add: '1' } }); return; }
    if (!words) return;
    setBusy(true); setSaveErr(null); setProgress(0);
    try {
      const text = await sealBackup({ phrase: words, createdAt: Math.floor(Date.now() / 1000), from: PLATFORM_LABEL[thisPlatform], data: collectBackupData() }, pw, { onProgress: setProgress });
      const r = await saveBackupFile(backupFileName(), text);
      if (r === 'cancelled') { setSaveErr('Nenhuma pasta escolhida. O arquivo não foi salvo.'); return; }
      setPw(''); setPw2('');
      done('file', 'Arquivo cifrado salvo. Guarde a senha e a frase longe dele.');
    } catch (e) {
      setSaveErr((e as Error).message || 'Não foi possível salvar o arquivo.');
    } finally { setBusy(false); }
  };
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
            <StepHeader step="PASSO 1 DE 3" title="Sua frase de recuperação" sub="Estas 12 palavras recuperam suas identidades e a carteira em outro aparelho. Contatos e conversas só vêm no arquivo de backup. Quem tiver a frase tem tudo." />
            <Pressable onPress={() => { if (!shown) void reveal(); }} accessibilityRole={shown ? undefined : 'button'}
              accessibilityLabel={shown ? 'Frase: ' + PHRASE.map((w, i) => `${i + 1} ${w}`).join(', ') : 'Frase oculta. Toque para mostrar'}
              style={{ marginTop: 4, marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PHRASE.map((w, i) => (
                <View key={i} style={{ width: '31%', flexGrow: 1, height: 42, borderRadius: 12, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 }}>
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
              {denied && <T size={13} style={{ paddingBottom: 10 }} accessibilityLiveRegion="polite">Não foi possível confirmar que é você. A frase continua oculta.</T>}
              {shown && (noLock || !vaultIsSecure) && (
                <View style={{ flexDirection: 'row', gap: 10, padding: 12, marginBottom: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
                  <Icon name="warning" size={18} />
                  <T size={12.5} lh={1.4} style={{ flex: 1 }}>{vaultIsSecure
                    ? 'Este aparelho não tem bloqueio de tela: qualquer pessoa com ele em mãos consegue ver esta frase. Ative um PIN ou a biometria.'
                    : 'Versão web de demonstração: a frase fica no navegador, sem cofre seguro. Não use com chaves reais.'}</T>
                </View>
              )}
              <Button label={shown ? 'Já anotei' : 'Mostrar a frase'} onPress={() => (shown ? setStep('confirm') : void reveal())} />
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
                        <Pressable key={w} onPress={() => setQuiz(q => ({ ...q, [n]: w }))} accessibilityRole="radio" accessibilityState={{ checked: pk }} aria-checked={pk}
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
              {SAVE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={title} desc={k === 'sd' ? 'Sem nuvem · protegido por uma senha sua' : desc} on={save === k} onPress={() => { setSave(k); setSaveErr(null); }} />)}
            </View>
            {save === 'sd' && (
              <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
                <T size={13} lh={1.45} color={c.ink2}>Escolha uma senha para o arquivo. Ela não é a frase: sem ela ninguém abre a cópia, nem você.</T>
                {([[pw, setPw, 'Senha do arquivo'], [pw2, setPw2, 'Repita a senha']] as const).map(([v, set, label]) => (
                  <TextInput key={label} value={v} onChangeText={t => { set(t); setSaveErr(null); }} placeholder={label} placeholderTextColor={c.ink3} accessibilityLabel={label}
                    secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" editable={!busy}
                    style={{ height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg, color: c.ink, fontSize: 15, fontFamily: fontFamily(500) }} />
                ))}
                <T size={12.5} color={c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 2 }}>
                  {busy ? `Cifrando… ${Math.round(progress * 100)}%` : pw && passwordProblem(pw) ? passwordProblem(pw)! : pw2 && pw !== pw2 ? 'As senhas não são iguais.' : `Pelo menos ${MIN_PASSWORD} caracteres. Uma frase curta e fácil de lembrar funciona bem.`}
                </T>
              </View>
            )}
            {saveErr && <T size={13} accessibilityRole="alert" style={{ paddingTop: 12, paddingHorizontal: 24 }}>{saveErr}</T>}
            <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
              <Button label={busy ? 'Cifrando…' : save === 'device' ? 'Parear o outro aparelho' : save === 'sd' ? 'Salvar arquivo cifrado' : 'Concluir backup'}
                disabled={busy || (save === 'sd' && (!!passwordProblem(pw) || pw !== pw2))} onPress={() => { void finish(); }} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
