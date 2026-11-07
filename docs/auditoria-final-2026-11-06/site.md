# Auditoria final do site (apps/site) — 06/11/2026

Escopo: `apps/site` (Astro 7, PT em `/` e EN em `/en/`, página "A rede" em `/rede/` e `/en/rede/`, painel do provider embutido em `/painel/`).
Fonte da verdade usada para cada afirmação: marcas de estado de `docs/rede/fluxograma-rede-piu.md` (✅ 🧪 🔜) e o código dos apps.
Nada foi commitado, enviado ou publicado.

Legenda: **I** implementado e testado · **P** parcial · **F** com falha · **E** depende de algo externo (documentado).

## Resumo

| Item do CHECKLIST | Parte do site | Status | Prova |
|---|---|---|---|
| 1 · Melhorias de design (site PT/EN, seção Desktop) | Animações, seção Desktop com abas e prévia ao vivo, toast | **I** | Render em Chromium/Firefox/WebKit, 4 larguras, claro/escuro, movimento reduzido (abaixo); frases do protótipo conferidas uma a uma |
| 8 · Fontes empacotadas | Geist, Geist Mono e Material Symbols locais | **I** | 72 arquivos .woff/.woff2 no `dist`; nenhuma `url(http…)` em CSS/JS; CSP `font-src 'self'` sem violação |
| 15 · Downloads de fonte única, segurança, instalação, verificação, textos honestos | `releases.json` ← `sync-release.mjs` | **I** / **E** | `--dry-run` contra o GitHub real = idêntico ao `releases.json`; Desktop/Provider "em breve" até os releases saírem (E) |
| 24 · Página "A rede" | `/rede/`, `/en/rede/` | **I** | Marcas JÁ FUNCIONA/EM TESTE/A CAMINHO batem com o fluxograma; render sem erro |
| 27 · Segurança | CSP, headers, dependências | **I** / **E** | CSP por hash válida; 0 vulnerabilidades; headers HTTP não aplicáveis no GitHub Pages (E) |
| 28 · Testes/build | `npm run build` (astro check) + Playwright | **I** | 0 erros, 0 avisos; matriz de render sem overflow, sem erro de console, sem violação de CSP |

## 1. Requisitos e conteúdo

### 1.1 Seções, botões e interações (home PT e EN)
| Elemento | Status | Prova |
|---|---|---|
| Barra do topo: logo, âncoras (Como funciona, A rede, Privacidade, Provider, LUNES, Desktop, Dúvidas), PT/EN, GitHub, tema, Baixar | I | Todas as âncoras internas têm o `id` de destino (checador de links: 0 problemas) |
| Troca de idioma | I | Playwright: `/` → `/en/` (`lang=en`) → `/` (`lang=pt-BR`) nos 3 navegadores |
| Tema claro/escuro | I | Playwright: alterna, salva em `localStorage` e sobrevive ao recarregar; `theme-init.js` aplica antes da primeira pintura; o painel embutido acompanha (`postMessage` com `location.origin`) |
| Herói, faixa "Viaja por", Como funciona, recursos, Privacidade, Segurança, Provider (painel embutido), LUNES, Baixar, Verificar, Desktop, Código aberto, Dúvidas (8), rodapé | I | Render nas 4 larguras; mesmas seções do protótipo (`topo, como, privacidade, provider, lunes, baixar, desktop, faq`) + `#seguranca` e `#verificar` acrescentadas de propósito |
| Toast de download | I | Playwright: clicar "Como receber" mostra o aviso; "Fechar aviso" esconde |
| Abas do Desktop (macOS/Linux/Windows) | I | Playwright: cada aba fica `aria-selected=true` e mostra o próprio painel; a aba inicial segue o sistema do visitante |
| Dúvidas (`<details name="faq">`) | I | 8 itens, o primeiro aberto, alternam ao clicar |
| Cartões de download | I | Android: link direto para `Piu-0.1.0.apk` (33 MB) do release `android-v0.1.0`; "De um amigo": instruções; Piu Node, Desktop e Provider: "em breve" sem link (nenhum `<a>` sem `href`) |

