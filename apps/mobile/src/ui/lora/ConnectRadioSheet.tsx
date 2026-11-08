import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import { radioErrorKind, signalOf } from '../../lib/loraRow';
import { useTheme } from '../../theme/ThemeProvider';
import type { LoraRadio } from '../../transport/meshtastic/radio';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Sheet, type SheetHandle } from '../Sheet';
import { T } from '../T';
import { useLora } from './useLora';

const MESHTASTIC_APP = 'market://details?id=com.geeksville.mesh';

/**
 * Folha "Conectar rádio" (desenho Piu 16, 2a–2e): rádios por perto com o sinal, a explicação do PIN
 * enquanto o Android pede o pareamento, os 3 passos da conexão, o erro com o que costuma resolver e,
 * no primeiro uso, o pedido de definir a região no app oficial.
 */
export function ConnectRadioSheet({ radio, onClose, onConnected }: { radio: LoraRadio; onClose: () => void; onConnected: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const ref = useRef<SheetHandle>(null);
  const lora = useLora();
  const [picked, setPicked] = useState<string | null>(null);
  const st = lora?.status ?? radio.status();
  const link = lora?.link ?? radio.link.status();
  const up = st.phase === 'connected' && link.state === 'up';
  const noRegion = up && link.region === 0;

  // A busca continua enquanto a folha está aberta e nada foi escolhido.
  useEffect(() => {
    if (picked) return;
    let alive = true;
    const loop = async () => { for (let n = 0; alive; n++) { await radio.scan(10, n > 0); if (radio.status().phase === 'error') break; } };
    void loop();
    return () => { alive = false; };
  }, [radio, picked]);

  // Conectado e região certa: avisa e fecha em 1,5 s.
  useEffect(() => {
    if (!up || noRegion) return;
    onConnected();
    const id = setTimeout(() => ref.current?.close(onClose), 1500);
    return () => clearTimeout(id);
  }, [up, noRegion]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = st.device?.name ?? '';
  const connect = (id: string) => { setPicked(id); void radio.connect(id); };
  let body;
  if (up) {
    body = (
      <View style={{ gap: 16 }}>
        <Head icon="check" title={t('lora.ok')} sub={link.battery !== undefined ? t('lora.ok.battery', { name, pct: Math.min(100, link.battery) }) : name} filled />
        {noRegion ? (
          <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="public" size={20} w={300} /><T size={15} w={650}>{t('lora.region.title')}</T></View>
            <T size={13.5} lh={1.4} color={c.ink2}>{t('lora.region.body')}</T>
            <Button label={t('lora.region.open')} onPress={() => { void Linking.openURL(MESHTASTIC_APP).catch(() => {}); }} left={<Icon name="open_in_new" size={18} w={400} color={c.invink} />} />
            <Button variant="outline" label={t('lora.region.check')} onPress={() => { void radio.link.refresh(); }} />
          </View>
        ) : null}
      </View>
    );
  } else if (st.phase === 'error' && picked) {
    const why = radioErrorKind(st.error);
    const fixes: [IconName, string, string][] = [
      ['bluetooth_searching', t('lora.fix.near'), t('lora.fix.near.d')],
      ['pin', t('lora.fix.pin'), t('lora.fix.pin.d')],
      ['mobile_off', t('lora.fix.free'), t('lora.fix.free.d')],
    ];
    // Motivo conhecido: o conselho dele vai para o topo.
    if (why === 'pin') fixes.unshift(fixes.splice(1, 1)[0]!);
    const title = why === 'timeout' ? t('lora.err.timeout') : why === 'perm' ? t('lora.err.perm') : why === 'btOff' ? t('lora.err.btOff') : t('lora.err.title');
    body = (
      <View style={{ gap: 14 }}>
        <Head icon="link_off" title={title} sub={t('lora.err.body', { name })} />
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {fixes.map(([icon, tt, d], i) => (
            <View key={icon} style={{ flexDirection: 'row', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={icon} size={20} w={300} />
              <View style={{ flex: 1, gap: 2 }}><T size={14} w={600}>{tt}</T><T size={12.5} lh={1.35} color={c.ink2}>{d}</T></View>
            </View>
          ))}
        </View>
        <Button label={t('lora.retry')} onPress={() => connect(picked)} />
        <Button variant="outline" label={t('lora.other')} onPress={() => setPicked(null)} />
      </View>
    );
  } else if (picked) {
    const pairing = st.phase === 'pairing';
    const steps: [string, 'done' | 'now' | 'wait'][] = [
      [t('lora.step.paired'), pairing ? 'now' : 'done'],
      [t('lora.step.config'), pairing ? 'wait' : st.phase === 'connecting' ? 'now' : 'done'],
      [t('lora.step.join'), st.phase === 'connected' ? 'now' : 'wait'],
    ];
    body = (
      <View style={{ gap: 16 }}>
        <Head icon="settings_input_antenna" title={name} />
        {pairing || st.phase === 'connecting' ? <PinCard /> : null}
        <View style={{ gap: 12 }}>
          {steps.map(([label, k]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: k === 'done' ? c.ink : 'transparent', borderWidth: k === 'done' ? 0 : 1.5, borderColor: k === 'wait' ? c.ink3 : c.ink }}>
                {k === 'done' ? <Icon name="check" size={15} w={400} color={c.invink} /> : k === 'now' ? <ActivityIndicator size="small" color={c.ink} /> : null}
              </View>
              <T size={14.5} w={k === 'now' ? 600 : 450} color={k === 'wait' ? c.ink3 : c.ink}>{label}</T>
            </View>
          ))}
        </View>
        <Button variant="outline" label={t('common.cancel')} onPress={() => { radio.disconnect(); setPicked(null); }} />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 14 }}>
        <T size={13} w={600} ls={0.6} color={c.ink2}>{t('lora.sheet.scanning')}</T>
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {st.devices.length ? st.devices.map((d, i) => {
            const s = signalOf(d.rssi);
            return (
              <Pressable key={d.id} onPress={() => connect(d.id)} accessibilityRole="button" accessibilityLabel={`${d.name}, ${t(`lora.sig.${s.word}`)}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings_input_antenna" size={20} w={300} /></View>
                <T size={15} w={550} numberOfLines={1} style={{ flex: 1 }}>{d.name}</T>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
                  {[5, 8, 11, 14].map((h, k) => <View key={h} style={{ width: 4, height: h, borderRadius: 1, backgroundColor: k < s.bars ? c.ink : c.bg3 }} />)}
                </View>
                <T size={12} w={500} color={c.ink2} style={{ width: 44 }}>{t(`lora.sig.${s.word}`)}</T>
              </Pressable>
            );
          }) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 }}><ActivityIndicator color={c.ink} /><T size={13.5} color={c.ink2}>{t('lora.sheet.empty')}</T></View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Icon name="help" size={18} w={300} color={c.ink2} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{t('lora.sheet.help')}</T>
        </View>
      </View>
    );
  }

  return (
    <Sheet ref={ref} label={t('lora.sheet.title')} onClose={() => { if (!up) radio.disconnect(); onClose(); }} gap={14}>
      {!picked ? (
        <View style={{ gap: 4, marginTop: 6 }}>
          <T size={24} w={700} ls={-0.03} accessibilityRole="header">{t('lora.sheet.title')}</T>
          <T size={13.5} lh={1.4} color={c.ink2}>{t('lora.sheet.intro')}</T>
        </View>
      ) : null}
      {body}
    </Sheet>
  );
}

function Head({ icon, title, sub, filled }: { icon: IconName; title: string; sub?: string; filled?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? c.ink : c.bg2 }}>
        <Icon name={icon} size={28} w={300} color={filled ? c.invink : c.ink} />
      </View>
      <T size={19} w={650} ls={-0.02} style={{ textAlign: 'center' }} accessibilityRole="header">{title}</T>
      {sub ? <T size={13.5} lh={1.4} color={c.ink2} style={{ textAlign: 'center' }}>{sub}</T> : null}
    </View>
  );
}

/** 2b: o número à vista enquanto o Android pede o PIN. */
function PinCard() {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
      <T size={15} w={650}>{t('lora.pin.title')}</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg, gap: 4 }}>
          <T size={11} w={600} ls={0.6} color={c.ink2}>{t('lora.pin.factory')}</T>
          <T size={22} w={650} mono tabular>123456</T>
        </View>
        <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg, gap: 4, justifyContent: 'center' }}>
          <T size={11} w={600} ls={0.6} color={c.ink2}>{t('lora.pin.screen')}</T>
          <Icon name="pin" size={22} w={300} />
        </View>
      </View>
      <T size={12.5} lh={1.4} color={c.ink2}>{t('lora.pin.body')}</T>
    </View>
  );
}
