import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { MIG_META } from '../data/settings';
import { useT } from '../i18n';
import { addDevice, platformName, thisDevice, thisDeviceKey, thisPlatform } from '../lib/devices';
import { PhraseExistsError } from '../lib/identityGuard';
import { createOffer, MigrationError, type MigrationPayload, readReply, wipeOffer } from '../lib/migration';
import { requestSessionRotation } from '../lib/migrationState';
import { CodeQr, CodeReader, CodeWords } from '../lib/migrationUi';
import { useKeys } from '../state/keys';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

const STEP_MS = 650;
const now = () => Math.floor(Date.now() / 1000);
const short = (id: string) => `${id.slice(4, 8).toUpperCase()} … ${id.slice(-4).toUpperCase()}`;

/** Aparelho a aparelho: oferta (QR) → resposta do aparelho antigo → conferir 4 palavras → aplicar. */
type Phase = 'offer' | 'confirm' | 'progress';

/**
 * Migração. Pela frase ou pelo arquivo, as chaves já foram aplicadas em Restaurar e aqui só se
 * mostra o resultado. De outro aparelho, a transferência acontece aqui: este aparelho mostra um QR
 * com uma chave efêmera, o antigo responde com a frase cifrada e os dois conferem 4 palavras.
 * No fim, as chaves de sessão são trocadas (o mensageiro abre sessões novas com cada contato).
 */
