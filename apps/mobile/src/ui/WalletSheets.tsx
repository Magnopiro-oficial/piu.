import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Linking, Platform, Pressable, TextInput, View } from 'react-native';
import type { Chat } from '../data/types';
import { useT } from '../i18n';
import { carryBridge } from '../lib/carryBridge';
import { meshModeOf } from '../lib/carryView';
import { OFFLINE_CONTEXT_MAX_AGE_MS } from '../lib/walletCarry';
import { CREDIT_PARAMS } from '../messaging/credits';
import { CodeReader } from '../lib/migrationUi';
import { formatLunes, LUNES_EXPLORER, planckToLunes } from '../lib/lunesRpc';
import { decodeSs58 } from '../lib/ss58';
import { blockLabel, lunes2, walletSummary, whenLabel } from '../lib/walletCore';
import { DEFAULT_AMOUNT, OTHER_ID, QUICK_AMOUNTS, QUOTE_DEBOUNCE_MS, addressTrust, amountState, contactAddresses, groupAddress, needsAddressAck, parseWalletQr, receiveAddressLabel, recipientsFrom, sanitizeAmount, type Recipient } from '../lib/walletSend';
import { WalletTransferError, type WalletQuote, type WalletTransferRecord } from '../lib/walletTransfer';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { ContactPickerSheet, PayRequestSheet } from './PaymentRequest';
import { InTransitCard, MeshBanner } from './NodeViews';
import { PnButton, StateCard } from './PhoneNode';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { HoldToSign } from './HoldToSign';
import { Icon, type IconName } from './Icon';
import { PayScene, type PayResult } from './PayScene';
import { QrWave } from './QrWave';
import { T } from './T';
import { TransferSheet } from './ownWallet/TransferSheet';

const NO_TOTALS = { pendente: 0, validado: 0, em_lote: 0, rejeitado: 0, pago: 0 };

/**
 * Folha Enviar (design §2): destinatários em círculos, valor grande com chips 1/5/10, resumo e o botão
 * "Segure para assinar e enviar" na própria folha. Tudo com dados reais da Lunes Mainnet:
 * - destinatários: contatos que já mandaram pedido de pagamento com o endereço deles, mais "Outro"
 *   (endereço digitado ou lido pelo QR de outra carteira); o endereço do contato escolhido aparece ao lado
 *   do nome, e se for diferente do último envio concluído para ele a folha avisa e pede confirmação;
 * - a cotação (`quoteTransfer`: taxa e disponível) é pedida em segundo plano, com debounce, assim que
 *   destino e valor valem, para o resumo e o botão ficarem na folha sem o passo "estimar";
 * - o gesto abre a cena de pagamento, que chama o mesmo `sendTransfer` (biometria → sr25519 → nó Lunes)
 *   e só diz "entregue" com resultado real. `onSent` avisa a carteira para animar o saldo.
 */
