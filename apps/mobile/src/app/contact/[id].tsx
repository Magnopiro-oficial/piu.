import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SAFETY_CODE } from '../../data/seed';
import { handleOf } from '../../lib/text';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, QrPlaceholder, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Verificar contato (seção 9): código de segurança 12×5 e QR, contra quem se passa por outra pessoa. */
export default function Contact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { chats, verified, setVerified, showToast } = useStore();
  const chat = chats.find(x => x.id === id);
  if (!chat) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Contato não encontrado.</T></Screen>;

  const ver = !!verified[chat.id];
  const first = chat.name.split(' ')[0];
  const handle = chat.ident === 'anon' ? 'piu:b2d9…7a10 · anônima' : `${handleOf(first)} · pública`;
  const rows: [IconName, string, string, number][] = [['route', 'Última rota', chat.via ?? '—', 450], ['timer', 'Mensagens temporárias', 'Desligado', 450], ['block', `Bloquear ${first}`, '', 650]];

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center', gap: 10 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={28} w={650} color={c.invink}>{chat.initials}</T></View>
          <T size={24} w={700} ls={-0.03} align="center" accessibilityRole="header">{chat.name}</T>
          <T size={12.5} mono color={c.ink2}>{handle}</T>
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: ver ? c.ink : c.bg2 }}>
            <Icon name={ver ? 'verified' : 'gpp_maybe'} size={15} fill={ver} color={ver ? c.invink : c.ink} />
            <T size={12.5} w={600} color={ver ? c.invink : c.ink}>{ver ? 'Verificado pessoalmente' : 'Ainda não verificado'}</T>
          </View>
        </View>

        <SectionLabel>CÓDIGO DE SEGURANÇA</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <QrPlaceholder size={100} radius={14} />
            <View accessibilityLabel={'Código de segurança: ' + SAFETY_CODE.join(' ')} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
              {SAFETY_CODE.map(g => <T key={g} size={13.5} w={500} mono style={{ width: '33.3%' }}>{g}</T>)}
            </View>
          </View>
          <T size={13} lh={1.45} color={c.ink2}>Compare com a tela de {first} ou escaneie o QR dela pessoalmente. Se bater, ninguém está no meio da conversa.</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Escanear QR" variant="outline" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }}
              onPress={() => { setVerified(chat.id, true); showToast({ icon: 'qr_code_scanner', title: 'Código confere', body: `${chat.name} verificado pessoalmente.` }); }} />
            <Button label={ver ? 'Remover verificação' : 'Marcar como verificado'} height={44} fontSize={13.5} style={{ flex: 1.3, paddingHorizontal: 4 }} onPress={() => setVerified(chat.id, !ver)} />
          </View>
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {rows.map(([icon, l, v, w], i) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={icon} size={21} w={300} />
              <T size={15} w={w} style={{ flex: 1 }}>{l}</T>
              <T size={12.5} color={c.ink2}>{v}</T>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
