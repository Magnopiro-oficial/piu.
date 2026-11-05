import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useT } from '../../i18n';
import { useStore } from '../../state/store';
import { useLayout } from '../../lib/responsive';
import { useKeys } from '../../state/keys';
import { useMessaging, useMyCard } from '../../state/messaging';
import { safetyNumber, toPublic } from '../../protocol';
import { QrCode } from '../../ui/QrCode';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Dialog } from '../../ui/Dialog';
import { Icon, type IconName } from '../../ui/Icon';
import { routeLabel } from '../../lib/routeCore';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Verificar contato (seção 9): código de segurança 12×5 e QR, contra quem se passa por outra pessoa. */
export default function Contact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const t = useT();
  const { compact } = useLayout();
  const { chats, verified, setVerified, showToast, block, isBlocked, patchChat } = useStore();
  const [deleting, setDeleting] = useState(false);
  const { identities } = useKeys();
  const ident = chats.find(x => x.id === id)?.ident ?? 'public';
  const { contactKeys, lastRouteOf, deleteChat } = useMessaging();
  const [myCard] = useMyCard(ident);
  // Chaves do contato: vieram no cartão (QR) ou na primeira mensagem (pedido de conversa).
  const real = id ? contactKeys(id) : null;
  // Código: chaves da identidade usada nesta conversa × chaves do contato.
  const mine = identities?.[ident];
  const [code, setCode] = useState<string[] | null>(null);
  // Hash iterado (~25 ms): calcula depois de desenhar a tela, para não travar a navegação.
  useEffect(() => {
    if (!mine || !real) return;
    const timer = setTimeout(() => setCode(safetyNumber(toPublic(mine), real)), 0);
    return () => clearTimeout(timer);
  }, [mine, real]);
  const shown = code ?? Array<string>(12).fill('·····');
  const chat = chats.find(x => x.id === id && x.peer);
  if (!chat?.peer) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">{t('contact.notFound')}</T></Screen>;

  const ver = !!verified[chat.id];

  const first = chat.name.split(' ')[0];
  const handle = `${chat.peer.slice(0, 8)}…${chat.peer.slice(-4)} · ${(chat.ident === 'anon' ? t('profile.identity.anon') : t('profile.identity.public')).toLowerCase()}`;
  // Bloqueio (design): pelo id da chave do contato.
  const blockId = chat.peer;
  const isBl = isBlocked(blockId);
  const blockAct = isBl
    ? () => router.push({ pathname: '/blocked', params: { sel: blockId } })
    : () => {
      block({ id: blockId, chatId: chat.id, name: chat.name, initials: chat.initials, how: 'pela conversa', reported: false });
      showToast({ icon: 'block', title: t('contact.blocked', { name: first }), body: t('contact.blocked.body') });
    };
  // Mensagens temporárias desta conversa (começa com o padrão de Privacidade): toque troca
  // Desligado → 7 dias → 24 h. Vale para as próximas mensagens, nos dois aparelhos.
  const temp = chat.temp ?? 'off';
  const tempLabel = { off: t('common.off'), '7d': t('privacy.temp.7d'), '24h': t('privacy.temp.24h') }[temp];
  const nextTemp = ({ off: '7d', '7d': '24h', '24h': 'off' } as const)[temp];
  const tempAct = () => {
    patchChat(chat.id, { temp: nextTemp });
    showToast(nextTemp === 'off'
      ? { icon: 'timer_off', title: t('contact.temp.off'), body: t('contact.temp.off.body') }
      : { icon: 'timer', title: `${t('privacy.temp')} · ${nextTemp === '7d' ? t('privacy.temp.7d') : t('privacy.temp.24h')}`, body: t('contact.temp.on.body') });
  };
  // Silenciar: as mensagens continuam chegando, sem banner nem notificação (store.tsx respeita `muted`).
  const muteAct = () => {
    patchChat(chat.id, { muted: !chat.muted });
    showToast(chat.muted
      ? { icon: 'notifications', title: t('contact.mute.on'), body: t('contact.mute.on.body') }
      : { icon: 'notifications_off', title: t('contact.mute.off'), body: t('chat.mute.off.body') });
  };
  const last = lastRouteOf(chat.id);
  const rows: [IconName, string, string, number, (() => void)?][] = [['route', t('contact.lastRoute'), last ? routeLabel(last, t) : '—', 450], ['timer', t('privacy.temp'), tempLabel, 450, tempAct],
    [chat.muted ? 'notifications_off' : 'notifications', chat.muted ? t('contact.unmute') : t('contact.mute'), chat.muted ? t('contact.muted') : '', 450, muteAct],
    [isBl ? 'lock_open' : 'block', isBl ? t('contact.unblock', { name: first }) : t('contact.block', { name: first }), isBl ? t('contact.blockedTag') : '', 650, blockAct],
    ['delete', t('contact.delete'), '', 650, () => setDeleting(true)]];

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center', gap: 10 }}>
          {chat.photo
            ? <Image source={{ uri: chat.photo }} accessibilityLabel={t('nearby.photoOf', { name: chat.name })} style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.bg2 }} />
            : <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={28} w={650} color={c.invink}>{chat.initials}</T></View>}
          <T size={24} w={700} ls={-0.03} align="center" accessibilityRole="header">{chat.name}</T>
          <T size={12.5} mono color={c.ink2}>{handle}</T>
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: ver ? c.ink : c.bg2 }}>
            <Icon name={ver ? 'verified' : 'gpp_maybe'} size={15} fill={ver} color={ver ? c.invink : c.ink} />
            <T size={12.5} w={600} color={ver ? c.invink : c.ink}>{ver ? t('contact.verified') : t('contact.notVerified')}</T>
          </View>
        </View>

        <SectionLabel>{t('accept.code')}</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {myCard ? <QrCode value={myCard} size={100} label={t('contact.myQr')} /> : <View style={{ width: 100, height: 100, borderRadius: 14, backgroundColor: c.bg }} />}
            <View accessibilityLabel={code ? `${t('inviteShare.code')}: ${code.join(' ')}` : t('contact.computingCode')} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
              {shown.map((g, i) => <T key={i} size={13.5} w={500} mono style={{ width: '33.3%' }}>{g}</T>)}
            </View>
          </View>
          <T size={13} lh={1.45} color={c.ink2}>{t('contact.compare', { name: first })}</T>
          <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8 }}>
            <Button label={t('contact.scanQr')} variant="outline" height={44} fontSize={14} style={[!compact && { flex: 1 }, { paddingHorizontal: 4 }]}
              onPress={() => router.push({ pathname: '/scan', params: { verify: chat.id } })} />
            <Button label={ver ? t('contact.unverify') : t('contact.markVerified')} height={44} fontSize={13.5} style={[!compact && { flex: 1.3 }, { paddingHorizontal: 4 }]} onPress={() => setVerified(chat.id, !ver)} />
          </View>
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {rows.map(([icon, l, v, w, act], i) => (
            <Pressable key={l} disabled={!act} onPress={act} accessibilityRole={act ? 'button' : undefined}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: pressed ? 0.6 : 1 })}>
              <Icon name={icon} size={21} w={300} />
              <T size={15} w={w} style={{ flex: 1 }}>{l}</T>
              <T size={12.5} color={c.ink2}>{v}</T>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {deleting && (
        <Dialog icon="delete" title={t('contact.deleteTitle', { name: first })} primary={t('contact.deleteAction')} primaryIcon="delete"
          body={t('contact.deleteBody')}
          onClose={() => setDeleting(false)}
          onPrimary={() => { setDeleting(false); deleteChat(chat.id); showToast({ icon: 'delete', title: t('contact.deleted'), body: t('contact.deleted.body') }); router.dismissTo('/(tabs)'); }} />
      )}
    </Screen>
  );
}
