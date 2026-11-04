/**
 * Esconder saldo na Carteira: só a exibição muda, nunca os dados.
 * A preferência fica em `set.hideBalance` (state/settings.tsx).
 */

/** Máscara do saldo grande (54px) do design. */
export const BALANCE_MASK = '••••••';
/** Máscara dos valores menores: "a liberar", reservado em convites. */
export const AMOUNT_MASK = '••••';

/** Saldo principal: escondido vira "••••••" (inclusive o traço de "sem leitura"), senão o texto formatado. */
export function maskBalance(shown: string, hidden: boolean): string {
  return hidden ? BALANCE_MASK : shown;
}

/** Valores secundários: escondidos viram "••••", senão o texto formatado. */
export function maskAmount(shown: string, hidden: boolean): string {
  return hidden ? AMOUNT_MASK : shown;
}

/** Ícone e rótulo de acessibilidade do botão do olho para o estado atual. */
export function balanceEye(hidden: boolean): { icon: 'visibility' | 'visibility_off'; label: string } {
  return hidden ? { icon: 'visibility_off', label: 'Mostrar saldo' } : { icon: 'visibility', label: 'Esconder saldo' };
}
