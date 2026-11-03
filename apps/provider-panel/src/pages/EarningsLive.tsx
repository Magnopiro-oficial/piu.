import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { StepUpDialog } from '../components/Pair';
import { Icon, Segmented, growX } from '../components/ui';
import { ApiError, NeedsReauth, type ApiClaims } from '../lib/api';
import { downloadText } from '../lib/io';
import { fmt, fmtInt } from '../lib/format';
import { dayKeyOf, dayLabel, historyOn, monthDays, monthName, receiptsOn, relayOn, sum, weeks } from '../lib/live';
import { useStore } from '../state/store';

const DAY_COLS = 'minmax(0,1.1fr) repeat(4,minmax(0,1fr))';
const head = { padding: '10px 18px', background: 'var(--bg2)', fontSize: 11, fontWeight: 500, letterSpacing: '.05em', color: 'var(--ink2)' } as const;

/**
 * Ganhos com o piu-node: o que o nó comprova (recibos por dia e por semana) e o que já foi pago
 * (entradas reais da carteira). Valor por recibo, validados e rejeitados dependem do validador.
 */
export function EarningsLive() {
  const { live, txs } = useStore();
  const h = historyOn(live), rc = receiptsOn(live);
  const month = sum(monthDays(h));
  const paid = txs.filter(t => (t.amount ?? 0) > 0);
  const paidTotal = paid.reduce((a, t) => a + (t.amount ?? 0), 0);
  const days = [...(h?.days ?? [])].reverse().slice(0, 14);
  const ws = weeks(h);
  const wmax = Math.max(1, ...ws.map(w => w.totals.receipts));
  const mon = h ? monthName(h.today) : 'este mês';

  const tiles: [string, string, string, boolean, number][] = [
    ['Pagos até hoje', fmt(paidTotal), paid.length ? `${paid.length} ${paid.length === 1 ? 'liquidação recebida' : 'liquidações recebidas'}` : 'nenhum lote liquidado ainda', true, 1],
    [`Recibos em ${mon}`, fmtInt(month.receipts), 'assinados por este nó', false, 0.6],
    ['Aguardando validação', fmtInt(rc?.keptOwn ?? 0), 'guardados até um gateway alcançar o validador', false, 0.32],
    ['Rejeitados', '—', 'o validador ainda não respondeu', false, 0.14],
  ];

  return (
    <div className="grid12 page-body">
      {tiles.map(([l, v, d, ink, op]) => (
        <div key={l} className="span3 col" style={{ padding: 18, borderRadius: 20, background: ink ? 'var(--ink)' : 'var(--bg2)', color: ink ? 'var(--invink)' : 'var(--ink)', gap: 8 }}>
          <div className="row" style={{ gap: 8, fontSize: 12.5, opacity: 0.75 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor', opacity: op }} />{l}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.04em' }}>{v}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{d}</div>
        </div>
      ))}

      <section className="span7 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Recibos por dia</h2>
        <div className="mono tbl-head" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, ...head }}>
          <span>DIA</span><span style={{ textAlign: 'right' }}>RECEBIDOS</span><span style={{ textAlign: 'right' }}>ENCAMINHADOS</span><span style={{ textAlign: 'right' }}>DUPLICATAS</span><span style={{ textAlign: 'right' }}>RECIBOS</span>
        </div>
        {days.map(d => (
          <div key={d.day} className="tbl-row" style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 12, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
            <span style={{ fontWeight: 600 }}>{d.day === h?.today ? 'hoje' : dayLabel(d.day)}</span>
            <span className="tnum" data-label="recebidos" style={{ textAlign: 'right' }}>{fmtInt(d.received)}</span>
            <span className="tnum" data-label="encaminhados" style={{ textAlign: 'right' }}>{fmtInt(d.forwarded)}</span>
            <span className="tnum" data-label="duplicatas" style={{ textAlign: 'right', color: 'var(--ink2)' }}>{fmtInt(d.duplicates)}</span>
            <span className="tnum" data-label="recibos" style={{ textAlign: 'right', fontWeight: 650 }}>{fmtInt(d.receipts)}</span>
          </div>
        ))}
        {!days.length && <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', borderTop: '1px solid var(--line)' }}>{h ? 'Nenhum dia registrado ainda: o histórico grava a cada rodada do nó.' : 'Retransmissão LNNP desligada neste nó.'}</div>}
        <div className="mono" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink2)' }}>Um recibo por envelope de terceiro repassado · valor em LUNES só depois da validação</div>
      </section>

      <section className="span5 card-soft col" style={{ borderRadius: 22, padding: 18, gap: 14 }}>
        <h2 className="h-card" style={{ margin: 0 }}>Por semana</h2>
        {ws.map(w => (
          <div key={w.start} className="col" style={{ gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>semana de {dayLabel(w.start)}</span>
              <span className="tnum" style={{ fontWeight: 650 }}>{fmtInt(w.totals.receipts)} recibos</span>
            </div>
            <div className="track" style={{ height: 6 }}><div style={{ width: ((w.totals.receipts / wmax) * 100).toFixed(0) + '%', animation: growX() }} /></div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)' }}>{fmtInt(w.totals.forwarded)} encaminhados · {fmtInt(w.totals.duplicates)} duplicatas</div>
          </div>
        ))}
        {!ws.length && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Sem semanas registradas ainda.</div>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Só o nó que serve este painel tem recibos aqui. Os outros equipamentos seus mandam só um resumo assinado (em Equipamentos); os recibos deles ficam neles.</div>
      </section>

      <section className="span12 card-line" style={{ borderRadius: 22, overflow: 'hidden' }}>
        <h2 className="h-card" style={{ margin: 0, padding: '16px 18px' }}>Lotes de liquidação</h2>
        {paid.map(t => (
          <div key={t.id} className="row" style={{ gap: 12, padding: '13px 18px', borderTop: '1px solid var(--line)', fontSize: 13.5, flexWrap: 'wrap' }}>
            <Icon name="check_circle" size={17} fill={1} />
            <span className="grow" style={{ fontWeight: 600 }}>{t.title}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink2)' }}>{t.date}</span>
            <span className="tnum" style={{ fontWeight: 650 }}>{t.value}</span>
          </div>
        ))}
        {!paid.length && (
          <div style={{ padding: '18px', borderTop: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
            Nenhum lote ainda. Um lote só existe depois que o validador confere os recibos com as confirmações de entrega e a Mainnet liquida. Até lá, os recibos ficam guardados neste nó.
          </div>
        )}
      </section>

      <LotWallet />

      <div className="span12" style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink2)' }}>
        <Icon name="policy" size={17} style={{ color: 'var(--ink)' }} />
        <span>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados. Tempo ligado e capacidade anunciada não geram crédito.</span>
      </div>
    </div>
  );
}

