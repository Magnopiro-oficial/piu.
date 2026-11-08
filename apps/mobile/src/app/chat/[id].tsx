import { Enter as ScreenEnter } from '../../ui/Enter';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import type { Chat, Msg } from '../../data/types';
import { useT } from '../../i18n';
import { STATUS_ICON, statusLabel } from '../../lib/status';
import { useSettings } from '../../state/settings';
import { useStore, useViewingChat } from '../../state/store';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { Pop } from '../../ui/motion';
import { Icon, type IconName } from '../../ui/Icon';
import { AttachSheet, type AttachKind } from '../../ui/AttachSheet';
import { FileBubble } from '../../ui/FileBubble';
import { PaidSheet, PayBubble, PayRequestSheet } from '../../ui/PaymentRequest';
import { EndorseRequestCard } from '../../ui/PhoneNodeWatch';
import { useWallet } from '../../state/wallet';
import type { PayRecord } from '../../state/messaging';
import { pickDocument, pickImage } from '../../lib/pickFile';
import { MAX_FILE_BYTES, MESSAGE_TTL_SEC } from '../../messaging/messenger';
import { RouteSheet } from '../../ui/RouteSheet';
import { LocationBubble, LocationSheet } from '../../ui/LocationSheet';
import { T } from '../../ui/T';
import { daySeparators, msgSummary, queueHoursLeft } from '../../lib/chatCore';
import { locationText } from '../../lib/locationCore';
import { shareReceivedFile } from '../../lib/openFile';
import { routeIcon, routeLabel } from '../../lib/routeCore';
import { receivedFiles, useMessaging } from '../../state/messaging';
import { useChatScreenSecurity } from '../../ui/ScreenSecurity';
import { useCall } from '../../ui/call/CallContext';
import { CallButton, CallRecordCard, CallRequestCard } from '../../ui/call/CallCards';
import { contactOf } from '../../calls/callView';
import { loraComposer, loraMsgState, type LoraMsgState } from '../../lib/loraChat';
import { LoraCard } from '../../ui/lora/LoraCard';
import { useLora } from '../../ui/lora/useLora';

