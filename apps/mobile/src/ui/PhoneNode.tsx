import { router } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '../i18n';
import { errorAction, type ErrorAction } from '../lib/phoneNodeView';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/**
 * Peças das telas do Piu 11 "Modo nó e malha" (design/handoff/design/"Piu 11 Modo no e malha.dc.html").
 * Valores copiados do protótipo (estilos inline). Animações (design/handoff/docs/LEIA-ME-0611.md):
 * - piuRingS (scale 1 → 2,2, opacidade .6 → 0): anel da etapa atual da trilha 2,2 s ease-out; ponto do selo 2 s;
 * - piuSpin: spinners de borda .9 s linear;
 * - piuTravel: o ponto atravessa a linha em 2,6 s ease-in-out, em laço (N9);
 * - piuShake: erro chacoalha uma vez, .45 s ease-in-out (N4f);
 * - segurar para assinar: ui/HoldToSign.tsx (`look="node"`: .9 s linear, solta em .3 s).
 * Com "reduzir movimento", tudo para no estado final (como `animation-duration:.01ms; iteration-count:1`):
 * anel e ponto viajante somem, spinner fica parado, sem chacoalhar.
 */

/** Erro de uma ação do modo nó: telas próprias voltam para a tela; biometria cancelada não mostra nada; o resto vira aviso. */
export function usePnFail() {
  const { showToast } = useStore();
  const t = useT();
  return (e: unknown): ErrorAction => {
    const a = errorAction(e);
    if (a.kind === 'toast') {
      const body = a.key === 'generic' ? (e instanceof Error && e.message ? e.message.slice(0, 160) : t('pn.err.generic')) : t(`pn.err.${a.key}` as 'pn.err.generic');
      showToast({ icon: 'error', title: t('pn.err.title'), body });
    }
    return a;
  };
}

const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
/** No navegador não há driver nativo: lá, o driver JS. */
const NATIVE = Platform.OS !== 'web';
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

/** Relógio 0 → 1 em laço. `still`: "reduzir movimento" (fica no fim da animação). */
function useLoop(dur: number, easing: (v: number) => number) {
  const { reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(1); return; }
    // Laço feito à mão: `Animated.loop` para depois da primeira volta no navegador (conferido na galeria).
    let live = true;
    let a: Animated.CompositeAnimation | null = null;
    const run = () => {
      if (!live) return;
      v.setValue(0);
      a = Animated.timing(v, { toValue: 1, duration: dur, easing, useNativeDriver: NATIVE });
      a.start(({ finished }) => { if (finished) run(); });
    };
    run();
    return () => { live = false; a?.stop(); };
  }, [v, dur, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  return { v, still: reduceMotion };
}

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/** Anel que pulsa por fora (piuRingS). */
function Ring({ size, border, dur }: { size: number; border: number; dur: number }) {
  const { c } = useTheme();
  const { v, still } = useLoop(dur, EASE_OUT);
  if (still) return null;
  return <Animated.View pointerEvents="none" style={{ ...FILL, borderRadius: size / 2, borderWidth: border, borderColor: c.ink,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />;
}

/** Spinner de borda: `size`, borda 2 `bg3` com o topo `ink`, .9 s linear. */
export function Spinner({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const { v, still } = useLoop(900, Easing.linear);
  const rotate = still ? '0deg' : v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View accessibilityRole="progressbar" style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: c.bg3, borderTopColor: c.ink, transform: [{ rotate }] }, style]} />;
}

/** Ponto de 8 px com o anel de 2 s (selo "Assinada · viajando pela malha"). */
export function LiveDot() {
  const { c } = useTheme();
  return <View style={{ width: 8, height: 8 }}><View style={{ ...FILL, borderRadius: 4, backgroundColor: c.ink }} /><Ring size={8} border={1} dur={2000} /></View>;
}

/** piuShake .45 s ease-in-out, uma vez a cada `trigger` novo. */
export function Shake({ trigger, children, style }: { trigger: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trigger || reduceMotion) return;
    x.setValue(0);
    const a = Animated.timing(x, { toValue: 1, duration: 450, easing: EASE_IN_OUT, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, [trigger, reduceMotion, x]);
  return <Animated.View style={[style, { transform: [{ translateX: x.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -6, 6, -6, 6, 0] }) }] }]}>{children}</Animated.View>;
}

