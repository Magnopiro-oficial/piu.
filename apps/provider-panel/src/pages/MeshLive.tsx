import { useState } from 'react';
import { Icon } from '../components/ui';
import { ApiError, type ApiPeer } from '../lib/api';
import { LINE_STYLE, MAP_H, MAP_W } from '../data/topology';
import { fmtInt } from '../lib/format';
import { ago, clock, MEDIUM, relayOn } from '../lib/live';
import { useStore } from '../state/store';

/**
 * Malha com o piu-node: este nó no centro e os vizinhos LNNP de verdade em volta, com o meio do
 * enlace (rede local/USB ou LoRa). Posições são só para desenhar; o nó não sabe onde os vizinhos estão.
 */
export function MeshLive() {
  const { devices, live } = useStore();
  const r = relayOn(live);
  const self = devices.find(d => d.telemetry === 'live');
  const nb = r?.neighbors ?? [];
  const cx = MAP_W / 2, cy = MAP_H / 2 - 10;
  const radius = Math.min(MAP_W, MAP_H) / 2 - 70;
  const pos = nb.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, nb.length);
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  });
  const flowing = !!r?.relaying;
  const kinds = [...new Set(nb.map(n => (n.link === 'lora' ? 'lora' : 'eth')))] as ('eth' | 'lora')[];

  return (
    <div className="page-body mesh-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16 }}>
      <div role="img" aria-label={`Malha ao vivo: este nó e ${nb.length} vizinhos`} className="mesh-map" style={{ position: 'relative', height: MAP_H, borderRadius: 24, backgroundColor: 'var(--bg2)', backgroundImage: 'radial-gradient(var(--line2) 1px, transparent 1.2px)', backgroundSize: '22px 22px', overflow: 'hidden' }}>
        <div className="mesh-canvas" style={{ position: 'absolute', left: '50%', top: 0, width: MAP_W, height: MAP_H, marginLeft: -MAP_W / 2 }}>
          {nb.map((n, i) => {
            const [x2, y2] = pos[i]!, dx = x2 - cx, dy = y2 - cy;
            const [w, style] = LINE_STYLE[n.link === 'lora' ? 'lora' : 'eth'];
            return (
              <div key={n.id + i} style={{ position: 'absolute', left: cx, top: cy, width: Math.hypot(dx, dy), height: 0, borderTop: `${w} ${style} var(--ink)`, opacity: 0.75, transform: `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)}deg)`, transformOrigin: '0 0' }}>
                {flowing && <div style={{ position: 'absolute', top: -4, width: 6, height: 6, marginLeft: -3, borderRadius: '50%', background: 'var(--ink)', animation: `piuTravel ${1.6 + (i % 4) * 0.5}s linear infinite` }} />}
              </div>
            );
          })}
          <div style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 46, height: 46 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: flowing ? 'piuRingS 3.2s ease-out infinite' : 'none' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={self?.icon ?? 'router'} size={22} wght={400} /></div>
            </div>
            <div className="mono" style={{ position: 'absolute', top: '100%', marginTop: 6, fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 5, background: 'var(--ink)', color: 'var(--invink)' }}>{self?.name ?? 'este nó'}</div>
          </div>
          {nb.map((n, i) => {
            const [x, y] = pos[i]!;
            return (
              <div key={'n' + n.id + i} style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg)', border: `1.5px ${n.relay ? 'solid' : 'dashed'} var(--ink)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={n.link === 'lora' ? 'settings_input_antenna' : 'router'} size={16} wght={400} />
                </div>
                <div className="mono" style={{ position: 'absolute', top: '100%', marginTop: 6, fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 5, background: 'var(--bg)', color: 'var(--ink)' }}>nó {n.id.slice(0, 8)}</div>
              </div>
            );
          })}
        </div>
        {!nb.length && (
          <div style={{ position: 'absolute', left: 16, right: 16, top: 16, maxWidth: 360, padding: '12px 14px', borderRadius: 14, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
            {r ? 'Sem vizinhos ainda. Outro piu-node na mesma rede aparece aqui sozinho (anúncio a cada 5 s). Se a rede bloquear o anúncio, adicione pelo endereço em "Adicionar equipamento" ou configure PIU_LNNP_PEERS.' : 'Retransmissão LNNP desligada neste nó (PIU_LNNP=0 ou o motor não subiu).'}
          </div>
        )}
        {kinds.length > 0 && (
          <div className="mesh-legend" style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 14, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', fontSize: 12, color: 'var(--ink2)' }}>
            {kinds.map(k => (
              <div key={k} className="row" style={{ gap: 7 }}><div style={{ width: 22, height: 0, borderTop: `${LINE_STYLE[k][0]} ${LINE_STYLE[k][1]} var(--ink)` }} />{MEDIUM[k]}</div>
            ))}
            <div className="row" style={{ gap: 7 }}><div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px dashed var(--ink)' }} />só entrega, não retransmite</div>
          </div>
        )}
        <div className="row" style={{ position: 'absolute', right: 16, top: 16, gap: 7, padding: '7px 11px', borderRadius: 99, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', fontSize: 12, fontWeight: 550 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', animation: flowing ? 'piuBreath 1.6s ease-in-out infinite' : 'none' }} />ao vivo · {nb.length} {nb.length === 1 ? 'vizinho' : 'vizinhos'}
        </div>
      </div>

      <section className="card-line col" style={{ borderRadius: 24, padding: '16px 18px', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
          <h2 className="h-card" style={{ margin: 0 }}>Vizinhos</h2>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>enlace LNNP</div>
        </div>
        {nb.map((n, i) => (
          <div key={n.id + i} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <Icon name={n.link === 'lora' ? 'settings_input_antenna' : 'router'} size={20} wght={300} />
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div className="mono ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>nó {n.id}</div>
              <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--ink2)' }}>{n.relay ? 'retransmite' : 'só entrega'} · {MEDIUM[n.link] ?? n.link} · {n.address}</div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 2, flex: 'none' }}>
              <div className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>MTU {fmtInt(n.mtu)}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>v{n.version} · desde {clock(n.since)}</div>
              {n.confirmCode && <div className="mono" title="Código de confirmação deste enlace: o outro nó mostra o mesmo" style={{ fontSize: 11.5, fontWeight: 600 }}>código {n.confirmCode.slice(0, 3)} {n.confirmCode.slice(3)}</div>}
            </div>
          </div>
        ))}
        {!nb.length && <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 13, color: 'var(--ink2)' }}>Sem vizinhos ainda.</div>}
        {(r?.lan?.peers?.length ?? 0) > 0 && <FixedPeers peers={r!.lan!.peers!} />}
        {r && (
          // Contadores reais do motor: revogação aplicada aqui e o que voltou do disco quando o nó subiu.
          <div className="col" style={{ gap: 6, paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 10, fontSize: 12.5 }}>
              <Icon name="key_off" size={17} wght={300} />
              <span className="grow">Conexões recusadas por credencial revogada</span>
              <span className="tnum" style={{ fontWeight: 650 }}>{fmtInt(r.counters.revokedRefused ?? 0)}</span>
            </div>
            <div className="row" style={{ gap: 10, fontSize: 12.5, alignItems: 'flex-start' }}>
              <Icon name="restore" size={17} wght={300} />
              <span className="grow" style={{ lineHeight: 1.4 }}>
                {r.store.restored
                  ? `Ao ligar, voltaram do armazenamento local ${fmtInt(r.store.restored.envelopes)} ${r.store.restored.envelopes === 1 ? 'mensagem guardada' : 'mensagens guardadas'} e ${fmtInt(r.store.restored.receipts)} ${r.store.restored.receipts === 1 ? 'recibo' : 'recibos'}${r.startedAt ? ` (${clock(r.startedAt)})` : ''}.`
                  : 'Este nó não informa o que voltou do armazenamento local.'}
              </span>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45, paddingTop: 10 }}>
          O código de cada vizinho sai do handshake e é o mesmo no painel do outro nó: serve para conferir, nos dois, que o enlace é com o equipamento certo.
          Enlaces autenticados e cifrados (LNNP v{r?.lnnp.version ?? 1}){r ? ` · ${fmtInt(r.counters.handshakesFailed)} conexões recusadas` : ''}. A qualidade do enlace ainda não é medida. Mídia nunca é enviada por LoRa.
        </div>
      </section>
    </div>
  );
}

