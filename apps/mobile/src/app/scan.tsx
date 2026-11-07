import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { fmtLunes } from '../data/wallet';
import { useT } from '../i18n';
import { approvalCode, checkCode, PAIR_PREFIX, type PairedNode, pairCode, pairingConflict, parsePair, parseRequest, REQUEST_PREFIX, type TransferRequest } from '../lib/approvals';
import { confirmDevice } from '../lib/deviceAuth';
import { cardFromText } from '../lib/inviteLink';
import { loadApprovalNodes, saveApprovalNodes } from '../lib/vault';
import type { ContactCard } from '../messaging/card';
import { GROUP_LINK, useMessaging } from '../state/messaging';
import { usePoint } from '../state/point';
import { useStore } from '../state/store';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';
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
  const t = useT();
  const { readCard, addFromCard, testDeviceCard, ready, joinFromLink } = useMessaging();
  const { chats, showToast, setVerified } = useStore();
  const point = usePoint();
  // `verify`: veio da tela do contato para conferir pessoalmente que o QR é mesmo dele.
  const { verify } = useLocalSearchParams<{ verify?: string }>();
  const target = verify ? chats.find(x => x.id === verify) : undefined;
  const [perm, requestPerm] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<ContactCard | null>(null);
  const handled = useRef(false);
  // Painel do provider: parear este celular (`piup:`) ou aprovar uma transferência (`piut:`).
  const [paired, setPaired] = useState<{ node: PairedNode; code: string } | null>(null);
  const [approval, setApproval] = useState<{ node: PairedNode; req: TransferRequest; code?: string } | null>(null);
  const [authing, setAuthing] = useState(false);
  // Re-pareamento do mesmo celular com outro segredo: só salva depois de confirmar (B-05).
  const [repair, setRepair] = useState<{ node: PairedNode; prev: PairedNode } | null>(null);

  const savePair = async (node: PairedNode) => {
    const list = (await loadApprovalNodes<PairedNode>()).filter(n => n.phoneId !== node.phoneId);
    await saveApprovalNodes([...list, node]);
    setPaired({ node, code: pairCode(node) }); setError(null);
  };

  const fromPanel = async (text: string) => {
    setCamera(false); setCard(null); setPaired(null); setApproval(null);
    try {
      if (text.startsWith(PAIR_PREFIX)) {
        const node = parsePair(text);
        const prev = pairingConflict(await loadApprovalNodes<PairedNode>(), node);
        if (prev) { setRepair({ node, prev }); setError(null); return; }
        await savePair(node);
        return;
      }
      const req = parseRequest(text);
      if (req.expiresAt < Date.now()) throw new Error(t('scan.panel.expired'));
      const node = (await loadApprovalNodes<PairedNode>()).find(n => n.phoneId === req.phoneId);
      if (!node) throw new Error(t('scan.panel.notPaired'));
      setApproval({ node, req }); setError(null);
    } catch (e) { setError((e as Error).message); }
  };
  const approve = async () => {
    if (!approval || authing) return;
    if (approval.req.expiresAt < Date.now()) { setApproval(null); setError(t('scan.panel.expiredBeforeApproval')); return; }
    setAuthing(true);
    const r = await confirmDevice(t('scan.panel.approvePrompt', { amount: fmtLunes(approval.req.amount) }));
    setAuthing(false);
    if (r === 'denied') { setError(t('scan.panel.cancelled')); return; }
    // Aprovar dinheiro exige o bloqueio do aparelho (a web é só demonstração).
    if (r === 'unavailable' && Platform.OS !== 'web') { setError(t('scan.panel.needLock')); return; }
    setError(null);
    setApproval({ ...approval, code: approvalCode(approval.node, approval.req) });
  };

  const parse = (text: string) => {
    const raw = text.trim();
    if (!target && (raw.startsWith(PAIR_PREFIX) || raw.startsWith(REQUEST_PREFIX))) { void fromPanel(raw); return; }
    // QR de Wi-Fi (cartaz de ponto Piu): folha "Ponto Piu por perto" (P8) para entrar só para o Piu.
    if (!target && /^WIFI:/i.test(raw) && point.offerFromQr(raw)) { setCamera(false); router.back(); return; }
    try {
      // Convite de grupo, canal ou comunidade: pede para entrar (o admin aprova, se o grupo exigir).
      if (text.trim().startsWith(GROUP_LINK) && !target) {
        const name = joinFromLink(text);
        setCamera(false);
        showToast({ icon: 'schedule_send', title: t('join.sent', { name }), body: t('join.sent.body') });
        router.back();
        return;
      }
      // Link de convite (`piu://invite/accept?c=…`, QR da tela Convidar) leva o mesmo cartão.
      const k = readCard(cardFromText(text) ?? text);
      setCamera(false);
      if (target) {
        if (k.id !== target.peer) { setCard(null); setError(t('scan.verify.mismatch', { name: target.name })); return; }
        setVerified(target.id, true);
        showToast({ icon: 'verified', title: t('scan.verify.ok'), body: t('scan.verify.ok.body', { name: target.name }) });
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
    else setError(t('scan.noCamera'));
  };
  const add = () => {
    if (!card) return;
    try {
      const id = addFromCard(card);
      showToast({ icon: 'key', title: t('accept.added'), body: t('accept.added.body') });
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) { setError((e as Error).message); }
  };
  const exists = card ? chats.some(x => x.peer === card.id) : false;

  return (
    <Screen>
      <BackHeader title={target ? t('scan.verifyTitle', { name: target.name }) : t('scan.title')} />
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
            <T size={15} lh={1.45} color={c.ink2}>{t('scan.hint.before')} <T size={15} w={600}>{t('scan.hint.path')}</T> {t('scan.hint.after')}</T>
            <Button label={t('scan.openCamera')} height={48} onPress={openCamera} disabled={!ready} />
          </View>
        )}
        {camera && <Button label={t('scan.closeCamera')} variant="soft" height={44} onPress={() => setCamera(false)} />}

        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 6 }}>{t('scan.orPaste')}</T>
        <TextInput value={code} onChangeText={v => { setCode(v); setError(null); }} placeholder={t('scan.placeholder')} placeholderTextColor={c.ink3}
          autoCapitalize="none" autoCorrect={false} multiline accessibilityLabel={t('scan.input.a11y')}
          style={{ minHeight: 76, padding: 14, borderRadius: 16, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(400, true), textAlignVertical: 'top' }} />
        <Button label={t('scan.read')} variant="outline" height={46} disabled={!code.trim() || !ready} onPress={() => parse(code)} />
        {testDeviceCard && !target && (
          <Button label={t('scan.testDevice')} variant="ghost" height={42} fontSize={13.5}
            onPress={() => { const v = testDeviceCard(); setCode(v); parse(v); }} />
        )}

        {error && (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
            <Icon name="gpp_bad" size={20} />
            <T size={13.5} lh={1.4} style={{ flex: 1 }}>{error}</T>
          </View>
        )}

        {paired && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="shield_lock" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} style={{ flex: 1 }}>{t('scan.pair.title', { node: paired.node.node })}</T>
            </View>
            <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>{t('scan.pair.body')}</T>
            <T size={34} w={600} mono ls={0.1} color={c.invink} align="center" accessibilityLabel={t('scan.code.a11y', { code: paired.code.split('').join(' ') })}>{`${paired.code.slice(0, 3)} ${paired.code.slice(3)}`}</T>
            <Button label={t('scan.done')} variant="inverse" height={46} onPress={() => router.back()} />
          </View>
        )}

        {approval && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="account_balance_wallet" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} style={{ flex: 1 }}>{t('scan.transfer.title', { amount: fmtLunes(approval.req.amount) })}</T>
            </View>
            <T size={12.5} mono lh={1.6} color={c.invink} style={{ opacity: 0.8 }}>
              {`${t('scan.transfer.to', { to: approval.req.to === 'personal' ? t('scan.transfer.personal') : approval.req.to })}
${t('scan.transfer.node', { node: approval.req.node })}`}
            </T>
            {approval.code ? (
              <>
                <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>{t('scan.transfer.typeCode')}</T>
                <T size={22} w={600} mono ls={0.08} color={c.invink} align="center" selectable>{approval.code.match(/.{4}/g)!.join(' ')}</T>
                <Button label={t('scan.done')} variant="inverse" height={46} onPress={() => router.back()} />
              </>
            ) : (
              <>
                <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>{t('scan.transfer.check')}</T>
                <T size={30} w={600} mono ls={0.1} color={c.invink} align="center">{(() => { const k = checkCode(approval.req); return `${k.slice(0, 3)} ${k.slice(3)}`; })()}</T>
                <Button label={authing ? t('scan.transfer.confirming') : t('scan.transfer.approve')} variant="inverse" height={46} disabled={authing} onPress={approve} />
                <Button label={t('scan.transfer.refuse')} variant="ghost" height={42} fontSize={13.5} onPress={() => router.back()} />
              </>
            )}
          </View>
        )}

        {card && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="verified_user" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} style={{ flex: 1 }}>{card.name || t('identity.anon')}</T>
            </View>
            <T size={12} mono lh={1.6} color={c.invink} style={{ opacity: 0.75 }}>
              {`${card.kind === 'anon' ? t('accept.identity.anon') : t('accept.identity.public')}\n${card.id.slice(4, 8).toUpperCase()} … ${card.id.slice(-4).toUpperCase()}`}
            </T>
            <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>
              {card.kind === 'anon' ? t('scan.card.anon') : t('scan.card.public')}
            </T>
            <Button label={exists ? t('accept.alreadyContact') : t('scan.addAndChat')} variant="inverse" height={46} onPress={add} />
          </View>
        )}
      </ScrollView>
      {repair && (
        <Dialog icon="sync_lock" title={t('scan.panel.repair.title')} body={t('scan.panel.repair.body', { node: repair.prev.node })} primary={t('scan.panel.repair.confirm')}
          onClose={() => setRepair(null)} onPrimary={() => {
            const { node } = repair;
            setRepair(null);
            void savePair(node).catch(e => setError((e as Error).message));
          }} />
      )}
    </Screen>
  );
}
