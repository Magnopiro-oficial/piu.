import { useState } from 'react';
import { DeviceStatusCell } from '../components/DeviceBits';
import { Dialog } from '../components/Overlays';
import { Bar, Icon, Toggle, growX, pressable } from '../components/ui';
import { fmt, fmtInt } from '../lib/format';
import { deviceLabels, parentName } from '../lib/devices';
import { useStore } from '../state/store';
import type { DeviceFilter, RelayNode } from '../types';

const COLS = 'minmax(0,2.3fr) minmax(0,1.1fr) 76px minmax(0,1.1fr) 80px';
const FILTERS: [DeviceFilter, string][] = [['all', 'Todos'], ['active', 'Ativos'], ['paused', 'Pausados'], ['warming', 'Aquecendo']];

export function Devices() {
  const { devices, sel, navigate, devFilter, setDevFilter, devQuery, setDevQuery } = useStore();
  const selected = devices.find(d => d.id === sel);
  const q = devQuery.trim().toLowerCase();
  const filtered = devices.filter(d => (devFilter === 'all' || d.status === devFilter) && (!q || d.name.toLowerCase().includes(q)));

  return (
    <div className="page-body" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div className="col grow" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          {FILTERS.map(([k, l]) => {
            const on = devFilter === k;
            const n = k === 'all' ? devices.length : devices.filter(d => d.status === k).length;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setDevFilter(k)}
                style={{ height: 32, padding: '0 12px', whiteSpace: 'nowrap', flex: 'none', borderRadius: 16, border: 'none', background: on ? 'var(--ink)' : 'var(--bg2)', color: on ? 'var(--invink)' : 'var(--ink)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                {l} · {n}
              </button>
            );
          })}
          <div style={{ flex: 1, minWidth: 8 }} />
          <label className="row" style={{ gap: 8, height: 36, padding: '0 12px', borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink2)', flex: 1, minWidth: 120, maxWidth: 220 }}>
            <Icon name="search" size={18} />
            <span className="sr-only">Buscar equipamento</span>
            <input type="search" value={devQuery} onChange={e => setDevQuery(e.target.value)} placeholder="Buscar equipamento"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: 'var(--ink)' }} />
          </label>
        </div>

        <div className="card-line" role="table" aria-label="Equipamentos" style={{ borderRadius: 20, overflow: 'hidden' }}>
          <div role="row" className="mono" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '11px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' }}>
            <span role="columnheader">EQUIPAMENTO</span><span role="columnheader">STATUS</span><span role="columnheader" style={{ textAlign: 'right' }}>PAC/H</span><span role="columnheader">ARMAZENAMENTO</span><span role="columnheader" style={{ textAlign: 'right' }}>HOJE</span>
          </div>
          {filtered.map(d => {
            const on = d.id === sel, v = deviceLabels(d);
            return (
              <div key={d.id} {...pressable(() => navigate('devices', d.id), d.name)} aria-pressed={on}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '13px 18px', borderTop: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--bg2)' : 'transparent', animation: d.fresh ? 'piuUp .5s .15s both' : 'none', transition: 'background .15s' }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: on ? 'var(--ink)' : 'var(--bg2)', color: on ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'background .15s' }}>
                    <Icon name={d.icon} size={21} wght={300} />
                  </div>
                  <div className="col" style={{ minWidth: 0, gap: 2 }}>
                    <div className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</div>
                    <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls} · {d.pub}</div>
                  </div>
                </div>
                <DeviceStatusCell d={d} />
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right' }}>{v.pph}</div>
                <div className="col" style={{ gap: 5 }}>
                  <Bar pct={v.stoPct} height={5} radius={3} />
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{v.stoLabel}</div>
                </div>
                <div className="tnum" style={{ fontSize: 14, fontWeight: 650, textAlign: 'right' }}>{v.today}</div>
              </div>
            );
          })}
          {!filtered.length && <div style={{ padding: 28, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>Nenhum equipamento neste filtro.</div>}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)', padding: '4px 4px 0' }}>
          <Icon name="lock" size={17} style={{ color: 'var(--ink)' }} />
          <span>Os equipamentos transportam só envelopes cifrados. Nenhum deles consegue ler mensagens, e cada um tem identidade técnica própria.</span>
        </div>
      </div>

      {selected && <DeviceDetail key={selected.id} d={selected} />}
    </div>
  );
}

