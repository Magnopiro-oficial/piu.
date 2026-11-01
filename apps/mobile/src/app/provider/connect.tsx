import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { PAIR_CODE, PROV_FAMILIES } from '../../data/network';
import { useNetwork } from '../../state/network';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { StepHeader } from '../../ui/StepHeader';
import { T } from '../../ui/T';

type Scan = 'searching' | 'found' | 'pairing';

/** Passo 2 de 4: instalar o Piu Node (do celular, sem internet, ou pelo terminal), encontrar e parear. */
export default function ProvConnect() {
  const { c } = useTheme();
  const { draft, setDraft, devices } = useNetwork();
  const { showToast } = useStore();
  const fam = PROV_FAMILIES.find(f => f.id === draft.fam) ?? PROV_FAMILIES[0];
  const [scan, setScan] = useState<Scan>('searching');
  const [pkg, setPkg] = useState(0);
  const pkgTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Procura o equipamento na rede local (simulado: 1,9 s).
  useEffect(() => {
    const t = setTimeout(() => setScan('found'), 1900);
    return () => { clearTimeout(t); clearInterval(pkgTimer.current); };
  }, []);

  const sendPkg = () => {
    if (pkg > 0) return;
    pkgTimer.current = setInterval(() => setPkg(p => { const n = Math.min(100, p + 7); if (n >= 100) clearInterval(pkgTimer.current); return n; }), 90);
  };
  const title = fam.isAp ? 'Configure o roteador comum' : fam.isRadio ? 'Conecte o rádio LoRa' : `Instale o Piu Node no ${fam.short}`;
  const parents = devices.filter(d => !d.passive && d.cls !== 'Super Node');
  const apSteps: [string, string][] = [
    ['Nome da rede (SSID)', `piu.${draft.pub} · o mesmo nome público`], ['Desative o isolamento de clientes', 'às vezes chamado “AP isolation”'],
    ['Permita multicast e mDNS', 'para os celulares se encontrarem'], ['Ligue a um nó seu', 'por cabo ou repetição sem fio'],
  ];

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <StepHeader step="PASSO 2 DE 4 · CONEXÃO" title={title} />
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {fam.install && (
            <>
              <Segmented label="Forma de instalação" value={draft.install} onChange={install => setDraft({ install })}
                options={[['phone', 'Do celular'], ['term', 'Pelo terminal']]} />
              {draft.install === 'phone' ? (
                <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
                  <T size={13.5} lh={1.4} color={c.ink2}>Sem internet: conecte o celular ao Wi-Fi do equipamento e envie o pacote assinado daqui.</T>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
                    <Icon name="deployed_code" size={22} w={300} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={13} w={500} mono numberOfLines={1}>{fam.pkg}</T>
                      <T size={12} color={c.ink2}>2,1 MB · assinado Lunes · 4C9A…E1F0</T>
                    </View>
                  </View>
                  <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pkg }} style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${pkg}%`, backgroundColor: c.ink }} />
                  </View>
                  <Button label={pkg >= 100 ? 'Pacote instalado' : pkg > 0 ? `Enviando… ${Math.round(pkg)}%` : 'Enviar pacote'} height={44} variant={pkg >= 100 ? 'soft' : 'primary'}
                    onPress={sendPkg} left={<Icon name={pkg >= 100 ? 'check' : 'upload'} size={18} color={pkg >= 100 ? c.ink : c.invink} />} />
                </View>
              ) : (
                <>
                  <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.ink, gap: 10 }}>
                    <Pressable onPress={() => showToast({ icon: 'content_copy', title: 'Comando copiado', body: fam.cmd ?? '' })} accessibilityRole="button" accessibilityLabel={`Copiar comando: ${fam.cmd}`}
                      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <T size={12.5} mono color={c.invink} style={{ opacity: 0.5 }}>$</T>
                      <T size={12.5} mono lh={1.55} color={c.invink} style={{ flex: 1 }} selectable>{fam.cmd}</T>
                      <Icon name="content_copy" size={16} w={300} color={c.invink} style={{ opacity: 0.7 }} />
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <T size={12.5} mono color={c.invink} style={{ opacity: 0.5 }}>$</T>
                      <T size={12.5} mono color={c.invink} selectable>piu-node pair</T>
                    </View>
                  </View>
                  <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>O pacote confere a própria assinatura antes de instalar. Se não conferir, nada é instalado.</T>
                </>
              )}
            </>
          )}
          {fam.isRadio && (
            <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, flexDirection: 'row', gap: 12 }}>
              <Icon name="usb" size={22} w={300} />
              <T size={13.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Ligue o rádio na porta USB de um <T size={13.5} w={600}>Home Node ou Gateway Local</T> que você já tenha. O adapter LoRa é instalado sozinho, assinado.</T>
            </View>
          )}
          {fam.isAp && (
            <>
              <View style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
                {apSteps.map(([t, d], i) => (
                  <View key={t} style={{ flexDirection: 'row', gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={11} w={600} color={c.invink}>{i + 1}</T></View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={14} w={600}>{t}</T>
                      <T size={11.5} mono lh={1.45} color={c.ink2}>{d}</T>
                    </View>
                  </View>
                ))}
              </View>
              <T size={12.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>Ele manda e recebe ao vivo. Guardar para quem está fora e assinar recibos fica com o nó pai.</T>
            </>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8 }}>
          <T size={11.5} w={500} mono ls={0.05} color={c.ink2}>PROCURANDO NA REDE LOCAL</T>
          <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }} />
        </View>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {scan === 'searching' ? (
            <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
              <Ping />
              <T size={14} lh={1.4} color={c.ink2}>Procurando equipamentos com Piu Node…</T>
            </View>
          ) : (
            <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name={fam.icon} size={23} color={c.invink} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={15.5} w={600}>{fam.found}</T>
                  <T size={11.5} mono color={c.ink2}>{fam.addr}</T>
                </View>
              </View>
              {scan === 'found' && <Button label={fam.isAp ? 'Vincular a um nó seu' : 'Parear com este equipamento'} height={46} onPress={() => setScan('pairing')} />}
              {scan === 'pairing' && fam.isAp && (
                <View style={{ gap: 8 }}>
                  <T size={13.5} color={c.ink2}>Ligado a qual nó seu?</T>
                  <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                    {parents.map(p => {
                      const on = draft.parent === p.id;
                      return (
                        <Pressable key={p.id} onPress={() => setDraft({ parent: p.id })} accessibilityRole="radio" accessibilityState={{ checked: on }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1.5, borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.bg2 : 'transparent' }}>
                          <Icon name={p.icon} size={20} w={300} />
                          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                            <T size={14} w={600}>{p.name}</T>
                            <T size={11} mono color={c.ink2}>{p.pub}</T>
                          </View>
                          <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: c.ink, opacity: on ? 1 : 0 }} />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Button label="Confirmar vínculo" height={46} disabled={!draft.parent} style={{ marginTop: 4 }} onPress={() => router.push('/provider/test')} />
                </View>
              )}
              {scan === 'pairing' && !fam.isAp && (
                <View style={{ gap: 10 }}>
                  <T size={13.5} color={c.ink2}>Confira se o mesmo código aparece {fam.where}:</T>
                  <View accessibilityLabel={'Código de pareamento ' + PAIR_CODE.join(' ')} style={{ flexDirection: 'row', gap: 6 }}>
                    {PAIR_CODE.map((d, i) => <CodeDigit key={i} v={d} delay={i * 60} />)}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button label="Não confere" variant="outline" height={46} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => setScan('found')} />
                    <Button label="Confere" height={46} style={{ flex: 1.3, paddingHorizontal: 4 }} onPress={() => router.push('/provider/test')} />
                  </View>
                </View>
              )}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 4, paddingHorizontal: 4 }}>
            <Icon name="key" size={17} w={300} />
            <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>O pareamento cria uma identidade técnica para o equipamento, separada da sua identidade de conversa.</T>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Ponto com anel pulsando (procurando). */
function Ping() {
  const { c, reduceMotion } = useTheme();
  const r = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(r, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, r]);
  return (
    <View style={{ width: 40, height: 40 }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink,
        opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />
      <View style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, borderRadius: 8, backgroundColor: c.ink }} />
    </View>
  );
}

/** Dígito do código com “pop” defasado. */
function CodeDigit({ v, delay }: { v: string; delay: number }) {
  const { c, reduceMotion } = useTheme();
  const s = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.sequence([Animated.delay(delay), Animated.spring(s, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true })]).start(); }, [reduceMotion, s, delay]);
  return (
    <Animated.View style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: s, transform: [{ scale: s.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>
      <T size={22} w={600} mono>{v}</T>
    </Animated.View>
  );
}

