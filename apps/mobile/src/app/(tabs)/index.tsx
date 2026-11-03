import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { Chat, Kind } from '../../data/types';
import { STATUS_ICON } from '../../lib/status';
import { initialsOf } from '../../lib/text';
import { useStore } from '../../state/store';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

type Filter = 'all' | Kind;
const FILTERS: [Filter, string][] = [['all', 'Todas'], ['direct', 'Pessoas'], ['group', 'Grupos'], ['channel', 'Canais'], ['community', 'Comunidades']];
const KIND_ICON: Partial<Record<Kind, IconName>> = { group: 'group', channel: 'campaign', community: 'workspaces' };

/** Conversas: troca de identidade (listas separadas), pílula de rede, busca, filtros, fila offline e lista. */
export default function Chats() {
  const { c } = useTheme();
  const { chats, identity, toggleIdentity, profile } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const mine = useMemo(() => chats.filter(x => x.ident === identity), [chats, identity]);
  const list = mine.filter(x => (filter === 'all' || x.kind === filter) && (!q || x.name.toLowerCase().includes(q.trim().toLowerCase())));
  const queued = mine.reduce((n, x) => n + (x.msgs ?? []).filter(m => m.from === 'me' && m.status === 'aguardando').length, 0);
  const queueChat = mine.find(x => (x.msgs ?? []).some(m => m.from === 'me' && m.status === 'aguardando'));
  const pub = identity === 'public';
  const open = (x: Chat) => x.kind === 'community'
    ? router.push({ pathname: '/community/[id]', params: { id: x.id } })
    : router.push({ pathname: '/chat/[id]', params: { id: x.id } });

  const header = (
    <View style={{ paddingHorizontal: 20, paddingTop: 6, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
        <Pressable onPress={() => { toggleIdentity(); setFilter('all'); }} accessibilityRole="button"
          accessibilityLabel={`Identidade ${pub ? 'pública' : 'anônima'}. Toque para trocar`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingLeft: 4, paddingRight: 10, borderRadius: 20, backgroundColor: c.bg2 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <T size={11} w={600} color={c.invink}>{pub ? initialsOf(profile.name || 'Você') : '7F'}</T>
          </View>
          <T size={13} w={550}>{pub ? 'Pública' : 'Anônima'}</T>
          <Icon name="swap_horiz" size={16} />
        </Pressable>
        <Pressable onPress={() => router.push('/new')} accessibilityRole="button" accessibilityLabel="Nova conversa" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="edit_square" size={21} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <T size={36} w={700} ls={-0.045} style={{ lineHeight: 38 }} accessibilityRole="header">Conversas</T>
        <View accessibilityLabel="6 nós alcançáveis, sem internet" style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 99, borderWidth: 1, borderColor: c.line2 }}>
          <Breath />
          <T size={12} w={500} color={c.ink2}>6 nós · offline</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2 }}>
        <Icon name="search" size={20} color={c.ink2} />
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar conversas" placeholderTextColor={c.ink3} accessibilityLabel="Buscar conversas"
          style={{ flex: 1, fontSize: 15, color: c.ink, fontFamily: fontFamily(400), paddingVertical: 0 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
        {FILTERS.map(([k, l]) => {
          const on = filter === k;
          return (
            <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: on ? c.ink : c.bg2, justifyContent: 'center' }}>
              <T size={13.5} w={500} color={on ? c.invink : c.ink}>{l}</T>
            </Pressable>
          );
        })}
      </ScrollView>
      {queued > 0 && queueChat && (
        <Pressable onPress={() => open(queueChat)} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
          <Icon name="schedule_send" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>{queued} {queued > 1 ? 'mensagens na fila' : 'mensagem na fila'}</T>
            <T size={12.5} color={c.ink2}>Será entregue quando surgir uma rota</T>
          </View>
          <Icon name="chevron_right" size={20} color={c.ink2} />
        </Pressable>
      )}
    </View>
  );

  return (
    <Screen edges={['top']} enter="tab">
      <FlatList
        data={list}
        keyExtractor={x => x.id}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ paddingBottom: 8 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <ChatRow chat={item} onPress={() => open(item)} />}
        ListEmptyComponent={<T size={14} color={c.ink2} align="center" style={{ padding: 28 }}>Nenhuma conversa neste filtro.</T>}
      />
    </Screen>
  );
}

function ChatRow({ chat, onPress }: { chat: Chat; onPress: () => void }) {
  const { c } = useTheme();
  const last = chat.msgs?.[chat.msgs.length - 1];
  const fromMe = last?.from === 'me';
  const preview = chat.preview ?? (last ? (fromMe ? 'Você: ' : last.sender ? last.sender + ': ' : '') + last.text : '');
  const kindIcon = KIND_ICON[chat.kind];
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${chat.name}. ${preview}${chat.unread ? `. ${chat.unread} não lidas` : ''}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 9, paddingHorizontal: 20, backgroundColor: pressed || hovered ? c.bg2 : 'transparent' })}>
      <Avatar initials={chat.initials} square={chat.kind !== 'direct'} inverted={chat.inv} photo={chat.photo} />
      <View style={{ flex: 1, minWidth: 0, gap: 3, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {kindIcon && <Icon name={kindIcon} size={16} />}
          <T size={16} w={600} ls={-0.015} numberOfLines={1} style={{ flex: 1 }}>{chat.name}</T>
          <T size={12.5} color={c.ink2} tabular>{chat.time}</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {fromMe && last?.status && <Icon name={STATUS_ICON[last.status]} size={16} color={c.ink2} />}
          <T size={14.5} color={c.ink2} numberOfLines={1} style={{ flex: 1 }}>{preview}</T>
          {chat.unread > 0 && <Badge n={chat.unread} />}
        </View>
      </View>
    </Pressable>
  );
}

function Badge({ n }: { n: number }) {
  const { c, reduceMotion } = useTheme();
  const s = useRef(new Animated.Value(reduceMotion ? 1 : 0.4)).current;
  useEffect(() => { if (!reduceMotion) Animated.spring(s, { toValue: 1, friction: 5, tension: 180, useNativeDriver: true }).start(); }, [n, reduceMotion, s]);
  return (
    <Animated.View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: s }] }}>
      <T size={12} w={600} color={c.invink}>{n}</T>
    </Animated.View>
  );
}

/** Ponto “respirando” da pílula de rede (2,4 s). */
function Breath() {
  const { c, reduceMotion } = useTheme();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 1200, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, o]);
  return (
    <View style={{ width: 13, height: 13, borderRadius: 6.5, backgroundColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.ink, opacity: o }} />
    </View>
  );
}
