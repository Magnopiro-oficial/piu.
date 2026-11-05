import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { fontFamily } from '../theme/fonts';
import type { Chat } from '../data/types';
import { useT, type Key } from '../i18n';
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

const ROLE: Record<'admin' | 'mod' | 'member', Key> = { admin: 'groupInfo.role.admin', mod: 'groupInfo.role.mod', member: 'groupInfo.role.member' };

/**
 * Dados de um grupo ou canal REAL (pelo protocolo), no mesmo layout da tela do protótipo:
 * convite (QR de 7 dias e até 50 usos), aprovar quem entra, pedidos, permissões, membros,
 * remover (troca a chave), papéis e sair.
 */
export function RealGroupInfo({ chat }: { chat: Chat }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast, patchChat } = useStore();
  const { groupOf, groupOps, myIdIn, contactsFor, groupEpoch, deleteChat } = useMessaging();
  const g = groupOf(chat.id);
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linkSeq, setLinkSeq] = useState(0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [deleting, setDeleting] = useState(false);
  const me = g ? myIdIn(g.via) : '';
  const admin = !!g && isAdmin(g, me);
  const link = useMemo(() => (g && admin && groupOps ? groupOps.inviteLink(g.id, linkSeq > 0) : ''), [g?.id, admin, linkSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const delDialog = deleting && (
    <Dialog icon="delete" title={t('groupInfo.deleteTitle')} primary={t('contact.deleteAction')} primaryIcon="delete"
      body={g ? t('groupInfo.deleteBody.member') : t('groupInfo.deleteBody.gone')}
      onClose={() => setDeleting(false)}
      onPrimary={() => { setDeleting(false); deleteChat(chat.id); showToast({ icon: 'delete', title: t('contact.deleted'), body: '' }); router.dismissTo('/(tabs)'); }} />
  );
  if (!g || !groupOps) return (
    <Screen>
      <BackHeader />
      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <T size={15} color={c.ink2} align="center">{t('groupInfo.notMember')}</T>
        <Button label={t('groupInfo.deleteChat')} variant="outline" height={48} onPress={() => setDeleting(true)} />
      </View>
      {delDialog}
    </Screen>
  );

  const channel = g.kind === 'channel';
  const total = memberCount(g);
  // Canal privado ou secreto: o inscrito só recebe admins e moderadores (e a si mesmo).
  const hidden = hidesSubscribers(g) && !admin;
  const listed = hidden ? g.members.filter(m => m.role !== 'member') : g.members;
  const pending = admin ? groupOps.pending(g.id) : [];
  const candidates = contactsFor(g.via).filter(x => !g.members.some(m => m.id === x.id));
  const who = g.members.find(m => m.id === target);
  const run = (fn: () => void, ok?: string) => { try { fn(); if (ok) showToast({ icon: 'check', title: ok, body: '' }); } catch (e) { showToast({ icon: 'error', title: t('groupInfo.failed'), body: (e as Error).message }); } };
  void groupEpoch;
  const input = { borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink } as const;
  const startEdit = () => { setName(g.name); setDesc(g.desc); setEditing(true); };
  const saveEdit = () => run(() => { groupOps.update(g.id, { name, desc }); setEditing(false); }, channel ? t('groupInfo.channelUpdated') : t('groupInfo.groupUpdated'));
  const toggleMute = () => {
    patchChat(chat.id, { muted: !chat.muted });
    showToast(chat.muted
      ? { icon: 'notifications', title: channel ? t('chat.mute.on') : t('groupInfo.mute.on'), body: t('contact.mute.on.body') }
      : { icon: 'notifications_off', title: channel ? t('chat.mute.off') : t('groupInfo.mute.off'), body: t('chat.mute.off.body') });
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: 4, alignItems: 'center', gap: 8 }}>
          <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><T size={26} w={650}>{initialsOf(g.name)}</T></View>
          <T size={23} w={700} ls={-0.03} align="center" accessibilityRole="header">{g.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T size={13} color={c.ink2}>{channel ? t('groupInfo.subscribers', { count: total }) : t('groupInfo.membersCount', { count: total })}</T>
            <View accessibilityLabel={t('groupInfo.keyVersion.a11y', { v: g.keyV })} style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: c.line2 }}>
              <T size={11} w={500} mono>{t('groupInfo.keyVersion', { v: g.keyV })}</T>
            </View>
          </View>
          {!!g.desc && <T size={13.5} color={c.ink2} align="center">{g.desc}</T>}
          {admin && !editing && (
            <Pressable onPress={startEdit} accessibilityRole="button" accessibilityLabel={channel ? t('groupInfo.edit.channel.a11y') : t('groupInfo.edit.group.a11y')}
              style={{ marginTop: 2, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="edit" size={15} />
              <T size={12.5} w={550}>{t('groupInfo.edit')}</T>
            </Pressable>
          )}
        </View>

        {admin && editing && (
          <View style={{ marginTop: 10, marginHorizontal: 20, gap: 8 }}>
            <TextInput value={name} onChangeText={setName} placeholder={channel ? t('newChannel.name') : t('newGroup.groupName')} placeholderTextColor={c.ink3} accessibilityLabel={t('groupInfo.name')} maxLength={60}
              style={{ ...input, height: 52, fontSize: 16, fontFamily: fontFamily(600) }} />
            <TextInput value={desc} onChangeText={setDesc} placeholder={t('newGroup.desc')} placeholderTextColor={c.ink3} accessibilityLabel={t('newGroup.desc')} maxLength={200}
              style={{ ...input, height: 48, fontSize: 15, fontFamily: fontFamily(400) }} />
            <T size={12} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>{channel ? t('groupInfo.rename.channel') : t('groupInfo.rename.group')}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label={t('common.cancel')} variant="soft" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => setEditing(false)} />
              <Button label={t('common.save')} height={44} fontSize={14} style={{ flex: 1 }} disabled={!name.trim() || (name.trim() === g.name && desc.trim() === g.desc)} onPress={saveEdit} />
            </View>
          </View>
        )}

        <View style={{ marginTop: 14, marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          <Pressable onPress={toggleMute} accessibilityRole="button" accessibilityState={{ selected: !!chat.muted }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={chat.muted ? 'notifications_off' : 'notifications'} size={21} w={300} />
            <T size={15} w={450} style={{ flex: 1 }}>{chat.muted ? t('contact.unmute') : channel ? t('chat.mute.channel') : t('groupInfo.muteGroup')}</T>
            <T size={12.5} color={c.ink2}>{chat.muted ? t('chat.muted') : ''}</T>
          </Pressable>
        </View>

        {admin && (
          <>
            <SectionLabel>{t('groupInfo.invite')}</SectionLabel>
            <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
                {link ? <QrCode value={link} size={72} radius={12} label={t('groupInfo.inviteQr', { name: g.name })} /> : <View style={{ width: 72, height: 72 }} />}
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={13} w={500} mono numberOfLines={1}>{link.slice(0, 22)}…</T>
                  <T size={12.5} color={c.ink2}>{t('groupInfo.inviteTerms')}</T>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15} w={550}>{t('groupInfo.approve')}</T>
                  <T size={12.5} color={c.ink2}>{t('groupInfo.approve.desc')}</T>
                </View>
                <Toggle on={g.approve} onChange={() => run(() => groupOps.update(g.id, { approve: !g.approve }))} label={t('groupInfo.approve')} />
              </View>
              <Pressable onPress={() => { setLinkSeq(s => s + 1); showToast({ icon: 'link_off', title: t('groupInfo.revoked'), body: t('groupInfo.revoked.body') }); }} accessibilityRole="button"
                style={{ paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
                <T size={15} w={550}>{t('groupInfo.revoke')}</T>
              </Pressable>
            </View>
          </>
        )}

        {pending.length > 0 && (
          <>
            <SectionLabel>{t('groupInfo.requests', { count: pending.length })}</SectionLabel>
            <View style={{ marginHorizontal: 20 }}>
              {pending.map(p => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
                  <Avatar initials={initialsOf(p.name || '?')} size={40} />
                  <T size={15} w={600} style={{ flex: 1 }} numberOfLines={1}>{p.name || t('identity.anon')}</T>
                  <Button label={t('scan.transfer.refuse')} variant="outline" height={32} fontSize={12.5} onPress={() => run(() => groupOps.answerJoin(g.id, p.id, false))} />
                  <Button label={t('groupInfo.accept')} height={32} fontSize={12.5} onPress={() => run(() => groupOps.answerJoin(g.id, p.id, true), t('groupInfo.requestAccepted'))} />
                </View>
              ))}
            </View>
          </>
        )}

        {admin && !channel && (
          <>
            <SectionLabel>{t('groupInfo.permissions')}</SectionLabel>
            <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
              <View style={{ gap: 8 }}>
                <T size={14} w={550}>{t('groupInfo.whoSends')}</T>
                <Segmented label={t('groupInfo.whoSends')} value={g.send} onChange={send => run(() => groupOps.update(g.id, { send }))} options={[['all', t('privacy.find.all')], ['admins', t('newChannel.whoPosts.admins')]]} />
              </View>
              <View style={{ gap: 8 }}>
                <T size={14} w={550}>{t('groupInfo.whoInvites')}</T>
                <Segmented label={t('groupInfo.whoInvites')} value={g.inv} onChange={inv => run(() => groupOps.update(g.id, { inv }))} options={[['admins', t('groupInfo.admins')], ['all', t('groupInfo.allMembers')]]} />
              </View>
            </View>
          </>
        )}

        <SectionLabel>{hidden ? t('groupInfo.adminsLabel', { count: listed.length }) : channel ? t('groupInfo.subscribersLabel', { count: total }) : t('newGroup.members', { count: total })}</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {listed.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Avatar initials={initialsOf(p.id === me ? t('common.you') : p.name || '?')} size={40} inverted={p.id === me} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={600} numberOfLines={1}>{p.id === me ? t('common.you') : p.name || t('profile.anonName', { code: p.id.slice(4, 8).toUpperCase() })}</T>
                <T size={11.5} mono color={c.ink2}>{t(ROLE[p.role])}</T>
              </View>
              {admin && p.id !== me && (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable onPress={() => run(() => groupOps.setRole(g.id, p.id, p.role === 'admin' ? 'member' : channel && g.postMods && p.role === 'member' ? 'mod' : 'admin'))} accessibilityRole="button"
                    accessibilityLabel={p.role === 'admin' ? t('groupInfo.demote.a11y', { name: p.name }) : t('groupInfo.promote.a11y', { name: p.name })}
                    style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>{p.role === 'admin' ? t('groupInfo.demote') : channel && g.postMods && p.role === 'member' ? t('groupInfo.role.mod') : t('groupInfo.role.admin')}</T>
                  </Pressable>
                  <Pressable onPress={() => setTarget(p.id)} accessibilityRole="button" accessibilityLabel={t('groupInfo.remove.a11y', { name: p.name })}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>{t('common.remove')}</T>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>

        {hidden && (
          <View style={{ marginTop: 12, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
            <Icon name="visibility_off" size={17} w={300} />
            <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{g.visibility === 'secret' ? t('groupInfo.hidden.secret') : t('groupInfo.hidden.private')}</T>
          </View>
        )}

        {(admin || groupOps.canInvite(g.id)) && (
          <View style={{ paddingTop: 12, paddingHorizontal: 20, gap: 8 }}>
            {adding ? (
              candidates.length ? candidates.map(x => (
                <Pressable key={x.id} onPress={() => admin
                  ? run(() => groupOps.addMembers(g.id, [x.id]), t('groupInfo.added', { name: x.name }))
                  // Membro com "Todos os membros": a indicação vai aos admins, que adicionam (ou aprovam).
                  : run(() => { groupOps.addMembers(g.id, [x.id]); showToast({ icon: 'schedule_send', title: t('groupInfo.inviteSent', { name: x.name }), body: g.approve ? t('groupInfo.inviteSent.approve') : t('groupInfo.inviteSent.join') }); })} accessibilityRole="button" accessibilityLabel={t('groupInfo.add.a11y', { name: x.name })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                  <Avatar initials={initialsOf(x.name)} size={36} />
                  <T size={15} w={550} style={{ flex: 1 }}>{x.name}</T>
                  <Icon name="add" size={20} />
                </Pressable>
              )) : <T size={13} color={c.ink2}>{t('groupInfo.allIn')}</T>
            ) : (
              <Button label={channel ? t('groupInfo.addSubscribers') : t('groupInfo.addMembers')} variant="outline" height={44} fontSize={14} onPress={() => setAdding(true)} />
            )}
          </View>
        )}

        <View style={{ marginTop: 14, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="key" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('groupInfo.rekeyNote')}</T>
        </View>
        <View style={{ paddingTop: 18, paddingHorizontal: 20 }}>
          <Button label={channel ? t('groupInfo.leaveChannel') : t('groupInfo.leaveGroup')} variant="outline" height={48} onPress={() => setLeaving(true)} />
        </View>
        <View style={{ paddingTop: 8, paddingHorizontal: 20 }}>
          <Button label={t('groupInfo.leaveAndDelete')} variant="soft" height={48} onPress={() => setDeleting(true)} />
        </View>
      </ScrollView>

      {who && (
        <Dialog icon="person_remove" title={t('groupInfo.removeTitle', { name: who.name || t('groupInfo.role.member').toLowerCase() })} primaryIcon="key" primary={t('groupInfo.removeAndRekey')}
          body={t('groupInfo.removeBody')}
          onPrimary={() => { run(() => groupOps.remove(g.id, who.id)); setTarget(null); }} onClose={() => setTarget(null)} />
      )}
      {leaving && (
        <Dialog icon="logout" title={channel ? t('groupInfo.leaveChannelTitle') : t('groupInfo.leaveGroupTitle')} primary={t('groupInfo.leave')}
          body={t('groupInfo.leaveBody')}
          onPrimary={() => { setLeaving(false); run(() => groupOps.leave(g.id)); router.dismissTo('/(tabs)'); }} onClose={() => setLeaving(false)} />
      )}
      {delDialog}
    </Screen>
  );
}
