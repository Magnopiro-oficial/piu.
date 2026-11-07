/**
 * Peças reutilizadas pelas telas, com as medidas do protótipo (Piu Desktop.dc.html):
 * ícone Material Symbols Rounded, interruptor 42×26, segmentado, diálogo, toast, QR "visual".
 */
import QRCode from 'qrcode';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react';
import icon192 from './brand/icon-192.png';
import { fmtDate, t as tNow, useT } from './i18n';
import { qrCellDelay, qrCellScale, qrIsFinder, qrWaveTotal } from './qrWave';

export const F = "Geist, 'Geist Variable', system-ui, sans-serif";
export const FM = "'Geist Mono', ui-monospace, monospace";
export const S = (o: CSSProperties) => o;

/** Material Symbols Rounded, com eixos como no protótipo (`font-variation-settings`). */
export function Sym({ name, size = 20, fill = 0, wght, style, className = '' }: { name: string; size?: number; fill?: 0 | 1; wght?: number; style?: CSSProperties; className?: string }) {
  const fv = `'FILL' ${fill}, 'wght' ${wght ?? 400}, 'GRAD' 0, 'opsz' 24`;
  return <span className={`ms ${className}`} style={{ fontSize: size, fontVariationSettings: fv, ...style }} aria-hidden="true">{name}</span>;
}

/** Interruptor do protótipo (`tg`): trilho 42×26, botão 20, anima a posição. */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <div role="switch" aria-checked={on} aria-disabled={disabled} aria-label={label} tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange?.(!on)} onKeyDown={e => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange?.(!on); } }}
      style={{ width: 42, height: 26, borderRadius: 13, background: on ? 'var(--ink)' : 'var(--bg3)', position: 'relative', cursor: disabled ? 'default' : 'pointer', flex: 'none', transition: 'background .25s', opacity: disabled ? .4 : 1 }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 20, height: 20, borderRadius: 10, background: on ? 'var(--invink)' : '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .35s cubic-bezier(.2,.9,.3,1.5)' }} />
    </div>
  );
}

/** Segmentado do protótipo (`seg`): fundo bg3, opção ativa em bg com sombra. */
export function Seg<T extends string>({ value, opts, onChange, bg = 'var(--bg3)' }: { value: T; opts: [T, string][]; onChange: (v: T) => void; bg?: string }) {
  return (
    <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: bg, flex: 'none' }}>
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
          style={{ height: 30, padding: '0 12px', border: 'none', borderRadius: 8, background: value === v ? 'var(--bg)' : 'transparent', color: 'var(--ink)', font: `${value === v ? 600 : 450} 12.5px ${F}`, cursor: 'pointer', boxShadow: value === v ? '0 1px 3px rgba(0,0,0,.14)' : 'none', transition: 'background .25s,box-shadow .25s' }}>{l}</button>
      ))}
    </div>
  );
}

/** `qr`: texto de um QR real (cartão do perfil), desenhado como no protótipo (`dlg.isQr`: cartão branco 16px, QR 200, ícone 48 no centro). */
export interface DialogSpec { icon?: string; title: string; body: string; primary: string; act: () => void; hasSecond?: boolean; danger?: boolean; code?: string; qr?: string; content?: ReactNode }

