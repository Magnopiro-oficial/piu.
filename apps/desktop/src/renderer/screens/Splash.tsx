/** Abertura (protótipo `isSplash`): anéis, órbitas, ícone da marca, "piu." letra a letra, três pontos. 2,2 s + saída .45 s = 2,65 s. */
import icon512 from '../brand/icon-512.png';

export function Splash({ out }: { out: boolean }) {
  const ring = (delay: string) => <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: `piuRingL 2.4s ${delay} cubic-bezier(.2,.7,.3,1) infinite` }} />;
  const letter = (ch: string, delay: string, extra = {}) => <span style={{ display: 'inline-block', animation: `piuLetter .55s ${delay} cubic-bezier(.2,.9,.3,1.2) both`, ...extra }}>{ch}</span>;
  return (
    <div className="drag" style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', animation: out ? 'piuOut .45s cubic-bezier(.4,0,.6,1) forwards' : 'none' }}>
      {ring('0s')}{ring('.8s')}{ring('1.6s')}
      <div style={{ position: 'absolute', width: 440, height: 440, animation: 'piuSpin 7s linear infinite' }}>
        <div style={{ position: 'absolute', width: 12, height: 12, borderRadius: '50%', background: 'var(--ink)', top: 0, left: 214, animation: 'piuPop .5s .5s both' }} />
        <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ink)', bottom: 40, left: 60, animation: 'piuPop .5s .7s both' }} />
      </div>
      <div style={{ position: 'absolute', width: 300, height: 300, animation: 'piuSpinR 5s linear infinite' }}>
        <div style={{ position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: 'var(--ink)', top: 40, right: 20, animation: 'piuPop .5s .6s both' }} />
        <div style={{ position: 'absolute', width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', bottom: 6, left: 146, animation: 'piuPop .5s .8s both' }} />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <img src={icon512} alt="Piu" style={{ width: 120, height: 120, borderRadius: 30, display: 'block', boxShadow: '0 24px 60px -18px rgba(0,0,0,.45)', animation: 'piuPop .8s .1s cubic-bezier(.2,.9,.3,1.4) both' }} />
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 750, letterSpacing: '-0.07em', lineHeight: 1, overflow: 'hidden', paddingBottom: 4 }}>
          {letter('p', '.45s')}{letter('i', '.53s')}{letter('u', '.61s')}{letter('.', '.69s', { color: 'var(--ink3)' })}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, animation: 'piuFade .5s .9s both' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['0s', '.15s', '.3s'].map(d => <div key={d} style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--ink)', animation: `piuDot 1s ${d} ease-in-out infinite` }} />)}
        </div>
        <div style={{ font: "500 12px 'Geist Mono',monospace", color: 'var(--ink2)', letterSpacing: '.04em' }}>iniciando o nó local</div>
      </div>
    </div>
  );
}
