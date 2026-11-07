// Aplica o tema antes da primeira pintura (sem piscar). Mesma chave do painel do provider.
// Arquivo externo (e não script inline) para permitir uma CSP estrita: script-src 'self'.
(() => {
  let t = null;
  try { t = localStorage.getItem('piu-theme'); } catch { /* modo privado */ }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.piuTheme = t;
  // Anti-clickjacking: o GitHub Pages não aplica public/_headers (frame-ancestors/X-Frame-Options), e
  // frame-ancestors não vale em <meta>. Nenhuma página do site é feita para ficar dentro de iframe
  // (o painel em /painel/ tem o próprio HTML e não carrega este arquivo): se estiver, some e tenta sair.
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location.replace(window.self.location.href); } catch { /* bloqueado pelo navegador: fica oculto */ }
  }
})();
