import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { fmtNumber, useT } from '../i18n';
import {
  PAY, coinKeyframes, cubicBezier, irisRadius, irisScaleRanges, payInsets, payStage, popRange, routeLength, routeStops, shortHash, typedChars, type PayStage, type Point,
} from '../lib/walletMotion';
import { formatLunes } from '../lib/lunesRpc';
import type { WalletTransferRecord } from '../lib/walletTransfer';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { alpha, at, concat, EASE_IN, EASE_OUT, fadeStyle, LINEAR, popStyle, range, ringStyle, seg, upStyle } from './motion';
import { T } from './T';

export interface PayResult { record: WalletTransferRecord | null; error: string | null }

const ACircle = Animated.createAnimatedComponent(Circle);
const APolyline = Animated.createAnimatedComponent(Polyline);
const APath = Animated.createAnimatedComponent(Path);
const SIG_CHARS = PAY.type.chars;

/** "5Dxx…abcd" para o destinatário (endereço SS58, sem nome de contato). */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * Cena de pagamento em tela cheia (design: cronologia de ~5 s a partir do fim do gesto):
 * íris abre do botão; "Assinando" com anel, digital e assinatura digitada; "Assinada"; valor vira moeda e
 * percorre a rota; destinatário pulsa; círculo e check; resumo e "Concluir" (íris fecha em direção ao cartão).
 *
 * O envio é o real (biometria → sr25519 → nó Lunes): a cena espera em 1,15 s até a assinatura existir e só
 * então segue. A rota mostrada é a verdadeira de uma transferência on-chain (Você → rede Lunes → destinatário),
 * e o status do topo e o resumo vêm do registro devolvido. Se falhar, mostra o erro em vez de "Entregue".
 * Com "reduzir movimento": sem íris nem cronologia; a tela final aparece assim que o resultado chega.
 */