function DeviceDetail({ d }: { d: RelayNode }) {
  const { devices, navigate, togglePause, revokeDevice, showToast } = useStore();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const paused = d.status === 'paused';
  const parent = parentName(devices, d.parent);
  const statusLabel = d.status === 'active' ? (d.passive ? 'Vinculado à malha' : 'Ativo na malha') : paused ? (d.passive ? 'Desvinculado' : 'Pausado por você') : 'Aquecendo';
  const metrics = d.passive
    ? [['—', 'LUNES próprios'], [String(d.neighbors), 'celulares'], [parent.split(' ')[0], 'nó pai']]
    : [['+' + fmt(d.today), 'LUNES hoje'], [paused ? '0' : d.pph ? fmtInt(d.pph) : '—', 'pacotes/h'], [String(d.neighbors), 'vizinhos']];

  const revoke = () => {
    setConfirmRevoke(false);
    revokeDevice(d.id);
    navigate('devices');
    showToast({ icon: 'key_off', title: 'Credencial revogada', body: d.name + ' saiu da sua operação.' });
  };

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderTop: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5, fontWeight: 550 } as const;

  return (
    <aside aria-label={'Detalhe de ' + d.name} className="card-line col" style={{ width: 360, flex: 'none', borderRadius: 22, padding: 20, gap: 16, animation: 'piuPanel .32s var(--ease-out) both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={d.icon} size={24} wght={350} /></div>
        <div className="col grow" style={{ gap: 3 }}>
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.02em' }}>{d.name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{d.model}</div>
        </div>
        <button type="button" className="btn btn-round" aria-label="Fechar detalhe" onClick={() => navigate('devices')} style={{ flex: 'none' }}><Icon name="close" size={18} /></button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 7, padding: '6px 11px', borderRadius: 99, background: d.status === 'active' ? 'var(--ink)' : 'var(--bg2)', color: d.status === 'active' ? 'var(--invink)' : 'var(--ink)', fontSize: 12.5, fontWeight: 600, transition: 'background .2s,color .2s' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', animation: paused ? 'none' : 'piuBreath 1.6s ease-in-out infinite' }} />{statusLabel}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls} · ligado há {d.uptime}</div>
      </div>

      <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)' }}>
        <Icon name="wifi" size={17} wght={300} />
        <span className="mono ellipsis grow" style={{ fontSize: 13, fontWeight: 500 }}>{d.pub}</span>
        <span className="row" style={{ gap: 4, fontSize: 12, fontWeight: 600 }}><Icon name="verified" size={15} fill={1} />nome verificado</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        {metrics.map(([v, l]) => (
          <div key={l} className="col" style={{ padding: 12, borderRadius: 14, background: 'var(--bg2)', gap: 3 }}>
            <div className="tnum ellipsis" style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.02em' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{l}</div>
          </div>
        ))}
      </div>

      <div className="col" style={{ gap: 10 }}>
        <div className="label">INTERFACES</div>
        {d.ifaces.map(i => (
          <div key={i.name} className="col" style={{ gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}><span style={{ fontWeight: 550 }}>{i.name}</span><span style={{ color: 'var(--ink2)', fontSize: 12 }}>{i.detail}</span></div>
            <div className="track" style={{ height: 4, borderRadius: 2 }}><div style={{ width: (paused ? 0 : i.load) + '%', animation: growX(), transition: 'width .3s' }} /></div>
          </div>
        ))}
      </div>

      <div className="col" style={{ gap: 8 }}>
        <div className="label">RECIBOS RECENTES</div>
        {d.receipts.map((r, i) => (
          <div key={i} className="mono" style={{ display: 'flex', gap: 10, fontSize: 11.5, opacity: r.state === 'confirmado' ? 1 : 0.5 }}>
            <span style={{ color: 'var(--ink2)' }}>{r.time}</span>
            <span className="ellipsis grow">{r.kind} · {r.hops}</span>
            <span style={{ fontWeight: 500 }}>{r.state}</span>
          </div>
        ))}
        {!d.receipts.length && (
          <div style={{ padding: 12, borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, color: 'var(--ink2)', textAlign: 'center' }}>
            {d.passive ? `Pontos de acesso não assinam recibos. As entregas por ele contam para o ${parent}.` : 'Primeiros recibos em alguns minutos.'}
          </div>
        )}
      </div>

      <div style={{ borderRadius: 16, background: 'var(--bg2)', overflow: 'hidden' }}>
        <div className="row" style={{ gap: 12, padding: '11px 13px' }}>
          <div style={{ flex: 1, fontSize: 13.5, fontWeight: 550 }}>{d.passive ? 'Desvincular da malha' : 'Pausar retransmissão'}</div>
          <Toggle on={paused} onChange={() => togglePause(d.id)} label={d.passive ? 'Desvincular da malha' : 'Pausar retransmissão'} />
        </div>
        {!d.passive && (
          <div {...pressable(() => showToast({ icon: 'system_update_alt', title: 'Atualização assinada aplicada', body: d.name + ' · Piu Node 0.4.3' }))} style={rowStyle}>
            <div className="col" style={{ flex: 1, gap: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 550 }}>Atualizar Piu Node</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink2)', fontWeight: 400 }}>0.4.3 assinada disponível</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 13, background: 'var(--ink)', color: 'var(--invink)' }}>Atualizar</span>
          </div>
        )}
        <div {...pressable(() => showToast({ icon: 'restart_alt', title: 'Reiniciando ' + d.name, body: 'Mensagens guardadas continuam no armazenamento local.' }))} style={rowStyle}>Reiniciar</div>
        <div {...pressable(() => setConfirmRevoke(true))} style={{ ...rowStyle, fontWeight: 650 }}>{d.passive ? 'Revogar nome público e remover' : 'Revogar credencial e remover'}</div>
      </div>

      {confirmRevoke && (
        <Dialog icon="key_off" title={`Revogar ${d.name}?`}
          body={d.passive
            ? `O nome ${d.pub} deixa de ser reconhecido como seu. O roteador continua funcionando como Wi-Fi comum.`
            : 'A credencial é revogada em toda a malha e o equipamento deixa de retransmitir como seu. Créditos pendentes dele continuam sendo validados.'}
          primaryLabel="Revogar e remover" onPrimary={revoke} onClose={() => setConfirmRevoke(false)} />
      )}
    </aside>
  );
}
