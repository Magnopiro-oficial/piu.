import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { useT, type Key } from '../../../i18n';
import { PHONE_NODE_MIN_FREE_BYTES, type RequirementKey } from '../../../lib/phoneNodeCore';
import { personalRequirementsOk } from '../../../lib/phoneNodeView';
import { usePhoneNode } from '../../../state/phoneNode';
import { useTheme } from '../../../theme/ThemeProvider';
import { Icon } from '../../../ui/Icon';
import { Lead, Note, PnButton, PnHeader, SmallButton, usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';
import { T } from '../../../ui/T';

/**
 * Antes de ativar (N1 "Ativar"), quando falta algo que só a pessoa resolve: carteira, backup da frase,
 * espaço livre, economia de bateria. O Piu 11 não desenha esta tela; ela usa as peças dele (rótulo,
 * título, linhas e botões) para não ligar o modo nó sem os requisitos. Cada pendência resolve daqui.
 */
export default function PhoneRequirements() {
  const { c } = useTheme();
  const t = useT();
  const fail = usePnFail();
  const pn = usePhoneNode();
  const [busy, setBusy] = useState(false);
  const missing = pn.requirements.filter(r => !r.ok && r.key !== 'program');
  const personalOk = personalRequirementsOk(pn.requirements);

  const go = async () => {
    if (!pn.requirementsOk) { router.replace('/provider/phone/bond' as Href); return; } // só o programa falta: caução "em breve"
    setBusy(true);
    try { await pn.activate(); router.replace('/provider/phone' as Href); }
    catch (e) { const a = fail(e); if (a.kind === 'soon') router.replace('/provider/phone/bond' as Href); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <PnHeader title={t('n11.n2.title')} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 6, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>
        <Lead kicker={t('n11.n1.kicker')} title={t('pn.m1e.title', { count: missing.length })} sub={t('pn.m1e.sub')} />
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {pn.requirements.map((r, i) => <ReqRow key={r.key} k={r.key} ok={r.ok} first={i === 0} />)}
        </View>
        <Note icon="info">{t('pn.m1e.platform')}</Note>
        <View style={{ flex: 1 }} />
        <View style={{ gap: 6 }}>
          <PnButton label={t('n11.n1.activate')} onPress={() => { void go(); }} busy={busy} disabled={!personalOk} />
          <PnButton ghost label={t('n11.n1.later')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/provider'))} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const REQ_ACTION: Partial<Record<RequirementKey, { label: Key; go: () => void }>> = {
  wallet: { label: 'pn.req.wallet.do', go: () => router.push('/wallet' as Href) },
  backup: { label: 'pn.req.backup.do', go: () => router.push('/backup' as Href) },
  freeSpace: { label: 'pn.req.freeSpace.do', go: () => router.push({ pathname: '/settings/[page]', params: { page: 'storage' } }) },
  batterySaver: {
    label: 'pn.req.batterySaver.do',
    go: () => {
      if (Platform.OS === 'android') void Linking.sendIntent('android.settings.BATTERY_SAVER_SETTINGS').catch(() => Linking.openSettings().catch(() => {}));
      else void Linking.openSettings().catch(() => {});
    },
  },
};

function ReqRow({ k, ok, first }: { k: RequirementKey; ok: boolean; first: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const act = REQ_ACTION[k];
  const gb = Math.round(PHONE_NODE_MIN_FREE_BYTES / 1024 ** 3);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <Icon name={ok ? 'check_circle' : 'error'} size={22} fill={ok} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} w={ok ? 550 : 600}>{t(`pn.req.${k}` as Key)}</T>
        <T size={12.5} lh={1.35} color={c.ink2}>{t(`pn.req.${k}.${ok ? 'ok' : 'no'}` as Key, { gb })}</T>
      </View>
      {!ok && act ? <SmallButton label={t(act.label)} onPress={act.go} /> : null}
    </View>
  );
}