### 1.2 Comparação com o protótipo
Comparei todas as frases de `Piu Site.dc.html`, `Piu Site EN.dc.html` e `Piu Site Rede.dc.html` com os textos do site. A página "A rede" não tem diferenças. Na home, as únicas diferenças são correções de honestidade feitas de propósito:
- "Android 9 ou superior" → "Android 7 ou superior (celulares de 64 bits)": é o mínimo real do app (Expo, `minSdk` 24) e o APK de release só tem `lib/arm64-v8a` e `lib/x86_64`.
- "Avisos da Defesa Civil… assinatura oficial" → "Alertas da comunidade": não existe integração com a Defesa Civil no código.
- "Na primeira abertura, o app confere a própria assinatura" → ver correção 4 abaixo.
- "Pacotes .ipk/.deb… todos assinados" → "ainda não foram publicados".
- Fontes do Google (protótipo) → fontes locais (CSP `font-src 'self'`).

### 1.3 Links (checador próprio sobre o `dist` + HEAD/GET em cada URL externa)
- Internos: 0 problemas (arquivos e âncoras existem em `/`, `/en/`, `/rede/`, `/en/rede/`, `/painel/`).
- Externos, todos **200**: repositório; `releases/download/android-v0.1.0/Piu-0.1.0.apk`; `tree/main/design`; `MANIFESTO.md`; `MANIFESTO.en.md`; `docs/lnnp/especificacao-v1.md`; `tree/main/docs/requisitos`; `docs/rede/fluxograma-rede-piu.md`.
- O link "Release no GitHub" do Desktop/Provider só aparece quando o release está publicado: hoje `desktop-v0.1.0` não existe (daria 404) e não é exibido.

### 1.4 Downloads de fonte única
`node scripts/sync-release.mjs --dry-run` contra os releases reais:
```
android: android-v0.1.0 publicado em 2026-11-05T00:08:15Z · 1 arquivo(s)
desktop: desktop-v0.1.0 não existe no GitHub → em breve
provider: provider-v0.1.0 é rascunho (links não são públicos) → em breve
```
A saída é idêntica ao `src/lib/releases.json` atual (diff vazio). `gh release list`: "Piu 0.1.0 para Android" (Latest) e "Piu Provider 0.1.0" (Draft). O build recusa `releases.json` torto (`src/lib/releases.ts`: tag/versão, SHA-256 de 64 hexa, tamanho, URL dentro do release).

### 1.5 Lançamento sem certificados Apple/Windows
- Nenhum texto diz "assinado pela Apple/Microsoft". O texto exibido quando houver release é "Esta versão ainda não tem assinatura da Apple nem da Microsoft…".
- Instruções presentes por sistema: macOS 15+ "Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim" (e clique direito → Abrir no 14 ou anterior); Windows "SmartScreen → Mais informações → Executar assim mesmo"; Linux `chmod +x` / `apt install ./…deb`.
- Seção "Como verificar o download" com comandos para macOS, Windows, Linux (`sha256sum -c SHA256SUMS.txt`) e Android (`apksigner verify --print-certs`). A linha "lista de hashes assinada com a chave do projeto" só aparece quando a chave GPG existir (hoje não existe).

