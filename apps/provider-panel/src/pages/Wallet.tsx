import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '../components/Overlays';
import { StepUpDialog } from '../components/Pair';
import { ApproveOnPhone } from '../components/Phone';
import { QrCode } from '../components/QrCode';
import { ApiError, NeedsReauth, type ApiLunesWallet, type ApiPending } from '../lib/api';
import { Icon, Segmented } from '../components/ui';
import { PERIOD, SIGN_CODE, WALLETS } from '../data/seed';
import { fmt, fmtInt, fmtPlanck, parseAmount } from '../lib/format';
import { copyText } from '../lib/io';
import { useStore } from '../state/store';

type Dest = 'personal' | 'other';
/** Mesmo formato que o piu-node aceita: `lunes:` + base58 (sem 0, O, I e l). */
const LUNES_ADDR = /^lunes:[1-9A-HJ-NP-Za-km-z]{26,44}$/;

const hostOf = (url: string) => url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
const hhmm = (ms: number) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const shortAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/** Carteira de provider na Lunes Mainnet, pelo piu-node: endereço configurado e saldo lido (a cada 30 s). */
function useLunesWallet(enabled: boolean) {
  const { api } = useStore();
  const [lw, setLw] = useState<ApiLunesWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (!api || !enabled) return;
    setLoading(true);
    api.lunesWallet().then(setLw).catch(() => {}).finally(() => setLoading(false));
  }, [api, enabled]);
  useEffect(() => {
    load();
    if (!enabled) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, enabled]);
  return { lw, loading, load };
}

/** Linha do saldo on-chain: valor real com bloco e endereço que respondeu, ou o motivo de não ter. */
function onchainLine(lw: ApiLunesWallet | null, loading: boolean): string {
  if (!lw) return loading ? 'Consultando a carteira de provider…' : 'Carteira de provider indisponível neste nó.';
  if (!lw.address) return 'Configure o endereço Lunes da carteira de provider para ver o saldo on-chain.';
  const r = lw.onchain;
  if (!r) return lw.error ? `Sem conexão com a Lunes Mainnet: o saldo ainda não foi lido. ${lw.error}` : 'Consultando a Lunes Mainnet…';
  const where = `bloco #${fmtInt(r.block)} · ${hostOf(r.endpoint)} · atualizado ${hhmm(r.at)}`;
  return lw.error ? `Sem conexão agora · última leitura: ${fmtPlanck(r.free)} LUNES · ${where}` : `Na Lunes Mainnet: ${fmtPlanck(r.free)} LUNES · ${where}`;
}

