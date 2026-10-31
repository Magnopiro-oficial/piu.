import { Toast } from './components/Overlays';
import { PageHeader, Sidebar, TopBar } from './components/Shell';
import { Devices } from './pages/Devices';
import { Earnings } from './pages/Earnings';
import { Mesh } from './pages/Mesh';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';
import { Wallet } from './pages/Wallet';
import { useStore } from './state/store';
import { AddDeviceWizard } from './wizard/AddDeviceWizard';

const PAGES = { overview: Overview, devices: Devices, mesh: Mesh, earnings: Earnings, wallet: Wallet, settings: Settings };

export function App() {
  const { page, wizardOpen } = useStore();
  const Page = PAGES[page];
  return (
    <div style={{ height: '100%', minWidth: 1180, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)', position: 'relative', overflow: 'hidden' }}>
      <TopBar />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar />
        <main className="scroll-thin" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <PageHeader />
          <Page key={page} />
        </main>
      </div>
      {wizardOpen && <AddDeviceWizard />}
      <Toast />
    </div>
  );
}
