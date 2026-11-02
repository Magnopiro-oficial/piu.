import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import type { ContactCard } from '../messaging/card';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/**
 * Adicionar contato pessoalmente: lê o QR de convite (cartão assinado) pela câmera ou colando o código.
 * O cartão traz as chaves públicas; a conversa já começa cifrada. A confirmação de que a chave é da
 * pessoa certa é o código de segurança, conferido depois na tela do contato.
 */
export default function Scan() {
  const { c } = useTheme();
  const { readCard, addFromCard, testDeviceCard, ready } = useMessaging();
  const { chats, showToast, setVerified } = useStore();
  // `verify`: veio da tela do contato para conferir pessoalmente que o QR é mesmo dele.
  const { verify } = useLocalSearchParams<{ verify?: string }>();
  const target = verify ? chats.find(x => x.id === verify) : undefined;
  const [perm, requestPerm] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<ContactCard | null>(null);
  const handled = useRef(false);

  const parse = (text: string) => {
    try {
      const k = readCard(text);
      setCamera(false);
      if (target) {
        if (k.id !== target.peer) { setCard(null); setError(`Este QR não é de ${target.name}. Se a pessoa está na sua frente, alguém pode ter trocado as chaves: não confie na conversa.`); return; }
        setVerified(target.id, true);
        showToast({ icon: 'verified', title: 'Código confere', body: `${target.name} verificado pessoalmente.` });
        router.back();
        return;
      }
      setCard(k); setError(null);
    }
    catch (e) { setCard(null); setError((e as Error).message); }
  };
  const openCamera = async () => {
    handled.current = false;
    const p = perm?.granted ? perm : await requestPerm();
    if (p.granted) setCamera(true);
    else setError('Sem permissão para a câmera. Cole o código abaixo.');
  };
  const add = () => {
    if (!card) return;
    try {
      const id = addFromCard(card);
      showToast({ icon: 'key', title: 'Contato adicionado', body: 'Confira o código de segurança pessoalmente.' });
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) { setError((e as Error).message); }
  };
  const exists = card ? chats.some(x => x.peer === card.id) : false;

  return (
    <Screen>
      <BackHeader title={target ? `Verificar ${target.name}` : 'Adicionar contato'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }} keyboardShouldPersistTaps="handled">
        {camera ? (
          <View style={{ height: 300, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={r => { if (handled.current) return; handled.current = true; parse(r.data); }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 50, right: 50, top: 50, bottom: 50, borderWidth: 2, borderColor: '#fff', borderRadius: 18 }} />
          </View>
        ) : (
          <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.bg2, gap: 12 }}>
            <Icon name="qr_code_scanner" size={30} w={300} />
            <T size={15} lh={1.45} color={c.ink2}>Peça para a pessoa abrir <T size={15} w={600}>Perfil → Meu código</T> e aponte a câmera para o QR.</T>
            <Button label="Abrir a câmera" height={48} onPress={openCamera} disabled={!ready} />
          </View>
        )}
        {camera && <Button label="Fechar a câmera" variant="soft" height={44} onPress={() => setCamera(false)} />}

        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 6 }}>OU COLE O CÓDIGO</T>
        <TextInput value={code} onChangeText={t => { setCode(t); setError(null); }} placeholder="piu1:…" placeholderTextColor={c.ink3}
          autoCapitalize="none" autoCorrect={false} multiline accessibilityLabel="Código de contato"
          style={{ minHeight: 76, padding: 14, borderRadius: 16, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(400, true), textAlignVertical: 'top' }} />
        <Button label="Ler código" variant="outline" height={46} disabled={!code.trim() || !ready} onPress={() => parse(code)} />
        {testDeviceCard && !target && (
          <Button label="Usar o aparelho de teste (simulação)" variant="ghost" height={42} fontSize={13.5}
            onPress={() => { const t = testDeviceCard(); setCode(t); parse(t); }} />
        )}

        {error && (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
            <Icon name="gpp_bad" size={20} />
            <T size={13.5} lh={1.4} style={{ flex: 1 }}>{error}</T>
          </View>
        )}

        {card && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="verified_user" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} style={{ flex: 1 }}>{card.name || 'Identidade anônima'}</T>
            </View>
            <T size={12} mono lh={1.6} color={c.invink} style={{ opacity: 0.75 }}>
              {`${card.kind === 'anon' ? 'anônima' : 'pública'} · assinatura confere\n${card.id.slice(4, 8).toUpperCase()} … ${card.id.slice(-4).toUpperCase()}`}
            </T>
            <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>
              {card.kind === 'anon' ? 'Você vai conversar com ela pela sua identidade anônima.' : 'Você vai conversar com ela pela sua identidade pública.'}
            </T>
            <Button label={exists ? 'Já é seu contato · abrir' : 'Adicionar e conversar'} variant="inverse" height={46} onPress={add} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
