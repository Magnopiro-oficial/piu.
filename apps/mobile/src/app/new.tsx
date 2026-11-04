import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { matchesId, readSearch } from '../lib/searchInput';
import { initialsOf } from '../lib/text';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useTransport } from '../state/transport';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from '../ui/Avatar';
import { BackHeader } from '../ui/Controls';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const MEDIUM = { ble: 'Bluetooth LE', nearby: 'Wi-Fi Direct', sim: 'simulado' } as const;

/**
 * Nova conversa: grupo, canal, comunidade, escanear código, meu código, convidar; busca nos contatos
 * reais (nome ou id `piu:…`), cartão/link de convite colado (abre o adicionar) e convite de grupo
 * colado (pede para entrar); e os aparelhos Piu que o transporte encontrou por perto. Para conversar com alguém por perto,
 * as chaves são trocadas pessoalmente pelo código (QR).
 */
export default function NewChat() {
  const { c } = useTheme();
  const { chats, identity, showToast } = useStore();
  const { joinFromLink, ready } = useMessaging();
  const { peers, state } = useTransport();
  const [q, setQ] = useState('');
  const actions: [IconName, string, string, () => void][] = [
    ['group_add', 'Novo grupo', 'Até 200 membros, com convites', () => router.push('/new-group')],
    ['campaign', 'Novo canal', 'Público, privado ou secreto', () => router.push('/new-channel')],
    ['workspaces', 'Nova comunidade', 'Reúna grupos e canais', () => router.push({ pathname: '/new-group', params: { kind: 'community' } })],
    ['qr_code_scanner', 'Escanear código', 'Adicione alguém pessoalmente', () => router.push('/scan')],
    ['qr_code_2', 'Meu código', 'Mostre para a pessoa escanear', () => router.push('/my-code')],
    ['person_add', 'Convidar para o Piu', 'Envie um convite com o seu contato', () => router.push('/invite')],
  ];
  const input = readSearch(q);
  const found = input.kind === 'name' ? chats.filter(x => x.ident === identity && x.name.toLowerCase().includes(input.term))
    : input.kind === 'id' ? chats.filter(x => matchesId(x.peer, input.id)) : [];
  // Cartão ou link de convite colado: o mesmo fluxo do link `piu://invite/accept` (confere e adiciona).
  const openCard = (card: string) => router.push({ pathname: '/invite/accept', params: { c: card } });
  const joinGroup = (link: string) => {
    try {
      const name = joinFromLink(link);
      showToast({ icon: 'schedule_send', title: `Pedido enviado para ${name}`, body: 'Você entra quando um admin receber o pedido (e aprovar, se o grupo exigir).' });
      router.back();
    } catch (e) { showToast({ icon: 'error', title: 'Convite não pode ser usado', body: (e as Error).message }); }
  };
  const near = peers.filter(p => p.connected).concat(peers.filter(p => !p.connected));

  return (
    <Screen>
      <BackHeader title="Nova conversa" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2 }}>
            <Icon name="search" size={20} color={c.ink2} />
            <TextInput value={q} onChangeText={setQ} placeholder="Nome, piu:… ou cole um convite" placeholderTextColor={c.ink3} accessibilityLabel="Buscar contato por nome ou id, ou colar um convite"
              autoCapitalize="none" autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: c.ink, fontFamily: fontFamily(400), paddingVertical: 0 }} />
          </View>
        </View>
        {(input.kind === 'card' || input.kind === 'group') && (
          <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
            <Pressable disabled={!ready} onPress={() => (input.kind === 'card' ? openCard(input.card) : joinGroup(input.link))} accessibilityRole="button"
              accessibilityLabel={input.kind === 'card' ? 'Abrir o convite de contato' : 'Pedir para entrar no grupo'}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: pressed ? c.bg2 : 'transparent', opacity: ready ? 1 : 0.5 })}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={input.kind === 'card' ? 'person_add' : 'group_add'} size={22} w={300} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={15.5} w={550}>{input.kind === 'card' ? 'Adicionar contato deste convite' : 'Pedir para entrar'}</T>
                <T size={13} color={c.ink2}>{input.kind === 'card' ? 'Confere a assinatura do cartão antes de adicionar' : 'Convite de grupo, canal ou comunidade'}</T>
              </View>
            </Pressable>
          </View>
        )}
        {(input.kind === 'name' || input.kind === 'id') && (
          <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
            {found.length ? found.map(x => (
              <Pressable key={x.id} onPress={() => router.replace(x.kind === 'community' ? { pathname: '/community/[id]', params: { id: x.id } } : { pathname: '/chat/[id]', params: { id: x.id } })}
                accessibilityRole="button" accessibilityLabel={`Abrir ${x.name}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
                <Avatar initials={x.initials} size={44} square={x.kind !== 'direct'} photo={x.photo} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={15.5} w={550} numberOfLines={1}>{x.name}</T>
                  <T size={13} color={c.ink2} numberOfLines={1}>{x.sub ?? ''}</T>
                </View>
              </Pressable>
            )) : (
              <T size={13.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 12 }}>{input.kind === 'id' ? 'Nenhum contato com esse id.' : 'Nenhum contato com esse nome.'} Não há busca fora dos seus contatos: para adicionar alguém, leia o código da pessoa (Escanear código) ou cole aqui o convite que ela enviou.</T>
            )}
          </View>
        )}
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
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: state === 'running' ? c.ink : c.line2 }} />
        </View>
        <View style={{ paddingHorizontal: 8 }}>
          {near.length ? near.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={14} w={600}>{initialsOf(p.name.replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' '))}</T></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15.5} w={550} numberOfLines={1}>{p.name}</T>
                <T size={12} mono color={c.ink2}>{MEDIUM[p.via]} · {p.connected ? 'conectado' : 'visto agora'}</T>
              </View>
              {/* Conversar exige trocar as chaves pessoalmente: abre Escanear código. */}
              <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel={`Conversar com ${p.name}: trocar o código pessoalmente`}
                style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                <T size={13} w={550}>Conversar</T>
              </Pressable>
            </View>
          )) : (
            <T size={13.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
              {state === 'running' || state === 'starting' ? 'Nenhum aparelho Piu por perto agora.'
                : state === 'unavailable' ? 'Bluetooth e Wi-Fi Direct indisponíveis neste aparelho. Veja a aba Rede.'
                : 'Bluetooth e Wi-Fi Direct desligados. Ligue na aba Rede para encontrar quem está por perto.'}
            </T>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