/** Diálogo do protótipo: scrim com blur, cartão 400px, ícone redondo, dois botões. */
export function Dialog({ d, onClose }: { d: DialogSpec; onClose: () => void }) {
  const t = useT();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const hasSecond = d.hasSecond !== false;
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', zIndex: 70, animation: 'piuFade .25s both', backdropFilter: 'blur(3px)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 400, transform: 'translate(-50%,-50%)', zIndex: 71 }} role="dialog" aria-modal="true" aria-label={d.title}>
        <div style={{ background: 'var(--bg)', borderRadius: 26, padding: '26px 22px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.35)', animation: 'piuDialog .4s cubic-bezier(.2,.9,.3,1.25) both' }}>
          {d.qr ? (
            <div style={{ padding: 16, borderRadius: 22, background: '#fff', boxShadow: '0 0 0 1px var(--line2)', position: 'relative' }}>
              <RealQr text={d.qr} size={200} label={d.title} />
              <div style={{ position: 'absolute', left: '50%', top: '50%', margin: '-24px 0 0 -24px', width: 48, height: 48, borderRadius: 12, background: '#fff', padding: 4 }}>
                <img src={icon192} alt="" style={{ width: 40, height: 40, borderRadius: 9, display: 'block' }} />
              </div>
            </div>
          ) : d.code ? (
            <div style={{ padding: 16, borderRadius: 22, background: '#fff', boxShadow: '0 0 0 1px var(--line2)', position: 'relative', width: '100%' }}>
              <div className="sel" style={{ width: '100%', minHeight: 120, font: `500 11px ${FM}`, color: '#0c0c0c', wordBreak: 'break-all', lineHeight: 1.45, textAlign: 'left' }}>{d.code}</div>
            </div>
          ) : d.icon ? (
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .5s .1s cubic-bezier(.2,.9,.3,1.5) both' }}>
              <Sym name={d.icon} size={27} wght={300} />
            </div>
          ) : null}
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, textWrap: 'pretty' }}>{d.title}</div>
          <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, textWrap: 'pretty' }}>{d.body}</div>
          {d.content && <div style={{ width: '100%', marginTop: 4 }}>{d.content}</div>}
          <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}>
            {hasSecond && <button onClick={onClose} style={{ flex: 1, height: 46, border: 'none', borderRadius: 23, background: 'var(--bg2)', color: 'var(--ink)', font: `600 14.5px ${F}`, cursor: 'pointer' }}>{t('common.cancel')}</button>}
            <button className="a-97" onClick={d.act} style={{ flex: 1, height: 46, border: 'none', borderRadius: 23, background: 'var(--ink)', color: 'var(--invink)', font: `600 14.5px ${F}`, cursor: 'pointer' }}>{d.primary}</button>
          </div>
        </div>
      </div>
    </>
  );
}

export function Toast({ text, icon }: { text: string; icon: string }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 26, display: 'flex', justifyContent: 'center', zIndex: 55, pointerEvents: 'none' }}>
      <div style={{ height: 42, padding: '0 18px 0 14px', borderRadius: 21, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', gap: 9, font: `550 13.5px ${F}`, boxShadow: '0 14px 34px -12px rgba(0,0,0,.45)', animation: 'piuToast .45s cubic-bezier(.2,.9,.3,1.3) both' }}>
        <Sym name={icon} size={18} style={{ animation: 'piuPop .45s .1s cubic-bezier(.2,.9,.3,1.5) both' }} />{text}
      </div>
    </div>
  );
}

/**
 * Malha de 29×29 "ao estilo QR" do protótipo (`qr(seed)`): só visual (localizadores, miolo vazio, células
 * aleatórias determinísticas) — NÃO é um QR legível. Usada onde o design mostra um QR indisponível.
 */
export function qrCells(seed: number) {
  let x = seed * 7919 + 17; const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const N = 29, cells: { bg: string; r: string; anim: string }[] = [];
  const finder = (r: number, c: number) => { for (const [R, C] of [[0, 0], [0, N - 7], [N - 7, 0]]) { const i = r - R!, j = c - C!; if (i >= 0 && i < 7 && j >= 0 && j < 7) return (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0; if (i >= -1 && i <= 7 && j >= -1 && j <= 7) return 0; } return -1; };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const f = finder(r, c); let on: boolean;
    if (f >= 0) on = f === 1; else if (r >= 11 && r <= 17 && c >= 11 && c <= 17) on = false; else on = rnd() > 0.52;
    const d = Math.round(Math.hypot(r - 14, c - 14) * 28);
    cells.push({ bg: on ? '#0c0c0c' : 'transparent', r: f >= 0 ? '1px' : '2px', anim: on ? 'piuQr .35s ' + d + 'ms cubic-bezier(.2,.9,.3,1.5) both' : 'none' });
  }
  return cells;
}

