/**
 * Entrada (protótipo `isAuth`): coluna de texto à esquerda, palco à direita com órbitas.
 * Passos: start → qr (vínculo com o celular: QR real renovado a cada 30 s) → confirm (3 palavras) → app
 *        · create → work → app · phrase → work → app.
 * O trabalho real (gerar/derivar chaves, guardar no cofre) acontece junto com a animação de progresso.
 */
import { useEffect, useRef, useState } from 'react';
import type { IdentityKind, LinkState, SessionInfo } from '../../shared/types';
import icon192 from '../brand/icon-192.png';
import { F, FM, RealQr, Sym } from '../ui';

type Step = 'start' | 'qr' | 'confirm' | 'create' | 'phrase' | 'work';
type WorkKind = 'create' | 'restore';

export function Auth({ session, onEnter, toast }: { session: SessionInfo; onEnter: () => void; toast: (text: string, icon?: string) => void }) {
  const mac = session.platform === 'darwin';
  const keychain = mac ? 'Keychain do macOS' : session.platform === 'win32' ? 'cofre do Windows (DPAPI)' : 'chaveiro do sistema';
  const [step, setStepRaw] = useState<Step>('start');
  const [seq, setSeq] = useState(0);
  const [idType, setIdType] = useState<IdentityKind>('public');
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState<string[]>(Array(12).fill(''));
  const [link, setLink] = useState<LinkState>({ state: 'off' });
  const [qrLeft, setQrLeft] = useState(30);
  const [work, setWork] = useState<WorkKind>('create');
  const [workPct, setWorkPct] = useState(0);
  const [workDone, setWorkDone] = useState(false);
  const [workErr, setWorkErr] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const t = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const step_ = (s: Step) => { setStepRaw(s); setSeq(x => x + 1); };

  // Vínculo com o celular: o processo principal sobe o servidor e renova o QR; aqui só o estado.
  useEffect(() => window.piu.on('link', s => {
    setLink(s);
    if (s.state === 'confirm') step_('confirm');
    if (s.state === 'linked') onEnter();
    if (s.state === 'dropped') { toast(s.reason, 'phonelink_off'); step_('qr'); void window.piu.linkStart().then(setLink).catch(e => toast((e as Error).message, 'error')); }
  }), [onEnter, toast]);
  useEffect(() => {
    if (step !== 'qr' && step !== 'confirm') { if (link.state !== 'off') void window.piu.linkCancel().then(setLink).catch(() => {}); return; }
    if (step === 'qr' && (link.state === 'off' || link.state === 'dropped')) void window.piu.linkStart().then(setLink).catch(e => { toast((e as Error).message, 'error'); step_('start'); });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (link.state !== 'waiting') return;
    const tick = () => setQrLeft(Math.max(0, Math.ceil(((link as { expiresAt: number }).expiresAt - Date.now()) / 1000)));
    tick();
    const i = setInterval(tick, 250);
    return () => clearInterval(i);
  }, [link]);

  /** Progresso como no protótipo (1,6 % a cada 40 ms) enquanto o trabalho real roda; só entra no app com os dois prontos. */
  const startWork = (kind: WorkKind, job: Promise<unknown>) => {
    setWork(kind); setWorkPct(0); setWorkDone(false); setWorkErr(null); step_('work');
    let pct = 0, realDone = false, failed: string | null = null;
    job.then(() => { realDone = true; }, e => { failed = (e as Error).message; });
    const i = setInterval(() => {
      if (failed) { clearInterval(i); setWorkErr(failed); return; }
      pct = Math.min(100, pct + 1.6);
      if (pct >= 100 && !realDone) pct = 99; // segura em 99 % até o cofre responder
      setWorkPct(pct);
      if (pct >= 100) { clearInterval(i); t(() => setWorkDone(true), 150); t(() => onEnter(), 1700); }
    }, 40);
    timers.current.push(i as unknown as ReturnType<typeof setTimeout>);
  };

  const nameOk = idType === 'anon' || name.trim().length > 0;
  const filled = phrase.every(w => w.trim());
  const createId = () => { if (!nameOk || !session.vaultSecure) return; startWork('create', window.piu.createIdentity({ kind: idType, name })); };
  const restore = () => { if (!filled || !session.vaultSecure) return; startWork('restore', window.piu.restoreIdentity({ phrase: phrase.map(w => w.trim().toLowerCase()), name: '' })); };
  const fillPhrase = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
      if (words.length !== 12) { toast('A área de transferência não tem 12 palavras', 'content_paste_off'); return; }
      words.forEach((w, i) => t(() => setPhrase(p => p.map((x, j) => (j === i ? w : x))), i * 70));
    } catch { toast('Não foi possível ler a área de transferência', 'content_paste_off'); }
  };

  const workCopy = { create: ['GERANDO CHAVES', 'Criando sua identidade.', 'Tudo acontece neste computador. Nenhum dado é enviado.'], restore: ['RESTAURANDO', 'Reconstruindo suas chaves.', 'As mesmas identidades do celular. As conversas antigas ficam lá; aqui começa um histórico novo.'] }[work];
  const copy: Record<Step, string[]> = {
    start: ['PIU PARA ' + (mac ? 'MAC' : session.platform === 'win32' ? 'WINDOWS' : 'LINUX'), 'Suas conversas, agora no computador.', 'Conecte ao celular que você já usa ou crie uma identidade nova aqui mesmo. Sem conta, sem número de telefone, sem servidor.'],
    qr: ['CONECTAR AO CELULAR', 'Escaneie com o Piu no celular.', 'O computador espelha as conversas do celular pela rede local, cifrado de ponta a ponta. O celular continua dono das chaves.'],
    confirm: ['CONFIRMAÇÃO', 'Quase lá. Compare os códigos.', 'Isso garante que ninguém no meio do caminho está se passando pelo seu celular.'],
    create: ['NOVA IDENTIDADE', 'Comece do zero, só neste computador.', 'Escolha como quer aparecer. Dá para ter as duas identidades e trocar quando quiser.'],
    phrase: ['RESTAURAR', 'Digite suas 12 palavras.', 'A frase reconstrói suas chaves neste computador. As palavras nunca saem dele.'],
    work: workErr ? [workCopy[0]!, 'Não deu certo.', workErr] : workDone ? [workCopy[0]!, work === 'create' ? 'Pronto. Sua identidade existe.' : 'Pronto. Bem-vindo de volta.', workCopy[2]!] : workCopy,
  };
  const c = copy[step];
  const canBack = step !== 'start' && (step !== 'work' || !!workErr);
  const rows = { create: [['casino', 'Gerando entropia'], ['key', 'Par de chaves Ed25519'], ['enhanced_encryption', 'Guardando no ' + keychain], ['hub', 'Anunciando na malha local']], restore: [['spellcheck', 'Conferindo as palavras'], ['key', 'Derivando as chaves'], ['enhanced_encryption', 'Guardando no ' + keychain], ['hub', 'Anunciando na malha local']] }[work];
  const burst = Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2, r = 80 + (i % 3) * 22; return { x: Math.round(Math.cos(a) * r) + 'px', y: Math.round(Math.sin(a) * r) + 'px', d: (i % 4) * 0.03 + 's' }; });
  const startOpts: [string, string, string, Step][] = [
    ['qr_code_scanner', 'Conectar ao meu celular', 'Use a identidade que você já tem. Leva 20 segundos.', 'qr'],
    ['person_add', 'Criar nova identidade', 'Começa aqui, sem celular. Chaves geradas neste computador.', 'create'],
    ['key', 'Restaurar com frase', 'Use as 12 palavras do seu backup.', 'phrase'],
  ];
  const words = link.state === 'confirm' ? link.words : [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', animation: 'piuReveal .6s cubic-bezier(.2,.85,.3,1) both' }}>
      <div style={{ padding: '52px 64px 40px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {canBack && (
            <button className="h-bg2" onClick={() => { timers.current.forEach(clearTimeout); step_(step === 'work' ? (work === 'create' ? 'create' : 'phrase') : step === 'confirm' ? 'qr' : 'start'); if (step === 'confirm') void window.piu.linkCancel().then(setLink); }} aria-label="Voltar"
              style={{ width: 36, height: 36, marginLeft: -8, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .35s both' }}>
              <Sym name="arrow_back" size={20} />
            </button>
          )}
          <div style={{ fontSize: 34, fontWeight: 750, letterSpacing: '-0.07em', lineHeight: 1 }}>piu<span style={{ color: 'var(--ink3)' }}>.</span></div>
        </div>
        <div key={seq} style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `piuPg${seq % 2 ? 'A' : 'B'} .5s cubic-bezier(.2,.85,.3,1) both` }}>
          <div style={{ font: `500 12px ${FM}`, letterSpacing: '.06em', color: 'var(--ink2)' }}>{c[0]}</div>
          <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.02, textWrap: 'pretty' }}>{c[1]}</div>
          <div style={{ fontSize: 16, color: 'var(--ink2)', lineHeight: 1.45, maxWidth: 440, textWrap: 'pretty' }}>{c[2]}</div>
        </div>
        {step === 'qr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[['1', 'Abra o Piu no celular e vá em', 'Perfil → Aparelhos'], ['2', 'Toque em', 'Conectar computador'], ['3', 'Aponte a câmera para', 'este código']].map(([n, pre, b], i) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 15, animation: `piuUp .5s ${0.2 + i * 0.1}s both` }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${FM}`, flex: 'none' }}>{n}</div>
                <div>{pre} <b style={{ fontWeight: 650 }}>{b}</b></div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', background: 'var(--side)', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, animation: 'piuUp .5s .5s both' }}>
              <Sym name="info" size={18} style={{ color: 'var(--ink)' }} />O lado do celular está em desenvolvimento noutra frente; o protocolo do computador já está pronto e testado com um cliente de referência.
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 26, borderRadius: 13, background: session.vaultSecure ? 'var(--ink)' : 'var(--bg3)', position: 'relative', flex: 'none', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 3, left: session.vaultSecure ? 19 : 3, width: 20, height: 20, borderRadius: 10, background: session.vaultSecure ? 'var(--invink)' : '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,.15)', transition: 'left .3s cubic-bezier(.2,.9,.3,1.4)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Manter conectado neste computador</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{session.vaultSecure ? `Chaves guardadas no ${keychain}, cifradas.` : 'Cofre do sistema indisponível: a frase não pode ser guardada aqui.'}</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--side)', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: -320, top: -320, width: 640, height: 640, borderRadius: '50%', border: '1px solid var(--line2)' }} />
          <div style={{ position: 'absolute', left: -230, top: -230, width: 460, height: 460, borderRadius: '50%', border: '1px solid var(--line2)' }} />
          <div style={{ position: 'absolute', left: -320, top: -320, width: 640, height: 640, animation: 'piuSpin 60s linear infinite' }}>
            <div style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: 'var(--ink)', top: -5, left: 315 }} />
            <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ink)', bottom: 90, left: 40 }} />
          </div>
          <div style={{ position: 'absolute', left: -230, top: -230, width: 460, height: 460, animation: 'piuSpinR 40s linear infinite' }}>
            <div style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--ink)', top: 60, right: 40 }} />
            <div style={{ position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: 'var(--ink)', bottom: -3, left: 227 }} />
          </div>
        </div>

        {step === 'start' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {startOpts.map(([icon, title, desc, k], i) => {
              const disabled = k !== 'qr' && !session.vaultSecure;
              return (
                <button key={k} className="h-opt" onClick={() => { if (disabled) { toast('Cofre do sistema indisponível neste computador', 'lock'); return; } step_(k); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18, border: 'none', borderRadius: 20, background: i ? 'var(--bg)' : 'var(--ink)', color: i ? 'var(--ink)' : 'var(--invink)', cursor: 'pointer', textAlign: 'left', boxShadow: '0 0 0 1px var(--line2) inset', animation: `piuUp .55s ${0.15 + i * 0.09}s cubic-bezier(.2,.85,.3,1) both`, transition: 'transform .25s cubic-bezier(.2,.9,.3,1.4),box-shadow .25s', opacity: disabled ? .5 : 1 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: i ? 'var(--bg2)' : 'var(--invink)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={icon} size={25} wght={300} /></div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ font: `650 16px ${F}` }}>{title}</div>
                    <div style={{ font: `400 13px ${F}`, opacity: .72, lineHeight: 1.35 }}>{desc}</div>
                  </div>
                  <Sym name="arrow_forward" size={20} style={{ opacity: .6 }} />
                </button>
              );
            })}
          </div>
        )}

        {step === 'qr' && (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <div style={{ padding: 22, borderRadius: 28, background: '#fff', boxShadow: '0 0 0 1px var(--line2),0 30px 70px -24px rgba(0,0,0,.35)', position: 'relative', animation: 'piuPop .6s cubic-bezier(.2,.9,.3,1.25) both' }}>
              {link.state === 'waiting' ? <RealQr key={link.uri} text={link.uri} size={252} /> : <div style={{ width: 252, height: 252, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 12px ${FM}`, color: '#5f5f5c' }}>{link.state === 'dropped' ? 'reconectando…' : 'preparando o QR…'}</div>}
              <div style={{ position: 'absolute', left: 14, right: 14, top: 22, bottom: 22, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, background: '#0c0c0c', boxShadow: '0 0 18px 4px rgba(12,12,12,.25)', animation: 'piuScan 2.6s 1s ease-in-out infinite' }} />
              </div>
              <div style={{ position: 'absolute', left: '50%', top: '50%', margin: '-29px 0 0 -29px', width: 58, height: 58, borderRadius: 15, background: '#fff', padding: 5, animation: 'piuPop .5s .9s cubic-bezier(.2,.9,.3,1.5) both' }}>
                <img src={icon192} alt="" style={{ width: 48, height: 48, borderRadius: 11, display: 'block' }} />
              </div>
            </div>
            <div style={{ width: 296, display: 'flex', flexDirection: 'column', gap: 8, animation: 'piuUp .5s .6s both' }}>
              <div style={{ height: 3, borderRadius: 2, background: 'var(--bg3)', overflow: 'hidden' }}><div style={{ height: '100%', width: (qrLeft / 30 * 100) + '%', background: 'var(--ink)', transition: 'width 1s linear' }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 12px ${FM}`, color: 'var(--ink2)' }}><span>novo código em {qrLeft} s</span><span>{link.state === 'waiting' ? `Wi-Fi local · ${link.host}:${link.port}` : 'Wi-Fi local'}</span></div>
            </div>
            <div style={{ height: 38, padding: '0 16px', borderRadius: 19, border: '1px dashed var(--line2)', background: 'var(--side)', color: 'var(--ink2)', font: `550 13px ${F}`, display: 'flex', alignItems: 'center', gap: 7, animation: 'piuUp .5s .75s both' }}>
              <Sym name="qr_code_scanner" size={18} />Aguardando o celular ler o código
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div style={{ position: 'relative', width: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 96, height: 96 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 2.2s ease-out infinite' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--ink)', animation: 'piuRingS 2.2s 1.1s ease-out infinite' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .6s cubic-bezier(.2,.9,.3,1.4) both' }}><Sym name="smartphone" size={42} wght={300} /></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: 'piuUp .5s .15s both' }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em' }}>Um celular quer conectar</div>
              <div style={{ fontSize: 14, color: 'var(--ink2)' }}>Confira se o celular mostra o mesmo código</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {words.map((w, i) => <div key={i} style={{ height: 54, padding: '0 20px', borderRadius: 16, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', display: 'flex', alignItems: 'center', font: `600 19px ${FM}`, animation: `piuPop .5s ${0.25 + i * 0.1}s cubic-bezier(.2,.9,.3,1.5) both` }}>{w.toUpperCase()}</div>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', animation: 'piuUp .5s .55s both' }}>
              <button className="a-98" onClick={() => void window.piu.linkConfirm().then(setLink)} style={{ height: 50, border: 'none', borderRadius: 25, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: 'pointer' }}>Os códigos são iguais</button>
              <button onClick={() => { void window.piu.linkCancel().then(setLink); step_('qr'); }} style={{ height: 44, border: 'none', borderRadius: 22, background: 'transparent', color: 'var(--ink)', font: `550 14px ${F}`, cursor: 'pointer' }}>Não são iguais · cancelar</button>
            </div>
            {link.state === 'linked' && !link.synced && <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>confirmado aqui · aguardando as conversas do celular</div>}
          </div>
        )}

        {step === 'create' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
              {([['public', 'public', 'Pública', 'Nome e foto. Pessoas encontram você pelo código.'], ['anon', 'visibility_off', 'Anônima', 'Sem nome. Só um código derivado da chave.']] as [IdentityKind, string, string, string][]).map(([k, icon, title, desc], i) => (
                <button key={k} onClick={() => setIdType(k)} aria-pressed={idType === k}
                  style={{ padding: 16, border: 'none', borderRadius: 18, background: idType === k ? 'var(--ink)' : 'var(--bg)', color: idType === k ? 'var(--invink)' : 'var(--ink)', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 0 0 1px var(--line2) inset', transition: 'background .3s,color .3s,transform .3s cubic-bezier(.2,.9,.3,1.4)', transform: idType === k ? 'scale(1.02)' : 'none', animation: `piuUp .5s ${0.1 + i * 0.08}s both` }}>
                  <Sym name={icon} size={24} wght={300} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><div style={{ font: `650 15px ${F}` }}>{title}</div><div style={{ font: `400 12.5px ${F}`, opacity: .72, lineHeight: 1.35 }}>{desc}</div></div>
                </button>
              ))}
            </div>
            {idType === 'public' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'piuUp .4s both' }}>
                <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--ink2)' }}>Nome de exibição</div>
                <input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Como querem te chamar" autoFocus onKeyDown={e => { if (e.key === 'Enter') createId(); }}
                  style={{ height: 48, borderRadius: 14, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 16px', font: `550 16px ${F}`, color: 'var(--ink)', outline: 'none' }} />
              </div>
            ) : (
              <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', display: 'flex', flexDirection: 'column', gap: 4, animation: 'piuUp .4s both' }}>
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Seu nome será derivado da chave</div>
                <div style={{ font: `600 16px ${FM}` }}>Anônimo · ····</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line2)', background: 'var(--side)', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.45, animation: 'piuUp .5s .2s both' }}>
              <Sym name="key" size={18} style={{ color: 'var(--ink)' }} />As chaves nascem neste computador e não saem dele. A frase de recuperação fica em Ajustes → Backup.
            </div>
            <button className="a-98" onClick={createId} disabled={!nameOk} style={{ height: 52, border: 'none', borderRadius: 26, background: 'var(--ink)', color: 'var(--invink)', font: `600 15.5px ${F}`, cursor: 'pointer', opacity: nameOk ? 1 : .4, transition: 'opacity .2s', animation: 'piuUp .5s .28s both' }}>Gerar minhas chaves</button>
          </div>
        )}

        {step === 'work' && (
          <div style={{ position: 'relative', width: 430, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
            <div style={{ position: 'relative', width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--bg3)' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(var(--ink) ${workPct * 3.6}deg, transparent 0)`, WebkitMask: 'radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px))', mask: 'radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px))' }} />
              {!workDone && !workErr && <div style={{ font: `600 26px ${FM}`, fontVariantNumeric: 'tabular-nums' }}>{Math.round(workPct)}%</div>}
              {workErr && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="error" size={44} wght={300} /></div>}
              {workDone && (
                <>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s ease-out both' }} />
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--ink)', animation: 'piuRingL 1.2s .2s ease-out both' }} />
                  {burst.map((b, i) => <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, margin: -4, borderRadius: '50%', background: 'var(--ink)', ['--x' as string]: b.x, ['--y' as string]: b.y, animation: `piuBurst .9s ${b.d} cubic-bezier(.1,.8,.3,1) both` }} />)}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .55s cubic-bezier(.2,.9,.3,1.5) both' }}><Sym name="check" size={52} wght={500} /></div>
                </>
              )}
            </div>
            <div style={{ width: '100%', borderRadius: 20, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line) inset', overflow: 'hidden', animation: 'piuUp .5s .1s both' }}>
              {rows.map(([icon, label], i) => {
                const loc = Math.max(0, Math.min(100, (workPct - i * 25) * 4)); const done = loc >= 100, run = loc > 0 && !done;
                return (
                  <div key={label} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderTop: `1px solid ${i ? 'var(--line)' : 'transparent'}`, opacity: loc > 0 ? 1 : .45, transition: 'opacity .3s' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: done ? 'var(--ink)' : 'var(--bg2)', color: done ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'background .3s,color .3s' }}>
                      <Sym name={done ? 'check' : icon!} size={18} style={{ animation: done ? 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' : run ? 'piuBreath .9s ease-in-out infinite' : 'none' }} />
                    </div>
                    <div style={{ flex: 1, fontSize: 14.5, fontWeight: 550 }}>{label}</div>
                    <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{done ? 'pronto' : run ? Math.round(loc) + '%' : 'aguardando'}</div>
                    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: run ? loc + '%' : '0%', background: 'var(--ink)', opacity: .5 }} />
                  </div>
                );
              })}
            </div>
            <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{workErr ? 'volte e tente de novo' : workDone ? 'tudo certo · abrindo o Piu' : 'não feche esta janela'}</div>
          </div>
        )}

        {step === 'phrase' && (
          <div style={{ position: 'relative', width: 450, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
              {phrase.map((v, i) => (
                <div key={i} style={{ height: 42, borderRadius: 12, background: 'var(--bg)', boxShadow: v.trim() ? '0 0 0 1.5px var(--ink) inset' : '0 0 0 1px var(--line2) inset', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', animation: `piuUp .4s ${i * 0.03}s both`, transition: 'box-shadow .25s' }}>
                  <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)', width: 16 }}>{i + 1}</span>
                  <input value={v} aria-label={`Palavra ${i + 1}`} autoFocus={i === 0} spellCheck={false} autoCapitalize="off"
                    onChange={e => { const val = e.target.value; const parts = val.trim().split(/\s+/); if (parts.length > 1) { setPhrase(p => p.map((x, j) => (j >= i && j < i + parts.length ? parts[j - i]! : x))); } else setPhrase(p => p.map((x, j) => (j === i ? val : x))); }}
                    onKeyDown={e => { if (e.key === 'Enter') restore(); }}
                    style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, animation: 'piuUp .5s .5s both' }}>
              <button onClick={fillPhrase} style={{ height: 50, padding: '0 18px', border: 'none', borderRadius: 25, background: 'var(--bg3)', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><Sym name="content_paste" size={18} />Colar</button>
              <button className="a-98" onClick={restore} disabled={!filled} style={{ flex: 1, height: 50, border: 'none', borderRadius: 25, background: 'var(--ink)', color: 'var(--invink)', font: `600 15px ${F}`, cursor: 'pointer', opacity: filled ? 1 : .4, transition: 'opacity .2s' }}>Restaurar neste computador</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
