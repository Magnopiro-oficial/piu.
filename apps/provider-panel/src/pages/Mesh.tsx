import { Icon } from '../components/ui';
import { peers } from '../data/seed';
import { LEGEND, LINE_STYLE, LINKS, MAP_H, MAP_W, NODES, POS } from '../data/topology';
import { useT } from '../i18n/react';
import { useStore } from '../state/store';
import { MeshLive } from './MeshLive';

/** Com piu-node, a topologia real (este nó e os vizinhos LNNP); sem ele, a demonstração. */
export function Mesh() {
  return useStore().nodeMode === 'node' ? <MeshLive /> : <MeshDemo />;
}

function MeshDemo() {
  const t = useT();
  const { devices } = useStore();
  const byId = new Map(devices.map(d => [d.id, d]));
  // Nós próprios/AP só aparecem se o equipamento ainda existe.
  const ownKinds = new Set(NODES.filter(([, k]) => k === 'own' || k === 'ap').map(([key]) => key));
  const visible = (key: string) => !ownKinds.has(key) || byId.has(key);
  // Celulares ligados só a um nó que sumiu também somem.
  const phoneVisible = (key: string) => LINKS.some(([a, b]) => (a === key && visible(b)) || (b === key && visible(a)));
  const ownCount = NODES.filter(([key, k]) => k === 'own' && byId.has(key)).length;

  return (
    <div className="page-body mesh-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16 }}>
      <div role="img" aria-label={t('mesh.topoAria')} className="mesh-map" style={{ position: 'relative', height: MAP_H, borderRadius: 24, backgroundColor: 'var(--bg2)', backgroundImage: 'radial-gradient(var(--line2) 1px, transparent 1.2px)', backgroundSize: '22px 22px', overflow: 'hidden' }}>
        <div className="mesh-canvas" style={{ position: 'absolute', left: '50%', top: 0, width: MAP_W, height: MAP_H, marginLeft: -MAP_W / 2 }}>
          {LINKS.map(([a, b, t, own], i) => {
            if (!visible(a) || !visible(b)) return null;
            const [x1, y1] = POS[a], [x2, y2] = POS[b], dx = x2 - x1, dy = y2 - y1;
            const [w, style] = LINE_STYLE[t];
            const flow = own && t !== 'ble' && byId.get(a)?.status !== 'paused';
            return (
              <div key={i} style={{ position: 'absolute', left: x1, top: y1, width: Math.hypot(dx, dy), height: 0, borderTop: `${w} ${style} var(--ink)`, opacity: own ? 0.75 : 0.3, transform: `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)}deg)`, transformOrigin: '0 0' }}>
                {flow && <div style={{ position: 'absolute', top: -4, width: 6, height: 6, marginLeft: -3, borderRadius: '50%', background: 'var(--ink)', animation: `piuTravel ${1.6 + (i % 4) * 0.5}s linear infinite` }} />}
              </div>
            );
          })}
          {NODES.map(([key, kind, icon, label]) => {
            if (!visible(key) || (kind === 'phone' && !phoneVisible(key))) return null;
            const [x, y] = POS[key];
            const name = kind === 'own' || kind === 'ap' ? byId.get(key)?.name : label;
            const inverted = kind === 'own' || kind === 'ap';
            return (
              <div key={key} style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {kind === 'own' && (
                  <div style={{ position: 'relative', width: 46, height: 46 }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 3.2s ease-out infinite' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon!} size={22} wght={400} /></div>
                  </div>
                )}
                {(kind === 'peer' || kind === 'ap') && (
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg)', border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon!} size={16} wght={400} /></div>
                )}
                {kind === 'phone' && <div style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--bg)', border: '1.5px solid var(--ink)' }} />}
                {name && (
                  <div className="mono" style={{ position: 'absolute', top: '100%', marginTop: 6, fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 5, background: inverted ? 'var(--ink)' : 'var(--bg)', color: inverted ? 'var(--invink)' : 'var(--ink)' }}>{name}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mesh-legend" style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', flexWrap: 'wrap', gap: 14, padding: '10px 14px', borderRadius: 14, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', fontSize: 12, color: 'var(--ink2)' }}>
          {LEGEND.map(k => (
            <div key={k} className="row" style={{ gap: 7 }}><div style={{ width: 22, height: 0, borderTop: `${LINE_STYLE[k][0]} ${LINE_STYLE[k][1]} var(--ink)` }} />{t(`legend.${k}`)}</div>
          ))}
        </div>
        <div className="row" style={{ position: 'absolute', right: 16, top: 16, gap: 7, padding: '7px 11px', borderRadius: 99, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', fontSize: 12, fontWeight: 550 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', animation: 'piuBreath 1.6s ease-in-out infinite' }} />{t('mesh.liveOwn', { n: ownCount })}
        </div>
      </div>

      <section className="card-line col" style={{ borderRadius: 24, padding: '16px 18px', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
          <h2 className="h-card" style={{ margin: 0 }}>{t('mesh.neighbors')}</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{t('mesh.linkQuality')}</div>
        </div>
        {peers().map(p => (
          <div key={p.name} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <Icon name={p.icon} size={20} wght={300} />
            <div className="col grow" style={{ gap: 2 }}>
              <div className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{p.cls} · {p.via}</div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4, width: 70 }}>
              <div className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{p.quality}</div>
              <div className="track" style={{ width: '100%', height: 4, borderRadius: 2 }}><div style={{ width: p.quality.endsWith('%') ? p.quality : '0%' }} /></div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, paddingTop: 10 }}>{t('mesh.routesNote')}</div>
      </section>
    </div>
  );
}