const PEER_STATE: Record<ApiPeer['state'], string> = { connecting: 'conectando', connected: 'conectado', failed: 'falhou' };

/** Vizinhos fixos (host:porta): os da configuração do nó e os adicionados pelo assistente, com o estado real de cada um. */
function FixedPeers({ peers }: { peers: ApiPeer[] }) {
  const { api, refreshLive, showToast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const remove = async (address: string) => {
    if (!api || busy) return;
    setBusy(address);
    try { await api.removeRelayPeer(address); await refreshLive(); showToast({ icon: 'link_off', title: 'Vizinho removido', body: `${address} · este nó parou de conectar a ele.` }); }
    catch (e) { showToast({ icon: 'error', title: 'Não foi possível remover', body: e instanceof ApiError ? e.message : 'Tente de novo.' }); }
    finally { setBusy(null); }
  };
  return (
    <div className="col" style={{ gap: 2, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>Vizinhos por endereço</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>reconecta sozinho</div>
      </div>
      {peers.map(p => (
        <div key={p.address} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <Icon name={p.state === 'connected' ? 'link' : p.state === 'failed' ? 'link_off' : 'pending'} size={18} wght={300} />
          <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <div className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.address}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
              {PEER_STATE[p.state]}{p.nodeId ? ` · nó ${p.nodeId}` : ''}{p.state !== 'connected' && p.error ? ` · ${p.error}${p.errorAt ? ` (${ago(p.errorAt)})` : ''}` : ''}{p.source === 'config' ? ' · PIU_LNNP_PEERS' : ''}
            </div>
          </div>
          {p.source === 'panel' && (
            <button type="button" className="btn btn-outline" aria-disabled={busy === p.address} onClick={() => void remove(p.address)} style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5, flex: 'none' }}>Remover</button>
          )}
        </div>
      ))}
    </div>
  );
}
