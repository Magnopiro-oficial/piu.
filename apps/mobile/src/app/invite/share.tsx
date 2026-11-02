import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SAFETY_WORDS } from '../../data/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, QrPlaceholder, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

type Tx = 'wifi' | 'bt';
type State = 'waiting' | 'sending' | 'done';

/**
 * Compartilhar o app (distribuição P2P): Wi-Fi Direct ou Bluetooth, código de segurança de 4 palavras
 * e o pacote assinado. No iPhone só pela App Store.
 */
export default function Share() {
  const { c } = useTheme();
  const [tx, setTx] = useState<Tx>('wifi');
  const [state, setState] = useState<State>('waiting');
  const [pct, setPct] = useState(0);
  const wifi = tx === 'wifi';

  // Simulação: espera o outro aparelho (2,2 s) e transfere (Wi-Fi rápido, Bluetooth lento).
  useEffect(() => {
    setState('waiting'); setPct(0);
    let timer: ReturnType<typeof setInterval> | undefined;
    const wait = setTimeout(() => {
      setState('sending');
      timer = setInterval(() => setPct(p => {
        const n = Math.min(100, p + (wifi ? 4 : 1.2));
        if (n >= 100) { clearInterval(timer); setState('done'); }
        return n;
      }), 120);
    }, 2200);
    return () => { clearTimeout(wait); clearInterval(timer); };
  }, [wifi]);

  const card = state === 'waiting'
    ? { icon: 'sensors' as const, title: 'Aguardando o outro aparelho…', sub: wifi ? 'Rede Piu-7F3A aberta por 10 min' : 'Visível por Bluetooth por 10 min' }
    : state === 'done'
      ? { icon: 'task_alt' as const, title: 'Enviado para Moto G · 51BD', sub: 'Peça para abrir o instalador' }
      : { icon: 'upload' as const, title: 'Enviando para Moto G · 51BD', sub: 'Conexão direta, sem internet' };
  const inv = state !== 'waiting';
  const fg = inv ? c.invink : c.ink;

  return (
    <Screen>
      <BackHeader title="Compartilhar o app" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View style={{ gap: 6 }}>
          <Segmented label="Como enviar" value={tx} onChange={setTx} options={[['wifi', 'Wi-Fi Direct'], ['bt', 'Bluetooth']]} />
          <T size={11.5} mono color={c.ink2} align="center">{wifi ? '≈ 20 s para 38 MB · mais rápido' : '≈ 6 min · use se o Wi-Fi Direct falhar'}</T>
        </View>

        <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, backgroundColor: inv ? c.ink : c.bg2, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name={card.icon} size={24} w={300} color={fg} />
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15.5} w={600} color={fg}>{card.title}</T>
              <T size={12.5} color={fg} style={{ opacity: 0.72 }}>{card.sub}</T>
            </View>
            {state !== 'waiting' && <T size={13} w={500} mono color={fg}>{Math.round(pct)}%</T>}
          </View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }} style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.3)', overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${pct}%`, backgroundColor: fg }} />
          </View>
        </View>

        <View style={{ borderRadius: 22, backgroundColor: c.bg2 }}>
          <Step n={1} title={wifi ? 'Peça para entrar na rede Wi-Fi' : 'Peça para aceitar por Bluetooth'}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <QrPlaceholder size={72} radius={12} />
              <T size={12.5} mono lh={1.6} color={c.ink2}>{wifi ? 'Piu-7F3A\nsenha caju-farol-82' : 'Cardeal · Piu\npareamento seguro'}</T>
            </View>
          </Step>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Step n={2} title={wifi ? 'Depois, abrir no navegador' : 'O arquivo chega como'}>
            <T size={17} w={500} mono ls={-0.01}>{wifi ? '192.168.49.1' : 'Piu-0.1.4.apk'}</T>
          </Step>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Step n={3} title="Confiram o código de segurança">
            <View accessibilityLabel={'Código de segurança: ' + SAFETY_WORDS.join(', ')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {SAFETY_WORDS.map(w => (
                <View key={w} style={{ width: '48.5%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={17} w={650} ls={-0.02}>{w}</T>
                </View>
              ))}
            </View>
            <T size={12.5} lh={1.4} color={c.ink2}>Precisa aparecer igual na tela da outra pessoa. Se for diferente, cancele.</T>
          </Step>
        </View>

        <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: c.line2, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={15} w={750} ls={-0.05} color={c.invink}>piu</T></View>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15} w={600}>Piu 0.1.4 para Android</T>
              <T size={12.5} color={c.ink2}>38,2 MB · cópia deste aparelho</T>
            </View>
          </View>
          <View style={{ gap: 6 }}>
            {[['assinatura', 'Lunes Network · 4C9A…E1F0'], ['sha-256', 'a91f 0c3e … 52d8 7b2d'], ['revogação', 'versão válida · lista de 2 h']].map(([l, v]) => (
              <View key={l} style={{ flexDirection: 'row', gap: 14 }}>
                <T size={12} mono color={c.ink2} style={{ width: 78 }}>{l}</T>
                <T size={12} mono style={{ flex: 1 }}>{v}</T>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="verified" size={17} fill />
            <T size={12.5} w={550}>Conferido neste aparelho antes de enviar</T>
          </View>
        </View>

        <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="phone_iphone" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>No iPhone não é possível instalar apps fora da App Store. Para quem usa iPhone, envie só o convite.</T>
        </View>

        <Pressable onPress={() => router.push('/invite/page')} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6 }}>
          <T size={13} w={550} color={c.ink2} style={{ textDecorationLine: 'underline' }}>Ver a página que a outra pessoa abre</T>
        </Pressable>

        <Button label={state === 'done' ? 'Encerrar compartilhamento' : 'Cancelar'} variant={state === 'done' ? 'primary' : 'soft'} height={52} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, padding: 16 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={12} w={600} color={c.invink}>{n}</T></View>
      <View style={{ flex: 1, gap: 8 }}>
        <T size={14.5} w={600}>{title}</T>
        {children}
      </View>
    </View>
  );
}
