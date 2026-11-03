import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PROFILE_NOTES } from '../../data/settings';
import { useActiveDeviceCount } from '../../lib/devices';
import { fmtBytes } from '../../lib/networkCore';
import { useStorageUsage } from '../../lib/storageUsage';
import { persistedBytes } from '../../lib/persist';
import { handleOf, initialsOf } from '../../lib/text';
import { fingerprintOf, useKeys } from '../../state/keys';
import { useResetApp } from '../../state/reset';
import { useSettings } from '../../state/settings';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { useMyCard } from '../../state/messaging';
import { QrCode } from '../../ui/QrCode';
import { Dialog } from '../../ui/Dialog';
import { Icon, type IconName } from '../../ui/Icon';
import { ProfileAvatar } from '../../ui/ProfileAvatar';
import { Screen } from '../../ui/Screen';
import { ActionRow, SetGroup } from '../../ui/Settings';
import { T } from '../../ui/T';

/** Espaço ocupado pelos dados do Piu neste aparelho (conversas, contatos, sessões), em pt-BR. */

/** Perfil: identidade pública/anônima, impressão digital da chave e ajustes. */
export default function Profile() {
  const { c } = useTheme();
  const { identity, setIdentity, profile } = useStore();
  const { backupDone } = useSettings();
  // Mesmos números das telas Aparelhos e Armazenamento (registro real e medição real).
  const devices = useActiveDeviceCount();
  const [storage] = useStorageUsage();
  const reset = useResetApp();
  const [del, setDel] = useState(false);
  const pub = identity === 'public';
  const { identities } = useKeys();
  const me = identities?.[identity];
  const [card] = useMyCard(identity);
  const fp = me ? fingerprintOf(me) : Array(8).fill('····');
  const short = me ? `${me.id.slice(0, 8)}…${me.id.slice(-4)}` : 'piu:…';
  // Identidade pública sem nome (quem começou pela anônima): mostra o código da chave, sem inventar nome.
  const pubName = profile.name.trim();
  const p = pub
    ? { name: pubName || 'Sem nome público', initials: pubName ? initialsOf(pubName) : fp[0].slice(0, 2), handle: pubName ? handleOf(pubName) : short, radius: 'circle', note: PROFILE_NOTES.public, fp }
    : { name: `Anônimo · ${fp[0]}`, initials: fp[0].slice(0, 2), handle: short, radius: 'square', note: PROFILE_NOTES.anon, fp };

  const rows: [IconName, string, string, () => void, boolean?][] = [
    ['shield_lock', 'Privacidade', '', () => router.push('/settings/privacy')],
    ['notifications', 'Notificações', '', () => router.push('/notifications')],
    ['database', 'Armazenamento', storage ? fmtBytes(storage.total) : fmtBytes(persistedBytes()), () => router.push('/settings/storage')],
    ['battery_saver', 'Bateria e limites', '', () => router.push('/settings/battery')],
    ['devices', 'Aparelhos', String(devices), () => router.push('/devices')],
    ['router', 'Painel do provider', '', () => router.push('/provider')],
    ['key', 'Backup cifrado das chaves', backupDone ? 'Feito hoje' : 'Pendente', () => router.push('/backup')],
    ['person_add', 'Convidar para o Piu', '', () => router.push('/invite'), true],
    ['restart_alt', 'Ver boas-vindas', '', () => router.push('/welcome' as Href)],
    ['delete', 'Apagar dados locais', '', () => setDel(true), true],
  ];

  return (
    <Screen edges={['top']} enter="tab">
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 20 }}>
          <View accessibilityRole="radiogroup" accessibilityLabel="Identidade" style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 14, backgroundColor: c.bg2 }}>
            {([['public', 'Pública', 'public'], ['anon', 'Anônima', 'visibility_off']] as const).map(([k, l, ic]) => {
              const on = identity === k;
              return (
                <Pressable key={k} onPress={() => setIdentity(k)} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`Identidade ${l.toLowerCase()}`}
                  style={{ flex: 1, height: 36, borderRadius: 11, backgroundColor: on ? c.bg : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    shadowColor: '#000', shadowOpacity: on ? 0.12 : 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: on ? 1 : 0 }}>
                  <Icon name={ic} size={17} />
                  <T size={14} w={on ? 600 : 450}>{l}</T>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ paddingTop: 28, paddingHorizontal: 20, paddingBottom: 20, alignItems: 'center', gap: 12 }}>
          <ProfileAvatar pub={pub} initials={p.initials} keyCode={p.initials} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <T size={26} w={700} ls={-0.035} align="center" accessibilityRole="header">{p.name}</T>
            <T size={13} mono color={c.ink2}>{p.handle}</T>
          </View>
          <T size={13} lh={1.4} color={c.ink2} align="center" style={{ maxWidth: 280 }}>{p.note}</T>
        </View>

        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Pressable onPress={() => router.push('/my-code')} accessibilityRole="button" accessibilityLabel="Abrir meu código em tela cheia">
            {card ? <QrCode value={card} size={104} label="QR do meu contato" /> : <View style={{ width: 104, height: 104, borderRadius: 14, backgroundColor: c.bg }} />}
          </Pressable>
          <View accessible accessibilityLabel={'Impressão digital: ' + p.fp.join(' ')} style={{ flex: 1, gap: 8 }}>
            <T size={12.5} color={c.ink2}>Impressão digital</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 }}>
              {p.fp.map((f, i) => <T key={i} size={14} w={500} mono style={{ width: '50%' }}>{f}</T>)}
            </View>
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <SetGroup>
            {rows.map(([icon, name, value, go, strong]) => <ActionRow key={name} icon={icon} name={name} value={value} onPress={go} strong={strong} />)}
          </SetGroup>
        </View>
        <T size={11.5} mono color={c.ink2} align="center" style={{ marginTop: 16, marginHorizontal: 24 }}>Piu 0.1 · LNNP v1 · sem servidor central</T>
      </ScrollView>

      {del && (
        <Dialog icon="delete_forever" title="Apagar dados locais?" hold primary="Segure para apagar" primaryIcon="touch_app"
          body="Chaves, conversas e carteira serão apagadas deste aparelho. Sem backup não há como recuperar, nem os seus LUNES."
          onClose={() => setDel(false)}
          onPrimary={() => { setDel(false); reset(); router.replace('/welcome' as Href); }} />
      )}
    </Screen>
  );
}