/** Conversa: balões (enviado = ink, recebido = bub + borda), estados de entrega, rodapé com o transporte atual. */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { chats, send, retry, verified, sendRealFile, toggleFilePause, showToast, patchChat, typing, notifyTyping } = useStore();
  const { sto } = useSettings();
  useChatScreenSecurity(); // Segurança da tela (Android): FLAG_SECURE só enquanto a conversa está em foco
  const { lastRouteOf, routeFor, chatPriority, payments, onlyLora } = useMessaging();
  // Só o LoRa alcança (desenho 4a/4c): segundos até a próxima vez do rádio, se algo espera.
  const lora = useLora();
  const busyUntil = lora?.link.busyUntil;
  const busySec = onlyLora && busyUntil && lora && busyUntil > lora.now ? Math.ceil((busyUntil - lora.now) / 1000) : undefined;
  const { lunesAddress } = useWallet();
  const chat = chats.find(x => x.id === id);
  useViewingChat(chat ? chat.id : null);
  // Chamada de voz: o botão só existe quando há um provedor de chamada (sem ele, o cabeçalho fica igual).
  const call = useCall();
  const [draft, setDraft] = useState('');
  const [routeMsg, setRouteMsg] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  // Pedido de pagamento (regra 7.3): criar, "Já paguei" (id do pedido) e qual está sendo conferido.
  const [payOpen, setPayOpen] = useState(false);
  const [paidFor, setPaidFor] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const toEnd = () => requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

  if (!chat) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 60, alignItems: 'center', gap: 16 }}>
        <T size={16} color={c.ink2}>{t('chat.notFound')}</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button"><T size={15} w={600}>{t('common.back')}</T></Pressable>
      </View>
    );
  }

  const msgs = chat.msgs ?? [];
  // Só a fila local confirma que ainda estamos aguardando rota. Não inferimos a
  // presença do contato pela última rota nem atribuímos custódia a outro nó.
  const waiting = msgs.filter(m => m.from === 'me' && (m.status === 'criada' || m.status === 'aguardando') && !routeFor(chat.id, m.id));
  const queueH = queueHoursLeft(waiting, Date.now(), MESSAGE_TTL_SEC);
  // Grupo, canal ou comunidade: publica quem o estado do grupo permite (`owner` = pode publicar).
  const readOnly = !!chat.group && !chat.owner;
  const canSend = draft.trim().length > 0;
  const lc = loraComposer(draft, onlyLora);
  const submit = () => { if (!canSend) return; send(chat.id, draft.trim()); setDraft(''); toEnd(); };
  const selected = msgs.find(m => m.id === routeMsg);
  // ⋯ abre o contato (conversa direta), os dados do grupo/canal ou a comunidade.
  const openInfo = () => {
    if (chat.kind === 'direct') router.push({ pathname: '/contact/[id]', params: { id: chat.id } });
    else if (chat.kind === 'community') router.push({ pathname: '/community/[id]', params: { id: chat.id } });
    else router.push({ pathname: '/group/[id]', params: { id: chat.id } });
  };
  // Rodapé e "Última rota": o meio real do último envio ou recebimento desta conversa.
  const last = lastRouteOf(chat.id);
  const viaText = last ? routeLabel(last, t) : t('chat.noRouteYet');
  const viaIcon: IconName = last ? routeIcon(last) : 'schedule';
  const seps = daySeparators(msgs, Date.now(), t);
  const openFile = (m: Msg) => {
    const f = receivedFiles.get(m.id);
    if (!f) return;
    shareReceivedFile(f).catch(e => showToast({ icon: 'error', title: t('chat.openFail'), body: (e as Error).message || t('common.tryAgain') }));
  };
  const fail = (title: string, e: unknown) => showToast({ icon: 'error', title, body: e instanceof Error ? e.message : t('common.tryAgain') });
  const sendPay = (input: { amount: string; desc: string }) => {
    try { payments.send(chat.id, input); toEnd(); } catch (e) { fail(t('wallet.ask.fail'), e); }
  };
  const markPaid = (proof: { txHash?: string; blockHash?: string }) => {
    if (!paidFor) return;
    try { payments.markPaid(paidFor, proof); showToast({ icon: 'task_alt', title: t('chat.pay.noticeSent'), body: t('chat.pay.noticeSent.body') }); } catch (e) { fail(t('chat.pay.noticeFail'), e); }
  };
  const checkPay = (rec: PayRecord) => {
    setChecking(rec.id);
    payments.check(rec.id)
      .then(r => showToast({ icon: r.state === 'recebido' ? 'verified' : 'public', title: r.state === 'recebido' ? t('chat.pay.checked') : t('chat.pay.checkedMainnet'), body: r.text }))
      .catch(e => fail(t('chat.pay.checkFail'), e))
      .finally(() => setChecking(null));
  };
  const onAttach = (k: AttachKind) => {
    if (k === 'location') setLocOpen(true);
    else if (k === 'payment') {
      if (!chat.peer) showToast({ icon: 'account_balance_wallet', title: t('chat.pay.request'), body: t('chat.pay.onlyDirect') });
      else setPayOpen(true);
    } else if (!chat.peer) showToast({ icon: k === 'image' ? 'image' : 'description', title: t('chat.files.groups'), body: t('chat.files.onlyDirect') });
    else {
      // Conversa real: escolhe a foto ou o documento e envia em blocos pelo protocolo.
      void (k === 'image' ? pickImage(sto.quality) : pickDocument()).then(f => {
        if (!f) return;
        if (f.data.length > MAX_FILE_BYTES) { showToast({ icon: 'error', title: t('chat.files.tooBig'), body: t('chat.files.limit') }); return; }
        sendRealFile(chat.id, f); toEnd();
      }).catch(() => showToast({ icon: 'error', title: t('chat.files.openFail'), body: t('chat.files.tryAnother') }));
    }
  };

  return (
    // Android edge-to-edge: a janela não encolhe com o teclado, então o padding vale nos dois sistemas.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ScreenEnter kind="push">
      {/* cabeçalho */}
      <View style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.bg, zIndex: 2 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('chat.backToChats')} style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow_back_ios_new" size={22} />
        </Pressable>
        <Avatar initials={chat.initials} size={40} square={chat.kind !== 'direct'} inverted={chat.inv} photo={chat.photo} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <T size={16} w={650} ls={-0.015} numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header" accessibilityLabel={verified[chat.id] ? `${chat.name}, ${t('chat.verified')}` : chat.name}>{chat.name}</T>
            {verified[chat.id] && <Pop dur={400}><Icon name="verified" size={16} fill /></Pop>}
          </View>
          {onlyLora && !typing[chat.id] ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="settings_input_antenna" size={13} color={c.ink2} />
              <T size={12.5} color={c.ink2} numberOfLines={1}>{t('lora.chat.sub')}</T>
            </View>
          ) : <T size={12.5} color={c.ink2} numberOfLines={1} accessibilityLiveRegion="polite">{typing[chat.id] ? t('chat.typing') : chat.kind === 'direct' && waiting.length ? t('chat.queue.sub', { count: waiting.length }) : chat.sub}</T>}
        </View>
        {call && chat.kind === 'direct' && (call.canCall?.(chat.id) ?? true) && <CallButton onPress={() => call.callChat(chat.id)} />}
        <Pressable onPress={openInfo} accessibilityRole="button" accessibilityLabel={chat.kind === 'direct' ? t('chat.info.contact') : chat.kind === 'group' ? t('chat.info.group') : chat.kind === 'community' ? t('chat.info.community') : t('chat.info.channel')} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="more_horiz" size={22} />
        </Pressable>
      </View>

      {/* mensagens, sobre o padrão de pontos (18 px) */}
      <View style={{ flex: 1 }}>
        <DotPattern color={c.dot} />
        {onlyLora && <LoraCard name={chat.name} busySec={waiting.some(m => loraMsgState(m, true, busySec)?.kind === 'turn') ? busySec : undefined} />}
        <ScrollView ref={scroller} onContentSizeChange={toEnd} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 12, paddingBottom: 10, gap: 4 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 300, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2, marginBottom: 6 }}>
            <Icon name="lock" size={14} />
            <T size={12} lh={1.35} color={c.ink2} style={{ flexShrink: 1 }}>{t('chat.e2eHint')}</T>
          </View>
          {msgs.map((m, i) => {
            const pay = m.from !== 'sys' ? payments.get(m.id) : undefined;
            return (
              <View key={m.id}>
                {seps[i] && <T size={11.5} w={500} color={c.ink2} align="center" accessibilityRole="header" style={{ marginTop: 10, marginBottom: 6 }}>{seps[i]}</T>}
                {/* Chamada de voz: registro e pedido viram cartão no lugar do balão. */}
                {m.call ? <CallRecordCard record={m.call} contact={contactOf(chat.name)} time={m.time} onCallBack={call?.canCall?.(chat.id) ? () => call.callChat(chat.id) : undefined} />
                  : m.callReq ? <CallRequestCard step={m.callReq.step} contact={contactOf(chat.name)} time={m.time} />
                  : <Bubble msg={m} chat={chat} lora={loraMsgState(m, onlyLora, busySec)} gap={i > 0 && !seps[i] && msgs[i - 1].from === m.from ? 0 : 8} pay={pay} checking={!!pay && checking === pay.id}
                  onPress={() => setRouteMsg(m.id)}
                  // Pedido de pagamento: reenviar manda o pedido de novo (não o texto do resumo).
                  onRetry={() => { if (pay) { try { payments.resend(pay.id); } catch (e) { fail(t('chat.resendFail'), e); } } else retry(chat.id, m.id); }}
                  onToggleFile={() => toggleFilePause(chat.id, m.id)}
                  onOpenFile={m.file?.incoming && receivedFiles.has(m.id) ? () => openFile(m) : undefined}
                  onCopied={() => showToast({ icon: 'content_copy', title: pay ? t('wallet.addressCopied') : t('chat.coordsCopied'), body: pay ? pay.address : '' })}
                  onPaid={pay && pay.dir === 'in' ? () => setPaidFor(pay.id) : undefined}
                  onCheck={pay && pay.dir === 'out' ? () => checkPay(pay) : undefined} />}
              </View>
            );
          })}
          {chat.kind === 'direct' && <EndorseRequestCard chatId={chat.id} />}
          {/* Só pelo LoRa, o cartão fixo do topo e o estado de cada balão já dizem o que espera. */}
          {waiting.length > 0 && !onlyLora && (
            <Pressable onPress={() => setRouteMsg(waiting[0].id)} accessibilityRole="button" accessibilityLabel={t('chats.queued', { count: waiting.length })}
              style={{ alignSelf: 'center', width: '100%', maxWidth: 310, marginTop: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, backgroundColor: c.bg, gap: 6 }}>
              {/* Design `queue`: "{nome} está fora de alcance" e onde a mensagem está guardada, com o prazo real (48 h do envelope). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="schedule_send" size={18} />
                <T size={14} w={600} style={{ flex: 1 }}>{chat.kind === 'direct' ? t('chat.queue.away', { name: chat.name.split(' ')[0] }) : t('chats.queued', { count: waiting.length })}</T>
              </View>
              <T size={13} color={c.ink2} lh={1.4}>{queueH != null ? t('chat.queue.held', { count: waiting.length, h: queueH }) : t('chats.queued.desc')}</T>
            </Pressable>
          )}
          {typing[chat.id] && <Typing />}
        </ScrollView>
      </View>

      {/* rodapé */}
      {readOnly ? (
        <View style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={13.5} w={550}>{t('chat.adminsOnly')}</T>
            <T size={11} mono color={c.ink2}>{viaText}</T>
          </View>
          <Pressable onPress={() => { patchChat(chat.id, { muted: !chat.muted }); showToast({ icon: chat.muted ? 'notifications' : 'notifications_off', title: chat.muted ? t('chat.mute.on') : t('chat.mute.off'), body: chat.muted ? t('chat.mute.on.body') : t('chat.mute.off.body') }); }}
            accessibilityRole="button" accessibilityState={{ selected: !!chat.muted }} accessibilityLabel={chat.muted ? t('chat.mute.reenable') : t('chat.mute.channel')}
            style={({ pressed }) => ({ height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: c.line2, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}>
            {chat.muted && <Icon name="notifications_off" size={16} />}
            <T size={14} w={550}>{chat.muted ? t('chat.muted') : t('chat.mute')}</T>
          </Pressable>
        </View>
      ) : (
        <View style={{ paddingTop: 8, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg, gap: 6 }}>
          {lc.hint ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1.5, borderColor: c.ink }} accessibilityLiveRegion="polite">
              <Icon name="settings_input_antenna" size={16} style={{ marginTop: 1 }} />
              <T size={12} lh={1.4} style={{ flex: 1 }}>{t('lora.composer.hint')}</T>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name={viaIcon} size={13} color={c.ink2} />
              <T size={11} mono color={c.ink2}>{viaText}</T>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => setAttachOpen(true)} accessibilityRole="button" accessibilityLabel={t('chat.attach')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="add" size={24} w={300} />
            </Pressable>
            <TextInput value={draft} onChangeText={v => { setDraft(v); if (v.trim()) notifyTyping(chat.id); }} placeholder={t('chat.message')} placeholderTextColor={c.ink3} accessibilityLabel={t('chat.message')}
              onSubmitEditing={submit} returnKeyType="send" blurOnSubmit={false}
              style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 21, backgroundColor: c.bg2, paddingHorizontal: 16, fontSize: 15.5, color: c.ink, fontFamily: fontFamily(400) }} />
            <SendButton enabled={canSend} onPress={submit} icon={lc.icon} label={lc.hint ? t('lora.composer.later') : undefined} />
          </View>
          {lc.count && (
            <View style={{ alignSelf: 'flex-end', marginRight: 58, flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={t('lora.composer.count', { n: lc.count.n, max: lc.count.max })}>
              {lc.count.over && <View style={{ width: 44, height: 3, borderRadius: 2, backgroundColor: c.ink }} />}
              <T size={11} w={lc.count.over ? 600 : 500} mono color={lc.count.over ? c.ink : c.ink2}>{lc.count.n} / {lc.count.max}</T>
            </View>
          )}
        </View>
      )}

      {selected && <RouteSheet chat={chat} msg={selected} rec={routeFor(chat.id, selected.id)} prio={chatPriority(chat.id)} onClose={() => setRouteMsg(null)} />}
      {attachOpen && <AttachSheet onPick={onAttach} onClose={() => setAttachOpen(false)} />}
      {locOpen && <LocationSheet onClose={() => setLocOpen(false)} onSend={(loc, label) => { send(chat.id, locationText(loc, label), loc); toEnd(); }} />}
      {payOpen && <PayRequestSheet address={lunesAddress} toName={chat.name} onClose={() => setPayOpen(false)} onSend={sendPay} />}
      {paidFor && <PaidSheet onClose={() => setPaidFor(null)} onSend={markPaid} />}
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

function Bubble({ msg, chat, lora, gap, pay, checking, onPress, onRetry, onToggleFile, onOpenFile, onCopied, onPaid, onCheck }: {
  msg: Msg; chat: Chat; lora?: LoraMsgState; gap: number; pay?: PayRecord; checking?: boolean; onPress: () => void; onRetry: () => void; onToggleFile: () => void; onOpenFile?: () => void; onCopied: () => void;
  onPaid?: () => void; onCheck?: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
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
  const content = msg.file ? t('chat.fileNamed', { name: msg.file.name }) : msgSummary(msg, t);
  // Localização: o texto da mensagem é o nome do lugar (ou as coordenadas, para versões sem o balão).
  const place = msg.loc ? (msg.text === locationText(msg.loc, '') ? '' : msg.text) : '';
  const label = me && msg.status ? `${t('common.you')}, ${statusLabel(msg.status, t)}, ${msg.time}: ${content}` : `${msg.sender ?? chat.name}, ${msg.time}: ${content}`;
  return (
    <View style={{ marginTop: gap }}>
      <Enter fresh={msg.fresh} origin={me ? 'right' : 'left'}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('chat.showRoute')}
          style={me
            ? { paddingTop: 8, paddingBottom: 6, paddingLeft: 14, paddingRight: 12, borderRadius: 20, borderBottomRightRadius: 6, backgroundColor: c.ink, gap: 2 }
            : { paddingTop: 8, paddingBottom: 6, paddingLeft: 12, paddingRight: 14, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: c.bub, borderWidth: 1, borderColor: c.line, gap: 2 }}>
          {!me && chat.kind === 'group' && msg.sender && <T size={12.5} w={650}>{msg.sender}</T>}
          {msg.file && <FileBubble file={msg.file} onToggle={onToggleFile} onOpen={onOpenFile} inverse={me} />}
          {msg.loc && <LocationBubble loc={msg.loc} label={place} inverse={me} onCopied={onCopied} />}
          {pay && <PayBubble rec={pay} inverse={me} now={Date.now()} checking={checking} onCopied={onCopied} onPaid={onPaid} onCheck={onCheck} />}
          {!!msg.text && !msg.loc && !pay && <T size={15.5} lh={1.35} color={me ? c.invink : c.ink}>{msg.text}</T>}
          {me ? (
            <View style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.72 }}>
              {lora ? (
                <>
                  <Icon name={lora.kind === 'turn' ? 'hourglass_top' : 'schedule'} size={13} color={c.invink} />
                  <T size={11} mono color={c.invink}>{lora.kind === 'turn' ? t('lora.msg.turn', { sec: lora.sec }) : t('lora.msg.other')}</T>
                </>
              ) : (
                <>
                  <T size={11} color={c.invink}>{msg.status ? statusLabel(msg.status, t) : ''} · </T>
                  <T size={11} color={c.invink} tabular>{msg.time}</T>
                  {msg.status && <Tick name={STATUS_ICON[msg.status]} color={c.invink} animate={msg.fresh} />}
                </>
              )}
            </View>
          ) : (
            <T size={11} color={c.ink2} tabular style={{ alignSelf: 'flex-end' }}>{msg.time}</T>
          )}
        </Pressable>
      </Enter>
      {failed && (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${t('chat.notDelivered')}. ${t('chat.resend')}`}
          style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginRight: 4 }}>
          <Icon name="timer_off" size={15} color={c.ink2} />
          <T size={12} color={c.ink2}>{t('chat.notDelivered')} · <T size={12} w={600}>{t('chat.resend')}</T></T>
        </Pressable>
      )}
    </View>
  );
}

/** "digitando…" do contato: três pontos que sobem em sequência (design, `piuDot`). */
function Typing() {
  const { c, reduceMotion } = useTheme();
  const t = useT();
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
    <View accessibilityLabel={t('chat.typingA11y')} style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: c.bub, borderWidth: 1, borderColor: c.line, flexDirection: 'row', gap: 4 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.ink2,
          opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

/** `icon`/`label`: só pelo LoRa, texto longo demais vira "agendar" (desenho 4c). */
function SendButton({ enabled, onPress, icon = 'arrow_upward', label }: { enabled: boolean; onPress: () => void; icon?: IconName; label?: string }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const v = useRef(new Animated.Value(enabled ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(enabled ? 1 : 0); return; }
    Animated.spring(v, { toValue: enabled ? 1 : 0, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [enabled, reduceMotion, v]);
  return (
    <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityLabel={label ?? t('wallet.send')} accessibilityState={{ disabled: !enabled }}>
      <Animated.View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center',
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
        <Icon name={icon} size={icon === 'arrow_upward' ? 22 : 20} color={c.invink} />
      </Animated.View>
    </Pressable>
  );
}
