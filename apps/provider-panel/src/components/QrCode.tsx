import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** QR code (gerador MIT de Kazuhiko Arase) em SVG: preto no branco, com margem, legível no tema escuro. */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  const q = 2, vb = n + q * 2;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-q} ${-q} ${vb} ${vb}`} style={{ borderRadius: 12, background: '#fff', flex: 'none' }}>
      <rect x={-q} y={-q} width={vb} height={vb} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
