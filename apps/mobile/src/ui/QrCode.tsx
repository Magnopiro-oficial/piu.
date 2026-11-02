import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * QR code de verdade (gerador MIT de Kazuhiko Arase), desenhado como um único caminho SVG.
 * Sempre preto no branco, com margem: leitores de QR falham com as cores invertidas do tema escuro.
 */
export function QrCode({ value, size, radius = 14, label }: { value: string; size: number; radius?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  const quiet = 2;
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
