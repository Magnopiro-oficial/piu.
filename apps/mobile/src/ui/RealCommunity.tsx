import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import type { Chat } from '../data/types';
import { initialsOf } from '../lib/text';
import { isAdmin } from '../messaging/groups';
import { chatIdForGroup, useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { BackHeader } from './Controls';
import { Icon, type IconName } from './Icon';
import { Screen } from './Screen';
import { T } from './T';

/**
 * Comunidade REAL (FUN-008), no layout da tela do protótipo: avisos (só admins publicam) e os grupos
 * e canais que ela reúne. Membro da comunidade pede para entrar num grupo; admins criam grupos e canais nela.
 */
export function RealCommunity({ chat }: { chat: Chat }) {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { groupOf, groupOps, myIdIn, groupEpoch } = useMessaging();
  const g = groupOf(chat.id);
  void groupEpoch;
  if (!g || !groupOps) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Você não participa mais desta comunidade.</T></Screen>;
  const admin = isAdmin(g, myIdIn(g.via));
  const kids = g.children ?? [];
  const sections: [string, typeof kids][] = [['GRUPOS', kids.filter(k => k.kind === 'group')], ['CANAIS', kids.filter(k => k.kind === 'channel')]];
  const open = (k: { id: string; name: string }) => {
    if (groupOps.isMember(k.id)) { router.push({ pathname: '/chat/[id]', params: { id: chatIdForGroup(k.id) } }); return; }
    try { groupOps.joinChild(g.id, k.id); showToast({ icon: 'schedule_send', title: 'Pedido enviado', body: `Os admins de ${k.name} recebem o pedido quando houver rota.` }); }
    catch (e) { showToast({ icon: 'error', title: 'Não foi possível pedir', body: (e as Error).message }); }
  };
  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 24, paddingBottom: 20, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={24} w={650} color={c.invink}>{initialsOf(g.name)}</T></View>
          <View style={{ gap: 6 }}>
            <T size={28} w={700} ls={-0.04} accessibilityRole="header">{g.name}</T>
            <T size={14} color={c.ink2}>{`${g.members.length} membros · ${kids.length} grupos e canais`}</T>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: 18, gap: 6 }}>
          <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 4, paddingBottom: 4 }}>AVISOS</T>
          <Row icon="campaign" name="Avisos da comunidade" meta={admin ? 'Só admins publicam · você é admin' : 'Só admins publicam'} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })} first />
        </View>
        {sections.map(([title, items]) => (
          <View key={title} style={{ paddingHorizontal: 20, paddingBottom: 18, gap: 6 }}>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 4, paddingBottom: 4 }}>{title}</T>
            <View style={{ borderRadius: 18, backgroundColor: c.bg2, overflow: 'hidden' }}>
              {items.length === 0 && <View style={{ padding: 14 }}><T size={13} color={c.ink2}>Nenhum ainda.</T></View>}
              {items.map((k, i) => (
                <Row key={k.id} icon={k.kind === 'channel' ? 'campaign' : 'group'} name={k.name} meta={groupOps.isMember(k.id) ? 'Você participa' : 'Toque para pedir para entrar'} onPress={() => open(k)} first={!i} />
              ))}
            </View>
          </View>
        ))}
        {admin && (
          <View style={{ paddingHorizontal: 20, gap: 8 }}>
            <Button label="Novo grupo nesta comunidade" variant="outline" height={44} fontSize={14} onPress={() => router.push({ pathname: '/new-group', params: { parent: g.id } })} />
            <Button label="Novo canal nesta comunidade" variant="outline" height={44} fontSize={14} onPress={() => router.push({ pathname: '/new-channel', params: { parent: g.id } })} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, name, meta, onPress, first }: { icon: IconName; name: string; meta: string; onPress: () => void; first?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}. ${meta}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: c.line, backgroundColor: c.bg2, borderRadius: first ? 0 : 0 }}>
      <Icon name={icon} size={20} w={300} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={15} w={550}>{name}</T>
        <T size={12.5} color={c.ink2}>{meta}</T>
      </View>
      <Icon name="chevron_right" size={20} color={c.ink3} />
    </Pressable>
  );
}
