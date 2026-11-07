/**
 * Carteira (protótipo `isWalletNav`): cartão escuro com saldo em contagem animada (1,1 s, ease-out
 * quártico), esconder saldo, ações, movimentações e créditos de rede. Os painéis Enviar/Receber seguem
 * design/handoff/docs/DESKTOP-CARTEIRA-ENVIAR-RECEBER.md com dados reais:
 * - o endereço é o informado ou, sem ele, o derivado da frase (o mesmo do celular; src/main/identity.ts);
 * - Enviar dispara o pedido real ao celular vinculado (ele assina e envia); o sucesso só aparece quando o
 *   celular devolve o hash, e o selo da linha é o estado real do pedido;
 * - Receber mostra o QR real do endereço (lib `qrcode`, correção H por causa do ícone no centro), no mesmo
 *   cartão do Auth (onda, linha de leitura, ícone) com as medidas do Receber do protótipo (QR 190, padding 14, raio 20);
 * - sem contato com endereço, o lugar dos avatares vira o campo "Para" (endereço digitado); com contatos, o campo
 *   só aparece quando "Outro" está selecionado.
 */
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopPayment, DesktopPaymentState } from '../../shared/paymentTypes';
import type { ContactInfo, Prefs, WalletState } from '../../shared/types';
import { t as tNow, useLang, useT } from '../i18n';
import { type DialogSpec, F, FM, fmtTime, motionOff, QrCard, Sym, useSecretScreen } from '../ui';
import { burstParticles, cleanLunesAddr, fmtLunes, headerLunesAddr, OTHER_ID, paymentSent, planckToNumber, recipientsFrom, sanitizeAmount, sendModel, shortLunesAddr, statusBadge, statusTitle } from '../walletSend';

/** Pedido vindo do botão "Enviar LUNES" de uma conversa: abre Enviar com o contato pré-selecionado (se tiver endereço). */
export interface PayIntent { contactId: string | null; seq: number }

interface Props {
  prefs: Prefs; updatePrefs: (p: Partial<Prefs>) => Promise<void>; toast: (text: string, icon?: string) => void; setDialog: Dispatch<SetStateAction<DialogSpec | null>>; seq: number;
  /** Celular vinculado e sincronizado: só assim há quem assine o envio. */
  linked: boolean;
  payIntent?: PayIntent | null;
}

const BURST = burstParticles();
const ACTIVE = (p: DesktopPayment) => !['finalized', 'failed', 'cancelled'].includes(p.status);
/** Pílula do endereço do Receber no protótipo (largura total, 42px, raio 12, bg2, Geist Mono 500 13px). */
/** Iniciais dos dias (seg → dom) sob as barras dos créditos de rede. */
const DAYS = ['wallet.credits.day.mon', 'wallet.credits.day.tue', 'wallet.credits.day.wed', 'wallet.credits.day.thu', 'wallet.credits.day.fri', 'wallet.credits.day.sat', 'wallet.credits.day.sun'] as const;
const PILL = { width: '100%', height: 42, border: 'none', borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: `500 13px ${FM}` } as const;

/**
 * Campo do destinatário digitado ("Outro"), no visual da pílula de endereço do Receber. Fora de foco e com um
 * endereço válido, mostra `lunes:XXXXXXXX…XXXXXXXX` + lápis (como o Receber mostra o próprio endereço); editando,
 * mostra o endereço inteiro a 11px (os 48 caracteres SS58 cabem na largura do painel).
 */
function AddressField({ value, onChange, valid, autoFocus }: { value: string; onChange: (v: string) => void; valid: boolean; autoFocus?: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const addr = cleanLunesAddr(value);
  if (!editing && valid && addr) {
    return (
      <button className="a-98" onClick={() => setEditing(true)} title={addr} aria-label={t('wallet.send.destAria')} style={{ ...PILL, cursor: 'pointer', transition: 'transform .2s' }}>
        lunes:{shortLunesAddr(addr)}<Sym name="edit" size={16} />
      </button>
    );
  }
  return (
    <input ref={input} className="addr-in" autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}
      placeholder={t('wallet.send.destPh')} aria-label={t('wallet.send.destAria')} spellCheck={false}
      style={{ ...PILL, padding: '0 10px', font: `500 11px ${FM}`, letterSpacing: '-0.01em', textAlign: 'center', outline: 'none' }} />
  );
}

