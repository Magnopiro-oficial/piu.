import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrGrid, type QrLevel } from '../lib/qrGrid';

/**
 * QR code de verdade (gerador MIT de Kazuhiko Arase), desenhado como um único caminho SVG.
 * Sempre preto no branco, com margem: leitores de QR falham com as cores invertidas do tema escuro.
 * `level` e `quiet` (margem em módulos) só mudam onde o payload é longo, como o convite de grupo.
 */
export function QrCode({ value, size, radius = 14, label, level = 'M', quiet = 2 }: { value: string; size: number; radius?: number; label: string; level?: QrLevel; quiet?: number }) {
  const { d, n } = useMemo(() => qrGrid(value, level), [value, level]);
  const vb = n + quiet * 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: '#ffffff' }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${vb} ${vb}`}>
        <Rect x={-quiet} y={-quiet} width={vb} height={vb} fill="#ffffff" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
