// Demonstração do Piu Desktop na seção #desktop do site (janela 1280×820, escalada pelo CSS).
// Recria a tela de Conversas de Piu Desktop.dc.html (barra de janela por sistema, trilho, lista e conversa).
// O sistema mostrado acompanha a aba escolhida na página: o script de SitePage grava
// `document.documentElement.dataset.piuDesktopOs` e dispara o evento `piu-desktop-os`.
// O conteúdo fica em português, como o app.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FLOW, KIND_ICON, SEED, STATUS_ICON, STATUS_LABEL, type Chat, type Status } from './demoData';

export type DemoOs = 'mac' | 'linux' | 'win';
const OSES: DemoOs[] = ['mac', 'linux', 'win'];
const FILTERS: [string, string][] = [['all', 'Todas'], ['direct', 'Pessoas'], ['group', 'Grupos'], ['channel', 'Canais']];

const Ic = ({ n, s, style }: { n: string; s: number; style?: CSSProperties }) => <span className="ic" aria-hidden="true" style={{ fontSize: s, ...style }}>{n}</span>;
const av = (c: Chat): CSSProperties => ({ borderRadius: c.kind === 'direct' ? '50%' : 17, background: c.inv ? 'var(--ink)' : 'var(--bg3)', color: c.inv ? 'var(--invink)' : 'var(--ink)' });
const btnReset: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', padding: 0, font: 'inherit', letterSpacing: 'inherit' };
const readOs = (): DemoOs => {
  const v = typeof document !== 'undefined' ? document.documentElement.dataset.piuDesktopOs : undefined;
  return OSES.includes(v as DemoOs) ? (v as DemoOs) : 'mac';
};

