/**
 * Peças da chamada fora do palco: botão Ligar do cabeçalho, selo de telefone no avatar da lista,
 * pílula com cronômetro junto ao título da janela e o próprio título ("{nome} · mm:ss").
 * Sem provedor de chamada (CallContext), não desenham nada e o título fica como sempre.
 */
import { useEffect } from 'react';
import { FM, Sym } from '../ui';
import { callKeyLabel, callTimer, callWindowTitle, inCall } from './callDesktop';
import { useCallHost, useTick, useTr } from './CallContext';

/** "Ligar" no cabeçalho da conversa (dica com o atalho Ctrl⇧C / ⌘⇧C). */
export function CallButton({ onClick, mac }: { onClick: () => void; mac: boolean }) {
  const t = useTr();
  return (
    <button className="h-bg3 a-94 nodrag" onClick={onClick} title={t('call.action.tip', { keys: callKeyLabel('open', mac) })}
      style={{ height: 38, padding: '0 14px 0 12px', border: 'none', borderRadius: 19, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, flex: 'none', transition: 'background .2s,transform .2s' }}>
      <Sym name="call" size={19} fill={1} />{t('call.action')}
    </button>
  );
}

/** Selo de telefone no avatar da conversa em chamada (o avatar precisa de `position: relative`). */
export function CallBadge({ peer }: { peer: string }) {
  const host = useCallHost();
  const s = host?.scene?.state;
  if (!s || !inCall(s.phase) || s.peer !== peer) return null;
  return (
    <span aria-hidden="true" style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="call" size={10} fill={1} /></span>
    </span>
  );
}

/** Pílula com cronômetro ao lado do título, na barra de título própria do app. */
export function CallTitlePill() {
  const host = useCallHost();
  const s = host?.scene?.state;
  const on = !!s && inCall(s.phase);
  const now = useTick(on);
  if (!on || !s) return null;
  return (
    <span style={{ height: 20, padding: '0 8px', borderRadius: 10, background: 'var(--ink)', color: 'var(--invink)', font: `500 11px ${FM}`, display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--invink)' }} />{callTimer(s, now)}
    </span>
  );
}

/** Título da janela (barra do sistema no Linux/Windows): o de sempre, ou "{nome} · mm:ss" em chamada. */
export function WindowTitle({ base }: { base: string }) {
  const host = useCallHost();
  const scene = host?.scene ?? null;
  const now = useTick(!!scene && inCall(scene.state.phase));
  const title = callWindowTitle(base, scene, now);
  useEffect(() => { document.title = title; }, [title]);
  return null;
}