/** Cabeçalho de 52 px (padding 4/12, gap 6): voltar ou fechar 40 px, título 18/650 e algo à direita. */
export function PnHeader({ title, right, close, onBack }: { title?: string; right?: ReactNode; close?: boolean; onBack?: () => void }) {
  const t = useT();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/provider')));
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 12 }}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={close ? t('common.close') : t('common.back')} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={close ? 'close' : 'arrow_back_ios_new'} size={22} />
      </Pressable>
      <T size={18} w={650} ls={-0.02} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">{title ?? ''}</T>
      {right ? <View style={{ paddingRight: 10 }}>{right}</View> : null}
    </View>
  );
}

/** Selo 20 px, raio 10, contorno `line2`, mono 10,5/500 `ink2` ("ATIVO", "NÃO É DINHEIRO"). `solid`: fundo `ink` ("CONFERIDO"). */
export function Tag({ children, solid }: { children: string; solid?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 20, paddingHorizontal: 7, borderRadius: 10, justifyContent: 'center', alignSelf: 'flex-start', ...(solid ? { backgroundColor: c.ink } : { borderWidth: 1, borderColor: c.line2 }) }}>
      <T size={10.5} w={500} mono color={solid ? c.invink : c.ink2} numberOfLines={1}>{children}</T>
    </View>
  );
}

/** Rótulo mono 12/500 `ink2` +.04em ("MODO NÓ", "CONTATOS PÚBLICOS"). */
export function Kicker({ children }: { children: string }) {
  const { c } = useTheme();
  return <T size={12} w={500} mono ls={0.04} color={c.ink2}>{children}</T>;
}

/** Bloco do topo: rótulo, título 26–30/700 −.045em (lh 1,05) e texto 14–15 `ink2` (lh 1,45). Gap 9. */
export function Lead({ kicker, title, sub, size = 28, subSize = 15 }: { kicker?: string; title: string; sub?: string; size?: number; subSize?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 9 }}>
      {kicker ? <Kicker>{kicker}</Kicker> : null}
      <T size={size} w={700} ls={-0.045} lh={1.05} accessibilityRole="header">{title}</T>
      {sub ? <T size={subSize} lh={1.45} color={c.ink2}>{sub}</T> : null}
    </View>
  );
}

/** Quadrado de ícone: 40/12 (linhas) ou 44/13 (cartões de estado), `bg2` ou `ink`. */
export function IconTile({ name, size = 40, solid, fill, light = true, children }: { name?: IconName; size?: 40 | 44; solid?: boolean; fill?: boolean; light?: boolean; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size === 44 ? 13 : 12, backgroundColor: solid ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
      {children ?? (name ? <Icon name={name} size={size === 44 ? 23 : 21} w={light && !solid ? 300 : 400} fill={fill} color={solid ? c.invink : c.ink} /> : null)}
    </View>
  );
}

/** Linha com ícone, título 15/600 e texto 13,5 `ink2` lh 1,38 (N1, N7). Padding 12/0, borda de cima `line`. */
export function FeatureRow({ icon, title, body, badge }: { icon: IconName; title: string; body: string; badge?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line }}>
      <IconTile name={icon} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <T size={15} w={600}>{title}</T>
          {badge ? <Tag>{badge}</Tag> : null}
        </View>
        <T size={13.5} lh={1.38} color={c.ink2}>{body}</T>
      </View>
    </View>
  );
}

