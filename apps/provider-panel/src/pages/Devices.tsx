import { useState } from 'react';
import { DeviceStatusCell } from '../components/DeviceBits';
import { Dialog } from '../components/Overlays';
import { Bar, Icon, Segmented, Toggle, growX, pressable } from '../components/ui';
import { hoursOptions } from './Settings';
import { useT } from '../i18n/react';
import { fmt, fmtInt } from '../lib/format';
import { ago, relayOn } from '../lib/live';
import { StepUpDialog } from '../components/Pair';
import { deviceLabels, parentName } from '../lib/devices';
import { useStore } from '../state/store';
import type { DeviceFilter, HoursPolicy, RelayNode } from '../types';

const COLS = 'minmax(0,2.3fr) minmax(0,1.1fr) 76px minmax(0,1.1fr) 80px';
const FILTERS: [DeviceFilter, 'dv.filterAll' | 'dv.filterActive' | 'dv.filterPaused' | 'dv.filterWarming'][] = [['all', 'dv.filterAll'], ['active', 'dv.filterActive'], ['paused', 'dv.filterPaused'], ['warming', 'dv.filterWarming']];

export function Devices() {
  const t = useT();
  const { devices, sel, navigate, devFilter, setDevFilter, devQuery, setDevQuery } = useStore();
  const selected = devices.find(d => d.id === sel);
  const q = devQuery.trim().toLowerCase();
  const filtered = devices.filter(d => (devFilter === 'all' || d.status === devFilter) && (!q || d.name.toLowerCase().includes(q)));

  return (
    <div className="page-body devices-layout" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div className="col grow" style={{ gap: 12 }}>
        <div className="row dev-filters" style={{ gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, l]) => {
            const on = devFilter === k;
            const n = k === 'all' ? devices.length : devices.filter(d => d.status === k).length;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setDevFilter(k)}
                style={{ height: 32, padding: '0 12px', whiteSpace: 'nowrap', flex: 'none', borderRadius: 16, border: 'none', background: on ? 'var(--ink)' : 'var(--bg2)', color: on ? 'var(--invink)' : 'var(--ink)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                {t(l)} · {n}
              </button>
            );
          })}
          <div style={{ flex: 1, minWidth: 8 }} />
          <label className="row" style={{ gap: 8, height: 36, padding: '0 12px', borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink2)', flex: 1, minWidth: 120, maxWidth: 220 }}>
            <Icon name="search" size={18} />
            <span className="sr-only">{t('dv.search')}</span>
            <input type="search" value={devQuery} onChange={e => setDevQuery(e.target.value)} placeholder={t('dv.search')}
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: 'var(--ink)' }} />
          </label>
        </div>

        <div className="card-line" role="table" aria-label={t('nav.devices')} style={{ borderRadius: 20, overflow: 'hidden' }}>
          <div role="row" className="mono dev-table" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '11px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' }}>
            <span role="columnheader">{t('dv.colDevice')}</span><span role="columnheader">{t('dv.colStatus')}</span><span role="columnheader" className="col-sec" style={{ textAlign: 'right' }}>{t('dv.colPph')}</span><span role="columnheader" className="col-sec">{t('dv.colStorage')}</span><span role="columnheader" style={{ textAlign: 'right' }}>{t('dv.colToday')}</span>
          </div>
          {filtered.map(d => {
            const on = d.id === sel, v = deviceLabels(d);
            return (
              <div key={d.id} className="dev-table" {...pressable(() => navigate('devices', d.id), d.name)} aria-pressed={on}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '13px 18px', borderTop: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--bg2)' : 'transparent', animation: d.fresh ? 'piuUp .5s .15s both' : 'none', transition: 'background .15s' }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: on ? 'var(--ink)' : 'var(--bg2)', color: on ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'background .15s' }}>
                    <Icon name={d.icon} size={21} wght={300} />
                  </div>
                  <div className="col" style={{ minWidth: 0, gap: 2 }}>
                    <div className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</div>
                    <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls}{d.pub ? ` · ${d.pub}` : d.telemetry === 'live' ? ` · ${t('common.thisNode')}` : ''}{d.parent ? ` · ${t('dv.parentPrefix', { name: parentName(devices, d.parent) })}` : ''}</div>
                  </div>
                </div>
                <DeviceStatusCell d={d} />
                <div className="mono col-sec" style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right' }}>{v.pph}</div>
                <div className="col col-sec" style={{ gap: 5 }}>
                  <Bar pct={v.stoPct} height={5} radius={3} />
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{v.stoLabel}</div>
                </div>
                <div className="tnum" style={{ fontSize: 14, fontWeight: 650, textAlign: 'right' }}>{v.today}</div>
              </div>
            );
          })}
          {!filtered.length && <div style={{ padding: 28, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>{t('dv.noneFilter')}</div>}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)', padding: '4px 4px 0' }}>
          <Icon name="lock" size={17} style={{ color: 'var(--ink)' }} />
          <span>{t('dv.lockNote')}</span>
        </div>
      </div>

      {selected && <DeviceDetail key={selected.id} d={selected} />}
    </div>
  );
}

