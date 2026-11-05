import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import type { Chat } from '../data/types';
import { useT } from '../i18n';
import { formatLunes, LUNES_EXPLORER } from '../lib/lunesRpc';
import { blockLabel, whenLabel } from '../lib/walletCore';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { ContactPickerSheet, PayRequestSheet } from './PaymentRequest';
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
  const t = useT();
  const { lunesAddress, onchainSnap } = useWallet();
  const snap = onchainSnap && onchainSnap.address === lunesAddress ? onchainSnap : null;
  return (
    <Sheet onClose={onClose} label={t('wallet.sendSheet.title')}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.sendSheet.title')}</T>
      <Pending icon="key_off" title={t('wallet.sendSheet.pendingTitle')} body={t('wallet.sendSheet.pendingBody')} />
      <View style={{ borderRadius: 18, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
        {[
          [t('wallet.sendSheet.mainnetBalance'), snap ? `${formatLunes(BigInt(snap.free))} LUNES` : lunesAddress ? t('wallet.sendSheet.notRead') : t('wallet.sendSheet.noAddress')],
          [t('wallet.sendSheet.creditsPayment'), t('wallet.awaitingSettlement')],
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
  const t = useT();
  const { showToast, chats } = useStore();
  const { payments } = useMessaging();
  const { lunesAddress, setLunesAddress, onchainSnap, refreshOnchain } = useWallet();
  const [editing, setEditing] = useState(!lunesAddress);
  const [draft, setDraft] = useState(lunesAddress ?? '');
  const [err, setErr] = useState<string | null>(null);
  // "Pedir a um contato" (regra 7.3): escolhe a conversa, monta o pedido e abre a conversa com o balão.
  const [ask, setAsk] = useState<'pick' | Chat | null>(null);
  const snap = onchainSnap && onchainSnap.address === lunesAddress ? onchainSnap : null;
  const sendAsk = (chat: Chat, input: { amount: string; desc: string }) => {
    try {
      payments.send(chat.id, input);
      onClose();
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch (e) { showToast({ icon: 'error', title: t('wallet.ask.fail'), body: e instanceof Error ? e.message : t('common.tryAgain') }); }
  };

  const save = () => {
    const e = setLunesAddress(draft);
    setErr(e);
    if (e) return;
    setEditing(false);
    showToast({ icon: 'check_circle', title: t('wallet.addressSaved'), body: t('wallet.addressSaved.body') });
    // O estado do endereço muda no próximo render; a carteira lê de novo quando o endereço muda.
  };
  const copy = () => {
    if (!lunesAddress) return;
    void Clipboard.setStringAsync(lunesAddress).then(() => showToast({ icon: 'content_copy', title: t('wallet.addressCopied'), body: lunesAddress })).catch(() => {});
  };

  return (
    <Sheet onClose={onClose} label={t('wallet.receiveSheet.title')}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.receiveSheet.title')}</T>
      {editing || !lunesAddress ? (
        <>
          <T size={13.5} lh={1.45} color={c.ink2}>{t('wallet.receiveSheet.paste')}</T>
          <View style={{ gap: 6 }}>
            <TextInput value={draft} onChangeText={v => { setDraft(v.replace(/\s/g, '')); setErr(null); }} placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3}
              accessibilityLabel={t('wallet.receiveSheet.input.a11y')} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60}
              style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: err ? c.ink : c.line2, color: c.ink, fontSize: 14, fontFamily: fontFamily(400, true) }} />
            {err && <T size={12.5} lh={1.4} color={c.ink} accessibilityLiveRegion="polite">{err}</T>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {lunesAddress && <Button label={t('common.cancel')} variant="outline" height={48} style={{ flex: 1 }} onPress={() => { setEditing(false); setDraft(lunesAddress); setErr(null); }} />}
            <Button label={t('wallet.receiveSheet.save')} height={48} style={{ flex: 1 }} disabled={!draft} onPress={save} />
          </View>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <QrCode value={lunesAddress} size={208} label={t('wallet.receiveSheet.qr')} />
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2 }}>
              <T size={13} w={500} mono lh={1.45} selectable style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>{lunesAddress}</T>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.copy')} accessibilityValue={{ text: lunesAddress }} onPress={copy}
                style={({ pressed }) => ({ width: 44, height: 44, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.bg3 : 'transparent' })}>
                <Icon name="content_copy" size={18} />
              </Pressable>
            </View>
          </View>
          {snap && (
            <T size={12.5} lh={1.4} color={c.ink2} align="center">{`${formatLunes(BigInt(snap.free))} LUNES · ${t('wallet.block')} ${blockLabel(snap.block)} · ${whenLabel(snap.at, Date.now())}`}</T>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t('common.copy')} height={48} style={{ flex: 1 }} onPress={copy} left={<Icon name="content_copy" size={18} color={c.invink} />} />
            <Button label={t('wallet.explorer')} variant="outline" height={48} style={{ flex: 1 }} onPress={() => { void Linking.openURL(LUNES_EXPLORER).catch(() => {}); }} left={<Icon name="public" size={18} />} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t('wallet.receiveSheet.change')} variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setDraft(lunesAddress); setEditing(true); }} />
            <Button label={t('common.remove')} variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setLunesAddress(null); setDraft(''); setEditing(true); }} />
          </View>
          <Button label={t('wallet.receiveSheet.readNow')} variant="soft" height={44} fontSize={14} onPress={() => { void refreshOnchain(); }} />
          <Button label={t('wallet.receiveSheet.askContact')} variant="outline" height={48} onPress={() => setAsk('pick')} left={<Icon name="account_balance_wallet" size={18} />} />
        </>
      )}
      <T size={12.5} lh={1.4} color={c.ink2}>{t('wallet.receiveSheet.note')}</T>
      {ask === 'pick' && <ContactPickerSheet chats={chats} onClose={() => setAsk(null)} onPick={ch => setAsk(ch)} />}
      {ask && ask !== 'pick' && <PayRequestSheet address={lunesAddress} toName={ask.name} onClose={() => setAsk(null)} onSend={input => sendAsk(ask, input)} />}
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
