import { router } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import type { IdentityKind } from '../data/types';
import { handleOf } from '../lib/text';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const OPTIONS: [IdentityKind, IconName, string, string][] = [
  ['public', 'person', 'Identidade pública', 'Nome e foto que você escolher. Ideal para amigos e comunidade.'],
  ['anon', 'visibility_off', 'Identidade anônima', 'Só uma chave. Sem nome, sem foto, sem dados civis.'],
];

/** Passo 1 de 2 (FUN-002/003): identidade pública ou anônima, sem telefone nem e-mail. */
export default function Identity() {
  const { c } = useTheme();
  const { profile, setProfile } = useStore();
  const name = profile.name;
  const canGo = profile.idType === 'anon' || name.trim().length > 0;

  return (
    <Screen style={{ paddingHorizontal: 24, paddingTop: 8 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar"
        style={{ width: 40, height: 40, marginLeft: -8, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrow_back_ios_new" size={22} />
      </Pressable>
      <View style={{ gap: 22, flex: 1, marginTop: 14 }}>
        <View style={{ gap: 8 }}>
          <T size={12} w={500} mono ls={0.04} color={c.ink2}>PASSO 1 DE 2</T>
          <T size={32} w={650} ls={-0.035} lh={1.05} accessibilityRole="header">Como você quer aparecer?</T>
          <T size={15} lh={1.4} color={c.ink2}>Sem telefone, sem e-mail. Sua identidade é um par de chaves que vive só neste aparelho.</T>
        </View>
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {OPTIONS.map(([k, icon, title, desc]) => {
            const on = profile.idType === k;
            return (
              <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={() => setProfile({ idType: k })}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.bg2 : 'transparent' }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} w={300} /></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <T size={16} w={600}>{title}</T>
                  <T size={13.5} lh={1.35} color={c.ink2}>{desc}</T>
                </View>
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink, opacity: on ? 1 : 0 }} />
                </View>
              </Pressable>
            );
          })}
        </View>
        {profile.idType === 'public' ? (
          <View style={{ gap: 8 }}>
            <T size={13} w={500} color={c.ink2} nativeID="name-label">Nome de exibição</T>
            <TextInput value={name} onChangeText={v => setProfile({ name: v })} placeholder="Seu nome" placeholderTextColor={c.ink3}
              accessibilityLabelledBy="name-label" accessibilityLabel="Nome de exibição" autoCapitalize="words" returnKeyType="done" maxLength={40}
              style={{ height: 52, borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, fontSize: 16, color: c.ink, fontFamily: fontFamily(400) }} />
            <T size={12} mono color={c.ink2}>{handleOf(name || ' ')} · chave gerada no próximo passo</T>
          </View>
        ) : (
          <View style={{ padding: 16, borderRadius: 16, backgroundColor: c.bg2, gap: 6 }}>
            <T size={13} color={c.ink2}>Seu nome será derivado da chave gerada no próximo passo</T>
            <T size={20} w={500} mono ls={-0.01}>Anônimo · ····</T>
            <T size={12.5} lh={1.4} color={c.ink2}>Nenhum vínculo público com sua identidade pública. Ainda assim, horários e padrões de sinal podem permitir correlação: o anonimato não é absoluto.</T>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Button label="Gerar minhas chaves" disabled={!canGo} onPress={() => router.push('/keys')} style={{ marginBottom: 16 }} />
      </View>
    </Screen>
  );
}
