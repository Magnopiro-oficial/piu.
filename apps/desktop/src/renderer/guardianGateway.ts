import { createElement, type CSSProperties, type ReactNode } from 'react';

/**
 * Ligar o gateway em "Nível e limites": o teste real de internet roda antes e a ponte só fica marcada com
 * internet confirmada. Enquanto testa, a tela segura Salvar/Continuar (`setProbing`), para não gravar
 * gateway desligado no meio do teste. Se a pessoa saiu da tela (`alive` falso), o resultado é ignorado:
 * nada liga a ponte por trás dela.
 */
export async function probeGateway(o: {
  test: () => Promise<boolean>;
  alive: () => boolean;
  setProbing: (b: boolean) => void;
  setNoNet: (b: boolean) => void;
  enable: () => void;
}): Promise<void> {
  o.setProbing(true);
  let ok = false;
  try { ok = (await o.test()) === true; } catch { ok = false; }
  if (!o.alive()) return;
  o.setNoNet(!ok);
  if (ok) o.enable();
  o.setProbing(false);
}

/**
 * Botão que avança a tela (Salvar em "Nível e limites", Continuar no assistente): parado enquanto o teste
 * de internet roda, para não gravar gateway desligado no meio do teste.
 */
export function ProbeButton({ probing, onClick, className, style, children }: { probing: boolean; onClick: () => void; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return createElement('button', { className, disabled: probing, onClick: () => { if (!probing) onClick(); }, style: { ...style, opacity: probing ? 0.5 : 1 } }, children);
}