/** Botão pequeno 32 px (raio 16, 0/13, 13/600): `ink` ou `outline` (fundo `bg`, contorno `line2`), ícone 16 opcional. */
export function SmallButton({ label, onPress, outline, icon, disabled }: { label: string; onPress?: () => void; outline?: boolean; icon?: IconName; disabled?: boolean }) {
  const { c } = useTheme();
  const fg = outline ? c.ink : c.invink;
  return (
    <Pressable onPress={onPress} disabled={disabled || !onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ height: 32, paddingHorizontal: 13, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        backgroundColor: outline ? c.bg : c.ink, borderWidth: outline ? 1 : 0, borderColor: c.line2, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}>
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <T size={13} w={600} color={fg} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/** Botão dos cartões de estado: 40 px, raio 20, 0/16, 14/600 `ink`; `ghost` transparente 14/550. */
export function CardButton({ label, onPress, ghost, disabled }: { label: string; onPress?: () => void; ghost?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled || !onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center', backgroundColor: ghost ? 'transparent' : c.ink, opacity: disabled ? 0.25 : pressed ? 0.85 : 1 })}>
      <T size={14} w={ghost ? 550 : 600} color={ghost ? c.ink : c.invink} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/**
 * Cartão de estado/erro/bloqueio do protótipo (N3a–h, N4a–d, N4f–h, N6a–d, N7b, N8a–b, N9c–d): raio 24,
 * contorno `line2`, padding 20, gap 14; ícone 44/13 (`solid` nos erros e resultados), título 17/700 −.02em,
 * texto 13,5 `ink2` lh 1,45; botões à direita. `spinner` no lugar do ícone (N3c). `bare`: sem moldura (dentro de outra tela).
 */
export function StateCard({ icon, solid, fill, spinner, title, body, actions, bare, children }: {
  icon?: IconName; solid?: boolean; fill?: boolean; spinner?: boolean; title: string; body?: string; actions?: ReactNode; bare?: boolean; children?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[{ gap: 14 }, bare ? null : { borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, padding: 20 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        {spinner
          ? <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Spinner size={20} /></View>
          : <IconTile size={44} name={icon} solid={solid} fill={fill} />}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T size={17} w={700} ls={-0.02} accessibilityRole="header">{title}</T>
          {body ? <T size={13.5} lh={1.45} color={c.ink2}>{body}</T> : null}
        </View>
      </View>
      {children}
      {actions ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{actions}</View> : null}
    </View>
  );
}

/** Estado vazio (N5v, N6v): círculo 64 `bg2` com ícone 30/300, título 18/700, texto 13,5 (máx. 300), botões centrados. */
export function EmptyCard({ icon, title, body, actions }: { icon: IconName; title: string; body: string; actions?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, padding: 20 }}>
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 8 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={30} w={300} /></View>
        <T size={18} w={700} ls={-0.02} align="center" accessibilityRole="header">{title}</T>
        <T size={13.5} lh={1.45} color={c.ink2} align="center" style={{ maxWidth: 300 }}>{body}</T>
        {actions ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>{actions}</View> : null}
      </View>
    </View>
  );
}

export type TrailState = 'done' | 'current' | 'pending' | 'failed';
/**
 * Trilha vertical (N2, N9): bolinha de 24 px — feita (`ink` com ✓ 15), atual (contorno 2 com miolo 8 e o
 * anel piuRingS 2,2 s), seguinte (contorno 2 `bg3`, texto `ink3`). Linha de 2 px (mín. 12) `ink` depois
 * de uma etapa feita, senão `bg3`. Título 15 (550; 650 na atual), valor mono 12 `ink2` à direita, texto 13.
 */
export function Trail({ steps }: { steps: { state: TrailState; title: string; right?: string; sub?: string; extra?: ReactNode }[] }) {
  const { c } = useTheme();
  return (
    <View>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const pending = s.state === 'pending';
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 24, alignItems: 'center' }}>
              {s.state === 'done' ? (
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={15} color={c.invink} /></View>
              ) : s.state === 'failed' ? (
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={15} color={c.invink} /></View>
              ) : s.state === 'current' ? (
                <View style={{ width: 24, height: 24 }}>
                  <Ring size={24} border={2} dur={2200} />
                  <View style={{ ...FILL, borderRadius: 12, borderWidth: 2, borderColor: c.ink, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink }} />
                  </View>
                </View>
              ) : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.bg3 }} />}
              {!last && <View style={{ flex: 1, width: 2, minHeight: 12, backgroundColor: s.state === 'done' ? c.ink : c.bg3 }} />}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3, paddingTop: 2, paddingBottom: last ? 0 : 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <T size={15} w={s.state === 'current' || s.state === 'failed' ? 650 : 550} color={pending ? c.ink3 : c.ink} style={{ flexShrink: 1 }}>{s.title}</T>
                {s.right ? <T size={12} w={500} mono color={c.ink2} numberOfLines={1}>{s.right}</T> : null}
              </View>
              {s.sub ? <T size={13} lh={1.4} color={pending ? c.ink3 : c.ink2}>{s.sub}</T> : null}
              {s.extra ? <View style={{ marginTop: 8 }}>{s.extra}</View> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Barra 6 px, raio 3, `bg3` com o cheio `ink` (N2 "7 dias", N6 contador). */
export function Bar({ pct }: { pct: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.bg3, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: c.ink }} />
    </View>
  );
}

/** Caixa de linhas (N3, N4, N8): `bg2`, raio 20, 2/16; linha 12/0 14 px, rótulo `ink2`, valor 550 (650 no total). */
export function InfoRows({ rows }: { rows: { label: string; value: string; strong?: boolean; mono?: boolean }[] }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: 20, backgroundColor: c.bg2, paddingVertical: 2, paddingHorizontal: 16 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
          <T size={14} color={c.ink2}>{r.label}</T>
          <T size={r.mono ? 13 : 14} w={r.mono ? 500 : r.strong ? 650 : 550} mono={r.mono} tabular numberOfLines={1} align="right" style={{ flexShrink: 1 }}>{r.value}</T>
        </View>
      ))}
    </View>
  );
}

