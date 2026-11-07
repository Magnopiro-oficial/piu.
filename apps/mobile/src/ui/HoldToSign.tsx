import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useT } from '../i18n';
import { HOLD, holdFrame, holdRelease } from '../lib/walletMotion';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { T } from './T';

/**
 * "Segure para assinar e enviar" (design §2): o botão enche da esquerda para a direita em 900 ms enquanto
 * pressionado (camada `invink` a 24 %), encolhe 3 % e a digital engrossa. Soltar antes zera a camada na hora,
 * a escala volta em 200 ms com leve overshoot e a dica vira "Continue segurando até completar".
 *
 * A linha de dica abaixo do botão é a mesma do design ("A chave nunca sai deste aparelho"); quando há um aviso
 * real (valor acima do saldo, endereço inválido, erro da cotação ou do envio), ele aparece nesse mesmo lugar,
 * em destaque, sem acrescentar linhas à folha.
 *
 * Acessibilidade (no lugar do botão extra "Assinar sem segurar"): com leitor de tela, o toque duplo assina
 * direto, e a ação de acessibilidade "ativar" faz o mesmo (controle por botão, teclado externo).
 * Com "reduzir movimento", o enchimento não anima (continua sendo preciso segurar os 900 ms).
 */
/** Modo nó: camada `rgba(255,255,255,.22)` e volta de `.3s cubic-bezier(.2,.85,.3,1)` ao soltar antes (TELAS-NOVAS.md). */
const NODE_FILL_OPACITY = 0.22;
const NODE_RELEASE = { dur: 300, bezier: [0.2, 0.85, 0.3, 1] as [number, number, number, number] };

export function HoldToSign({ onSign, disabled, note, look = 'wallet', label, holdingLabel, doneLabel }: { onSign: () => void; disabled?: boolean;
  /** Aviso real no lugar da dica (design: a dica vira texto 600 `ink`). */
  note?: string | null;
  /**
   * `node`: o mesmo gesto e o mesmo tempo (0,9 s) nas telas do modo nó (TELAS-NOVAS.md, "Segurar para assinar"):
   * botão de 58 px, camada a 22 % que cresce em `.9s linear` e, ao soltar antes, volta a 0 em
   * `.3s cubic-bezier(.2,.85,.3,1)`; aos 0,9 s o ícone vira `check` com `doneLabel`. Sem linha de dica (só `note`).
   */
  look?: 'wallet' | 'node'; label?: string; holdingLabel?: string; doneLabel?: string }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const p = useRef(new Animated.Value(0)).current; // camada que enche (zera na hora ao soltar)
  const s = useRef(new Animated.Value(0)).current; // escala do botão (volta com transição)
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const t0 = useRef(0);
  const done = useRef(false);
  // `pressIn` e `pressOut` podem chegar no mesmo ciclo (toque rápido): o ref vê o valor atual, o estado não.
  const holdingRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const [width, setWidth] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const [signed, setSigned] = useState(false);
  const node = look === 'node';
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);
  useEffect(() => () => anim.current?.stop(), []);

  const signNow = () => { if (!done.current && !disabled) { done.current = true; setSigned(true); onSign(); } };
  const start = () => {
    if (disabled || done.current) return;
    anim.current?.stop();
    t0.current = Date.now();
    holdingRef.current = true;
    setHolding(true); setHint(false);
    p.setValue(0); s.setValue(0);
    const lin = { toValue: 1, duration: HOLD.dur, easing: Easing.linear, useNativeDriver: true };
    anim.current = Animated.parallel([Animated.timing(p, lin), Animated.timing(s, lin)]);
    anim.current.start(({ finished }) => {
      if (!finished) return;
      done.current = true;
      holdingRef.current = false;
      setHolding(false); setSigned(true);
      onSign();
    });
  };
  const release = () => {
    if (done.current || !holdingRef.current) return;
    anim.current?.stop();
    const r = holdRelease(holdFrame(Date.now() - t0.current).pct);
    if (node) Animated.timing(p, { toValue: r.pct, duration: NODE_RELEASE.dur, easing: Easing.bezier(...NODE_RELEASE.bezier), useNativeDriver: true }).start();
    else p.setValue(r.pct);
    Animated.timing(s, { toValue: 0, duration: HOLD.release.dur, easing: Easing.bezier(...HOLD.release.bezier), useNativeDriver: true }).start();
    holdingRef.current = false;
    setHolding(false); setHint(r.hint);
  };
  // Leitor de tela: o toque duplo chega como onPress sem gesto de segurar → assina direto (acessibilidade).
  const press = () => { if (screenReader) signNow(); };
  // Nova tentativa depois de uma falha (o pai remonta ou muda `disabled`): libera o gesto de novo.
  useEffect(() => { if (!disabled) { done.current = false; setSigned(false); } }, [disabled]);

  const fill = reduceMotion
    ? { opacity: 0 }
    : { transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0] }) }, { scaleX: p }] };
  const shown = node ? note : note || (hint ? t('pay.hintHold') : t('pay.hint'));
  const strong = !!note || (!node && hint);
  const base = label ?? t('pay.hold');
  const showDone = signed && !!doneLabel;
  const text = showDone ? doneLabel : holding ? (holdingLabel ?? t('pay.holding')) : base;
  const h = node ? 58 : 56;
  return (
    <View style={{ gap: 8 }}>
      <Animated.View style={{ transform: [{ scale: reduceMotion || node ? 1 : s.interpolate({ inputRange: [0, 1], outputRange: [1, 1 - HOLD.shrink] }) }] }}>
        <Pressable
          onPressIn={start} onPressOut={release} onPress={press} disabled={disabled} delayLongPress={HOLD.dur}
          accessibilityRole="button" accessibilityLabel={base} accessibilityHint={node ? t('dialog.holdHint') : t('pay.hint')} accessibilityState={{ disabled, busy: holding }}
          accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate') signNow(); }}
          onLayout={e => setWidth(e.nativeEvent.layout.width)}
          // Design: `touch-action:none; user-select:none` e sem menu de contexto (no navegador).
          style={{ height: h, borderRadius: h / 2, backgroundColor: c.ink, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1,
            ...(Platform.OS === 'web' ? ({ userSelect: 'none', touchAction: 'none' } as object) : {}) }}>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', backgroundColor: c.invink, opacity: node ? NODE_FILL_OPACITY : HOLD.fillOpacity }, fill]} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: node ? 10 : 8 }}>
            <Animated.View style={{ transform: [{ scale: reduceMotion ? 1 : p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }}>
              {/* O design engrossa a digital de 400 a 700; o app só tem os traços 300 e 400: fica em 400 e cresce um pouco. */}
              <Icon name={showDone ? 'check' : 'fingerprint'} size={22} w={400} color={c.invink} />
            </Animated.View>
            <T size={16} w={600} color={c.invink} numberOfLines={1}>{text}</T>
          </View>
        </Pressable>
      </Animated.View>
      {shown ? <T size={12} lh={1.4} w={strong ? 600 : 400} align="center" color={strong ? c.ink : c.ink2} accessibilityLiveRegion="polite">{shown}</T> : null}
    </View>
  );
}
