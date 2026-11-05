import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SPLASH, dotDelays, splashPlan } from '../lib/splashCore';
import { curves } from '../theme/tokens';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/**
 * Tela de abertura animada (design: overlay `splashOpen`):
 * - entra logo depois que o splash nativo some (mesma cor de fundo, então não há salto);
 * - ícone com pop, "piu." subindo, pontinhos piscando com "procurando nós por perto";
 * - depois de 900 ms sai com scale 1,08 + fade (420 ms) e o app entra com scale 0,965→1 (500 ms).
 * Com "reduzir movimento" do sistema, nada anima: a tela fica parada e corta no fim da espera.
 */

const POP = Easing.bezier(...curves.pop);
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1); // `ease` do CSS
const OUT = Easing.bezier(0.4, 0, 0.6, 1);
const REVEAL = Easing.bezier(0.2, 0.85, 0.3, 1);
const ICON = require('../../assets/icon.png');
const DOTS = dotDelays(3);

/** Um pontinho que sobe 4 px e acende, em loop de 1 s, defasado de `delay` ms. */
function Dot({ delay, animate }: { delay: number; animate: boolean }) {
  const { c } = useTheme();
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    // Keyframes do design: 0 %/60 %/100 % em repouso, 30 % no alto → 300 ms sobe, 300 ms desce, 400 ms parado.
    const up = SPLASH.dot.period * 0.3;
    const rest = SPLASH.dot.period - 2 * up;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1, duration: up, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(p, { toValue: 0, duration: up, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.delay(rest),
    ]));
    const t = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(t); loop.stop(); };
  }, [animate, delay, p]);
  const style = animate
    ? { opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }
    : { opacity: 0.6 };
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }, style]} />;
}

interface SplashProps {
  /** Chamado quando a saída começa (o app deve começar a entrar). */
  onExit: () => void;
  /** Chamado quando a tela pode ser desmontada. */
  onDone: () => void;
}

export function Splash({ onExit, onDone }: SplashProps) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const plan = splashPlan(reduceMotion);
  const { animate } = plan;
  // Com movimento reduzido tudo começa já no lugar (1) e a saída não anima.
  const icon = useRef(new Animated.Value(animate ? 0 : 1)).current; // 0→1 progresso do pop
  const iconScale = useRef(new Animated.Value(animate ? 0.4 : 1)).current;
  const up = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const fade = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const out = useRef(new Animated.Value(0)).current; // 0 visível → 1 saiu
  const cb = useRef({ onExit, onDone });
  cb.current = { onExit, onDone };

  useEffect(() => {
    if (animate) {
      Animated.parallel([
        // Pop do ícone: 0,4→1,14 nos primeiros 70 % e 1,14→1 no resto, com a curva `pop` em cada trecho (como o CSS faz por keyframe).
        Animated.sequence([
          Animated.delay(SPLASH.pop.delay),
          Animated.parallel([
            Animated.timing(icon, { toValue: 1, duration: SPLASH.pop.dur * 0.7, easing: POP, useNativeDriver: true }),
            Animated.timing(iconScale, { toValue: 1.14, duration: SPLASH.pop.dur * 0.7, easing: POP, useNativeDriver: true }),
          ]),
          Animated.timing(iconScale, { toValue: 1, duration: SPLASH.pop.dur * 0.3, easing: POP, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(SPLASH.up.delay),
          Animated.timing(up, { toValue: 1, duration: SPLASH.up.dur, easing: EASE, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(SPLASH.fade.delay),
          Animated.timing(fade, { toValue: 1, duration: SPLASH.fade.dur, easing: EASE, useNativeDriver: true }),
        ]),
      ]).start();
    }
    const exitT = setTimeout(() => {
      cb.current.onExit();
      if (!animate) { cb.current.onDone(); return; }
      Animated.timing(out, { toValue: 1, duration: plan.exit, easing: OUT, useNativeDriver: true })
        .start(({ finished }) => { if (finished) cb.current.onDone(); });
    }, plan.hold);
    return () => clearTimeout(exitT);
  }, [animate, plan.exit, plan.hold, icon, iconScale, up, fade, out]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.fill,
        { backgroundColor: c.bg },
        { opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] },
      ]}
    >
      <Animated.Image
        source={ICON}
        accessibilityLabel="Piu"
        style={{ width: 104, height: 104, borderRadius: 26, opacity: icon.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: iconScale }] }}
      />
      <Animated.View style={{ opacity: up.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ translateY: up.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
        <T size={40} w={750} ls={-0.07} lh={1}>
          piu<T size={40} w={750} ls={-0.07} lh={1} color={c.ink3}>.</T>
        </T>
      </Animated.View>
      <Animated.View style={[styles.bottom, { opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
        <View style={styles.dots}>
          {DOTS.map((d) => <Dot key={d} delay={d} animate={animate} />)}
        </View>
        <T mono size={11.5} w={500} ls={0.04} color={c.ink2}>{t('splash.searching')}</T>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Mostra a abertura por cima de `children` e, quando ela sai, faz o conteúdo entrar
 * com scale 0,965→1 + fade (design: `piuReveal`). Os filhos ficam montados desde o início,
 * então navegação por link, guardas e bloqueio seguem funcionando por baixo.
 */
export function SplashGate({ children }: { children: ReactNode }) {
  const { reduceMotion } = useTheme();
  const animate = !reduceMotion;
  const [open, setOpen] = useState(true);
  const reveal = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const onExit = () => {
    if (!animate) { reveal.setValue(1); return; }
    Animated.timing(reveal, { toValue: 1, duration: SPLASH.reveal, easing: REVEAL, useNativeDriver: true }).start();
  };
  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={{ flex: 1, opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1] }) }] }}>
        {children}
      </Animated.View>
      {open && <Splash onExit={onExit} onDone={() => setOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100, alignItems: 'center', justifyContent: 'center', gap: 18 },
  bottom: { position: 'absolute', bottom: 70, alignItems: 'center', gap: 12 },
  dots: { flexDirection: 'row', gap: 6 },
});
