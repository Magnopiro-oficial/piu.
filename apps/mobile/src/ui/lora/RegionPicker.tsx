import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { fmtNumber, useT } from '../../i18n';
import { regionRows } from '../../lib/piuLora';
import { useNetwork } from '../../state/network';
import { useTheme } from '../../theme/ThemeProvider';
import type { PiuLoraLink } from '../../transport/rnode/link';
import { countryFromLocale } from '../../transport/rnode/region';
import { bandLabel, regionForCountry } from '../../transport/rnode/regions';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Screen } from '../Screen';
import { T } from '../T';
import { regionKey } from './LoraBlock';

/** Nome do país na língua do app, quando o sistema sabe (busca "Portugal" → Europa 868 e 433). */
function countryNamer(lang: string): (cc: string) => string | undefined {
  try {
    const dn = new Intl.DisplayNames([lang], { type: 'region' });
    return cc => { try { return dn.of(cc); } catch { return undefined; } };
  } catch { return () => undefined; }
}

/**
 * Região do rádio (desenho Piu 17, 4a–4c): a sugerida pelo país do aparelho, busca sem acento, as 27
 * regiões por continente. `first`: antes da primeira conexão ("Usar esta" ou "Continuar" seguem para
 * a conexão). Senão, trocar pede confirmação, reconfigura o rádio conectado e avisa. `justSwapped`: abre
 * com o aviso da troca para essa região (galeria, 4c · depois).
 */