### 1.6 Afirmações sobre recursos novos × estado real
| Afirmação | Onde | Estado no fluxograma/código | Resultado |
|---|---|---|---|
| Pontos Piu | `/rede/` camada 3 e seção 06 | 🔜 | "A CAMINHO" / "Em breve" — ok |
| Transferência LUNES pela malha | `/rede/` seção 05, home LUNES | 🧪 (lógica da carteira, sem telas/gateways no ar) | "EM TESTE"/"Em breve"; "hoje, pagar pede internet" — ok |
| Gateways | `/rede/` camada 5 | 🧪 | "EM TESTE" — ok |
| Celular como nó (200 MB/dia, bateria > 30%) | `/rede/` seção 03 | 🧪; `NODE_MODE_LIMITS = { dailyBytes: 200 MiB, batteryPct: 30 }` em `apps/mobile/src/lib/phoneNodeCore.ts` | "(em teste)" — ok |
| Recompensas | home Provider/LUNES, `/rede/` seção 08 | 🧪, desligado por padrão | "Programa ainda não lançado, nada é pago hoje" — ok após correção 2 |
| Rede local no celular | `/rede/` camadas e "O meio certo" | 🔜 no celular, ✅ no Desktop/Node | Texto diz exatamente isso — ok |
| Malha OpenWrt 802.11s | home "Viaja por" | 🔜 | Corrigido (correção 1) |
| Proteções de segurança (biometria, cofre que falha fechado, Touch ID, 3ª palavra, capturas bloqueadas) | home `#seguranca` | `phraseVault.ts`/`vault.ts` (`requireAuthentication`), `desktop/src/renderer/screens/Locked.tsx`, `promptTouchID`, `setContentProtection` em `desktop/src/shared/screenSecurity.ts` | Conferido no código — ok |
| Mensagem guardada "até 48 h" | home Como funciona | `MESSAGE_TTL_SEC = 48 * 3600` (`messenger.ts`); máximo de envelope 7 dias | ok; `/rede/` corrigido (correção 5) |

Placeholders: nenhum além dos "em breve" honestos (Desktop, Provider para computador, Piu Node). Os bônus de boas-vindas/distribuição continuam marcados como "Programa ainda não lançado… Valores ilustrativos".

## 2. Correções feitas

1. **"Wi-Fi Mesh" → "Wi-Fi local"** (faixa "Viaja por" e saltos de "Como funciona", PT e EN). A malha 802.11s está 🔜; LNNP pelo Wi-Fi local está ✅ no Desktop e no Piu Node. Os "5 tipos de conexão" continuam verdadeiros: Bluetooth ✅, Wi-Fi Direct ✅, Wi-Fi local ✅, LoRa ✅, cabo/USB (KISS serial) ✅.
2. **Dúvidas "Como eu ganho LUNES?"** dizia em tom presente que se ganha LUNES. Agora: "Ainda não: o programa de recompensas não foi lançado e nada é pago hoje. Quando abrir…". Provider: "Cada entrega comprovada **pode virar** crédito" (era "vira").
3. **Dúvidas "Precisa de internet?"**: agora diz que a internet não é obrigatória para mensagens, mas a carteira ainda precisa dela para enviar à Mainnet (o envio pela malha está em teste).
4. **Dúvidas "Funciona no iPhone?"** dizia "a versão está a caminho" na App Store. Não há build iOS publicado nem testado. Agora: "Ainda não… por enquanto, só existe o app para Android".
5. **Dica do Desktop** "Na primeira abertura, o app confere a própria integridade" → "No macOS e no Windows, o app confere a cada abertura se o próprio pacote não foi alterado" (é o `enableEmbeddedAsarIntegrityValidation` do `electron-builder.yml`, que não vale no Linux).
6. **`/rede/` passo 2**: "O envelope vale por até 7 dias" → "A mensagem vale por 48 horas" (TTL real das mensagens; 7 dias é o teto do envelope e continua citado no passo do relay).
7. **Anti-iframe** em `public/theme-init.js`: se a página estiver dentro de um iframe, ela some e tenta assumir a janela. Motivo: o GitHub Pages ignora `_headers`, então `frame-ancestors`/`X-Frame-Options` não chegam ao navegador. Testado no Chromium (a página de cima foi levada para o site).
8. **Foco visível** nos campos dos demos (busca e "Mensagem" no celular e no Desktop): os campos tinham `outline: none` em linha. Os de mensagem voltaram a usar o `:focus-visible` global; a busca mostra o contorno no rótulo (`label:has(> input:focus-visible)`).
9. **README do site**: removida a seção "Ainda provisório" (desatualizada: dizia que não havia APK e que o SHA-256 era de exemplo); documentados a fonte única de downloads e o limite do GitHub Pages com headers.

Arquivos alterados: `apps/site/src/i18n/{pt,en,rede.pt,rede.en}.ts`, `apps/site/public/theme-init.js`, `apps/site/src/styles/site.css`, `apps/site/src/components/{PhoneDemo,DesktopDemo}.tsx`, `apps/site/README.md`.

