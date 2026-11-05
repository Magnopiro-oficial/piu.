import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { IdentityKind } from '../data/types';
import { useT } from '../i18n';
import { initialsOf } from '../lib/text';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/**
 * Novo grupo ou nova comunidade (FUN-006, FUN-008). O protótipo não desenha esta tela; ela segue o
 * padrão de "Novo canal": nome, identidade e membros escolhidos entre os contatos (adicionados pelo QR).
 */
export default function NewGroup() {
  const { kind, parent } = useLocalSearchParams<{ kind?: string; parent?: string }>();
  const community = kind === 'community';
  const { c } = useTheme();
  const t = useT();
  const { identity, showToast } = useStore();
  const { ready, contactsFor, createGroup } = useMessaging();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [ident, setIdent] = useState<IdentityKind>(identity);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const contacts = contactsFor(ident);
  const ids = contacts.filter(x => picked[x.id]).map(x => x.id);
  const ok = ready && name.trim().length > 0;
  const input = { borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink } as const;

  const create = () => {
    if (!ok) return;
    try {
      const id = createGroup({ kind: community ? 'community' : 'group', name, desc, via: ident, memberIds: ids, parent: community ? undefined : parent });
      router.dismissTo('/(tabs)');
      router.push(community ? { pathname: '/community/[id]', params: { id } } : { pathname: '/chat/[id]', params: { id } });
    } catch (e) { showToast({ icon: 'error', title: t('newGroup.createFail'), body: (e as Error).message }); }
  };

  return (
    <Screen>
      <BackHeader title={community ? t('new.community') : t('new.group')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder={community ? t('newGroup.communityName') : t('newGroup.groupName')} placeholderTextColor={c.ink3}
            accessibilityLabel={community ? t('newGroup.communityName') : t('newGroup.groupName')} maxLength={60} style={{ ...input, height: 52, fontSize: 16, fontFamily: fontFamily(600) }} />
          <TextInput value={desc} onChangeText={setDesc} placeholder={t('newGroup.desc')} placeholderTextColor={c.ink3} accessibilityLabel={t('newGroup.desc')} maxLength={140}
            style={{ ...input, height: 48, fontSize: 15, fontFamily: fontFamily(400) }} />
        </View>

        <SectionLabel>{t('newGroup.identity')}</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <Segmented label={t('profile.identity')} value={ident} onChange={v => { setIdent(v); setPicked({}); }} options={[['public', t('profile.identity.public')], ['anon', t('profile.identity.anon')]]} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>
            {ident === 'anon' ? t('newGroup.ident.anon') : t('newGroup.ident.public')}
          </T>
        </View>

        <SectionLabel>{t('newGroup.members', { count: ids.length + 1 })}</SectionLabel>
        <View style={{ paddingHorizontal: 20 }}>
          {contacts.length === 0 ? (
            <View style={{ padding: 16, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
              <T size={13.5} lh={1.45} color={c.ink2}>{community ? t('newGroup.noContacts.community') : t('newGroup.noContacts.group')}</T>
              <Button label={t('chats.scan')} variant="outline" height={42} fontSize={14} onPress={() => router.push('/scan')} />
            </View>
          ) : contacts.map(p => {
            const on = !!picked[p.id];
            return (
              <Pressable key={p.id} onPress={() => setPicked(m => ({ ...m, [p.id]: !on }))} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={p.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
                <Avatar initials={initialsOf(p.name)} size={40} />
                <T size={15} w={600} style={{ flex: 1 }} numberOfLines={1}>{p.name}</T>
                <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: c.ink, backgroundColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Icon name="check" size={16} color={c.invink} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="key" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('newGroup.e2eNote')}</T>
        </View>
        <View style={{ paddingTop: 24, paddingHorizontal: 20 }}>
          <Button label={community ? t('newGroup.createCommunity') : t('newGroup.createGroup')} disabled={!ok} onPress={create} />
        </View>
      </ScrollView>
    </Screen>
  );
}
