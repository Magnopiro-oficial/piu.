import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SAFETY_WORDS } from '../../data/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

type Step = 'compare' | 'mismatch' | 'download';

/**
 * Página local que o celular de quem convida serve pelo Wi-Fi Piu-7F3A (sem internet), vista no navegador
 * de quem recebe. Aqui é uma prévia: servir a página exige o servidor local nativo.
 */
export default function ReceivePage() {
  const { c } = useTheme();
  const [step, setStep] = useState<Step>('compare');
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  const confirm = () => {
    setStep('download'); setPct(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setPct(p => { const n = Math.min(100, p + 5); if (n >= 100) clearInterval(timer.current); return n; }), 110);
  };
  const ready = step === 'download' && pct >= 100;

  return (
    <Screen>
      <BackHeader title="Prévia da página local" />
      <View style={{ paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <View accessibilityLabel="Endereço 192.168.49.1, rede local" style={{ height: 40, borderRadius: 12, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
          <Icon name="lan" size={17} />
          <T size={14} w={500} mono>192.168.49.1</T>
          <View style={{ flex: 1 }} />
          <View style={{ paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: c.line2 }}><T size={10.5} w={500} mono color={c.ink2}>rede local</T></View>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 28, paddingHorizontal: 24, paddingBottom: 40, gap: 22 }}>
        <T size={54} w={750} ls={-0.07} style={{ lineHeight: 50 }}>piu<T size={54} w={750} color={c.ink3}>.</T></T>
        <View style={{ gap: 8 }}>
          <T size={28} w={650} ls={-0.035} lh={1.08} accessibilityRole="header">Cardeal convidou você para o Piu.</T>
          <T size={14} lh={1.45} color={c.ink2}>Esta página vem direto do celular de Cardeal, pelo Wi-Fi Piu-7F3A. Nada passa pela internet.</T>
        </View>
        <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
          <T size={11.5} w={500} mono ls={0.05} color={c.ink2}>CÓDIGO DE SEGURANÇA</T>
          <View accessibilityLabel={'Código: ' + SAFETY_WORDS.join(', ')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {SAFETY_WORDS.map(w => (
              <View key={w} style={{ width: '48.5%', flexGrow: 1, height: 44, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <T size={18} w={650} ls={-0.02}>{w}</T>
              </View>
            ))}
          </View>
          <T size={13} lh={1.4} color={c.ink2}>Confere com o que aparece na tela de Cardeal?</T>
          {step === 'compare' && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Não confere" variant="outline" height={46} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => setStep('mismatch')} />
              <Button label="Confere" height={46} style={{ flex: 1, paddingHorizontal: 4 }} onPress={confirm} />
            </View>
          )}
        </View>
        {step === 'mismatch' && (
          <View accessibilityRole="alert" style={{ padding: 18, borderRadius: 22, backgroundColor: c.ink, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="gpp_bad" size={24} color={c.invink} />
              <T size={17} w={650} color={c.invink}>Não baixe este arquivo</T>
            </View>
            <T size={13.5} lh={1.45} color={c.invink} style={{ opacity: 0.8 }}>Um código diferente indica que outro aparelho pode estar no meio da conexão. Saia do Wi-Fi Piu-7F3A e avise Cardeal pessoalmente.</T>
            <Button label="Tentar de novo" variant="ghostInverse" height={38} fontSize={13.5} style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: c.invink }} onPress={() => setStep('compare')} />
          </View>
        )}
        {step === 'download' && (
          <>
            <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: c.line2, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={15} w={750} ls={-0.05} color={c.invink}>piu</T></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={14} w={500} mono>Piu-0.1.4.apk</T>
                  <T size={12.5} color={c.ink2} accessibilityLiveRegion="polite">{ready ? '38,2 MB · hash conferido' : `Baixando de Cardeal… ${Math.round(pct)}%`}</T>
                </View>
              </View>
              <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${pct}%`, backgroundColor: c.ink }} />
              </View>
              {ready && <Button label="Abrir instalador" height={48} onPress={() => router.push('/invite/verify')} />}
            </View>
            <T size={12.5} lh={1.45} color={c.ink2}>O Android vai pedir permissão para instalar de fonte desconhecida. É esperado: na primeira abertura, o Piu confere a própria assinatura.</T>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
