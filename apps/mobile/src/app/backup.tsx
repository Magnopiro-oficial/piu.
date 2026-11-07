import { router, type Href } from 'expo-router';
import { usePreventCapture } from '../lib/screenCapture';
import { useMemo, useState } from 'react';
import Svg, { FeGaussianBlur, Filter, G, Rect } from 'react-native-svg';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SAVE_OPTS, type SaveOpt } from '../data/settings';
import { backupFileName, MIN_PASSWORD, passwordIssue, sealBackup } from '../lib/backupFile';
import { useT } from '../i18n';
import { platformName, thisPlatform } from '../lib/devices';
import { lockGate } from '../lib/identityGuard';
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
  const t = useT();
  const { showToast } = useStore();
  const { setBackupDone, setBackupAt } = useSettings();
  const { unlockPhrase } = useKeys();
  // A frase só existe aqui depois de "Mostrar" (B-01: lida do cofre com a biometria, não fica no estado do app).
  const [words, setWords] = useState<string[] | null>(null);
  const PHRASE = words ?? [];
  const QUIZ = useMemo(() => makeQuiz(PHRASE.length ? PHRASE : Array(12).fill('')), [words]); // eslint-disable-line react-hooks/exhaustive-deps
  const [step, setStep] = useState<Step>('phrase');
  // Bloqueia prints e gravação de tela enquanto a frase pode aparecer (Android: FLAG_SECURE).
  usePreventCapture('backup');
  const [needLock, setNeedLock] = useState(false);
  const [denied, setDenied] = useState(false);
  /**
   * Quem tem a frase tem tudo: só mostra depois de confirmar que é o dono do aparelho.
   * Sem bloqueio no aparelho, recusa como a carteira faz ao assinar (M-01); a web é só demonstração.
   */
  const reveal = async () => {
    setDenied(false); setNeedLock(false);
    const web = Platform.OS === 'web';
    const u = await unlockPhrase(t('backup.revealPrompt'), { allowWithoutLock: web });
    // Biometria trocada: a cópia com biometria ficou ilegível; confirmar a frase de novo.
    if (u.status === 'recover') { router.push('/vault-recover' as Href); return; }
    const g = lockGate(u.status, web);
    if (g === 'denied' || u.status !== 'ok') { if (g === 'needLock') setNeedLock(true); else setDenied(true); return; }
    setWords(u.words);
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
    showToast({ icon: 'key', title: t('backup.done'), body });
  };
  /** Passo 3: arquivo cifrado com senha, outro aparelho (pareamento) ou só a frase no papel. */
  const finish = async () => {
    if (save === 'paper') { done('phrase', t('backup.done.paper')); return; }
    if (save === 'device') { router.replace({ pathname: '/devices', params: { add: '1' } }); return; }
    if (!words) return;
    setBusy(true); setSaveErr(null); setProgress(0);
    try {
      const text = await sealBackup({ phrase: words, createdAt: Math.floor(Date.now() / 1000), from: platformName(thisPlatform, t), data: collectBackupData() }, pw, { onProgress: setProgress });
      const r = await saveBackupFile(backupFileName(), text);
      if (r === 'cancelled') { setSaveErr(t('backup.noFolder')); return; }
      setPw(''); setPw2('');
      done('file', t('backup.done.file'));
    } catch (e) {
      setSaveErr((e as Error).message || t('backup.saveFail'));
    } finally { setBusy(false); }
  };
  const idx = { phrase: 0, confirm: 1, save: 2 }[step];
  const quizOk = QUIZ.every(([n, , a]) => quiz[n] === a);
  const wrong = QUIZ.find(([n, , a]) => quiz[n] && quiz[n] !== a);
  const pwIssue = passwordIssue(pw);
  const pwText = pwIssue === 'short' ? t('backup.pw.short', { min: MIN_PASSWORD }) : pwIssue === 'repetitive' ? t('backup.pw.repetitive') : null;

  return (
    <Screen>
      <BackHeader title={t('backup.title')} />
      <View accessibilityLabel={t('backup.step.a11y', { n: idx + 1, total: 3 })} style={{ paddingHorizontal: 24, flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? c.ink : c.bg3 }} />)}
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }}>
        {step === 'phrase' && (
          <>
            <StepHeader step={t('onboarding.step', { n: 1, total: 3 })} title={t('backup.phrase.title')} sub={t('backup.phrase.sub')} />
            <Pressable onPress={() => { if (!shown) void reveal(); }} accessibilityRole={shown ? undefined : 'button'}
              accessibilityLabel={shown ? t('backup.phrase.a11y', { words: PHRASE.map((w, i) => `${i + 1} ${w}`).join(', ') }) : t('backup.phrase.hidden')}
              style={{ marginTop: 4, marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {shown ? PHRASE.map((w, i) => (
                <View key={i} style={{ width: '31%', flexGrow: 1, height: 42, borderRadius: 12, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 }}>
                  <T size={10.5} w={500} mono color={c.ink2}>{i + 1}</T>
                  <T size={15} w={600}>{w}</T>
                </View>
              )) : <PhraseVeil />}
            </Pressable>
            <View style={{ paddingTop: 16, paddingHorizontal: 24, gap: 10 }}>
              {([['no_photography', t('backup.tip.noPhoto')], ['cloud_off', t('backup.tip.neverSent')]] as const).map(([ic, text]) => (
                <View key={ic} style={{ flexDirection: 'row', gap: 10 }}><Icon name={ic} size={17} w={300} /><T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{text}</T></View>
              ))}
            </View>
            <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
              {denied && <T size={13} style={{ paddingBottom: 10 }} accessibilityLiveRegion="polite">{t('backup.denied')}</T>}
              {needLock && (
                <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 10, padding: 12, marginBottom: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
                  <Icon name="lock" size={18} />
                  <T size={12.5} lh={1.4} style={{ flex: 1 }}>{t('backup.needLock')}</T>
                </View>
              )}
              {shown && !vaultIsSecure && (
                <View style={{ flexDirection: 'row', gap: 10, padding: 12, marginBottom: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
                  <Icon name="warning" size={18} />
                  <T size={12.5} lh={1.4} style={{ flex: 1 }}>{t('backup.webDemo')}</T>
                </View>
              )}
              <Button label={shown ? t('backup.noted') : t('backup.show')} onPress={() => (shown ? setStep('confirm') : void reveal())} />
            </View>
          </>
        )}

        {step === 'confirm' && (
          <>
            <StepHeader step={t('onboarding.step', { n: 2, total: 3 })} title={t('backup.confirm.title')} sub={t('backup.confirm.sub')} />
            <View style={{ paddingHorizontal: 20, gap: 10 }}>
              {QUIZ.map(([n, opts, a]) => (
                <View key={n} style={{ padding: 14, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
                  <T size={13.5} color={c.ink2}>{t('backup.wordNo', { n })}</T>
                  <View accessibilityRole="radiogroup" accessibilityLabel={t('backup.wordNumber', { n })} style={{ flexDirection: 'row', gap: 6 }}>
                    {opts.map(w => {
                      const pk = quiz[n] === w, ok = w === a;
                      return (
                        <Pressable key={w} onPress={() => setQuiz(q => ({ ...q, [n]: w }))} accessibilityRole="radio" accessibilityState={{ checked: pk }} aria-checked={pk}
                          accessibilityLabel={pk && !ok ? `${w}, ${t('backup.mismatch')}` : w}
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
                {wrong ? t('backup.wrongWord', { n: wrong[0] }) : quizOk ? t('backup.allGood') : t('backup.tapCorrect')}
              </T>
            </View>
            <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
              <Button label={t('backup.confirmBtn')} disabled={!quizOk} onPress={() => setStep('save')} />
            </View>
          </>
        )}

        {step === 'save' && (
          <>
            <StepHeader step={t('onboarding.step', { n: 3, total: 3 })} title={t('backup.save.title')} sub={t('backup.save.sub')} />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('backup.save.where')} style={{ paddingHorizontal: 20, gap: 10 }}>
              {SAVE_OPTS.map(([k, icon, title, desc]) => <OptionCard key={k} icon={icon} title={t(title)} desc={t(desc)} on={save === k} onPress={() => { setSave(k); setSaveErr(null); }} />)}
            </View>
            {save === 'sd' && (
              <View style={{ marginTop: 14, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
                <T size={13} lh={1.45} color={c.ink2}>{t('backup.pw.intro')}</T>
                {([[pw, setPw, t('backup.pw.label')], [pw2, setPw2, t('backup.pw.repeat')]] as const).map(([v, set, label]) => (
                  <TextInput key={label} value={v} onChangeText={x => { set(x); setSaveErr(null); }} placeholder={label} placeholderTextColor={c.ink3} accessibilityLabel={label}
                    secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" editable={!busy}
                    style={{ height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg, color: c.ink, fontSize: 15, fontFamily: fontFamily(500) }} />
                ))}
                <T size={12.5} color={c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 2 }}>
                  {busy ? `${t('backup.encrypting')} ${Math.round(progress * 100)}%` : pw && pwText ? pwText : pw2 && pw !== pw2 ? t('backup.pw.differ') : t('backup.pw.hint', { min: MIN_PASSWORD })}
                </T>
              </View>
            )}
            {saveErr && <T size={13} accessibilityRole="alert" style={{ paddingTop: 12, paddingHorizontal: 24 }}>{saveErr}</T>}
            <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
              <Button label={busy ? t('backup.encrypting') : save === 'device' ? t('backup.pairOther') : save === 'sd' ? t('backup.saveFile') : t('backup.finish')}
                disabled={busy || (save === 'sd' && (!!pwIssue || pw !== pw2))} onPress={() => { void finish(); }} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Frase oculta (design: grade com `filter: blur`): 12 células desfocadas desenhadas em SVG, sem as
 * palavras. Nada da frase entra na tela antes de "Mostrar a frase"; os traços têm larguras fixas
 * (não revelam o tamanho das palavras).
 */
function PhraseVeil() {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const gap = 8, h = 42, cw = (w - gap * 2) / 3;
  const bars = [44, 30, 38, 26, 42, 34, 40, 28, 36, 46, 32, 38];
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ width: '100%', height: h * 4 + gap * 3 }} accessible={false}>
      {w > 0 && (
        <Svg width={w} height={h * 4 + gap * 3}>
          <Filter id="veil" x="-10%" y="-10%" width="120%" height="120%"><FeGaussianBlur stdDeviation={5} /></Filter>
          <G filter="url(#veil)">
            {bars.map((bw, i) => {
              const x = (i % 3) * (cw + gap), y = Math.floor(i / 3) * (h + gap);
              return (
                <G key={i}>
                  <Rect x={x} y={y} width={cw} height={h} rx={12} fill={c.bg} />
                  <Rect x={x + 10} y={y + 16} width={10} height={10} rx={3} fill={c.ink3} />
                  <Rect x={x + 26} y={y + 14} width={Math.min(bw, cw - 36)} height={14} rx={4} fill={c.ink2} />
                </G>
              );
            })}
          </G>
        </Svg>
      )}
    </View>
  );
}
