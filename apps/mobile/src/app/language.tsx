import { Pressable, ScrollView, View } from 'react-native';
import { fmtDate, LANGS, regionSample, resolveLang, systemLang, tIn, useT, type Lang, type Region } from '../i18n';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { FootNote, SegRow, SetGroup, ToggleRow } from '../ui/Settings';
import { T } from '../ui/T';

/** Linha de idioma: nome nativo, nome em português e "Em uso" no atual. */
function LangRow({ native, sub, on, onPress }: { native: string; sub: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${native}, ${sub}${on ? `, ${t('lang.inUse')}` : ''}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16, backgroundColor: pressed ? c.bg3 : 'transparent' })}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} w={on ? 700 : 450}>{native}</T>
        <T size={12.5} lh={1.35} color={c.ink2}>{sub}</T>
      </View>
      {on ? <T size={13} w={550}>{t('lang.inUse')}</T> : null}
      {on ? <Icon name="check" size={20} w={400} /> : null}
    </Pressable>
  );
}

/**
 * Perfil → Idioma (design: settings.language). O idioma vale só neste aparelho; "Do sistema" segue o
 * aparelho quando ele é um dos suportados. REGIÃO muda só o formato de número e data. "Traduzir
 * mensagens recebidas" exige um modelo de tradução no aparelho: fica desligada, com "Em breve".
 */
export default function Language() {
  const t = useT();
  const { lang, setLang, region, setRegion } = useSettings();
  const { showToast } = useStore();
  const sys = systemLang();
  const inUse: Lang = resolveLang(lang, sys);
  const sysName = LANGS.find(l => l.code === sys)?.native ?? 'Português (Brasil)';
  const pick = (code: Lang) => {
    if (lang === code) return;
    setLang(code);
    const name = LANGS.find(l => l.code === code)!.native;
    showToast({ icon: 'translate', title: tIn(code, 'lang.toast.title', { name }), body: tIn(code, 'lang.toast.body') });
  };
  const sample = t('lang.region.sample', { date: fmtDate(Date.now(), { dateStyle: 'medium' }, inUse, region), number: regionSample(inUse, region) });
  return (
    <Screen>
      <BackHeader title={t('lang.title')} />
      <ScrollView>
        <SetGroup title={t('lang.group.app')}>
          <LangRow native={t('lang.system')} sub={t('lang.system.desc', { name: sysName })} on={lang === 'auto'} onPress={() => { if (lang !== 'auto') setLang('auto'); }} />
          {LANGS.map(l => <LangRow key={l.code} native={l.native} sub={l.pt} on={lang === l.code} onPress={() => pick(l.code)} />)}
        </SetGroup>
        <SetGroup title={t('lang.group.region')}>
          <SegRow<Region> name={t('lang.region.title')} desc={sample} value={region} onChange={setRegion}
            options={[['auto', t('lang.region.auto')], ['br', '1.234,56'], ['us', '1,234.56']]} />
          <ToggleRow name={t('lang.translate')} desc={`${t('lang.translate.desc')} · ${t('common.soon')}`} on={false} disabled onChange={() => {}} />
        </SetGroup>
        <FootNote icon="translate">{t('lang.note')}</FootNote>
      </ScrollView>
    </Screen>
  );
}
