import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, View } from 'react-native';
import { STORAGE_USE } from '../../data/settings';
import { confirmDevice } from '../../lib/deviceAuth';
import { useResetApp } from '../../state/reset';
import { useNetwork } from '../../state/network';
import { useSettings } from '../../state/settings';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { ActionRow, FootNote, LockedRow, SegRow, SetGroup, ToggleRow } from '../../ui/Settings';
import { T } from '../../ui/T';

type Page = 'privacy' | 'storage' | 'battery';
const TITLES: Record<Page, string> = { privacy: 'Privacidade', storage: 'Armazenamento', battery: 'Bateria e limites' };

/** Ajustes: Privacidade, Armazenamento e Bateria e limites (tudo local). */
export default function SettingsPage() {
  const { page: raw } = useLocalSearchParams<{ page: string }>();
  const page: Page = raw === 'storage' || raw === 'battery' ? raw : 'privacy';
  return (
    <Screen>
      <BackHeader title={TITLES[page]} />
      <ScrollView>
        {page === 'privacy' ? <Privacy /> : page === 'storage' ? <Storage /> : <Battery />}
      </ScrollView>
    </Screen>
  );
}

function Privacy() {
  const { priv, setPriv } = useSettings();
  const { showToast } = useStore();
  const t = (k: 'read' | 'typing' | 'delay' | 'pad' | 'noRoutes' | 'lock') => () => setPriv({ [k]: !priv[k] });
  return (
    <>
      <SetGroup title="VISIBILIDADE">
        <SegRow name="Quem pode me encontrar" desc="Pela identidade pública" value={priv.find} onChange={find => setPriv({ find })} options={[['all', 'Todos'], ['contacts', 'Contatos'], ['none', 'Ninguém']]} />
        <SegRow name="Por perto começa" value={priv.near} onChange={near => setPriv({ near })} options={[['off', 'Invisível'], ['1h', 'Visível por 1 h']]} />
      </SetGroup>
      <SetGroup title="CONVERSAS">
        <ToggleRow name="Confirmação de leitura" on={priv.read} onChange={t('read')} />
        <ToggleRow name="Mostrar “digitando…”" on={priv.typing} onChange={t('typing')} />
        <SegRow name="Mensagens temporárias" desc="Padrão para novas conversas" value={priv.temp} onChange={temp => setPriv({ temp })} options={[['off', 'Desligado'], ['7d', '7 dias'], ['24h', '24 h']]} />
      </SetGroup>
      <SetGroup title="METADADOS">
        <ToggleRow name="Atraso aleatório no envio" desc="Até 30 s · dificulta correlação por horário" on={priv.delay} onChange={t('delay')} />
        <ToggleRow name="Igualar tamanho das mensagens" desc="Para os nós, todas parecem iguais" on={priv.pad} onChange={t('pad')} />
        <ToggleRow name="Não guardar rotas no aparelho" desc="Some depois da entrega" on={priv.noRoutes} onChange={t('noRoutes')} />
      </SetGroup>
      <SetGroup title="BLOQUEIO">
        <ToggleRow name="Abrir o Piu com biometria" disabled={Platform.OS === 'web'}
          desc={Platform.OS === 'web' ? 'Indisponível na versão web' : 'Ou com o PIN/senha do aparelho, ao abrir e ao voltar ao app'}
          on={priv.lock} onChange={async () => {
            // Ligar ou desligar exige provar que é o dono do aparelho.
            const r = await confirmDevice(priv.lock ? 'Desligar o bloqueio do Piu' : 'Ligar o bloqueio do Piu');
            if (r === 'ok') setPriv({ lock: !priv.lock });
            else if (r === 'unavailable') showToast({ icon: 'lock', title: 'Sem bloqueio no aparelho', body: 'Ative a biometria ou um PIN/senha nos ajustes do aparelho para usar esta opção.' });
          }} />
        <ActionRow name="Contatos bloqueados" value="2" onPress={() => showToast({ icon: 'block', title: '2 contatos bloqueados', body: 'Eles não conseguem iniciar conversa nem ver seu status.' })} />
      </SetGroup>
      <FootNote icon="info">Relays nunca veem conteúdo. Estas opções reduzem o que dá para inferir pelo tráfego, sem prometer anonimato absoluto.</FootNote>
    </>
  );
}

