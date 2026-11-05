import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { Chat } from '../data/types';
import { fmtDate, useT } from '../i18n';
import { formatLunes, isHash } from '../lib/lunesRpc';
import { MAX_PAY_DESC, parseLunesAmount } from '../lib/paymentRequest';
import type { PayRecord } from '../state/messaging';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

const shortAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/**
 * Criar um pedido de pagamento (regra 7.3): valor em LUNES (opcional), descrição até 80 caracteres e
 * o endereço salvo na Carteira. Sem endereço salvo, manda salvar primeiro: o pedido leva o endereço
 * de quem pede, e o Piu não cria chave Lunes.
 */
export function PayRequestSheet({ address, toName, onSend, onClose }: { address: string | null; toName: string; onSend: (input: { amount: string; desc: string }) => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sheet = useRef<SheetHandle>(null);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const planck = amount.trim() ? parseLunesAmount(amount) : null;
  const amountBad = !!amount.trim() && planck == null;
  const descLen = [...desc].length;
  const canSend = !!address && !amountBad && (planck != null || desc.trim().length > 0);
  const input = { borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink, fontSize: 15 } as const;
  return (
    <Sheet ref={sheet} onClose={onClose} label={t('payReq.title')} gap={12}>
      <View style={{ gap: 6 }}>
        <T size={20} w={700} ls={-0.03} accessibilityRole="header">{t('payReq.title')}</T>
        <T size={13} lh={1.4} color={c.ink2}>{t('payReq.intro', { name: toName })}</T>
      </View>
      {address ? (
        <>
          <TextInput value={amount} onChangeText={v => setAmount(v.replace(/[^\d.,\s]/g, '').slice(0, 24))} placeholder={t('payReq.amount.placeholder')} placeholderTextColor={c.ink3}
            accessibilityLabel={t('payReq.amount.a11y')} keyboardType="decimal-pad" autoCorrect={false}
            style={{ ...input, height: 50, fontFamily: fontFamily(500, true), borderWidth: amountBad ? 1 : 0, borderColor: c.ink }} />
          <TextInput value={desc} onChangeText={v => setDesc([...v].slice(0, MAX_PAY_DESC).join(''))} placeholder={t('payReq.desc.placeholder')} placeholderTextColor={c.ink3}
            accessibilityLabel={t('payReq.desc.a11y')} maxLength={MAX_PAY_DESC * 2} style={{ ...input, height: 48, fontFamily: fontFamily(400) }} />
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 }}>
            <Icon name={amountBad ? 'error' : 'account_balance_wallet'} size={16} color={c.ink2} />
            <T size={12.5} mono color={c.ink2} style={{ flex: 1 }}>{amountBad ? t('payReq.amount.bad') : `${planck != null ? `${formatLunes(planck)} LUNES · ` : `${t('payReq.noFixed')} · `}${descLen}/${MAX_PAY_DESC} · ${shortAddr(address)}`}</T>
          </View>
          <Button label={t('payReq.send')} disabled={!canSend} onPress={() => { if (canSend) sheet.current?.close(() => onSend({ amount, desc })); }} />
        </>
      ) : (
        <>
          <View style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
            <Icon name="key_off" size={24} w={300} />
            <View style={{ flex: 1, gap: 3 }}>
              <T size={15} w={600}>{t('payReq.saveFirst')}</T>
              <T size={13} lh={1.45} color={c.ink2}>{t('payReq.saveFirst.body')}</T>
            </View>
          </View>
          <Button label={t('payReq.openWallet')} variant="outline" height={48} onPress={() => sheet.current?.close(() => router.push('/(tabs)/wallet'))} />
        </>
      )}
    </Sheet>
  );
}

