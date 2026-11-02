import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { MIG_META } from '../data/settings';
import { addDevice, PLATFORM_LABEL, thisDevice, thisDeviceKey, thisPlatform } from '../lib/devices';
import { createOffer, MigrationError, type MigrationPayload, readReply, wipeOffer } from '../lib/migration';
import { requestSessionRotation } from '../lib/migrationState';
import { CodeQr, CodeReader, CodeWords } from '../lib/migrationUi';
import { useKeys } from '../state/keys';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
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
  const { restoreMode } = useSettings();
  const { finishOnboarding, onboarded, setProfile } = useStore();
  const { identities, restore } = useKeys();
  const { file, hist } = useLocalSearchParams<{ file?: string; hist?: string }>();
  const device = restoreMode === 'device';
  const [phase, setPhase] = useState<Phase>(device ? 'offer' : 'progress');
  const [n, setN] = useState(0);
  const [got, setGot] = useState<{ code: string[]; payload: MigrationPayload } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Oferta deste aparelho (chave efêmera só em memória; some ao sair da tela).
  const [offer, setOffer] = useState(() => (device ? createOffer({ pk: thisDeviceKey().pk, name: PLATFORM_LABEL[thisPlatform] + ' novo', platform: thisPlatform }, now()) : null));
  useEffect(() => () => { if (offer) wipeOffer(offer); }, [offer]);
  const newOffer = () => setOffer(createOffer({ pk: thisDeviceKey().pk, name: PLATFORM_LABEL[thisPlatform] + ' novo', platform: thisPlatform }, now()));

  const meta = MIG_META[restoreMode];
  const fromLabel = device ? (got?.payload.from.name || meta.label) : meta.label;
  const items = useMemo<[string, string][]>(() => {
    const pub = identities ? short(identities.public.id) : '…';
    const rot: [string, string] = ['Sessões antigas', 'encerradas · chaves de sessão novas com cada contato'];
    if (device) return [
      ['Identidade pública', `chaves copiadas · ${pub}`], ['Identidade anônima', 'separada · sem vínculo com a pública'],
      ['Carteira LUNES', 'chave da carteira recuperada'], ['Aparelho de origem', `${fromLabel} · registrado em Aparelhos`],
      ['Contatos e conversas', 'ficam no aparelho antigo · traga-os por arquivo de backup'], rot,
    ];
    return [
      ['Identidade pública', `recuperada · ${pub}`], ['Identidade anônima', 'recuperada · separada da pública'], ['Carteira LUNES', 'chave da carteira recuperada'],
      ['Histórico de conversas', restoreMode === 'file' ? (Number(hist) ? `${hist} itens do arquivo cifrado · guardados neste aparelho` : 'o arquivo não trazia histórico') : 'não fica na frase · só por arquivo de backup'],
      rot,
    ];
  }, [identities, device, fromLabel, restoreMode, hist]);
  const done = phase === 'progress' && n >= items.length;

  useEffect(() => {
    if (phase !== 'progress') return;
    setN(0);
    const t = setInterval(() => setN(x => { if (x + 1 >= items.length) clearInterval(t); return x + 1; }), STEP_MS);
    return () => clearInterval(t);
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
    if (!offer) return 'Gere um QR novo.';
    try {
      setGot(readReply(offer, text, now()));
      setPhase('confirm');
      return null;
    } catch (e) {
      return e instanceof MigrationError ? e.message : 'QR ilegível. Tente de novo.';
    }
  };

  /** Só depois de as 4 palavras conferirem: aplica a frase, registra o aparelho de origem e pede a rotação. */
  const apply = async () => {
    if (!got) return;
    setErr(null);
    try {
      await restore(got.payload.phrase);
      await addDevice({ pk: got.payload.from.pk, name: got.payload.from.name || 'Aparelho antigo', platform: got.payload.from.platform, via: 'origin' });
      if (got.payload.profileName && !onboarded) setProfile({ name: got.payload.profileName });
      await requestSessionRotation('migrado de outro aparelho');
      if (offer) wipeOffer(offer);
      setPhase('progress');
    } catch {
      setErr('Não foi possível guardar as chaves no cofre do aparelho.');
    }
  };

  const open = () => {
    // Sem chaves não há identidade: volta para escolher como recuperar (ex.: aberto por link direto).
    if (!identities) { router.replace('/restore'); return; }
    if (!onboarded) finishOnboarding();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
  };

  const title = done ? 'Tudo pronto.' : !device ? meta.title : phase === 'offer' ? 'Aponte o aparelho antigo para este QR' : phase === 'confirm' ? 'Confira as 4 palavras' : 'Recebendo suas chaves';
  const sub = !device ? (restoreMode === 'file' && file ? `${file} · aberto com a sua senha, neste aparelho.` : meta.sub)
    : phase === 'offer' ? 'No aparelho antigo: Perfil → Aparelhos → Adicionar aparelho. Direto entre os dois, cifrado, sem servidor.'
      : 'Se as palavras forem iguais nos dois aparelhos, ninguém se meteu no caminho.';
  const doneNote = device ? `Chaves copiadas de ${fromLabel}, que continua em Aparelhos: desconecte-o lá se não for mais usá-lo. As chaves de sessão foram trocadas.` : meta.done;

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step={done ? 'CONCLUÍDO' : 'MIGRAÇÃO'} title={title} sub={sub} />

        {phase === 'offer' && offer && (
          <View style={{ marginHorizontal: 20, gap: 16 }}>
            <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.bg2, alignItems: 'center', gap: 6 }}>
              <CodeQr value={offer.text} label="QR para o aparelho antigo ler" />
              <T size={12} mono color={c.ink2}>vale 10 min · {thisDevice().id.slice(4, 12)}</T>
            </View>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 4 }}>DEPOIS, LEIA A RESPOSTA</T>
            <CodeReader hint="O aparelho antigo mostra um QR de resposta. Aponte a câmera deste aparelho para ele." placeholder="piu-mig2:…" onRead={onReply} />
            <Button label="Gerar outro QR" variant="ghost" height={40} fontSize={13.5} onPress={newOffer} />
          </View>
        )}

        {phase !== 'offer' && (
          <View accessibilityLabel={`De ${fromLabel} para este aparelho`} style={{ marginTop: 8, marginHorizontal: 28, height: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
              <T size={11} w={500} mono color={c.ink2}>este aparelho</T>
            </View>
          </View>
        )}

        {phase === 'confirm' && got && (
          <View style={{ marginTop: 8, marginHorizontal: 20, gap: 12 }}>
            <CodeWords words={got.code} prompt="Confira se as mesmas palavras aparecem no aparelho antigo:" />
            {err && <T size={13} accessibilityRole="alert">{err}</T>}
            <Button label="As palavras são iguais" onPress={() => { void apply(); }} />
            <Button label="São diferentes" variant="soft" height={48} onPress={() => {
              setGot(null); newOffer(); setPhase('offer');
              setErr(null);
            }} />
            <T size={12.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>Se forem diferentes, nada é aplicado. Comece de novo com os dois aparelhos lado a lado, longe de outras pessoas.</T>
          </View>
        )}

        {phase === 'progress' && (
          <View style={{ paddingTop: 8, paddingHorizontal: 24 }}>
            {items.map(([t, d], i) => {
              const ok = i < n, cur = i === n;
              return (
                <View key={t} accessibilityLabel={`${t}: ${ok ? 'concluído' : cur ? 'em andamento' : 'aguardando'}`}
                  style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line, opacity: ok || cur ? 1 : 0.4 }}>
                  <Icon name={ok ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={22} fill={ok} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <T size={15} w={600}>{t}</T>
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
            <Button label="Abrir o Piu" disabled={!done} onPress={open} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