function Storage() {
  const { c, reduceMotion } = useTheme();
  const { sto, setSto, mediaCleared, clearMedia } = useSettings();
  const { storage, setStorage } = useNetwork();
  const { showToast } = useStore();
  const reset = useResetApp();
  const [del, setDel] = useState(false);
  const use = STORAGE_USE.map(([l, mb, v, op]) => (l === 'Mídia' && mediaCleared ? [l, 0, '0 MB', op] as const : [l, mb, v, op] as const));
  const total = use.reduce((a, [, mb]) => a + mb, 0);
  const grow = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(grow, { toValue: 1, duration: 700, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(); }, [reduceMotion, grow]);

  return (
    <>
      <View style={{ marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <T size={32} w={650} ls={-0.04}>{mediaCleared ? '0,9 GB' : '1,2 GB'}</T>
          <T size={13.5} color={c.ink2}>neste aparelho · cifrados</T>
        </View>
        <Animated.View accessibilityLabel="Uso por tipo" style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}>
          {use.filter(([, mb]) => mb > 0).map(([l, mb, , op]) => <View key={l} style={{ flex: mb, backgroundColor: c.ink, opacity: op }} />)}
        </Animated.View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
          {use.map(([l, , v, op]) => (
            <View key={l} style={{ width: '50%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 10 }}>
              <View style={{ width: 8, height: 8, marginTop: 4, borderRadius: 2, backgroundColor: c.ink, opacity: op }} />
              <T size={12.5} lh={1.3} color={c.ink2} style={{ flex: 1 }}>{l}</T>
              <T size={12.5} w={600}>{v}</T>
            </View>
          ))}
        </View>
        <T size={11} mono color={c.ink2}>{`${total.toLocaleString('pt-BR')} MB no total`}</T>
      </View>
      <SetGroup title="MÍDIA">
        <SegRow name="Baixar mídia automaticamente" value={sto.auto} onChange={auto => setSto({ auto })} options={[['wifi', 'Wi-Fi e cabo'], ['always', 'Sempre'], ['never', 'Nunca']]} />
        <SegRow name="Qualidade das fotos enviadas" desc="Menor = chega mais rápido pela malha" value={sto.quality} onChange={quality => setSto({ quality })} options={[['eco', 'Econômica'], ['normal', 'Normal'], ['orig', 'Original']]} />
      </SetGroup>
      <SetGroup title="MENSAGENS DE TERCEIROS">
        <SegRow name="Espaço máximo" desc="Envelopes cifrados que você guarda para outros" value={String(storage)} onChange={v => setStorage(Number(v) as 256 | 512 | 1024)} options={[['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB']]} />
        <SegRow name="Prazo máximo" value={sto.retention} onChange={retention => setSto({ retention })} options={[['24', '24 h'], ['48', '48 h'], ['168', '7 dias']]} />
      </SetGroup>
      <SetGroup title="LIMPEZA">
        <LockedRow name="Armazenamento cifrado" desc="Sempre ativo · chave protegida pelo aparelho" />
        <ActionRow name="Limpar cache de mídia" value={mediaCleared ? '0 MB' : '310 MB'} onPress={() => {
          if (!mediaCleared) { clearMedia(); showToast({ icon: 'cleaning_services', title: 'Cache limpo', body: '310 MB liberados. Conversas continuam intactas.' }); }
        }} />
        <ActionRow name="Apagar dados locais" strong onPress={() => setDel(true)} />
      </SetGroup>
      <FootNote icon="lock">Tudo fica cifrado no aparelho. Mensagens de terceiros são apagadas sozinhas ao vencer o prazo, sem comando remoto.</FootNote>
      {del && (
        <Dialog icon="delete_forever" title="Apagar dados locais?" hold primary="Segure para apagar" primaryIcon="touch_app"
          body="Chaves, conversas e carteira serão apagadas deste aparelho. Sem backup não há como recuperar, nem os seus LUNES."
          onClose={() => setDel(false)} onPrimary={() => { setDel(false); reset(); router.replace('/welcome'); }} />
      )}
    </>
  );
}

function Battery() {
  const { c } = useTheme();
  const { bat, setBat } = useSettings();
  const { battery, setBattery, chargingOnly, setChargingOnly } = useNetwork();
  // Estimativa local do gasto como nó (% da bateria por dia), como no protótipo.
  const est = ((bat.bg ? 2.2 : 0.6) + { eco: 0.4, normal: 1.1, fast: 2.6 }[bat.disc] + (chargingOnly ? -1 : 0) + bat.traffic / 500).toFixed(1).replace('.', ',');
  const DISC = { eco: 'Bluetooth a cada 60 s', normal: 'Bluetooth a cada 20 s', fast: 'Bluetooth a cada 5 s' };
  return (
    <>
      <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Icon name="battery_charging_80" size={34} w={300} color={c.invink} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={26} w={650} ls={-0.03} color={c.invink}>{`~${est}%`}</T>
          <T size={12.5} color={c.invink} style={{ opacity: 0.75 }}>da bateria por dia como nó · estimativa local</T>
        </View>
      </View>
      <SetGroup title="RETRANSMISSÃO">
        <ToggleRow name="Retransmitir em segundo plano" desc="Android: com aviso fixo · iPhone: só com o app aberto" on={bat.bg} onChange={() => setBat({ bg: !bat.bg })} />
        <SegRow name="Parar abaixo de" value={String(battery)} onChange={v => setBattery(Number(v) as 20 | 30 | 50)} options={[['20', '20%'], ['30', '30%'], ['50', '50%']]} />
        <ToggleRow name="Só quando estiver carregando" on={chargingOnly} onChange={() => setChargingOnly(!chargingOnly)} />
      </SetGroup>
      <SetGroup title="HORÁRIO E TRÁFEGO">
        <SegRow name="Horário" value={bat.hours} onChange={hours => setBat({ hours })} options={[['always', 'Sempre'], ['night', '22h–7h'], ['custom', 'Personalizado']]} />
        <SegRow name="Tráfego de terceiros por dia" value={String(bat.traffic)} onChange={v => setBat({ traffic: Number(v) as 50 | 200 | 500 })} options={[['50', '50 MB'], ['200', '200 MB'], ['500', '500 MB']]} />
        <SegRow name="Banda máxima para a rede" value={bat.bw} onChange={bw => setBat({ bw })} options={[['1', '1 Mbps'], ['5', '5 Mbps'], ['max', 'Sem limite']]} />
      </SetGroup>
      <SetGroup title="DESCOBERTA">
        <SegRow name="Procurar vizinhos" desc={DISC[bat.disc]} value={bat.disc} onChange={disc => setBat({ disc })} options={[['eco', 'Econômica'], ['normal', 'Normal'], ['fast', 'Rápida']]} />
      </SetGroup>
      <FootNote icon="smartphone">Android e iPhone limitam o que roda em segundo plano. O Piu nunca promete retransmissão 24 h pelo celular.</FootNote>
    </>
  );
}
