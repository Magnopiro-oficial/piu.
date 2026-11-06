/**
 * Ajustes (protótipo `isSettingsNav`): menu 248px com as páginas e "Desconectar este computador";
 * página com título 30px, descrição e seções em cartões bg2 (linhas de 56px: interruptor, segmentado,
 * valor, botão, teclas). O que não tem backend real fica marcado "em breve", sem fingir.
 */
import { type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { screenSecurityFor, SCREEN_SECURITY_DESC } from '../../shared/screenSecurity';
import type { MeInfo, NetworkStatus, PeerInfo, Prefs, SessionInfo } from '../../shared/types';
import { Btn, type DialogSpec, F, FM, handleOf, initialsOf, Seg, Sym, Toggle } from '../ui';

export type Page = 'profile' | 'devices' | 'notifs' | 'privacy' | 'look' | 'chats' | 'network' | 'system' | 'backup' | 'lang' | 'keys';

interface Props {
  page: Page; setPage: (p: Page) => void;
  me: MeInfo; session: SessionInfo; prefs: Prefs; net: NetworkStatus | null;
  updatePrefs: (p: Partial<Prefs>) => Promise<void>;
  toast: (text: string, icon?: string) => void;
  setDialog: Dispatch<SetStateAction<DialogSpec | null>>;
  onLogout: () => void;
}

const PAGES: [Page, string, string][] = [
  ['profile', 'account_circle', 'Perfil'], ['devices', 'devices', 'Aparelhos'], ['notifs', 'notifications', 'Notificações'], ['privacy', 'shield_lock', 'Privacidade'],
  ['look', 'palette', 'Aparência'], ['chats', 'chat', 'Conversas'], ['network', 'hub', 'Rede'], ['system', 'laptop_mac', 'Sistema'], ['backup', 'key', 'Backup'], ['lang', 'translate', 'Idioma'], ['keys', 'keyboard', 'Atalhos'],
];

const Soon = () => <div style={{ font: `500 12.5px ${FM}`, color: 'var(--ink2)' }}>em breve</div>;

/** O estado da senha é limpo ao fechar o formulário; a frase nunca passa por ele. */
function BackupExport({ toast }: { toast: Props['toast'] }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const clear = () => { setPassword(''); setConfirmation(''); setOpen(false); };
  const error = password.length < 10 ? 'Use pelo menos 10 caracteres.' : new Set(password).size < 5 ? 'Senha repetitiva demais.' : password !== confirmation ? 'As senhas precisam ser iguais.' : null;
  const submit = async () => {
    if (busy || error) return;
    setBusy(true);
    try {
      const result = await window.piu.exportIdentityBackup(password);
      clear();
      if (result === 'saved') toast('Backup cifrado salvo', 'check');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível salvar o backup.', 'error');
    } finally { setPassword(''); setConfirmation(''); setBusy(false); }
  };
  const input: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 44, borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 12px', font: `400 14px ${F}` };
  return <>
    <Row name="Exportar backup cifrado" desc="Arquivo .piu com as chaves; não inclui contatos nem conversas" icon="download" first>
      <Btn onClick={() => { if (!busy) { if (open) clear(); else setOpen(true); } }}>{open ? 'Cancelar' : 'Exportar'}</Btn>
    </Row>
    {open && <form onSubmit={e => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>Escolha uma senha para cifrar o arquivo. Guarde-a em local seguro: sem ela, não é possível restaurar o backup.</div>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Senha do backup<input style={input} type="password" autoComplete="off" spellCheck={false} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Confirme a senha<input style={input} type="password" autoComplete="off" spellCheck={false} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
      {(password || confirmation) && error && <div role="status" style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{error}</div>}
      <button type="submit" disabled={busy || !!error} style={{ height: 44, border: 'none', borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer', opacity: busy || error ? .5 : 1 }}>{busy ? 'Cifrando e salvando…' : 'Escolher onde salvar'}</button>
    </form>}
  </>;
}


/** Linha de uma seção (56px mínimo), com ícone opcional e o controle à direita. */
function Row({ name, desc, icon, first, children, onClick }: { name: string; desc?: string; icon?: string; first?: boolean; children?: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderTop: `1px solid ${first ? 'transparent' : 'var(--line)'}`, minHeight: 56, cursor: onClick ? 'pointer' : 'default' }}>
      {icon && <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sym name={icon} size={20} wght={300} /></div>}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14.5, fontWeight: 550 }}>{name}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.35 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}
function Section({ title, i, children }: { title: string; i: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', animation: `piuUp .45s ${0.08 + i * 0.07}s cubic-bezier(.2,.85,.3,1) both` }}>
      <div style={{ padding: '16px 4px 8px', font: `500 11.5px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{title}</div>
      <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}
const Val = ({ children }: { children: ReactNode }) => <div style={{ font: `500 12.5px ${FM}`, color: 'var(--ink2)' }}>{children}</div>;
const Kbd = ({ keys }: { keys: string[] }) => (
  <div style={{ display: 'flex', gap: 4 }}>{keys.map((k, i) => <div key={i} style={{ minWidth: 28, height: 28, padding: '0 8px', borderRadius: 7, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset,0 2px 0 var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `550 12.5px ${FM}` }}>{k}</div>)}</div>
);

export function Settings(p: Props) {
  const { page, setPage, me, session, prefs, net, updatePrefs, toast, setDialog } = p;
  const mac = session.platform === 'darwin', win = session.platform === 'win32';
  const mod = mac ? '⌘' : 'Ctrl';
  const [seq, setSeq] = useState(0);
  const go = (k: Page) => { if (k !== page) { setPage(k); setSeq(s => s + 1); } };
  const pub = prefs.identity === 'public';
  const myId = pub ? me.publicId : me.anonId;
  const fp = me.nodePk.slice(0, 32).match(/.{4}/g) ?? [];
  const [name, setName] = useState(prefs.displayName);
  useEffect(() => setName(prefs.displayName), [prefs.displayName]);
  const [bkWords, setBkWords] = useState<string[] | null>(null);
  const [bkShown, setBkShown] = useState(false);
  const [peerInput, setPeerInput] = useState('');
  const sec = screenSecurityFor(session.platform, prefs.screenSecurity, true);
  const osName = mac ? 'macOS' : win ? 'Windows' : 'Linux';

  const titles: Record<Page, [string, string]> = {
    profile: ['Perfil e identidade', 'Como você aparece para os outros. Cada identidade tem chaves e contatos separados.'],
    devices: ['Aparelhos conectados', 'Todos usam a mesma identidade. Cada um tem sua própria chave e pode ser desconectado sozinho.'],
    notifs: ['Notificações', `Avisos nativos do ${osName}. O Piu escuta a malha enquanto a janela estiver aberta.`],
    privacy: ['Privacidade e segurança', 'O que os outros veem e o que fica guardado neste computador.'],
    look: ['Aparência', 'Ajuste o Piu ao seu jeito de ler.'],
    chats: ['Conversas e mídia', 'Como escrever, o que baixar e quanto tempo guardar.'],
    network: ['Rede e malha', 'Por onde este computador conversa com os outros nós.'],
    system: ['Sistema', mac ? 'Integração com o macOS.' : win ? 'Integração com o Windows.' : 'Integração com o seu desktop Linux.'],
    backup: ['Backup das chaves', 'Sem backup, perder este computador significa perder a identidade. Ninguém consegue recuperar por você.'],
    lang: ['Idioma e região', 'O idioma do Piu neste computador. Cada aparelho pode usar o seu.'],
    keys: ['Atalhos de teclado', 'Tudo no Piu dá para fazer sem tirar a mão do teclado.'],
  };

  const showCode = async () => {
    try { const card = await window.piu.myCard(prefs.identity); setDialog({ title: 'Seu código de perfil', body: 'Quem colar (ou escanear, no celular) este código pode iniciar uma conversa com você. Uso único, vale 24 h.', primary: 'Copiar', code: card.card, act: () => { void window.piu.copy(card.card); setDialog(null); toast('Código copiado', 'content_copy'); } }); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const addPeer = async () => { try { await window.piu.addPeer(peerInput); setPeerInput(''); toast('Vizinho adicionado · conectando', 'hub'); } catch (e) { toast((e as Error).message, 'error'); } };
  const peerState = (x: PeerInfo) => (x.state === 'connected' ? 'conectado' : x.state === 'connecting' ? 'conectando' : 'falhou');

  const body = (() => {
    switch (page) {
      case 'profile': return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: 18, borderRadius: 20, background: 'var(--bg2)', marginBottom: 6, animation: 'piuUp .45s .05s both' }}>
            <div style={{ width: 72, height: 72, borderRadius: pub ? '50%' : 24, background: pub ? 'var(--ink)' : 'var(--bg3)', color: pub ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 24px ${F}`, flex: 'none', transition: 'border-radius .4s cubic-bezier(.2,.9,.3,1.3),background .3s', animation: 'piuPop .55s .1s cubic-bezier(.2,.9,.3,1.4) both' }}>{pub ? initialsOf(prefs.displayName, me.publicId) : initialsOf('', me.anonId)}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pub ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Nome de exibição" aria-label="Nome de exibição" onBlur={() => { if (name.trim() !== prefs.displayName) void updatePrefs({ displayName: name }).then(() => toast('Nome atualizado', 'check')); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    style={{ height: 40, maxWidth: 320, flex: 1, borderRadius: 11, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 12px', font: `600 16px ${F}`, color: 'var(--ink)', outline: 'none' }} />
                </div>
              ) : <div style={{ fontSize: 18, fontWeight: 650 }}>Anônimo · {me.anonId.replace(/^piu:/, '').slice(0, 4).toUpperCase()}</div>}
              <div className="sel" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', font: `500 12px ${FM}`, color: 'var(--ink2)' }}>
                {fp.map((g, i) => <span key={i} style={{ animation: `piuUp .35s ${0.15 + i * 0.03}s both` }}>{g.toUpperCase()}</span>)}
              </div>
            </div>
          </div>
          <Section title="IDENTIDADE" i={0}>
            <Row name="Identidade ativa" desc="Troque a qualquer momento pelo avatar na barra lateral" first><Seg value={prefs.identity} opts={[['public', 'Pública'], ['anon', 'Anônima']]} onChange={v => void updatePrefs({ identity: v })} /></Row>
            <Row name="Código do perfil" desc="Mostre ou envie para alguém adicionar você" onClick={showCode}><Val>{handleOf(myId)}</Val></Row>
            <Row name="Mostrar QR do perfil" desc="Para alguém escanear com o celular"><Val>em breve · use o código</Val></Row>
          </Section>
          <Section title="CHAVE DO NÓ" i={1}>
            <Row name="Chave técnica LNNP" desc="Assina o enlace e recibos de retransmissão. Sem ligação com as identidades." first><Val>{me.nodePk.slice(0, 16)}</Val></Row>
          </Section>
        </>
      );
      case 'devices': return (
        <>
          <Section title="CONECTADOS" i={0}>
            <Row name={session.hostname} desc="conectado agora" icon={mac ? 'laptop_mac' : 'computer'} first><Val>{osName}</Val></Row>
          </Section>
          <Section title="NOVO" i={1}>
            <Row name="Conectar outro aparelho" desc="Depende de chave por aparelho (regra 1.1), em revisão de criptografia. Restaurar a frase em dois lugares cria cópias que não sincronizam." icon="qr_code_2" first><Soon /></Row>
          </Section>
        </>
      );
      case 'notifs': return (
        <>
          <Section title="AVISAR SOBRE" i={0}>
            <Row name="Mensagens diretas" first><Toggle on={prefs.notifications} onChange={v => void updatePrefs({ notifications: v })} label="Mensagens diretas" /></Row>
            <Row name="Grupos"><Soon /></Row>
            <Row name="Canais" desc="Só os que você marcou como importantes"><Soon /></Row>
            <Row name="Pedidos de conversa por perto"><Soon /></Row>
            <Row name="Carteira LUNES" desc="Recebimentos e distribuições"><Soon /></Row>
          </Section>
          <Section title="COMO AVISAR" i={1}>
            <Row name="Mostrar no aviso" first><Seg value={prefs.notifPreview} opts={[['always', 'Nome e texto'], ['name', 'Só o nome'], ['never', 'Nada']]} onChange={v => void updatePrefs({ notifPreview: v })} /></Row>
            <Row name="Som"><Toggle on={prefs.notifSound} onChange={v => void updatePrefs({ notifSound: v })} label="Som" /></Row>
            <Row name={mac ? 'Contador no ícone do Dock' : 'Contador no ícone'}><Soon /></Row>
            <Row name="Não perturbe" desc="Silencia tudo, exceto emergências"><Soon /></Row>
            <Row name="Testar notificação" desc="Mostra um aviso nativo de exemplo agora" icon="notifications_active"><Btn onClick={() => void window.piu.testNotification().then(() => toast('Aviso enviado ao sistema', 'notifications_active'))}>Testar</Btn></Row>
          </Section>
        </>
      );
      case 'privacy': return (
        <>
          <Section title="SEGURANÇA" i={0}>
            <Row name="Segurança da tela" desc={sec.supported ? SCREEN_SECURITY_DESC : sec.note ?? ''} first>
              <Toggle on={sec.supported && prefs.screenSecurity} disabled={!sec.supported} onChange={v => void updatePrefs({ screenSecurity: v })} label="Segurança da tela" />
            </Row>
            <Row name="Bloquear o Piu ao suspender" desc={mac ? 'Pede Touch ID ou senha ao voltar' : 'Pede a senha do sistema ao voltar'}><Soon /></Row>
          </Section>
          <Section title="VISIBILIDADE" i={1}>
            <Row name="Confirmação de leitura" first><Soon /></Row>
            <Row name="Mostrar quando estou digitando"><Soon /></Row>
            <Row name="Quem me encontra pelo nome"><Soon /></Row>
          </Section>
          <Section title="METADADOS" i={2}>
            <Row name="Atraso aleatório no envio" desc="Até 30 s · dificulta correlação por horário" first><Soon /></Row>
            <Row name="Igualar tamanho das mensagens" desc="Nós intermediários não deduzem o conteúdo pelo tamanho"><Soon /></Row>
          </Section>
          <Section title="CONTATOS BLOQUEADOS" i={3}>
            <Row name="Ninguém bloqueado" first />
          </Section>
        </>
      );
      case 'look': return (
        <Section title="TEMA E TEXTO" i={0}>
          <Row name="Tema" first><Seg value={prefs.theme} opts={[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']]} onChange={v => void updatePrefs({ theme: v })} /></Row>
          <Row name="Tamanho do texto"><Seg value={prefs.fontSize} opts={[['s', 'Pequeno'], ['m', 'Médio'], ['l', 'Grande']]} onChange={v => void updatePrefs({ fontSize: v })} /></Row>
          <Row name="Densidade da lista"><Seg value={prefs.density} opts={[['comfort', 'Confortável'], ['compact', 'Compacta']]} onChange={v => void updatePrefs({ density: v })} /></Row>
          <Row name="Animações" desc="Desligue para uma interface mais calma"><Toggle on={prefs.animations} onChange={v => void updatePrefs({ animations: v })} label="Animações" /></Row>
        </Section>
      );
      case 'chats': return (
        <>
          <Section title="ESCREVER" i={0}>
            <Row name="Enter envia a mensagem" desc={prefs.enterSends ? 'Shift+Enter quebra linha' : `${mod}+Enter envia`} first><Toggle on={prefs.enterSends} onChange={v => void updatePrefs({ enterSends: v })} label="Enter envia a mensagem" /></Row>
            <Row name="Temporárias por padrão" desc="Vale para conversas novas"><Soon /></Row>
          </Section>
          <Section title="MÍDIA E ESPAÇO" i={1}>
            <Row name="Baixar mídia automaticamente" first><Soon /></Row>
            <Row name="Guardar mensagens de terceiros" desc="Retransmitidas por você, cifradas, sem acesso ao conteúdo"><Val>48 h</Val></Row>
            <Row name="Limpar cache de mídia" desc="Ainda não há mídia no computador"><Soon /></Row>
          </Section>
        </>
      );
      case 'network': {
        const lan = net?.lan;
        return (
          <>
            <Section title="TRANSPORTES" i={0}>
              <Row name="Rede local (Wi-Fi e cabo)" desc={lan?.state === 'running' ? `LNNP v1 · enlace TCP ${lan.port} · descoberta UDP ${lan.discoveryPort ?? 'desligada'}` : lan?.state === 'unavailable' ? lan.reason ?? 'indisponível' : 'Descobre nós na mesma rede'} first><Toggle on={prefs.lan} onChange={v => void updatePrefs({ lan: v })} label="Rede local" /></Row>
              <Row name="Bluetooth" desc={net?.ble.reason ?? 'Alcance curto, sem rede nenhuma'}><Toggle on={false} disabled label="Bluetooth (em breve)" /></Row>
            </Section>
            <Section title="AJUDAR A REDE" i={1}>
              <Row name="Retransmitir para outros" desc="Seu computador vira um nó e fortalece a malha" first><Toggle on={prefs.relay} onChange={v => void updatePrefs({ relay: v })} label="Retransmitir para outros" /></Row>
              <Row name="Banda para retransmitir"><Soon /></Row>
              <Row name="Nós vistos agora"><Val>{lan ? `${lan.links} conectado${lan.links === 1 ? '' : 's'}` : '—'}</Val></Row>
            </Section>
            <Section title="VIZINHOS" i={2}>
              <div style={{ display: 'flex', gap: 8, padding: '13px 16px' }}>
                <input value={peerInput} onChange={e => setPeerInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addPeer(); }} placeholder="192.168.0.10:8422 ou piu-node.local:8422" aria-label="Endereço do vizinho"
                  style={{ flex: 1, height: 36, borderRadius: 11, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 12px', font: `500 13px ${FM}`, color: 'var(--ink)', outline: 'none' }} />
                <Btn primary onClick={() => void addPeer()}>Adicionar</Btn>
              </div>
              {(lan?.peers ?? []).map(x => (
                <Row key={x.address + x.source} name={x.address} icon={x.state === 'connected' ? 'hub' : x.state === 'failed' ? 'error' : 'sync'} desc={[x.source === 'discovered' ? 'descoberto pelo anúncio' : x.source === 'config' ? 'da configuração' : 'fixo', x.nodeId ? `nó ${x.nodeId}` : null, x.error].filter(Boolean).join(' · ')}>
                  <Val>{peerState(x)}</Val>
                  {x.source === 'manual' && <button className="h-bg3" onClick={() => void window.piu.removePeer(x.address)} aria-label="Remover vizinho" style={{ width: 30, height: 30, border: 'none', borderRadius: 15, background: 'var(--bg)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={16} /></button>}
                </Row>
              ))}
              {(lan?.peers ?? []).length === 0 && <Row name="Nenhum vizinho ainda" desc="Abra o Piu noutro computador da mesma rede ou ligue um piu-node: ele aparece aqui sozinho." />}
            </Section>
          </>
        );
      }
      case 'system': return (
        <>
          <Section title="INICIAR" i={0}>
            <Row name={mac ? 'Abrir ao iniciar sessão' : 'Iniciar com o sistema'} first><Soon /></Row>
            <Row name={mac ? 'Ícone na barra de menus' : 'Ícone na bandeja do sistema'} desc="Fechar a janela mantém o Piu recebendo"><Soon /></Row>
          </Section>
          <Section title="ATUALIZAÇÕES" i={1}>
            <Row name="Atualizar" desc="Pacotes conferidos por assinatura antes de instalar" first><Soon /></Row>
            <Row name="Versão"><Val>{session.version} · sem assinatura</Val></Row>
            <Row name="Pacote"><Val>{mac ? 'Intel e Apple Silicon' : win ? 'Instalador NSIS' : 'AppImage · .deb'}</Val></Row>
          </Section>
        </>
      );
      case 'backup': return (
        <>
          <Section title="GUARDAR" i={0}>
            <BackupExport toast={toast} />
            <Row name="Frase de recuperação" desc={`Guardada no ${mac ? 'Keychain' : win ? 'cofre do Windows' : 'chaveiro do sistema'}; mostre só com ninguém olhando`} icon="visibility">
              <Btn primary={!bkShown} onClick={() => { if (bkShown) { setBkShown(false); return; } void window.piu.revealPhrase().then(w => { if (!w) { toast('Nenhuma frase guardada', 'error'); return; } setBkWords(w); setBkShown(true); }); }}>{bkShown ? 'Ocultar' : 'Mostrar'}</Btn>
            </Row>
          </Section>
          <div style={{ marginTop: 14, padding: 16, borderRadius: 20, background: 'var(--bg2)', display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, filter: bkShown ? 'none' : 'blur(7px)', transition: 'filter .5s', animation: 'piuUp .45s .2s both' }} aria-hidden={!bkShown}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={bkShown ? 'sel' : ''} style={{ height: 40, borderRadius: 11, background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontSize: 14 }}>
                <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)' }}>{i + 1}</span>{bkShown && bkWords ? bkWords[i] : '••••••'}
              </div>
            ))}
          </div>
          <Section title="APAGAR" i={2}>
            <Row name="Apagar tudo deste computador" desc="Frase, chaves, contatos e conversas. Não dá para desfazer." icon="delete_forever" first><Btn onClick={p.onLogout}>Apagar</Btn></Row>
          </Section>
        </>
      );
      case 'lang': return (
        <>
          <Section title="IDIOMA DO APP" i={0}>
            <Row name="Português (Brasil)" desc="Portuguese · Brazil" icon="check_circle" first><Val>em uso</Val></Row>
            {[['English', 'Inglês'], ['Español', 'Espanhol'], ['Français', 'Francês'], ['Deutsch', 'Alemão'], ['Italiano', 'Italiano']].map(([n, e]) => <Row key={n} name={n} desc={e} icon="radio_button_unchecked"><Soon /></Row>)}
          </Section>
          <Section title="REGIÃO" i={1}>
            <Row name="Formato de data e números" first><Val>do sistema</Val></Row>
            <Row name="Corretor ortográfico" desc={`Usa o dicionário do ${osName}`}><Toggle on disabled label="Corretor ortográfico" /></Row>
          </Section>
        </>
      );
      case 'keys': return (
        <>
          <Section title="NAVEGAR" i={0}>
            <Row name="Buscar conversas" first><Kbd keys={[mod, 'K']} /></Row>
            <Row name="Abrir ajustes"><Kbd keys={[mod, ',']} /></Row>
            <Row name="Detalhes da conversa"><Kbd keys={[mod, 'I']} /></Row>
          </Section>
          <Section title="CONVERSA" i={1}>
            <Row name="Enviar" first><Kbd keys={prefs.enterSends ? ['Enter'] : [mod, 'Enter']} /></Row>
            <Row name="Quebrar linha"><Kbd keys={prefs.enterSends ? ['⇧', 'Enter'] : ['Enter']} /></Row>
            <Row name="Sair"><Kbd keys={[mod, 'Q']} /></Row>
          </Section>
        </>
      );
    }
  })();

  return (
    <>
      <div style={{ width: 248, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '18px 12px 14px', gap: 14, animation: 'piuUp .4s cubic-bezier(.2,.85,.3,1) both' }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em', padding: '0 8px' }}>Ajustes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', scrollbarWidth: 'none' }}>
          {PAGES.map(([k, icon, label]) => (
            <button key={k} className="h-x3" onClick={() => go(k)} aria-current={page === k} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 38, padding: '0 10px', border: 'none', borderRadius: 11, background: page === k ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', font: `${page === k ? 600 : 450} 14px ${F}`, cursor: 'pointer', textAlign: 'left', transition: 'background .2s,transform .2s', flex: 'none' }}>
              <Sym name={k === 'system' && !mac ? 'computer' : icon} size={19} fill={page === k ? 1 : 0} wght={350} /><span style={{ flex: 1 }}>{label}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="h-bg2" onClick={p.onLogout} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40, padding: '0 10px', border: '1px solid var(--line2)', borderRadius: 12, background: 'transparent', color: 'var(--ink)', font: `550 13.5px ${F}`, cursor: 'pointer' }}>
          <Sym name="logout" size={19} />Desconectar este computador
        </button>
      </div>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', scrollbarWidth: 'thin' }}>
        <div key={seq} style={{ maxWidth: 720, margin: '0 auto', padding: '32px 40px 48px', display: 'flex', flexDirection: 'column', gap: 6, animation: `piuPg${seq % 2 ? 'A' : 'B'} .45s cubic-bezier(.2,.85,.3,1) both` }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>{titles[page][0]}</div>
          <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, marginBottom: 12, maxWidth: 560, textWrap: 'pretty' }}>{titles[page][1]}</div>
          {body}
        </div>
      </div>
    </>
  );
}
