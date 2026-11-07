import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { RouterHowTo, Why } from '../components/Guide';
import { Icon, Segmented, useEscape } from '../components/ui';
import type { TermId } from '../lib/help';
import { NODE, PAIR_CODE, WALLETS, families } from '../data/seed';
import { useT } from '../i18n/react';
import { parentName } from '../lib/devices';
import { fmtDec } from '../lib/format';
import { ApiError, type ApiNeighbor, type ApiPeer } from '../lib/api';
import { copyText } from '../lib/io';
import { checkPub, sanitizePub } from '../lib/pubName';
import { hoursOptions } from '../pages/Settings';
import { relayOn } from '../lib/live';
import { useStore } from '../state/store';
import type { DeviceFamily, HoursPolicy, RelayNode } from '../types';

type Step = 0 | 1 | 2 | 3;
interface WizState {
  step: Step; fam: string; install: 'dl' | 'term'; scan: 'searching' | 'found'; paired: boolean; n: number;
  name: string; pub: string; parent: string; bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: HoursPolicy; wallet: 'provider' | 'personal';
  /** Com piu-node: chave do vizinho LNNP que é este equipamento ('' = sem vínculo). */
  nodePk: string;
  /** Com piu-node: o operador conferiu que o código do enlace é o mesmo no painel do outro nó. */
  codeOk: boolean;
}

const STEPS = ['wz.step.device', 'wz.step.connect', 'wz.step.test', 'wz.step.rules'] as const;
const TOTAL_CHECKS = 5;
const SCAN_MS = 1600;
const CHECK_MS = 700;