export function Wallet({ prefs, updatePrefs, toast, setDialog, seq, linked, payIntent }: Props) {
  // Saldo, endereço e QR do Receber: sem captura de tela enquanto a Carteira estiver aberta (M-02).
  useSecretScreen('wallet', true);
  const t = useT();
  const lang = useLang();
  const [w, setW] = useState<WalletState | null>(null);
  const [sheet, setSheet] = useState<'receive' | 'address' | 'send' | null>(null);
  const [payment, setPayment] = useState<DesktopPaymentState>(() => ({ state: 'blocked', reason: tNow('wallet.block.checking') }));
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  // Enviar: destinatário escolhido (null = o primeiro da lista), endereço digitado em "Outro", valor (inicial "5", como no design).
  const [chosen, setTo] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Id do pedido criado por este painel; o sucesso/espera só valem para ele (um pedido antigo no diário não vira "Enviado"). */
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [addr, setAddr] = useState(prefs.walletAddress ?? '');
  const [balT, setBalT] = useState<number | null>(null);
  const raf = useRef(0);
  const lastTarget = useRef<number | null>(null);
  useEffect(() => { void window.piu.wallet().then(setW); return window.piu.on('wallet', setW); }, []);
  useEffect(() => { void window.piu.walletPayment().then(setPayment); return window.piu.on('walletPayment', setPayment); }, []);
  useEffect(() => {
    const load = () => { void window.piu.listConversations().then(l => setContacts(l.map(c => c.contact))).catch(() => {}); };
    load(); return window.piu.on('conversations', load);
  }, []);
  useEffect(() => { setAddr(prefs.walletAddress ?? ''); }, [prefs.walletAddress]);
  // Só sem endereço nenhum (nem informado, nem derivado da frase) a pessoa precisa digitar um.
  useEffect(() => { if (w && !w.address && !sheet) setSheet('address'); }, [w?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const hidden = w?.hidden ?? prefs.hideBalance;
  const target = planckToNumber(w?.free ?? null);
  /** Saldo só conta como conhecido depois de uma leitura boa da Mainnet; antes disso Enviar não compara nem envia. */
  const balanceKnown = w?.status === 'ok' && w.free != null;
  /** Contagem do protótipo (`startBal`): 1100 ms, e = 1 − (1 − p)^4, a partir do valor anterior. Com animações desligadas vai direto ao valor. */
  const startBal = (from: number) => {
    cancelAnimationFrame(raf.current);
    if (motionOff()) { setBalT(null); return; }
    const start = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - start) / 1100), e = 1 - Math.pow(1 - p, 4); setBalT(from + (target - from) * e); if (p < 1) raf.current = requestAnimationFrame(tick); else setBalT(null); };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => { if (w?.status === 'ok' && lastTarget.current !== target) { startBal(lastTarget.current ?? 0); lastTarget.current = target; } }, [w?.status, target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (w?.status === 'ok') startBal(0); return () => cancelAnimationFrame(raf.current); }, [seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // `lang` nas dependências: o rótulo de "Outro" acompanha a troca de idioma.
  const recipients = useMemo(() => recipientsFrom(contacts, chosen), [contacts, chosen, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Algum contato compartilhou endereço? Sem nenhum, o lugar dos avatares vira o campo "Para". */
  const hasContacts = recipients.length > 1;
  // Pré-seleção: o contato da conversa (botão de pagar), senão o primeiro com endereço, senão "Outro".
  const to = chosen && recipients.some(r => r.id === chosen) ? chosen : recipients[0]!.id;
  useEffect(() => {
    if (!payIntent) return;
    setSheet('send'); setRequestedId(null); setSubmitError(null); setTo(payIntent.contactId);
  }, [payIntent?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = payment.state === 'payment' ? payment.payment : null;
  const activePayment = !!current && ACTIVE(current);
  const model = sendModel({ recipients, to, other, amount, balance: balanceKnown ? target : null, hidden });
  const mine = current && requestedId && current.id === requestedId ? current : null;
  /** O que o painel Enviar mostra: formulário, espera pelo celular ou sucesso (só com hash devolvido pelo celular). */
  const sendView: 'form' | 'pending' | 'done' = mine ? (paymentSent(mine.status) ? 'done' : ACTIVE(mine) ? 'pending' : 'form') : 'form';
  // Quando a Mainnet inclui o envio, relê o saldo: a contagem (prev → novo) sai da leitura real, não de uma subtração local.
  useEffect(() => { if (mine && (mine.status === 'included' || mine.status === 'finalized')) void window.piu.refreshWallet(); }, [mine?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pedido que acabou mal (recusado no celular, falha na rede, estado incerto): o painel volta ao formulário com o motivo.
  useEffect(() => { if (mine && !ACTIVE(mine) && !paymentSent(mine.status)) { setSubmitError(mine.error ?? statusTitle(mine.status)); setRequestedId(null); } }, [mine?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocker = !w?.address ? t('wallet.block.noAddress')
    : !linked ? t('wallet.block.notLinked')
    : !balanceKnown ? (w.status === 'error' ? t('wallet.block.readFailed', { error: w.error ?? t('wallet.readFailed') }) : t('wallet.block.reading'))
    : payment.state === 'blocked' ? payment.reason
    : activePayment ? t('wallet.block.pending')
    : null;
  const canSend = model.ok && !blocker && !busy;
  const notice = model.error ?? model.destError ?? submitError ?? blocker;
  const nameOfDest = (dest: string) => recipients.find(r => r.address === dest)?.name ?? shortLunesAddr(dest);

  const shownN = balT == null ? target : balT;
  const bars = Array(7).fill(0);
  const saveAddr = async () => { try { await window.piu.setWalletAddress(addr.trim() || null); setSheet(null); toast(addr.trim() ? t('wallet.toast.addrSaved') : t('wallet.toast.addrRemoved'), 'account_balance_wallet'); } catch (e) { toast((e as Error).message, 'error'); } };
  const submit = async () => {
    if (!canSend || !model.dest) return;
    setBusy(true); setSubmitError(null);
    try {
      const st = await window.piu.requestWalletPayment({ dest: model.dest, amount: amount.trim() });
      setPayment(st);
      if (st.state === 'payment') setRequestedId(st.payment.id); else if (st.state === 'blocked') setSubmitError(st.reason);
    } catch (e) { setSubmitError((e as Error).message); } finally { setBusy(false); }
  };
  const copyAddr = () => { if (w?.address) { void window.piu.copy(w.address); toast(t('wallet.toast.addrCopied'), 'content_copy'); } };
  const status = !w?.address ? t('wallet.status.noAddress') : w.status === 'loading' ? t('wallet.status.loading') : w.status === 'error' ? t('wallet.status.error', { error: w.error ?? t('wallet.readFailed') }) : w.status === 'ok' ? t('wallet.status.ok', { block: String(w.block), endpoint: (w.endpoint ?? '').replace(/^wss?:\/\//, '') }) : t('wallet.status.none');
  const actions: [string, string, () => void][] = [
    // Como `go` do protótipo: abre (não alterna) o painel; Enviar volta ao formulário (`sendDone: false`), exceto
    // com um pedido ainda no celular, que continua à vista até o fim.
    ['north_east', t('wallet.action.send'), () => { setSheet('send'); if (!(mine && ACTIVE(mine))) setRequestedId(null); setSubmitError(null); }],
    ['south_west', t('wallet.action.receive'), () => setSheet('receive')],
    // Converter: só o aviso do design; não há conversão na Mainnet ainda.
    ['swap_horiz', t('wallet.action.convert'), () => toast(t('wallet.toast.convert'), 'cloud_off')],
  ];
  const activeAction = sheet === 'send' ? t('wallet.action.send') : sheet === 'receive' ? t('wallet.action.receive') : null;
  const title = sheet === 'receive' ? t('wallet.sheet.receive') : sheet === 'send' ? (sendView === 'done' ? t('wallet.sheet.sent') : t('wallet.sheet.send')) : t('wallet.sheet.address');
  void setDialog;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div key={seq} style={{ maxWidth: 980, margin: '0 auto', padding: '30px 36px 40px', display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 20, alignItems: 'start', animation: `piuPg${seq % 2 ? 'A' : 'B'} .5s cubic-bezier(.2,.85,.3,1) both` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('wallet.title')}</div>
            {/* Como no protótipo: só `lunes:7f3a…c19e` em Geist Mono 12px. Clicável (trocar endereço) sem ícone; o recuo
                negativo compensa o padding do realce de hover, para o texto terminar na borda da coluna como no design. */}
            <button className="h-bg2" onClick={() => setSheet(sheet === 'address' ? null : 'address')} title={`${w?.address ?? ''}${w?.address ? '\n' : ''}${w?.source === 'phrase' ? t('wallet.header.fromPhrase') : w?.source === 'phone' ? t('wallet.header.fromPhone') : t('wallet.header.change')}`} style={{ border: 'none', background: 'transparent', padding: '2px 6px', margin: '-2px -6px', borderRadius: 6, cursor: 'pointer', font: `500 12px ${FM}`, color: 'var(--ink2)' }}>
              {w?.address ? headerLunesAddr(w.address) : t('wallet.header.noAddress')}
            </button>
          </div>
          <div style={{ position: 'relative', overflow: 'hidden', padding: '24px 24px 20px', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 18, animation: 'piuDialog .6s .08s cubic-bezier(.2,.9,.3,1.15) both' }}>
            <div style={{ position: 'absolute', right: -90, top: -90, width: 260, height: 260, borderRadius: '50%', border: '1px solid rgba(127,127,127,.35)' }} />
            <div style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: '50%', border: '1px solid rgba(127,127,127,.35)' }} />
            <div style={{ position: 'absolute', right: -90, top: -90, width: 260, height: 260, animation: 'piuSpin 24s linear infinite' }}><div style={{ position: 'absolute', left: 40, bottom: 40, width: 9, height: 9, borderRadius: '50%', background: 'var(--invink)' }} /></div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ font: `500 11.5px ${FM}`, letterSpacing: '.06em', opacity: .7 }}>{t('wallet.balance.label')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* O protótipo só tem o olho. O saldo é relido sozinho (a cada 60 s e após cada envio); "tentar de novo"
                    só aparece quando a leitura falhou, no mesmo formato do olho. */}
                {w?.status === 'error' && <button className="a-85" onClick={() => void window.piu.refreshWallet()} title={t('wallet.balance.retryTitle')} aria-label={t('wallet.balance.retryAria')} style={{ width: 34, height: 34, border: 'none', borderRadius: 17, background: 'rgba(127,127,127,.22)', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)', animation: 'piuPop .45s cubic-bezier(.2,.9,.3,1.5) both' }}><Sym name="refresh" size={18} /></button>}
                <button className="a-85" onClick={() => { void updatePrefs({ hideBalance: !hidden }); if (hidden) startBal(0); }} title={t('wallet.balance.toggleTitle')} aria-label={hidden ? t('wallet.balance.show') : t('wallet.balance.hide')} style={{ width: 34, height: 34, border: 'none', borderRadius: 17, background: 'rgba(127,127,127,.22)', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name={hidden ? 'visibility_off' : 'visibility'} size={18} /></button>
              </div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              {/* Sem leitura boa ainda: "—" no lugar do número (pulsando enquanto lê), nunca um saldo inventado. */}
              <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', animation: !hidden && w?.status === 'loading' && balT == null && w.free == null ? 'piuBreath 1.2s infinite' : 'none' }}>{hidden ? '••••••' : w?.status === 'ok' || balT != null ? fmtLunes(shownN) : '—'}</div>
              <div style={{ fontSize: 18, fontWeight: 600, opacity: .7 }}>LUNES</div>
            </div>
            <div style={{ position: 'relative', display: 'flex', gap: 14, fontSize: 13, opacity: .75 }}>
              <span>{status}</span>
              {w?.status === 'ok' && <span>{t('wallet.balance.reserved', { amount: hidden ? '••••' : fmtLunes(planckToNumber(w.reserved)) })}</span>}
            </div>
            <div style={{ position: 'relative', display: 'flex', gap: 10 }}>
              {actions.map(([icon, label, go], i) => (
                <button key={label} className="a-95" onClick={go} aria-pressed={activeAction === label} style={{ flex: 1, height: 48, border: 'none', borderRadius: 24, background: activeAction === label ? 'var(--invink)' : 'rgba(127,127,127,.22)', color: activeAction === label ? 'var(--ink)' : 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, animation: `piuPop .5s ${0.35 + i * 0.07}s cubic-bezier(.2,.9,.3,1.5) both`, transition: 'background .25s,color .25s,transform .2s' }}>
                  <Sym name={icon} size={19} />{label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '4px 4px 8px', font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{t('wallet.moves.title')}</div>
            <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>
              {/* Só o pedido real do diário local (um por vez); o histórico da Mainnet ainda não é lido. Linha e selo no estilo do protótipo, com o estado verdadeiro. */}
              {current && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', animation: mine ? 'piuMsgIn .45s cubic-bezier(.2,.9,.3,1.3) both' : 'piuUp .45s .3s cubic-bezier(.2,.85,.3,1) both' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name="north_east" size={19} /></div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('wallet.moves.sentTo', { name: nameOfDest(current.dest) })}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{mine && ACTIVE(current) ? t('common.now') : fmtTime(Math.floor(current.createdAt / 1000))}{current.hash ? ` · ${current.hash.slice(0, 10)}…` : ''}</div>
                  </div>
                  {statusBadge(current.status) && (
                    <div style={{ height: 22, padding: '0 8px', borderRadius: 11, border: '1px solid var(--line2)', font: `500 11px ${FM}`, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink)', animation: ACTIVE(current) ? 'piuBreath 1.2s infinite' : 'none' }} />{statusBadge(current.status)}
                    </div>
                  )}
                  <div style={{ font: `600 14.5px ${F}`, fontVariantNumeric: 'tabular-nums', color: 'var(--ink2)' }}>−{fmtLunes(parseFloat(current.amount.replace(',', '.')))}</div>
                </div>
              )}
              <div style={{ padding: current ? '12px 16px 16px' : '26px 16px', borderTop: current ? '1px solid var(--line)' : 'none', textAlign: 'center', fontSize: current ? 12.5 : 13.5, color: current ? 'var(--ink3)' : 'var(--ink2)', lineHeight: 1.45, animation: 'piuUp .45s .3s cubic-bezier(.2,.85,.3,1) both' }}>
                {current ? t('wallet.moves.noHistory') : <>{t('wallet.moves.empty')}<br /><span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>{t('wallet.moves.noHistory')}</span></>}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, paddingTop: 52 }}>
          {sheet && (
            <div style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 24px 60px -30px rgba(0,0,0,.35)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, animation: 'piuSide .45s cubic-bezier(.2,.85,.3,1) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
                <button onClick={() => setSheet(null)} aria-label={t('common.close')} style={{ width: 30, height: 30, border: 'none', borderRadius: 15, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={17} /></button>
              </div>

              {sheet === 'receive' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  {w?.address ? (
                    <>
                      {/* O MESMO cartão do QR da entrada (ui.tsx → QrCard): cartão sempre branco, onda do centro, linha de leitura,
                          ícone do Piu no meio. Codifica o endereço puro (igual ao QR do celular); correção H por causa do ícone. */}
                      <QrCard text={w.address} level="H" label={t('wallet.receive.qrLabel')} variant="wallet" />
                      <button className="a-98" onClick={copyAddr} title={w.address} style={{ ...PILL, cursor: 'pointer', transition: 'transform .2s' }}>
                        lunes:{shortLunesAddr(w.address)}<Sym name="content_copy" size={16} />
                      </button>
                      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, textAlign: 'center', textWrap: 'pretty' }}>{t('wallet.receive.note')}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, textAlign: 'center' }}>{t('wallet.receive.noAddress')}</div>
                  )}
                </div>
              )}

              {sheet === 'send' && sendView === 'form' && (
                <>
                  {hasContacts ? (
                    // 4 lugares do protótipo (flex:1 com gap 12 → cada um ¼ da linha); com menos contatos, os lugares ficam do mesmo tamanho e centrados.
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                      {recipients.map((r, i) => (
                        // A animação de entrada fica no botão e a escala da seleção no círculo: `both` segura o último quadro e, no mesmo elemento, apagaria o scale(1.08).
                        <button key={r.id} onClick={() => setTo(r.id)} aria-pressed={to === r.id} title={r.address ?? t('wallet.send.typeAddress')} style={{ flex: '0 0 calc((100% - 36px) / 4)', minWidth: 0, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 0, animation: `piuPop .45s ${0.1 + i * 0.05}s cubic-bezier(.2,.9,.3,1.5) both` }}>
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: to === r.id ? 'var(--ink)' : 'var(--bg3)', color: to === r.id ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 14px ${F}`, transform: to === r.id ? 'scale(1.08)' : 'none', transition: 'background .25s,color .25s,transform .3s cubic-bezier(.2,.9,.3,1.5)' }}>
                            {r.id === OTHER_ID ? <Sym name="more_horiz" size={22} /> : r.ini}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 550, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.first}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    // Nenhum contato compartilhou endereço: no lugar (e na altura) da linha de avatares, o campo "Para" e uma linha explicando de onde vêm os avatares.
                    <div style={{ minHeight: 68, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, animation: 'piuUp .45s .1s cubic-bezier(.2,.85,.3,1) both' }}>
                      <AddressField value={other} onChange={setOther} valid={!!model.dest} />
                      <div style={{ fontSize: 12, color: 'var(--ink2)', textAlign: 'center', lineHeight: 1.35 }}>{t('wallet.send.contactsHint')}</div>
                    </div>
                  )}
                  {hasContacts && to === OTHER_ID && (
                    <div style={{ animation: 'piuUp .3s cubic-bezier(.2,.85,.3,1) both' }}><AddressField value={other} onChange={setOther} valid={!!model.dest} autoFocus={!other} /></div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, padding: '10px 0 2px' }}>
                    <input value={amount} onChange={e => setAmount(sanitizeAmount(e.target.value))} aria-label={t('wallet.send.amountAria')} inputMode="decimal"
                      style={{ width: 150, border: 'none', background: 'transparent', outline: 'none', textAlign: 'right', font: `700 48px ${F}`, letterSpacing: '-0.05em', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', padding: 0 }} />
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink2)' }}>LUNES</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {model.quick.map(q => (
                      <button key={q.n} className="a-92" onClick={() => setAmount(String(q.n))} aria-pressed={q.active} style={{ height: 30, minWidth: 48, padding: '0 12px', border: 'none', borderRadius: 15, background: q.active ? 'var(--ink)' : 'var(--bg2)', color: q.active ? 'var(--invink)' : 'var(--ink)', font: `600 13px ${F}`, cursor: 'pointer', transition: 'background .2s,color .2s,transform .2s' }}>{q.n}</button>
                    ))}
                  </div>
                  <div style={{ borderRadius: 16, background: 'var(--bg2)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 14px', padding: '13px 15px', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink2)' }}>{t('wallet.send.to')}</span><span style={{ textAlign: 'right', fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.toLabel}</span>
                    <span style={{ color: 'var(--ink2)' }}>{t('wallet.send.available')}</span><span style={{ textAlign: 'right', fontWeight: 550, fontVariantNumeric: 'tabular-nums' }}>{model.availableText}</span>
                    <span style={{ color: 'var(--ink2)' }}>{t('wallet.send.fee')}</span><span style={{ textAlign: 'right', fontWeight: 550 }}>{model.fee}</span>
                    <span style={{ color: 'var(--ink2)' }}>{t('wallet.send.settlement')}</span><span style={{ textAlign: 'right', fontWeight: 550 }}>{t('wallet.send.settlementValue')}</span>
                  </div>
                  {notice && <div role="alert" style={{ fontSize: 12.5, fontWeight: 550, textAlign: 'center', lineHeight: 1.4, animation: 'piuUp .3s both' }}>{notice}</div>}
                  <button className="a-97" onClick={() => void submit()} aria-disabled={!canSend} style={{ height: 50, border: 'none', borderRadius: 25, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.35, transition: 'opacity .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Sym name="north_east" size={19} />{busy ? t('wallet.send.sending') : t('wallet.send.now')}
                  </button>
                </>
              )}

              {sheet === 'send' && sendView === 'pending' && mine && (
                // Estado que o protótipo não tem: o pedido saiu para o celular e ainda não voltou assinado. Mesma composição do sucesso, sem a explosão.
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0 4px', textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: 96, height: 96 }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--bg2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .55s cubic-bezier(.2,.9,.3,1.5) both' }}><Sym name="smartphone" size={44} wght={300} /></div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, animation: 'piuUp .4s .2s both' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{statusTitle(mine.status)}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('wallet.pending.desc', { amount: fmtLunes(parseFloat(mine.amount.replace(',', '.'))), name: nameOfDest(mine.dest) })}</div>
                  </div>
                </div>
              )}

              {sheet === 'send' && sendView === 'done' && mine && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0 4px', textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: 96, height: 96 }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s ease-out both' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s .2s ease-out both' }} />
                    {BURST.map((b, i) => <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, margin: -4, borderRadius: '50%', background: 'var(--ink)', ['--x' as string]: b.x, ['--y' as string]: b.y, animation: `piuBurst .9s ${b.delay} cubic-bezier(.1,.8,.3,1) both` }} />)}
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .55s cubic-bezier(.2,.9,.3,1.5) both' }}><Sym name="north_east" size={44} /></div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, animation: 'piuUp .4s .2s both' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('wallet.sentTo', { amount: fmtLunes(parseFloat(mine.amount.replace(',', '.'))), name: nameOfDest(mine.dest) })}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4 }}>
                      {mine.status === 'finalized' ? t('wallet.done.finalized') : mine.status === 'included' ? t('wallet.done.included') : t('wallet.done.submitted')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, width: '100%', animation: 'piuUp .4s .3s both' }}>
                    <button className="a-97" onClick={() => setRequestedId(null)} style={{ flex: 1, height: 44, border: 'none', borderRadius: 22, background: 'var(--bg2)', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer' }}>{t('wallet.send.another')}</button>
                    <button className="a-97" onClick={() => { setRequestedId(null); setSheet(null); }} style={{ flex: 1, height: 44, border: 'none', borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' }}>{t('common.done')}</button>
                  </div>
                </div>
              )}

              {sheet === 'address' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={addr} onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveAddr(); }} placeholder={t('wallet.address.ph')} spellCheck={false} aria-label={t('wallet.sheet.address')}
                    style={{ height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `500 13px ${FM}`, color: 'var(--ink)', outline: 'none' }} />
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>
                    {w?.source === 'manual'
                      ? t('wallet.address.manual')
                      : w?.source === 'phone'
                        ? t('wallet.address.phone')
                        : w?.source === 'phrase'
                          ? t('wallet.address.phrase')
                          : t('wallet.address.none')}
                    {' '}{t('wallet.address.readOnly')}
                  </div>
                  <button className="a-97" onClick={() => void saveAddr()} style={{ height: 46, border: 'none', borderRadius: 23, background: 'var(--ink)', color: 'var(--invink)', font: `600 14.5px ${F}`, cursor: 'pointer' }}>{t('common.save')}</button>
                </div>
              )}
            </div>
          )}
          <div style={{ borderRadius: 24, background: 'var(--bg2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .5s .2s cubic-bezier(.2,.85,.3,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 650 }}>{t('wallet.credits.title')}</div>
              <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{t('wallet.credits.period')}</div>
            </div>
            {/* Sem validador na Mainnet (chave do validador: infraestrutura externa) não há créditos: "—" no lugar do
                número (nada de valor fixo falso), o motivo embaixo e as 7 barras do protótipo como trilha vazia. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink2)' }}>—</div>
              <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{t('wallet.credits.unit')}</div>
            </div>
            <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', gap: 8 }} aria-hidden="true">
              {bars.map((_, i) => (
                <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: '4%', borderRadius: 7, background: 'var(--bg3)', transformOrigin: 'bottom', animation: `piuGrowY .7s ${0.35 + i * 0.06}s cubic-bezier(.2,.9,.3,1.2) both` }} />
                  <div style={{ font: `500 10.5px ${FM}`, color: 'var(--ink2)' }}>{t(DAYS[i]!)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{prefs.relay ? t('wallet.credits.relayOn') : t('wallet.credits.relayOff')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
