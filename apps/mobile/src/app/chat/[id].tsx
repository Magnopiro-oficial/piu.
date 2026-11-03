import { Enter as ScreenEnter } from '../../ui/Enter';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import type { Chat, Msg } from '../../data/types';
import { STATUS_ICON, STATUS_LABEL } from '../../lib/status';
import { useStore, useViewingChat } from '../../state/store';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { Icon, type IconName } from '../../ui/Icon';
import { AttachSheet } from '../../ui/AttachSheet';
import { FileBubble } from '../../ui/FileBubble';
import { pickDocument, pickImage } from '../../lib/pickFile';
import { MAX_FILE_BYTES } from '../../messaging/messenger';
import { RouteSheet } from '../../ui/RouteSheet';
import { T } from '../../ui/T';

/** Conversa: balões (enviado = ink, recebido = bub + borda), estados de entrega, rodapé com o transporte atual. */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { chats, send, retry, typing, verified, sendFile, sendRealFile, toggleFilePause, showToast, patchChat } = useStore();
  const chat = chats.find(x => x.id === id);
  useViewingChat(chat ? chat.id : null);
  const [draft, setDraft] = useState('');
  const [routeMsg, setRouteMsg] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);
  const toEnd = () => requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

  if (!chat) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 60, alignItems: 'center', gap: 16 }}>
        <T size={16} color={c.ink2}>Conversa não encontrada.</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button"><T size={15} w={600}>Voltar</T></Pressable>
      </View>
    );
  }

  const msgs = chat.msgs ?? [];
  // Real (grupo/canal pelo protocolo): publica quem o estado do grupo permite. Exemplo: canal só do dono.
  const readOnly = chat.group ? !chat.owner : chat.kind === 'channel' && !chat.owner;
  const canSend = draft.trim().length > 0;
  const submit = () => { if (!canSend) return; send(chat.id, draft.trim()); setDraft(''); toEnd(); };
  const selected = msgs.find(m => m.id === routeMsg);
  // ⋯ abre o contato (conversa direta), o grupo, ou mostra os dados do canal.
  const openInfo = () => {
    if (chat.kind === 'direct') router.push({ pathname: '/contact/[id]', params: { id: chat.id } });
    else if (chat.kind === 'group' || (chat.group && chat.kind === 'channel')) router.push({ pathname: '/group/[id]', params: { id: chat.id } });
    else if (chat.group && chat.kind === 'community') router.push({ pathname: '/community/[id]', params: { id: chat.id } });
    else showToast({ icon: 'campaign', title: chat.name, body: chat.sub ?? '' });
  };
  const onAttach = (k: 'image' | 'doc' | 'location') => {
    if (k === 'location') showToast({ icon: 'location_on', title: 'Localização', body: 'Envio de localização chega numa próxima versão.' });
    else if (chat.peer) {
      // Conversa real: escolhe a foto ou o documento e envia em blocos pelo protocolo.
      void (k === 'image' ? pickImage() : pickDocument()).then(f => {
        if (!f) return;
        if (f.data.length > MAX_FILE_BYTES) { showToast({ icon: 'error', title: 'Arquivo grande demais', body: 'O limite por arquivo é 50 MB.' }); return; }
        sendRealFile(chat.id, f); toEnd();
      }).catch(() => showToast({ icon: 'error', title: 'Não foi possível abrir o arquivo', body: 'Tente outro arquivo.' }));
    }
    else { sendFile(chat.id, k); toEnd(); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenEnter kind="push">
      {/* cabeçalho */}
      <View style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.bg, zIndex: 2 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar para Conversas" style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow_back_ios_new" size={22} />
        </Pressable>
        <Avatar initials={chat.initials} size={40} square={chat.kind !== 'direct'} inverted={chat.inv} photo={chat.photo} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <T size={16} w={650} ls={-0.015} numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header" accessibilityLabel={verified[chat.id] ? `${chat.name}, verificado` : chat.name}>{chat.name}</T>
            {verified[chat.id] && <Icon name="verified" size={16} fill />}
          </View>
          <T size={12.5} color={c.ink2} numberOfLines={1}>{typing === chat.id ? 'digitando…' : chat.sub}</T>
        </View>
        <Pressable onPress={openInfo} accessibilityRole="button" accessibilityLabel={chat.kind === 'direct' ? 'Ver contato e código de segurança' : chat.kind === 'group' ? 'Informações do grupo' : 'Informações do canal'} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="more_horiz" size={22} />
        </Pressable>
      </View>

      {/* mensagens, sobre o padrão de pontos (18 px) */}
      <View style={{ flex: 1 }}>
        <DotPattern color={c.dot} />
        <ScrollView ref={scroller} onContentSizeChange={toEnd} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 12, paddingBottom: 10, gap: 4 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 300, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2, marginBottom: 6 }}>
            <Icon name="lock" size={14} />
            <T size={12} lh={1.35} color={c.ink2} style={{ flexShrink: 1 }}>Cifrado de ponta a ponta. Toque numa mensagem para ver a rota.</T>
          </View>
          <T size={11.5} w={500} color={c.ink2} align="center" style={{ marginTop: 4, marginBottom: 6 }}>Hoje</T>
          {msgs.map((m, i) => (
            <Bubble key={m.id} msg={m} chat={chat} gap={i > 0 && msgs[i - 1].from === m.from ? 0 : 8}
              onPress={() => setRouteMsg(m.id)} onRetry={() => retry(chat.id, m.id)} onToggleFile={() => toggleFilePause(chat.id, m.id)} />
          ))}
          {typing === chat.id && <Typing />}
          {chat.offline && (
            <View style={{ alignSelf: 'center', marginTop: 12, maxWidth: 310, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, backgroundColor: c.bg, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="schedule_send" size={18} />
                <T size={14} w={600}>{chat.name.split(' ')[0]} está fora de alcance</T>
              </View>
              <T size={13} lh={1.4} color={c.ink2}>Sua mensagem está guardada no nó Galpão e será entregue quando uma rota surgir. Expira em 47 h.</T>
            </View>
          )}
        </ScrollView>
      </View>

      {/* rodapé */}
      {readOnly ? (
        <View style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={13.5} w={550}>Somente administradores publicam</T>
            <T size={11} mono color={c.ink2}>{chat.via}</T>
          </View>
          <Pressable onPress={() => { patchChat(chat.id, { muted: !chat.muted }); showToast({ icon: chat.muted ? 'notifications' : 'notifications_off', title: chat.muted ? 'Canal com notificações' : 'Canal silenciado', body: chat.muted ? 'Novas publicações voltam a aparecer como banner.' : 'As publicações continuam chegando, sem banner.' }); }}
            accessibilityRole="button" accessibilityState={{ selected: !!chat.muted }} accessibilityLabel={chat.muted ? 'Reativar notificações do canal' : 'Silenciar canal'}
            style={({ pressed }) => ({ height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: c.line2, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}>
            {chat.muted && <Icon name="notifications_off" size={16} />}
            <T size={14} w={550}>{chat.muted ? 'Silenciado' : 'Silenciar'}</T>
          </Pressable>
        </View>
      ) : (
        <View style={{ paddingTop: 8, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name={(chat.viaIcon ?? 'hub') as IconName} size={13} color={c.ink2} />
            <T size={11} mono color={c.ink2}>{chat.via}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => setAttachOpen(true)} accessibilityRole="button" accessibilityLabel="Anexar" style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="add" size={24} w={300} />
            </Pressable>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Mensagem" placeholderTextColor={c.ink3} accessibilityLabel="Mensagem"
              onSubmitEditing={submit} returnKeyType="send" blurOnSubmit={false}
              style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 21, backgroundColor: c.bg2, paddingHorizontal: 16, fontSize: 15.5, color: c.ink, fontFamily: fontFamily(400) }} />
            <SendButton enabled={canSend} onPress={submit} />
          </View>
        </View>
      )}

      {selected && <RouteSheet chat={chat} msg={selected} onClose={() => setRouteMsg(null)} />}
      {attachOpen && <AttachSheet onPick={onAttach} onClose={() => setAttachOpen(false)} />}
      </ScreenEnter>
    </KeyboardAvoidingView>
  );
}

function DotPattern({ color }: { color: string }) {
  return (
    <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern id="dots" width={18} height={18} patternUnits="userSpaceOnUse">
          <Circle cx={9} cy={9} r={1} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

/** Entrada de mensagem nova: 340 ms, sobe 12 px e cresce de .9 a 1. */
function Enter({ fresh, origin, children }: { fresh?: boolean; origin: 'left' | 'right'; children: ReactNode }) {
  const { reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(fresh && !reduceMotion ? 0 : 1)).current;
  useEffect(() => {
    if (fresh && !reduceMotion) Animated.timing(v, { toValue: 1, duration: 340, easing: Easing.bezier(0.2, 0.9, 0.3, 1.2), useNativeDriver: true }).start();
  }, [fresh, reduceMotion, v]);
  return (
    <Animated.View style={{
      alignSelf: origin === 'right' ? 'flex-end' : 'flex-start', maxWidth: '80%', opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
    }}>
      {children}
    </Animated.View>
  );
}

/** Ícone de estado: “pop” de 420 ms a cada troca. */
function Tick({ name, color, animate }: { name: IconName; color: string; animate?: boolean }) {
  const { reduceMotion } = useTheme();
  // Pop de 420 ms (design: scale .3 → 1,3 aos 60% → 1, opacidade 0 → 1, `cubic-bezier(.2,.9,.3,1.4)`).
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!animate || reduceMotion) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.bezier(0.2, 0.9, 0.3, 1.4), useNativeDriver: true }).start();
  }, [name, animate, reduceMotion, t]);
  const scale = t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.3, 1.3, 1] });
  const opacity = t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] });
  return <Animated.View style={{ opacity, transform: [{ scale }] }}><Icon name={name} size={15} color={color} /></Animated.View>;
}

