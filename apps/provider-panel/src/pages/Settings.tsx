import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Overlays';
import { PasswordDialog, RestoreDialog, StepUpDialog } from '../components/Pair';
import { PairPhone } from '../components/Phone';
import { LANGS, dateFormat, setLang, t, type Key, type Lang } from '../i18n';
import { useLang, useT } from '../i18n/react';
import { ApiError, NeedsReauth, type ApiOperatorKey } from '../lib/api';
import { downloadText } from '../lib/io';
import { Icon, Segmented, Toggle } from '../components/ui';
import { OPERATOR, pubRules, sessions as demoSessions } from '../data/seed';
import { useStore } from '../state/store';
import type { HoursPolicy, Policies } from '../types';

const segProps = { gap: 4, radius: 12, btnRadius: 9 } as const;

/**
 * Com o piu-node: o que vale nesta versão. O nome público fica só registrado neste nó (a assinatura
 * pela chave de operador e o anúncio pela malha ainda não existem), então as regras da demonstração não se aplicam.
 */
const pubRulesNode = () => [
  { icon: 'badge', title: t('st.pubNode.title'), desc: t('st.pubNode.desc') },
  { icon: 'shield_person', title: t('seed.rule.personal'), desc: t('seed.rule.personalD') },
];

export function Settings() {
  const t = useT();
  const { limits, setLimits, policies, togglePolicy, devices, showToast, sessions, revokeOtherSessions, stepUp, phones, refreshPhones, api, settingsOwner } = useStore();
  const [pairing, setPairing] = useState<{ id: string; qr: string } | null>(null);
  const [pairStepUp, setPairStepUp] = useState(false);
  const startPair = async () => {
    if (!api) return;
    try { const r = await api.startPhonePairing(t('st.phoneName')); setPairing({ id: r.id, qr: r.qr }); }
    catch (e) { if (e instanceof NeedsReauth) setPairStepUp(true); else showToast({ icon: 'error', title: t('st.toast.cantPair'), body: e instanceof ApiError ? e.message : t('common.tryAgain') }); }
  };
  const confirmPair = async (code: string) => {
    if (!api || !pairing) return null;
    try { await api.confirmPhone(pairing.id, code); } catch (e) { return e instanceof ApiError ? e.message : t('common.couldNotConfirm'); }
    setPairing(null); refreshPhones();
    showToast({ icon: 'smartphone', title: t('st.toast.paired'), body: t('st.toast.pairedBody') });
    return null;
  };
  const removePhone = async (id: string) => {
    if (!api) return;
    try { await api.removePhone(id); refreshPhones(); showToast({ icon: 'phonelink_erase', title: t('st.toast.phoneRemoved'), body: t('st.toast.phoneRemovedBody') }); }
    catch (e) { showToast({ icon: 'error', title: t('st.toast.cantRemove'), body: e instanceof ApiError ? e.message : t('common.tryAgain') }); }
  };
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // Com o piu-node: acessos reais (vazio enquanto carrega); na demonstração, os do exemplo.
  const rows: [string, string, string, string][] = sessions
    ? sessions.map(x => [x.label.startsWith('App') ? 'desktop_windows' : 'computer', x.current ? t('st.thisAccess') : x.label, `${x.current ? x.label + ' · ' : ''}${t('st.since', { t: when(x.createdAt) })}`, x.current ? t('common.now') : t('st.seen', { t: when(x.lastSeen) })])
    : api ? [] : demoSessions();
  const others = sessions ? sessions.filter(x => !x.current).length : api ? 0 : 1;
  const endOthers = async () => {
    const r = await revokeOtherSessions();
    if (r === 'reauth') { setStepUpOpen(true); return; }
    if (r === 'ok') showToast({ icon: 'logout', title: t('st.toast.ended'), body: t('st.toast.endedBody') });
  };
  const confirmStepUp = async (code: string) => {
    const problem = await stepUp(code);
    if (problem) return problem;
    setStepUpOpen(false);
    await endOthers();
    return null;
  };
  // Com o piu-node, "limitar remetentes desconhecidos" e "só comunidades que sigo" ainda não têm
  // critério no motor (decisão de produto pendente): aparecem desligadas e sem efeito.
  const NO_EFFECT = t('st.noEffect');
  const policyRows: [keyof Policies | 'alerts', string, string, boolean][] = [
    ['media', t('st.pol.media'), t('st.pol.mediaDesc'), false],
    ['alerts', t('st.pol.alerts'), t('st.pol.alertsDesc'), false],
    ['unknown', t('st.pol.unknown'), api ? NO_EFFECT : t('st.pol.unknownDesc'), !!api],
    ['community', t('st.pol.community'), api ? NO_EFFECT : t('st.pol.communityDesc'), !!api],
  ];
  // Só os ajustes do dono deste equipamento valem no motor (o nó recusa os de outro operador).
  const notOwner = !!api && settingsOwner === false;
  const ownerNote = notOwner && (
    <div role="note" style={{ padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, lineHeight: 1.45 }}>
      {t('st.ownerNote')}
    </div>
  );

  return (
    <div className="page-body settings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16, alignItems: 'start' }}>
      <section className="card-soft col" style={{ borderRadius: 22, padding: 20, gap: 16 }}>
        <CardHead title={api ? t('st.limitsNode') : t('st.limitsGlobal')} sub={api ? t('st.limitsNodeSub') : t('st.limitsGlobalSub')} />
        {ownerNote}
        <fieldset disabled={notOwner} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, opacity: notOwner ? 0.5 : 1 }}>
          <LimitRow title={api ? t('st.bandNode') : t('st.bandGlobal')} hint={api ? t('st.forThird') : t('st.summing')}>
            <Segmented {...segProps} label={t('st.bandAria')} value={limits.bw} onChange={bw => setLimits({ bw })} options={[20, 50, 100].map(v => ({ value: v, label: t('common.mbps', { n: v }) }))} />
          </LimitRow>
          <LimitRow title={t('st.storageTitle')} hint={t('st.storageHint')}>
            <Segmented {...segProps} label={t('dv.storage')} value={limits.sto} onChange={sto => setLimits({ sto })} options={[4, 8, 16].map(v => ({ value: v, label: t('common.gb', { n: v }) }))} />
          </LimitRow>
          <LimitRow title={t('st.hoursTitle')} hint={api ? t('st.hoursNode') : t('st.hoursAll')}>
            <Segmented<HoursPolicy> {...segProps} label={t('dv.hours')} value={limits.hours} onChange={hours => setLimits({ hours })} options={hoursOptions()} />
          </LimitRow>
        </fieldset>
      </section>

      <section className="card-soft col" style={{ borderRadius: 22, padding: '20px 20px 8px' }}>
        <div style={{ paddingBottom: 10 }}><CardHead title={t('st.policy')} sub={api ? t('st.policyNodeSub') : t('st.policyGlobalSub')} /></div>
        {notOwner && <div style={{ paddingBottom: 10 }}>{ownerNote}</div>}
        {policyRows.map(([k, n, d, noEffect]) => {
          const locked = k === 'alerts';
          const on = locked ? true : noEffect ? false : policies[k];
          return (
            <div key={k} className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', opacity: noEffect ? 0.55 : 1 }}>
              <div className="col grow" style={{ gap: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 550 }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{d}</div>
              </div>
              <Toggle on={on} label={noEffect ? t('st.pol.noEffectAria', { name: n, note: NO_EFFECT.toLowerCase() }) : n} disabled={locked || noEffect || (notOwner && k === 'media')}
                onChange={locked || noEffect ? undefined : () => togglePolicy(k)} />
            </div>
          );
        })}
      </section>

      <section className="card-line col" style={{ borderRadius: 22, padding: 20, gap: 12 }}>
        <CardHead title={t('st.access')} sub={t('st.accessSub')} />
        {rows.map(([icon, n, d, s]) => (
          <div key={n} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <Icon name={icon} size={20} wght={300} />
            <div className="col" style={{ flex: 1, gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 550 }}>{n}</div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{d}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{s}</span>
          </div>
        ))}
        <button type="button" className="btn btn-outline" disabled={others === 0} onClick={() => void endOthers()}
          style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: others === 0 ? 0.4 : 1 }}>{others === 0 ? t('st.noOther') : t('st.endOthers')}</button>
        {stepUpOpen && <StepUpDialog onConfirm={confirmStepUp} onClose={() => setStepUpOpen(false)} />}
        {phones && (
          <div id="cfg-phones" className="col" style={{ gap: 4, paddingTop: 10, borderTop: '1px solid var(--line)', borderRadius: 4 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t('st.phones')}</div>
            {phones.filter(p => p.confirmed).length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{t('st.noPhones')}</div>}
            {phones.filter(p => p.confirmed).map(p => (
              <div key={p.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
                <Icon name="smartphone" size={20} wght={300} />
                <div className="col grow" style={{ gap: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{t('st.phoneMeta', { t: when(p.addedAt) })}</div>
                </div>
                <button type="button" className="btn btn-outline" onClick={() => void removePhone(p.id)} style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5 }}>{t('common.remove')}</button>
              </div>
            ))}
            <button type="button" className="btn btn-outline" onClick={() => void startPair()} style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, marginTop: 4 }}>{t('st.pairPhone')}</button>
          </div>
        )}
        {pairing && <PairPhone qr={pairing.qr} onConfirm={confirmPair} onClose={() => setPairing(null)} />}
        {pairStepUp && <StepUpDialog onConfirm={async code => { const p = await stepUp(code); if (p) return p; setPairStepUp(false); await startPair(); return null; }} onClose={() => setPairStepUp(false)} />}
      </section>

      <section id="cfg-key" className="card-line col" style={{ borderRadius: 22, padding: 20, gap: 12 }}>
        <CardHead title={t('st.identity')} sub={t('st.identitySub')} />
        {api ? <OperatorKey /> : (<>
        <div className="mono" aria-label={t('st.fingerprintAria')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, fontSize: 15, fontWeight: 500, padding: '12px 14px', borderRadius: 14, background: 'var(--bg2)' }}>
          {OPERATOR.fingerprint.map(g => <span key={g}>{g}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => showToast({ icon: 'key', title: t('st.toast.backup'), body: t('st.toast.backupDemo') })} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('st.exportBackup')}</button>
          <button type="button" className="btn btn-outline" onClick={() => showToast({ icon: 'sync_lock', title: t('st.toast.rotation'), body: t('st.toast.rotationBody') })} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('st.rotate')}</button>
        </div>
        </>)}
      </section>

      <LanguageCard />

      <section className="card-line settings-wide" style={{ gridColumn: 'span 2', borderRadius: 22, padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', gap: 28 }}>
        <div className="col" style={{ gap: 10 }}>
          <CardHead title={t('st.pubNames')} sub={t('st.pubNamesSub')} />
          {devices.filter(d => d.pub).map(d => (
            <div key={d.id} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <Icon name={d.icon} size={19} wght={300} />
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <div className="mono ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{d.pub}</div>
                <div className="ellipsis" style={{ fontSize: 12, color: 'var(--ink2)' }}>{d.name} · {d.cls}</div>
              </div>
              {/* Com piu-node, o nome fica só registrado: a assinatura pela chave de operador ainda não existe. */}
              <span className="row" style={{ gap: 4, fontSize: 12, fontWeight: 600 }}><Icon name={api ? 'badge' : 'verified'} size={15} fill={1} />{api ? t('dv.registered') : t('st.signed')}</span>
            </div>
          ))}
          {!devices.some(d => d.pub) && <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 13, color: 'var(--ink2)' }}>{t('st.noPubNames')}</div>}
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', paddingTop: 6 }}>{t('st.pubRule')}</div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>{t('st.antiFake')}</div>
          {(api ? pubRulesNode() : pubRules()).map(r => (
            <div key={r.title} style={{ display: 'flex', gap: 12 }}>
              <Icon name={r.icon} size={20} wght={300} />
              <div className="col" style={{ flex: 1, gap: 2 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * “Idioma do painel” (como no design): grade com o nome nativo e o nome no idioma atual, o atual
 * marcado. Vale só para este navegador; o app de conversa tem o próprio ajuste.
 */
function LanguageCard() {
  const t = useT();
  const lang = useLang();
  const { showToast } = useStore();
  const [busy, setBusy] = useState<Lang | null>(null);
  const pick = async (code: Lang, native: string) => {
    if (code === lang || busy) return;
    setBusy(code);
    try { await setLang(code); showToast({ icon: 'translate', title: t('lang.toast', { name: native }), body: t('lang.toastBody') }); }
    catch { /* dicionário não carregou: fica no idioma atual */ }
    finally { setBusy(null); }
  };
  return (
    <section id="cfg-lang" className="card-line settings-wide col" style={{ gridColumn: 'span 2', borderRadius: 22, padding: 20, gap: 10 }}>
      <CardHead title={t('lang.title')} sub={t('lang.note')} />
      <div role="radiogroup" aria-label={t('lang.title')} className="lang-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4 }}>
        {LANGS.map(l => {
          const on = l.code === lang;
          return (
            <button key={l.code} type="button" role="radio" aria-checked={on} lang={l.code} aria-busy={busy === l.code || undefined} onClick={() => void pick(l.code, l.native)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, height: 44, padding: '0 10px', border: 'none', borderRadius: 12, background: on ? 'var(--bg2)' : 'transparent', color: 'var(--ink)', cursor: on ? 'default' : 'pointer', textAlign: 'left', transition: 'background .15s', opacity: busy && busy !== l.code ? 0.6 : 1 }}>
              <Icon name={on ? 'check_circle' : 'radio_button_unchecked'} size={18} fill={on ? 1 : 0} />
              <span className="col" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: on ? 650 : 450 }}>{l.native}</span>
                <span className="ellipsis" lang={lang} style={{ fontSize: 11, color: 'var(--ink2)' }}>{t(`lang.name.${l.code}` as Key)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "agora", "há 5 min", "há 2 h", "12/11" (idioma e região do painel). */
function when(at: number) {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return t('common.now');
  if (m < 60) return t('ago.minAgo', { n: m });
  if (m < 24 * 60) return t('ago.hAgo', { n: Math.round(m / 60) });
  return dateFormat({ day: '2-digit', month: '2-digit' }).format(at);
}

/** Opções do horário de operação no idioma atual (chamar na renderização). */
export const hoursOptions = (): { value: HoursPolicy; label: string }[] => [{ value: 'always', label: t('hours.always') }, { value: 'night', label: t('hours.night') }, { value: 'day', label: t('hours.day') }];

function CardHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="col" style={{ gap: 3 }}>
      <h2 className="h-card" style={{ margin: 0 }}>{title}</h2>
      <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{sub}</div>
    </div>
  );
}

function LimitRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}><span style={{ fontWeight: 550 }}>{title}</span><span style={{ color: 'var(--ink2)' }}>{hint}</span></div>
      {children}
    </div>
  );
}

const fmtDay = (ms: number) => dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);

/**
 * Chave de operador real (piu-node): impressão digital, backup cifrado com senha e rotação.
 * Backup e rotação pedem um código novo do equipamento (step-up).
 */
function OperatorKey() {
  const t = useT();
  const { api, showToast, stepUp, live, refreshLive } = useStore();
  const [key, setKey] = useState<ApiOperatorKey | null>(null);
  const [failed, setFailed] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  /** Ação esperando o código do equipamento. */
  const [pending, setPending] = useState<null | { reason: string; label: string; run: () => Promise<void> }>(null);
  const load = useCallback(() => { api?.operatorKey().then(k => { setKey(k); setFailed(false); }).catch(() => setFailed(true)); }, [api]);
  useEffect(load, [load]);
  const signed = live?.relay && live.relay.enabled ? live.relay.operator?.signed : undefined;

  const backup = async (password: string): Promise<string | null> => {
    if (!api) return null;
    try {
      const r = await api.backupOperatorKey(password);
      downloadText(r.filename, r.backup, 'application/octet-stream');
      setPwOpen(false);
      load();
      showToast({ icon: 'key', title: t('st.toast.backup'), body: t('ok.toast.backupBody', { file: r.filename }) });
      return null;
    } catch (e) {
      if (e instanceof NeedsReauth) {
        setPwOpen(false);
        setPending({ reason: t('ok.stepup.backup'), label: t('ok.stepup.backupBtn'), run: async () => { await backup(password); } });
        return null;
      }
      return e instanceof ApiError ? e.message : t('ok.cantExport');
    }
  };
  /** Restaura o backup (arquivo + senha). Sem confirmação recente, pede o código e tenta de novo. */
  const restore = async (backup: string, password: string): Promise<string | null> => {
    if (!api) return null;
    try {
      setKey(await api.restoreOperatorKey(backup, password));
      setRestoreOpen(false);
      load();
      void refreshLive();
      showToast({ icon: 'settings_backup_restore', title: t('ok.toast.restored'), body: t('ok.toast.restoredBody') });
      return null;
    } catch (e) {
      if (e instanceof NeedsReauth) {
        setRestoreOpen(false);
        setPending({ reason: t('ok.stepup.restore'), label: t('ok.stepup.restoreBtn'), run: async () => { const p = await restore(backup, password); if (p) { showToast({ icon: 'error', title: t('ok.toast.notRestored'), body: p }); } } });
        return null;
      }
      return e instanceof ApiError ? e.message : t('ok.cantRestore');
    }
  };
  const rotate = async () => {
    if (!api) return;
    setRotateOpen(false);
    try {
      setKey(await api.rotateOperatorKey());
      load();
      showToast({ icon: 'sync_lock', title: t('ok.toast.rotated'), body: t('ok.toast.rotatedBody') });
    } catch (e) {
      if (e instanceof NeedsReauth) setPending({ reason: t('ok.stepup.rotate'), label: t('ok.stepup.rotateBtn'), run: rotate });
      else showToast({ icon: 'error', title: t('ok.cantRotate'), body: e instanceof ApiError ? e.message : t('common.tryAgain') });
    }
  };

  if (!key) {
    return <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', fontSize: 13, color: 'var(--ink2)' }}>{failed ? t('ok.loadFail') : t('ok.loading')}</div>;
  }
  const facts = [
    t('ok.created', { d: fmtDay(key.createdAt) }),
    key.rotations ? t('ok.rotations', { count: key.rotations, d: fmtDay(key.rotatedAt!) }) : t('ok.neverRotated'),
    key.lastBackupAt ? t('ok.backupAt', { d: fmtDay(key.lastBackupAt) }) : t('ok.noBackup'),
  ];
  return (
    <>
      <div className="mono" aria-label={t('st.fingerprintAria')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, fontSize: 15, fontWeight: 500, padding: '12px 14px', borderRadius: 14, background: 'var(--bg2)' }}>
        {key.fingerprint.map((g, i) => <span key={i}>{g}</span>)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>
        {facts.join(' · ')}. {key.signedDevices ? t('ok.signs', { count: key.signedDevices, note: signed === false ? t('ok.notAnnounced') : '' }) : ''}
        {key.revoked ? ` ${t('ok.revoked', { count: key.revoked })}` : ''}
      </div>
      {key.rotatedElsewhere && (
        <div role="note" style={{ padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--line2)', fontSize: 12.5, lineHeight: 1.45 }}>
          {t('ok.rotatedElsewhere')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => setPwOpen(true)} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('st.exportBackup')}</button>
        <button type="button" className="btn btn-outline" onClick={() => setRotateOpen(true)} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('st.rotate')}</button>
        <button type="button" className="btn btn-outline" onClick={() => setRestoreOpen(true)} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>{t('ok.restore')}</button>
      </div>
      {pwOpen && <PasswordDialog onConfirm={backup} onClose={() => setPwOpen(false)} />}
      {restoreOpen && <RestoreDialog onConfirm={restore} onClose={() => setRestoreOpen(false)} />}
      {rotateOpen && (
        <Dialog icon="sync_lock" title={t('ok.dlg.title')} primaryLabel={t('ok.dlg.btn')} onPrimary={() => void rotate()} onClose={() => setRotateOpen(false)}
          body={t('ok.dlg.body')} />
      )}
      {pending && (
        <StepUpDialog reason={pending.reason} confirmLabel={pending.label} onClose={() => setPending(null)}
          onConfirm={async code => { const p = await stepUp(code); if (p) return p; const run = pending.run; setPending(null); await run(); return null; }} />
      )}
    </>
  );
}