export function AddDeviceWizard() {
  const t = useT();
  const FAMILIES = families();
  const { devices, setWizardOpen, addDevice, navigate, showToast, packages, nodeMode, live, api, refreshLive } = useStore();
  /** Com piu-node: vizinhos e código de confirmação reais; o teste com vizinhos independentes ainda não existe e o assistente diz isso. */
  const real = nodeMode === 'node';
  const neighborList = relayOn(live)?.neighbors ?? [];
  const neighbors = neighborList.length;
  // Vizinhos que ainda não são equipamentos registrados (podem ser o equipamento novo).
  const candidates = neighborList.filter(n => n.pk && !devices.some(d => d.nodeId === n.id));
  const parents = devices.filter(d => !d.passive && d.cls !== 'Super Node');
  const [activating, setActivating] = useState(false);
  const [w, setW] = useState<WizState>(() => ({
    step: 0, fam: 'router', install: 'dl', scan: 'searching', paired: false, n: 0,
    // Com piu-node, o nome público começa vazio: o do catálogo é exemplo da demonstração.
    name: FAMILIES[0].defName!, pub: real ? '' : FAMILIES[0].defPub!, parent: parents.find(p => p.id === 'mini')?.id ?? parents[0]?.id ?? '',
    bw: 20, sto: 4, hours: 'always', wallet: 'provider', nodePk: '', codeOk: false,
  }));
  const patch = (p: Partial<WizState>) => setW(s => ({ ...s, ...p }));
  const fam = FAMILIES.find(f => f.id === w.fam) ?? FAMILIES[0];
  const isAp = !!fam.isAp;
  const parent = parentName(devices, w.parent);
  const pub = checkPub(w.pub, devices.map(d => d.pub.replace(/^piu\./, '')), real);
  const done = w.n >= TOTAL_CHECKS;
  /** Vizinho escolhido como este equipamento (some da lista se desconectar). */
  const chosen = w.nodePk ? candidates.find(n => n.pk === w.nodePk) ?? null : null;
  const linkOk = !real || isAp || !!fam.isRadio || !w.nodePk || (!!chosen && w.codeOk);

  const close = useCallback(() => setWizardOpen(false), [setWizardOpen]);
  useEscape(true, close);

  // Etapa 1: procurar o equipamento na rede local. Etapa 2: teste real, uma checagem por vez.
  useEffect(() => {
    if (real) return;
    if (w.step === 1) {
      const t = window.setTimeout(() => setW(s => ({ ...s, scan: 'found' })), SCAN_MS);
      return () => window.clearTimeout(t);
    }
    if (w.step === 2) {
      const t = window.setInterval(() => setW(s => {
        if (s.n >= TOTAL_CHECKS) { window.clearInterval(t); return s; }
        return { ...s, n: s.n + 1 };
      }), CHECK_MS);
      return () => window.clearInterval(t);
    }
  }, [w.step, real]);

  const canNext = w.step === 0 ? true : w.step === 1 ? w.paired && linkOk : w.step === 2 ? done || real : pub.ok;
  const next = () => {
    if (!canNext) return;
    if (w.step === 0) patch({ step: 1, scan: 'searching', paired: false });
    else if (w.step === 1) patch({ step: 2, n: 0 });
    else if (w.step === 2) patch({ step: 3 });
    else void activate();
  };
  const back = () => {
    if (w.step === 0) return;
    const step = (w.step - 1) as Step;
    patch(step === 1 ? { step, scan: 'searching', paired: false } : { step });
  };

  const activate = async () => {
    if (activating) return;
    const tempId = 'd' + Date.now();
    const dev: RelayNode = {
      id: tempId, name: (w.name || fam.defName || '').trim(), cls: fam.result!, short: fam.short!, model: fam.model!, icon: fam.icon,
      status: isAp ? 'active' : 'warming', pph: 0, today: 0, month: 0, neighbors: Number(fam.nb),
      storage: isAp ? null : [0, w.sto], uptime: 'agora', ifaces: fam.ifaces ?? [], receipts: [], fresh: true,
      pub: 'piu.' + w.pub, passive: isAp, parent: isAp ? w.parent : undefined,
    };
    if (isAp) dev.model = t('wz.apModel', { parent });
    setActivating(true);
    const linkable = real && !isAp && !fam.isRadio;
    // Ponto de Acesso: o nó pai escolhido vai junto (o nó confere que é um equipamento seu com o Piu Node).
    const id = await addDevice(dev, fam.id, !real ? {} : isAp ? (w.parent && parents.some(p => p.id === w.parent) ? { parent: w.parent } : {}) : {
      ...(linkable && w.nodePk ? { nodePk: w.nodePk } : {}),
      limits: { bw: w.bw, sto: w.sto, hours: w.hours },
    });
    setActivating(false);
    if (!id) return; // o erro já apareceu num aviso; o assistente continua aberto
    setWizardOpen(false);
    navigate('devices', id);
    showToast(real
      ? { icon: fam.icon, title: t('wz.toast.registered', { name: dev.name }), body: linkable && w.nodePk ? t('wz.toast.registeredLinked', { pub: dev.pub }) : t('wz.toast.registeredOnly', { pub: dev.pub }) }
      : { icon: fam.icon, title: t('wz.toast.joined', { name: dev.name }), body: isAp ? t('wz.toast.joinedAp', { pub: dev.pub }) : t('wz.toast.joinedWarming', { pub: dev.pub }) });
  };

  const hint = [
    t('wz.hint.pick'),
    w.paired ? (!linkOk ? (chosen ? t('wz.hint.checkCode') : t('wz.hint.neighborGone')) : isAp ? t('wz.hint.linkOk') : real ? t('wz.hint.installOk') : t('wz.hint.paired')) : isAp ? t('wz.hint.confirmLink') : real ? t('wz.hint.confirmInstall') : t('wz.hint.checkCode'),
    real ? t('wz.hint.testNA') : done ? t('wz.hint.testDone') : t('wz.hint.testing'),
    real ? t('wz.hint.reviewRegister') : t('wz.hint.reviewActivate'),
  ][w.step];

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 40, animation: 'piuFade .2s ease-out both' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="wiz-title"
        className="wiz" style={{ position: 'fixed', left: '50%', top: '50%', width: 780, height: 620, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', transform: 'translate(-50%,-50%)', zIndex: 41 }}>
        <div className="col" style={{ width: '100%', height: '100%', borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', overflow: 'hidden', animation: 'piuDialog .32s cubic-bezier(.2,.9,.3,1.15) both' }}>
          <div className="wiz-pad" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px 0' }}>
            <h2 id="wiz-title" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>{t('wz.title')}</h2>
            <button type="button" className="btn" aria-label={t('common.close')} onClick={close} style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--bg2)' }}><Icon name="close" size={19} /></button>
          </div>

          <ol aria-label={t('wz.stepsAria')} className="wiz-steps" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 26px', margin: 0, listStyle: 'none' }}>
            {STEPS.map((l, i) => (
              <li key={l} aria-current={i === w.step ? 'step' : undefined} className="col" style={{ flex: 1, gap: 8 }}>
                <div className="track" style={{ height: 4, borderRadius: 2 }}><div style={{ width: i < w.step ? '100%' : i === w.step ? '50%' : '0%', transition: 'width .4s var(--ease-out)' }} /></div>
                <div style={{ fontSize: 12.5, fontWeight: i === w.step ? 650 : 450, color: i <= w.step ? 'var(--ink)' : 'var(--ink2)' }}>{t('wz.stepN', { n: i + 1, label: t(l) })}</div>
              </li>
            ))}
          </ol>

          <div className="scroll-thin wiz-pad" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 26px 16px' }}>
            {w.step === 0 && (
              <div className="col" style={{ gap: 12 }}>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
                  {t('wz.intro')}
                </div>
                <StepFamily families={FAMILIES} value={w.fam} onPick={f => patch({ fam: f.id, name: f.defName!, pub: real ? w.pub : f.defPub!, nodePk: '', codeOk: false })} />
              </div>
            )}
            {w.step === 1 && (
              <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="col" style={{ gap: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 650 }}>{isAp ? t('wz.s1.ap') : fam.isRadio ? t('wz.s1.radio') : t('wz.s1.install')}</div>
                  {fam.install && (
                    <>
                      <Segmented variant="bg2" label={t('wz.installWay')} value={w.install} onChange={install => patch({ install })}
                        options={[{ value: 'dl', label: t('wz.dl') }, { value: 'term', label: t('wz.term') }]} />
                      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
                        {w.install === 'dl' ? t('wz.dlHint') : t('wz.termHint')}
                      </div>
                      <Why term="signedPackage" label="wz.safeInstall" />
                      {w.install === 'dl' ? (
                        <div className="col" style={{ padding: 14, borderRadius: 16, background: 'var(--bg2)', gap: 10 }}>
                          <div className="row" style={{ gap: 10 }}>
                            <Icon name="deployed_code" size={22} wght={300} />
                            <div className="col grow" style={{ gap: 2 }}>
                              <div className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 500 }}>{fam.pkg}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{(() => {
                                if (!real) return t('wz.pkgDemo');
                                const m = packages.find(p => p.file === fam.pkg);
                                return m ? t('wz.pkgReal', { mb: fmtDec(Math.round((m.size / 1024 / 1024) * 10) / 10), hash: `${m.sha256.slice(0, 4).toUpperCase()}…${m.sha256.slice(-4).toUpperCase()}` }) : t('wz.pkgMissing');
                              })()}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{real ? t('wz.serveNoteNode', { host: window.location.host }) : t('wz.serveNote')}</div>
                          {(() => {
                            const m = packages.find(p => p.file === fam.pkg);
                            return (
                              <div className="col mono" style={{ gap: 6, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line2)', fontSize: 11.5, lineHeight: 1.5, wordBreak: 'break-all' }}>
                                <span style={{ color: 'var(--ink2)' }}>{m ? `sha256 ${m.sha256}` : t('wz.manifestNote')}</span>
                                <span style={{ userSelect: 'all' }}>node verify-package.mjs {fam.pkg} {fam.pkg}.manifest.json</span>
                                <span style={{ fontFamily: 'inherit', color: 'var(--ink2)' }}>{t('wz.verifyNote')}</span>
                              </div>
                            );
                          })()}
                          {(!real || packages.some(p => p.file === fam.pkg)) && <button type="button" className="btn btn-outline" onClick={() => { const url = `https://${nodeMode === 'node' ? window.location.host : NODE.host}/pkg/${fam.pkg}`; void copyText(url); showToast({ icon: 'link', title: t('wz.toast.link'), body: url }); }}
                            style={{ height: 36, borderRadius: 18, fontSize: 13 }}>{t('wz.copyLink')}</button>}
                        </div>
                      ) : (
                        <>
                          <div className="col mono" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ink)', color: 'var(--invink)', gap: 8, fontSize: 12.5, lineHeight: 1.55 }}>
                            <div style={{ display: 'flex', gap: 10 }}><span style={{ opacity: 0.5 }}>$</span><span style={{ flex: 1, wordBreak: 'break-all', userSelect: 'all' }}>{fam.cmd}</span></div>
                            {!real && <div style={{ display: 'flex', gap: 10 }}><span style={{ opacity: 0.5 }}>$</span><span style={{ flex: 1, userSelect: 'all' }}>piu-node pair --painel piu-node.local</span></div>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('wz.pkgChecks')}{real ? t('wz.pkgChecksReal') : ''}</div>
                        </>
                      )}
                    </>
                  )}
                  {fam.isRadio && (
                    <div style={{ padding: 14, borderRadius: 16, background: 'var(--bg2)', fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)' }}>{t('wz.radioNote')}</div>
                  )}
                  {isAp && (
                    <>
                      <ol className="col" style={{ padding: '6px 16px', margin: 0, listStyle: 'none', borderRadius: 16, background: 'var(--bg2)' }}>
                        {([[t('wz.ap.1.t'), t('wz.ap.1.d', { pub: w.pub })], [t('wz.ap.2.t'), t('wz.ap.2.d')],
                          [t('wz.ap.3.t'), t('wz.ap.3.d')], [t('wz.ap.4.t'), t('wz.ap.4.d')]] as const).map(([x, d], i) => (
                          <li key={x} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</div>
                            <div className="col grow" style={{ gap: 2 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{x}</div>
                              <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{d}</div>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <RouterHowTo />
                      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('wz.apNote')}</div>
                    </>
                  )}
                </div>

                <div className="col" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 8, fontSize: 15, fontWeight: 650 }}>
                    {isAp ? t('wz.s2.ap') : t('wz.s2.pair')}
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)', animation: 'piuBreath 1.4s ease-in-out infinite' }} />
                  </div>
                  {real && !isAp ? (
                    // Vizinhos LNNP reais: pelo anúncio na rede local ou por endereço. O código do enlace é o mesmo nos dois painéis.
                    <div className="col" style={{ padding: 16, borderRadius: 18, border: '1px dashed var(--line2)', gap: 12 }}>
                      <div className="row" style={{ gap: 10, fontSize: 14, fontWeight: 600 }}><Icon name="hub" size={20} />{t('wz.lnnpNeighbors')}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{fam.isRadio
                        ? t('wz.radioLink', { neighbors: t('head.neighborsConnected', { count: neighbors }) })
                        : t('wz.nodeAnnounce', { neighbors: t('head.neighborsConnected', { count: neighbors }) })}</div>
                      <Why term="neighbor" label="wz.whatNeighbor" />
                      <button type="button" role="checkbox" aria-checked={w.paired} onClick={() => patch({ paired: !w.paired })} className="btn" style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13.5, fontWeight: 550, padding: 0, minHeight: 44 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink)', background: w.paired ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
                          <Icon name="check" size={15} style={{ opacity: w.paired ? 1 : 0 }} />
                        </span>
                        {fam.isRadio ? t('wz.iLinkedRadio') : t('wz.iInstalled')}
                      </button>
                      {!fam.isRadio && w.paired && (
                        <div className="col" style={{ gap: 6 }}>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('wz.whichNeighbor')}</div>
                          <Why term="techId" />
                          <div role="radiogroup" aria-label={t('wz.techIdAria')} className="col" style={{ gap: 6 }}>
                            {candidates.map(n => (
                              <button key={n.id} type="button" role="radio" aria-checked={w.nodePk === n.pk} className="choice row" onClick={() => patch({ nodePk: n.pk!, codeOk: false })} style={{ gap: 10, padding: '8px 12px', borderRadius: 12 }}>
                                <Icon name="fingerprint" size={18} wght={300} />
                                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                                  <div className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{n.id}</div>
                                  <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--ink2)' }}>{n.address}{n.sameOperator ? t('wz.hasYourKey') : ''}</div>
                                </div>
                                <div className="radio"><span /></div>
                              </button>
                            ))}
                            <button type="button" role="radio" aria-checked={w.nodePk === ''} className="choice row" onClick={() => patch({ nodePk: '', codeOk: false })} style={{ gap: 10, padding: '8px 12px', borderRadius: 12 }}>
                              <Icon name="link_off" size={18} wght={300} />
                              <div className="grow" style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'left' }}>{t('wz.registerNoId', { label: candidates.length ? t('wz.noneOfThese') : t('wz.noNewNeighbor') })}</div>
                              <div className="radio"><span /></div>
                            </button>
                          </div>
                          {w.nodePk && !chosen && (
                            <div role="status" style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4 }}>{t('wz.neighborGone')}</div>
                          )}
                          {chosen && <ConfirmCode n={chosen} ok={w.codeOk} onToggle={() => patch({ codeOk: !w.codeOk })} />}
                          {api && (
                            <AddByAddress
                              add={async address => { const r = await api.addRelayPeer(address); await refreshLive(); return r.peer; }}
                              registered={pk => devices.some(d => d.nodeId === pk.slice(0, 16))}
                              onConnected={pk => patch({ nodePk: pk, codeOk: false })}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : w.scan === 'searching' && !real ? (
                    <div className="row" aria-live="polite" style={{ gap: 14, padding: 16, borderRadius: 16, border: '1px dashed var(--line2)' }}>
                      <div style={{ position: 'relative', width: 36, height: 36, flex: 'none' }}>
                        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 1.8s ease-out infinite' }} />
                        <div style={{ position: 'absolute', inset: 11, borderRadius: '50%', background: 'var(--ink)' }} />
                      </div>
                      <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{t('wz.searching')}</div>
                    </div>
                  ) : (
                    <div className="col" style={{ padding: 16, borderRadius: 18, border: '1.5px solid var(--ink)', gap: 12, animation: 'piuUp .35s both' }}>
                      <div className="row" style={{ gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={fam.icon} size={21} /></div>
                        <div className="col grow" style={{ gap: 2 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{real ? fam.name : fam.found}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{real ? t('wz.apFound') : fam.addr}</div>
                        </div>
                      </div>
                      {!isAp && !real && (
                        <>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{t('wz.codeAppears', { where: fam.where ?? '' })}</div>
                          <div aria-label={t('wz.pairCodeAria', { code: PAIR_CODE.join(' ') })} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
                            {PAIR_CODE.map((v, i) => (
                              <div key={i} className="mono" style={{ height: 44, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600, animation: `piuPop .35s ${(i * 0.06).toFixed(2)}s var(--ease-pop) both` }}>{v}</div>
                            ))}
                          </div>
                        </>
                      )}
                      {isAp && (
                        <>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{t('wz.whichParent')}</div>
                          <Why term="parentNode" />
                          <div role="radiogroup" aria-label={t('wz.parentAria')} className="col" style={{ gap: 6 }}>
                            {parents.map(p => (
                              <button key={p.id} type="button" role="radio" aria-checked={w.parent === p.id} className="choice row" onClick={() => patch({ parent: p.id })} style={{ gap: 10, padding: '10px 12px', borderRadius: 12 }}>
                                <Icon name={p.icon} size={19} wght={300} />
                                <div className="col grow" style={{ gap: 1 }}>
                                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{p.pub}</div>
                                </div>
                                <div className="radio"><span /></div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <button type="button" role="checkbox" aria-checked={w.paired} onClick={() => patch({ paired: !w.paired })} className="btn" style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13.5, fontWeight: 550, padding: 0 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink)', background: w.paired ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
                          <Icon name="check" size={15} style={{ opacity: w.paired ? 1 : 0 }} />
                        </span>
                        {isAp ? t('wz.confirmMine') : t('wz.codeOk')}
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>
                    {isAp ? t('wz.apSigned') : t('wz.pairIdentity')}
                  </div>
                </div>
              </div>
            )}
            {w.step === 2 && (real ? (
              <div className="col" style={{ gap: 12, padding: 18, borderRadius: 18, border: '1px dashed var(--line2)' }}>
                <div className="row" style={{ gap: 10, fontSize: 15, fontWeight: 650 }}><Icon name="info" size={21} />{t('wz.testNA')}</div>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
                  {t('wz.testNABody')}
                  {isAp || fam.isRadio ? t('wz.testNAAp') : t('wz.testNAId')}
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{t('wz.nowNeighbors', { neighbors: t('head.neighborsConnected', { count: neighbors }) })}</div>
              </div>
            ) : <StepTest fam={fam} parent={parent} n={w.n} />)}
            {w.step === 3 && (
              <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="col" style={{ gap: 14 }}>
                  <label className="col" style={{ gap: 7 }}>
                    <span style={fieldLabel}>{t('wz.deviceName')}</span>
                    <input value={w.name} onChange={e => patch({ name: e.target.value })} style={{ height: 46, borderRadius: 14, border: 'none', background: 'var(--bg2)', padding: '0 14px', fontSize: 15, color: 'var(--ink)', outline: 'none' }} />
                  </label>
                  <div className="col" style={{ gap: 7 }}>
                    <label htmlFor="wiz-pub" style={fieldLabel}>{t('wz.pubName')}</label>
                    <div className="row" style={{ gap: 1, height: 46, borderRadius: 14, background: 'var(--bg2)', padding: '0 14px', boxShadow: `0 0 0 1.5px ${pub.ring === 'strong' ? 'var(--ink)' : pub.ring === 'soft' ? 'var(--line2)' : 'transparent'} inset`, transition: 'box-shadow .2s' }}>
                      <span className="mono" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink2)' }}>piu.</span>
                      <input id="wiz-pub" aria-describedby="wiz-pub-msg" value={w.pub} onChange={e => patch({ pub: sanitizePub(e.target.value) })} placeholder={t('wz.pubPh')} spellCheck={false} autoCapitalize="off"
                        className="mono" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }} />
                      <Icon name={pub.icon} size={19} fill={1} />
                    </div>
                    <div id="wiz-pub-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: pub.tone === 'strong' ? 'var(--ink)' : 'var(--ink2)' }}>{pub.msg}</div>
                    <Why term="publicName" />
                  </div>
                  {!isAp && (
                    <>
                      <WizLimit title={t('wz.bandTitle')} term="bandwidth"><Segmented variant="bg2" label={t('dv.band')} value={w.bw} onChange={bw => patch({ bw })} options={([5, 20, 50] as const).map(v => ({ value: v, label: t('common.mbps', { n: v }) }))} /></WizLimit>
                      <WizLimit title={t('wz.storageTitle')} term="storage"><Segmented variant="bg2" label={t('dv.storage')} value={w.sto} onChange={sto => patch({ sto })} options={([1, 4, 8] as const).map(v => ({ value: v, label: t('common.gb', { n: v }) }))} /></WizLimit>
                      <WizLimit title={t('wz.hoursTitle')} term="hours"><Segmented<HoursPolicy> variant="bg2" label={t('dv.hours')} value={w.hours} onChange={hours => patch({ hours })} options={hoursOptions()} /></WizLimit>
                    </>
                  )}
                </div>
                <div className="col" style={{ gap: 12 }}>
                  {!isAp && real && (
                    <div style={{ padding: 16, borderRadius: 16, background: 'var(--bg2)', display: 'flex', gap: 12 }}>
                      <Icon name="account_balance_wallet" size={21} wght={300} />
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)' }}>{t('wz.payoutNote')}</div>
                    </div>
                  )}
                  {!isAp && !real && (
                    <>
                      <div style={fieldLabel}>{t('wz.payout')}</div>
                      <div role="radiogroup" aria-label={t('wz.payout')} className="col" style={{ gap: 12 }}>
                        {([['provider', t('wz.payoutProvider'), WALLETS.provider.short, t('wz.payoutProviderDesc')], ['personal', t('wz.payoutPersonal'), WALLETS.personal.short, t('wz.payoutPersonalDesc')]] as const).map(([k, x, a, d]) => (
                          <button key={k} type="button" role="radio" aria-checked={w.wallet === k} className="choice" onClick={() => patch({ wallet: k })} style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 16 }}>
                            <div className="radio" style={{ width: 20, height: 20, marginTop: 1 }}><span style={{ width: 10, height: 10 }} /></div>
                            <div className="col" style={{ flex: 1, gap: 3 }}>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{x}</div>
                              <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{a}</div>
                              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.35 }}>{d}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {isAp && (
                    <div style={{ padding: 16, borderRadius: 16, background: 'var(--bg2)', display: 'flex', gap: 12 }}>
                      <Icon name="toll" size={21} wght={300} />
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)', textWrap: 'pretty' }}>{t('wz.apCredits', { parent })}</div>
                    </div>
                  )}
                  <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', fontSize: 12, lineHeight: 1.45, color: 'var(--ink2)' }}>{real ? t('wz.resultReal', { cls: fam.result ?? '', id: w.nodePk ? t('wz.resultRealId') : '' }) : t('wz.resultDemo', { cls: fam.result ?? '' })}{real
                    ? isAp ? t('wz.resultApRules')
                      : w.nodePk ? t('wz.resultIdRules')
                      : t('wz.resultNoIdRules')
                    : t('wz.resultGlobal')}</div>
                </div>
              </div>
            )}
          </div>

          <div className="row wiz-pad wiz-foot" style={{ gap: 10, padding: '16px 26px 22px', borderTop: '1px solid var(--line)' }}>
            <button type="button" className="btn btn-outline" disabled={w.step === 0} onClick={back} style={{ height: 44, padding: '0 18px', borderRadius: 22, fontSize: 14, opacity: w.step > 0 ? 1 : 0.35 }}>{t('common.back')}</button>
            <div className="mono" aria-live="polite" style={{ flex: 1, fontSize: 12, color: 'var(--ink2)' }}>{hint}</div>
            <button type="button" className="btn btn-primary" aria-disabled={!canNext} onClick={next} style={{ height: 44, padding: '0 22px', borderRadius: 22, fontSize: 14, opacity: canNext ? 1 : 0.35, transition: 'opacity .25s,transform .15s' }}>
              {w.step === 3 ? (activating ? (real ? t('wz.registering') : t('wz.activating')) : real ? t('wz.register') : t('wz.activate')) : t('common.continue')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const fieldLabel: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--ink2)' };

function WizLimit({ title, term, children }: { title: string; term: TermId; children: ReactNode }) {
  return <div className="col" style={{ gap: 7 }}><div style={fieldLabel}>{title}</div>{children}<Why term={term} /></div>;
}

function StepFamily({ families: FAMILIES, value, onPick }: { families: DeviceFamily[]; value: string; onPick: (f: DeviceFamily) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('wz.familyAria')} className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {FAMILIES.map(f => (
        <button key={f.id} type="button" role="radio" aria-checked={value === f.id} disabled={f.disabled} className="choice" onClick={() => onPick(f)} style={{ display: 'flex', gap: 14, padding: 16, borderRadius: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={f.icon} size={22} wght={300} /></div>
          <div className="col grow" style={{ gap: 3 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{f.name}</span>
              <span className="mono" style={{ fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 6, border: '1px solid var(--line2)', color: 'var(--ink2)' }}>{f.badge}</span>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{f.cls}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>{f.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function StepTest({ fam, parent, n }: { fam: DeviceFamily; parent: string; n: number }) {
  const t = useT();
  const done = n >= TOTAL_CHECKS;
  const checks: [string, string][] = fam.isAp
    ? [[t('wz.chk.signal'), t('wz.chk.signalD')], [t('wz.chk.isolation'), t('wz.chk.isolationD')], [t('wz.chk.discovery'), t('wz.chk.discoveryD')],
       [t('wz.chk.parentLink'), t('wz.chk.parentLinkD', { parent })], [t('wz.chk.phones'), t('wz.chk.phonesD')]]
    : [[fam.install ? t('wz.chk.pkg') : t('wz.chk.adapter'), t('wz.chk.pkgD', { pkg: fam.pkg ?? '' })], [t('wz.chk.hw'), fam.hw ?? ''], [t('wz.chk.ifs'), fam.ifs ?? ''],
       [t('wz.chk.techId'), t('wz.chk.techIdD')], [t('wz.chk.fwd'), fam.isRadio ? t('wz.chk.fwdRadio') : t('wz.chk.fwdNode')]];
  const measured = fam.isAp
    ? [[t('wz.ms.coverage'), fam.bw], [t('wz.ms.latencyParent'), fam.lat], [t('wz.ms.phonesSeen'), fam.nb]]
    : [[t('wz.ms.band'), fam.bw], [t('wz.ms.latency'), fam.lat], [t('wz.ms.neighbors'), fam.nb]];

  return (
    <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 20 }}>
      <div className="col">
        <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.4, paddingBottom: 6 }}>
          {fam.isAp ? t('wz.testApIntro') : t('wz.testIntro')}
        </div>
        <ol aria-live="polite" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {checks.map(([x, d], i) => {
            const dn = i < n, cur = i === n;
            return (
              <li key={x} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--line)', opacity: dn || cur ? 1 : 0.4, transition: 'opacity .3s' }}>
                <Icon name={dn ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={21} fill={dn ? 1 : 0} wght={400}
                  style={{ display: 'inline-block', animation: dn ? 'piuPop .38s var(--ease-pop)' : 'none' }} />
                <div className="col grow" style={{ gap: 3 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{x}<span className="sr-only">{dn ? t('wz.chkDone') : cur ? t('wz.chkCurrent') : ''}</span></div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{d}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="col" style={{ padding: 20, borderRadius: 22, background: done ? 'var(--ink)' : 'var(--bg2)', color: done ? 'var(--invink)' : 'var(--ink)', gap: 16, transition: 'background .3s,color .3s' }}>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 12.5, opacity: 0.7 }}>{done ? t('wz.classApproved') : t('wz.measuring')}</div>
          <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.15 }}>{done ? fam.result : t('wz.waitTest')}</div>
        </div>
        <div className="col" style={{ gap: 10 }}>
          {measured.map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, borderTop: '1px solid rgba(127,127,127,.3)' }}>
              <span style={{ fontSize: 12.5, opacity: 0.7 }}>{l}</span>
              <span style={{ fontSize: 18, fontWeight: 650 }}>{done ? v : '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Código do enlace com o vizinho escolhido: 6 dígitos que o outro nó também mostra (Malha → Vizinhos). */
function ConfirmCode({ n, ok, onToggle }: { n: ApiNeighbor; ok: boolean; onToggle: () => void }) {
  const t = useT();
  const code = n.confirmCode ?? null;
  return (
    <div className="col" style={{ gap: 8, padding: 12, borderRadius: 14, border: '1.5px solid var(--ink)', animation: 'piuUp .3s both' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>
        {code ? t('wz.cc.check') : t('wz.cc.noCode')}
      </div>
      {code && (
        <div aria-label={t('wz.cc.aria', { code: code.split('').join(' ') })} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
          {code.split('').map((v, i) => (
            <div key={i} className="mono" style={{ height: 44, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600 }}>{v}</div>
          ))}
        </div>
      )}
      <button type="button" role="checkbox" aria-checked={ok} onClick={onToggle} className="btn" style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13.5, fontWeight: 550, padding: 0, minHeight: 40 }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink)', background: ok ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
          <Icon name="check" size={15} style={{ opacity: ok ? 1 : 0 }} />
        </span>
        {code ? t('wz.cc.same') : t('wz.cc.checkedId')}
      </button>
      <div style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('wz.cc.changes')}</div>
    </div>
  );
}

type AddResult = { tone: 'ok' | 'warn'; text: string };

/** "Adicionar por endereço": o nó conecta a `host:porta`, espera o handshake e o vizinho entra na lista acima. */
function AddByAddress({ add, registered, onConnected }: {
  add: (address: string) => Promise<ApiPeer | null>;
  registered: (pk: string) => boolean;
  onConnected: (pk: string) => void;
}) {
  const t = useT();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = address.trim();
    if (!a || busy) return;
    setBusy(true); setResult(null);
    try {
      const p = await add(a);
      if (!p) setResult({ tone: 'warn', text: t('wz.ab.noState') });
      else if (p.state === 'connected' && p.pk) {
        if (registered(p.pk)) setResult({ tone: 'warn', text: t('wz.ab.alreadyRegistered', { id: p.nodeId ?? '' }) });
        else { onConnected(p.pk); setResult({ tone: 'ok', text: t('wz.ab.connected', { id: p.nodeId ?? '' }) }); }
      } else if (p.state === 'failed') setResult({ tone: 'warn', text: t('wz.ab.failed', { err: p.error ?? t('wz.ab.unknownReason') }) });
      else setResult({ tone: 'warn', text: t('wz.ab.connecting') });
    } catch (err) {
      setResult({ tone: 'warn', text: err instanceof ApiError ? err.message : t('wz.ab.cantAdd') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={e => void submit(e)} className="col" style={{ gap: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
      <label htmlFor="wiz-peer" style={{ fontSize: 13, fontWeight: 600 }}>{t('wz.ab.title')}</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="wiz-peer" value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.0.12:8422" spellCheck={false} autoCapitalize="off" autoComplete="off"
          aria-describedby="wiz-peer-msg" className="mono"
          style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 12px', fontSize: 13.5, color: 'var(--ink)', outline: 'none' }} />
        <button type="submit" className="btn btn-outline" aria-disabled={busy || !address.trim()} style={{ height: 40, padding: '0 14px', borderRadius: 20, fontSize: 13, flex: 'none', opacity: busy || !address.trim() ? 0.5 : 1 }}>{busy ? t('wz.ab.connectingBtn') : t('wz.ab.connect')}</button>
      </div>
      <div id="wiz-peer-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: result?.tone === 'ok' ? 'var(--ink)' : 'var(--ink2)' }}>
        {result?.text ?? t('wz.ab.hint')}
      </div>
    </form>
  );
}