/** Movimento desligado (Ajustes → Aparência) ou `prefers-reduced-motion`: a onda vira estado final, como `mo()` no protótipo. */
export const motionOff = () => document.documentElement.dataset.anim === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * QR de verdade (lib `qrcode`), com a onda do protótipo (`piuQr .35s <d>ms cubic-bezier(.2,.9,.3,1.5)`,
 * módulos do centro para fora; dados com raio 2px na escala da malha 29×29, localizadores quadrados para ler).
 * `level` H quando há um ícone sobre o centro (Carteira → Receber): a correção alta tolera a área coberta.
 * Pintado num canvas por requestAnimationFrame: o QR de pareamento tem ~2 400 módulos e, como <div>
 * animados, o Chromium travava ~1,4 s e a onda não aparecia. A matemática fica em qrWave.ts.
 */
export function RealQr({ text, size, level = 'M', label = tNow('app.qr.pairing') }: { text: string; size: number; level?: 'L' | 'M' | 'Q' | 'H'; label?: string }) {
  const q = useMemo(() => { try { return QRCode.create(text, { errorCorrectionLevel: level }); } catch { return null; } }, [text, level]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!q || !canvas) return;
    const n = q.modules.size, data = q.modules.data, dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // Localizadores com módulos QUADRADOS: com o raio de 1px por módulo do protótipo, as emendas entre módulos
    // quebram a proporção 1:1:3:1:1 dos anéis e o zxing não acha o QR (testado: nenhuma leitura a 190 nem a 252 px,
    // com ou sem ícone). Os módulos de dados mantêm o raio do design (2px na malha 29×29), que não atrapalha a leitura.
    const cell = size / n, rFinder = 0, rData = 2 * 29 / n, total = qrWaveTotal(n);
    const cells: { x: number; y: number; r: number; d: number }[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (data[r * n + c] === 1) cells.push({ x: c * cell, y: r * cell, r: qrIsFinder(r, c, n) ? rFinder : rData, d: qrCellDelay(r, c, n) });
    const paint = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#0c0c0c';
      for (const k of cells) {
        const s = qrCellScale(t, k.d);
        if (s <= 0) continue;
        ctx.globalAlpha = Math.min(1, s);
        const w = cell * s, off = (cell - w) / 2;
        ctx.beginPath(); if (k.r) ctx.roundRect(k.x + off, k.y + off, w, w, k.r * s); else ctx.rect(k.x + off, k.y + off, w, w); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    if (motionOff()) { paint(total); return; }
    let raf = 0; const start = performance.now();
    const tick = (now: number) => { const t = now - start; paint(t); if (t < total) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [q, size]);
  if (!q) return null;
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} role="img" aria-label={label} />;
}

/**
 * Medidas do cartão do QR em cada lugar do protótipo:
 * - `pair` (Auth → "Conectar ao meu celular"): QR 252, padding 22, raio 28, sombra longa, ícone 58 (48 dentro);
 * - `wallet` (Carteira → Receber): QR 190, padding 14, raio 20, só o contorno `0 0 0 1px var(--line2)`,
 *   `piuPop .55s`, ícone 44 (36 dentro, raio 8) — template do Receber, linhas ~587–590 do .dc.html.
 */
const QR_GEO = {
  pair: { size: 252, pad: 22, radius: 28, shadow: '0 0 0 1px var(--line2),0 30px 70px -24px rgba(0,0,0,.35)', anim: 'piuPop .6s cubic-bezier(.2,.9,.3,1.25) both', scanX: 14, glow: '0 0 18px 4px rgba(12,12,12,.25)', icon: 58, iconPad: 5, iconR: 15, img: 48, imgR: 11 },
  wallet: { size: 190, pad: 14, radius: 20, shadow: '0 0 0 1px var(--line2)', anim: 'piuPop .55s cubic-bezier(.2,.9,.3,1.25) both', scanX: 9, glow: '0 0 14px 3px rgba(12,12,12,.25)', icon: 44, iconPad: 4, iconR: 11, img: 36, imgR: 8 },
} as const;

/**
 * Cartão do QR: cartão sempre branco com `piuPop`, QR real com a onda do centro (`RealQr`), linha de leitura
 * `piuScan` e o ícone do Piu no centro (`piuPop` atrasado). Auth e Carteira → Receber usam ESTE componente
 * (mesmo comportamento); `variant` só troca as medidas para as do protótipo em cada tela. Sem `text`, mostra `placeholder`.
 */
export function QrCard({ text, size, level = 'M', label, placeholder, variant = 'pair' }: { text: string | null; size?: number; level?: 'L' | 'M' | 'Q' | 'H'; label: string; placeholder?: ReactNode; variant?: keyof typeof QR_GEO }) {
  const g = QR_GEO[variant], px = size ?? g.size;
  return (
    <div style={{ padding: g.pad, borderRadius: g.radius, background: '#fff', boxShadow: g.shadow, position: 'relative', animation: g.anim }}>
      {text ? <RealQr key={text} text={text} size={px} level={level} label={label} /> : <div style={{ width: px, height: px, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 12px ${FM}`, color: '#5f5f5c' }}>{placeholder}</div>}
      <div style={{ position: 'absolute', left: g.scanX, right: g.scanX, top: g.pad, bottom: g.pad, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: '#0c0c0c', boxShadow: g.glow, animation: 'piuScan 2.6s 1s ease-in-out infinite' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: '50%', margin: `${-g.icon / 2}px 0 0 ${-g.icon / 2}px`, width: g.icon, height: g.icon, borderRadius: g.iconR, background: '#fff', padding: g.iconPad, animation: 'piuPop .5s .9s cubic-bezier(.2,.9,.3,1.5) both' }}>
        <img src={icon192} alt="" style={{ width: g.img, height: g.img, borderRadius: g.imgR, display: 'block' }} />
      </div>
    </div>
  );
}

export function QrGrid({ seed, size }: { seed: number; size: number }) {
  const cells = qrCells(seed);
  return (
    <div style={{ width: size, height: size, display: 'grid', gridTemplateColumns: 'repeat(29,minmax(0,1fr))' }}>
      {cells.map((c, i) => <div key={i} style={{ background: c.bg, borderRadius: c.r, animation: c.anim }} />)}
    </div>
  );
}

/**
 * Tela com segredo visível (frase, QR/palavras do vínculo, carteira): o processo principal bloqueia
 * capturas enquanto `active` (M-02), mesmo com "Segurança da tela" desligada. Desmontar libera.
 */
export function useSecretScreen(screen: 'phrase' | 'link' | 'wallet', active: boolean) {
  useEffect(() => {
    if (!active) return;
    void window.piu.setSecretVisible(screen, true);
    return () => { void window.piu.setSecretVisible(screen, false); };
  }, [screen, active]);
}

export const initialsOf = (name: string, id: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.map(w => w[0]!).slice(0, 2).join('').toUpperCase() : id.replace(/^piu:/, '').slice(0, 2).toUpperCase();
};
export const shortId = (id: string) => id.replace(/^piu:/, '').slice(0, 4).toUpperCase();
/** `piu:7f3a…c19e` como no protótipo. */
export const handleOf = (id: string) => { const h = id.replace(/^piu:/, ''); return `piu:${h.slice(0, 4)}…${h.slice(-4)}`; };

export function fmtTime(sec: number) {
  const d = new Date(sec * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return tNow('app.yesterday');
  return fmtDate(d, { day: '2-digit', month: 'short' }).replace('.', '');
}

export const Btn = ({ children, onClick, primary, style, className = '' }: { children: ReactNode; onClick?: () => void; primary?: boolean; style?: CSSProperties; className?: string }) => (
  <button className={`a-94 ${className}`} onClick={onClick} style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 17, background: primary ? 'var(--ink)' : 'var(--bg)', color: primary ? 'var(--invink)' : 'var(--ink)', font: `600 13px ${F}`, cursor: 'pointer', boxShadow: '0 0 0 1px var(--line2) inset', flex: 'none', transition: 'transform .2s', ...style }}>{children}</button>
);