export function RegionPicker({ link, first, country: cc, justSwapped, onDone, onClose }: { link: PiuLoraLink; first: boolean; country?: string | null; justSwapped?: string; onDone: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { setPiuRegion } = useNetwork();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const suggested = regionForCountry((cc === undefined ? countryFromLocale(locale) : cc) ?? undefined);
  const [current, setCurrent] = useState(first ? null : link.status().region);
  const [sel, setSel] = useState<string | null>(current);
  const [pending, setPending] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // "Rádio do Piu em …" (4c depois): o aviso fica nesta tela, por cima da lista, por 2,5 s.
  const [toast, setToast] = useState<string | null>(() => (justSwapped ? t('piu.reg.toast', { name: t(regionKey(justSwapped)) }) : null));
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2500); return () => clearTimeout(id); }, [toast]);
  const country = useMemo(() => countryNamer(locale), [locale]);
  const groups = regionRows(q, { name: id => t(regionKey(id)), country });

  const apply = (id: string) => {
    setPiuRegion(id);
    void link.setRegion(id);
    setCurrent(id); setSel(id);
  };
  const pick = (id: string) => {
    if (first) return setSel(id);
    if (id !== current) setPending(id);
  };
  const use = (id: string) => {
    if (first) { apply(id); onDone(); return; }
    if (id !== current) setPending(id);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Screen>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 16 }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.back')} style={{ width: 30, alignItems: 'center' }}>
            <Icon name="arrow_back_ios_new" size={22} />
          </Pressable>
          <T size={18} w={680} ls={-0.025} accessibilityRole="header">{t('piu.reg.title')}</T>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: 28, gap: 16 }}>
          <T size={13} lh={1.5} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('piu.reg.intro')}</T>
          {suggested ? (
            <View style={{ paddingVertical: 14, paddingLeft: 16, paddingRight: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
              <T size={10.5} w={500} mono ls={0.06} color={c.ink2}>{t('piu.reg.suggested')}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={17} w={700} ls={-0.02}>{t(regionKey(suggested))}</T>
                  <T size={12.5} color={c.ink2}>{bandLabel(suggested)}</T>
                </View>
                {/* Desenho 4a: a sugestão escolhida na lista (ou já em uso) vira "✓ Em uso". */}
                {sel === suggested ? (
                  <View style={{ height: 38, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name="check" size={18} w={400} color={c.ink2} /><T size={13} w={600} color={c.ink2}>{t('piu.reg.inUse')}</T>
                  </View>
                ) : (
                  <Pressable onPress={() => use(suggested)} accessibilityRole="button" style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: c.ink, justifyContent: 'center' }}>
                    <T size={13.5} w={650} color={c.invink}>{t('piu.reg.use')}</T>
                  </Pressable>
                )}
              </View>
            </View>
          ) : (
            <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
              <Icon name="help" size={19} w={400} />
              <T size={13} lh={1.5} style={{ flex: 1 }}>{t('piu.reg.unknown')}</T>
            </View>
          )}
          <View style={{ height: 44, borderRadius: 22, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
            <Icon name="search" size={19} w={400} color={c.ink2} />
            <TextInput value={q} onChangeText={setQ} placeholder={t('piu.reg.search')} placeholderTextColor={c.ink3} autoCorrect={false}
              style={{ flex: 1, minWidth: 0, color: c.ink, fontSize: 14, paddingVertical: 0 }} accessibilityLabel={t('piu.reg.search')} />
          </View>
          {groups.map(g => (
            <View key={g.key} style={{ gap: 8 }}>
              <T size={10.5} w={500} mono ls={0.06} color={c.ink2} style={{ paddingHorizontal: 6 }}>{t(`piu.reg.g.${g.key}`)}</T>
              <View style={{ borderRadius: 18, backgroundColor: c.bg2, overflow: 'hidden' }}>
                {g.rows.map((r, i) => {
                  const on = r.id === sel;
                  return (
                    <Pressable key={r.id} onPress={() => pick(r.id)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <T size={14} w={on ? 680 : 500}>{r.name}</T>
                        <T size={12} color={c.ink2}>{r.band}</T>
                        <T size={10.5} w={500} mono color={c.ink3}>{r.dutyPct >= 100 ? t('piu.reg.metaFree', { dbm: r.maxDbm }) : t('piu.reg.meta', { dbm: r.maxDbm, pct: fmtNumber(r.dutyPct) })}</T>
                      </View>
                      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.ink : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: c.line2 }}>
                        {on ? <Icon name="check" size={15} w={400} color={c.invink} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {!groups.length ? <T size={13} color={c.ink2} style={{ paddingVertical: 8, paddingHorizontal: 6 }}>{t('piu.reg.empty')}</T> : null}
          <View style={{ flexDirection: 'row', gap: 6, paddingTop: 4, paddingHorizontal: 6 }}>
            <Icon name="info" size={15} w={400} color={c.ink2} />
            <T size={12} lh={1.5} color={c.ink2} style={{ flex: 1 }}>{t('piu.reg.foot')}</T>
          </View>
        </ScrollView>
        {first && sel ? (
          <View style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: 22, borderTopWidth: 1, borderTopColor: c.line }}>
            <Button label={t('piu.reg.continue')} height={48} onPress={() => { apply(sel); onDone(); }} />
          </View>
        ) : null}
        {toast ? (
          <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 16, right: 16, bottom: 24, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 16, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="settings_input_antenna" size={19} w={400} color={c.invink} /><T size={13.5} w={600} color={c.invink} style={{ flex: 1 }}>{toast}</T>
          </View>
        ) : null}
        {pending ? (
          <SwapDialog title={t('piu.reg.confirm', { name: t(regionKey(pending)) })} body={t('piu.reg.confirm.d')} primary={t('piu.reg.swap')}
            onPrimary={() => { const id = pending; setPending(null); apply(id); setToast(t('piu.reg.toast', { name: t(regionKey(id)) })); }}
            onClose={() => setPending(null)} />
        ) : null}
      </Screen>
    </Modal>
  );
}

/**
 * 4c: confirmação de troca no formato do desenho (diferente do Dialog do app): cartão de raio 26, título 18
 * à esquerda, sem ícone, Cancelar e Trocar de 40 px lado a lado à direita. Entra como o Dialog (320 ms, scale .9 → 1).
 */
function SwapDialog({ title, body, primary, onPrimary, onClose }: { title: string; body: string; primary: string; onPrimary: () => void; onClose: () => void }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const [v] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (!reduceMotion) Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.bezier(0.2, 0.9, 0.3, 1.25), useNativeDriver: true }).start();
  }, [reduceMotion, v]);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 22 }}>
        <Animated.View accessibilityViewIsModal accessibilityRole="alert" style={{
          backgroundColor: c.bg, borderRadius: 26, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 16, gap: 10,
          borderWidth: 1, borderColor: c.line2, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 24 }, elevation: 20,
          opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
        }}>
          <T size={18} w={700} ls={-0.025} lh={1.25}>{title}</T>
          <T size={13} lh={1.5} color={c.ink2}>{body}</T>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 10 }}>
            <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <T size={13.5} w={600}>{t('common.cancel')}</T>
            </Pressable>
            <Pressable onPress={onPrimary} accessibilityRole="button" style={({ pressed }) => ({ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: c.ink, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <T size={13.5} w={650} color={c.invink}>{primary}</T>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
