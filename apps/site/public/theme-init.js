// Aplica o tema antes da primeira pintura (sem piscar). Mesma chave do painel do provider.
// Arquivo externo (e não script inline) para permitir uma CSP estrita: script-src 'self'.
(() => {
  let t = null;
  try { t = localStorage.getItem('piu-theme'); } catch { /* modo privado */ }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.piuTheme = t;
})();