## 3. Segurança

| Item | Status | Prova |
|---|---|---|
| CSP | I | `<meta>` gerada pelo Astro em cada página: `default-src 'none'`, `script-src 'self'` + 7 hashes, sem `'unsafe-inline'`/`'unsafe-eval'` para scripts, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Script próprio recalculou o SHA-256 de cada `<script>` inline (3 na home): todos listados. 0 violações de CSP nos 3 navegadores |
| Estilos | I (com ressalva) | `style-src 'self'`; `style-src-attr 'unsafe-inline'` só para atributos `style=""` (o layout usa muitos). Atributo `style` não executa código |
| Scripts/recursos externos | I | Nenhum `<script>`, `<link>`, `<img>`, `<iframe>` ou fonte externa; nenhuma `url(http…)`/`fetch` externo em CSS/JS do `dist` |
| Fontes locais | I | 72 arquivos de fonte no `dist` |
| Segredos | I | Varredura do `dist` (chaves privadas, tokens GitHub/AWS/Stripe/Slack, frases de 12 palavras): nada |
| Dependências | I | `npm audit`: 0 vulnerabilidades (com e sem dev). O CI (`ci-site.yml`) falha em alto/crítico |
| Painel embutido | I | CSP própria em `<meta>` (`script-src 'self'`), `referrer no-referrer`; não carrega o `theme-init.js` do site |
| Headers HTTP | **E** | Ver abaixo |

**Headers (bloqueio externo).** O deploy real é o GitHub Pages (`.github/workflows/pages-site.yml`; `gh api …/pages`: `build_type: workflow`, `https_enforced: true`). O GitHub Pages **ignora `public/_headers`** e não deixa configurar headers. Conferido no ar (`curl -I https://magnopiro-oficial.github.io/piu./`): há `strict-transport-security` (do GitHub), mas faltam `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Permissions-Policy`, COOP/CORP. Mitigações já no site: CSP em `<meta>`, `referrer` em `<meta>`, anti-iframe por script (correção 7). O que falta exige mudar a hospedagem: domínio próprio atrás da Cloudflare (Transform Rules) ou Cloudflare Pages usando o `_headers` que já está pronto. O painel em `/painel/` também fica sem `frame-ancestors 'self'` no GitHub Pages (é uma demonstração sem dados reais).

A versão no ar é de 05/11 00:12; estas correções só vão ao ar depois do merge na `main` (o workflow publica sozinho).

## 4. Testes

### 4.1 Build
`npm run build` (painel + `astro check` + build): **0 erros, 0 avisos**, 1 dica (`navigator.platform` obsoleto, usado de propósito como reserva na detecção do sistema). Avisos do Astro sem efeito: Shiki (não usado) e `style-src-attr`.

### 4.2 Navegador embutido (painel do app)
`http://127.0.0.1:4329/` a 559 px, tema escuro: sem erros no console, sem rolagem horizontal, textos corrigidos visíveis ("Wi-Fi local", "Baixar APK · 33 MB").

### 4.3 Playwright (servidor `astro preview` sobre o `dist`)
Matriz por navegador: 4 páginas (`/`, `/en/`, `/rede/`, `/en/rede/`) × 1440/1280/768/375 × claro/escuro + movimento reduzido em 1440 e 375 = **48 renders**. Em cada render: rolagem horizontal real (`scrollTo(9999,0)` → `scrollX`), erros/avisos de console, `pageerror`, respostas HTTP ≥ 400, violações de CSP (`securitypolicyviolation`), `<img>` sem `alt`, links/botões sem nome acessível, iframes sem `title`, um `<h1>` por página, contraste do texto. Depois: interações (tema, idioma, toast, abas, FAQ) e 60 Tabs de teclado conferindo o foco visível.

