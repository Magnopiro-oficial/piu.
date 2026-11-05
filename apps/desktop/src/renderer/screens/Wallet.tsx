/**
 * Carteira (protótipo `isWalletNav`): cartão escuro com saldo em contagem animada (1,1 s, ease-out
 * quártico), esconder saldo, ações, movimentações e créditos de rede. Só leitura por enquanto:
 * o endereço Lunes é informado e o saldo vem da Mainnet; Enviar/Converter ficam "em breve".
 */
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import type { Prefs, WalletState } from '../../shared/types';
import { type DialogSpec, F, FM, Sym } from '../ui';

interface Props { prefs: Prefs; updatePrefs: (p: Partial<Prefs>) => Promise<void>; toast: (text: string, icon?: string) => void; setDialog: Dispatch<SetStateAction<DialogSpec | null>>; seq: number }

const fmt = (n: number) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** planck (texto, vindo da ponte) → LUNES como número, só para exibir (1 LUNES = 10^8 planck). */
const planckToNumber = (p: string | null) => (p ? Number(BigInt(p)) / 1e8 : 0);
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Wallet({ prefs, updatePrefs, toast, setDialog, seq }: Props) {
  const [w, setW] = useState<WalletState | null>(null);
  const [sheet, setSheet] = useState<'receive' | 'address' | null>(null);
  const [addr, setAddr] = useState(prefs.walletAddress ?? '');
  const [balT, setBalT] = useState<number | null>(null);
  const raf = useRef(0);
  const lastTarget = useRef<number | null>(null);
  useEffect(() => { void window.piu.wallet().then(setW); return window.piu.on('wallet', setW); }, []);
  useEffect(() => { setAddr(prefs.walletAddress ?? ''); if (!prefs.walletAddress) setSheet('address'); }, [prefs.walletAddress]);

  const hidden = w?.hidden ?? prefs.hideBalance;
  const target = planckToNumber(w?.free ?? null);
  /** Contagem do protótipo (`startBal`): 1100 ms, e = 1 − (1 − p)^4, a partir do valor anterior. */
  const startBal = (from: number) => {
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - start) / 1100), e = 1 - Math.pow(1 - p, 4); setBalT(from + (target - from) * e); if (p < 1) raf.current = requestAnimationFrame(tick); else setBalT(null); };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => { if (w?.status === 'ok' && lastTarget.current !== target) { startBal(lastTarget.current ?? 0); lastTarget.current = target; } }, [w?.status, target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (w?.status === 'ok') startBal(0); return () => cancelAnimationFrame(raf.current); }, [seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownN = balT == null ? target : balT;
  const bars = Array(7).fill(0);
  const saveAddr = async () => { try { await window.piu.setWalletAddress(addr.trim() || null); setSheet(null); toast(addr.trim() ? 'Endereço salvo · lendo a Mainnet' : 'Endereço removido', 'account_balance_wallet'); } catch (e) { toast((e as Error).message, 'error'); } };
  const status = !w?.address ? 'informe seu endereço Lunes' : w.status === 'loading' ? 'lendo na Mainnet…' : w.status === 'error' ? w.error ?? 'falha ao ler' : w.status === 'ok' ? `bloco #${w.block} · ${(w.endpoint ?? '').replace(/^wss?:\/\//, '')}` : 'sem leitura ainda';
  const actions: [string, string, () => void][] = [
    ['north_east', 'Enviar', () => toast('Enviar LUNES chega numa próxima versão', 'cloud_off')],
    ['south_west', 'Receber', () => setSheet(sheet === 'receive' ? null : 'receive')],
    ['swap_horiz', 'Converter', () => toast('Conversão disponível quando a malha alcançar a Mainnet', 'cloud_off')],
  ];
  void setDialog;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', scrollbarWidth: 'thin' }}>
      <div key={seq} style={{ maxWidth: 980, margin: '0 auto', padding: '30px 36px 40px', display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 20, alignItems: 'start', animation: `piuPg${seq % 2 ? 'A' : 'B'} .5s cubic-bezier(.2,.85,.3,1) both` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>Carteira</div>
            <button className="h-bg2" onClick={() => setSheet(sheet === 'address' ? null : 'address')} title="Trocar endereço" style={{ border: 'none', background: 'transparent', padding: '2px 6px', borderRadius: 6, cursor: 'pointer', font: `500 12px ${FM}`, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {prefs.walletAddress ? `lunes:${shortAddr(prefs.walletAddress)}` : 'sem endereço'}<Sym name="edit" size={13} />
            </button>
          </div>
          <div style={{ position: 'relative', overflow: 'hidden', padding: '24px 24px 20px', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 18, animation: 'piuDialog .6s .08s cubic-bezier(.2,.9,.3,1.15) both' }}>
            <div style={{ position: 'absolute', right: -90, top: -90, width: 260, height: 260, borderRadius: '50%', border: '1px solid rgba(127,127,127,.35)' }} />
            <div style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: '50%', border: '1px solid rgba(127,127,127,.35)' }} />
            <div style={{ position: 'absolute', right: -90, top: -90, width: 260, height: 260, animation: 'piuSpin 24s linear infinite' }}><div style={{ position: 'absolute', left: 40, bottom: 40, width: 9, height: 9, borderRadius: '50%', background: 'var(--invink)' }} /></div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ font: `500 11.5px ${FM}`, letterSpacing: '.06em', opacity: .7 }}>SALDO DISPONÍVEL</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="a-85" onClick={() => void window.piu.refreshWallet()} title="Atualizar" disabled={!w?.address || w.status === 'loading'} style={{ width: 34, height: 34, border: 'none', borderRadius: 17, background: 'rgba(127,127,127,.22)', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)', opacity: w?.address ? 1 : .4 }}><Sym name="refresh" size={18} style={{ animation: w?.status === 'loading' ? 'piuSpin 1s linear infinite' : 'none' }} /></button>
                <button className="a-85" onClick={() => { void updatePrefs({ hideBalance: !hidden }); if (hidden) startBal(0); }} title="Mostrar ou esconder" aria-label={hidden ? 'Mostrar saldo' : 'Esconder saldo'} style={{ width: 34, height: 34, border: 'none', borderRadius: 17, background: 'rgba(127,127,127,.22)', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name={hidden ? 'visibility_off' : 'visibility'} size={18} /></button>
              </div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{hidden ? '••••••' : w?.status === 'ok' || balT != null ? fmt(shownN) : '—'}</div>
              <div style={{ fontSize: 18, fontWeight: 600, opacity: .7 }}>LUNES</div>
            </div>
            <div style={{ position: 'relative', display: 'flex', gap: 14, fontSize: 13, opacity: .75 }}>
              <span>{status}</span>
              {w?.status === 'ok' && <span>{hidden ? '•••• reservado' : `${fmt(planckToNumber(w.reserved))} reservado`}</span>}
            </div>
            <div style={{ position: 'relative', display: 'flex', gap: 10 }}>
              {actions.map(([icon, label, go], i) => (
                <button key={label} className="a-95" onClick={go} style={{ flex: 1, height: 48, border: 'none', borderRadius: 24, background: sheet === 'receive' && label === 'Receber' ? 'var(--invink)' : 'rgba(127,127,127,.22)', color: sheet === 'receive' && label === 'Receber' ? 'var(--ink)' : 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, animation: `piuPop .5s ${0.35 + i * 0.07}s cubic-bezier(.2,.9,.3,1.5) both`, transition: 'background .25s,color .25s,transform .2s' }}>
                  <Sym name={icon} size={19} />{label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '4px 4px 8px', font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>MOVIMENTAÇÕES</div>
            <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>
              <div style={{ padding: '26px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.45, animation: 'piuUp .45s .3s cubic-bezier(.2,.85,.3,1) both' }}>
                Nenhuma movimentação ainda.<br /><span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>Histórico da Mainnet e créditos de retransmissão chegam numa próxima versão.</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, paddingTop: 52 }}>
          {sheet && (
            <div style={{ borderRadius: 24, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 24px 60px -30px rgba(0,0,0,.35)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, animation: 'piuSide .45s cubic-bezier(.2,.85,.3,1) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{sheet === 'receive' ? 'Receber LUNES' : 'Endereço Lunes'}</div>
                <button onClick={() => setSheet(null)} aria-label="Fechar" style={{ width: 30, height: 30, border: 'none', borderRadius: 15, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={17} /></button>
              </div>
              {sheet === 'receive' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  <div style={{ padding: 14, borderRadius: 20, background: 'var(--bg2)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, animation: 'piuPop .55s cubic-bezier(.2,.9,.3,1.25) both' }}>
                    <Sym name="qr_code_2" size={44} wght={300} style={{ color: 'var(--ink3)' }} />
                    <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>QR em breve · copie o endereço</div>
                  </div>
                  <div className="a-98 sel" onClick={() => { if (prefs.walletAddress) { void window.piu.copy(prefs.walletAddress); toast('Endereço copiado', 'content_copy'); } }} style={{ width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 12, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: `500 12px ${FM}`, cursor: 'pointer', wordBreak: 'break-all', textAlign: 'center' }}>
                    {prefs.walletAddress ?? 'sem endereço'}<Sym name="content_copy" size={16} />
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, textAlign: 'center', textWrap: 'pretty' }}>Transferências para este endereço aparecem no saldo depois de finalizadas na Mainnet.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={addr} onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveAddr(); }} placeholder="Endereço SS58 da Lunes (5…)" spellCheck={false} aria-label="Endereço Lunes"
                    style={{ height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `500 13px ${FM}`, color: 'var(--ink)', outline: 'none' }} />
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>A carteira derivada da sua frase ainda não assina nada no computador; por isso o endereço é informado por você. A leitura usa os nós públicos da Lunes e nada mais sai daqui.</div>
                  <button className="a-97" onClick={() => void saveAddr()} style={{ height: 46, border: 'none', borderRadius: 23, background: 'var(--ink)', color: 'var(--invink)', font: `600 14.5px ${F}`, cursor: 'pointer' }}>Salvar</button>
                </div>
              )}
            </div>
          )}
          <div style={{ borderRadius: 24, background: 'var(--bg2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .5s .2s cubic-bezier(.2,.85,.3,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 650 }}>Créditos de rede</div>
              <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>7 dias</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.04em' }}>{hidden ? '••••' : '0,00'}</div>
              <div style={{ fontSize: 13, color: 'var(--ink2)' }}>LUNES por retransmitir</div>
            </div>
            <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {bars.map((_, i) => (
                <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: '4%', borderRadius: 7, background: i === 6 ? 'var(--ink)' : 'var(--bg3)', transformOrigin: 'bottom', animation: `piuGrowY .7s ${0.35 + i * 0.06}s cubic-bezier(.2,.9,.3,1.2) both` }} />
                  <div style={{ font: `500 10.5px ${FM}`, color: 'var(--ink2)' }}>{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'][i]}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45 }}>{prefs.relay ? 'Este computador retransmite para a malha. Os créditos passam a contar quando o validador estiver ligado ao desktop.' : 'Retransmissão desligada. Ligue em Ajustes → Rede.'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
