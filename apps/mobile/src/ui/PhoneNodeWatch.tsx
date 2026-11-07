import { router, type Href } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '../i18n';
import { persistNow, readPersisted } from '../lib/persist';
import { requestState } from '../lib/phoneNodeCore';
import { getPhoneNode, subscribePhoneNode } from '../lib/phoneNodeStore';
import { newRequestNotices, requestNoticeKey } from '../lib/phoneNodeView';
import { chatIdFor } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { T } from './T';

const TOLD = 'phone.node.requestsTold';
const requestHref = (contactId: string) => `/provider/phone/requests?c=${encodeURIComponent(contactId)}`;

/**
 * Aviso de pedido de aval (Piu 11 N6n): quando chega um pedido válido de um contato, mostra o banner
 * (e a notificação do sistema, pelo `kind`) uma vez por pedido; o toque abre N6 com ele expandido.
 * Sem remetente com a pré-visualização "Nunca" (`hidden`). Montado uma vez no app (app/_layout.tsx).
 */
export function PhoneNodeWatch() {
  const s = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  const { chats, showToast } = useStore();
  const t = useT();
  useEffect(() => {
    if (!s.requests.length) return;
    const now = Math.floor(Date.now() / 1000);
    const told = readPersisted<string[]>(TOLD) ?? [];
    const fresh = newRequestNotices(s.requests.map(r => ({ ...r, state: requestState(r, now) })), told);
    if (!fresh.length) return;
    const r = fresh[fresh.length - 1]!;
    const chat = chats.find(ch => ch.id === chatIdFor(r.contactId));
    const name = chat?.name ?? t('pn.notif.someone');
    showToast({
      icon: 'verified', title: t('n11.n6n.title'), body: t('n11.n6n.body', { name }), action: t('pn.notif.open'), kind: 'network',
      hidden: { title: t('n11.n6n.title'), body: t('pn.notif.hidden') },
      href: requestHref(r.contactId), go: () => router.push(requestHref(r.contactId) as Href),
    });
    void persistNow(TOLD, [...told, ...fresh.map(requestNoticeKey)].slice(-200)).catch(() => {});
  }, [s.requests]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Cartão na conversa com quem pediu o aval: abre N6 com o pedido expandido. Nada aparece sem pedido. */
export function EndorseRequestCard({ chatId }: { chatId: string }) {
  const s = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  const { c } = useTheme();
  const t = useT();
  const req = s.requests.find(r => chatIdFor(r.contactId) === chatId);
  if (!req) return null;
  const ok = requestState(req, Math.floor(Date.now() / 1000)) === 'ok';
  return (
    <Pressable onPress={() => router.push(requestHref(req.contactId) as Href)} accessibilityRole="button" accessibilityLabel={ok ? t('pn.card.title') : t('pn.card.old')}
      style={({ pressed }) => ({ alignSelf: 'center', width: '100%', maxWidth: 310, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: c.bg, borderWidth: ok ? 1.5 : 1, borderColor: ok ? c.ink : c.line2, borderStyle: ok ? 'solid' : 'dashed', gap: 10, opacity: pressed ? 0.9 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: ok ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ok ? 'verified' : 'hourglass_disabled'} size={20} color={ok ? c.invink : c.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14.5} w={650}>{ok ? t('pn.card.title') : t('pn.card.old')}</T>
          <T size={12.5} lh={1.35} color={c.ink2}>{ok ? t('pn.card.body') : t('pn.card.oldBody')}</T>
        </View>
      </View>
      {ok && (
        <View style={{ height: 36, borderRadius: 18, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T size={13.5} w={600} color={c.invink}>{t('pn.card.open')}</T>
        </View>
      )}
    </Pressable>
  );
}
