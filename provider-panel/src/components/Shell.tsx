import { NODE, OPERATOR, PERIOD } from '../data/seed';
import { downloadCsv } from '../lib/io';
import { fmt } from '../lib/format';
import { useStore } from '../state/store';
import type { PageId } from '../types';
import { Icon, Segmented } from './ui';

/** Faixa superior: qual nó serve o painel e o estado da conexão. */
export function TopBar() {
  return (
    <header style={{ height: 42, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', background: 'var(--side)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div className="mono" style={{ height: 26, padding: '0 14px', borderRadius: 8, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink2)', minWidth: 380, justifyContent: 'center' }}>
          <Icon name="lock" size={14} style={{ color: 'var(--ink)' }} />
          {NODE.host}
          <span style={{ opacity: 0.5 }}>· {NODE.label}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 6, fontSize: 12, fontWeight: 550, color: 'var(--ink2)' }}>
        <Icon name="wifi_off" size={15} />sem internet
      </div>
    </header>
  );
}

const NAV: [PageId, string, string][] = [
  ['overview', 'space_dashboard', 'Visão geral'], ['devices', 'router', 'Equipamentos'], ['mesh', 'hub', 'Malha'],
  ['earnings', 'toll', 'Ganhos'], ['wallet', 'account_balance_wallet', 'Carteira'], ['settings', 'tune', 'Configurações'],
];

export function Sidebar() {
  const { page, navigate, devices, theme, setTheme } = useStore();
  return (
    <nav aria-label="Painel" style={{ width: 232, flex: 'none', background: 'var(--side)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '22px 14px 16px', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 8px' }}>
        <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: '-0.07em', lineHeight: 1 }}>piu<span style={{ color: 'var(--ink3)' }}>.</span></div>
        <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '.06em', padding: '2px 7px', borderRadius: 6, border: '1px solid var(--line2)', color: 'var(--ink2)' }}>PROVIDER</div>
      </div>
      <div className="row" style={{ gap: 10, padding: 10, borderRadius: 14, background: 'var(--bg2)' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--ink)', color: 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flex: 'none' }}>{OPERATOR.initial}</div>
        <div className="col grow" style={{ gap: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{OPERATOR.name}</div>
          <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--ink2)' }}>operador · {devices.length} equipamentos</div>
        </div>
      </div>
      <div className="col" style={{ gap: 2 }}>
        {NAV.map(([k, icon, label]) => {
          const on = page === k;
          return (
            <button key={k} type="button" aria-current={on ? 'page' : undefined} onClick={() => navigate(k)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40, padding: '0 12px', border: 'none', borderRadius: 11, background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--invink)' : 'var(--ink)', fontSize: 14, fontWeight: on ? 600 : 500, cursor: 'pointer', textAlign: 'left', transition: 'background .15s' }}>
              <Icon name={icon} size={20} fill={on ? 1 : 0} wght={350} />
              <span style={{ flex: 1 }}>{label}</span>
              {k === 'devices' && <span className="mono" style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>{devices.length}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <div className="col" style={{ padding: 12, borderRadius: 14, border: '1px dashed var(--line2)', gap: 6 }}>
        <div className="row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}><Icon name="cloud_off" size={17} />Mainnet fora de alcance</div>
        <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>Última sincronização {PERIOD.lastSync}. Créditos ficam guardados aqui até lá.</div>
      </div>
      <Segmented label="Tema" value={theme} onChange={setTheme} height={30} fontSize={12.5}
        options={[{ value: 'light', label: 'Claro', icon: 'light_mode' }, { value: 'dark', label: 'Escuro', icon: 'dark_mode' }]} />
    </nav>
  );
}

const HEADERS: Record<PageId, [string, string, string]> = {
  overview: ['PAINEL LOCAL · SEM INTERNET', 'Visão geral', ''],
  devices: ['OPERAÇÃO', 'Equipamentos', 'Roteadores, antenas e gateways que você opera'],
  mesh: ['OPERAÇÃO', 'Malha', '27 vizinhos alcançáveis · rotas escolhidas por alcance e capacidade'],
  earnings: ['FINANCEIRO', 'Ganhos', 'Créditos por entregas comprovadas, liquidados em LUNES'],
  wallet: ['FINANCEIRO', 'Carteira', 'Carteira de provider, separada da sua identidade de conversa'],
  settings: ['CONTA', 'Configurações', 'Limites e políticas aplicados a todos os equipamentos'],
};

export function PageHeader() {
  const store = useStore();
  const { page, devices, setWizardOpen, showToast } = store;
  const [crumb, title, sub] = HEADERS[page];
  const subtitle = page === 'overview' ? `${PERIOD.today} · ${devices.length} equipamentos na malha do bairro` : sub;
  const showExport = page === 'earnings' || page === 'wallet';

  const exportCsv = () => {
    if (page === 'wallet') {
      downloadCsv('movimentacoes-provider.csv', [['movimentacao', 'data', 'estado', 'lunes'], ...store.txs.map(t => [t.title, t.date, t.status, t.value])]);
      showToast({ icon: 'download', title: 'Extrato exportado', body: 'movimentacoes-provider.csv salvo neste computador.' });
    } else {
      downloadCsv(`ganhos-${PERIOD.month}.csv`, [
        ['equipamento', 'classe', 'nome_publico', 'lunes_hoje', `lunes_${PERIOD.month}`],
        ...devices.filter(d => !d.passive).map(d => [d.name, d.cls, d.pub, fmt(d.today), fmt(d.month)]),
      ]);
      showToast({ icon: 'download', title: 'Extrato exportado', body: `ganhos-${PERIOD.month}.csv salvo neste computador.` });
    }
  };

  return (
    <div style={{ padding: '28px 32px 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
      <div className="col" style={{ gap: 6, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.06em', color: 'var(--ink2)' }}>{crumb}</div>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1 }}>{title}</h1>
        <div style={{ fontSize: 14, color: 'var(--ink2)' }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        {showExport && (
          <button type="button" className="btn btn-outline" onClick={exportCsv} style={{ height: 40, padding: '0 16px', borderRadius: 20, fontSize: 13.5 }}>
            <Icon name="download" size={18} />Exportar CSV
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => setWizardOpen(true)} style={{ height: 40, padding: '0 18px', borderRadius: 20, fontSize: 13.5 }}>
          <Icon name="add" size={19} />Adicionar equipamento
        </button>
      </div>
    </div>
  );
}