/** "Já paguei": hash da transação e do bloco (opcionais, 0x + 64 hex). Com os dois, quem pediu confere a transação dentro do bloco. */
export function PaidSheet({ onSend, onClose }: { onSend: (proof: { txHash?: string; blockHash?: string }) => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sheet = useRef<SheetHandle>(null);
  const [tx, setTx] = useState('');
  const [block, setBlock] = useState('');
  const txOk = !tx.trim() || isHash(tx.trim());
  const blockOk = !block.trim() || isHash(block.trim());
  const input = { height: 48, borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink, fontSize: 13, fontFamily: fontFamily(400, true) } as const;
  const paste = (set: (v: string) => void) => () => { void Clipboard.getStringAsync().then(t => { if (t) set(t.trim().slice(0, 80)); }).catch(() => {}); };
  return (
    <Sheet ref={sheet} onClose={onClose} label={t('paid.title')} gap={12}>
      <View style={{ gap: 6 }}>
        <T size={20} w={700} ls={-0.03} accessibilityRole="header">{t('paid.title')}</T>
        <T size={13} lh={1.4} color={c.ink2}>{t('paid.intro')}</T>
      </View>
      {([[t('paid.txHash'), tx, setTx, txOk], [t('paid.blockHash'), block, setBlock, blockOk]] as const).map(([label, v, set, ok]) => (
        <View key={label} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput value={v} onChangeText={x => set(x.replace(/\s/g, ''))} placeholder={label} placeholderTextColor={c.ink3} accessibilityLabel={label} autoCapitalize="none" autoCorrect={false}
            style={{ ...input, flex: 1, minWidth: 0, borderWidth: ok ? 0 : 1, borderColor: c.ink }} />
          <Pressable onPress={paste(set)} accessibilityRole="button" accessibilityLabel={t('paid.paste.a11y', { label })}
            style={{ height: 48, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
            <Icon name="content_copy" size={17} />
          </Pressable>
        </View>
      ))}
      {(!txOk || !blockOk) && <T size={12.5} color={c.ink} accessibilityLiveRegion="polite">{t('paid.badHash')}</T>}
      <Button label={t('paid.send')} disabled={!txOk || !blockOk} onPress={() => sheet.current?.close(() => onSend({ ...(tx.trim() ? { txHash: tx.trim() } : {}), ...(block.trim() ? { blockHash: block.trim() } : {}) }))} />
    </Sheet>
  );
}

/** Escolher a conversa para um pedido (Carteira → Receber → "Pedir a um contato"). Só conversas com uma pessoa, já aceitas. */
export function ContactPickerSheet({ chats, onPick, onClose }: { chats: Chat[]; onPick: (chat: Chat) => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sheet = useRef<SheetHandle>(null);
  const list = chats.filter(ch => ch.peer && !ch.request);
  return (
    <Sheet ref={sheet} onClose={onClose} label={t('wallet.receiveSheet.askContact')} padH={12} gap={4}>
      <T size={20} w={700} ls={-0.03} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 }} accessibilityRole="header">{t('wallet.receiveSheet.askContact')}</T>
      {list.length === 0 && <T size={13.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 10, paddingBottom: 8 }}>{t('picker.empty')}</T>}
      {list.map(ch => (
        <Pressable key={ch.id} onPress={() => sheet.current?.close(() => onPick(ch))} accessibilityRole="button" accessibilityLabel={t('picker.askTo', { name: ch.name })}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
          <Avatar initials={ch.initials} size={40} inverted={ch.inv} photo={ch.photo} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={15.5} w={550} numberOfLines={1}>{ch.name}</T>
            <T size={12.5} color={c.ink2} numberOfLines={1}>{ch.ident === 'anon' ? t('referrals.anonIdentity') : t('picker.e2e')}</T>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

/**
 * Balão do pedido. Recebido (`rec.dir === 'in'`): endereço com Copiar, QR e "Já paguei". Meu
 * (`out`): estado (aguardando / contato avisou / última conferência) e "Conferir na Mainnet".
 * Nada aqui marca "recebido" sem a conferência real.
 */
export function PayBubble({ rec, inverse, now, checking, onCopied, onPaid, onCheck }: { rec: PayRecord; inverse: boolean; now: number; checking?: boolean; onCopied: () => void; onPaid?: () => void; onCheck?: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const fg = inverse ? c.invink : c.ink;
  const expired = rec.expiresAt * 1000 <= now;
  const amount = rec.planck != null ? `${formatLunes(BigInt(rec.planck))} LUNES` : t('payReq.noFixed');
  const copy = () => { void Clipboard.setStringAsync(rec.address).then(onCopied).catch(() => {}); };
  const chip = { height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 } as const;
  const status = rec.dir === 'in'
    ? rec.paid ? t('payBubble.youPaid', { date: fmtDate(rec.paid.at, { dateStyle: 'short' }) }) : expired ? t('payBubble.expired7') : t('payBubble.payWithWallet')
    : rec.check ? `${rec.check.text} (${t('wallet.block')} #${rec.check.block})`
      : rec.paid ? t('payBubble.contactPaid')
        : expired ? t('payBubble.expiredCheck') : t('payBubble.awaiting');
  const statusIcon = rec.dir === 'out' && rec.check?.state === 'recebido' ? 'verified' : rec.dir === 'out' && rec.paid && !rec.check ? 'pending' : expired ? 'schedule' : rec.dir === 'in' && rec.paid ? 'task_alt' : 'hourglass_top';
  return (
    <View style={{ width: 236, gap: 9, paddingTop: 4, paddingBottom: 2 }} accessibilityLabel={`${t('chat.pay.request')}, ${amount}${rec.desc ? `, ${rec.desc}` : ''}. ${status}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="account_balance_wallet" size={21} color={inverse ? c.ink : c.invink} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={12} w={600} color={fg} style={{ opacity: 0.8 }}>{t('chat.pay.request')}</T>
          <T size={15} w={650} color={fg} tabular numberOfLines={1}>{amount}</T>
        </View>
      </View>
      {!!rec.desc && <T size={14} lh={1.35} color={fg}>{rec.desc}</T>}
      {rec.dir === 'in' && !expired && (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <QrCode value={rec.address} size={132} radius={10} label={t('payBubble.qr')} />
        </View>
      )}
      <T size={11} mono lh={1.4} color={fg} selectable style={{ opacity: 0.85 }}>{rec.address}</T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Icon name={statusIcon} size={15} color={fg} style={{ opacity: 0.85, marginTop: 1 }} />
        <T size={11.5} lh={1.3} color={fg} style={{ flex: 1, opacity: 0.85 }} accessibilityLiveRegion="polite">{status}</T>
      </View>
      {rec.dir === 'in' && <T size={11} lh={1.3} color={fg} style={{ opacity: 0.7 }}>{t('payBubble.note')}</T>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel={t('payBubble.copy.a11y')} style={chip}>
          <Icon name="content_copy" size={13} color={fg} />
          <T size={11.5} w={600} color={fg}>{t('common.copy')}</T>
        </Pressable>
        {rec.dir === 'in' && !rec.paid && !expired && onPaid && (
          <Pressable onPress={onPaid} accessibilityRole="button" accessibilityLabel={t('payBubble.paid.a11y')} style={chip}>
            <Icon name="task_alt" size={13} color={fg} />
            <T size={11.5} w={600} color={fg}>{t('payBubble.paid')}</T>
          </Pressable>
        )}
        {rec.dir === 'out' && onCheck && rec.check?.state !== 'recebido' && (
          <Pressable onPress={onCheck} disabled={checking} accessibilityRole="button" accessibilityLabel={t('payBubble.check.a11y')} accessibilityState={{ disabled: !!checking }} style={{ ...chip, opacity: checking ? 0.6 : 1 }}>
            <Icon name="public" size={13} color={fg} />
            <T size={11.5} w={600} color={fg}>{checking ? t('payBubble.checking') : t('payBubble.check')}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}