| Verificação | Chromium 136 | Firefox 146 | WebKit 18.4 |
|---|---|---|---|
| Renders | 48 | 48 | 48 |
| Rolagem horizontal | 0 | 0 | 0 |
| Erros de console / `pageerror` / HTTP ≥ 400 | 0 | 0 erros (só o aviso do Firefox "Layout was forced before the page was fully loaded" vindo do iframe `/painel/`) | 0 do site (ver nota 2) |
| Violações de CSP | 0 | 0 | 0 do site (ver nota 2) |
| `<img>` sem `alt` · links/botões sem nome · iframe sem `title` | 0 · 0 · 0 | 0 · 0 · 0 | 0 · 0 · 0 |
| `<h1>` por página | 1 | 1 | 1 |
| Tema (alterna + salva + recarrega) | ok | ok | ok |
| Idioma PT → EN → PT | ok | ok | ok |
| Toast abre/fecha | ok | ok | ok |
| Abas do Desktop | ok | ok | ok |
| Teclado: 60 Tabs, elementos sem foco visível | 0 | 0 | 0 (ver nota 3) |
| Anti-iframe | ok (a janela de cima foi levada ao site) | não testado (nota 1) | não testado (nota 1) |

Notas:
1. Navegadores: Playwright 1.52 com os navegadores que já estavam em cache (`~/Library/Caches/ms-playwright`), sem baixar nada. O Firefox (Nightly 146) e o WebKit (build `mac13_special`) são de revisões diferentes das esperadas pelo 1.52. Funcionaram, mas o Firefox precisou de `domcontentloaded` em vez de `load`, e o teste do anti-iframe só roda no Chromium (no Firefox o processo do teste caía nesse passo).
2. WebKit e `upgrade-insecure-requests`: o WebKit troca `http://127.0.0.1`/`localhost` por `https://`, então pelo `astro preview` (http) o CSS não carrega no Safari. Em produção (HTTPS obrigatório no GitHub Pages) isso não acontece. Para testar, o `dist` foi servido por HTTPS local (certificado de teste). O único erro restante ("Refused to apply a stylesheet") aparece só nos renders em que o Playwright tira screenshot (1440 e 375). Ele vem do `<style>` que o próprio Playwright injeta para a captura; sem screenshot, nenhuma página dá erro.
3. No WebKit, Tab só passa por campos de formulário (padrão do Safari sem "Pressionar Tab para realçar cada item"); os que receberam foco tinham contorno visível.
4. Antes da correção 8, o Firefox apontava o campo "Mensagem" sem foco visível e o Chromium apontava "Buscar conversas". Os dois passam depois da correção.

Capturas (1440 e 375, claro/escuro, com e sem movimento reduzido) ficaram fora do repositório, na pasta temporária da sessão.

### 4.4 Contraste
O medidor encontrou dois casos, ambos do protótipo e mantidos:
- `/rede/` título "E ninguém lê." em `--ink3` (#9b9b97) sobre branco: 2,79:1 (texto grande pede 3:1). No escuro passa. Sugestão: escurecer `--ink3` claro para ~#8a8a86 se quiserem AA estrito (afeta o site todo).
- `/rede/` seção 03: os passos inativos ficam com opacidade 0,5 enquanto a animação destaca um por vez (2,2:1). Com movimento reduzido todos ficam com opacidade 1 e passam. É estado temporário de animação.
O restante (148–231 textos por render) passa AA. No WebKit, as respostas das Dúvidas também apareceram, porque foram medidas no meio da animação de abertura; no Chromium e no Firefox elas passam.

## 5. Bloqueios externos
1. **Releases do Desktop e do Provider** (`desktop-v0.1.0` inexistente, `provider-v0.1.0` rascunho): o site mostra "em breve" até publicar; depois `node scripts/sync-release.mjs --desktop desktop-v0.1.0 --provider provider-v0.1.0` e `npm run build`.
2. **Chave GPG de release** não criada: a linha "lista de hashes assinada" e o link da chave pública ficam ocultos até existir.
3. **Headers HTTP** no GitHub Pages (seção 3).
4. **Piu Node**: pacotes .ipk/.deb não publicados ("em breve").
5. **APK 0.1.1**: o site aponta para o 0.1.0 publicado; ao publicar o 0.1.1, rodar `sync-release.mjs --android android-v0.1.1` e conferir `ANDROID_CERT_SHA256` com `apksigner`.
