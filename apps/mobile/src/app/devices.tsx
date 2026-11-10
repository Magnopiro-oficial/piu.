import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { fmtDate, t as tr, useT } from '../i18n';
import { confirmDevice } from '../lib/deviceAuth';
import { addDevice, platformName, revokeDevice, thisDevice, useDevices } from '../lib/devices';
import type { DeviceRecord } from '../lib/devicesCore';
import { lockGate } from '../lib/identityGuard';
import { startLink } from '../lib/desktopLinkSession';
import { codeSourceAllowed, MigrationError, parseOffer, respondToOffer, type CodeSource } from '../lib/migration';
import { b64url } from '../messaging/card';
import { CodeQr, CodeWords } from '../lib/migrationUi';
import { useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, SectionLabel } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const day = (sec: number) => fmtDate(sec * 1000, { day: 'numeric', month: 'short' }).replace('.', '');
const ICON: Record<DeviceRecord['platform'], IconName> = { android: 'phone_android', ios: 'phone_iphone', web: 'computer', other: 'devices' };

/** Descrição e etiqueta de um aparelho, no idioma em uso (chamado durante a renderização). */
function describe(d: DeviceRecord): { desc: string; tag: string } {
  const plat = platformName(d.platform, tr);
  if (d.via === 'this') return { desc: tr('devices.desc.this', { plat, date: day(d.addedAt) }), tag: tr('devices.tag.current') };
  if (d.revokedAt) return { desc: d.revokeReason === 'lost' ? tr('devices.desc.revoked', { date: day(d.revokedAt) }) : tr('devices.desc.disconnected', { date: day(d.revokedAt) }), tag: d.revokeReason === 'lost' ? tr('devices.tag.revoked') : tr('devices.tag.disconnected') };
  return { desc: d.via === 'origin' ? tr('devices.desc.origin', { plat, date: day(d.addedAt) }) : tr('devices.desc.paired', { plat, date: day(d.addedAt) }), tag: tr('devices.tag.active') };
}

type Pair = { step: 'scan' } | { step: 'reply'; reply: string; code: string[]; name: string };
type Ask = { kind: 'drop' | 'revoke'; d: DeviceRecord };

/**
 * Leitor da oferta só pela câmera, sem campo para colar: este aparelho ENVIA a frase e as 4 palavras
 * só são conferidas depois, no aparelho novo, então um código colado (recebido de outra pessoa)
 * levaria as chaves embora. `onRead` devolve a mensagem de erro, ou null se aceitou.
 */
function OfferCamera({ hint, onRead }: { hint: string; onRead: (text: string, source: CodeSource) => string | null }) {
  const { c } = useTheme();
  const t = useT();
  const [perm, requestPerm] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const read = (text: string) => {
    const e = onRead(text.trim(), 'camera');
    setError(e);
    if (!e) setCamera(false);
    else handled.current = false;
  };
  const open = async () => {
    handled.current = false;
    setError(null);
    const p = perm?.granted ? perm : await requestPerm();
    if (p.granted) setCamera(true);
    else setError(t('devices.scan.noCamera'));
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
          <Button label={t('scan.closeCamera')} variant="soft" height={44} onPress={() => setCamera(false)} />
        </>
      ) : (
        <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
          <Icon name="qr_code_scanner" size={28} w={300} />
          <T size={14} lh={1.45} color={c.ink2}>{hint}</T>
          <Button label={t('scan.openCamera')} height={46} onPress={open} />
        </View>
      )}
      <T size={12.5} lh={1.45} color={c.ink2}>{t('devices.scan.cameraOnly')}</T>
      {error && (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
          <Icon name="gpp_bad" size={20} />
          <T size={13.5} lh={1.4} style={{ flex: 1 }}>{error}</T>
        </View>
      )}
    </View>
  );
}

/**
 * Aparelhos com as suas chaves (registro real, salvo neste aparelho): adicionar um aparelho (QR +
 * código de 4 palavras), desconectar e revogar um aparelho perdido. Desconectar e revogar assinam um
 * aviso com a chave da identidade (para os contatos) e trocam as chaves de sessão.
 */
