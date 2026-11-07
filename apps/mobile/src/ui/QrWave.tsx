import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Image, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../i18n';
import { QR_WAVE, qrIsFinder, qrWaveModules, qrWavePath, qrWaveTotal, scanFrame } from '../lib/walletMotion';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { fadeStyle, popStyle, useClock } from './motion';
import { T } from './T';

const ICON = require('../../assets/icon.png');
/** Relógio da coreografia do cartão (pop do cartão, pop do ícone a 1 s, dica a 1,1 s). */
const CLOCK_TOTAL = 1600;

/**
 * QR de verdade (gerador de Kazuhiko Arase) com a animação do design/Desktop: cartão branco (raio 26, padding 16)
 * entra com `piuPop`; cada módulo nasce do próprio centro com `piuQr .35s cubic-bezier(.2,.9,.3,1.5)`,
 * atraso 120 ms + distância ao centro × 28 ms (onda do centro para fora); ícone do app no meio (`piuPop` a 1 s);
 * linha de leitura `piuScan 2.6s` a partir de 1,1 s. Tocar no código recomeça a onda (nova semente, sem os
 * 120 ms iniciais, como no design; o cartão, o ícone e a dica não voltam a entrar); o conteúdo do QR é
 * sempre o mesmo endereço. Nível de correção H (30 %), como pede a especificação, porque o ícone cobre o
 * centro: um endereço SS58 (48 caracteres) não cabe na versão 3 (29×29) em H, então a grade sai mais densa
 * (33×33) no mesmo quadrado de 200 px, com os raios dos cantos reduzidos na mesma proporção.
 * Sempre preto no branco: leitores falham com as cores invertidas do tema escuro.
 */
export function QrWave({ value, label, size = 200, level = 'H' }: { value: string; label: string; size?: number; level?: 'L' | 'M' | 'Q' | 'H' }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const [seed, setSeed] = useState(0);
  // Cartão, ícone e dica entram uma vez só (o toque no código não os reanima).
  const clock = useClock(CLOCK_TOTAL, 0);

  const { mods, n, total } = useMemo(() => {
    const qr = qrcode(0, level);
    qr.addData(value, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    const px = size / count; // tamanho do módulo em px → raios de 2 px (dados) e 1 px (localizadores) em módulos
    const k = QR_WAVE.refGrid / count; // grade mais densa que a de 29: raios proporcionalmente menores
    const list = qrWaveModules(count, (r, cc) => qr.isDark(r, cc), (r, cc) => ((qrIsFinder(r, cc, count) ? 1 : 2) * k) / px);
    return { mods: list, n: count, total: qrWaveTotal(list) };
  }, [value, level, size]);

  // Onda: um caminho SVG recalculado por quadro (rAF) até o último módulo nascer; depois fica parado.
  const [d, setD] = useState(() => (reduceMotion ? qrWavePath(mods, total) : ''));
  useEffect(() => {
    if (reduceMotion) { setD(qrWavePath(mods, total)); return; }
    let raf = 0;
    const t0 = Date.now();
    const skip = seed > 0 ? QR_WAVE.base : 0; // ao regenerar, a onda parte na hora
    setD('');
    const tick = () => {
      const now = Date.now() - t0 + skip;
      setD(qrWavePath(mods, now));
      if (now < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mods, total, seed, reduceMotion]);

  // Linha de leitura: ciclo de 2,6 s (ease-in-out) começando em 1,1 s, para sempre.
  const scan = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (reduceMotion) { scan.setValue(0); return; }
    scan.setValue(0);
    const loop = Animated.loop(Animated.timing(scan, { toValue: 1, duration: QR_WAVE.scan.period, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    const timer = setTimeout(() => loop.start(), QR_WAVE.scan.delay);
    return () => { clearTimeout(timer); loop.stop(); };
  }, [scan, seed, reduceMotion]);
  const scanTrack = size; // o trilho ocupa a altura da grade (16 px de margem em cima e embaixo)
  const scanStyle = reduceMotion ? { opacity: 0 } : {
    opacity: scan.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [scanFrame(0).opacity, 1, 1, scanFrame(1).opacity] }),
    transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, scanTrack] }) }],
  };

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Pressable onPress={() => setSeed(s => s + 1)} accessibilityRole="image" accessibilityLabel={label} accessibilityHint={t('wallet.receiveSheet.qr.hint')}>
        {/* Sombra do design com espalhamento negativo (só aparece embaixo): `boxShadow` da nova arquitetura do RN. */}
        <Animated.View style={[{
          padding: 16, borderRadius: 26, backgroundColor: '#ffffff',
          boxShadow: `0 0 0 1px ${c.line2}, 0 24px 56px -22px rgba(0,0,0,0.35)`,
        }, popStyle(clock, QR_WAVE.card.delay, QR_WAVE.card.dur, QR_WAVE.card.bezier)]}>
          <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
            <Path d={d} fill="#0c0c0c" />
          </Svg>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 16, bottom: 16 }}>
            <Animated.View style={[{
              position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: '#0c0c0c',
              shadowColor: '#0c0c0c', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
            }, scanStyle]} />
          </View>
          <Animated.View pointerEvents="none" style={[{
            position: 'absolute', left: '50%', top: '50%', marginLeft: -24, marginTop: -24, width: 48, height: 48, borderRadius: 13, backgroundColor: '#ffffff', padding: 4,
          }, popStyle(clock, QR_WAVE.icon.delay, QR_WAVE.icon.dur, QR_WAVE.icon.bezier)]}>
            <Image source={ICON} accessibilityIgnoresInvertColors style={{ width: 40, height: 40, borderRadius: 10 }} />
          </Animated.View>
        </Animated.View>
      </Pressable>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, fadeStyle(clock, 1100, 400)]}>
        <Icon name="refresh" size={14} color={c.ink2} />
        <T mono size={11.5} color={c.ink2}>{t('wallet.receiveSheet.tapNew')}</T>
      </Animated.View>
    </View>
  );
}