export function PayScene({ amount, fee, to, toName, toInitials, send, describeError, onCover, onFinish }: {
  amount: string;
  /** Taxa cotada antes do gesto; `null` quando a cotação ainda não chegou (o resumo usa a do registro assinado). */
  fee: string | null; to: string;
  /** Nome do contato quando o destinatário é um contato com endereço conhecido; senão o endereço encurtado. */
  toName?: string;
  /** Iniciais do contato no círculo do destinatário (design: 650 19 px); sem contato, o ícone de pessoa. */
  toInitials?: string;
  send: () => Promise<WalletTransferRecord>; describeError: (e: unknown) => string;
  /** A cena cobriu a tela (760 ms) e a folha por baixo pode sumir; `false` antes de fechar por erro (a folha volta). */
  onCover?: (covered: boolean) => void;
  onFinish: (r: PayResult) => void;
}) {
  const { c, scheme, reduceMotion } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: w, height: h } = useWindowDimensions();
  const clockN = useRef(new Animated.Value(0)).current; // driver nativo: opacidade e transformações
  const clockJ = useRef(new Animated.Value(0)).current; // driver JS: traços SVG (anel, rota, check)
  const iris = useRef(new Animated.Value(0)).current;
  const irisOut = useRef(new Animated.Value(0)).current;
  const fail = useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = useState<'signing' | 'running' | 'failed' | 'closing'>('signing');
  const [anchorY, setAnchorY] = useState<number>(PAY.iris.anchorY);
  const [stage, setStage] = useState<PayStage>('signing');
  const [typed, setTyped] = useState(0);
  const [canFinish, setCanFinish] = useState(false);
  const result = useRef<PayResult | null>(null);
  const reached = useRef(false);
  const continued = useRef(false);
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const cb = useRef({ send, describeError, onFinish, onCover });
  cb.current = { send, describeError, onFinish, onCover };

  const run = (to: number, dur: number, after?: () => void) => {
    if (reduceMotion) { clockN.setValue(to); clockJ.setValue(to); after?.(); return; }
    Animated.timing(clockJ, { toValue: to, duration: dur, easing: Easing.linear, useNativeDriver: false }).start();
    Animated.timing(clockN, { toValue: to, duration: dur, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => { if (finished) after?.(); });
  };

  useEffect(() => {
    // Íris abre do botão (50 % 93 %) em 750 ms; o relógio vai até 1,1 s e espera a assinatura real.
    if (reduceMotion) iris.setValue(PAY.iris.dur);
    else Animated.timing(iris, { toValue: PAY.iris.dur, duration: PAY.iris.dur, easing: Easing.linear, useNativeDriver: true }).start();
    const tryContinue = () => {
      const r = result.current;
      if (!r || continued.current) return;
      if (r.error) {
        continued.current = true;
        setPhase('failed'); setCanFinish(true);
        if (reduceMotion) fail.setValue(1); else Animated.timing(fail, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
        return;
      }
      if (!reached.current) return;
      continued.current = true;
      setPhase('running');
      run(PAY.total, PAY.total - PAY.waitAt);
    };
    run(PAY.waitAt, PAY.waitAt, () => { reached.current = true; tryContinue(); });
    const cover = setTimeout(() => cb.current.onCover?.(true), reduceMotion ? 0 : PAY.coverAt);
    const sub = clockJ.addListener(({ value }) => {
      const s = payStage(value), n = typedChars(SIG_CHARS, value, PAY.type.dur, PAY.type.delay);
      setStage(prev => (prev === s ? prev : s));
      setTyped(prev => (prev === n ? prev : n));
      if (value >= PAY.finishAt) setCanFinish(true);
    });
    cb.current.send()
      .then(record => { setElapsed(Date.now() - startedAt.current); result.current = { record, error: record.error ?? null }; tryContinue(); })
      .catch(e => { result.current = { record: null, error: cb.current.describeError(e) }; tryContinue(); });
    return () => { clockJ.removeListener(sub); clearTimeout(cover); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    if (phase === 'closing' || !canFinish) return;
    setPhase('closing');
    // Erro: a folha volta por baixo antes da íris fechar (a pessoa revê o envio com a mensagem).
    if (!result.current || result.current.error) cb.current.onCover?.(false);
    const done = () => cb.current.onFinish(result.current ?? { record: null, error: null });
    if (reduceMotion) return done();
    // Íris fecha em direção ao cartão de saldo (50 % 24 %) em 520 ms.
    setAnchorY(PAY.iris.outAnchorY);
    Animated.timing(irisOut, { toValue: PAY.iris.outDur, duration: PAY.iris.outDur, easing: Easing.linear, useNativeDriver: true }).start(done);
  };

  // Máscara circular: escala 0 → 1 (abrir) × 1 → 0 (fechar); o conteúdo recebe a escala inversa para não encolher.
  const R = irisRadius(w, h);
  const mask = useMemo(() => {
    const open = irisScaleRanges(PAY.iris.dur, cubicBezier(...PAY.iris.bezier));
    const close = irisScaleRanges(PAY.iris.outDur, cubicBezier(...PAY.iris.outBezier));
    const rev = (r: { inputRange: number[]; outputRange: number[] }) => ({ inputRange: r.inputRange, outputRange: [...r.outputRange].reverse() });
    return {
      scale: Animated.multiply(at(iris, open.scale), at(irisOut, rev(close.scale))),
      inverse: Animated.multiply(at(iris, open.inverse), at(irisOut, rev(close.inverse))),
    };
  }, [iris, irisOut]);

  const record = result.current?.record ?? null;
  const status: WalletTransferRecord['status'] | null = record?.status ?? null;
  const final = status === 'submitted' || status === 'included' || status === 'finalized' ? status : null;
  const statusLine = stage === 'delivered' ? (final ? t(`pay.status.${final}`) : t('pay.status.signedOnly')) : t(`pay.status.${stage}`);
  const sig = record ? `sig ${record.hash.replace(/^0x/, '').slice(0, 18)}…${record.hash.slice(-4)}` : '';
  const toShort = toName || shortAddress(to);
  // Taxa: a do registro assinado (exata, cobrada pela Lunes) quando existe; antes disso, a cotada na folha.
  const feeShown = record ? formatLunes(BigInt(record.fee)) : fee;
  const rows: [string, string][] = [
    [t('pay.row.route'), t('pay.row.routeValue', { to: toShort })],
    [t('pay.row.time'), t('pay.seconds', { s: fmtNumber(elapsed / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })],
    [t('pay.row.fee'), feeShown ? `${feeShown} LUNES` : '—'],
    [t('pay.row.settle'), final ? t(`pay.settle.${final}`) : t('pay.status.signedOnly')],
    [t('pay.row.tx'), record ? shortHash(record.hash) : '—'],
  ];
  const outcome = final ? t(`pay.outcome.${final}`) : t('pay.status.signedOnly');

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={finish}>
      {/* Barra de status clara enquanto a cena (fundo `ink`) cobre o topo; no tema escuro `ink` é claro. */}
      <StatusBar style={scheme === 'dark' ? 'dark' : 'light'} />
      <View accessibilityViewIsModal accessibilityLabel={t('pay.scene.a11y')} style={{ flex: 1, overflow: 'hidden' }}>
        <View pointerEvents="box-none" style={{ position: 'absolute', left: w / 2 - R, top: anchorY * h - R, width: 2 * R, height: 2 * R }}>
          <Animated.View style={{ width: 2 * R, height: 2 * R, borderRadius: R, overflow: 'hidden', backgroundColor: c.ink, transform: [{ scale: mask.scale }] }}>
            <Animated.View style={{ width: 2 * R, height: 2 * R, transform: [{ scale: mask.inverse }] }}>
              <View style={{ position: 'absolute', left: R - w / 2, top: R - anchorY * h, width: w, height: h }}>
                <Scene clockN={clockN} clockJ={clockJ} w={w} h={h} top={insets.top} bottom={insets.bottom} ink={c.ink} invink={c.invink}
                  amount={amount} to={toShort} initials={toName ? toInitials : undefined} statusLine={statusLine} sig={sig.slice(0, typed)} outcome={outcome} rows={rows}
                  canFinish={canFinish && phase === 'running'} onFinish={finish} />
                {phase !== 'signing' && phase !== 'running' && result.current?.error && (
                  <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.ink, opacity: fail, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: Math.max(insets.bottom, 16), gap: 12 }}>
                    <Icon name="error" size={72} w={300} color={c.invink} />
                    <T size={24} w={700} ls={-0.03} color={c.invink} align="center">{t('pay.failTitle')}</T>
                    <T size={14} lh={1.45} color={c.invink} align="center" style={{ opacity: 0.8, maxWidth: 320 }} accessibilityLiveRegion="polite">{result.current.error}</T>
                    {record && <T size={11.5} mono lh={1.5} color={c.invink} align="center" selectable style={{ opacity: 0.7 }}>{record.hash}</T>}
                    <Pressable onPress={finish} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 14, alignSelf: 'stretch', height: 56, borderRadius: 28, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                      <T size={16} w={600} color={c.ink}>{t('common.close')}</T>
                    </Pressable>
                  </Animated.View>
                )}
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

/** Conteúdo da cena: estilos interpolados do relógio uma vez (useMemo) e só textos/traços mudando por estado. */
const Scene = memo(function Scene({ clockN, clockJ, w, h, top, bottom, ink, invink, amount, to, initials, statusLine, sig, outcome, rows, canFinish, onFinish }: {
  clockN: Animated.Value; clockJ: Animated.Value; w: number; h: number; top: number; bottom: number; ink: string; invink: string;
  amount: string; to: string; initials?: string; statusLine: string; sig: string; outcome: string; rows: [string, string][]; canFinish: boolean; onFinish: () => void;
}) {
  const t = useT();
  const { reduceMotion } = useTheme();
  const kx = w / PAY.refW, ky = h / PAY.refH;
  const X = (v: number) => v * kx, Y = (v: number) => v * ky;
  const route = useMemo(() => PAY.route.map(([x, y]) => [X(x), Y(y)] as Point), [w, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = route.map(p => p.join(',')).join(' ');
  const stops = routeStops(route);
  const hitAt = PAY.flight.start + PAY.flight.dur * stops[0]!;
  const L = routeLength(route);
  const barW = w - 48;

  const S = useMemo(() => {
    const C = clockN;
    const coin = coinKeyframes(route, PAY.flight.start, PAY.flight.dur);
    const amountUp = range(PAY.amountInAt, PAY.amountIn.dur, 0, 1, PAY.amountIn.bezier);
    const amountOut = range(PAY.toCoinAt, PAY.toCoin.dur, 1, 0, PAY.toCoin.bezier);
    const bump = concat(
      range(PAY.arriveAt, PAY.bump.dur * 0.35, 1, 0.8, PAY.bump.bezier, 6),
      range(PAY.arriveAt + PAY.bump.dur * 0.35, PAY.bump.dur * 0.35, 0.8, 1.14, PAY.bump.bezier, 6),
      range(PAY.arriveAt + PAY.bump.dur * 0.7, PAY.bump.dur * 0.3, 1.14, 1, PAY.bump.bezier, 4),
    );
    const barR = range(PAY.bar.delay, PAY.bar.dur, 0, 1, PAY.bar.bezier, 24);
    return {
      dots: fadeStyle(C, PAY.dots.delay, PAY.dots.dur, EASE_OUT),
      top: fadeStyle(C, PAY.top.delay, PAY.top.dur, EASE_OUT),
      bar: { transform: [{ translateX: at(C, { inputRange: barR.inputRange, outputRange: barR.outputRange.map(s => (s - 1) * barW / 2) }) }, { scaleX: at(C, barR) }] },
      block: {
        opacity: seg(C, PAY.blockOutAt, PAY.blockOut.dur, 1, 0, PAY.blockOut.bezier),
        transform: [{ translateY: seg(C, PAY.blockOutAt, PAY.blockOut.dur, 0, -40, PAY.blockOut.bezier) }, { scale: seg(C, PAY.blockOutAt, PAY.blockOut.dur, 1, 0.9, PAY.blockOut.bezier) }],
      },
      ringPop: popStyle(C, PAY.block.pop.delay, PAY.block.pop.dur, PAY.block.pop.bezier),
      ringDraw: seg(clockJ, PAY.block.ring.delay, PAY.block.ring.dur, PAY.block.ring.dash, 0, PAY.block.ring.bezier),
      ringPulse: ringStyle(C, PAY.signedAt, 1000, 2.2, 0.6),
      finger: { opacity: seg(C, 1120, 200, 1, 0, EASE_IN) },
      verified: popStyle(C, PAY.verified.delay, PAY.verified.dur, PAY.verified.bezier),
      signingWord: { opacity: seg(C, 1100, 200, 1, 0) },
      signedWord: upStyle(C, PAY.signedWord.delay, PAY.signedWord.dur, PAY.signedWord.bezier),
      routeLayer: { opacity: seg(C, PAY.routeOutAt, PAY.routeOut.dur, 1, 0, PAY.routeOut.bezier), transform: [{ scale: seg(C, PAY.routeOutAt, PAY.routeOut.dur, 1, 1.05, PAY.routeOut.bezier) }] },
      amount: {
        opacity: at(C, concat(amountUp, amountOut)),
        transform: [
          { translateY: at(C, concat(range(PAY.amountInAt, PAY.amountIn.dur, 16, 0, PAY.amountIn.bezier), range(PAY.toCoinAt, PAY.toCoin.dur, 0, PAY.toCoin.dy * ky, PAY.toCoin.bezier))) },
          { scale: seg(C, PAY.toCoinAt, PAY.toCoin.dur, 1, 0.1, PAY.toCoin.bezier) },
        ],
      },
      guide: fadeStyle(C, PAY.guide.delay, PAY.guide.dur, EASE_OUT),
      routeDraw: seg(clockJ, PAY.flight.start, PAY.flight.dur, L, 0, LINEAR),
      you: popStyle(C, PAY.you.delay, PAY.you.dur),
      youRing: ringStyle(C, PAY.flight.start, 1000, 2.2, 0.6),
      nodePop: popStyle(C, 2200, 400),
      nodeLit: { opacity: seg(C, hitAt, PAY.nodeLit.dur, 0, 1, EASE_OUT, 0) },
      nodeRing: ringStyle(C, hitAt, PAY.nodeRing.dur, PAY.nodeRing.to, 0.5),
      nodeLabel: fadeStyle(C, 2300, 400),
      destPop: popStyle(C, PAY.dest.pop.delay, PAY.dest.pop.dur),
      destBump: { transform: [{ scale: at(C, bump) }] },
      destName: fadeStyle(C, PAY.dest.name.delay, PAY.dest.name.dur),
      arriveRings: PAY.arriveRings.map(d => ringStyle(C, PAY.arriveAt + d, PAY.arriveRing.dur, PAY.arriveRing.to, 0.6)),
      sparks: Array.from({ length: PAY.spark.count }, (_, i) => {
        const size = i % 3 === 0 ? 6 : 4, a = i * 22.5 + (i % 2 ? 7 : -5), d = -(64 + (i % 4) * 16);
        return {
          size,
          style: {
            opacity: seg(C, PAY.arriveAt, PAY.spark.dur, 1, 0, PAY.spark.bezier, 0),
            transform: [{ rotate: `${a}deg` }, { translateY: seg(C, PAY.arriveAt, PAY.spark.dur, 0, d, PAY.spark.bezier) }, { scale: seg(C, PAY.arriveAt, PAY.spark.dur, 1, 0.2, PAY.spark.bezier) }],
          },
        };
      }),
      trail: PAY.trail.map(({ d, op, scale }) => ({
        op, main: op === 1,
        // `piuCoinFly` deslocado pelo atraso do rastro; antes de 2,4 s a moeda já está sobre "Você".
        fly: { transform: [{ translateX: at(C, { inputRange: coin.inputRange.map(v => v + d), outputRange: coin.x }) }, { translateY: at(C, { inputRange: coin.inputRange.map(v => v + d), outputRange: coin.y }) }] },
        // `piuPop .35s` a 2,22 s e `piuFadeOut .18s` ao chegar (3,8 s + atraso).
        pop: { opacity: Animated.multiply(at(C, { inputRange: [PAY.coinPop.delay, PAY.coinPop.delay + PAY.coinPop.dur * 0.7], outputRange: [0, 1] }), seg(C, PAY.arriveAt + d, 180, 1, 0, EASE_IN)), transform: [{ scale: at(C, popRange(PAY.coinPop.delay, PAY.coinPop.dur)) }] },
        // Face da moeda: tamanho do fantasma + giro em Y (`piuCoin` 0 → 720°, linear, 2,4–3,8 s).
        face: { transform: [{ scale }, { perspective: 600 }, { rotateY: seg(C, PAY.flight.start, PAY.flight.dur, 0, 720, LINEAR, undefined, 4).interpolate({ inputRange: [0, 720], outputRange: ['0deg', '720deg'] }) }] },
      })),
      check: fadeStyle(C, PAY.checkAt, 200),
      checkRing: ringStyle(C, PAY.checkRing.delay, PAY.checkRing.dur, PAY.checkRing.to, 0.6),
      checkCircle: seg(clockJ, PAY.checkCircle.delay, PAY.checkCircle.dur, PAY.checkCircle.dash, 0, PAY.checkCircle.bezier),
      checkMark: seg(clockJ, PAY.checkMark.delay, PAY.checkMark.dur, PAY.checkMark.dash, 0, PAY.checkMark.bezier),
      amountOut: upStyle(C, PAY.amountOut.delay, PAY.amountOut.dur, PAY.amountOut.bezier),
      line: upStyle(C, PAY.line.delay, 500, PAY.amountOut.bezier),
      rows: upStyle(C, PAY.rows.delay, 500, PAY.finish.bezier),
      finish: upStyle(C, PAY.finishAt, PAY.finish.dur, PAY.finish.bezier),
    };
  }, [clockN, clockJ, route, hitAt, L, barW, ky]);

  // Elementos em loop (não dependem do relógio): ponto do status respirando e linha da digital subindo/descendo.
  const breath = useRef(new Animated.Value(0)).current;
  const scanY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { breath.setValue(0); scanY.setValue(0); return; }
    const b = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const s = Animated.loop(Animated.sequence([
      Animated.timing(scanY, { toValue: 1, duration: PAY.scanY.dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(scanY, { toValue: 0, duration: PAY.scanY.dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    b.start();
    const timer = setTimeout(() => s.start(), PAY.scanY.delay);
    return () => { b.stop(); s.stop(); clearTimeout(timer); };
  }, [breath, scanY, reduceMotion]);

  const mono = { mono: true as const };
  const inset = payInsets(top, bottom);
  const dotColor = alpha(invink, 0.17);
  const node = route[1]!, you = route[0]!, dest = route[2]!;
  return (
    <View style={{ flex: 1 }}>
      {/* Fundo de pontos (22 px). */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, S.dots]}>
        <Svg width={w} height={h}>
          {Array.from({ length: Math.ceil(h / 22) }, (_, r) => Array.from({ length: Math.ceil(w / 22) }, (_, cc) => <Circle key={`${r}-${cc}`} cx={cc * 22 + 11} cy={r * 22 + 11} r={1.2} fill={dotColor} />))}
        </Svg>
      </Animated.View>

      {/* Topo: "PAGAMENTO LUNES", barra de progresso (3,6 s) e status ao vivo. */}
      <Animated.View style={[{ position: 'absolute', top: inset.top, left: 24, right: 24, gap: 12 }, S.top]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', opacity: 0.7 }}>
          <T {...mono} size={11.5} w={500} ls={0.06} color={invink}>{t('pay.kicker')}</T>
          <T {...mono} size={11.5} w={500} ls={0.06} tabular color={invink}>{amount} LUNES</T>
        </View>
        <View style={{ height: 2, borderRadius: 1, backgroundColor: alpha(invink, 0.18), overflow: 'hidden' }}>
          <Animated.View style={[{ height: '100%', width: '100%', backgroundColor: invink }, S.bar]} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: invink, opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }} />
          <T size={14.5} w={600} ls={-0.01} color={invink} accessibilityLiveRegion="polite" numberOfLines={1} style={{ flex: 1 }}>{statusLine}</T>
        </View>
      </Animated.View>

      {/* Bloco "Assinando": anel 168, digital com linha de leitura, assinatura digitada; vira selo "verified" e "Assinada". */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: Y(200), left: 0, right: 0, alignItems: 'center', gap: 22 }, S.block]}>
        <Animated.View style={[{ width: 168, height: 168 }, S.ringPop]}>
          <Svg width={168} height={168} viewBox="0 0 168 168" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={84} cy={84} r={76} fill="none" stroke={invink} strokeWidth={2} opacity={0.18} />
            <ACircle cx={84} cy={84} r={76} fill="none" stroke={invink} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${PAY.block.ring.dash}`} strokeDashoffset={S.ringDraw} />
          </Svg>
          <Animated.View style={[{ position: 'absolute', left: 36, top: 36, width: 96, height: 96, borderRadius: 48, borderWidth: 1.5, borderColor: invink }, S.ringPulse]} />
          <Animated.View style={[{ position: 'absolute', left: 36, top: 36, width: 96, height: 96, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, S.finger]}>
            <Icon name="fingerprint" size={86} w={300} color={invink} />
            <Animated.View style={{ position: 'absolute', left: 4, right: 4, top: 0, height: 2, borderRadius: 1, backgroundColor: invink, shadowColor: invink, shadowOpacity: 1, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, transform: [{ translateY: scanY.interpolate({ inputRange: [0, 1], outputRange: [PAY.scanY.from, PAY.scanY.to] }) }] }} />
          </Animated.View>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }, S.verified]}>
            <Icon name="verified" size={76} w={400} fill color={invink} />
          </Animated.View>
        </Animated.View>
        <View style={{ height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute' }, S.signingWord]}><T size={30} w={700} ls={-0.04} color={invink}>{t('pay.signing')}</T></Animated.View>
          <Animated.View style={[{ position: 'absolute' }, S.signedWord]}><T size={30} w={700} ls={-0.04} color={invink}>{t('pay.signed')}</T></Animated.View>
        </View>
        <T {...mono} size={13} color={invink} numberOfLines={1} style={{ opacity: 0.7, height: 18 }}>{sig}</T>
      </Animated.View>

      {/* Rota: valor vira moeda, percorre Você → rede Lunes → destinatário; faíscas na chegada. */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, S.routeLayer]}>
        <Animated.View style={[{ position: 'absolute', top: Y(452), left: 0, right: 0, alignItems: 'center', gap: 2 }, S.amount]}>
          <T size={64} w={700} ls={-0.06} lh={1} tabular color={invink}>{amount}</T>
          <T size={14} w={600} color={invink} style={{ opacity: 0.7 }}>{t('pay.amountTo', { to })}</T>
        </Animated.View>
        {/* Guia pontilhada (fade com driver nativo) e linha sólida que se desenha junto com a moeda (traço SVG, driver JS). */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h, opacity: 0.3 }, S.guide]}>
          <Svg width={w} height={h}>
            <Polyline points={pts} fill="none" stroke={invink} strokeWidth={1.5} strokeDasharray="2 7" strokeLinecap="round" />
          </Svg>
        </Animated.View>
        <Svg width={w} height={h} style={{ position: 'absolute' }}>
          <APolyline points={pts} fill="none" stroke={invink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${L}`} strokeDashoffset={S.routeDraw} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: you[0] - 26, top: you[1] - 26, width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: invink }, S.youRing]} />
        <Animated.View style={[{ position: 'absolute', left: you[0] - 26, top: you[1] - 26, width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: invink, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }, S.you]}>
          <T size={13} w={600} color={invink}>{t('pay.you')}</T>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: node[0] - 7, top: node[1] - 7, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: invink }, S.nodeRing]} />
        {/* Nó: acende (`piuLit`: fundo invink + halo de 6 px a 20 %) quando a moeda passa. */}
        <Animated.View style={[{ position: 'absolute', left: node[0] - 13, top: node[1] - 13, width: 26, height: 26, borderRadius: 13, backgroundColor: alpha(invink, 0.2) }, S.nodeLit]} />
        <Animated.View style={[{ position: 'absolute', left: node[0] - 7, top: node[1] - 7, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: invink, backgroundColor: ink }, S.nodePop]}>
          <Animated.View style={[{ position: 'absolute', left: -1.5, top: -1.5, width: 14, height: 14, borderRadius: 7, backgroundColor: invink }, S.nodeLit]} />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: node[0] + 18, top: node[1] - 7, opacity: 0.75 }, S.nodeLabel]}>
          <T {...mono} size={11} w={500} lh={1.35} color={invink}>{t('pay.node')}{'\n'}{t('pay.nodeSub')}</T>
        </Animated.View>
        {S.arriveRings.map((st, i) => <Animated.View key={i} style={[{ position: 'absolute', left: dest[0] - 34, top: dest[1] - 34, width: 68, height: 68, borderRadius: 34, borderWidth: 1.5, borderColor: invink }, st]} />)}
        <Animated.View style={[{ position: 'absolute', left: dest[0] - 34, top: dest[1] - 34, width: 68, height: 68 }, S.destPop]}>
          <Animated.View style={[{ width: 68, height: 68, borderRadius: 34, backgroundColor: invink, alignItems: 'center', justifyContent: 'center' }, S.destBump]}>
            {initials ? <T size={19} w={650} ls={-0.02} color={ink}>{initials}</T> : <Icon name="person" size={32} w={400} fill color={ink} />}
          </Animated.View>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: dest[1] + 43, alignItems: 'center' }, S.destName]}>
          <T size={14} w={600} color={invink}>{to}</T>
        </Animated.View>
        {S.sparks.map((sp, i) => (
          <View key={i} style={{ position: 'absolute', left: dest[0], top: dest[1], width: 0, height: 0 }}>
            <Animated.View style={[{ position: 'absolute', left: -sp.size / 2, top: -sp.size / 2, width: sp.size, height: sp.size, borderRadius: sp.size / 2, backgroundColor: invink }, sp.style]} />
          </View>
        ))}
        {S.trail.map((tr, i) => (
          <Animated.View key={i} style={[{ position: 'absolute', left: -15, top: -15, width: 30, height: 30 }, tr.fly]}>
            <Animated.View style={[{ width: 30, height: 30 }, tr.pop]}>
              <Animated.View style={[{ width: 30, height: 30, borderRadius: 15, backgroundColor: invink, opacity: tr.op, alignItems: 'center', justifyContent: 'center',
                ...(tr.main ? { shadowColor: invink, shadowOpacity: 0.55, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 6 } : {}) }, tr.face]}>
                <T size={14} w={750} color={ink} style={{ opacity: tr.main ? 1 : 0 }}>L</T>
              </Animated.View>
            </Animated.View>
          </Animated.View>
        ))}
      </Animated.View>

      {/* Resultado: círculo e check desenhados, valor, linha do resultado real, resumo. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: Y(150), left: 24, right: 24, alignItems: 'center', gap: 6 }}>
        <Animated.View style={[{ width: 124, height: 124, marginBottom: 14 }, S.check]}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 124, height: 124, borderRadius: 62, borderWidth: 1.5, borderColor: invink }, S.checkRing]} />
          <Svg width={124} height={124} viewBox="0 0 124 124" style={{ position: 'absolute' }}>
            <ACircle cx={62} cy={62} r={56} fill="none" stroke={invink} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${PAY.checkCircle.dash}`} strokeDashoffset={S.checkCircle} rotation={-90} origin="62, 62" />
            <APath d="M40 64 L55 79 L86 46" fill="none" stroke={invink} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${PAY.checkMark.dash}`} strokeDashoffset={S.checkMark} />
          </Svg>
        </Animated.View>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }, S.amountOut]}>
          <T size={60} w={700} ls={-0.06} lh={1} tabular color={invink}>{amount}</T>
          <T size={16} w={600} color={invink} style={{ opacity: 0.7 }}>LUNES</T>
        </Animated.View>
        <Animated.View style={S.line}><T size={16} color={invink} align="center" style={{ opacity: 0.8 }}>{outcome}</T></Animated.View>
        <Animated.View style={[{ alignSelf: 'stretch', marginTop: 26, borderRadius: 20, borderWidth: 1, borderColor: alpha(invink, 0.2) }, S.rows]}>
          {rows.map(([k, v], i) => (
            <View key={k} style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(invink, 0.14) }}>
              <T size={13} color={invink} style={{ opacity: 0.65 }}>{k}</T>
              <T size={13} w={550} tabular color={invink} align="right" style={{ flex: 1 }}>{v}</T>
            </View>
          ))}
        </Animated.View>
      </View>

      <Animated.View pointerEvents={canFinish ? 'auto' : 'none'} style={[{ position: 'absolute', left: 20, right: 20, bottom: inset.finishBottom }, S.finish]}>
        <Pressable onPress={onFinish} accessibilityRole="button" accessibilityLabel={t('pay.finish')} disabled={!canFinish}
          style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: invink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <T size={16} w={600} color={ink}>{t('pay.finish')}</T>
        </Pressable>
      </Animated.View>
    </View>
  );
});

