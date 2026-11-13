import qrcode from 'qrcode-generator';

/** Nível de correção de erro do QR: L (7%), M (15%), Q (25%), H (30%). */
export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** Margem (zona de silêncio) do QR ampliado, em módulos: os 4 da norma, para a câmera achar as bordas. */
export const QR_ZOOM_QUIET = 4;

/**
 * Correção do QR do convite de grupo (~500–800 caracteres): L, a mínima. Na tela não há sujeira nem rasgo,
 * e o convite típico cai de 85 para 77 módulos (o que resolve de fato é o zoom em tela cheia).
 */
export const GROUP_INVITE_QR_LEVEL: QrLevel = 'L';

/**
 * Matriz do QR (gerador MIT de Kazuhiko Arase) como um único caminho SVG, um quadrado por módulo escuro.
 * `n` é o número de módulos por lado. Com payload longo (convite de grupo), `L` reduz bem a densidade;
 * na tela não há sujeira nem rasgo, então a correção mínima basta.
 */
export function qrGrid(value: string, level: QrLevel = 'M'): { d: string; n: number } {
  const qr = qrcode(0, level);
  qr.addData(value, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { d, n };
}

/** Lado do QR ampliado (tela cheia): a largura menos 16 pt de cada lado, até 70% da altura e no máximo 480 pt. */
export function qrZoomSize(width: number, height: number): number {
  return Math.floor(Math.min(width - 32, height * 0.7, 480));
}