export default function Devices() {
  const { c } = useTheme();
  const t = useT();
  const { showToast, profile } = useStore();
  const { identities, hasKeys, unlockPhrase } = useKeys();
  const list = useDevices();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [pair, setPair] = useState<Pair | null>(add ? { step: 'scan' } : null);
  const [picking, setPicking] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const active = list.filter(d => d.via !== 'this' && !d.revokedAt);
  useEffect(() => { if (add) setPair({ step: 'scan' }); }, [add]);

  /** Aparelho antigo: leu a oferta do novo → confirma o dono → responde com a frase cifrada. */
  const onOffer = (text: string, source: CodeSource): string | null => {
    // Quem envia a frase só aceita a oferta lida pela câmera (as 4 palavras são conferidas só depois).
    if (!codeSourceAllowed('offer', source)) return t('devices.scan.cameraOnly');
    // QR do Piu Desktop lido aqui por engano: segue para "Conectar ao computador" com ele.
    if (text.trim().startsWith('piu-link:')) {
      const err = startLink(text);
      if (err) return err;
      setPair(null);
      router.push('/link-desktop' as Href);
      return null;
    }
    if (!hasKeys) return t('devices.noKeys');
    try {
      // Confere o QR na hora (formato, prazo); a frase só é lida do cofre depois da biometria (B-01).
      parseOffer(text, Math.floor(Date.now() / 1000));
    } catch (e) {
      return e instanceof MigrationError ? e.message : t('devices.unreadableQr');
    }
    // Quem tem a frase tem tudo: só envia depois de confirmar que é o dono do aparelho.
    // Sem bloqueio no aparelho, recusa como a carteira faz ao assinar (M-01).
    void (async () => {
      const web = Platform.OS === 'web';
      const u = await unlockPhrase(t('devices.sendKeysPrompt'), { allowWithoutLock: web });
      if (u.status === 'recover') { setPair(null); router.push('/vault-recover' as Href); return; }
      const g = lockGate(u.status, web);
      if (g !== 'ok' || u.status !== 'ok') { showToast({ icon: 'gpp_bad', title: t('devices.transferCancelled'), body: g === 'needLock' ? t('devices.needLock') : t('devices.notYou') }); setPair(null); return; }
      let r: ReturnType<typeof respondToOffer>;
      try {
        const me = thisDevice();
        r = respondToOffer(text, { phrase: u.words, from: { pk: me.pk, name: profile.name ? t('devices.deviceOf', { plat: platformName(me.platform, t), name: profile.name }) : platformName(me.platform, t), platform: me.platform }, profileName: profile.idType === 'public' ? profile.name : undefined }, Math.floor(Date.now() / 1000));
      } catch (e) {
        showToast({ icon: 'gpp_bad', title: t('devices.transferCancelled'), body: e instanceof MigrationError ? e.message : t('devices.unreadableQr') });
        setPair(null);
        return;
      }
      await addDevice({ pk: b64url(r.device.pk), name: r.device.name || t('devices.newDevice'), platform: r.device.platform, via: 'paired' });
      setPair({ step: 'reply', reply: r.reply, code: r.code, name: r.device.name || t('devices.newDevice').toLowerCase() });
    })();
    return null;
  };

  const confirmAsk = async () => {
    if (!ask || !identities) return;
    const { kind, d } = ask;
    setAsk(null); setPicking(false);
    const auth = await confirmDevice(kind === 'revoke' ? t('devices.revokeName', { name: d.name }) : t('devices.disconnectName', { name: d.name }));
    if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: t('devices.nothingChanged'), body: t('devices.notYou') }); return; }
    await revokeDevice(d.id, kind === 'revoke' ? 'lost' : 'disconnected', identities);
    showToast(kind === 'revoke'
      ? { icon: 'gpp_maybe', title: t('devices.revokeSigned'), body: t('devices.revokeSigned.body') }
      : { icon: 'sync_lock', title: t('devices.disconnected', { name: d.name }), body: t('devices.disconnected.body') });
  };

  return (
    <Screen>
      <BackHeader title={t('profile.row.devices')} />
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
                  <Pressable onPress={() => setAsk({ kind: 'drop', d })} accessibilityRole="button" accessibilityLabel={t('devices.disconnectName', { name: d.name })}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center' }}>
                    <T size={12.5} w={550}>{t('devices.disconnect')}</T>
                  </Pressable>
                ) : <T size={11} w={500} mono color={c.ink2}>{tag}</T>}
              </View>
            );
          })}

          {!pair && <Button label={t('devices.add')} variant="outline" height={48} style={{ marginTop: 6 }} onPress={() => setPair({ step: 'scan' })} />}
          {pair?.step === 'scan' && (
            <View style={{ marginTop: 6, gap: 10 }}>
              <T size={13.5} lh={1.45} color={c.ink2}>{t('devices.scan.before')} <T size={13.5} w={600}>{t('devices.scan.path')}</T>{t('devices.scan.after')}</T>
              <OfferCamera hint={t('devices.scan.hint')} onRead={onOffer} />
              <Button label={t('common.cancel')} variant="soft" height={44} onPress={() => setPair(null)} />
            </View>
          )}
          {pair?.step === 'reply' && (
            <View style={{ marginTop: 6, padding: 16, borderRadius: 24, backgroundColor: c.bg2, gap: 14 }}>
              <T size={15} w={600}>{t('devices.reply.title')}</T>
              <CodeQr value={pair.reply} label={t('devices.reply.qr')} />
              <CodeWords words={pair.code} prompt={t('devices.reply.prompt', { name: pair.name })} />
              <T size={12.5} lh={1.45} color={c.ink2}>{t('devices.reply.warn')}</T>
              <Button label={t('scan.done')} height={46} onPress={() => { setPair(null); showToast({ icon: 'phonelink_ring', title: t('devices.added'), body: t('devices.added.body', { name: pair.name }) }); }} />
            </View>
          )}
        </View>

        <SectionLabel>{t('devices.lost')}</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
          <T size={13.5} lh={1.45} color={c.ink2}>{t('devices.lost.body')}</T>
          {picking && (
            <View accessibilityRole="radiogroup" accessibilityLabel={t('devices.which')} style={{ gap: 6 }}>
              {active.map(d => (
                <Pressable key={d.id} onPress={() => setAsk({ kind: 'revoke', d })} accessibilityRole="button" accessibilityLabel={t('devices.revokeName', { name: d.name })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
                  <Icon name={ICON[d.platform]} size={20} w={300} />
                  <T size={14} w={600} numberOfLines={1} style={{ flex: 1 }}>{d.name}</T>
                  <Icon name="chevron_right" size={18} color={c.ink2} />
                </Pressable>
              ))}
            </View>
          )}
          <Button label={picking ? t('common.cancel') : t('devices.revokeLost')} variant={picking ? 'soft' : 'primary'} height={38} fontSize={13.5} style={{ alignSelf: 'flex-start', paddingHorizontal: 16 }}
            onPress={() => {
              if (picking) { setPicking(false); return; }
              if (!active.length) { showToast({ icon: 'devices', title: t('devices.noOther'), body: t('devices.noOther.body') }); return; }
              setPicking(true);
            }} />
          <T size={12} lh={1.45} color={c.ink2}>{t('devices.lost.note')}</T>
        </View>
      </ScrollView>

      {ask && (
        <Dialog icon={ask.kind === 'revoke' ? 'gpp_maybe' : 'link_off'} hold={ask.kind === 'revoke'}
          title={ask.kind === 'revoke' ? t('devices.revokeTitle', { name: ask.d.name }) : t('devices.disconnectTitle', { name: ask.d.name })}
          body={ask.kind === 'revoke' ? t('devices.revokeBody') : t('devices.disconnectBody')}
          primary={ask.kind === 'revoke' ? t('devices.holdToRevoke') : t('devices.disconnect')} primaryIcon={ask.kind === 'revoke' ? 'touch_app' : undefined}
          onPrimary={() => { void confirmAsk(); }} onClose={() => setAsk(null)} />
      )}
    </Screen>
  );
}