/** Nota com contorno (N4e, N9, N10): 13/15, raio 18, ícone 20/300 e texto 13 `ink2` lh 1,4. */
export function Note({ icon, children }: { icon: IconName; children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1, borderColor: c.line2 }}>
      <Icon name={icon} size={20} w={300} />
      <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}

/** Chave do nó para um operador (N2, N5): contorno `line2`, raio 16, 12/14; rótulo 12,5 e a chave mono 13; Copiar. */
export function KeyCard({ label, value, onCopy, copyLabel }: { label: string; value: string; onCopy: () => void; copyLabel: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, borderColor: c.line2 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={12.5} color={c.ink2}>{label}</T>
        <T size={13} w={500} mono selectable numberOfLines={1}>{value}</T>
      </View>
      <SmallButton outline icon="content_copy" label={copyLabel} onPress={onCopy} />
    </View>
  );
}

/** Linha de lista do painel (N2, N10a–c): 13/2, ícone 21/300, título 15/550, texto 12,5; à direita o que vier. */
export function ListRow({ icon, title, sub, right, onPress, first, dim, a11y }: { icon: IconName; title: string; sub?: string; right?: ReactNode; onPress?: () => void; first?: boolean; dim?: boolean; a11y?: string }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={a11y ?? title}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 2, borderTopWidth: first ? 0 : 1, borderTopColor: c.line, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, opacity: dim ? 0.45 : 1 }}>
        <Icon name={icon} size={21} w={300} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={15} w={550}>{title}</T>
          {sub ? <T size={12.5} lh={1.35} color={c.ink2}>{sub}</T> : null}
        </View>
      </View>
      {right}
    </Pressable>
  );
}

/** Linha de fase (N2b) e da atividade (N9a): ícone 40/12, título 15/600, texto 12,5 lh 1,35; à direita o que vier. */
export function PhaseRow({ tile, title, sub, right, first }: { tile: ReactNode; title: string; sub?: ReactNode; right?: ReactNode; first?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      {tile}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} w={600}>{title}</T>
        {typeof sub === 'string' ? <T size={12.5} lh={1.35} color={c.ink2}>{sub}</T> : sub}
      </View>
      {right}
    </View>
  );
}

/** Cartão com contorno das linhas (N2b, N9a, N9b): raio 24, 6/18, contorno `line2`. */
export function RowsCard({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, paddingVertical: 6, paddingHorizontal: 18 }}>{children}</View>;
}

/** Rosto com iniciais: círculo 44 `bg2`, 15/600. */
export function Initial({ name, size = 44 }: { name: string; size?: number }) {
  const { c } = useTheme();
  const first = (name.trim()[0] ?? '?').toUpperCase();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><T size={15} w={600}>{first}</T></View>;
}

/** Botão principal 54/27 (16/600, ícone 20), secundário transparente 44 (15/500) e o contornado (N9, 1,5 `ink`). */
export function PnButton({ label, onPress, icon, ghost, outline, disabled, busy, height }: {
  label: string; onPress?: () => void; icon?: IconName; ghost?: boolean; outline?: boolean; disabled?: boolean; busy?: boolean; height?: number;
}) {
  const { c } = useTheme();
  const h = height ?? (ghost ? 44 : 54);
  const fg = ghost || outline ? c.ink : c.invink;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => ({ height: h, borderRadius: h / 2, backgroundColor: ghost ? 'transparent' : outline ? c.bg : c.ink, borderWidth: outline ? 1.5 : 0, borderColor: c.ink,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, opacity: disabled ? 0.25 : busy ? 0.6 : 1, transform: [{ scale: pressed && !disabled ? 0.98 : 1 }] })}>
      {icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <T size={ghost ? 15 : 16} w={ghost ? 500 : 600} color={fg} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/** Ponto que atravessa a linha tracejada (N9): 12 px `ink` com anel `bg` de 4, piuTravel 2,6 s ease-in-out em laço. */
export function TravelLine({ width }: { width: number }) {
  const { c } = useTheme();
  const { v, still } = useLoop(2600, EASE_IN_OUT);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 30, right: 30, top: 17, height: 12 }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 5, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.bg3 }} />
      {!still && width > 0 && (
        <Animated.View style={{ position: 'absolute', top: -4, left: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center',
          opacity: v.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }] }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink }} />
        </Animated.View>
      )}
    </View>
  );
}