function DeviceDetail({ d }: { d: RelayNode }) {
  const t = useT();
  const { devices, navigate, togglePause, revokeDevice, showToast, nodeMode, setDeviceLimits, settingsOwner, live, restartDevice, stepUp } = useStore();
  const real = nodeMode === 'node';
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartStepUp, setRestartStepUp] = useState(false);
  const paused = d.status === 'paused';
  const parent = parentName(devices, d.parent);
  const relay = relayOn(live);
  /** Este nó, pausado pela chave de operador em outro equipamento seu (não por este painel). */
  const pausedElsewhere = d.telemetry === 'live' && !!relay?.operatorPolicy?.paused;
  const rep = d.report;
  /** O que acontece com pausa e regras de um equipamento que não é este nó (texto verdadeiro para cada caso). */
  const remoteNote = !real || d.telemetry !== 'none' || d.passive ? null
    : settingsOwner === false ? t('dv.remote.notOwner')
    : !d.nodeId ? t('dv.remote.noId')
    : !relay ? t('dv.remote.relayOff')
    : d.policy?.applied ? t('dv.remote.applied')
    : d.policy ? t('dv.remote.signed')
    : t('dv.remote.willSign');
  const doRestart = async () => {
    setConfirmRestart(false);
    const r = await restartDevice(d.id);
    if (r === 'reauth') { setRestartStepUp(true); return; }
    if (r === 'ok') showToast({ icon: 'restart_alt', title: t('dv.toast.restarting', { name: d.name }), body: t('dv.toast.restartingBody') });
  };
  const statusLabel = d.telemetry === 'none' && !paused
    ? (d.link ? (d.link.online ? t('dv.st.online') : t('dv.st.offline')) : d.passive ? t('dv.st.apOnly') : t('dv.st.noId'))
    : d.status === 'active' ? (d.passive ? t('dv.st.apLinked') : t('dv.st.active')) : paused ? (d.passive ? t('dv.st.apUnlinked') : t('dv.st.pausedByYou')) : t('dv.st.warming');
  const metrics = d.telemetry === 'live'
    ? [[fmtInt(d.receiptsToday ?? 0), t('dv.m.receiptsToday')], [paused ? '0' : fmtInt(d.pph), t('dv.m.fwdH')], [String(d.neighbors), t('dv.m.neighbors')]]
    : d.telemetry === 'none' && rep
    ? [[fmtInt(rep.forwarded), t('dv.m.fwdSince')], [fmtInt(rep.stored), t('dv.m.storedSince')], [String(rep.neighbors), t('dv.m.neighbors')]]
    : d.telemetry === 'none'
    ? [['—', t('dv.m.receiptsToday')], ['—', t('dv.m.fwdH')], ['—', t('dv.m.neighbors')]]
    : d.passive
    ? [['—', t('dv.m.ownLunes')], [String(d.neighbors), t('dv.m.phones')], [parent.split(' ')[0], t('dv.m.parent')]]
    : [['+' + fmt(d.today), t('dv.m.lunesToday')], [paused ? '0' : d.pph ? fmtInt(d.pph) : '—', t('dv.m.pph')], [String(d.neighbors), t('dv.m.neighbors')]];

  const revoke = async () => {
    setConfirmRevoke(false);
    const r = await revokeDevice(d.id);
    if (!r) return; // o erro já foi mostrado
    navigate('devices');
    showToast(r === 'removed' ? { icon: 'delete', title: t('dv.toast.removed'), body: t('dv.toast.removedBody', { name: d.name }) } : { icon: 'key_off', title: t('dv.toast.revoked'), body: t('dv.toast.revokedBody', { name: d.name }) });
  };

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderTop: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5, fontWeight: 550 } as const;

  return (
    <aside aria-label={t('dv.detailAria', { name: d.name })} className="card-line col dev-detail" style={{ width: 360, flex: 'none', borderRadius: 22, padding: 20, gap: 16, animation: 'piuPanel .32s var(--ease-out) both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={d.icon} size={24} wght={350} /></div>
        <div className="col grow" style={{ gap: 3 }}>
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.02em' }}>{d.name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{d.model}</div>
        </div>
        <button type="button" className="btn btn-round" aria-label={t('dv.closeDetail')} onClick={() => navigate('devices')} style={{ flex: 'none' }}><Icon name="close" size={18} /></button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 7, padding: '6px 11px', borderRadius: 99, background: d.status === 'active' ? 'var(--ink)' : 'var(--bg2)', color: d.status === 'active' ? 'var(--invink)' : 'var(--ink)', fontSize: 12.5, fontWeight: 600, transition: 'background .2s,color .2s' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', animation: paused ? 'none' : 'piuBreath 1.6s ease-in-out infinite' }} />{statusLabel}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.cls}{d.uptime === '—' ? '' : d.uptime === t('ago.now') ? ` · ${t('dv.onNow')}` : ` · ${t('dv.onFor', { t: d.uptime })}`}</div>
      </div>

      {d.pub ? (
        <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)' }}>
          <Icon name="wifi" size={17} wght={300} />
          <span className="mono ellipsis grow" style={{ fontSize: 13, fontWeight: 500 }}>{d.pub}</span>
          {/* Com piu-node, o nome é só registrado aqui: a assinatura pela chave de operador ainda não existe. */}
          <span className="row" style={{ gap: 4, fontSize: 12, fontWeight: 600 }}><Icon name={real ? 'badge' : 'verified'} size={15} fill={1} />{real ? t('dv.registered') : t('dv.nameVerified')}</span>
        </div>
      ) : real && (
        <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, color: 'var(--ink2)' }}>{t('dv.noPub')} {d.telemetry === 'live' ? t('dv.noPubSelf') : ''}</div>
      )}

      {real && d.nodeId && (
        <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)' }}>
          <Icon name="fingerprint" size={17} wght={300} />
          <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 500 }}>{d.nodeId}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{t('dv.techId')}</span>
          </div>
          <span className="row" style={{ gap: 4, fontSize: 12, fontWeight: 600, flex: 'none' }}><Icon name={d.signed ? 'verified' : 'pending'} size={15} fill={1} />{d.signed ? t('dv.signedByYou') : t('dv.signing')}</span>
        </div>
      )}

      {real && d.telemetry === 'none' && d.nodeId && (
        // Estado real do enlace LNNP, medido por este nó (não é estatística do outro equipamento).
        <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line2)' }}>
          <Icon name={d.link?.online ? 'link' : 'link_off'} size={17} wght={300} />
          <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.link?.online ? t('dv.linkOn') : t('dv.linkOff')}</span>
            <span className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>
              {d.link?.online ? (d.link.address ?? t('dv.lnnpLink')) : d.link?.lastSeen ? (ago(d.link.lastSeen) === t('ago.now') ? t('dv.seenLt1') : t('dv.seenAgo', { t: ago(d.link.lastSeen) })) : t('dv.notSeen')}
            </span>
          </div>
        </div>
      )}

      {real && d.telemetry === 'none' && d.nodeId && (
        // Resumo que o próprio equipamento assina e manda pela malha (só entre nós do mesmo operador).
        <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--bg2)' }}>
          <Icon name={rep ? 'monitoring' : 'hourglass_empty'} size={17} wght={300} />
          <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rep ? t('dv.report', { state: rep.paused ? t('dv.rep.paused') : rep.relaying ? t('dv.rep.relaying') : t('dv.rep.notRelaying') }) : t('dv.noReport')}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>
              {rep ? t('dv.reportMeta', { recv: ago(rep.receivedAt) === t('ago.now') ? t('ago.lessThanMin') : t('ago.for', { t: ago(rep.receivedAt) }), up: ago(rep.startedAt) })
                : t('dv.reportWhen')}
            </span>
          </div>
        </div>
      )}

      {real && d.passive && (
        <div className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line2)' }}>
          <Icon name="account_tree" size={17} wght={300} />
          <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
            <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{d.parent ? t('dv.parentOf', { name: parent }) : t('dv.noParent')}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d.parent ? t('dv.parentRole') : t('dv.parentGone')}</span>
          </div>
        </div>
      )}

      {pausedElsewhere && (
        <div role="note" style={{ padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, lineHeight: 1.45 }}>
          {t('dv.pausedElsewhere', { seq: relay!.operatorPolicy!.seq })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        {metrics.map(([v, l]) => (
          <div key={l} className="col" style={{ padding: 12, borderRadius: 14, background: 'var(--bg2)', gap: 3 }}>
            <div className="tnum ellipsis" style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.02em' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{l}</div>
          </div>
        ))}
      </div>

      <div className="col" style={{ gap: 10 }}>
        <div className="label">{t('dv.ifaces')}</div>
        {d.ifaces.map(i => (
          <div key={i.name} className="col" style={{ gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}><span style={{ fontWeight: 550 }}>{i.name}</span><span style={{ color: 'var(--ink2)', fontSize: 12 }}>{i.detail}</span></div>
            {i.load !== null && <div className="track" style={{ height: 4, borderRadius: 2 }}><div style={{ width: (paused ? 0 : i.load) + '%', animation: growX(), transition: 'width .3s' }} /></div>}
          </div>
        ))}
        {!d.ifaces.length && d.telemetry === 'none' && <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{
          d.passive ? t('dv.noIf.ap')
          : d.nodeId ? t('dv.noIf.id')
          : t('dv.noIf.noId')}</div>}
      </div>

      {real && !d.passive && <DeviceRules d={d} note={remoteNote} onSave={l => setDeviceLimits(d.id, l)} />}

      <div className="col" style={{ gap: 8 }}>
        <div className="label">{t('dv.recentReceipts')}</div>
        {d.receipts.map((r, i) => (
          <div key={i} className="mono" style={{ display: 'flex', gap: 10, fontSize: 11.5, opacity: r.state === t('seed.rc.confirmed') || r.state === t('live.awaitingValidator') ? 1 : 0.5 }}>
            <span style={{ color: 'var(--ink2)' }}>{r.time}</span>
            <span className="ellipsis grow">{r.hops ? `${r.kind} · ${r.hops}` : r.kind}</span>
            <span style={{ fontWeight: 500 }}>{r.state}</span>
          </div>
        ))}
        {!d.receipts.length && (
          <div style={{ padding: 12, borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, color: 'var(--ink2)', textAlign: 'center' }}>
            {d.passive ? t('dv.rc.ap', { parent })
              : d.telemetry === 'live' ? t('dv.rc.live')
              : d.telemetry === 'none' ? t('dv.rc.none') : t('dv.rc.soon')}
          </div>
        )}
      </div>

      <div style={{ borderRadius: 16, background: 'var(--bg2)', overflow: 'hidden' }}>
        <div className="row" style={{ gap: 12, padding: '11px 13px' }}>
          <div style={{ flex: 1, fontSize: 13.5, fontWeight: 550 }}>{d.passive ? t('dv.unlink') : t('dv.pause')}</div>
          <Toggle on={paused} onChange={() => togglePause(d.id)} label={d.passive ? t('dv.unlink') : t('dv.pause')} />
        </div>
        {real && d.telemetry === 'none' && (remoteNote || d.passive) && (
          <div style={{ padding: '0 13px 11px', fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{remoteNote ?? t('dv.apNoPause')}</div>
        )}
        {real ? (
          <>
            {/* Atualizar pela malha ainda não existe: sem simular sucesso. */}
            <div aria-disabled="true" style={{ ...rowStyle, cursor: 'default', opacity: 0.55 }}>
              <div className="col" style={{ flex: 1, gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 550 }}>{t('dv.update')}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink2)', fontWeight: 400 }}>{t('dv.updateNA')}</span>
              </div>
            </div>
            {d.telemetry === 'live' && settingsOwner !== false ? (
              // Só o nó que serve o painel, só o dono, com código novo do equipamento (step-up).
              <div {...pressable(() => setConfirmRestart(true), t('dv.restartAria', { name: d.name }))} style={rowStyle}>
                <div className="col" style={{ flex: 1, gap: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 550 }}>{t('dv.restart')}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink2)', fontWeight: 400 }}>{t('dv.restartHint')}</span>
                </div>
              </div>
            ) : (
              <div aria-disabled="true" style={{ ...rowStyle, cursor: 'default', opacity: 0.55 }}>
                <div className="col" style={{ flex: 1, gap: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 550 }}>{t('dv.restart')}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink2)', fontWeight: 400 }}>{d.telemetry === 'live' ? t('dv.restartOwnerOnly') : t('dv.restartSelfOnly')}</span>
                </div>
              </div>
            )}
          </>
        ) : !d.passive && (
          <div {...pressable(() => showToast({ icon: 'system_update_alt', title: t('dv.toast.updated'), body: t('dv.toast.updatedBody', { name: d.name }) }))} style={rowStyle}>
            <div className="col" style={{ flex: 1, gap: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 550 }}>{t('dv.update')}</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink2)', fontWeight: 400 }}>{t('dv.updateAvail')}</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 13, background: 'var(--ink)', color: 'var(--invink)' }}>{t('dv.updateBtn')}</span>
          </div>
        )}
        {!real && <div {...pressable(() => showToast({ icon: 'restart_alt', title: t('dv.toast.restarting', { name: d.name }), body: t('dv.toast.restartDemo') }))} style={rowStyle}>{t('dv.restart')}</div>}
        {d.telemetry === 'live'
          ? <div style={{ ...rowStyle, cursor: 'default', fontSize: 12, fontWeight: 400, color: 'var(--ink2)' }}>{t('dv.selfNote')}</div>
          : <div {...pressable(() => setConfirmRevoke(true))} style={{ ...rowStyle, fontWeight: 650 }}>{d.passive ? t('dv.revokePub') : real && !d.nodeId ? t('dv.removePanel') : t('dv.revokeCred')}</div>}
      </div>

      {confirmRevoke && (
        <Dialog icon="key_off" title={real && !d.nodeId ? t('dv.dlg.remove', { name: d.name }) : t('dv.dlg.revoke', { name: d.name })}
          body={d.passive
            ? t('dv.dlg.apBody', { pub: d.pub })
            : real && !d.nodeId ? t('dv.dlg.noIdBody')
            : real ? t('dv.dlg.realBody')
            : t('dv.dlg.demoBody')}
          primaryLabel={real && !d.nodeId ? t('common.remove') : t('dv.dlg.revokeBtn')} onPrimary={revoke} onClose={() => setConfirmRevoke(false)} />
      )}
      {confirmRestart && (
        <Dialog icon="restart_alt" title={t('dv.dlg.restart', { name: d.name })} primaryLabel={t('dv.restart')} onPrimary={() => void doRestart()} onClose={() => setConfirmRestart(false)}
          body={t('dv.dlg.restartBody')} />
      )}
      {restartStepUp && (
        <StepUpDialog reason={t('dv.stepup.restart')} confirmLabel={t('dv.stepup.restartBtn')} onClose={() => setRestartStepUp(false)}
          onConfirm={async code => { const p = await stepUp(code); if (p) return p; setRestartStepUp(false); await doRestart(); return null; }} />
      )}
    </aside>
  );
}

