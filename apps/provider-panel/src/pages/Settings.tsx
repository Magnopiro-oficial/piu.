import { useState, type ReactNode } from 'react';
import { StepUpDialog } from '../components/Pair';
import { PairPhone } from '../components/Phone';
import { ApiError, NeedsReauth } from '../lib/api';
import { Icon, Segmented, Toggle } from '../components/ui';
import { OPERATOR, PUB_RULES, SESSIONS } from '../data/seed';
import { relayOn } from '../lib/live';
import { useStore } from '../state/store';
import type { HoursPolicy, Policies } from '../types';

const segProps = { gap: 4, radius: 12, btnRadius: 9 } as const;

export function Settings() {
  const { limits, setLimits, policies, togglePolicy, devices, showToast, sessions, revokeOtherSessions, stepUp, phones, refreshPhones, api, live } = useStore();
  const nodeId = relayOn(live)?.node ?? null;
  const [pairing, setPairing] = useState<{ id: string; qr: string } | null>(null);
  const [pairStepUp, setPairStepUp] = useState(false);
  const startPair = async () => {
    if (!api) return;
    try { const r = await api.startPhonePairing('Celular'); setPairing({ id: r.id, qr: r.qr }); }
    catch (e) { if (e instanceof NeedsReauth) setPairStepUp(true); else showToast({ icon: 'error', title: 'Não foi possível parear', body: e instanceof ApiError ? e.message : 'Tente de novo.' }); }
  };
  const confirmPair = async (code: string) => {
    if (!api || !pairing) return null;
    try { await api.confirmPhone(pairing.id, code); } catch (e) { return e instanceof ApiError ? e.message : 'Não foi possível confirmar.'; }
    setPairing(null); refreshPhones();
    showToast({ icon: 'smartphone', title: 'Celular pareado', body: 'As próximas transferências são aprovadas nele.' });
    return null;
  };
  const removePhone = async (id: string) => {
    if (!api) return;
    try { await api.removePhone(id); refreshPhones(); showToast({ icon: 'phonelink_erase', title: 'Celular removido', body: 'Ele não aprova mais transferências deste nó.' }); }
    catch (e) { showToast({ icon: 'error', title: 'Não foi possível remover', body: e instanceof ApiError ? e.message : 'Tente de novo.' }); }
  };
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // Com o piu-node: acessos reais; na demonstração, os do exemplo.
  const rows: [string, string, string, string][] = sessions
    ? sessions.map(x => [x.label.startsWith('App') ? 'desktop_windows' : 'computer', x.current ? 'Este acesso' : x.label, `${x.current ? x.label + ' · ' : ''}desde ${when(x.createdAt)}`, x.current ? 'agora' : `visto ${when(x.lastSeen)}`])
    : SESSIONS;
  const others = sessions ? sessions.filter(x => !x.current).length : 1;
  const endOthers = async () => {
    const r = await revokeOtherSessions();
    if (r === 'reauth') { setStepUpOpen(true); return; }
    if (r === 'ok') showToast({ icon: 'logout', title: 'Outras sessões encerradas', body: 'Só este acesso continua aberto.' });
  };
  const confirmStepUp = async (code: string) => {
    const problem = await stepUp(code);
    if (problem) return problem;
    setStepUpOpen(false);
    await endOthers();
    return null;
  };
  const policyRows: [keyof Policies | 'alerts', string, string][] = [
    ['media', 'Aceitar arquivos e mídia', 'Só por Wi-Fi e cabo; nunca por LoRa'],
    ['alerts', 'Priorizar alertas oficiais', 'Sempre ativo para alertas assinados'],
    ['unknown', 'Limitar remetentes desconhecidos', 'Contra spam e tráfego artificial'],
    ['community', 'Só comunidades que sigo', 'Reduz alcance e ganhos'],
  ];

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16, alignItems: 'start' }}>
      <section className="card-soft col" style={{ borderRadius: 22, padding: 20, gap: 16 }}>
        <CardHead title="Limites globais" sub="Somados entre todos os seus equipamentos" />
        <LimitRow title="Banda total para a rede" hint="somando equipamentos">
          <Segmented {...segProps} label="Banda total" value={limits.bw} onChange={bw => setLimits({ bw })} options={[20, 50, 100].map(v => ({ value: v, label: `${v} Mbps` }))} />
        </LimitRow>
        <LimitRow title="Armazenamento para terceiros" hint="mensagens cifradas">
          <Segmented {...segProps} label="Armazenamento" value={limits.sto} onChange={sto => setLimits({ sto })} options={[4, 8, 16].map(v => ({ value: v, label: `${v} GB` }))} />
        </LimitRow>
        <LimitRow title="Horário de operação" hint="para todos">
          <Segmented<HoursPolicy> {...segProps} label="Horário" value={limits.hours} onChange={hours => setLimits({ hours })} options={HOURS} />
        </LimitRow>
      </section>

      <section className="card-soft col" style={{ borderRadius: 22, padding: '20px 20px 8px' }}>
        <div style={{ paddingBottom: 10 }}><CardHead title="Política de tráfego" sub="O que seus equipamentos aceitam retransmitir" /></div>
        {policyRows.map(([k, n, d]) => {
          const locked = k === 'alerts';
          const on = locked ? true : policies[k];
          return (
            <div key={k} className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              <div className="col grow" style={{ gap: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 550 }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{d}</div>
              </div>
              <Toggle on={on} label={n} disabled={locked} onChange={locked ? undefined : () => togglePolicy(k)} />
            </div>
          );
        })}
      </section>

      <section className="card-line col" style={{ borderRadius: 22, padding: 20, gap: 12 }}>
        <CardHead title="Acesso a este painel" sub="Disponível só na rede local, nunca pela internet" />
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
          style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: others === 0 ? 0.4 : 1 }}>{others === 0 ? 'Nenhuma outra sessão' : 'Encerrar outras sessões'}</button>
        {stepUpOpen && <StepUpDialog onConfirm={confirmStepUp} onClose={() => setStepUpOpen(false)} />}
        {phones && (
          <div className="col" style={{ gap: 4, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Celulares que aprovam transferências</div>
            {phones.filter(p => p.confirmed).length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Nenhum. Sem celular, transferências pedem um código novo do equipamento.</div>}
            {phones.filter(p => p.confirmed).map(p => (
              <div key={p.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
                <Icon name="smartphone" size={20} wght={300} />
                <div className="col grow" style={{ gap: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>app Piu · aprova transferências · desde {when(p.addedAt)}</div>
                </div>
                <button type="button" className="btn btn-outline" onClick={() => void removePhone(p.id)} style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5 }}>Remover</button>
              </div>
            ))}
            <button type="button" className="btn btn-outline" onClick={() => void startPair()} style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, marginTop: 4 }}>Parear celular</button>
          </div>
        )}
        {pairing && <PairPhone qr={pairing.qr} onConfirm={confirmPair} onClose={() => setPairing(null)} />}
        {pairStepUp && <StepUpDialog onConfirm={async code => { const p = await stepUp(code); if (p) return p; setPairStepUp(false); await startPair(); return null; }} onClose={() => setPairStepUp(false)} />}
      </section>

      <section className="card-line col" style={{ borderRadius: 22, padding: 20, gap: 12 }}>
        <CardHead title="Identidade de operador" sub="Assina seus equipamentos. Separada da sua identidade de conversa." />
        {api ? (
          // Com piu-node: a chave de operador ainda não existe (o acesso é pelo código do equipamento). Nada de impressão digital de exemplo.
          <>
            <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', fontSize: 13, lineHeight: 1.45, color: 'var(--ink2)' }}>
              Este nó ainda não tem chave de operador: o acesso é pelo código mostrado no equipamento.{nodeId ? <> A identidade técnica do nó (LNNP) é <span className="mono" style={{ color: 'var(--ink)' }}>{nodeId}</span>.</> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: 0.4 }}>Exportar backup cifrado</button>
              <button type="button" className="btn btn-outline" disabled style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: 0.4 }}>Rotacionar chaves</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>Backup e rotação ainda não estão disponíveis: dependem da chave de operador, que esta versão não cria.</div>
          </>
        ) : (<>
        <div className="mono" aria-label="Impressão digital da chave de operador" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, fontSize: 15, fontWeight: 500, padding: '12px 14px', borderRadius: 14, background: 'var(--bg2)' }}>
          {OPERATOR.fingerprint.map(g => <span key={g}>{g}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => showToast({ icon: 'key', title: 'Backup cifrado exportado', body: 'piu-operador.backup · protegido pela sua frase secreta' })} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>Exportar backup cifrado</button>
          <button type="button" className="btn btn-outline" onClick={() => showToast({ icon: 'sync_lock', title: 'Rotação agendada', body: 'Equipamentos recebem a nova chave na próxima sincronização.' })} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>Rotacionar chaves</button>
        </div>
        </>)}
      </section>

      <section className="card-line" style={{ gridColumn: 'span 2', borderRadius: 22, padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', gap: 28 }}>
        <div className="col" style={{ gap: 10 }}>
          <CardHead title="Nomes públicos das suas redes" sub="Qualquer pessoa por perto vê estes nomes na lista de Wi-Fi e no app" />
          {devices.filter(d => d.pub).map(d => (
            <div key={d.id} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <Icon name={d.icon} size={19} wght={300} />
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <div className="mono ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{d.pub}</div>
                <div className="ellipsis" style={{ fontSize: 12, color: 'var(--ink2)' }}>{d.name} · {d.cls}</div>
              </div>
              {/* Com piu-node, o nome fica só registrado: a assinatura pela chave de operador ainda não existe. */}
              <span className="row" style={{ gap: 4, fontSize: 12, fontWeight: 600 }}><Icon name={api ? 'badge' : 'verified'} size={15} fill={1} />{api ? 'registrado' : 'assinado'}</span>
            </div>
          ))}
          {!devices.some(d => d.pub) && <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 13, color: 'var(--ink2)' }}>Nenhum nome público ainda. O assistente "Adicionar equipamento" registra um.</div>}
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink2)', paddingTop: 6 }}>piu. + até 28 caracteres · a–z, 0–9 e hífen</div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Como o Piu evita imitações</div>
          {PUB_RULES.map(r => (
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

/** "agora", "há 5 min", "há 2 h", "12/11". */
function when(at: number) {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 24 * 60) return `há ${Math.round(m / 60)} h`;
  return new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export const HOURS: { value: HoursPolicy; label: string }[] = [{ value: 'always', label: 'Sempre' }, { value: 'night', label: '22h–7h' }, { value: 'day', label: '8h–18h' }];

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
