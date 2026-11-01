import { Pressable, ScrollView, View } from 'react-native';
import { MY_DEVICES } from '../data/settings';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/** Aparelhos com as suas chaves: desconectar (troca as chaves de sessão) e revogar um aparelho perdido. */
export default function Devices() {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { dropped, dropDevice } = useSettings();
  const list = MY_DEVICES.filter(d => !dropped[d.id]);

  return (
    <Screen>
      <BackHeader title="Aparelhos" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {list.map(d => (
            <View key={d.id} accessible={!d.canDrop} accessibilityLabel={`${d.name}, ${d.desc}, ${d.tag}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, opacity: d.revoked ? 0.5 : 1 }}>
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: d.current ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.icon} size={22} w={300} color={d.current ? c.invink : c.ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={600}>{d.name}</T>
                <T size={11.5} mono lh={1.4} color={c.ink2}>{d.desc}</T>
              </View>
              {d.canDrop ? (
                <Pressable onPress={() => { dropDevice(d.id); showToast({ icon: 'sync_lock', title: `${d.name} desconectado`, body: 'Chaves de sessão trocadas. Ele não lê nada novo.' }); }}
                  accessibilityRole="button" accessibilityLabel={`Desconectar ${d.name}`}
                  style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                  <T size={12.5} w={550}>Desconectar</T>
                </Pressable>
              ) : <T size={11} w={500} mono color={c.ink2}>{d.tag}</T>}
            </View>
          ))}
          <Button label="Adicionar aparelho" variant="outline" height={48} style={{ marginTop: 6 }}
            onPress={() => showToast({ icon: 'phonelink_ring', title: 'Pronto para parear', body: 'No outro aparelho, abra o Piu e escolha Restaurar → De outro aparelho.' })} />
        </View>
        <SectionLabel>PERDEU UM APARELHO?</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
          <T size={13.5} lh={1.45} color={c.ink2}>A revogação é anunciada pela malha. Seus grupos trocam de chave e o aparelho perdido não lê mais nada novo, mesmo offline.</T>
          <Button label="Revogar aparelho perdido" height={38} fontSize={13.5} style={{ alignSelf: 'flex-start', paddingHorizontal: 16 }}
            onPress={() => showToast({ icon: 'gpp_maybe', title: 'Revogação anunciada na malha', body: 'Grupos trocam de chave conforme os nós recebem o aviso.' })} />
        </View>
      </ScrollView>
    </Screen>
  );
}
