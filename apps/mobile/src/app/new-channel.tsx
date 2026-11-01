import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { CHANNEL_TYPES } from '../data/seed';
import type { ChannelType, IdentityKind } from '../data/types';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/** Criar canal (FUN-007): público, privado ou secreto; quem publica; com identidade pública ou anônima. */
export default function NewChannel() {
  const { c } = useTheme();
  const { createChannel, profile } = useStore();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<ChannelType>('public');
  const [post, setPost] = useState<'admins' | 'mods'>('admins');
  const [ident, setIdent] = useState<IdentityKind>('public');
  const ok = name.trim().length > 0;
  const input = { borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink } as const;

  const create = () => {
    if (!ok) return;
    const id = createChannel({ name, desc, type, post, ident });
    router.dismissTo('/(tabs)');
    router.push({ pathname: '/chat/[id]', params: { id } });
  };

  return (
    <Screen>
      <BackHeader title="Novo canal" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder="Nome do canal" placeholderTextColor={c.ink3} accessibilityLabel="Nome do canal" maxLength={60}
            style={{ ...input, height: 52, fontSize: 16, fontFamily: fontFamily(600) }} />
          <TextInput value={desc} onChangeText={setDesc} placeholder="Descrição (opcional)" placeholderTextColor={c.ink3} accessibilityLabel="Descrição (opcional)" maxLength={140}
            style={{ ...input, height: 48, fontSize: 15, fontFamily: fontFamily(400) }} />
        </View>

        <SectionLabel>TIPO</SectionLabel>
        <View accessibilityRole="radiogroup" style={{ paddingHorizontal: 20, gap: 8 }}>
          {CHANNEL_TYPES.map(([k, icon, title, d]) => {
            const on = type === k;
            return (
              <Pressable key={k} onPress={() => setType(k)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.bg2 : 'transparent' }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} w={300} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={15.5} w={600}>{title}</T>
                  <T size={13} lh={1.35} color={c.ink2}>{d}</T>
                </View>
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink, opacity: on ? 1 : 0 }} />
                </View>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>QUEM PUBLICA</SectionLabel>
        <View style={{ paddingHorizontal: 20 }}>
          <Segmented label="Quem publica" value={post} onChange={setPost} options={[['admins', 'Só admins'], ['mods', 'Admins e moderadores']]} />
        </View>

        <SectionLabel>PUBLICAR COMO</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <Segmented label="Publicar como" value={ident} onChange={setIdent} options={[['public', 'Identidade pública'], ['anon', 'Identidade anônima']]} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>
            {ident === 'anon' ? 'O canal fica na sua identidade anônima, sem vínculo com o perfil público.' : `Inscritos veem que o canal é seu (${profile.name || 'Cardeal'}).`}
          </T>
        </View>

        <View style={{ paddingTop: 24, paddingHorizontal: 20 }}>
          <Button label="Criar canal" disabled={!ok} onPress={create} />
        </View>
      </ScrollView>
    </Screen>
  );
}
