// Demonstração do app Piu no celular do topo do site (tela 390×844, escalada pelo CSS).
// Recria a tela de Conversas e a conversa de PiuApp.dc.html até o app real existir.
// O conteúdo fica em português, como o app.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Kind = 'direct' | 'group' | 'channel' | 'community';
type Status = 'criada' | 'aguardando' | 'encaminhada' | 'entregue' | 'expirada';
interface Msg { id: string; from: 'me' | 'them' | 'sys'; text: string; time: string; status?: Status; sender?: string; fresh?: boolean }
interface Chat {
  id: string; ident: 'public' | 'anon'; kind: Kind; name: string; initials: string; time: string; unread: number; inv?: boolean;
  sub?: string; via?: string; viaIcon?: string; preview?: string; offline?: boolean; msgs?: Msg[];
}

const SEED: Chat[] = [
  { id: 'marina', ident: 'public', kind: 'direct', name: 'Marina Alves', initials: 'MA', time: '14:32', unread: 2, inv: true, sub: 'por perto · 2 saltos', via: 'Wi-Fi Mesh · 2 saltos', viaIcon: 'hub',
    msgs: [
      { id: 'm1', from: 'them', text: 'Oi! Você vai no mutirão hoje?', time: '14:10' },
      { id: 'm2', from: 'me', text: 'Vou sim, saio daqui a pouco.', time: '14:12', status: 'entregue' },
      { id: 'm3', from: 'them', text: 'A internet caiu no bairro inteiro, mas aqui tá chegando tudo pelo Piu.', time: '14:20' },
      { id: 'm4', from: 'me', text: 'Pois é! Tô vendo 6 nós por perto.', time: '14:21', status: 'entregue' },
      { id: 'm5', from: 'them', text: 'Chego em 10 min, estou perto da praça.', time: '14:32' },
    ] },
  { id: 'mutirao', ident: 'public', kind: 'group', name: 'Mutirão Vila Esperança', initials: 'VE', time: '14:05', unread: 5, sub: '18 membros · 6 por perto', via: 'Wi-Fi Mesh · 1 salto', viaIcon: 'hub',
    msgs: [
      { id: 'g1', from: 'them', sender: 'Lia', text: 'Alguém tem extensão sobrando? Precisamos no galpão.', time: '13:48' },
      { id: 'g2', from: 'me', text: 'Levo uma de 10 m.', time: '13:51', status: 'entregue' },
      { id: 'g3', from: 'them', sender: 'Seu Antônio', text: 'Os mantimentos chegaram, estamos separando por família.', time: '13:58' },
      { id: 'g4', from: 'them', sender: 'João', text: 'Gerador ligado. O roteador do galpão voltou a retransmitir.', time: '14:05' },
    ] },
  { id: 'defesa', ident: 'public', kind: 'channel', name: 'Defesa Civil · Serra', initials: 'DC', time: '13:40', unread: 1, inv: true, sub: '1.240 inscritos · canal público', via: 'LoRa 915 MHz · 3 saltos', viaIcon: 'settings_input_antenna',
    msgs: [
      { id: 'd1', from: 'them', text: 'Chuva forte prevista para esta noite. Evite áreas de encosta.', time: '09:15' },
      { id: 'd2', from: 'them', text: 'Alerta: estrada RJ-130 interditada no km 12. Use o desvio pela Estrada Velha.', time: '13:40' },
    ] },
  { id: 'pedro', ident: 'public', kind: 'direct', name: 'Pedro Lima', initials: 'PL', time: '12:18', unread: 0, offline: true, sub: 'fora de alcance · 1 na fila', via: 'na fila · aguardando rota', viaIcon: 'schedule',
    msgs: [
      { id: 'p1', from: 'them', text: 'Consegue me mandar o mapa da trilha?', time: '11:52' },
      { id: 'p2', from: 'me', text: 'Mandei o mapa, chegou?', time: '12:18', status: 'aguardando' },
    ] },
  { id: 'feira', ident: 'public', kind: 'community', name: 'Feira Livre do Sábado', initials: 'FL', time: 'Ontem', unread: 0, preview: '3 grupos · 2 canais' },
  { id: 'ana', ident: 'public', kind: 'direct', name: 'Ana Costa', initials: 'AC', time: 'Ontem', unread: 0, sub: 'vista via Gateway Praça', via: 'Wi-Fi Direct · 3 saltos', viaIcon: 'wifi_tethering',
    msgs: [
      { id: 'a1', from: 'them', text: 'Que festa linda ontem!', time: '21:02' },
      { id: 'a2', from: 'me', text: 'Te mando as fotos quando eu passar pelo roteador da praça.', time: '21:10', status: 'encaminhada' },
      { id: 'a-sys', from: 'sys', text: 'A chave de segurança de Ana Costa mudou. Verifique antes de enviar algo sensível.', time: '21:12' },
      { id: 'a3', from: 'me', text: 'Amanhã levo o projetor pra oficina.', time: '21:14', status: 'expirada' },
    ] },
  { id: 'radio', ident: 'public', kind: 'channel', name: 'Rádio Comunitária', initials: 'RC', time: 'Ter', unread: 0, sub: '486 inscritos · canal público', via: 'Wi-Fi Mesh · 2 saltos', viaIcon: 'hub',
    msgs: [{ id: 'r1', from: 'them', text: 'Sábado tem oficina de antenas às 10h, na praça.', time: 'Ter' }] },
  { id: 'anon1', ident: 'anon', kind: 'direct', name: 'Anônimo · B2D9', initials: 'B2', time: '11:03', unread: 1, sub: 'identidade anônima · 2 saltos', via: 'Bluetooth LE · 2 saltos', viaIcon: 'bluetooth',
    msgs: [
      { id: 'x1', from: 'me', text: 'Vi o vazamento na rua de baixo também.', time: '10:58', status: 'entregue' },
      { id: 'x2', from: 'them', text: 'Obrigado. Vou repassar para a associação.', time: '11:03' },
    ] },
  { id: 'anon2', ident: 'anon', kind: 'channel', name: 'Ouvidoria do Bairro', initials: 'OB', time: 'Seg', unread: 0, inv: true, sub: 'canal secreto · 64 inscritos', via: 'Wi-Fi Mesh · 1 salto', viaIcon: 'hub',
    msgs: [{ id: 'y1', from: 'them', text: 'Relatos recebidos esta semana: 14. Nenhum dado de identidade é armazenado.', time: 'Seg' }] },
];

