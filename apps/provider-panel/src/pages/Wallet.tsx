import { useRef, useState } from 'react';
import { Dialog } from '../components/Overlays';
import { StepUpDialog } from '../components/Pair';
import { ApproveOnPhone } from '../components/Phone';
import type { ApiPending } from '../lib/api';
import { Icon, Segmented } from '../components/ui';
import { PERIOD, SIGN_CODE, WALLETS } from '../data/seed';
import { fmt, parseAmount } from '../lib/format';
import { copyText } from '../lib/io';
import { useStore } from '../state/store';

type Dest = 'personal' | 'other';
/** Mesmo formato que o piu-node aceita: `lunes:` + base58 (sem 0, O, I e l). */
const LUNES_ADDR = /^lunes:[1-9A-HJ-NP-Za-km-z]{26,44}$/;

export function Wallet() {
  const { balance, txs, totals, recordTransfer, approveTransfer, stepUp, showToast, nodeMode, phones } = useStore();
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
    if (r === 'ok') showToast({ icon: 'check_circle', title: 'Transferência assinada', body: real ? 'Pareie um celular em Configurações para aprovar as próximas nele.' : 'Liquida na próxima conexão de um gateway com a Mainnet.' });
  };
  /** Código de aprovação digitado: o nó confere e executa. */
  const finishOnPhone = async (approval: string) => {
    if (!pending) return null;
    const problem = await approveTransfer(pending, approval, amt, txRow());
    if (problem) return problem;
    setPending(null);
    showToast({ icon: 'check_circle', title: 'Transferência aprovada no celular', body: 'Liquida na próxima conexão de um gateway com a Mainnet.' });
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
          <Icon name="account_balance_wallet" size={18} />carteira de provider · {WALLETS.provider.long}<Icon name="content_copy" size={15} />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Saldo disponível</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="tnum" style={{ fontSize: 60, fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1 }}>{fmt(balance)}</span>
            <span style={{ fontSize: 16, fontWeight: 600, opacity: 0.75 }}>LUNES</span>
          </div>
          <div style={{ fontSize: 13.5, opacity: 0.75 }}>+ {fmt(totals.month)} em formação no lote {PERIOD.lot}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => { amtRef.current?.focus(); amtRef.current?.select(); showToast({ icon: 'arrow_upward', title: 'Preencha a transferência ao lado', body: 'A assinatura acontece no seu celular.' }); }}
            style={{ height: 42, padding: '0 18px', borderRadius: 21, background: 'var(--invink)', color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>
            <Icon name="arrow_upward" size={18} />Transferir
          </button>
          <button type="button" className="btn" onClick={() => { void copyText(WALLETS.provider.long); showToast({ icon: 'content_copy', title: 'Endereço copiado', body: WALLETS.provider.long }); }}
            style={{ height: 42, padding: '0 18px', borderRadius: 21, border: '1px solid rgba(127,127,127,.5)', color: 'var(--invink)', fontSize: 14, fontWeight: 600 }}>
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
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink2)' }}>{to === 'personal' ? `para ${WALLETS.personal.short} · pessoal` : `para ${WALLETS.other.short} · colado`}</div>
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
        {txs.map(t => (
          <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr) 120px', gap: 14, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)', animation: t.fresh ? 'piuUp .4s both' : 'none' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={t.icon} size={18} wght={300} /></div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
            <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{t.date}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{t.status}</span>
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
    </div>
  );
}