function Bubble({ msg, chat, gap, onPress, onRetry, onToggleFile }: { msg: Msg; chat: Chat; gap: number; onPress: () => void; onRetry: () => void; onToggleFile: () => void }) {
  const { c } = useTheme();
  if (msg.from === 'sys') {
    return (
      <View style={{ alignSelf: 'center', maxWidth: 300, marginTop: 8, marginBottom: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2, flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="key" size={14} style={{ marginTop: 1 }} />
        <T size={12} lh={1.4} color={c.ink2} style={{ flexShrink: 1, textAlign: 'center' }}>{msg.text}</T>
      </View>
    );
  }
  const me = msg.from === 'me';
  const failed = me && (msg.status === 'expirada' || msg.status === 'falha');
  const content = msg.file ? `arquivo ${msg.file.name}` : msg.text;
  const label = me && msg.status ? `Você, ${STATUS_LABEL[msg.status]}, ${msg.time}: ${content}` : `${msg.sender ?? chat.name}, ${msg.time}: ${content}`;
  return (
    <View style={{ marginTop: gap }}>
      <Enter fresh={msg.fresh} origin={me ? 'right' : 'left'}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Mostra a rota da mensagem"
          style={me
            ? { paddingTop: 8, paddingBottom: 6, paddingLeft: 14, paddingRight: 12, borderRadius: 20, borderBottomRightRadius: 6, backgroundColor: c.ink, gap: 2 }
            : { paddingTop: 8, paddingBottom: 6, paddingLeft: 12, paddingRight: 14, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: c.bub, borderWidth: 1, borderColor: c.line, gap: 2 }}>
          {!me && chat.kind === 'group' && msg.sender && <T size={12.5} w={650}>{msg.sender}</T>}
          {msg.file && <FileBubble file={msg.file} onToggle={onToggleFile} inverse={me} />}
          {!!msg.text && <T size={15.5} lh={1.35} color={me ? c.invink : c.ink}>{msg.text}</T>}
          {me ? (
            <View style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.72 }}>
              <T size={11} color={c.invink}>{msg.status ? STATUS_LABEL[msg.status] : ''} · </T>
              <T size={11} color={c.invink} tabular>{msg.time}</T>
              {msg.status && <Tick name={STATUS_ICON[msg.status]} color={c.invink} animate={msg.fresh} />}
            </View>
          ) : (
            <T size={11} color={c.ink2} tabular style={{ alignSelf: 'flex-end' }}>{msg.time}</T>
          )}
        </Pressable>
      </Enter>
      {failed && (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Não entregue no prazo. Reenviar"
          style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginRight: 4 }}>
          <Icon name="timer_off" size={15} color={c.ink2} />
          <T size={12} color={c.ink2}>Não entregue no prazo · <T size={12} w={600}>Reenviar</T></T>
        </Pressable>
      )}
    </View>
  );
}

/** Digitando…: 3 pontos, 1,1 s, defasagem de .15 s. */
function Typing() {
  const { c, reduceMotion } = useTheme();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loops = dots.map((d, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 150),
      Animated.timing(d, { toValue: 1, duration: 330, useNativeDriver: true }),
      Animated.timing(d, { toValue: 0, duration: 330, useNativeDriver: true }),
      Animated.delay(440 - i * 150),
    ])));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduceMotion, dots]);
  return (
    <View accessibilityLabel="digitando" style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: c.bub, borderWidth: 1, borderColor: c.line, flexDirection: 'row', gap: 4 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.ink2,
          opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

function SendButton({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(enabled ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(enabled ? 1 : 0); return; }
    Animated.spring(v, { toValue: enabled ? 1 : 0, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [enabled, reduceMotion, v]);
  return (
    <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityLabel="Enviar" accessibilityState={{ disabled: !enabled }}>
      <Animated.View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center',
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
        <Icon name="arrow_upward" size={22} color={c.invink} />
      </Animated.View>
    </Pressable>
  );
}