const KIND_ICON: Partial<Record<Kind, string>> = { group: 'group', channel: 'campaign', community: 'workspaces' };
const STATUS_ICON: Record<Status, string> = { criada: 'radio_button_unchecked', aguardando: 'schedule', encaminhada: 'check', entregue: 'done_all', expirada: 'timer_off' };
const STATUS_LABEL: Record<Status, string> = { criada: 'criada', aguardando: 'na fila', encaminhada: 'encaminhada', entregue: 'entregue', expirada: 'expirada' };
const FLOW: Status[] = ['criada', 'aguardando', 'encaminhada', 'entregue'];
const FILTERS: [string, string][] = [['all', 'Todas'], ['direct', 'Pessoas'], ['group', 'Grupos'], ['channel', 'Canais'], ['community', 'Comunidades']];
const TABS: [string, string][] = [['Conversas', 'chat_bubble'], ['Por perto', 'radar'], ['Rede', 'hub'], ['Carteira', 'account_balance_wallet'], ['Perfil', 'person']];

const Ic = ({ n, s, style }: { n: string; s: number; style?: CSSProperties }) => <span className="ic" aria-hidden="true" style={{ fontSize: s, ...style }}>{n}</span>;
const av = (c: Chat): CSSProperties => ({ borderRadius: c.kind === 'direct' ? '50%' : 17, background: c.inv ? 'var(--ink)' : 'var(--bg3)', color: c.inv ? 'var(--invink)' : 'var(--ink)' });
const btnReset: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', padding: 0 };

