import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { Chat } from '../data/types';
import { initialsOf } from '../lib/text';
import { hidesSubscribers, isAdmin, memberCount } from '../messaging/groups';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { BackHeader, SectionLabel, Segmented, Toggle } from './Controls';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import { Screen } from './Screen';
import { T } from './T';

const ROLE = { admin: 'Admin', mod: 'Moderador', member: 'Membro' } as const;

/**
 * Dados de um grupo ou canal REAL (pelo protocolo), no mesmo layout da tela do protótipo:
 * convite (QR de 7 dias e até 50 usos), aprovar quem entra, pedidos, permissões, membros,
 * remover (troca a chave), papéis e sair.
 */
export function RealGroupInfo({ chat }: { chat: Chat }) {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { groupOf, groupOps, myIdIn, contactsFor, groupEpoch } = useMessaging();
  const g = groupOf(chat.id);
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linkSeq, setLinkSeq] = useState(0);
  const me = g ? myIdIn(g.via) : '';
  const admin = !!g && isAdmin(g, me);
  const link = useMemo(() => (g && admin && groupOps ? groupOps.inviteLink(g.id, linkSeq > 0) : ''), [g?.id, admin, linkSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !groupOps) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Você não participa mais deste grupo.</T></Screen>;

  const channel = g.kind === 'channel';
  const total = memberCount(g);
  // Canal privado ou secreto: o inscrito só recebe admins e moderadores (e a si mesmo).
  const hidden = hidesSubscribers(g) && !admin;
  const listed = hidden ? g.members.filter(m => m.role !== 'member') : g.members;
  const pending = admin ? groupOps.pending(g.id) : [];
  const candidates = contactsFor(g.via).filter(x => !g.members.some(m => m.id === x.id));
  const who = g.members.find(m => m.id === target);
  const run = (fn: () => void, ok?: string) => { try { fn(); if (ok) showToast({ icon: 'check', title: ok, body: '' }); } catch (e) { showToast({ icon: 'error', title: 'Não foi possível', body: (e as Error).message }); } };
  void groupEpoch;

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 4, alignItems: 'center', gap: 8 }}>
          <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><T size={26} w={650}>{initialsOf(g.name)}</T></View>
          <T size={23} w={700} ls={-0.03} align="center" accessibilityRole="header">{g.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T size={13} color={c.ink2}>{total} {channel ? (total === 1 ? 'inscrito' : 'inscritos') : total === 1 ? 'membro' : 'membros'}</T>
            <View accessibilityLabel={`chave do grupo versão ${g.keyV}`} style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: c.line2 }}>
              <T size={11} w={500} mono>chave v{g.keyV}</T>
            </View>
          </View>
          {!!g.desc && <T size={13.5} color={c.ink2} align="center">{g.desc}</T>}
        </View>

        {admin && (
          <>
            <SectionLabel>CONVITE</SectionLabel>
            <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
                {link ? <QrCode value={link} size={72} radius={12} label={`QR do convite de ${g.name}`} /> : <View style={{ width: 72, height: 72 }} />}
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={13} w={500} mono numberOfLines={1}>{link.slice(0, 22)}…</T>
                  <T size={12.5} color={c.ink2}>expira em 7 dias · até 50 usos</T>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15} w={550}>Aprovar quem entra</T>
                  <T size={12.5} color={c.ink2}>Um admin confirma cada pedido</T>
                </View>
                <Toggle on={g.approve} onChange={() => run(() => groupOps.update(g.id, { approve: !g.approve }))} label="Aprovar quem entra" />
              </View>
              <Pressable onPress={() => { setLinkSeq(s => s + 1); showToast({ icon: 'link_off', title: 'Convite antigo revogado', body: 'O novo link vale por 7 dias e até 50 usos.' }); }} accessibilityRole="button"
                style={{ paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
                <T size={15} w={550}>Revogar convite e gerar outro</T>
              </Pressable>
            </View>
          </>
        )}

        {pending.length > 0 && (
          <>
            <SectionLabel>{`PEDIDOS · ${pending.length}`}</SectionLabel>
            <View style={{ marginHorizontal: 20 }}>
              {pending.map(p => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
                  <Avatar initials={initialsOf(p.name || '?')} size={40} />
                  <T size={15} w={600} style={{ flex: 1 }} numberOfLines={1}>{p.name || 'Identidade anônima'}</T>
                  <Button label="Recusar" variant="outline" height={32} fontSize={12.5} onPress={() => run(() => groupOps.answerJoin(g.id, p.id, false))} />
                  <Button label="Aceitar" height={32} fontSize={12.5} onPress={() => run(() => groupOps.answerJoin(g.id, p.id, true), 'Pedido aceito')} />
                </View>
              ))}
            </View>
          </>
        )}

        {admin && !channel && (
          <>
            <SectionLabel>PERMISSÕES</SectionLabel>
            <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
              <View style={{ gap: 8 }}>
                <T size={14} w={550}>Quem pode enviar mensagens</T>
                <Segmented label="Quem pode enviar mensagens" value={g.send} onChange={send => run(() => groupOps.update(g.id, { send }))} options={[['all', 'Todos'], ['admins', 'Só admins']]} />
              </View>
              <View style={{ gap: 8 }}>
                <T size={14} w={550}>Quem pode convidar</T>
                <Segmented label="Quem pode convidar" value={g.inv} onChange={inv => run(() => groupOps.update(g.id, { inv }))} options={[['admins', 'Admins'], ['all', 'Todos os membros']]} />
              </View>
            </View>
          </>
        )}

        <SectionLabel>{hidden ? `ADMINS · ${listed.length}` : `${channel ? 'INSCRITOS' : 'MEMBROS'} · ${total}`}</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {listed.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Avatar initials={initialsOf(p.id === me ? 'Você' : p.name || '?')} size={40} inverted={p.id === me} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={600} numberOfLines={1}>{p.id === me ? 'Você' : p.name || `Anônimo · ${p.id.slice(4, 8).toUpperCase()}`}</T>
                <T size={11.5} mono color={c.ink2}>{ROLE[p.role]}</T>
              </View>
              {admin && p.id !== me && (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable onPress={() => run(() => groupOps.setRole(g.id, p.id, p.role === 'admin' ? 'member' : channel && g.postMods && p.role === 'member' ? 'mod' : 'admin'))} accessibilityRole="button"
                    accessibilityLabel={p.role === 'admin' ? `Tirar ${p.name} de admin` : `Promover ${p.name}`}
                    style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>{p.role === 'admin' ? 'Tirar admin' : channel && g.postMods && p.role === 'member' ? 'Moderador' : 'Admin'}</T>
                  </Pressable>
                  <Pressable onPress={() => setTarget(p.id)} accessibilityRole="button" accessibilityLabel={`Remover ${p.name}`}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>Remover</T>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>

        {hidden && (
          <View style={{ marginTop: 12, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
            <Icon name="visibility_off" size={17} w={300} />
            <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{`Canal ${g.visibility === 'secret' ? 'secreto' : 'privado'}: inscritos não veem uns aos outros. Só os admins têm a lista.`}</T>
          </View>
        )}

        {(admin || groupOps.canInvite(g.id)) && (
          <View style={{ paddingTop: 12, paddingHorizontal: 20, gap: 8 }}>
            {adding ? (
              candidates.length ? candidates.map(x => (
                <Pressable key={x.id} onPress={() => admin
                  ? run(() => groupOps.addMembers(g.id, [x.id]), `${x.name} adicionado`)
                  // Membro com "Todos os membros": a indicação vai aos admins, que adicionam (ou aprovam).
                  : run(() => { groupOps.addMembers(g.id, [x.id]); showToast({ icon: 'schedule_send', title: `Convite de ${x.name} enviado`, body: g.approve ? 'Um admin aprova a entrada quando receber.' : 'A pessoa entra quando um admin receber o convite.' }); })} accessibilityRole="button" accessibilityLabel={`Adicionar ${x.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                  <Avatar initials={initialsOf(x.name)} size={36} />
                  <T size={15} w={550} style={{ flex: 1 }}>{x.name}</T>
                  <Icon name="add" size={20} />
                </Pressable>
              )) : <T size={13} color={c.ink2}>Todos os seus contatos desta identidade já participam. Use o convite para outras pessoas.</T>
            ) : (
              <Button label={channel ? 'Adicionar inscritos' : 'Adicionar membros'} variant="outline" height={44} fontSize={14} onPress={() => setAdding(true)} />
            )}
          </View>
        )}

        <View style={{ marginTop: 14, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="key" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Ao remover alguém, a chave do grupo é trocada para todos. Quem saiu continua com o histórico antigo, mas não lê nada novo.</T>
        </View>
        <View style={{ paddingTop: 18, paddingHorizontal: 20 }}>
          <Button label={channel ? 'Sair do canal' : 'Sair do grupo'} variant="outline" height={48} onPress={() => setLeaving(true)} />
        </View>
      </ScrollView>

      {who && (
        <Dialog icon="person_remove" title={`Remover ${who.name || 'membro'}?`} primaryIcon="key" primary="Remover e trocar chave"
          body="A pessoa sai do grupo e a chave é trocada para todos. Ela continua com o histórico antigo, mas não lê nada novo."
          onPrimary={() => { run(() => groupOps.remove(g.id, who.id)); setTarget(null); }} onClose={() => setTarget(null)} />
      )}
      {leaving && (
        <Dialog icon="logout" title={channel ? 'Sair do canal?' : 'Sair do grupo?'} primary="Sair"
          body="Os admins são avisados e trocam a chave. Você não recebe mais nada daqui."
          onPrimary={() => { setLeaving(false); run(() => groupOps.leave(g.id)); router.dismissTo('/(tabs)'); }} onClose={() => setLeaving(false)} />
      )}
    </Screen>
  );
}
