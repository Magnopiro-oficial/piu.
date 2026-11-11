import { usePreventCapture } from '../lib/screenCapture';

/** Bloqueia print e gravação enquanto estiver montado (para ligar só numa etapa da tela). */
export function NoCapture({ k }: { k: string }) {
  usePreventCapture(k);
  return null;
}
