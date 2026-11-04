import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { RouterHowTo, Why } from '../components/Guide';
import { Icon, Segmented, useEscape } from '../components/ui';
import type { TermId } from '../lib/help';
import { FAMILIES, NODE, PAIR_CODE, WALLETS } from '../data/seed';
import { parentName } from '../lib/devices';
import { ApiError, type ApiNeighbor, type ApiPeer } from '../lib/api';
import { copyText } from '../lib/io';
import { checkPub, sanitizePub } from '../lib/pubName';
import { HOURS } from '../pages/Settings';
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

const STEPS = ['Equipamento', 'Conectar', 'Teste real', 'Regras'];
const TOTAL_CHECKS = 5;
const SCAN_MS = 1600;
const CHECK_MS = 700;

export function AddDeviceWizard() {
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
    if (isAp) dev.model = `Repetidor comum · firmware original · ligado ao ${parent}`;
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
      ? { icon: fam.icon, title: dev.name + ' registrado', body: linkable && w.nodePk ? dev.pub + ' · identidade técnica assinada; o estado do enlace aparece em Equipamentos.' : dev.pub + ' · só registro neste nó, sem enlace.' }
      : { icon: fam.icon, title: dev.name + ' entrou na malha', body: isAp ? dev.pub + ' · leva o sinal do nó pai mais longe.' : dev.pub + ' · aquecendo, primeiros recibos em minutos.' });
  };

  const hint = [
    'Escolha o tipo de equipamento',
    w.paired ? (!linkOk ? (chosen ? 'Confira o código para continuar' : 'O vizinho escolhido desconectou') : isAp ? 'Vínculo confirmado' : real ? 'Instalação confirmada' : 'Pareado') : isAp ? 'Confirme o vínculo para continuar' : real ? 'Confirme a instalação para continuar' : 'Confirme o código para continuar',
    real ? 'Teste real indisponível nesta versão' : done ? 'Teste concluído' : 'Testando com vizinhos…',
    real ? 'Revise e registre' : 'Revise e ative',
  ][w.step];

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 40, animation: 'piuFade .2s ease-out both' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="wiz-title"
        className="wiz" style={{ position: 'fixed', left: '50%', top: '50%', width: 780, height: 620, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', transform: 'translate(-50%,-50%)', zIndex: 41 }}>
        <div className="col" style={{ width: '100%', height: '100%', borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', overflow: 'hidden', animation: 'piuDialog .32s cubic-bezier(.2,.9,.3,1.15) both' }}>
          <div className="wiz-pad" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px 0' }}>
            <h2 id="wiz-title" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>Adicionar equipamento</h2>
            <button type="button" className="btn" aria-label="Fechar" onClick={close} style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--bg2)' }}><Icon name="close" size={19} /></button>
          </div>

          <ol aria-label="Etapas" className="wiz-steps" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 26px', margin: 0, listStyle: 'none' }}>
            {STEPS.map((l, i) => (
              <li key={l} aria-current={i === w.step ? 'step' : undefined} className="col" style={{ flex: 1, gap: 8 }}>
                <div className="track" style={{ height: 4, borderRadius: 2 }}><div style={{ width: i < w.step ? '100%' : i === w.step ? '50%' : '0%', transition: 'width .4s var(--ease-out)' }} /></div>
                <div style={{ fontSize: 12.5, fontWeight: i === w.step ? 650 : 450, color: i <= w.step ? 'var(--ink)' : 'var(--ink2)' }}>{i + 1} · {l}</div>
              </li>
            ))}
          </ol>

          <div className="scroll-thin wiz-pad" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 26px 16px' }}>
            {w.step === 0 && (
              <div className="col" style={{ gap: 12 }}>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
                  Escolha o aparelho que vai entrar na rede. Na dúvida, “Roteador comum ou repetidor” é o mais fácil: não instala nada, só muda três ajustes no roteador.
                </div>
                <StepFamily value={w.fam} onPick={f => patch({ fam: f.id, name: f.defName!, pub: real ? w.pub : f.defPub!, nodePk: '', codeOk: false })} />
              </div>
            )}
            {w.step === 1 && (
              <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="col" style={{ gap: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 650 }}>{isAp ? '1 · Configure o roteador' : fam.isRadio ? '1 · Conecte o rádio' : '1 · Instale o Piu Node'}</div>
                  {fam.install && (
                    <>
                      <Segmented variant="bg2" label="Forma de instalação" value={w.install} onChange={install => patch({ install })}
                        options={[{ value: 'dl', label: 'Baixar pela rede local' }, { value: 'term', label: 'Terminal' }]} />
                      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
                        {w.install === 'dl' ? 'Para quem instala pela página de configuração do aparelho: o arquivo vem deste computador, sem internet.' : 'Para quem digita comandos no aparelho (Linux, Raspberry Pi): copie a linha e cole no terminal dele.'}
                      </div>
                      <Why term="signedPackage" label="É seguro instalar?" />
                      {w.install === 'dl' ? (
                        <div className="col" style={{ padding: 14, borderRadius: 16, background: 'var(--bg2)', gap: 10 }}>
                          <div className="row" style={{ gap: 10 }}>
                            <Icon name="deployed_code" size={22} wght={300} />
                            <div className="col grow" style={{ gap: 2 }}>
                              <div className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 500 }}>{fam.pkg}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{(() => {
                                if (!real) return '2,1 MB · assinado Lunes · 4C9A…E1F0';
                                const m = packages.find(p => p.file === fam.pkg);
                                return m ? `${(m.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB · assinado Lunes · ${m.sha256.slice(0, 4).toUpperCase()}…${m.sha256.slice(-4).toUpperCase()}` : 'este nó ainda não oferece este pacote (sem manifesto assinado)';
                              })()}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>Sem internet: este Mini-PC serve o pacote na rede local, por HTTPS. Abra a interface do equipamento e aponte para piu-node.local.</div>
                          {(() => {
                            const m = packages.find(p => p.file === fam.pkg);
                            return (
                              <div className="col mono" style={{ gap: 6, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line2)', fontSize: 11.5, lineHeight: 1.5, wordBreak: 'break-all' }}>
                                <span style={{ color: 'var(--ink2)' }}>{m ? `sha256 ${m.sha256}` : 'manifesto assinado ao lado do pacote (.manifest.json)'}</span>
                                <span style={{ userSelect: 'all' }}>node verify-package.mjs {fam.pkg} {fam.pkg}.manifest.json</span>
                                <span style={{ fontFamily: 'inherit', color: 'var(--ink2)' }}>O instalador só executa se a assinatura da Lunes e o hash conferirem.</span>
                              </div>
                            );
                          })()}
                          {(!real || packages.some(p => p.file === fam.pkg)) && <button type="button" className="btn btn-outline" onClick={() => { const url = `https://${nodeMode === 'node' ? window.location.host : NODE.host}/pkg/${fam.pkg}`; void copyText(url); showToast({ icon: 'link', title: 'Link local copiado', body: url }); }}
                            style={{ height: 36, borderRadius: 18, fontSize: 13 }}>Copiar link local do pacote</button>}
                        </div>
                      ) : (
                        <>
                          <div className="col mono" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--ink)', color: 'var(--invink)', gap: 8, fontSize: 12.5, lineHeight: 1.55 }}>
                            <div style={{ display: 'flex', gap: 10 }}><span style={{ opacity: 0.5 }}>$</span><span style={{ flex: 1, wordBreak: 'break-all', userSelect: 'all' }}>{fam.cmd}</span></div>
                            {!real && <div style={{ display: 'flex', gap: 10 }}><span style={{ opacity: 0.5 }}>$</span><span style={{ flex: 1, userSelect: 'all' }}>piu-node pair --painel piu-node.local</span></div>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>O pacote confere a própria assinatura antes de instalar.{real ? ' Ao subir, o Piu Node mostra no console do equipamento o código do painel dele e a porta do enlace LNNP (TCP 8422).' : ''}</div>
                        </>
                      )}
                    </>
                  )}
                  {fam.isRadio && (
                    <div style={{ padding: 14, borderRadius: 16, background: 'var(--bg2)', fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)' }}>Ligue o rádio na porta USB de um Home Node ou Gateway Local. O adapter LoRa assinado é instalado sozinho.</div>
                  )}
                  {isAp && (
                    <>
                      <ol className="col" style={{ padding: '6px 16px', margin: 0, listStyle: 'none', borderRadius: 16, background: 'var(--bg2)' }}>
                        {([['Nome da rede (SSID)', `piu.${w.pub} · o mesmo nome público`], ['Desative o isolamento de clientes', 'às vezes chamado “AP isolation”'],
                          ['Permita multicast e mDNS', 'para os celulares se descobrirem'], ['Ligue a um nó seu', 'por cabo ou repetição sem fio']] as const).map(([t, d], i) => (
                          <li key={t} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}` }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</div>
                            <div className="col grow" style={{ gap: 2 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t}</div>
                              <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{d}</div>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <RouterHowTo />
                      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Ele manda e recebe mensagens ao vivo entre quem está conectado. O que ele não faz sozinho é guardar mensagens para quem está fora e assinar recibos: isso fica com o nó pai.</div>
                    </>
                  )}
                </div>

                <div className="col" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 8, fontSize: 15, fontWeight: 650 }}>
                    {isAp ? '2 · Encontre e vincule' : '2 · Encontre e pareie'}
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)', animation: 'piuBreath 1.4s ease-in-out infinite' }} />
                  </div>
                  {real && !isAp ? (
                    // Vizinhos LNNP reais: pelo anúncio na rede local ou por endereço. O código do enlace é o mesmo nos dois painéis.
                    <div className="col" style={{ padding: 16, borderRadius: 18, border: '1px dashed var(--line2)', gap: 12 }}>
                      <div className="row" style={{ gap: 10, fontSize: 14, fontWeight: 600 }}><Icon name="hub" size={20} />Vizinhos LNNP deste nó</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{fam.isRadio
                        ? `O rádio vira um enlace do equipamento em que está ligado (configurado nele por PIU_SERIAL). Agora: ${neighbors} ${neighbors === 1 ? 'vizinho conectado' : 'vizinhos conectados'} a este nó.`
                        : `Quando o Piu Node subir no equipamento, ele se anuncia na rede local e aparece aqui. Se a rede bloquear o anúncio, adicione pelo endereço. Agora: ${neighbors} ${neighbors === 1 ? 'vizinho conectado' : 'vizinhos conectados'}.`}</div>
                      <Why term="neighbor" label="O que é um vizinho?" />
                      <button type="button" role="checkbox" aria-checked={w.paired} onClick={() => patch({ paired: !w.paired })} className="btn" style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13.5, fontWeight: 550, padding: 0, minHeight: 44 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink)', background: w.paired ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
                          <Icon name="check" size={15} style={{ opacity: w.paired ? 1 : 0 }} />
                        </span>
                        {fam.isRadio ? 'Liguei o rádio a um equipamento meu' : 'Instalei o Piu Node no equipamento'}
                      </button>
                      {!fam.isRadio && w.paired && (
                        <div className="col" style={{ gap: 6 }}>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>Qual vizinho é ele? A identidade técnica dele é assinada pela sua chave de operador, e dá para revogar depois.</div>
                          <Why term="techId" />
                          <div role="radiogroup" aria-label="Identidade técnica do equipamento" className="col" style={{ gap: 6 }}>
                            {candidates.map(n => (
                              <button key={n.id} type="button" role="radio" aria-checked={w.nodePk === n.pk} className="choice row" onClick={() => patch({ nodePk: n.pk!, codeOk: false })} style={{ gap: 10, padding: '8px 12px', borderRadius: 12 }}>
                                <Icon name="fingerprint" size={18} wght={300} />
                                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                                  <div className="mono ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{n.id}</div>
                                  <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--ink2)' }}>{n.address}{n.sameOperator ? ' · já tem a sua chave' : ''}</div>
                                </div>
                                <div className="radio"><span /></div>
                              </button>
                            ))}
                            <button type="button" role="radio" aria-checked={w.nodePk === ''} className="choice row" onClick={() => patch({ nodePk: '', codeOk: false })} style={{ gap: 10, padding: '8px 12px', borderRadius: 12 }}>
                              <Icon name="link_off" size={18} wght={300} />
                              <div className="grow" style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'left' }}>{candidates.length ? 'Nenhum destes' : 'Nenhum vizinho novo conectado'} · registrar sem identidade</div>
                              <div className="radio"><span /></div>
                            </button>
                          </div>
                          {w.nodePk && !chosen && (
                            <div role="status" style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4 }}>O vizinho escolhido desconectou deste nó. Espere ele voltar ou escolha outro.</div>
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
                      <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>Procurando na rede local…</div>
                    </div>
                  ) : (
                    <div className="col" style={{ padding: 16, borderRadius: 18, border: '1.5px solid var(--ink)', gap: 12, animation: 'piuUp .35s both' }}>
                      <div className="row" style={{ gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={fam.icon} size={21} /></div>
                        <div className="col grow" style={{ gap: 2 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{real ? fam.name : fam.found}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{real ? 'sem software do Piu: vínculo só registrado neste nó' : fam.addr}</div>
                        </div>
                      </div>
                      {!isAp && !real && (
                        <>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Confira se o código aparece {fam.where}:</div>
                          <div aria-label={'Código de pareamento ' + PAIR_CODE.join(' ')} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
                            {PAIR_CODE.map((v, i) => (
                              <div key={i} className="mono" style={{ height: 44, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600, animation: `piuPop .35s ${(i * 0.06).toFixed(2)}s var(--ease-pop) both` }}>{v}</div>
                            ))}
                          </div>
                        </>
                      )}
                      {isAp && (
                        <>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Ligado a qual nó seu?</div>
                          <Why term="parentNode" />
                          <div role="radiogroup" aria-label="Nó pai" className="col" style={{ gap: 6 }}>
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
                        {isAp ? 'Confirmo que este equipamento é meu' : 'O código confere'}
                      </button>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>
                    {isAp ? 'O nome público é assinado pela sua chave de operador. O equipamento em si não muda nem recebe software.' : 'O pareamento gera uma identidade técnica no próprio equipamento, assinada pela sua identidade de operador.'}
                  </div>
                </div>
              </div>
            )}
            {w.step === 2 && (real ? (
              <div className="col" style={{ gap: 12, padding: 18, borderRadius: 18, border: '1px dashed var(--line2)' }}>
                <div className="row" style={{ gap: 10, fontSize: 15, fontWeight: 650 }}><Icon name="info" size={21} />Teste real ainda não disponível</div>
                <div style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
                  O teste com vizinhos independentes (banda, latência, encaminhamento) ainda não existe nesta versão. O equipamento entra registrado, sem classe aprovada.
                  {isAp || fam.isRadio
                    ? ' Sem o Piu Node nele, este nó só guarda o registro: não há estatísticas dele aqui.'
                    : ' Com a identidade técnica escolhida e a sua chave de operador nele (backup restaurado), ele manda a este nó um resumo assinado (encaminhados, guardados, vizinhos, pausa) e recebe daqui a pausa e as regras.'}
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>agora: {neighbors} {neighbors === 1 ? 'vizinho conectado' : 'vizinhos conectados'} a este nó</div>
              </div>
            ) : <StepTest fam={fam} parent={parent} n={w.n} />)}
            {w.step === 3 && (
              <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="col" style={{ gap: 14 }}>
                  <label className="col" style={{ gap: 7 }}>
                    <span style={fieldLabel}>Nome do equipamento</span>
                    <input value={w.name} onChange={e => patch({ name: e.target.value })} style={{ height: 46, borderRadius: 14, border: 'none', background: 'var(--bg2)', padding: '0 14px', fontSize: 15, color: 'var(--ink)', outline: 'none' }} />
                  </label>
                  <div className="col" style={{ gap: 7 }}>
                    <label htmlFor="wiz-pub" style={fieldLabel}>Nome público da rede</label>
                    <div className="row" style={{ gap: 1, height: 46, borderRadius: 14, background: 'var(--bg2)', padding: '0 14px', boxShadow: `0 0 0 1.5px ${pub.ring === 'strong' ? 'var(--ink)' : pub.ring === 'soft' ? 'var(--line2)' : 'transparent'} inset`, transition: 'box-shadow .2s' }}>
                      <span className="mono" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink2)' }}>piu.</span>
                      <input id="wiz-pub" aria-describedby="wiz-pub-msg" value={w.pub} onChange={e => patch({ pub: sanitizePub(e.target.value) })} placeholder="nome-do-ponto" spellCheck={false} autoCapitalize="off"
                        className="mono" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }} />
                      <Icon name={pub.icon} size={19} fill={1} />
                    </div>
                    <div id="wiz-pub-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: pub.tone === 'strong' ? 'var(--ink)' : 'var(--ink2)' }}>{pub.msg}</div>
                    <Why term="publicName" />
                  </div>
                  {!isAp && (
                    <>
                      <WizLimit title="Banda para a rede" term="bandwidth"><Segmented variant="bg2" label="Banda" value={w.bw} onChange={bw => patch({ bw })} options={([5, 20, 50] as const).map(v => ({ value: v, label: `${v} Mbps` }))} /></WizLimit>
                      <WizLimit title="Armazenamento para terceiros" term="storage"><Segmented variant="bg2" label="Armazenamento" value={w.sto} onChange={sto => patch({ sto })} options={([1, 4, 8] as const).map(v => ({ value: v, label: `${v} GB` }))} /></WizLimit>
                      <WizLimit title="Horário" term="hours"><Segmented<HoursPolicy> variant="bg2" label="Horário" value={w.hours} onChange={hours => patch({ hours })} options={HOURS} /></WizLimit>
                    </>
                  )}
                </div>
                <div className="col" style={{ gap: 12 }}>
                  {!isAp && real && (
                    <div style={{ padding: 16, borderRadius: 16, background: 'var(--bg2)', display: 'flex', gap: 12 }}>
                      <Icon name="account_balance_wallet" size={21} wght={300} />
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)' }}>Carteira de recebimento: cada nó assina, lote a lote, a carteira que recebe (aba Ganhos do painel dele), sem um vínculo fixo.</div>
                    </div>
                  )}
                  {!isAp && !real && (
                    <>
                      <div style={fieldLabel}>Carteira de recebimento</div>
                      <div role="radiogroup" aria-label="Carteira de recebimento" className="col" style={{ gap: 12 }}>
                        {([['provider', 'Carteira de provider', WALLETS.provider.short, 'Recomendado. Separa ganhos de infraestrutura da sua identidade.'], ['personal', 'Carteira pessoal', WALLETS.personal.short, 'Mais simples, menos privado.']] as const).map(([k, t, a, d]) => (
                          <button key={k} type="button" role="radio" aria-checked={w.wallet === k} className="choice" onClick={() => patch({ wallet: k })} style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 16 }}>
                            <div className="radio" style={{ width: 20, height: 20, marginTop: 1 }}><span style={{ width: 10, height: 10 }} /></div>
                            <div className="col" style={{ flex: 1, gap: 3 }}>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{t}</div>
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
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)', textWrap: 'pretty' }}>Pontos de acesso não geram créditos próprios. As entregas que passam por ele contam para o {parent}, que assina os recibos.</div>
                    </div>
                  )}
                  <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', fontSize: 12, lineHeight: 1.45, color: 'var(--ink2)' }}>{real ? `${fam.result} · registrado sem teste real${w.nodePk ? ', com identidade técnica assinada por você' : ''}.` : `${fam.result} · aprovado no teste real.`}{real
                    ? isAp ? ' Pontos de acesso não recebem regras: não têm o Piu Node.'
                      : w.nodePk ? ' As regras saem assinadas pela sua chave de operador e valem nele quando ele receber pela malha, junto com os limites do próprio equipamento (fica o mais restrito).'
                      : ' Sem identidade técnica, as regras ficam só registradas neste painel.'
                    : ' Os limites globais de Configurações continuam valendo.'}</div>
                </div>
              </div>
            )}
          </div>

          <div className="row wiz-pad wiz-foot" style={{ gap: 10, padding: '16px 26px 22px', borderTop: '1px solid var(--line)' }}>
            <button type="button" className="btn btn-outline" disabled={w.step === 0} onClick={back} style={{ height: 44, padding: '0 18px', borderRadius: 22, fontSize: 14, opacity: w.step > 0 ? 1 : 0.35 }}>Voltar</button>
            <div className="mono" aria-live="polite" style={{ flex: 1, fontSize: 12, color: 'var(--ink2)' }}>{hint}</div>
            <button type="button" className="btn btn-primary" aria-disabled={!canNext} onClick={next} style={{ height: 44, padding: '0 22px', borderRadius: 22, fontSize: 14, opacity: canNext ? 1 : 0.35, transition: 'opacity .25s,transform .15s' }}>
              {w.step === 3 ? (activating ? (real ? 'Registrando…' : 'Ativando…') : real ? 'Registrar equipamento' : 'Ativar equipamento') : 'Continuar'}
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

function StepFamily({ value, onPick }: { value: string; onPick: (f: DeviceFamily) => void }) {
  return (
    <div role="radiogroup" aria-label="Tipo de equipamento" className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
  const done = n >= TOTAL_CHECKS;
  const checks: [string, string][] = fam.isAp
    ? [['Sinal no local', '−58 dBm · cobertura estimada de 25 m'], ['Isolamento de clientes', 'desativado · celulares se enxergam'], ['Descoberta local', 'mDNS e multicast passando'],
       ['Ligação ao nó pai', `${parent} · 9 ms`], ['Teste com celulares', '2 celulares trocaram 40 pacotes pelo repetidor · 100% ok']]
    : [[fam.install ? 'Pacote Piu Node' : 'Adapter de rádio', `${fam.pkg ?? ''} · assinatura Lunes conferida`], ['Hardware', fam.hw ?? ''], ['Interfaces', fam.ifs ?? ''],
       ['Identidade técnica do nó', 'chave gerada no equipamento · assinada pelo operador'], ['Encaminhamento real', fam.isRadio ? 'alcance medido por 2 nós independentes · 3,8 km' : '120 pacotes de teste por 3 vizinhos independentes · 99% ok']];
  const measured = fam.isAp
    ? [['Cobertura', fam.bw], ['Latência até o nó pai', fam.lat], ['Celulares vistos', fam.nb]]
    : [['Banda medida', fam.bw], ['Latência', fam.lat], ['Vizinhos', fam.nb]];

  return (
    <div className="wiz-2col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 20 }}>
      <div className="col">
        <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.4, paddingBottom: 6 }}>
          {fam.isAp ? 'Conferimos o sinal e se os celulares conseguem se encontrar através dele, ligados ao seu nó.' : 'Capacidade anunciada não basta: medimos com vizinhos independentes.'}
        </div>
        <ol aria-live="polite" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {checks.map(([t, d], i) => {
            const dn = i < n, cur = i === n;
            return (
              <li key={t} style={{ display: 'flex', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--line)', opacity: dn || cur ? 1 : 0.4, transition: 'opacity .3s' }}>
                <Icon name={dn ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={21} fill={dn ? 1 : 0} wght={400}
                  style={{ display: 'inline-block', animation: dn ? 'piuPop .38s var(--ease-pop)' : 'none' }} />
                <div className="col grow" style={{ gap: 3 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t}<span className="sr-only">{dn ? ' · concluído' : cur ? ' · em andamento' : ''}</span></div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{d}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="col" style={{ padding: 20, borderRadius: 22, background: done ? 'var(--ink)' : 'var(--bg2)', color: done ? 'var(--invink)' : 'var(--ink)', gap: 16, transition: 'background .3s,color .3s' }}>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 12.5, opacity: 0.7 }}>{done ? 'Classe aprovada' : 'Medindo…'}</div>
          <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.15 }}>{done ? fam.result : 'Aguarde o teste terminar'}</div>
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
  const code = n.confirmCode ?? null;
  return (
    <div className="col" style={{ gap: 8, padding: 12, borderRadius: 14, border: '1.5px solid var(--ink)', animation: 'piuUp .3s both' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.4 }}>
        {code ? 'Confira se o mesmo código aparece no painel do outro nó (Malha → Vizinhos, na linha deste nó):' : 'Este enlace não tem código de confirmação. Confira a identidade no console do outro equipamento.'}
      </div>
      {code && (
        <div aria-label={'Código de confirmação ' + code.split('').join(' ')} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
          {code.split('').map((v, i) => (
            <div key={i} className="mono" style={{ height: 44, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600 }}>{v}</div>
          ))}
        </div>
      )}
      <button type="button" role="checkbox" aria-checked={ok} onClick={onToggle} className="btn" style={{ justifyContent: 'flex-start', gap: 10, fontSize: 13.5, fontWeight: 550, padding: 0, minHeight: 40 }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink)', background: ok ? 'var(--ink)' : 'transparent', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}>
          <Icon name="check" size={15} style={{ opacity: ok ? 1 : 0 }} />
        </span>
        {code ? 'O mesmo código aparece no outro nó' : 'Conferi a identidade no outro equipamento'}
      </button>
      <div style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.4 }}>O código muda a cada conexão nova: compare os dois painéis ao mesmo tempo.</div>
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
      if (!p) setResult({ tone: 'warn', text: 'O nó não devolveu o estado deste vizinho. Veja em Malha.' });
      else if (p.state === 'connected' && p.pk) {
        if (registered(p.pk)) setResult({ tone: 'warn', text: `Conectado ao nó ${p.nodeId}, que já é um equipamento registrado.` });
        else { onConnected(p.pk); setResult({ tone: 'ok', text: `Conectado ao nó ${p.nodeId}. Ele foi escolhido acima: confira o código.` }); }
      } else if (p.state === 'failed') setResult({ tone: 'warn', text: `Não conectou: ${p.error ?? 'motivo desconhecido'}. Este nó continua tentando a cada poucos segundos.` });
      else setResult({ tone: 'warn', text: 'Ainda conectando. Quando o handshake terminar, ele aparece na lista acima.' });
    } catch (err) {
      setResult({ tone: 'warn', text: err instanceof ApiError ? err.message : 'Não foi possível adicionar. Tente de novo.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={e => void submit(e)} className="col" style={{ gap: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
      <label htmlFor="wiz-peer" style={{ fontSize: 13, fontWeight: 600 }}>Adicionar por endereço</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="wiz-peer" value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.0.12:8422" spellCheck={false} autoCapitalize="off" autoComplete="off"
          aria-describedby="wiz-peer-msg" className="mono"
          style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 12px', fontSize: 13.5, color: 'var(--ink)', outline: 'none' }} />
        <button type="submit" className="btn btn-outline" aria-disabled={busy || !address.trim()} style={{ height: 40, padding: '0 14px', borderRadius: 20, fontSize: 13, flex: 'none', opacity: busy || !address.trim() ? 0.5 : 1 }}>{busy ? 'Conectando…' : 'Conectar'}</button>
      </div>
      <div id="wiz-peer-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: result?.tone === 'ok' ? 'var(--ink)' : 'var(--ink2)' }}>
        {result?.text ?? 'Só host:porta do enlace LNNP do outro nó (8422 por padrão), sem http://. Fica salvo neste nó e reconecta sozinho.'}
      </div>
    </form>
  );
}
