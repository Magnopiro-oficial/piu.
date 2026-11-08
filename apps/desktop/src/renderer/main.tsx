import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
// Galeria da chamada de voz, só em desenvolvimento e no navegador (`npm run dev:renderer` → /?gallery=call).
// No build de produção `import.meta.env.DEV` é `false` e o import some do pacote.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('gallery') === 'call') {
  void import('./call/dev/CallGallery').then(({ CallGallery }) => root.render(<StrictMode><CallGallery /></StrictMode>));
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
