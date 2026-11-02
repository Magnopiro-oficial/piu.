import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { confirmDevice } from '../lib/deviceAuth';
import { addDevice, PLATFORM_LABEL, revokeDevice, thisDevice, useDevices } from '../lib/devices';
import type { DeviceRecord } from '../lib/devicesCore';
import { MigrationError, respondToOffer } from '../lib/migration';
import { b64url } from '../messaging/card';
import { CodeQr, CodeReader, CodeWords } from '../lib/migrationUi';
import { useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const day = (sec: number) => new Date(sec * 1000).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
const ICON: Record<DeviceRecord['platform'], IconName> = { android: 'phone_android', ios: 'phone_iphone', web: 'computer', other: 'devices' };

function describe(d: DeviceRecord): { desc: string; tag: string } {
  const plat = PLATFORM_LABEL[d.platform];
  if (d.via === 'this') return { desc: `${plat} · desde ${day(d.addedAt)}`, tag: 'atual' };
  if (d.revokedAt) return { desc: `${d.revokeReason === 'lost' ? 'revogado' : 'desconectado'} em ${day(d.revokedAt)} · chaves rotacionadas`, tag: d.revokeReason === 'lost' ? 'revogado' : 'desconectado' };
  return { desc: `${plat} · ${d.via === 'origin' ? 'chaves vieram dele' : 'pareado'} em ${day(d.addedAt)}`, tag: 'ativo' };
}

type Pair = { step: 'scan' } | { step: 'reply'; reply: string; code: string[]; name: string };
type Ask = { kind: 'drop' | 'revoke'; d: DeviceRecord };

/**
 * Aparelhos com as suas chaves (registro real, salvo neste aparelho): adicionar um aparelho (QR +
 * código de 4 palavras), desconectar e revogar um aparelho perdido. Desconectar e revogar assinam um
 * aviso com a chave da identidade (para os contatos) e trocam as chaves de sessão.
 */
export default function Devices() {
  const { c } = useTheme();
  const { showToast, profile } = useStore();
  const { identities, phrase } = useKeys();
  const list = useDevices();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [pair, setPair] = useState<Pair | null>(add ? { step: 'scan' } : null);
  const [picking, setPicking] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const active = list.filter(d => d.via !== 'this' && !d.revokedAt);
  useEffect(() => { if (add) setPair({ step: 'scan' }); }, [add]);

  /** Aparelho antigo: leu a oferta do novo → confirma o dono → responde com a frase cifrada. */
  const onOffer = (text: string): string | null => {
    if (!phrase) return 'Este aparelho ainda não tem chaves.';
    try {
      const me = thisDevice();
      const r = respondToOffer(text, { phrase, from: { pk: me.pk, name: PLATFORM_LABEL[me.platform] + (profile.name ? ` de ${profile.name}` : ''), platform: me.platform }, profileName: profile.idType === 'public' ? profile.name : undefined }, Math.floor(Date.now() / 1000));
      // Quem tem a frase tem tudo: só envia depois de confirmar que é o dono do aparelho.
      void confirmDevice('Enviar suas chaves para o aparelho novo').then(async auth => {
        if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: 'Transferência cancelada', body: 'Não foi possível confirmar que é você.' }); setPair(null); return; }
        await addDevice({ pk: b64url(r.device.pk), name: r.device.name || 'Aparelho novo', platform: r.device.platform, via: 'paired' });
        setPair({ step: 'reply', reply: r.reply, code: r.code, name: r.device.name || 'aparelho novo' });
      });
      return null;
    } catch (e) {
      return e instanceof MigrationError ? e.message : 'QR ilegível. Tente de novo.';
    }
  };

  const confirmAsk = async () => {
    if (!ask || !identities) return;
    const { kind, d } = ask;
    setAsk(null); setPicking(false);
    const auth = await confirmDevice(kind === 'revoke' ? `Revogar ${d.name}` : `Desconectar ${d.name}`);
    if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: 'Nada foi alterado', body: 'Não foi possível confirmar que é você.' }); return; }
    await revokeDevice(d.id, kind === 'revoke' ? 'lost' : 'disconnected', identities);
    showToast(kind === 'revoke'
      ? { icon: 'gpp_maybe', title: 'Revogação assinada', body: 'O aviso segue para seus contatos pela malha. Chaves de sessão trocadas.' }
      : { icon: 'sync_lock', title: `${d.name} desconectado`, body: 'Chaves de sessão trocadas. Ele não lê nada novo.' });
  };

  return (
    <Screen>
      <BackHeader title="Aparelhos" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {list.map(d => {
            const cur = d.via === 'this', canDrop = !cur && !d.revokedAt;
            const { desc, tag } = describe(d);
            return (
              <View key={d.id} accessible={!canDrop} accessibilityLabel={`${d.name}, ${desc}, ${tag}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, opacity: d.revokedAt ? 0.5 : 1 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: cur ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={cur ? 'smartphone' : ICON[d.platform]} size={22} w={300} color={cur ? c.invink : c.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={15} w={600} numberOfLines={1}>{d.name}</T>
                  <T size={11.5} mono lh={1.4} color={c.ink2}>{desc}</T>
                </View>
                {canDrop ? (
                  <Pressable onPress={() => setAsk({ kind: 'drop', d })} accessibilityRole="button" accessibilityLabel={`Desconectar ${d.name}`}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>Desconectar</T>
                  </Pressable>
                ) : <T size={11} w={500} mono color={c.ink2}>{tag}</T>}
              </View>
            );
          })}

          {!pair && <Button label="Adicionar aparelho" variant="outline" height={48} style={{ marginTop: 6 }} onPress={() => setPair({ step: 'scan' })} />}
          {pair?.step === 'scan' && (
            <View style={{ marginTop: 6, gap: 10 }}>
              <T size={13.5} lh={1.45} color={c.ink2}>No aparelho novo, abra o Piu e escolha <T size={13.5} w={600}>Restaurar → De outro aparelho</T>. Depois leia o QR que aparece nele.</T>
              <CodeReader hint="Aponte a câmera para o QR do aparelho novo. As chaves vão direto e cifradas, sem servidor." placeholder="piu-mig1:…" onRead={onOffer} />
              <Button label="Cancelar" variant="soft" height={44} onPress={() => setPair(null)} />
            </View>
          )}
          {pair?.step === 'reply' && (
            <View style={{ marginTop: 6, padding: 16, borderRadius: 24, backgroundColor: c.bg2, gap: 14 }}>
              <T size={15} w={600}>Agora o aparelho novo lê este QR</T>
              <CodeQr value={pair.reply} label="QR de resposta para o aparelho novo" />
              <CodeWords words={pair.code} prompt={`Confira se as mesmas palavras aparecem no ${pair.name}:`} />
              <T size={12.5} lh={1.45} color={c.ink2}>Se forem diferentes, toque em Cancelar no aparelho novo: alguém pode ter se metido no caminho.</T>
              <Button label="Pronto" height={46} onPress={() => { setPair(null); showToast({ icon: 'phonelink_ring', title: 'Aparelho adicionado', body: `${pair.name} recebeu suas chaves.` }); }} />
            </View>
          )}
        </View>

        <SectionLabel>PERDEU UM APARELHO?</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
          <T size={13.5} lh={1.45} color={c.ink2}>A revogação é assinada pela sua identidade e anunciada pela malha. As chaves de sessão são trocadas e seus contatos passam a recusar o aparelho perdido.</T>
          {picking && (
            <View accessibilityRole="radiogroup" accessibilityLabel="Qual aparelho" style={{ gap: 6 }}>
              {active.map(d => (
                <Pressable key={d.id} onPress={() => setAsk({ kind: 'revoke', d })} accessibilityRole="button" accessibilityLabel={`Revogar ${d.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
                  <Icon name={ICON[d.platform]} size={20} w={300} />
                  <T size={14} w={600} numberOfLines={1} style={{ flex: 1 }}>{d.name}</T>
                  <Icon name="chevron_right" size={18} color={c.ink2} />
                </Pressable>
              ))}
            </View>
          )}
          <Button label={picking ? 'Cancelar' : 'Revogar aparelho perdido'} variant={picking ? 'soft' : 'primary'} height={38} fontSize={13.5} style={{ alignSelf: 'flex-start', paddingHorizontal: 16 }}
            onPress={() => {
              if (picking) { setPicking(false); return; }
              if (!active.length) { showToast({ icon: 'devices', title: 'Nenhum outro aparelho ativo', body: 'Só este aparelho tem as suas chaves.' }); return; }
              setPicking(true);
            }} />
          <T size={12} lh={1.45} color={c.ink2}>O aparelho perdido tinha a sua frase. Se ele pode estar com outra pessoa, crie também uma identidade nova.</T>
        </View>
      </ScrollView>

      {ask && (
        <Dialog icon={ask.kind === 'revoke' ? 'gpp_maybe' : 'link_off'} hold={ask.kind === 'revoke'}
          title={ask.kind === 'revoke' ? `Revogar ${ask.d.name}?` : `Desconectar ${ask.d.name}?`}
          body={ask.kind === 'revoke' ? 'Não dá para desfazer. Um aviso assinado vai para seus contatos e as chaves de sessão são trocadas.' : 'As chaves de sessão são trocadas e ele deixa de receber o que é novo. Para voltar, pareie de novo.'}
          primary={ask.kind === 'revoke' ? 'Segure para revogar' : 'Desconectar'} primaryIcon={ask.kind === 'revoke' ? 'touch_app' : undefined}
          onPrimary={() => { void confirmAsk(); }} onClose={() => setAsk(null)} />
      )}
    </Screen>
  );
}
