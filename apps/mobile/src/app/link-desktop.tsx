import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { confirmLink, LINK_UNAVAILABLE, linkAvailable, resetLink, startLink, stopLink, useDesktopLink } from '../lib/desktopLinkSession';
import { CodeReader, CodeWords } from '../lib/migrationUi';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const hm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Conectar ao computador (Piu Desktop), modelo WhatsApp Web clássico: o celular lê o QR do computador,
 * os dois mostram as mesmas 3 palavras, a pessoa confirma e o computador passa a ser uma tela remota
 * cifrada pela rede local. O celular continua dono da identidade e das chaves; a sessão vive em
 * lib/desktopLinkSession.ts e continua quando a pessoa sai desta tela.
 */
export default function LinkDesktop() {
  const { c } = useTheme();
  const st = useDesktopLink();
  const { showToast } = useStore();
  const [scanning, setScanning] = useState(false);
  useEffect(() => { if (st.phase !== 'idle') setScanning(false); }, [st.phase]);

  const disconnect = () => {
    stopLink();
    showToast({ icon: 'link_off', title: 'Computador desconectado', body: 'O Piu Desktop não recebe mais nada deste celular.' });
  };

  return (
    <Screen>
      <BackHeader title="Conectar ao computador" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }} keyboardShouldPersistTaps="handled">
        {st.phase === 'idle' && (
          <>
            <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.bg2, gap: 12 }}>
              <Icon name="computer" size={30} w={300} />
              <T size={17} w={650}>Use o Piu no computador</T>
              <T size={14} lh={1.45} color={c.ink2}>No computador, abra o <T size={14} w={600}>Piu Desktop</T> e escolha <T size={14} w={600}>Conectar celular</T>. Depois leia o QR que aparece lá.</T>
              <T size={13} lh={1.45} color={c.ink2}>As chaves ficam só no celular. O computador mostra as conversas e envia pelo celular, cifrado pela rede local (TLS com o certificado do QR), enquanto os dois estiverem na mesma Wi-Fi.</T>
              {!linkAvailable() && <T size={13} lh={1.45} w={550}>{LINK_UNAVAILABLE}</T>}
              {!scanning && <Button label="Ler o QR do computador" height={48} disabled={!linkAvailable()} onPress={() => setScanning(true)} />}
            </View>
            {scanning && (
              <>
                <CodeReader hint="Aponte a câmera para o QR do computador. Ele muda a cada 30 segundos; se demorar, leia o novo." placeholder="piu-link:1?…" onRead={startLink} />
                <Button label="Cancelar" variant="soft" height={44} onPress={() => setScanning(false)} />
              </>
            )}
          </>
        )}

        {st.phase === 'connecting' && (
          <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.bg2, gap: 12 }}>
            <Icon name="lan" size={28} w={300} />
            <T size={16} w={600}>Conectando…</T>
            <T size={13} mono lh={1.5} color={c.ink2}>{st.host}</T>
            <T size={13} lh={1.45} color={c.ink2}>Os dois precisam estar na mesma Wi-Fi. Nada sai do celular antes de você conferir as palavras.</T>
            <Button label="Cancelar" variant="soft" height={44} onPress={() => stopLink()} />
          </View>
        )}

        {st.phase === 'confirm' && st.words && (
          <View style={{ gap: 12 }}>
            <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.bg2, gap: 10 }}>
              <T size={16} w={650}>Confiram as 3 palavras</T>
              <T size={13.5} lh={1.45} color={c.ink2}>O computador{st.name ? ` (${st.name})` : ''} mostra 3 palavras na tela. Elas precisam ser exatamente estas, na mesma ordem:</T>
              <CodeWords words={st.words} prompt="No computador:" />
              <T size={12.5} lh={1.45} color={c.ink2}>Se forem diferentes, cancele: alguém na mesma rede pode estar se metendo no caminho. Nada foi enviado ainda.</T>
            </View>
            <Button label="São iguais · conectar" height={50} onPress={confirmLink} />
            <Button label="Diferentes · cancelar" variant="ghost" height={44} fontSize={14} onPress={() => stopLink('Palavras diferentes no celular.')} />
          </View>
        )}

        {st.phase === 'connected' && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="computer" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} numberOfLines={1} style={{ flex: 1 }}>{st.name || 'Computador conectado'}</T>
              <Icon name="check_circle" size={20} color={c.invink} />
            </View>
            <T size={12.5} mono lh={1.6} color={c.invink} style={{ opacity: 0.8 }}>
              {`${st.host}\nconectado desde ${st.since ? hm(st.since) : '—'}\n${st.sent} quadros enviados · ${st.received} recebidos`}
            </T>
            <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>O computador só vê o que este celular manda, cifrado. Se o celular sair da Wi-Fi ou fechar o app, a conexão cai e o computador para de atualizar.</T>
            <Button label="Desconectar" variant="inverse" height={46} onPress={disconnect} />
          </View>
        )}

        {st.phase === 'error' && (
          <View style={{ gap: 12 }}>
            <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
              <Icon name="gpp_bad" size={20} />
              <T size={13.5} lh={1.4} style={{ flex: 1 }}>{st.error ?? 'A conexão caiu.'}</T>
            </View>
            <Button label="Tentar de novo" height={48} onPress={() => { resetLink(); setScanning(true); }} />
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, marginHorizontal: 4 }}>
          <Icon name="shield_lock" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>A chave e o certificado do computador vêm pela câmera, então quem está na mesma Wi-Fi não lê o que o celular manda nem consegue se passar pelo computador. As 3 palavras denunciam quem tentar se meter no caminho. Sem servidor: só os dois aparelhos.</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
