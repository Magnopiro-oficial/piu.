import { router } from 'expo-router';
import { View } from 'react-native';
import { WELCOME_BONUS } from '../../data/wallet';
import { useInviter } from '../../lib/inviter';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Aceitar o convite: troca de chaves frente a frente e 10 LUNES de boas-vindas (liberados com 7 dias de uso). */
export default function AcceptInvite() {
  const { c } = useTheme();
  const { name, initial, fp } = useInviter();
  const rows: [string, string, boolean?][] = [
    ['Convite', 'uso único · expira em 23 h'], ['Assinado por', fp ? `${fp[0]} ${fp[1]} … ${fp[7]}` : '…', true], ['Recebido por', 'Wi-Fi Direct'], ['Boas-vindas', `${WELCOME_BONUS} LUNES · liberados em 7 dias de uso`],
  ];
  return (
    <Screen style={{ paddingHorizontal: 24 }}>
      <View style={{ flex: 1, paddingTop: 66, gap: 26 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.ink, borderWidth: 4, borderColor: c.bg, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}><T size={26} w={650} color={c.invink}>{initial}</T></View>
          <View style={{ width: 84, height: 84, borderRadius: 42, marginLeft: -18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.ink, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><T size={13} w={500} color={c.ink2}>você</T></View>
        </View>
        <View style={{ gap: 10 }}>
          <T size={32} w={650} ls={-0.035} lh={1.05} accessibilityRole="header">{name === 'Você' ? 'Você foi convidado' : `${name} convidou você`}</T>
          <T size={15} lh={1.45} color={c.ink2}>Ao aceitar, vocês trocam chaves aqui, frente a frente. A primeira conversa já começa cifrada.</T>
        </View>
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, padding: 16, gap: 10 }}>
          {rows.map(([l, v, mono]) => (
            <View key={l} style={{ flexDirection: 'row', gap: 16 }}>
              <T size={13.5} color={c.ink2} style={{ width: 96 }}>{l}</T>
              <T size={mono ? 12.5 : 13.5} w={mono ? 500 : 550} mono={mono} style={{ flex: 1 }}>{v}</T>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ gap: 10, paddingBottom: 16 }}>
          <Button label="Criar identidade e aceitar" onPress={() => router.push('/identity')} />
          <Button label="Agora não" variant="ghost" height={46} onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  );
}