export default function Migrate() {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const { restoreMode } = useSettings();
  const { finishOnboarding, onboarded, setProfile } = useStore();
  const { identities, restore } = useKeys();
  const { file, hist } = useLocalSearchParams<{ file?: string; hist?: string }>();
  const device = restoreMode === 'device';
  const [phase, setPhase] = useState<Phase>(device ? 'offer' : 'progress');
  const [n, setN] = useState(0);
  const [got, setGot] = useState<{ code: string[]; payload: MigrationPayload } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Já existe outra frase no aparelho (ex.: gerada e não usada): trocar só segurando o botão.
  const [askReplace, setAskReplace] = useState(false);

  // Oferta deste aparelho (chave efêmera só em memória; some ao sair da tela).
  const [offer, setOffer] = useState(() => (device ? createOffer({ pk: thisDeviceKey().pk, name: t('migrate.newDeviceName', { plat: platformName(thisPlatform, t) }), platform: thisPlatform }, now()) : null));
  useEffect(() => () => { if (offer) wipeOffer(offer); }, [offer]);
  const newOffer = () => setOffer(createOffer({ pk: thisDeviceKey().pk, name: t('migrate.newDeviceName', { plat: platformName(thisPlatform, t) }), platform: thisPlatform }, now()));

  const meta = MIG_META[restoreMode];
  const fromLabel = device ? (got?.payload.from.name || t(meta.label)) : t(meta.label);
  const items = useMemo<[string, string][]>(() => {
    const pub = identities ? short(identities.public.id) : '…';
    const rot: [string, string] = [t('migrate.item.sessions'), t('migrate.item.sessions.desc')];
    if (device) return [
      [t('identity.public'), t('migrate.item.public.copied', { id: pub })], [t('identity.anon'), t('migrate.item.anon.separate')],
      [t('migrate.item.wallet'), t('migrate.item.wallet.desc')], [t('migrate.item.origin'), t('migrate.item.origin.desc', { from: fromLabel })],
      [t('migrate.item.contacts'), t('migrate.item.contacts.desc')], rot,
    ];
    return [
      [t('identity.public'), t('migrate.item.public.restored', { id: pub })], [t('identity.anon'), t('migrate.item.anon.restored')], [t('migrate.item.wallet'), t('migrate.item.wallet.desc')],
      [t('migrate.item.history'), restoreMode === 'file' ? (Number(hist) ? t('migrate.item.history.file', { count: Number(hist) }) : t('migrate.item.history.none')) : t('migrate.item.history.phrase')],
      rot,
    ];
  }, [identities, device, fromLabel, restoreMode, hist, t]);
  const done = phase === 'progress' && n >= items.length;

  useEffect(() => {
    if (phase !== 'progress') return;
    setN(0);
    const timer = setInterval(() => setN(x => { if (x + 1 >= items.length) clearInterval(timer); return x + 1; }), STEP_MS);
    return () => clearInterval(timer);
  }, [phase, items.length]);

  // Ponto que viaja do aparelho antigo para este, pela linha tracejada.
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || done) return;
    const loop = Animated.loop(Animated.timing(dot, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, done, dot]);

  const onReply = (text: string): string | null => {
    if (!offer) return t('migrate.newQrNeeded');
    try {
      setGot(readReply(offer, text, now()));
      setPhase('confirm');
      return null;
    } catch (e) {
      return e instanceof MigrationError ? e.message : t('devices.unreadableQr');
    }
  };

  /** Só depois de as 4 palavras conferirem: aplica a frase, registra o aparelho de origem e pede a rotação. */
  const apply = async (replace = false) => {
    if (!got) return;
    setErr(null);
    try {
      await restore(got.payload.phrase, { replace });
      await addDevice({ pk: got.payload.from.pk, name: got.payload.from.name || t('migrate.oldDevice'), platform: got.payload.from.platform, via: 'origin' });
      if (got.payload.profileName && !onboarded) setProfile({ name: got.payload.profileName });
      await requestSessionRotation('migrado de outro aparelho');
      if (offer) wipeOffer(offer);
      setPhase('progress');
    } catch (e) {
      if (e instanceof PhraseExistsError) { setAskReplace(true); return; }
      setErr(t('restore.err.vault'));
    }
  };

  const open = () => {
    // Sem chaves não há identidade: volta para escolher como recuperar (ex.: aberto por link direto).
    if (!identities) { router.replace('/restore'); return; }
    if (!onboarded) finishOnboarding();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
  };

  const title = done ? t('migrate.allSet') : !device ? t(meta.title) : phase === 'offer' ? t('migrate.offer.title') : phase === 'confirm' ? t('migrate.confirm.title') : t('migrate.receiving');
  const sub = !device ? (restoreMode === 'file' && file ? t('migrate.file.opened', { file }) : t(meta.sub))
    : phase === 'offer' ? t('migrate.offer.sub') : t('migrate.confirm.sub');
  const doneNote = device ? t('migrate.device.doneFrom', { from: fromLabel }) : t(meta.done);

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step={done ? t('migrate.stepDone') : t('migrate.step')} title={title} sub={sub} />

        {phase === 'offer' && offer && (
          <View style={{ marginHorizontal: 20, gap: 16 }}>
            <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.bg2, alignItems: 'center', gap: 6 }}>
              <CodeQr value={offer.text} label={t('migrate.offer.qr')} />
              <T size={12} mono color={c.ink2}>{t('migrate.offer.valid')} · {thisDevice().id.slice(4, 12)}</T>
            </View>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 4 }}>{t('migrate.thenRead')}</T>
            <CodeReader hint={t('migrate.reply.hint')} placeholder="piu-mig2:…" onRead={onReply} />
            <Button label={t('migrate.anotherQr')} variant="ghost" height={40} fontSize={13.5} onPress={newOffer} />
          </View>
        )}

        {phase !== 'offer' && (
          <View accessibilityLabel={t('migrate.fromTo.a11y', { from: fromLabel })} style={{ marginTop: 8, marginHorizontal: 28, height: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ position: 'absolute', left: 70, right: 70, top: 48, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: c.ink, opacity: 0.45 }} />
            {!done && !reduceMotion && (
              <Animated.View style={{ position: 'absolute', top: 44, width: 7, height: 7, borderRadius: 4, backgroundColor: c.ink,
                left: dot.interpolate({ inputRange: [0, 1], outputRange: ['22%', '74%'] }) }} />
            )}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 62, height: 94, borderRadius: 16, borderWidth: 1.5, borderColor: c.ink, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={meta.icon} size={26} w={300} /></View>
              <T size={11} w={500} mono color={c.ink2} numberOfLines={1} style={{ maxWidth: 110 }}>{fromLabel}</T>
            </View>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 62, height: 94, borderRadius: 16, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="smartphone" size={26} color={c.invink} /></View>
              <T size={11} w={500} mono color={c.ink2}>{t('migrate.thisDevice')}</T>
            </View>
          </View>
        )}

        {phase === 'confirm' && got && (
          <View style={{ marginTop: 8, marginHorizontal: 20, gap: 12 }}>
            <CodeWords words={got.code} prompt={t('migrate.confirm.prompt')} />
            {err && <T size={13} accessibilityRole="alert">{err}</T>}
            <Button label={t('migrate.wordsMatch')} onPress={() => { void apply(); }} />
            <Button label={t('migrate.wordsDiffer')} variant="soft" height={48} onPress={() => {
              setGot(null); newOffer(); setPhase('offer');
              setErr(null);
            }} />
            <T size={12.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('migrate.differNote')}</T>
          </View>
        )}

        {phase === 'progress' && (
          <View style={{ paddingTop: 8, paddingHorizontal: 24 }}>
            {items.map(([title, d], i) => {
              const ok = i < n, cur = i === n;
              return (
                <View key={title} accessibilityLabel={`${title}: ${ok ? t('wallet.bonus.done') : cur ? t('migrate.inProgress') : t('migrate.waiting')}`}
                  style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line, opacity: ok || cur ? 1 : 0.4 }}>
                  <Icon name={ok ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={22} fill={ok} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <T size={15} w={600}>{title}</T>
                    <T size={11.5} mono lh={1.45} color={c.ink2}>{d}</T>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {done && (
          <View accessibilityLiveRegion="polite" style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.ink, flexDirection: 'row', gap: 12 }}>
            <Icon name="sync_lock" size={20} w={300} color={c.invink} />
            <T size={13} lh={1.45} color={c.invink} style={{ flex: 1 }}>{doneNote}</T>
          </View>
        )}
        {phase === 'progress' && (
          <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
            <Button label={t('migrate.open')} disabled={!done} onPress={open} />
          </View>
        )}
      </ScrollView>
      {askReplace && (
        <Dialog icon="warning" title={t('restore.replace.title')} body={t('restore.replace.body')} hold primary={t('restore.replace.hold')} primaryIcon="touch_app"
          onClose={() => setAskReplace(false)} onPrimary={() => { setAskReplace(false); void apply(true); }} />
      )}
    </Screen>
  );
}
