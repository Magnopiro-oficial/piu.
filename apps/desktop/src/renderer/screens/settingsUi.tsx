/** Peças das páginas de Ajustes (protótipo `isSettingsNav`): linha de 56px, seção em cartão bg2, valor, teclas. */
import type { ReactNode } from 'react';
import { F, FM, Sym } from '../ui';


/** Linha de uma seção (56px mínimo), com ícone opcional e o controle à direita. */
export function Row({ name, desc, icon, first, children, onClick }: { name: string; desc?: string; icon?: string; first?: boolean; children?: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderTop: `1px solid ${first ? 'transparent' : 'var(--line)'}`, minHeight: 56, cursor: onClick ? 'pointer' : 'default' }}>
      {icon && <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={icon} size={20} wght={300} /></div>}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14.5, fontWeight: 550 }}>{name}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}
export function Section({ title, i, children }: { title: string; i: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', animation: `piuUp .45s ${0.08 + i * 0.07}s cubic-bezier(.2,.85,.3,1) both` }}>
      <div style={{ padding: '16px 4px 8px', font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{title}</div>
      <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}
export const Val = ({ children }: { children: ReactNode }) => <div style={{ font: `500 12.5px ${FM}`, color: 'var(--ink2)' }}>{children}</div>;
export const Kbd = ({ keys }: { keys: string[] }) => (
  <div style={{ display: 'flex', gap: 4 }}>{keys.map((k, i) => <div key={i} style={{ minWidth: 28, height: 28, padding: '0 8px', borderRadius: 7, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 2px 0 var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `550 12.5px ${FM}` }}>{k}</div>)}</div>
);


/** Volta da subpágina (D2, D4): "‹ Privacidade", "‹ Conversas". */
export function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="h-bg2" onClick={onClick} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 2, height: 28, padding: '0 8px 0 2px', marginLeft: -4, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--ink2)', font: `550 13px ${F}`, cursor: 'pointer' }}>
      <Sym name="chevron_left" size={18} />{label}
    </button>
  );
}