/** Barra de janela de cada sistema, como no protótipo (macOS 40px com semáforo; Linux 46px; Windows 36px com botões de legenda). */
function TitleBar({ os, title }: { os: DemoOs; title: string }) {
  const base: CSSProperties = { flex: 'none', display: 'flex', alignItems: 'center', background: 'var(--side)', borderBottom: '1px solid var(--line)', position: 'relative', zIndex: 3 };
  const center: CSSProperties = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' };
  const icon = <img src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/icon-192.png`} alt="" width={20} height={20} style={{ borderRadius: 5, display: 'block' }} />;
  if (os === 'mac') return (
    <div style={{ ...base, height: 40, padding: '0 14px' }}>
      <div style={{ display: 'flex', gap: 8 }}>{['#ff5f57', '#febc2e', '#28c840'].map(c => <div key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}</div>
      <div style={{ ...center, fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>{title}</div>
    </div>
  );
  if (os === 'linux') return (
    <div style={{ ...base, height: 46, justifyContent: 'space-between', padding: '0 10px 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>{icon}Piu</div>
      <div style={{ ...center, fontSize: 13.5, fontWeight: 650 }}>{title}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[['remove', 15], ['crop_square', 13], ['close', 15]].map(([n, s]) => <div key={n} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n={n as string} s={s as number} /></div>)}
      </div>
    </div>
  );
  return (
    <div style={{ ...base, height: 36, justifyContent: 'space-between', padding: '0 0 0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>{icon}Piu</div>
      <div style={{ ...center, fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)' }}>{title}</div>
      <div style={{ display: 'flex', height: '100%' }}>
        {[['remove', 16], ['crop_square', 13], ['close', 16]].map(([n, s]) => <div key={n} style={{ width: 46, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n={n as string} s={s as number} style={{ fontVariationSettings: "'wght' 300" }} /></div>)}
      </div>
    </div>
  );
}

export default function DesktopDemo({ os: initialOs }: { os?: DemoOs }) {
  const [os, setOs] = useState<DemoOs>(initialOs ?? 'mac');
  const [chats, setChats] = useState(SEED.filter(c => c.ident === 'public' && c.kind !== 'community'));
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [active, setActive] = useState('marina');
  const [draft, setDraft] = useState('');
  const timers = useRef<number[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOs(readOs());
    const onOs = () => setOs(readOs());
    addEventListener('piu-desktop-os', onOs);
    return () => { removeEventListener('piu-desktop-os', onOs); timers.current.forEach(clearTimeout); };
  }, []);

  const list = chats.filter(c => (filter === 'all' || c.kind === filter) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const unread = chats.reduce((n, c) => n + c.unread, 0);
  const chat = chats.find(c => c.id === active) ?? chats[0];
  const mod = os === 'mac' ? '⌘' : 'Ctrl';

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [active, chat?.msgs?.length]);

  const open = (c: Chat) => { setChats(cs => cs.map(x => (x.id === c.id ? { ...x, unread: 0 } : x))); setActive(c.id); };

  const send = () => {
    const text = draft.trim();
    if (!text || !chat) return;
    const id = 'n' + Date.now();
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const patch = (status: Status) => setChats(cs => cs.map(c => (c.id !== chat.id ? c : { ...c, time: now, msgs: (c.msgs ?? []).map(m => (m.id === id ? { ...m, status } : m)) })));
    setChats(cs => cs.map(c => (c.id !== chat.id ? c : { ...c, time: now, msgs: [...(c.msgs ?? []), { id, from: 'me', text, time: now, status: 'criada', fresh: true }] })));
    setDraft('');
    const steps = chat.offline ? FLOW.slice(1, 2) : FLOW.slice(1);
    steps.forEach((st, i) => timers.current.push(window.setTimeout(() => patch(st), 700 * (i + 1))));
  };

  return (
    <div style={{ width: 1280, height: 820, position: 'relative', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--sans)', letterSpacing: '-0.005em', display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
      <TitleBar os={os} title={chat.name} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* trilho */}
        <div style={{ width: 68, flex: 'none', background: 'var(--side)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0 16px', gap: 10 }}>
          <img src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/icon-192.png`} alt="" width={36} height={36} style={{ borderRadius: 10, display: 'block', marginBottom: 14 }} />
          {[['chat', true], ['account_balance_wallet', false], ['settings', false]].map(([n, on]) => (
            <div key={n as string} style={{ position: 'relative', width: 44, height: 44, borderRadius: 14, background: on ? 'var(--bg3)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ic n={n as string} s={24} style={{ fontVariationSettings: `'FILL' ${on ? 1 : 0}, 'wght' 300` }} />
              {on && unread > 0 && <div style={{ position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--ink)', color: 'var(--invink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--side)' }}>{unread}</div>}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink2)' }}><div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)' }} />6 nós</div>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, marginTop: 10 }}>C</div>
        </div>

        {/* lista de conversas */}
        <div style={{ width: 400, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '20px 16px 0', gap: 12, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 36 }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1 }}>Conversas</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 99, border: '1px solid var(--line2)', fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink2)' }}><Ic n="public" s={14} />Pública</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px 0 12px', borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink2)' }}>
            <Ic n="search" s={19} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--line2)' }}>{mod} K</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                style={{ height: 30, padding: '0 12px', borderRadius: 15, border: 'none', background: filter === k ? 'var(--ink)' : 'var(--bg2)', color: filter === k ? 'var(--invink)' : 'var(--ink)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          <ul style={{ listStyle: 'none', margin: '0 -8px', padding: '4px 0 12px', overflowY: 'auto', scrollbarWidth: 'none', flex: 1, minHeight: 0 }}>
            {list.map(c => {
              const last = c.msgs?.[c.msgs.length - 1];
              const fromMe = last?.from === 'me';
              const preview = last ? (fromMe ? 'Você: ' : last.sender ? last.sender + ': ' : '') + last.text : '';
              const on = c.id === chat.id;
              return (
                <li key={c.id}>
                  <button type="button" className="phone-row" onClick={() => open(c)}
                    style={{ ...btnReset, width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', borderRadius: 16, background: on ? 'var(--bg2)' : 'transparent', textAlign: 'left' }}>
                    <div style={{ width: 46, height: 46, ...av(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', flex: 'none' }}>{c.initials}</div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.015em' }}>{c.name}</div>
                        {KIND_ICON[c.kind] && <Ic n={KIND_ICON[c.kind]!} s={15} style={{ color: 'var(--ink2)' }} />}
                        <div style={{ fontSize: 12, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{c.time}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {fromMe && last?.status && <Ic n={STATUS_ICON[last.status]} s={15} style={{ color: 'var(--ink2)' }} />}
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>
                        {c.unread > 0 && <div style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: 'var(--ink)', color: 'var(--invink)', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.unread}</div>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* conversa */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 70, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 40, height: 40, ...av(chat), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flex: 'none' }}>{chat.initials}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.sub}</div>
            </div>
            <Ic n="notifications" s={22} style={{ fontVariationSettings: "'wght' 300" }} />
            <Ic n="info" s={22} style={{ fontVariationSettings: "'wght' 300", marginLeft: 8 }} />
          </div>
          <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none', padding: '18px 24px 12px', display: 'flex', flexDirection: 'column', gap: 4, backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' }}>
            <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12.5, color: 'var(--ink2)', marginBottom: 8 }}>
              <Ic n="lock" s={14} style={{ color: 'var(--ink)' }} />Cifrado de ponta a ponta. Clique numa mensagem para ver a rota.
            </div>
            {(chat.msgs ?? []).map((m, i, a) => {
              const gap = i > 0 && a[i - 1].from === m.from ? 0 : 8;
              const anim = m.fresh ? 'piuMsgIn .34s cubic-bezier(.2,.9,.3,1.2) both' : undefined;
              if (m.from === 'sys') return (
                <div key={m.id} style={{ alignSelf: 'center', maxWidth: 420, margin: '8px 0 4px', padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink2)', textAlign: 'center', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Ic n="key" s={14} style={{ color: 'var(--ink)', lineHeight: 1.3 }} />{m.text}
                </div>
              );
              if (m.from === 'me') return (
                <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '68%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: gap }}>
                  <div style={{ padding: '8px 12px 6px 14px', borderRadius: '20px 20px 6px 20px', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 2, animation: anim, transformOrigin: 'bottom right' }}>
                    <div style={{ fontSize: 15, lineHeight: 1.4, textWrap: 'pretty' }}>{m.text}</div>
                    <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.72 }}>
                      <span>{m.status ? STATUS_LABEL[m.status] : ''}</span><span>·</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{m.time}</span>
                      {m.status && <Ic key={m.status} n={STATUS_ICON[m.status]} s={15} style={{ fontVariationSettings: "'wght' 500", display: 'inline-block', animation: m.fresh ? 'piuTick .42s cubic-bezier(.2,.9,.3,1.4)' : undefined }} />}
                    </div>
                  </div>
                  {m.status === 'expirada' && <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 4px 0 0', fontSize: 12, color: 'var(--ink2)' }}><Ic n="timer_off" s={15} />Não entregue no prazo</div>}
                </div>
              );
              return (
                <div key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '68%', padding: '8px 14px 6px 12px', borderRadius: '20px 20px 20px 6px', background: 'var(--bub)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 2, marginTop: gap, boxShadow: '0 0 0 1px var(--line) inset' }}>
                  {chat.kind === 'group' && m.sender && <div style={{ fontSize: 12.5, fontWeight: 650 }}>{m.sender}</div>}
                  <div style={{ fontSize: 15, lineHeight: 1.4, textWrap: 'pretty' }}>{m.text}</div>
                  <div style={{ alignSelf: 'flex-end', fontSize: 11, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{m.time}</div>
                </div>
              );
            })}
            {chat.offline && (
              <div style={{ alignSelf: 'center', marginTop: 12, maxWidth: 380, padding: '14px 16px', borderRadius: 18, border: '1px dashed var(--line2)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Ic n="schedule_send" s={18} />{chat.name.split(' ')[0]} está fora de alcance</div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--ink2)' }}>Sua mensagem está guardada no nó Galpão e será entregue quando uma rota surgir. Expira em 47 h.</div>
              </div>
            )}
          </div>
          {chat.kind === 'channel' ? (
            <div style={{ padding: '14px 24px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 13.5, fontWeight: 550 }}>Somente administradores publicam</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink2)' }}>{chat.via}</div>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); send(); }} style={{ padding: '12px 20px 10px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {['attach_file', 'qr_code_2'].map(n => <div key={n} aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 21, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ic n={n} s={22} style={{ fontVariationSettings: "'wght' 300" }} /></div>)}
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Mensagem para ${chat.name.split(' ')[0]}`} aria-label="Mensagem"
                  style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', padding: '0 16px', fontSize: 15, color: 'var(--ink)' }} />
                <button type="submit" aria-label="Enviar" style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: draft.trim() ? 1 : 0.35, transform: `scale(${draft.trim() ? 1 : 0.9})`, transition: 'opacity .15s,transform .25s cubic-bezier(.2,.9,.3,1.5)' }}>
                  <Ic n="arrow_upward" s={22} style={{ fontVariationSettings: "'wght' 500" }} />
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Ic n={chat.viaIcon ?? 'hub'} s={14} />{chat.via}</span>
                <span>Enter envia · Shift+Enter quebra linha</span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
