import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import 'material-symbols/rounded.css';
import './styles.css';
import { App } from './App';
import { initI18n } from './i18n';
import { NodeProvider } from './state/node';
import { StoreProvider } from './state/store';

// O dicionário do idioma detectado carrega antes da primeira renderização (sem piscar em pt-BR).
void initI18n().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NodeProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </NodeProvider>
  </StrictMode>,
));