export function SendSheet({ onClose, onSent, toChatId }: { onClose: () => void; onSent?: (record: WalletTransferRecord) => void;
  /** Conversa de origem (botão de pagar numa conversa): o contato dela já vem selecionado, se tiver endereço. */
  toChatId?: string }) {
  const { c } = useTheme();
  const t = useT();
  const { chats } = useStore();
  const { payments, walletContacts, confirmedWallets, confirmWallet } = useMessaging();
  const { canSign, nativeWalletReady, useOwnWallet, quoteTransfer, sendTransfer, pendingTransfer, transferRecoveryBlocked, refreshTransfer, retryTransfer, onchain, reserved, lunesAddress, onchainSnap, onchainStatus, offlineContext, transferInTransit } = useWallet();
  // Contatos com endereço Lunes conhecido: o que o contato compartilhou (payload `wa`) manda; senão o do último
  // pedido de pagamento que ele mandou. Até 3, mais "Outro" (4 círculos, como no design); vindo de uma conversa,
  // aquele contato entra primeiro. Nada inventado.
  const recipients = useMemo(() => {
    const addresses = contactAddresses(chats, payments.all());
    for (const w of walletContacts()) if (decodeSs58(w.address).ok) addresses.set(w.chatId, w.address);
    return recipientsFrom(chats, addresses, toChatId);
  }, [chats, payments.epoch, walletContacts, toChatId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [to, setTo] = useState(toChatId && recipients.some(r => r.id === toChatId) ? toChatId : recipients[0]!.id);
  const [other, setOther] = useState('');
  const [scanning, setScanning] = useState(false);
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [quote, setQuote] = useState<WalletQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [scene, setScene] = useState<{ dest: string; amount: string; quote: WalletQuote | null; chatId: string | null } | null>(null);
  // Endereço novo de um contato que a pessoa aceitou usar nesta folha (aviso "o endereço deste contato mudou").
  const [acked, setAcked] = useState<string | null>(null);
  // A folha some por baixo da íris (design: 760 ms) e volta só se a cena terminar em erro.
  const [covered, setCovered] = useState(false);
  const [record, setRecord] = useState<WalletTransferRecord | null>(pendingTransfer);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'refreshing'>('idle');
  const working = useRef(false);
  const busy = phase !== 'idle';
  useEffect(() => { if (pendingTransfer) setRecord(pendingTransfer); }, [pendingTransfer]);
  const active = record && ['signed', 'submitted', 'included'].includes(record.status);
  // Piu 11 (N8/N8a/N9d): sem leitura da Mainnet agora, o envio vai pela malha; com algo em trânsito, nada novo sai.
  const mesh = meshModeOf({ offline: onchainStatus.state === 'error', inTransit: transferInTransit, ctxAt: offlineContext?.at ?? null, now: Date.now(), bridge: carryBridge.available() });
  const meshOn = mesh.kind === 'mesh' || mesh.kind === 'noReading' || mesh.kind === 'stale' || mesh.kind === 'unavailable';

  const chosen = recipients.find(r => r.id === to) ?? recipients[recipients.length - 1]!;
  const dest = chosen.id === OTHER_ID ? other.trim() : chosen.address!;
  const destCheck = dest ? decodeSs58(dest) : null;
  const destOk = !!destCheck?.ok;
  // Contato escolhido: o endereço proposto agora contra o do último envio concluído para ele.
  const isContact = chosen.id !== OTHER_ID;
  const trust = isContact ? addressTrust(confirmedWallets[chosen.id], dest) : 'first';
  const mustAck = isContact && needsAddressAck(trust, acked, dest);
  // Saldo disponível para enviar: o da cotação (free − bloqueios − mínimo da conta) quando existe; antes, a leitura da Mainnet.
  const snap = onchainSnap && onchainSnap.address === lunesAddress ? onchainSnap : null;
  const available = meshOn && offlineContext ? planckToLunes(BigInt(offlineContext.available)) : quote ? planckToLunes(BigInt(quote.available)) : snap ? walletSummary({ onchain, totals: NO_TOTALS, reserved, perLunes: CREDIT_PARAMS.creditsPerLunes }).available : null;
  const amt = amountState(amount, available);

  // Cotação em segundo plano: 350 ms depois da última mudança de destino/valor válidos; respostas velhas são ignoradas.
  const quoteSeq = useRef(0);
  useEffect(() => {
    quoteSeq.current++;
    setQuote(null); setQuoteError(null); setQuoting(false);
    if (!canSign || !destOk || !amt.planck || active) return;
    const id = quoteSeq.current;
    const timer = setTimeout(() => {
      setQuoting(true);
      quoteTransfer(dest, amount)
        .then(q => { if (id === quoteSeq.current) setQuote(q); })
        .catch(e => { if (id === quoteSeq.current) setQuoteError(e instanceof Error ? e.message : t('ownWallet.error')); })
        .finally(() => { if (id === quoteSeq.current) setQuoting(false); });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dest, destOk, amount, canSign, active]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Mensagem para o erro do envio; `review_required` também devolve o resumo novo para revisar. */
  const describe = (e: unknown): string => {
    if (e instanceof WalletTransferError && e.code === 'review_required' && e.quote) { setQuote(e.quote); return t('ownWallet.reviewChanged'); }
    if (e instanceof WalletTransferError && e.code === 'cancelled') return t('ownWallet.cancelled');
    return e instanceof Error ? e.message : t('ownWallet.error');
  };
  const run = async (kind: typeof phase, fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setPhase(kind); setError(null); Keyboard.dismiss();
    try { await fn(); }
    catch (e) { setError(describe(e)); }
    finally { working.current = false; setPhase('idle'); }
  };
  /** Fim da cena: sucesso fecha a folha (a carteira anima o saldo); erro volta para a folha com a mensagem. */
  const sceneDone = (r: PayResult) => {
    setScene(null); setCovered(false);
    if (r.record) setRecord(r.record);
    if (r.record && !r.error) {
      // Envio concluído para um contato: esse endereço passa a ser o confirmado da conversa.
      if (scene?.chatId) confirmWallet(scene.chatId, scene.dest);
      setQuote(null); onSent?.(r.record); onClose(); return;
    }
    setError(r.error ?? t('ownWallet.error'));
  };
  /** Gesto completo: abre a cena já; se a cotação ainda não chegou, a cena a pede antes de assinar. */
  const sign = () => {
    if (working.current || !amt.ok || !destOk || mustAck) return;
    Keyboard.dismiss(); setError(null);
    setScene({ dest, amount, quote, chatId: isContact ? chosen.id : null });
  };
  const sceneSend = async () => {
    if (!scene) throw new Error(t('ownWallet.error'));
    const q = scene.quote ?? await quoteTransfer(scene.dest, scene.amount);
    return sendTransfer(q);
  };
  /** QR lido (câmera ou colado): endereço SS58, `lunes:` ou pedido de pagamento do app (traz o valor). */
  const readQr = (text: string): string | null => {
    const r = parseWalletQr(text, Math.floor(Date.now() / 1000));
    if (!r.ok) return r.error;
    setTo(OTHER_ID); setOther(r.address); if (r.amount) setAmount(r.amount);
    setScanning(false); setError(null);
    return null;
  };
  const pick = (r: Recipient) => { setTo(r.id); setError(null); if (r.id !== OTHER_ID) setScanning(false); };

  const value = (planck: string) => `${formatLunes(BigInt(planck))} LUNES`;
  const note = error ?? (meshOn ? null : quoteError) ?? (chosen.id === OTHER_ID && other.trim() && destCheck && !destCheck.ok ? destCheck.error : null) ?? (amt.over && available !== null ? t('wallet.sendSheet.over') : null);
  const fee = meshOn && offlineContext ? t('n11.n8.feeValue', { fee: formatLunes(BigInt(offlineContext.fee) * 2n) }) : quote ? `${formatLunes(BigInt(quote.fee))} LUNES` : quoting ? t('ownWallet.estimating') : '—';
  const meshFooter = !meshOn ? undefined
    : mesh.kind === 'mesh' ? <PnButton label={t('n11.n8.continue')} icon="hub" disabled={!amt.ok || !destOk || mustAck} onPress={() => { onClose(); router.push({ pathname: '/wallet/mesh', params: { dest, amount } }); }} />
    : mesh.kind === 'stale' ? <StateCard icon="wifi_off" solid title={t('n11.n8a.title')} body={t('n11.n8a.body', { max: OFFLINE_CONTEXT_MAX_AGE_MS / 86_400_000, count: mesh.days })} />
    : mesh.kind === 'noReading' ? <StateCard icon="wifi_off" solid title={t('n11.n8a.none')} body={t('n11.n8a.noneBody', { max: OFFLINE_CONTEXT_MAX_AGE_MS / 86_400_000 })} />
    : <T size={13} lh={1.45} color={c.ink2} align="center">{t('n11.n8.unavailable')}</T>;
  return (
    <TransferSheet onClose={onClose} label={t('wallet.sendSheet.title')} covered={covered}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.sendSheet.title')}</T>
      {transferRecoveryBlocked && <Pending icon="error" title={t('wallet.sendSheet.title')} body={t('ownWallet.recoveryError')} />}
      {!transferRecoveryBlocked && record?.carried && active && <InTransitCard onOpen={() => { onClose(); router.push('/wallet/transit'); }} />}
      {!transferRecoveryBlocked && record && !(record.carried && active) && (
        <View accessibilityLiveRegion="polite" style={{ padding: 16, backgroundColor: c.bg2, borderRadius: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name={record.status === 'finalized' ? 'check_circle' : record.status === 'failed' ? 'error' : 'schedule_send'} size={24} />
            <T size={16} w={650} style={{ flex: 1 }}>{t(`ownWallet.status.${record.status}`)}</T>
          </View>
          <AddressLine label={t('ownWallet.from')} address={record.from} />
          <AddressLine label={t('ownWallet.to')} address={record.dest} />
          <T size={18} w={650} tabular>{value(record.value)}</T>
          <AddressLine label={t('ownWallet.hash')} address={record.hash} />
          {active && <T size={13} lh={1.45} color={c.ink2}>{t('ownWallet.pendingNote')}</T>}
          {!!record.error && <T size={13} lh={1.45}>{record.error}</T>}
          <Button label={t('wallet.explorer')} variant="outline" height={46} onPress={() => { void Linking.openURL(record.block ? `${LUNES_EXPLORER}block/${record.block.number}` : LUNES_EXPLORER).catch(() => {}); }} />
          {active && <Button label={t('ownWallet.refresh')} variant="soft" height={46} disabled={busy} onPress={() => { void run('refreshing', refreshTransfer); }} />}
          {record.status === 'signed' && retryTransfer && <Button label={t('ownWallet.retry')} variant="outline" height={46} disabled={busy} onPress={() => { void run('sending', async () => { setRecord(await retryTransfer()); }); }} />}
          {!active && <Button label={t('common.close')} variant="soft" height={46} onPress={onClose} />}
          {!active && <Button label={t('wallet.send')} variant="outline" height={46} onPress={() => { setRecord(null); setQuote(null); setError(null); }} />}
        </View>
      )}
      {!transferRecoveryBlocked && !active && !record && (!nativeWalletReady ? (
        <Pending icon="key_off" title={t('ownWallet.unavailableTitle')} body={t('ownWallet.unavailableNote')} />
      ) : !canSign ? (
        <>
          <Pending icon="visibility" title={t('ownWallet.watchTitle')} body={t('ownWallet.watchNote')} />
          <Button label={t('ownWallet.useOwn')} onPress={useOwnWallet} />
        </>
      ) : (
        <>{meshOn && <MeshBanner />}<SendForm recipients={recipients} to={chosen.id} onPick={pick} other={other} onOther={v => { setOther(v.replace(/\s/g, '')); setError(null); }}
          scanning={scanning} onScan={() => setScanning(s => !s)}
          contact={isContact ? { name: chosen.name, address: dest, was: mustAck ? confirmedWallets[chosen.id]! : null, onConfirm: () => setAcked(dest) } : null}
          reader={scanning ? <CodeReader hint={t('wallet.sendSheet.scan.hint')} placeholder={t('wallet.sendSheet.scan.placeholder')} onRead={readQr} /> : null}
          amount={amount} onAmount={v => { setAmount(sanitizeAmount(v)); setError(null); }}
          available={available === null ? '—' : `${lunes2(available)} LUNES`} fee={fee} note={note}
          holdDisabled={busy || !amt.ok || !destOk || !!quoteError || mustAck} onSign={sign} footer={meshFooter} /></>
      ))}
      {!!error && (active || record || !canSign) && <T size={13} lh={1.45} accessibilityLiveRegion="polite">{error}</T>}
      {scene && (
        <PayScene amount={formatLunes(amt.planck ?? 0n)} fee={scene.quote ? formatLunes(BigInt(scene.quote.fee)) : null} to={scene.dest}
          toName={chosen.id === OTHER_ID ? undefined : chosen.first} toInitials={chosen.id === OTHER_ID ? undefined : chosen.initials}
          send={sceneSend} describeError={describe} onCover={setCovered} onFinish={sceneDone} />
      )}
    </TransferSheet>
  );
}

/**
 * Corpo da folha Enviar, só apresentação (o design §2 com os dados que o `SendSheet` passa):
 * destinatários (62 px cada, círculo 52 com borda 1,5 `ink`; selecionado invertido e nome 650),
 * valor 56/650 centralizado, chips 1/5/10 LUNES (32 px, raio 16, `bg2`), resumo (`bg2`, raio 18,
 * 14/16, 13 px) e o botão de segurar com a dica abaixo (onde também aparecem os avisos).
 */
export function SendForm({ recipients, to, onPick, other, onOther, scanning, onScan, reader, contact, amount, onAmount, available, fee, note, holdDisabled, onSign, footer }: {
  recipients: Recipient[]; to: string; onPick: (r: Recipient) => void;
  other: string; onOther: (v: string) => void; scanning: boolean; onScan: () => void; reader: ReactNode;
  /** Contato escolhido: o endereço dele ao lado do nome. `was` = endereço do último envio concluído, quando o de agora é outro e ainda falta confirmar. */
  contact?: { name: string; address: string; was: string | null; onConfirm: () => void } | null;
  amount: string; onAmount: (v: string) => void; available: string; fee: string; note: string | null;
  holdDisabled: boolean; onSign: () => void;
  /** Sem rede (Piu 11 N8/N8a): no lugar do botão de segurar, "Continuar sem internet" ou o aviso. */
  footer?: ReactNode;
}) {
  const { c } = useTheme();
  const t = useT();
  const otherOn = to === OTHER_ID;
  const field = { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: c.line2, backgroundColor: c.bg2, paddingHorizontal: 16, paddingVertical: 12, color: c.ink, fontSize: 13, fontFamily: fontFamily(400, true) } as const;
  const onlyOther = recipients.length === 1;
  return (
    <>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('wallet.sendSheet.recipients.a11y')} style={{ flexDirection: 'row', gap: 14 }}>
        {recipients.map(r => {
          const on = r.id === to, isOther = r.id === OTHER_ID;
          return (
            <Pressable key={r.id} onPress={() => onPick(r)} accessibilityRole="radio" accessibilityState={{ checked: on }}
              accessibilityLabel={isOther ? t('wallet.sendSheet.otherPick.a11y') : t('wallet.sendSheet.pick.a11y', { name: r.name })}
              style={({ pressed }) => ({ width: 62, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: c.ink, backgroundColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {isOther ? <Icon name="more_horiz" size={24} w={300} color={on ? c.invink : c.ink} /> : <T size={15} w={600} color={on ? c.invink : c.ink}>{r.initials}</T>}
              </View>
              <T size={12} w={on ? 650 : 450} numberOfLines={1}>{isOther ? t('wallet.sendSheet.other') : r.first}</T>
            </Pressable>
          );
        })}
      </View>
      {onlyOther && <T size={12.5} lh={1.4} color={c.ink2} style={{ marginTop: -8 }}>{t('wallet.sendSheet.noContacts')}</T>}
      {!!contact && (
        <View style={{ gap: 4, marginTop: -6 }}>
          <T size={13} w={600}>{contact.name}</T>
          <T size={12.5} lh={1.5} mono selectable accessibilityLabel={t('wallet.sendSheet.contactAddr.a11y', { name: contact.name, address: contact.address })}>{groupAddress(contact.address)}</T>
        </View>
      )}
      {!!contact?.was && (
        <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name="error" size={24} w={300} />
            <T size={15} w={650} style={{ flex: 1 }}>{t('wallet.sendSheet.addrChanged.title')}</T>
          </View>
          <T size={13} lh={1.45} color={c.ink2}>{t('wallet.sendSheet.addrChanged.body', { name: contact.name })}</T>
          <AddressLine label={t('wallet.sendSheet.addrChanged.before')} address={groupAddress(contact.was)} />
          <AddressLine label={t('wallet.sendSheet.addrChanged.now')} address={groupAddress(contact.address)} />
          <Button label={t('wallet.sendSheet.addrChanged.confirm')} variant="outline" height={46} onPress={contact.onConfirm} />
        </View>
      )}
      {otherOn && (
        <View style={{ gap: 10, marginTop: -6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={other} onChangeText={onOther} placeholder={t('ownWallet.destination')} placeholderTextColor={c.ink3} accessibilityLabel={t('ownWallet.destination')}
              autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60} style={{ ...field, flex: 1, minWidth: 0 }} />
            <Pressable onPress={onScan} accessibilityRole="button" accessibilityLabel={t('wallet.sendSheet.scan.a11y')} accessibilityState={{ expanded: scanning }}
              style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 16, backgroundColor: scanning ? c.ink : c.bg2, borderWidth: 1, borderColor: scanning ? c.ink : c.line2, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <Icon name="qr_code_scanner" size={24} w={300} color={scanning ? c.invink : c.ink} />
            </Pressable>
          </View>
          {reader}
        </View>
      )}
      <View style={{ alignItems: 'center', gap: 2, paddingVertical: 6 }}>
        {/* Design: input de 75 px de altura (fonte 56, entrelinha normal) e `outline:none` (sem anel de foco no navegador). */}
        <TextInput value={amount} onChangeText={onAmount} accessibilityLabel={t('ownWallet.amount')} placeholder="0" placeholderTextColor={c.ink3}
          keyboardType="decimal-pad" inputMode="decimal" autoCorrect={false} maxLength={24}
          style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: 56, height: 75, lineHeight: 75, fontFamily: fontFamily(650), color: c.ink, letterSpacing: -0.055 * 56, fontVariant: ['tabular-nums'], padding: 0,
            ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) }} />
        <T size={14} w={600} color={c.ink2}>LUNES</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        {QUICK_AMOUNTS.map(n => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} LUNES`} onPress={() => onAmount(String(n))}
            style={({ pressed }) => ({ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.bg2, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <T size={13.5} w={550}>{`${n} LUNES`}</T>
          </Pressable>
        ))}
      </View>
      <View style={{ borderRadius: 18, backgroundColor: c.bg2, paddingVertical: 14, paddingHorizontal: 16, gap: 10 }}>
        {([[t('wallet.sendSheet.available'), available], [t('ownWallet.fee'), fee], [t('pay.row.settle'), t('wallet.sendSheet.settleValue')]] as const).map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <T size={13} color={c.ink2}>{k}</T>
            <T size={13} w={550} tabular align="right" style={{ flex: 1 }}>{v}</T>
          </View>
        ))}
      </View>
      {/* Aviso real (saldo, endereço, cotação, envio) na linha de dica do botão, como "Continue segurando…" no design. */}
      {footer ?? <HoldToSign disabled={holdDisabled} onSign={onSign} note={note} />}
    </>
  );
}

function AddressLine({ label, address }: { label: string; address: string }) {
  const { c } = useTheme();
  return <View style={{ gap: 5 }}><T size={12.5} color={c.ink2}>{label}</T><T size={12.5} lh={1.5} mono selectable>{address}</T></View>;
}

/**
 * Folha Receber (design §4): QR em onda com linha de leitura e ícone, "toque no código para gerar outro",
 * endereço com copiar, uma linha de ação e a nota. Endereço próprio do cofre nativo ou endereço externo
 * escolhido explicitamente para consulta. Por honestidade, a linha "Receber de alguém por perto" do
 * protótipo (pagamento assinado sem internet, que não existe) virou "Pedir a um contato": o pedido de
 * pagamento cifrado na conversa, que existe de verdade.
 */
export function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast, chats } = useStore();
  const { payments } = useMessaging();
  const { lunesAddress, ownAddress, canSign, nativeWalletReady, useOwnWallet, setLunesAddress, onchainSnap, refreshOnchain } = useWallet();
  const address = lunesAddress ?? (nativeWalletReady ? ownAddress : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lunesAddress ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // "Pedir a um contato" (regra 7.3): escolhe a conversa, monta o pedido e abre a conversa com o balão.
  const [ask, setAsk] = useState<'pick' | Chat | null>(null);
  const snap = onchainSnap && onchainSnap.address === address ? onchainSnap : null;
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
    if (!address) return;
    void Clipboard.setStringAsync(address).then(() => showToast({ icon: 'content_copy', title: t('wallet.addressCopied'), body: address })).catch(() => {});
  };

  return (
    <TransferSheet onClose={onClose} label={t('wallet.receiveSheet.title')}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.receiveSheet.title')}</T>
      {/* Estado da carteira só quando há algo a decidir (consulta de endereço externo ou cofre indisponível). */}
      {!canSign && <Pending icon="visibility" title={t(address ? 'ownWallet.watchTitle' : 'ownWallet.unavailableTitle')} body={t(address ? 'ownWallet.watchNote' : 'ownWallet.unavailableNote')} />}
      {address && !nativeWalletReady && <T size={12.5} lh={1.45} color={c.ink2}>{t('ownWallet.unavailableNote')}</T>}
      {!canSign && nativeWalletReady && ownAddress && <Button label={t('ownWallet.useOwn')} onPress={() => { useOwnWallet(); setEditing(false); setErr(null); }} />}
      {editing || !address ? (
        <>
          <T size={13.5} lh={1.45} color={c.ink2}>{t('ownWallet.watchPaste')}</T>
          <View style={{ gap: 6 }}>
            <TextInput value={draft} onChangeText={v => { setDraft(v.replace(/\s/g, '')); setErr(null); }} placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3}
              accessibilityLabel={t('wallet.receiveSheet.input.a11y')} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60}
              style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: err ? c.ink : c.line2, color: c.ink, fontSize: 14, fontFamily: fontFamily(400, true) }} />
            {err && <T size={12.5} lh={1.4} color={c.ink} accessibilityLiveRegion="polite">{err}</T>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {address && <Button label={t('common.cancel')} variant="outline" height={48} style={{ flex: 1 }} onPress={() => { setEditing(false); setDraft(address); setErr(null); }} />}
            <Button label={t('wallet.receiveSheet.save')} height={48} style={{ flex: 1 }} disabled={!draft} onPress={save} />
          </View>
        </>
      ) : (
        <ReceiveBody address={address} onCopy={copy} onAsk={() => setAsk('pick')}
          status={snap ? `${formatLunes(BigInt(snap.free))} LUNES · ${t('wallet.block')} ${blockLabel(snap.block)} · ${whenLabel(snap.at, Date.now())}` : null}
          more={more} onMore={() => setMore(m => !m)}
          extras={(
            <>
              <T size={12.5} lh={1.4} color={c.ink2}>{t('wallet.receiveSheet.note')}</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label={t('wallet.explorer')} variant="outline" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { void Linking.openURL(LUNES_EXPLORER).catch(() => {}); }} left={<Icon name="public" size={18} />} />
                <Button label={t('wallet.receiveSheet.readNow')} variant="outline" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { void refreshOnchain(); }} left={<Icon name="refresh" size={18} />} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label={t(canSign ? 'ownWallet.watchAnother' : 'wallet.receiveSheet.change')} variant="ghost" height={40} fontSize={13} style={{ flex: 1 }} onPress={() => { setDraft(canSign ? '' : address); setEditing(true); }} />
                {!canSign && <Button label={t('common.remove')} variant="ghost" height={40} fontSize={13} style={{ flex: 1 }} onPress={() => { setLunesAddress(null); setDraft(''); setEditing(!nativeWalletReady); }} />}
              </View>
            </>
          )} />
      )}
      {ask === 'pick' && <ContactPickerSheet chats={chats} onClose={() => setAsk(null)} onPick={ch => setAsk(ch)} />}
      {ask && ask !== 'pick' && <PayRequestSheet address={address} toName={ask.name} onClose={() => setAsk(null)} onSend={input => sendAsk(ask, input)} />}
    </TransferSheet>
  );
}

/**
 * Corpo da folha Receber, só apresentação (design §4 itens 2–10): QR, endereço numa linha (`lunes:` + início…fim,
 * o completo vai no QR, no copiar e no leitor de tela), linha de ação, nota curta do design. Fora do design e
 * discreto no fim: "Mais opções" (explorador, ler saldo, observar outro endereço e a nota de privacidade completa).
 */
export function ReceiveBody({ address, status, onCopy, onAsk, more, onMore, extras }: {
  address: string; status: string | null; onCopy: () => void; onAsk: () => void; more: boolean; onMore: () => void; extras: ReactNode;
}) {
  const { c } = useTheme();
  const t = useT();
  return (
    <>
      <View style={{ alignItems: 'center' }}>
        <QrWave value={address} label={t('wallet.receiveSheet.qr')} />
      </View>
      <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={t('wallet.copyAddress.a11y', { address })}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: pressed ? c.bg3 : c.bg2 })}>
        <T size={13} w={500} mono numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{receiveAddressLabel(address)}</T>
        <Icon name="content_copy" size={18} />
      </Pressable>
      <Pressable onPress={onAsk} accessibilityRole="button" accessibilityLabel={t('wallet.receiveSheet.askContact')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <Icon name="account_balance_wallet" size={22} w={300} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14.5} w={550}>{t('wallet.receiveSheet.askContact')}</T>
          <T size={12.5} color={c.ink2}>{t('wallet.receiveSheet.askContact.sub')}</T>
        </View>
        <Icon name="chevron_right" size={20} color={c.ink2} />
      </Pressable>
      <T size={12.5} lh={1.4} color={c.ink2}>{t('wallet.receiveSheet.noteShort')}</T>
      <Pressable onPress={onMore} accessibilityRole="button" accessibilityState={{ expanded: more }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', marginTop: -6 }}>
        <T size={12} w={500} color={c.ink2}>{t('wallet.receiveSheet.more')}</T>
        <Icon name={more ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color={c.ink2} />
      </Pressable>
      {more && status && <T size={12.5} lh={1.4} color={c.ink2} align="center">{status}</T>}
      {more && extras}
    </>
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