export function Wallet() {
  const { balance, txs, totals, recordTransfer, approveTransfer, stepUp, showToast, nodeMode, phones } = useStore();
  const { lw, loading: lwLoading, load: loadLw } = useLunesWallet(nodeMode === 'node');
  const [lunesOpen, setLunesOpen] = useState<'receive' | 'edit' | null>(null);
  const [pending, setPending] = useState<ApiPending | null>(null);
  const [addr, setAddr] = useState('');
  const addrOk = LUNES_ADDR.test(addr.trim());
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [to, setTo] = useState<Dest>('personal');
  const [amtStr, setAmtStr] = useState('200');
  const [signing, setSigning] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);
  const amt = parseAmount(amtStr);
  // Com o piu-node, "Outro endereço" usa o endereço colado; na demonstração, o do exemplo.
  const real = nodeMode === 'node';
  const valid = amt > 0 && amt <= balance && (to === 'personal' || !real || addrOk);
  const destShort = to === 'personal' ? WALLETS.personal.short : real ? `${addr.trim().slice(0, 10)}…${addr.trim().slice(-4)}` : WALLETS.other.short;

  const txRow = () => ({ id: 'tx' + Date.now(), icon: 'call_made', title: to === 'personal' ? 'Para carteira pessoal' : `Para ${destShort}`, date: 'agora', status: 'assinada · na fila da malha', value: '−' + fmt(amt), fresh: true });
  const approve = async () => {
    setSigning(false);
    const r = await recordTransfer(amt, txRow(), to === 'personal' || !real ? 'personal' : addr.trim());
    if (r === 'reauth') { setStepUpOpen(true); return; }
    if (typeof r === 'object') { setPending(r.pending); return; } // aprovar no celular pareado
    if (r === 'ok') showToast({ icon: 'check_circle', title: real ? 'Transferência registrada' : 'Transferência assinada', body: real ? 'Registrada neste nó. Pareie um celular em Configurações para aprovar as próximas nele.' : 'Liquida na próxima conexão de um gateway com a Mainnet.' });
  };
  /** Código de aprovação digitado: o nó confere e executa. */
  const finishOnPhone = async (approval: string) => {
    if (!pending) return null;
    const problem = await approveTransfer(pending, approval, amt, txRow());
    if (problem) return problem;
    setPending(null);
    showToast({ icon: 'check_circle', title: 'Transferência aprovada no celular', body: real ? 'Registrada neste nó; sai para a Mainnet quando um gateway tiver rota.' : 'Liquida na próxima conexão de um gateway com a Mainnet.' });
    return null;
  };
  /** Step-up: código novo do equipamento e, se confirmar, refaz a transferência. */
  const confirmStepUp = async (code: string) => {
    const problem = await stepUp(code);
    if (problem) return problem;
    setStepUpOpen(false);
    await approve();
    return null;
  };

  return (
    <div className="grid12 page-body">
      <section className="span7 card-ink col" style={{ padding: 24, borderRadius: 24, gap: 20 }}>
        <div className="row mono" style={{ gap: 10, fontSize: 12.5, opacity: 0.8 }}>
          {/* Com piu-node: o endereço Lunes que o operador configurou no nó (nada de endereço de exemplo). */}
          <Icon name="account_balance_wallet" size={18} />
          {!real ? <>carteira de provider · {WALLETS.provider.long}<Icon name="content_copy" size={15} /></>
            : lw?.address ? (
              <button type="button" className="btn mono" title="Copiar endereço" aria-label={`Copiar endereço ${lw.address}`}
                onClick={() => { void copyText(lw.address!); showToast({ icon: 'content_copy', title: 'Endereço copiado', body: lw.address! }); }}
                style={{ background: 'none', color: 'inherit', padding: 0, gap: 6, fontSize: 12.5, minWidth: 0 }}>
                carteira de provider · {shortAddr(lw.address)}<Icon name="content_copy" size={15} />
              </button>
            ) : 'carteira de provider · sem endereço Lunes'}
        </div>
        <div className="col" style={{ gap: 6 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Saldo disponível</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="tnum hero-num" style={{ fontSize: 60, fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1 }}>{fmt(balance)}</span>
            <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.75 }}>LUNES</span>
          </div>
          <div style={{ fontSize: 13.5, opacity: 0.75 }}>{real ? 'Registrado neste nó. Ganhos entram aqui quando um lote for pago (liquidação ainda não ligada).' : `+ ${fmt(totals.month)} em formação no lote ${PERIOD.lot}`}</div>
          {real && (
            <div className="row" style={{ gap: 8, fontSize: 12.5, opacity: lw?.error ? 0.95 : 0.8, alignItems: 'flex-start' }} aria-live="polite">
              <Icon name={lw?.onchain && !lw.error ? 'cloud_done' : 'cloud_off'} size={16} />
              <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>{onchainLine(lw, lwLoading)}</span>
              {lw?.address && <button type="button" className="btn" onClick={loadLw} disabled={lwLoading} aria-label="Ler o saldo de novo" title="Ler o saldo de novo" style={{ background: 'none', color: 'inherit', padding: 0, opacity: lwLoading ? 0.4 : 1 }}><Icon name="refresh" size={16} /></button>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => { amtRef.current?.focus(); amtRef.current?.select(); showToast({ icon: 'arrow_upward', title: 'Preencha a transferência ao lado', body: 'A assinatura acontece no seu celular.' }); }}
            style={{ height: 42, padding: '0 18px', borderRadius: 21, background: 'var(--invink)', color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>
            <Icon name="arrow_upward" size={18} />Transferir
          </button>
          <button type="button" className="btn" disabled={real && !lw}
            onClick={() => {
              if (real) { setLunesOpen(lw?.address ? 'receive' : 'edit'); return; }
              void copyText(WALLETS.provider.long); showToast({ icon: 'content_copy', title: 'Endereço copiado', body: WALLETS.provider.long });
            }}
            style={{ height: 42, padding: '0 18px', borderRadius: 21, border: '1px solid rgba(127,127,127,.5)', color: 'var(--invink)', fontSize: 14, fontWeight: 600, opacity: real && !lw ? 0.45 : 1 }}>
            <Icon name="arrow_downward" size={18} />Receber
          </button>
        </div>
      </section>

      <section className="span5 card-soft col" style={{ padding: 20, borderRadius: 24, gap: 14 }}>
        <h2 className="h-card" style={{ margin: 0 }}>Transferir</h2>
        <Segmented<Dest> label="Destino" value={to} onChange={setTo} options={[{ value: 'personal', label: 'Carteira pessoal' }, { value: 'other', label: 'Outro endereço' }]} />
        {to === 'other' && real ? (
          <label className="col" style={{ gap: 6 }}>
            <span className="sr-only">Endereço LUNES de destino</span>
            <input value={addr} onChange={e => setAddr(e.target.value.replace(/\s/g, ''))} placeholder="lunes:…" spellCheck={false} autoComplete="off" maxLength={52}
              aria-invalid={addr.length > 0 && !addrOk}
              className="mono" style={{ height: 40, padding: '0 14px', borderRadius: 12, border: 'none', background: 'var(--bg)', boxShadow: `0 0 0 1px ${addr && !addrOk ? 'var(--ink)' : 'var(--line2)'} inset`, fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
            {addr && !addrOk && <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Endereço LUNES inválido. Confira se colou inteiro.</span>}
          </label>
        ) : (
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink2)' }}>{to === 'personal' ? (real ? 'para a sua carteira pessoal' : `para ${WALLETS.personal.short} · pessoal`) : `para ${WALLETS.other.short} · colado`}</div>
        )}
        <label className="row" style={{ gap: 10, height: 56, padding: '0 16px', borderRadius: 16, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset' }}>
          <span className="sr-only">Valor em LUNES</span>
          <input ref={amtRef} inputMode="decimal" value={amtStr} onChange={e => setAmtStr(e.target.value.replace(/[^0-9,.]/g, ''))}
            className="tnum" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 26, fontWeight: 650, letterSpacing: '-0.03em', color: 'var(--ink)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>LUNES</span>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['25%', 0.25], ['50%', 0.5], ['Tudo', 1]] as const).map(([l, f]) => (
            <button key={l} type="button" className="btn" onClick={() => setAmtStr(fmt(Math.floor(balance * f * 100) / 100))} style={{ height: 30, padding: '0 12px', borderRadius: 15, background: 'var(--bg3)', fontSize: 12.5, fontWeight: 550 }}>{l}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => { if (!valid) return; if (real) void approve(); else setSigning(true); }} style={{ height: 46, borderRadius: 23, fontSize: 14.5, opacity: valid ? 1 : 0.35 }}>
          <Icon name="smartphone" size={19} />Assinar no celular
        </button>
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{real && phones && !phones.some(p => p.confirmed) ? 'Nenhum celular pareado: a transferência pede um código novo do equipamento. Pareie um celular em Configurações.' : 'A chave de assinatura fica no seu celular. Este painel só prepara a transação.'}</div>
      </section>

      <section className="span12 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Movimentações</h2>
        {!txs.length && <div style={{ padding: '18px', borderTop: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink2)' }}>Nenhuma movimentação ainda. Liquidações recebidas e transferências aparecem aqui.</div>}
        {txs.map(t => (
          <div key={t.id} className="tx-row" style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) 120px', gap: 14, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)', animation: t.fresh ? 'piuUp .4s both' : 'none' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={t.icon} size={18} wght={300} /></div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
            <span className="tx-date" style={{ fontSize: 13, color: 'var(--ink2)' }}>{t.date}</span>
            <span className="mono tx-status" style={{ fontSize: 12, color: 'var(--ink2)' }}>{t.status}</span>
            <span className="tnum" style={{ textAlign: 'right', fontSize: 14, fontWeight: 650 }}>{t.value}</span>
          </div>
        ))}
      </section>

      {pending && (
        <ApproveOnPhone request={pending.request} code={pending.code} phone={pending.phone}
          body={`${fmt(amt)} LUNES para a ${to === 'personal' ? 'carteira pessoal' : 'conta indicada'}.`}
          onApprove={finishOnPhone} onClose={() => setPending(null)} />
      )}
      {signing && (
        <Dialog icon="smartphone" title="Confirme no seu celular" waiting code={SIGN_CODE}
          body={`Abra o Piu no celular pareado e confira o código para assinar ${fmt(amt)} LUNES para a ${to === 'personal' ? 'carteira pessoal' : 'conta indicada'}.`}
          // Sem o app pareado de verdade, a aprovação é simulada (como no protótipo).
          primaryLabel="Simular aprovação no celular" onPrimary={approve} onClose={() => setSigning(false)} />
      )}
      {stepUpOpen && <StepUpDialog onConfirm={confirmStepUp} onClose={() => setStepUpOpen(false)} />}
      {lunesOpen && lw && (
        <LunesWalletDialog lw={lw} mode={lunesOpen} onMode={setLunesOpen} onSaved={loadLw} onClose={() => setLunesOpen(null)} />
      )}
    </div>
  );
}

const field = { height: 44, borderRadius: 14, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 14px', fontSize: 13.5, width: '100%' } as const;

/**
 * Receber (QR, copiar, explorador) e configurar o endereço Lunes da carteira de provider. O nó confere
 * o endereço (SS58) e pede um código novo do equipamento (step-up) antes de trocar.
 */
function LunesWalletDialog({ lw, mode, onMode, onSaved, onClose }: {
  lw: ApiLunesWallet; mode: 'receive' | 'edit'; onMode: (m: 'receive' | 'edit') => void; onSaved: () => void; onClose: () => void;
}) {
  const { api, stepUp, showToast } = useStore();
  const [draft, setDraft] = useState(lw.address ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState<null | 'save' | 'clear'>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reauth) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, reauth]);

  const run = async (what: 'save' | 'clear') => {
    if (!api) return;
    setBusy(true); setErr(null);
    try {
      if (what === 'save') await api.setLunesAddress(draft.trim());
      else await api.clearLunesAddress();
      onSaved();
      showToast(what === 'save'
        ? { icon: 'check_circle', title: 'Carteira de provider configurada', body: 'O saldo on-chain é lido na Lunes Mainnet por este nó.' }
        : { icon: 'delete', title: 'Endereço removido', body: 'O nó não consulta mais a Mainnet para esta carteira.' });
      onClose();
    } catch (e) {
      if (e instanceof NeedsReauth) setReauth(what);
      else setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (draft.trim() && !busy) void run('save'); };
  const r = lw.onchain;

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 45 }} />
      <div role="dialog" aria-modal="true" aria-labelledby="lunes-title" className="col dlg"
        style={{ position: 'fixed', left: '50%', top: '50%', width: 440, marginLeft: -220, transform: 'translateY(-50%)', zIndex: 46, borderRadius: 28, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 30px 80px rgba(0,0,0,.3)', padding: '26px 24px 20px', gap: 14 }}>
        <div className="row" style={{ gap: 10 }}><Icon name={mode === 'receive' ? 'qr_code_2' : 'account_balance_wallet'} size={26} wght={300} /><h2 id="lunes-title" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{mode === 'receive' ? 'Receber na carteira de provider' : 'Endereço da carteira de provider'}</h2></div>
        {mode === 'receive' && lw.address ? (
          <>
            <div className="col" style={{ alignItems: 'center', gap: 10 }}>
              <QrCode value={lw.address} size={200} label="QR do endereço Lunes da carteira de provider" />
              <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all', textAlign: 'center', userSelect: 'all' }}>{lw.address}</div>
              {r && <div style={{ fontSize: 12.5, color: 'var(--ink2)', textAlign: 'center' }}>{`${fmtPlanck(r.free)} LUNES · bloco #${fmtInt(r.block)} · ${hostOf(r.endpoint)}`}</div>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => { void copyText(lw.address!); showToast({ icon: 'content_copy', title: 'Endereço copiado', body: lw.address! }); }} style={{ flex: 1, height: 42, borderRadius: 21 }}><Icon name="content_copy" size={17} />Copiar</button>
              <a className="btn btn-outline" href={lw.explorer} target="_blank" rel="noopener noreferrer" style={{ flex: 1, height: 42, borderRadius: 21, textDecoration: 'none' }}><Icon name="open_in_new" size={17} />Explorador</a>
            </div>
            <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-soft" onClick={() => { setDraft(lw.address ?? ''); onMode('edit'); }} style={{ height: 38, padding: '0 14px', borderRadius: 19, fontSize: 13 }}>Trocar endereço</button>
              <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 38, padding: '0 14px', borderRadius: 19, fontSize: 13 }}>Fechar</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="col" style={{ gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink2)' }}>Cole o endereço Lunes (SS58) da carteira que recebe os ganhos deste nó. O nó só lê o saldo na Lunes Mainnet: ele não tem a chave dessa carteira e não assina nada.</p>
            <input value={draft} onChange={e => { setDraft(e.target.value.replace(/\s/g, '')); setErr(null); }} placeholder="Endereço Lunes" spellCheck={false} autoComplete="off" maxLength={80} autoFocus
              aria-label="Endereço Lunes da carteira de provider" aria-invalid={!!err} className="mono" style={field} />
            {err && <div role="alert" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 12, border: '1px dashed var(--line2)' }}>{err}</div>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {lw.address && <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void run('clear')} style={{ height: 40, padding: '0 16px', borderRadius: 20, marginRight: 'auto' }}>Remover</button>}
              <button type="button" className="btn btn-soft" onClick={onClose} style={{ height: 40, padding: '0 16px', borderRadius: 20 }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={!draft.trim() || busy} style={{ height: 40, padding: '0 18px', borderRadius: 20, opacity: draft.trim() ? 1 : 0.4 }}>{busy ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        )}
      </div>
      {reauth && (
        <StepUpDialog reason="Trocar a carteira de provider exige uma confirmação recente." confirmLabel="Confirmar e salvar" onClose={() => setReauth(null)}
          onConfirm={async code => { const p = await stepUp(code); if (p) return p; const what = reauth; setReauth(null); await run(what); return null; }} />
      )}
    </>,
    document.body,
  );
}
