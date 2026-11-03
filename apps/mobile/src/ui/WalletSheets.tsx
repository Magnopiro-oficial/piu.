import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, TextInput, View } from 'react-native';
import { formatLunes, LUNES_EXPLORER } from '../lib/lunesRpc';
import { blockLabel, whenLabel } from '../lib/walletCore';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { QrCode } from './QrCode';
import { Sheet } from './Sheet';
import { T } from './T';

/**
 * Enviar LUNES exige assinar com a chave da carteira Lunes, que o Piu não cria nem guarda (aqui só
 * lemos o saldo na Mainnet). A folha diz isso em vez de simular um envio.
 */
export function SendSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { lunesAddress, onchainSnap } = useWallet();
  const snap = onchainSnap && onchainSnap.address === lunesAddress ? onchainSnap : null;
  return (
    <Sheet onClose={onClose} label="Enviar LUNES">
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">Enviar LUNES</T>
      <Pending icon="key_off" title="Envio pela sua carteira Lunes" body="O Piu não guarda a chave da sua carteira Lunes, então não assina nem envia nada. Para enviar, use a carteira onde está a chave deste endereço." />
      <View style={{ borderRadius: 18, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
        {[
          ['Saldo na Mainnet', snap ? `${formatLunes(BigInt(snap.free))} LUNES` : lunesAddress ? 'ainda não lido' : 'sem endereço'],
          ['Pagamento dos créditos', 'aguardando liquidação'],
        ].map(([l, v]) => (
          <View key={l} style={{ flexDirection: 'row', gap: 16 }}>
            <T size={13} color={c.ink2}>{l}</T>
            <T size={13} w={550} align="right" tabular style={{ flex: 1 }}>{v}</T>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/**
 * Receber LUNES: o endereço é o da carteira Lunes da própria pessoa (o Piu não gera chave Lunes).
 * Conferido antes de salvar (SS58: base58, prefixo 57 ou 42, soma de verificação) e guardado cifrado.
 */
export function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { showToast } = useStore();
  const { lunesAddress, setLunesAddress, onchainSnap, refreshOnchain } = useWallet();
  const [editing, setEditing] = useState(!lunesAddress);
  const [draft, setDraft] = useState(lunesAddress ?? '');
  const [err, setErr] = useState<string | null>(null);
  const snap = onchainSnap && onchainSnap.address === lunesAddress ? onchainSnap : null;

  const save = () => {
    const e = setLunesAddress(draft);
    setErr(e);
    if (e) return;
    setEditing(false);
    showToast({ icon: 'check_circle', title: 'Endereço salvo', body: 'O saldo é lido na Lunes Mainnet agora.' });
    // O estado do endereço muda no próximo render; a carteira lê de novo quando o endereço muda.
  };
  const copy = () => {
    if (!lunesAddress) return;
    void Clipboard.setStringAsync(lunesAddress).then(() => showToast({ icon: 'content_copy', title: 'Endereço copiado', body: lunesAddress })).catch(() => {});
  };

  return (
    <Sheet onClose={onClose} label="Receber LUNES">
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">Receber LUNES</T>
      {editing || !lunesAddress ? (
        <>
          <T size={13.5} lh={1.45} color={c.ink2}>Cole o endereço da sua carteira Lunes. O Piu não cria nem guarda chave Lunes: ele só lê o saldo desse endereço na Mainnet.</T>
          <View style={{ gap: 6 }}>
            <TextInput value={draft} onChangeText={t => { setDraft(t.replace(/\s/g, '')); setErr(null); }} placeholder="Endereço Lunes (SS58)" placeholderTextColor={c.ink3}
              accessibilityLabel="Endereço da sua carteira Lunes" autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60}
              style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: err ? c.ink : c.line2, color: c.ink, fontSize: 14, fontFamily: fontFamily(400, true) }} />
            {err && <T size={12.5} lh={1.4} color={c.ink} accessibilityLiveRegion="polite">{err}</T>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {lunesAddress && <Button label="Cancelar" variant="outline" height={48} style={{ flex: 1 }} onPress={() => { setEditing(false); setDraft(lunesAddress); setErr(null); }} />}
            <Button label="Salvar endereço" height={48} style={{ flex: 1 }} disabled={!draft} onPress={save} />
          </View>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <QrCode value={lunesAddress} size={208} label="QR do seu endereço Lunes" />
            <T size={13} mono lh={1.45} align="center" selectable>{lunesAddress}</T>
          </View>
          {snap && (
            <T size={12.5} lh={1.4} color={c.ink2} align="center">{`${formatLunes(BigInt(snap.free))} LUNES · bloco ${blockLabel(snap.block)} · ${whenLabel(snap.at, Date.now())}`}</T>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Copiar" height={48} style={{ flex: 1 }} onPress={copy} left={<Icon name="content_copy" size={18} color={c.invink} />} />
            <Button label="Explorador" variant="outline" height={48} style={{ flex: 1 }} onPress={() => { void Linking.openURL(LUNES_EXPLORER).catch(() => {}); }} left={<Icon name="public" size={18} />} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Trocar endereço" variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setDraft(lunesAddress); setEditing(true); }} />
            <Button label="Remover" variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setLunesAddress(null); setDraft(''); setEditing(true); }} />
          </View>
          <Button label="Ler saldo agora" variant="soft" height={44} fontSize={14} onPress={() => { void refreshOnchain(); }} />
        </>
      )}
      <T size={12.5} lh={1.4} color={c.ink2}>Este endereço não fica ligado às suas identidades de conversa e não é enviado a ninguém pela malha: só o nó da Lunes consultado vê qual saldo foi pedido.</T>
    </Sheet>
  );
}

function Pending({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
      <Icon name={icon} size={24} w={300} />
      <View style={{ flex: 1, gap: 3 }}>
        <T size={15} w={600}>{title}</T>
        <T size={13} lh={1.45} color={c.ink2}>{body}</T>
      </View>
    </View>
  );
}
