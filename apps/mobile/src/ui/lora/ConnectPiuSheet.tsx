import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import { radioErrorKind, signalOf } from '../../lib/loraRow';
import { freqLabel, piuProblem, type PiuProblem } from '../../lib/piuLora';
import { useTheme } from '../../theme/ThemeProvider';
import type { PiuLoraRadio } from '../../transport/rnode/radio';
import { bandLabel, piuRadio } from '../../transport/rnode/regions';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Sheet, type SheetHandle } from '../Sheet';
import { T } from '../T';
import { regionKey } from './LoraBlock';
import { BOARDS_URL, RNODE_INSTALL_URL } from './RadioTypeSheet';

/**
 * Folha "Conectar rádio" do rádio do Piu (desenho Piu 17, 3a–3i): rádios por perto com o sinal, o PIN
 * que aparece na tela da placa, as etapas (o canal da região em mono), pronto, e os erros: conexão,
 * firmware que não é RNode, placa de outra faixa e erro com código. `problem`: aberta pelo "Ver o que
 * fazer" da linha LoRa, direto no erro.
 */
export function ConnectPiuSheet({ radio, problem, deviceId, onRegion, onClose }: { radio: PiuLoraRadio; problem?: PiuProblem; deviceId?: string; onRegion: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const ref = useRef<SheetHandle>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { const a = radio.onChange(bump), b = radio.link.onChange(bump); return () => { a(); b(); }; }, [radio]);
  const [picked, setPicked] = useState<string | null>(problem ? radio.status().device?.id ?? null : deviceId ?? null);
  const [shown, setShown] = useState<PiuProblem | undefined>(problem);
  const st = radio.status();
  const link = radio.link.status();
  const up = st.phase === 'connected' && link.state === 'up';

  // A busca continua enquanto a folha está aberta e nada foi escolhido.
  useEffect(() => {
    if (picked || shown) return;
    let alive = true;
    const loop = async () => { for (let n = 0; alive; n++) { await radio.scan(10, n > 0); if (radio.status().phase === 'error') break; } };
    void loop();
    return () => { alive = false; };
  }, [radio, picked, shown]);

  // Já vem com o rádio escolhido (ex.: "Reconectar"): conecta ao abrir.
  useEffect(() => { if (deviceId && !problem) void radio.connect(deviceId); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = st.device?.name ?? '';
  const connect = (id: string) => { setShown(undefined); setPicked(id); void radio.connect(id); };
  const other = () => { radio.disconnect(); setShown(undefined); setPicked(null); };
  const region = link.region;
  const fail = shown ?? (picked && st.phase === 'connected' && link.state === 'failed' ? piuProblem(link.problem) : undefined);

  let body;
  if (fail && fail.kind !== 'region') {
    const retry = () => { const id = picked ?? st.device?.id; if (id) connect(id); };
    body = fail.kind === 'band' ? (
      <Result tone="err" icon="settings_input_antenna" title={t('piu.band.title')} desc={t('piu.band.d', { freq: region ? freqLabel(piuRadio(region).freqHz) : '' })}
        chips={region ? [['public', `${t(regionKey(region))} · ${bandLabel(region)}`]] : []}
        primary={[t('piu.changeRegion'), () => ref.current?.close(onRegion)]} secondary={[t('piu.boards'), () => { void Linking.openURL(BOARDS_URL).catch(() => {}); }]} />
    ) : fail.kind === 'notRNode' ? (
      <Result tone="neutral" icon="memory" title={t('piu.fail.notRNode')} desc={t('piu.notRNode.d')}
        link={[t('piu.howInstall'), () => { void Linking.openURL(RNODE_INSTALL_URL).catch(() => {}); }]} secondary={[t('lora.other'), other]} />
    ) : fail.kind === 'code' ? (
      <Result tone="err" icon="error" title={t('piu.fail.code', { code: fail.code })} desc={t('piu.code.d')} primary={[t('lora.retry'), retry]} secondary={[t('lora.other'), other]} />
    ) : (
      <Result tone="err" icon="error" title={t('piu.fail.other')} desc={t('piu.other.d', { problem: link.problem ?? '' })} primary={[t('lora.retry'), retry]} secondary={[t('lora.other'), other]} />
    );
  } else if (up) {
    body = (
      <Result tone="ok" icon="check" title={t('piu.ok')} desc={[name, region ? t(regionKey(region)) : '', region ? freqLabel(piuRadio(region).freqHz) : ''].filter(Boolean).join(' · ')}
        chips={link.superNodes ? [['hub', link.gateways ? t('lora.superNode.gateway', { count: link.superNodes }) : t('lora.superNode', { count: link.superNodes })]] : []}
        primary={[t('piu.done'), () => ref.current?.close(onClose)]} />
    );
  } else if (st.phase === 'error' && picked) {
    const why = radioErrorKind(st.error);
    const fixes: [IconName, string, string][] = [
      ['bluetooth_searching', t('piu.fix.near'), t('piu.fix.near.d')],
      ['pin', t('piu.fix.pin'), t('piu.fix.pin.d')],
      ['mobile_off', t('piu.fix.free'), t('piu.fix.free.d')],
    ];
    if (why === 'pin') fixes.unshift(fixes.splice(1, 1)[0]!);
    const title = why === 'pin' ? t('piu.err.pin') : why === 'timeout' ? t('lora.err.timeout') : why === 'perm' ? t('lora.err.perm') : why === 'btOff' ? t('lora.err.btOff') : t('lora.err.title');
    body = <Result tone="err" icon="link_off" title={title} desc={t('lora.err.body', { name })} tips={fixes} primary={[t('lora.retry'), () => connect(picked)]} secondary={[t('lora.other'), other]} />;
  } else if (picked && st.phase === 'pairing') {
    body = <PinCard />;
  } else if (picked) {
    const configuring = st.phase === 'connected';
    const steps: [string, 'done' | 'now' | 'wait', string?][] = [
      [t('lora.step.paired'), configuring ? 'done' : 'now'],
      [t('piu.step.channel'), configuring ? 'now' : 'wait', region ? `${t(regionKey(region))} · ${freqLabel(piuRadio(region).freqHz)}` : undefined],
      [t('lora.step.join'), 'wait'],
    ];
    body = (
      <View style={{ gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings_input_antenna" size={22} w={300} /></View>
          <View style={{ gap: 2 }}><T size={18} w={700} ls={-0.025}>{name}</T><T size={12} color={c.ink2}>{t('piu.type.piu')}</T></View>
        </View>
        <View style={{ gap: 14, paddingHorizontal: 2 }}>
          {steps.map(([label, k, sub]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: k === 'done' ? c.ink : 'transparent', borderWidth: k === 'wait' ? 1.5 : 0, borderColor: c.line2 }}>
                {k === 'done' ? <Icon name="check" size={15} w={400} color={c.invink} /> : k === 'now' ? <ActivityIndicator size="small" color={c.ink} /> : null}
              </View>
              <View style={{ gap: 2, paddingTop: 2 }}>
                <T size={14} w={k === 'now' ? 620 : 450} color={k === 'wait' ? c.ink3 : c.ink}>{label}</T>
                {sub && k !== 'wait' ? <T size={11.5} w={500} mono color={c.ink2}>{sub}</T> : null}
              </View>
            </View>
          ))}
        </View>
        <Button variant="outline" label={t('common.cancel')} onPress={other} />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
          <ActivityIndicator size="small" color={c.ink} /><T size={11} w={500} mono ls={0.05} color={c.ink2}>{t('lora.sheet.scanning')}</T>
        </View>
        <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {st.devices.length ? st.devices.map((d, i) => {
            const s = signalOf(d.rssi);
            return (
              <Pressable key={d.id} onPress={() => connect(d.id)} accessibilityRole="button" accessibilityLabel={`${d.name}, ${t(`lora.sig.${s.word}`)}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings_input_antenna" size={20} w={300} /></View>
                <T size={14} w={600} numberOfLines={1} style={{ flex: 1 }}>{d.name}</T>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
                    {[5, 8, 11, 14].map((h, k) => <View key={h} style={{ width: 4, height: h, borderRadius: 1, backgroundColor: k < s.bars ? c.ink : c.bg3 }} />)}
                  </View>
                  <T size={10} w={500} mono color={c.ink2}>{t(`lora.sig.${s.word}`)}</T>
                </View>
              </Pressable>
            );
          }) : (
            <View style={{ alignItems: 'center', gap: 14, paddingVertical: 26, paddingHorizontal: 18 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings_input_antenna" size={24} w={300} /></View>
              <T size={14} w={600}>{t('lora.sheet.empty')}</T>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 2 }}>
          <Icon name="help" size={15} w={400} color={c.ink2} />
          <T size={12} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('piu.sheet.help')}</T>
        </View>
      </View>
    );
  }

  return (
    <Sheet ref={ref} label={t('lora.sheet.title')} onClose={() => { if (!up && !problem) radio.disconnect(); onClose(); }} gap={14}>
      {!picked && !shown ? (
        <View style={{ gap: 6, marginTop: 6, paddingHorizontal: 2 }}>
          <T size={22} w={700} ls={-0.035} accessibilityRole="header">{t('lora.sheet.title')}</T>
          <T size={13} lh={1.45} color={c.ink2}>{t('piu.sheet.intro')}</T>
        </View>
      ) : null}
      {body}
    </Sheet>
  );
}

/** 3e–3i: a mesma folha de resultado (ícone, título, texto, fichas ou dicas, link, botões). */
function Result({ tone, icon, title, desc, chips, tips, link, primary, secondary }: {
  tone: 'ok' | 'err' | 'neutral'; icon: IconName; title: string; desc: string; chips?: [IconName, string][]; tips?: [IconName, string, string][];
  link?: [string, () => void]; primary?: [string, () => void]; secondary?: [string, () => void];
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 14, marginTop: 6 }}>
      <View style={{ width: 52, height: 52, borderRadius: 18, marginLeft: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'ok' ? c.ink : tone === 'err' ? c.errbg : 'transparent', borderWidth: tone === 'neutral' ? 1.5 : 0, borderColor: c.line2 }}>
        <Icon name={icon} size={26} w={400} color={tone === 'ok' ? c.invink : tone === 'err' ? c.err : c.ink} />
      </View>
      <View style={{ gap: 6, paddingHorizontal: 2 }}>
        <T size={20} w={700} ls={-0.03} lh={1.2} accessibilityRole="header">{title}</T>
        <T size={13} lh={1.5} color={c.ink2}>{desc}</T>
      </View>
      {chips?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(([ic, text]) => (
            <View key={text} style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name={ic} size={15} w={400} /><T size={11.5} w={500} mono>{text}</T>
            </View>
          ))}
        </View>
      ) : null}
      {tips?.length ? (
        <View style={{ borderRadius: 18, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {tips.map(([ic, tt, d], i) => (
            <View key={ic} style={{ flexDirection: 'row', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={ic} size={17} w={300} />
              <T size={12.5} lh={1.4} style={{ flex: 1 }}><T size={12.5} w={620}>{tt}</T> <T size={12.5} color={c.ink2}>{d}</T></T>
            </View>
          ))}
        </View>
      ) : null}
      {link ? (
        <Pressable onPress={link[1]} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 }}>
          <Icon name="open_in_new" size={17} w={400} /><T size={13} w={650} style={{ textDecorationLine: 'underline' }}>{link[0]}</T>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 2 }}>
        {primary ? <Pill label={primary[0]} onPress={primary[1]} strong /> : null}
        {secondary ? <Pill label={secondary[0]} onPress={secondary[1]} /> : null}
      </View>
    </View>
  );
}

/** Botão do resultado: 46 de altura, o rótulo quebra em até duas linhas ("Ver placas compatíveis"). */
function Pill({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 46, paddingHorizontal: 10, borderRadius: 23, backgroundColor: strong ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <T size={13.5} w={650} lh={1.15} align="center" numberOfLines={2} color={strong ? c.invink : c.ink}>{label}</T>
    </Pressable>
  );
}

/** 3c: o PIN só aparece na tela da placa (botão PRG); o cartão fica embaixo do aviso do Android. */
function PinCard() {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 14 }}>
      <T size={18} w={700} ls={-0.03}>{t('lora.pin.title')}</T>
      <View style={{ alignSelf: 'center', width: 236, height: 104, marginVertical: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ position: 'absolute', right: -2, top: 16, width: 14, height: 8, borderRadius: 2, backgroundColor: c.ink3 }} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: 10, borderRadius: 10, backgroundColor: c.bg3, borderWidth: 1.5, borderColor: c.line2 }} />
        <View style={{ position: 'absolute', left: -4, top: 40, width: 10, height: 22, borderRadius: 3, backgroundColor: c.ink3 }} />
        <View style={{ position: 'absolute', left: 30, top: 16, width: 120, height: 68, borderRadius: 5, backgroundColor: '#050505', borderWidth: 3, borderColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <T size={9} w={500} mono ls={0.1} color="#9FE0A8">PIN</T>
          <T size={21} w={600} mono ls={0.06} color="#9FE0A8">••••••</T>
        </View>
        <View style={{ position: 'absolute', left: 170, top: 20, alignItems: 'center', gap: 3 }}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.ink3 }} /><T size={8.5} w={600} mono color={c.ink2}>RST</T></View>
        <View style={{ position: 'absolute', left: 170, top: 58, alignItems: 'center', gap: 3 }}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.ink }} /><T size={8.5} w={700} mono>PRG</T></View>
      </View>
      <T size={13} lh={1.5}>{t('piu.pin.body')}</T>
      <T size={12} lh={1.45} color={c.ink2}>{t('piu.pin.note')}</T>
    </View>
  );
}
