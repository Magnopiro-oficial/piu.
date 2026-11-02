import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { GROUP_SIZE } from '../../data/seed';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { RealGroupInfo } from '../../ui/RealGroupInfo';
import { Button } from '../../ui/Button';
import { BackHeader, QrPlaceholder, SectionLabel, Segmented, Toggle } from '../../ui/Controls';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Administração de grupo (FUN-006): convite, permissões, membros e troca de chave ao remover alguém. */
export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { chats, group, setGroup, removeMember, showToast } = useStore();
  const [target, setTarget] = useState<string | null>(null);
  const chat = chats.find(x => x.id === id);
  if (!chat) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Grupo não encontrado.</T></Screen>;
  if (chat.group) return <RealGroupInfo chat={chat} />;

  const removed = 6 - group.members.length;
  const count = GROUP_SIZE - removed;
  const link = `piu://g/ve-7F3A…${(group.keyV * 37) % 97}`;
  const who = group.members.find(m => m.id === target);

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 4, alignItems: 'center', gap: 8 }}>
          <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><T size={26} w={650}>{chat.initials}</T></View>
          <T size={23} w={700} ls={-0.03} align="center" accessibilityRole="header">{chat.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T size={13} color={c.ink2}>{count} membros</T>
            <View accessibilityLabel={`chave do grupo versão ${group.keyV}`} style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: c.line2 }}>
              <T size={11} w={500} mono>chave v{group.keyV}</T>
            </View>
          </View>
        </View>

        <SectionLabel>CONVITE</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
            <QrPlaceholder size={72} radius={12} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <T size={13} w={500} mono numberOfLines={1}>{link}</T>
              <T size={12.5} color={c.ink2}>expira em 7 dias · até 50 usos</T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15} w={550}>Aprovar quem entra</T>
              <T size={12.5} color={c.ink2}>Um admin confirma cada pedido</T>
            </View>
            <Toggle on={group.approve} onChange={() => setGroup({ approve: !group.approve })} label="Aprovar quem entra" />
          </View>
          <Pressable onPress={() => showToast({ icon: 'link_off', title: 'Convite antigo revogado', body: 'O novo link vale por 7 dias e até 50 usos.' })} accessibilityRole="button"
            style={{ paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
            <T size={15} w={550}>Revogar convite e gerar outro</T>
          </Pressable>
        </View>

        <SectionLabel>PERMISSÕES</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
          <View style={{ gap: 8 }}>
            <T size={14} w={550}>Quem pode enviar mensagens</T>
            <Segmented label="Quem pode enviar mensagens" value={group.send} onChange={send => setGroup({ send })} options={[['all', 'Todos'], ['admins', 'Só admins']]} />
          </View>
          <View style={{ gap: 8 }}>
            <T size={14} w={550}>Quem pode convidar</T>
            <Segmented label="Quem pode convidar" value={group.inv} onChange={inv => setGroup({ inv })} options={[['admins', 'Admins'], ['all', 'Todos os membros']]} />
          </View>
        </View>

        <SectionLabel>{`MEMBROS · ${count}`}</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {group.members.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Avatar initials={p.initials} size={40} inverted={p.id === 'me'} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={600}>{p.name}</T>
                <T size={11.5} mono color={c.ink2}>{p.role}</T>
              </View>
              {!p.role.startsWith('Admin') && (
                <Pressable onPress={() => setTarget(p.id)} accessibilityRole="button" accessibilityLabel={`Remover ${p.name}`}
                  style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                  <T size={12.5} w={550}>Remover</T>
                </Pressable>
              )}
            </View>
          ))}
        </View>
        <View style={{ marginTop: 14, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="key" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Ao remover alguém, a chave do grupo é trocada para todos. Quem saiu continua com o histórico antigo, mas não lê nada novo.</T>
        </View>
        <View style={{ paddingTop: 18, paddingHorizontal: 20 }}>
          <Button label="Sair do grupo" variant="outline" height={48}
            onPress={() => showToast({ icon: 'logout', title: 'Confirme para sair', body: 'Ao sair, a chave do grupo é trocada para os demais.' })} />
        </View>
      </ScrollView>

      {who && (
        <Dialog icon="person_remove" title={`Remover ${who.name}?`} primaryIcon="key" primary="Remover e trocar chave"
          body="A pessoa sai do grupo e a chave é trocada para todos. Ela continua com o histórico antigo, mas não lê nada novo."
          onPrimary={() => { removeMember(who.id); setTarget(null); }} onClose={() => setTarget(null)} />
      )}
    </Screen>
  );
}