/** Forma de um endereço SS58 de 32 bytes (base58, 47–48 caracteres). O nó confere a soma de verificação. */
const looksLikeAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(a.trim());
const shortAddress = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/**
 * Carteira do lote (proposta econômica, seção 7): o nó assina, com a chave técnica dele, a carteira
 * LUNES que recebe o lote desta semana ou da próxima, e o operador leva ao validador esse arquivo e
 * o das evidências (recibos).
 */
function LotWallet() {
  const { api, live, showToast, stepUp } = useStore();
  const receiptsCount = receiptsOn(live)?.kept ?? 0;
  const [claims, setClaims] = useState<ApiClaims | null>(null);
  const [epoch, setEpoch] = useState<string>('');
  const [address, setAddress] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const load = useCallback(() => { api?.claims().then(c => { setClaims(c); setEpoch(e => e || c.epochs[0] || ''); }).catch(() => {}); }, [api]);
  useEffect(load, [load]);
  const node = relayOn(live)?.node ?? '';
  if (!api || !claims) return null;

  const declared = claims.claims.find(c => c.epoch === epoch);
  const declare = async () => {
    setBusy(true); setErr(null);
    try {
      setClaims(await api.declareClaim(epoch, address.trim()));
      setAddress('');
      showToast({ icon: 'verified', title: 'Carteira do lote assinada', body: `${epoch} · ${shortAddress(address.trim())}. Baixe a declaração e leve ao validador.` });
    } catch (e) {
      if (e instanceof NeedsReauth) setStepUpOpen(true);
      else setErr(e instanceof ApiError ? e.message : 'Não foi possível assinar.');
    } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (looksLikeAddress(address) && epoch && !busy) void declare(); };
  const download = async (kind: 'evidence' | 'claims') => {
    try {
      if (kind === 'evidence') downloadText(`piu-evidencias-${node.slice(0, 8)}-${dayKeyOf(Date.now())}.json`, JSON.stringify(await api.evidence(), null, 2));
      else downloadText(`piu-carteira-${node.slice(0, 8)}.json`, JSON.stringify(await api.claimsFile(), null, 2));
    } catch (e) {
      showToast({ icon: 'error', title: 'Arquivo não gerado', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
    }
  };
  const label = (e: string, i: number) => `${i === 0 ? 'Esta semana' : 'Próxima'} · ${e}`;
  const okShape = looksLikeAddress(address);

  return (
    <section className="span12 card-line lot-wallet" style={{ borderRadius: 22, padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 22 }}>
      <form className="col" onSubmit={submit} style={{ gap: 12 }}>
        <div className="col" style={{ gap: 3 }}>
          <h2 className="h-card" style={{ margin: 0 }}>Carteira do lote</h2>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>Este nó assina qual carteira LUNES recebe o lote. O vínculo vale só para aquele lote, sem um histórico fixo entre o nó e a carteira.</div>
        </div>
        {claims.enabled ? (
          <>
            <Segmented variant="bg2" label="Lote" value={epoch} onChange={setEpoch} options={claims.epochs.map((e, i) => ({ value: e, label: label(e, i) }))} />
            <label className="col" style={{ gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Endereço LUNES</span>
              <input value={address} onChange={e => { setAddress(e.target.value.trim()); setErr(null); }} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="5… (formato SS58)"
                className="mono" aria-describedby="lot-msg" style={{ height: 44, borderRadius: 14, border: 'none', background: 'var(--bg2)', padding: '0 14px', fontSize: 13.5, color: 'var(--ink)', outline: 'none', minWidth: 0 }} />
            </label>
            <div id="lot-msg" aria-live="polite" style={{ fontSize: 12, lineHeight: 1.4, color: err ? 'var(--ink)' : 'var(--ink2)' }}>
              {err ?? (address && !okShape ? 'Confira o endereço: um endereço LUNES tem 47 ou 48 caracteres, sem 0, O, I nem l.'
                : declared ? `Já declarada para ${epoch}: ${shortAddress(declared.address)}. Declarar de novo troca a carteira aqui; se a declaração anterior já foi entregue ao validador, as duas se anulam e o lote não paga ninguém.`
                : 'O nó confere o endereço inteiro (soma de verificação) antes de assinar. Pede um código novo do equipamento.')}
            </div>
            <button type="submit" className="btn btn-primary" disabled={!okShape || busy} style={{ alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 19, fontSize: 13, opacity: okShape ? 1 : 0.4 }}>{busy ? 'Assinando…' : 'Assinar declaração'}</button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Retransmissão LNNP desligada neste nó: sem chave de nó para assinar.</div>
        )}
      </form>
      <div className="col" style={{ gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>Declaradas</div>
        {claims.claims.map(c => (
          <div key={c.epoch} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
            <Icon name="verified" size={16} fill={1} />
            <span style={{ fontWeight: 600 }}>{c.epoch}</span>
            <span className="mono ellipsis grow" style={{ fontSize: 12, color: 'var(--ink2)' }}>{shortAddress(c.address)}</span>
          </div>
        ))}
        {!claims.claims.length && <div style={{ fontSize: 12.5, color: 'var(--ink2)', padding: '8px 0', borderTop: '1px solid var(--line)' }}>Nenhuma ainda. Sem carteira declarada, o que o nó tiver para receber fica para o lote seguinte.</div>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.45 }}>Para levar ao validador: as evidências (recibos assinados por este nó e os que ele recebeu de vizinhos) e a declaração da carteira.</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => void download('evidence')} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13 }}>Baixar evidências · {fmtInt(receiptsCount)}</button>
          <button type="button" className="btn btn-outline" disabled={!claims.claims.length} onClick={() => void download('claims')} style={{ height: 36, padding: '0 14px', borderRadius: 18, fontSize: 13, opacity: claims.claims.length ? 1 : 0.4 }}>Baixar declaração</button>
        </div>
      </div>
      {stepUpOpen && (
        <StepUpDialog reason="Declarar a carteira que recebe o lote exige uma confirmação recente." confirmLabel="Confirmar e assinar" onClose={() => setStepUpOpen(false)}
          onConfirm={async code => { const p = await stepUp(code); if (p) return p; setStepUpOpen(false); await declare(); return null; }} />
      )}
    </section>
  );
}

