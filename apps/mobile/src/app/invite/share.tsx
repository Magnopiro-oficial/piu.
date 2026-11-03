import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useInviter } from '../../lib/inviter';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Compartilhar o app (distribuição P2P). Enviar o pacote assinado de celular para celular precisa de
 * um módulo nativo que ainda não existe; no iPhone, só pela App Store, onde o Piu ainda não está.
 * A tela diz isso em vez de simular uma transferência. O código de 4 palavras já é o real (da chave).
 */
export default function Share() {
  const { c } = useTheme();
  const { words } = useInviter();

  return (
    <Screen>
      <BackHeader title="Compartilhar o app" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="install_mobile" size={24} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={15.5} w={600}>Envio do app ainda não disponível</T>
            <T size={13} lh={1.45} color={c.ink2}>Mandar o Piu direto do seu celular para o de outra pessoa, por Wi-Fi Direct ou Bluetooth, chega numa próxima versão. Até lá, a pessoa instala o app de outro jeito e escaneia o seu convite.</T>
          </View>
        </View>

        <View style={{ borderRadius: 22, backgroundColor: c.bg2 }}>
          <Step n={1} title="Quando o envio existir, confiram este código">
            <View accessibilityLabel={'Código de segurança: ' + words.join(', ')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {words.map((w, i) => (
                <View key={`${w}-${i}`} style={{ width: '48.5%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={17} w={650} ls={-0.02}>{w}</T>
                </View>
              ))}
            </View>
            <T size={12.5} lh={1.4} color={c.ink2}>Vem da sua chave. Precisa aparecer igual na tela da outra pessoa; se for diferente, cancele.</T>
          </Step>
        </View>

        <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="phone_iphone" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>No iPhone não é possível instalar apps fora da App Store. Para quem usa iPhone, envie só o convite.</T>
        </View>

        <Pressable onPress={() => router.push('/invite/page')} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6 }}>
          <T size={13} w={550} color={c.ink2} style={{ textDecorationLine: 'underline' }}>Prévia: a página que a outra pessoa vai abrir</T>
        </Pressable>

        <Button label="Voltar ao convite" variant="soft" height={52} onPress={() => router.back()} />
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
