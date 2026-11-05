import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { fmtDate, useT } from '../../i18n';
import { cardFromText, fingerprintOfId, inviteWords } from '../../lib/inviteLink';
import type { ContactCard } from '../../messaging/card';
import { useKeys } from '../../state/keys';
import { useMessaging } from '../../state/messaging';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Aceitar um convite aberto pelo link `piu://invite/accept?c=…`: confere o cartão assinado (o mesmo
 * do QR de contato) e adiciona o contato pelo mesmo caminho de "Adicionar contato" (scan.tsx).
 * Antes de criar a identidade, o convite fica guardado e esta tela volta depois (app/_layout.tsx).
 */
export default function AcceptInvite() {
  const { c } = useTheme();
  const t = useT();
  const { c: raw } = useLocalSearchParams<{ c?: string }>();
  const { readCard, addFromCard, ready } = useMessaging();
  const { chats, showToast } = useStore();
  const identities = useKeys().identities;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo((): { card: ContactCard } | { error: string } | null => {
    if (!ready) return null;
    const text = cardFromText(typeof raw === 'string' ? raw : '');
    if (!text) return { error: t('accept.notInvite') };
    try { return { card: readCard(text) }; } catch (e) { return { error: (e as Error).message }; }
  }, [raw, ready, readCard, t]);

  const card = parsed && 'card' in parsed ? parsed.card : null;
  const mine = !!card && !!identities && (card.id === identities.public.id || card.id === identities.anon.id);
  const exists = card ? chats.find(x => x.peer === card.id) : undefined;
  const fp = card ? fingerprintOfId(card.id) : [];
  const words = card ? inviteWords(card.pub.signPk) : [];
  const who = card?.name || t('identity.anon');

  const accept = () => {
    if (!card) return;
    if (exists) { router.replace({ pathname: '/chat/[id]', params: { id: exists.id } }); return; }
    try {
      const id = addFromCard(card);
      showToast({ icon: 'key', title: t('accept.added'), body: t('accept.added.body') });
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) { setError((e as Error).message); }
  };
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!parsed) return <Screen style={{ paddingHorizontal: 24, paddingTop: 66 }}><T size={15} color={c.ink2}>{t('accept.opening')}</T></Screen>;

  if (!card) {
    return (
      <Screen style={{ paddingHorizontal: 24 }}>
        <View style={{ flex: 1, paddingTop: 66, gap: 18 }}>
          <Icon name="gpp_bad" size={34} w={300} />
          <T size={28} w={650} ls={-0.035} lh={1.08} accessibilityRole="header">{t('accept.unusable')}</T>
          <T size={15} lh={1.45} color={c.ink2} accessibilityRole="alert">{'error' in parsed ? parsed.error : ''}</T>
          <View style={{ flex: 1 }} />
          <Button label={t('common.close')} variant="soft" style={{ marginBottom: 16 }} onPress={leave} />
        </View>
      </Screen>
    );
  }

  const rows: [string, string, boolean?][] = [
    [t('profile.identity'), card.kind === 'anon' ? t('accept.identity.anon') : t('accept.identity.public')],
    [t('accept.key'), `${fp[0] ?? ''} ${fp[1] ?? ''} … ${fp.at(-1) ?? ''}`, true],
    [t('accept.invite'), t('accept.invite.validUntil', { when: fmtDate(card.expiresAt * 1000, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })],
    [t('accept.youTalk'), card.kind === 'anon' ? t('accept.youTalk.anon') : t('accept.youTalk.public')],
  ];

  return (
    <Screen style={{ paddingHorizontal: 24 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 66, gap: 22, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.ink, borderWidth: 4, borderColor: c.bg, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}><T size={26} w={650} color={c.invink}>{card.name ? card.name.slice(0, 1).toUpperCase() : '?'}</T></View>
          <View style={{ width: 84, height: 84, borderRadius: 42, marginLeft: -18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.ink, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><T size={13} w={500} color={c.ink2}>{t('network.radar.you')}</T></View>
        </View>
        <View style={{ gap: 10 }}>
          <T size={30} w={650} ls={-0.035} lh={1.06} accessibilityRole="header">{mine ? t('accept.mine') : card.name ? t('accept.invitedYou', { name: card.name }) : t('accept.received')}</T>
          <T size={15} lh={1.45} color={c.ink2}>{mine ? t('accept.mine.desc') : t('accept.received.desc')}</T>
        </View>
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, padding: 16, gap: 10 }}>
          <T size={15} w={600}>{who}</T>
          {rows.map(([l, v, mono]) => (
            <View key={l} style={{ flexDirection: 'row', gap: 16 }}>
              <T size={13.5} color={c.ink2} style={{ width: 104 }}>{l}</T>
              <T size={mono ? 12.5 : 13.5} w={mono ? 500 : 550} mono={mono} style={{ flex: 1 }}>{v}</T>
            </View>
          ))}
        </View>
        {!mine && (
          <View style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderColor: c.line2, gap: 10 }}>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2}>{t('accept.code')}</T>
            <View accessibilityLabel={`${t('inviteShare.code')}: ${words.join(', ')}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {words.map((w, i) => (
                <View key={`${w}-${i}`} style={{ width: '48.5%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={17} w={650} ls={-0.02}>{w}</T>
                </View>
              ))}
            </View>
            <T size={12.5} lh={1.4} color={c.ink2}>{t('accept.code.desc', { name: card.name || t('inviteText.inviter') })}</T>
          </View>
        )}
        {error && (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
            <Icon name="gpp_bad" size={20} />
            <T size={13.5} lh={1.4} style={{ flex: 1 }}>{error}</T>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <View style={{ gap: 10 }}>
          {!mine && <Button label={exists ? t('accept.alreadyContact') : t('accept.accept')} onPress={accept} />}
          <Button label={mine ? t('common.close') : t('accept.notNow')} variant="ghost" height={46} onPress={leave} />
        </View>
      </ScrollView>
    </Screen>
  );
}
