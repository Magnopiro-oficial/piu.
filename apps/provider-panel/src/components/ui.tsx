import { useEffect, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export function Icon({ name, size = 20, fill, wght, style, className }: { name: string; size?: number; fill?: 0 | 1; wght?: number; style?: CSSProperties; className?: string }) {
  const fvs = [fill !== undefined ? `'FILL' ${fill}` : null, wght !== undefined ? `'wght' ${wght}` : null].filter(Boolean).join(', ');
  return (
    <span aria-hidden="true" className={'ic' + (className ? ' ' + className : '')} style={{ fontSize: size, ...(fvs ? { fontVariationSettings: fvs } : null), ...style }}>
      {name}
    </span>
  );
}

export interface SegOption<T> { value: T; label: ReactNode; icon?: string }

/** Controle segmentado. `variant="soft"` usa trilho bg2 (dentro de cartões bg). */
export function Segmented<T extends string | number>({ options, value, onChange, label, height = 32, fontSize = 13, variant = 'bg3', gap = 3, radius = 11, btnRadius = 8 }: {
  options: SegOption<T>[]; value: T; onChange: (v: T) => void; label?: string;
  height?: number; fontSize?: number; variant?: 'bg3' | 'bg2'; gap?: number; radius?: number; btnRadius?: number;
}) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ background: `var(--${variant})`, gap, borderRadius: radius }}>
      {options.map(o => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} style={{ height, fontSize, borderRadius: btnRadius }}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange?: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" disabled={disabled} onClick={onChange}>
      <span />
    </button>
  );
}

/** Propriedades para tornar um div clicável acessível por teclado. */
export function pressable(onPress: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(); } },
  };
}

export function Bar({ pct, height = 6, anim, radius }: { pct: string; height?: number; anim?: string; radius?: number }) {
  return (
    <div className="track" style={{ height, borderRadius: radius ?? height / 2 }}>
      <div style={{ width: pct, animation: anim }} />
    </div>
  );
}

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const on = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active, onEscape]);
}

export const growX = (delay = 0) => `piuGrowX .7s ${delay.toFixed(2)}s var(--ease-out) both`;