export default function PhoneDemo() {
  const [chats, setChats] = useState(SEED);
  const [identity, setIdentity] = useState<'public' | 'anon'>('public');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const timers = useRef<number[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const mine = chats.filter(c => c.ident === identity);
  const list = mine.filter(c => (filter === 'all' || c.kind === filter) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const queued = mine.reduce((n, c) => n + (c.msgs ?? []).filter(m => m.from === 'me' && m.status === 'aguardando').length, 0);
  const queueChat = mine.find(c => (c.msgs ?? []).some(m => m.from === 'me' && m.status === 'aguardando'));
  const unread = mine.reduce((n, c) => n + c.unread, 0);
  const chat = chats.find(c => c.id === active);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [active, chat?.msgs?.length]);

  const open = (c: Chat) => {
    if (c.kind === 'community') return;
    setChats(cs => cs.map(x => (x.id === c.id ? { ...x, unread: 0 } : x)));
    setActive(c.id);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !chat) return;
    const id = 'n' + Date.now();
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const patch = (status: Status) => setChats(cs => cs.map(c => (c.id !== chat.id ? c : { ...c, time: now, msgs: (c.msgs ?? []).map(m => (m.id === id ? { ...m, status } : m)) })));
    setChats(cs => cs.map(c => (c.id !== chat.id ? c : { ...c, time: now, msgs: [...(c.msgs ?? []), { id, from: 'me', text, time: now, status: 'criada', fresh: true }] })));
    setDraft('');
    // Fora de alcance, a mensagem fica na fila; senão percorre os estados até "entregue".
    const steps = chat.offline ? FLOW.slice(1, 2) : FLOW.slice(1);
    steps.forEach((st, i) => timers.current.push(window.setTimeout(() => patch(st), 700 * (i + 1))));
  };

  return (
    <div style={{ width: 390, height: 844, position: 'relative', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--sans)', letterSpacing: '-0.005em', textAlign: 'left' }}>
      {/* barra de status */}
      <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 32px 0 38px', zIndex: 20, pointerEvents: 'none' }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>9:41</div>
        <div style={{ position: 'absolute', left: '50%', top: 11, transform: 'translateX(-50%)', width: 122, height: 35, borderRadius: 20, background: '#000' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Ic n="bluetooth" s={17} style={{ fontVariationSettings: "'wght' 500" }} />
          <Ic n="wifi_off" s={17} style={{ fontVariationSettings: "'wght' 500" }} />
          <Ic n="battery_5_bar" s={22} style={{ transform: 'rotate(90deg)' }} />
        </div>
      </div>

      {!chat ? (
        <>
          <div style={{ position: 'absolute', top: 54, left: 0, right: 0, bottom: 84, overflowY: 'auto', scrollbarWidth: 'none' }}>
            <div style={{ padding: '6px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
                <button type="button" onClick={() => { setIdentity(i => (i === 'public' ? 'anon' : 'public')); setFilter('all'); }} aria-label="Trocar identidade"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', border: 'none', borderRadius: 20, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{identity === 'public' ? 'C' : '7F'}</div>
                  <span style={{ fontSize: 13, fontWeight: 550 }}>{identity === 'public' ? 'Pública' : 'Anônima'}</span>
                  <Ic n="swap_horiz" s={16} />
                </button>
                <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="edit_square" s={21} /></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1 }}>Conversas</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 99, border: '1px solid var(--line2)', fontSize: 12, fontWeight: 500, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', boxShadow: '0 0 0 3px var(--line)', animation: 'piuBreath 2.4s ease-in-out infinite' }} />6 nós · offline
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderRadius: 12, background: 'var(--bg2)', color: 'var(--ink2)' }}>
                <Ic n="search" s={20} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas"
                  style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, color: 'var(--ink)' }} />
              </label>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px' }}>
                {FILTERS.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                    style={{ flex: 'none', height: 32, padding: '0 14px', borderRadius: 16, border: 'none', background: filter === k ? 'var(--ink)' : 'var(--bg2)', color: filter === k ? 'var(--invink)' : 'var(--ink)', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>{l}</button>
                ))}
              </div>
              {queued > 0 && queueChat && (
                <button type="button" onClick={() => open(queueChat)} style={{ ...btnReset, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, border: '1px dashed var(--line2)', textAlign: 'left' }}>
                  <Ic n="schedule_send" s={22} style={{ fontVariationSettings: "'wght' 300" }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{queued} {queued > 1 ? 'mensagens na fila' : 'mensagem na fila'}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Será entregue quando surgir uma rota</div>
                  </div>
                  <Ic n="chevron_right" s={20} style={{ color: 'var(--ink2)' }} />
                </button>
              )}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0 16px' }}>
              {list.map(c => {
                const last = c.msgs?.[c.msgs.length - 1];
                const fromMe = last?.from === 'me';
                const preview = c.preview ?? (last ? (fromMe ? 'Você: ' : last.sender ? last.sender + ': ' : '') + last.text : '');
                return (
                  <li key={c.id}>
                    <button type="button" className="phone-row" onClick={() => open(c)}
                      style={{ ...btnReset, width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '9px 20px', textAlign: 'left', cursor: c.kind === 'community' ? 'default' : 'pointer' }}>
                      <div style={{ width: 54, height: 54, ...av(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', flex: 'none' }}>{c.initials}</div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {KIND_ICON[c.kind] && <Ic n={KIND_ICON[c.kind]!} s={16} />}
                          <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.015em' }}>{c.name}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{c.time}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {fromMe && last?.status && <Ic n={STATUS_ICON[last.status]} s={16} style={{ color: 'var(--ink2)' }} />}
                          <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>
                          {c.unread > 0 && <div style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: 11, background: 'var(--ink)', color: 'var(--invink)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.unread}</div>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {/* barra de abas */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 84, background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', padding: '8px 12px 0', zIndex: 5 }}>
            {TABS.map(([l, ic], i) => (
              <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: i === 0 ? 'var(--ink)' : 'var(--ink2)', position: 'relative' }}>
                <Ic n={ic} s={26} style={{ fontVariationSettings: `'FILL' ${i === 0 ? 1 : 0}, 'wght' 350` }} />
                <span style={{ fontSize: 11, fontWeight: i === 0 ? 650 : 500 }}>{l}</span>
                {i === 0 && unread > 0 && (
                  <div style={{ position: 'absolute', top: -3, left: 'calc(50% + 6px)', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--ink)', color: 'var(--invink)', fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>{unread}</div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '54px 10px 8px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', borderBottom: '1px solid var(--line)', zIndex: 2 }}>
            <button type="button" onClick={() => setActive(null)} aria-label="Voltar para Conversas" style={{ ...btnReset, width: 38, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="arrow_back_ios_new" s={22} /></button>
            <div style={{ width: 40, height: 40, ...av(chat), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flex: 'none' }}>{chat.initials}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.sub}</div>
            </div>
            <div aria-hidden="true" style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic n="more_horiz" s={22} /></div>
          </div>
          <div ref={scroller} style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none', padding: '14px 12px 10px', display: 'flex', flexDirection: 'column', gap: 4, backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' }}>
            <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, maxWidth: 300, padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, lineHeight: 1.35, color: 'var(--ink2)', textAlign: 'center', marginBottom: 6 }}>
              <Ic n="lock" s={14} style={{ color: 'var(--ink)' }} />Cifrado de ponta a ponta. Nem quem retransmite consegue ler.
            </div>
            <div style={{ alignSelf: 'center', padding: '3px 10px', fontSize: 11.5, fontWeight: 500, color: 'var(--ink2)', margin: '4px 0 6px' }}>Hoje</div>
            {(chat.msgs ?? []).map((m, i, a) => {
              const gap = i > 0 && a[i - 1].from === m.from ? 0 : 8;
              const anim = m.fresh ? 'piuMsgIn .34s cubic-bezier(.2,.9,.3,1.2) both' : undefined;
              if (m.from === 'sys') return (
                <div key={m.id} style={{ alignSelf: 'center', maxWidth: 300, margin: '8px 0 4px', padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, lineHeight: 1.4, color: 'var(--ink2)', textAlign: 'center', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Ic n="key" s={14} style={{ color: 'var(--ink)', lineHeight: 1.3 }} />{m.text}
                </div>
              );
              if (m.from === 'me') return (
                <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: gap }}>
                  <div style={{ padding: '8px 12px 6px 14px', borderRadius: '20px 20px 6px 20px', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 2, animation: anim, transformOrigin: 'bottom right' }}>
                    <div style={{ fontSize: 15.5, lineHeight: 1.35, textWrap: 'pretty' }}>{m.text}</div>
                    <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.72 }}>
                      <span>{m.status ? STATUS_LABEL[m.status] : ''}</span><span>·</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{m.time}</span>
                      {m.status && <Ic key={m.status} n={STATUS_ICON[m.status]} s={15} style={{ fontVariationSettings: "'wght' 500", display: 'inline-block', animation: m.fresh ? 'piuTick .42s cubic-bezier(.2,.9,.3,1.4)' : undefined }} />}
                    </div>
                  </div>
                  {m.status === 'expirada' && <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 4px 0 0', fontSize: 12, color: 'var(--ink2)' }}><Ic n="timer_off" s={15} />Não entregue no prazo</div>}
                </div>
              );
              return (
                <div key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '80%', padding: '8px 14px 6px 12px', borderRadius: '20px 20px 20px 6px', background: 'var(--bub)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 2, marginTop: gap, boxShadow: '0 0 0 1px var(--line) inset' }}>
                  {chat.kind === 'group' && m.sender && <div style={{ fontSize: 12.5, fontWeight: 650 }}>{m.sender}</div>}
                  <div style={{ fontSize: 15.5, lineHeight: 1.35, textWrap: 'pretty' }}>{m.text}</div>
                  <div style={{ alignSelf: 'flex-end', fontSize: 11, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{m.time}</div>
                </div>
              );
            })}
            {chat.offline && (
              <div style={{ alignSelf: 'center', marginTop: 12, maxWidth: 310, padding: '14px 16px', borderRadius: 18, border: '1px dashed var(--line2)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Ic n="schedule_send" s={18} />{chat.name.split(' ')[0]} está fora de alcance</div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--ink2)' }}>Sua mensagem está guardada no nó Galpão e será entregue quando uma rota surgir. Expira em 47 h.</div>
              </div>
            )}
          </div>
          {chat.kind === 'channel' ? (
            <div style={{ padding: '10px 16px 32px', background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 13.5, fontWeight: 550 }}>Somente administradores publicam</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink2)' }}>{chat.via}</div>
              </div>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); send(); }} style={{ padding: '8px 10px 30px', background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6, margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink2)' }}><Ic n={chat.viaIcon ?? 'hub'} s={13} />{chat.via}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 21, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ic n="add" s={24} style={{ fontVariationSettings: "'wght' 300" }} /></div>
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Mensagem" aria-label="Mensagem"
                  style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', padding: '0 16px', fontSize: 15.5, color: 'var(--ink)', outline: 'none' }} />
                <button type="submit" aria-label="Enviar" style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: draft.trim() ? 1 : 0.35, transform: `scale(${draft.trim() ? 1 : 0.9})`, transition: 'opacity .15s,transform .25s cubic-bezier(.2,.9,.3,1.5)' }}>
                  <Ic n="arrow_upward" s={22} style={{ fontVariationSettings: "'wght' 500" }} />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