type Limits = NonNullable<RelayNode['limits']>;
const RULE_DEFAULT: Limits = { bw: 20, sto: 4, hours: 'always' };

/**
 * Regras do equipamento (as mesmas do assistente, passo "Regras"). No nó que serve o painel, valem
 * no motor na hora, junto com os limites globais; nos outros, ficam registradas.
 */
function DeviceRules({ d, note, onSave }: { d: RelayNode; note: string | null; onSave: (l: Limits | null) => Promise<boolean> }) {
  const t = useT();
  const on = !!d.limits;
  const v = d.limits ?? RULE_DEFAULT;
  const set = (p: Partial<Limits>) => void onSave({ ...v, ...p });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="label grow">{t('dv.rules')}</div>
        <Toggle on={on} label={t('dv.rulesToggle')} onChange={() => void onSave(on ? null : RULE_DEFAULT)} />
      </div>
      {on ? (
        <>
          <Segmented variant="bg2" label={t('dv.band')} value={v.bw} onChange={bw => set({ bw })} options={([5, 20, 50] as const).map(x => ({ value: x, label: t('common.mbps', { n: x }) }))} />
          <Segmented variant="bg2" label={t('dv.storage')} value={v.sto} onChange={sto => set({ sto })} options={([1, 4, 8] as const).map(x => ({ value: x, label: t('common.gb', { n: x }) }))} />
          <Segmented<HoursPolicy> variant="bg2" label={t('dv.hours')} value={v.hours} onChange={hours => set({ hours })} options={hoursOptions()} />
        </>
      ) : null}
      <div style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>
        {!on ? t('dv.rulesNone')
          : d.telemetry === 'live' ? t('dv.rulesLive')
          : note ?? t('dv.rulesRegistered')}
      </div>
    </div>
  );
}
