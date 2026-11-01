import { router } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { NEARBY_PEOPLE } from '../data/seed';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { BackHeader } from '../ui/Controls';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/** Nova conversa: grupo, canal, comunidade, escanear código, convidar, e pessoas por perto via Bluetooth. */
export default function NewChat() {
  const { c } = useTheme();
  const { chats, showToast } = useStore();
  const soon = (title: string) => () => showToast({ icon: 'hourglass_top', title, body: 'Chega numa próxima versão do app.' });
  const actions: [IconName, string, string, () => void][] = [
    ['group_add', 'Novo grupo', 'Até 200 membros, com convites', soon('Novo grupo')],
    ['campaign', 'Novo canal', 'Público, privado ou secreto', () => router.push('/new-channel')],
    ['workspaces', 'Nova comunidade', 'Reúna grupos e canais', soon('Nova comunidade')],
    ['qr_code_scanner', 'Escanear código', 'Adicione alguém pessoalmente', soon('Escanear código')],
    ['person_add', 'Convidar para o Piu', 'Envie o app sem internet, de celular para celular', soon('Convidar para o Piu')],
  ];
  const talk = (id: string, name: string) => {
    if (chats.some(x => x.id === id)) router.replace({ pathname: '/chat/[id]', params: { id } });
    else showToast({ icon: 'bluetooth', title: name, body: 'Conversas novas com quem está por perto chegam numa próxima versão.' });
  };

  return (
    <Screen>
      <BackHeader title="Nova conversa" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2 }}>
            <Icon name="search" size={20} color={c.ink2} />
            <TextInput placeholder="Nome, @id ou código" placeholderTextColor={c.ink3} accessibilityLabel="Buscar por nome, @id ou código"
              style={{ flex: 1, fontSize: 15, color: c.ink, fontFamily: fontFamily(400), paddingVertical: 0 }} />
          </View>
        </View>
        <View style={{ paddingHorizontal: 8 }}>
          {actions.map(([icon, title, desc, act]) => (
            <Pressable key={title} onPress={act} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} w={300} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={15.5} w={550}>{title}</T>
                <T size={13} color={c.ink2}>{desc}</T>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 8 }}>
          <T size={11.5} w={500} mono ls={0.05} color={c.ink2}>POR PERTO · BLUETOOTH</T>
          <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }} />
        </View>
        <View style={{ paddingHorizontal: 8 }}>
          {NEARBY_PEOPLE.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={14} w={600}>{p.initials}</T></View>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={15.5} w={550}>{p.name}</T>
                <T size={12} mono color={c.ink2}>{p.meta}</T>
              </View>
              <Pressable onPress={() => talk(p.id, p.name)} accessibilityRole="button" accessibilityLabel={`Conversar com ${p.name}`}
                style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                <T size={13} w={550}>Conversar</T>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
