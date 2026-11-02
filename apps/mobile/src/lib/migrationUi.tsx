/**
 * Peças de tela da migração aparelho a aparelho (usadas em Restaurar → De outro aparelho e em
 * Aparelhos → Adicionar aparelho): leitor de QR com a opção de colar o código e o código de 4 palavras.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { QrCode } from '../ui/QrCode';
import { T } from '../ui/T';

/** Lê um QR pela câmera ou colando o texto. `onRead` devolve a mensagem de erro, ou null se aceitou. */
export function CodeReader({ hint, placeholder, onRead }: { hint: string; placeholder: string; onRead: (text: string) => string | null }) {
  const { c } = useTheme();
  const [perm, requestPerm] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const read = (t: string) => {
    const e = onRead(t.trim());
    setError(e);
    if (!e) setCamera(false);
    else handled.current = false;
  };
  const open = async () => {
    handled.current = false;
    const p = perm?.granted ? perm : await requestPerm();
    if (p.granted) setCamera(true);
    else setError('Sem permissão para a câmera. Cole o código abaixo.');
  };
  return (
    <View style={{ gap: 12 }}>
      {camera ? (
        <>
          <View style={{ height: 280, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={r => { if (handled.current) return; handled.current = true; read(r.data); }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 46, right: 46, top: 46, bottom: 46, borderWidth: 2, borderColor: '#fff', borderRadius: 18 }} />
          </View>
          <Button label="Fechar a câmera" variant="soft" height={44} onPress={() => setCamera(false)} />
        </>
      ) : (
        <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
          <Icon name="qr_code_scanner" size={28} w={300} />
          <T size={14} lh={1.45} color={c.ink2}>{hint}</T>
          <Button label="Abrir a câmera" height={46} onPress={open} />
        </View>
      )}
      <TextInput value={code} onChangeText={t => { setCode(t); setError(null); }} placeholder={placeholder} placeholderTextColor={c.ink3}
        autoCapitalize="none" autoCorrect={false} multiline accessibilityLabel="Código do outro aparelho"
        style={{ minHeight: 64, padding: 14, borderRadius: 16, backgroundColor: c.bg2, color: c.ink, fontSize: 12.5, fontFamily: fontFamily(400, true), textAlignVertical: 'top' }} />
      <Button label="Ler código colado" variant="outline" height={44} disabled={!code.trim()} onPress={() => read(code)} />
      {error && (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
          <Icon name="gpp_bad" size={20} />
          <T size={13.5} lh={1.4} style={{ flex: 1 }}>{error}</T>
        </View>
      )}
    </View>
  );
}

/** QR grande com o texto, mais "Copiar código" (para colar quando a câmera não está disponível). */
export function CodeQr({ value, label }: { value: string; label: string }) {
  const { c } = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <QrCode value={value} size={232} label={label} />
      <Button label={copied ? 'Código copiado' : 'Copiar código'} variant="ghost" height={38} fontSize={13}
        left={<Icon name="content_copy" size={16} color={c.ink} />}
        onPress={() => { void Clipboard.setStringAsync(value).then(() => setCopied(true)).catch(() => {}); }} />
    </View>
  );
}

/** As 4 palavras que precisam aparecer iguais nos dois aparelhos. */
export function CodeWords({ words, prompt }: { words: string[]; prompt: string }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
      <T size={13} color={c.ink2}>{prompt}</T>
      <View accessibilityLabel={'Código: ' + words.join(', ')} style={{ flexDirection: 'row', gap: 6 }}>
        {words.map((w, i) => (
          <View key={i} style={{ flex: 1, height: 38, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
            <T size={14} w={650} numberOfLines={1} adjustsFontSizeToFit>{w}</T>
          </View>
        ))}
      </View>
    </View>
  );
}
