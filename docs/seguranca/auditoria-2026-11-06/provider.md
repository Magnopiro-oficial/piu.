# Auditoria AppSec — piu. Provider (apps/provider-panel + apps/provider-desktop)

Data: 2026-11-06 · Modo: somente leitura (nenhum arquivo do repositório foi alterado)
Escopo: `apps/provider-panel` (Vite + React 19) e `apps/provider-desktop` (Electron 45.2.1, embute o `apps/piu-node`).
Base: OWASP Top 10 2021, checklist de segurança do Electron, revisão de frontend e `npm audit --omit=dev`.
Onde a análise exigiu, foram lidas as rotas do `piu-node` que o painel chama (o desktop roda esse código no processo principal).

## Resumo

| Severidade | Qtde |
|---|---|
| Crítica | 0 |
| Alta | 0 |
| Média | 2 |
| Baixa | 5 |
| Info | 4 |

**Nota proposta: 86/100.** A superfície é pequena e bem defendida: não há preload, IPC, `nodeIntegration` nem webview. Há sandbox global, certificado fixado, bloqueio de origem no `webRequest`, CSP estrita, sessão em cookie `__Host-` HttpOnly/SameSite=Strict com CSRF, e anti DNS rebinding. Os pontos abertos são de reforço (defense in depth) e de cadeia de distribuição. Nenhum é explorável remotamente sem uma condição prévia.

### Invariante "a chave da carteira só existe no celular": CONFIRMADA
- O painel não importa `walletKey`, `extrinsic`, `@scure/sr25519` nem `bip39`. Nenhum campo pede frase ou semente. `grep mnemonic|phrase|secret|privat` em `provider-panel/src` só acha comentários.
- No `piu-node`, `walletKeyFromPhrase`, `withWalletKey`, `signWithWalletKey` e `buildTransferKeepAlive` (arquivos `lunes/walletKey.ts` e `lunes/extrinsic.ts`, gerados a partir do mobile) não são chamados fora dos testes. O nó só **verifica** (`verifyWalletSignature`, `lunes/signing.ts:34`) o extrinsic que o celular assinou. Ele confere assinante, call, era e nonce, faz `validate_transaction` e só depois envia.
- No bundle entregue, `provider-desktop/dist/main.cjs` (sem minificação), o esbuild removeu as funções de assinatura: 0 ocorrências de `buildTransferKeepAlive`, `walletKeyFromPhrase` e `signWithWalletKey`.
- A transferência on-chain (`POST /api/wallet/lunes/transfer`, `piu-node/src/app.ts:660-668`) recusa com 409 quando não há celular pareado: "é ele que guarda a chave e assina".
- Ressalva (Info I-03): `POST /api/wallet/transfer`, chamado pelo painel em `api.ts:161`, "executa na hora" quando não há celular. É só um lançamento no **livro interno** (`store.transfer`, `piu-node/src/store.ts:249-257`): debita o saldo local e não assina nada nem toca a Mainnet. Não fere a invariante, mas a palavra "transferir" pode confundir.
- A desktop guarda chaves **Ed25519 de operador e do nó** (assinam certificados de equipamento e recibos). Elas não têm relação com a carteira Lunes (ver B-03).

---

## Achados

### M-01 — Auto-pareamento roda no mundo da página e entrega um código que também serve de step-up
- **Severidade:** Média
- **OWASP:** A04:2021 Insecure Design / A07:2021 Identification and Authentication Failures
- **Local:** `apps/provider-desktop/src/main.ts:165-178`. Relacionado: `apps/piu-node/src/server.ts:84` e `apps/piu-node/src/app.ts:225-257` (a mesma instância de `Pairing` atende `/api/pair` e `/api/reauth`).
- **Evidência:**
  ```ts
  const status = await win.webContents.executeJavaScript(`fetch('/api/session', …).then(r => r.status)`);
  if (status !== 401) return;
  const body = JSON.stringify({ code: node!.issueCode(), name: operatorName() });
  const ok = await win.webContents.executeJavaScript(`fetch('/api/pair', { … body: ${JSON.stringify(body)} })…`);
  ```
  `executeJavaScript` roda no **mundo principal** da página, o mesmo do JavaScript do painel. O código gerado é de uso único e vale 10 minutos. Ele é aceito tanto por `/api/pair` quanto por `/api/reauth`, o step-up que libera transferências, backup/restauração/rotação da chave de operador, encerramento de sessões e reinício.
- **Cenário de exploração:** exige JavaScript hostil já rodando na origem do painel, por XSS futuro ou dependência comprometida (react, qrcode-generator, fontsource). Hoje não há XSS conhecido e a CSP é `script-src 'self'`. Esse script troca `window.fetch` por um wrapper, chama `POST /api/logout` e recarrega. No `did-finish-load` o processo principal vê 401 e gera um código **novo**. O wrapper captura o código no corpo de `/api/pair` e, em vez de parear, usa o código em `/api/reauth` com a sessão que ele próprio abriu em seguida (ou deixa o pareamento passar e pede outro ciclo). Resultado: step-up de 5 minutos sem o operador ver código nenhum. Isso anula a garantia do README de que o código "aparece só num diálogo local". Também permite trocar o endereço Lunes de recebimento (`PUT /api/wallet/lunes`), restaurar uma chave de operador do atacante e lançar transferências no livro interno quando não há celular.
- **Efeito colateral (bug):** `autoPair` chama `issueCode()` sem atualizar `latestCode` (linha 171). Se o pareamento automático falhar, "Nó → Mostrar código" (linha 190) mostra um código já invalidado. O operador erra, e cinco erros bloqueiam o código por 60 s.
- **Correção:** criar a sessão **no processo principal**, sem código e sem passar pelo renderer, e gravar o cookie direto na sessão do Electron. O `piu-node` roda no mesmo processo, então basta expor um método local. A mudança é pequena e toca o `piu-node`.

  ANTES (`provider-desktop/src/main.ts:165-178`):
  ```ts
  async function autoPair() {
    …
    const body = JSON.stringify({ code: node!.issueCode(), name: operatorName() });
    const ok = await win.webContents.executeJavaScript(`fetch('/api/pair', { … body: ${JSON.stringify(body)} }).then(r => r.ok)`);
    if (ok) win.webContents.reload();
  }
  ```
  DEPOIS:
  ```ts
  // piu-node/src/server.ts — só para quem embute o nó (nunca exposto por HTTP)
  //   localSession: (name: string) => ({ token, csrf })   // mesma lógica de /api/pair, sem Pairing
  async function autoPair() {
    if (!win || !node || pairing) return;
    pairing = true;
    try {
      const url = node.url + '/';
      const has = (await session.defaultSession.cookies.get({ url, name: '__Host-piu_session' })).length > 0;
      if (has && (await win.webContents.executeJavaScript(`fetch('/api/session').then(r => r.status)`)) !== 401) return;
      const { token } = node.localSession(operatorName());          // nenhum código é gerado
      await session.defaultSession.cookies.set({ url, name: '__Host-piu_session', value: token,
        secure: true, httpOnly: true, sameSite: 'strict', path: '/' }); // sem domain = host-only (__Host-)
      win.webContents.reload();
    } finally { pairing = false; }
  }
  ```
  Complementar no `piu-node`, fora do escopo: separar o código de **step-up** do código de **pareamento** (`Pairing` distintos), para que um nunca sirva de outro.
- **Muda o comportamento visível?** Não. A janela continua pareando sozinha com o nome do usuário do sistema. Some só o caso em que o diálogo mostrava um código vencido.

### M-02 — Distribuição sem assinatura de código nem notarização; checksums no mesmo canal
- **Severidade:** Média
- **OWASP:** A08:2021 Software and Data Integrity Failures
- **Local:** `apps/provider-desktop/electron-builder.yml:40-45` (`identity: "-"`, `hardenedRuntime: false`), `:49-56` (Windows NSIS sem assinatura), `README.md:39` ("clique com o botão direito no app → Abrir").
- **Evidência:** no macOS a assinatura é ad-hoc, sem Developer ID e sem notarização, e o hardened runtime está desligado. No Windows não há Authenticode. O `SHA256SUMS.txt` é publicado no mesmo release do GitHub que os binários.
- **Cenário de exploração:** alguém com acesso de escrita ao release (token de CI vazado, conta comprometida) ou um mirror falso distribui um `.dmg`/`.exe` adulterado. O checksum é trocado junto e não há assinatura para o SO ou o usuário recusar. O README ensina a contornar o Gatekeeper, o que acostuma o usuário a aceitar binários não verificados. Esse binário roda o nó com a chave de operador do provider e o painel com step-up.
- **Correção:**

  ANTES (`electron-builder.yml`):
  ```yaml
  mac:
    identity: "-"
    hardenedRuntime: false
  win:
    target: [{ target: nsis, arch: [x64] }]
  ```
  DEPOIS:
  ```yaml
  mac:
    identity: "Lunes Network (TEAMID)"   # Developer ID Application
    hardenedRuntime: true
    gatekeeperAssess: false
    entitlements: assets/entitlements.mac.plist          # allow-jit só se necessário
    entitlementsInherit: assets/entitlements.mac.plist
    notarize: true                                       # APPLE_API_KEY / APPLE_API_ISSUER no CI
  win:
    target: [{ target: nsis, arch: [x64] }]
    azureSignOptions: { endpoint: "...", certificateProfileName: "...", codeSigningAccountName: "..." }
  ```
  Além disso, assinar o `SHA256SUMS.txt` (minisign/cosign) com uma chave publicada fora do GitHub, por exemplo no site da Lunes. Pode ser a mesma família de chave do `PIU_RELEASE_PUBKEY`.
- **Muda o comportamento visível?** Sim. Somem o aviso de "desenvolvedor não identificado" e o SmartScreen, e o passo do README "botão direito → Abrir" deixa de existir. Exige conta Apple Developer e certificado de assinatura no Windows (decisão da Lunes, já listada como pendente).

### B-01 — Sem atualização automática nem aviso de versão
- **Severidade:** Baixa
- **OWASP:** A06:2021 Vulnerable and Outdated Components
- **Local:** `apps/provider-desktop/README.md:45` ("Não há atualização automática"). Não há `electron-updater` no `package.json`.
- **Evidência:** o Chromium/Node do Electron 45.2.1 fica congelado em cada instalação até o usuário baixar outra manualmente.
- **Cenário:** sai um CVE de Chromium (V8, Skia) que permite RCE no renderer. Instalações antigas ficam vulneráveis indefinidamente, e com o renderer comprometido entra o cenário de M-01.
- **Correção:** só depois de M-02, porque update sem assinatura é pior que nenhum.

  ANTES: nada.

  DEPOIS (`main.ts`, processo principal, fora da sessão bloqueada da janela):
  ```ts
  import { autoUpdater } from 'electron-updater';
  autoUpdater.autoDownload = false;          // pergunta antes; o app funciona offline
  app.whenReady().then(() => autoUpdater.checkForUpdates().catch(() => {}));
  autoUpdater.on('update-available', i => dialog.showMessageBox({ message: `Versão ${i.version} disponível`, buttons: ['Baixar', 'Depois'] }) /* … */);
  ```
  O `electron-updater` confere a assinatura do pacote (macOS: mesma Team ID; Windows: `publisherName`). A alternativa mínima é um aviso de versão nova, sem download.
- **Muda o comportamento visível?** Sim. Aparece um aviso de atualização e há uma requisição de rede opcional (o app hoje é 100% offline).

### B-02 — `shell.openExternal` aceita qualquer URL `https://`
- **Severidade:** Baixa
- **OWASP:** A01:2021 Broken Access Control (checklist Electron: "não use openExternal com conteúdo não confiável")
- **Local:** `apps/provider-desktop/src/main.ts:122-125`
- **Evidência:**
  ```ts
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') && !url.startsWith(origin())) void shell.openExternal(url);
    return { action: 'deny' };
  });
  ```
  O único link externo legítimo do painel é o explorer (`Wallet.tsx:267`, `lw.explorer`, a constante `LUNES_EXPLORER = https://blockexplorer.lunes.io/` em `piu-node/src/lunes/lunesRpc.ts:29`).
- **Cenário:** com script na página, o mesmo pré-requisito de M-01, `window.open('https://phishing.example/piu-backup')` abre o navegador padrão numa página falsa "do Piu", que pede o backup e a senha da chave de operador. O `https://` impede esquemas perigosos (`file:`, `smb:`, handlers customizados). Por isso o risco é baixo.
- **Correção:**

  ANTES: o trecho acima.

  DEPOIS:
  ```ts
  const EXTERNAL_HOSTS = new Set(['blockexplorer.lunes.io', 'github.com']);
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) void shell.openExternal(u.toString());
    } catch { /* URL inválida */ }
    return { action: 'deny' };
  });
  ```
- **Muda o comportamento visível?** Não. O único link externo usado hoje (explorer) continua abrindo.

### B-03 — Chaves Ed25519 (operador e nó) em texto puro no disco
- **Severidade:** Baixa
- **OWASP:** A02:2021 Cryptographic Failures (dados em repouso)
- **Local:** `apps/provider-desktop/src/main.ts:67` (`dataDir: <userData>/node`). Os arquivos são `piu-node/src/operator.ts:5` (`<data>/operator/keys.json`, semente em hex, 0600) e `piu-node/src/relay/identity.ts:17` (semente do nó, 0600).
- **Evidência:** a permissão 0600/0700 está certa, mas a semente não é cifrada. Fica em `~/Library/Application Support/Piu Provider/node` (macOS) ou `~/.config/Piu Provider/node` (Linux), que entram em backups do Time Machine e de nuvem e em cópias da pasta de usuário.
- **Cenário:** um backup não cifrado, ou um malware rodando com o mesmo usuário, lê `keys.json`. O atacante assina certificados de equipamento e listas de revogação em nome do operador: põe nós falsos na malha do operador ou revoga os legítimos. Não dá acesso a fundos (a carteira está no celular).
- **Correção** (só no desktop, que tem `safeStorage` via Keychain/libsecret): cifrar a semente antes de gravar e passar ao `piu-node` um "selador" opcional.

  ANTES (`piu-node`): `writeFileAtomic(file, JSON.stringify({ …, seed }))`

  DEPOIS:
  ```ts
  // provider-desktop/src/main.ts
  import { safeStorage } from 'electron';
  const sealer = safeStorage.isEncryptionAvailable()
    ? { seal: (b: Buffer) => safeStorage.encryptString(b.toString('base64')), open: (b: Buffer) => Buffer.from(safeStorage.decryptString(b), 'base64') }
    : null;   // Linux sem keyring: mantém o comportamento atual
  node = await startNode({ ...config, keySealer: sealer }, …);
  ```
  E no `piu-node`, com `keySealer` presente: `keys.json` guarda `sealer.seal(seed)` e, ao ler, `sealer.open(...)`, com migração do formato antigo.
- **Muda o comportamento visível?** Não, no uso normal (o Keychain libera para o próprio app). Pode aparecer um prompt do Keychain na primeira vez no macOS sem Developer ID.

### B-04 — Fuses do Electron incompletos
- **Severidade:** Baixa
- **OWASP:** A05:2021 Security Misconfiguration
- **Local:** `apps/provider-desktop/electron-builder.yml:22-28`
- **Evidência:** `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar` e `enableCookieEncryption` estão bem configurados. Falta `grantFileProtocolExtraPrivileges: false`: `file://` mantém privilégios extras, embora o app nunca use `file://` e o `webRequest` já o bloqueie.
- **Cenário:** só como defesa em profundidade, se um dia a janela carregar `file://` (por exemplo, uma tela de erro local).
- **Correção:**

  ANTES:
  ```yaml
  electronFuses:
    runAsNode: false
    …
    onlyLoadAppFromAsar: true
  ```
  DEPOIS:
  ```yaml
  electronFuses:
    runAsNode: false
    …
    onlyLoadAppFromAsar: true
    grantFileProtocolExtraPrivileges: false
  ```
- **Muda o comportamento visível?** Não.

### B-05 — Servidor de desenvolvimento do Vite exposto na rede e sem CSP
- **Severidade:** Baixa (só desenvolvimento)
- **OWASP:** A05:2021 Security Misconfiguration
- **Local:** `apps/provider-panel/vite.config.ts:7-11` (remove a CSP no `serve`) e `:20-21` (`server`/`preview` com `host: true` na porta 8420).
- **Evidência:** `npm run dev`/`preview` escuta em `0.0.0.0:8420`, a mesma porta do `piu-node`, sem CSP. Qualquer máquina da rede (Wi-Fi de café, coworking) acessa o painel de desenvolvimento e o código-fonte via `/@fs`/`/src`. Como o painel cai em modo demo, não há segredo exposto.
- **Cenário:** exposição de código-fonte e superfície do dev server, já que o Vite teve CVEs de leitura arbitrária via `/@fs` em versões passadas.
- **Correção:**

  ANTES: `server: { port: 8420, host: true }, preview: { port: 8420, host: true },`

  DEPOIS:
  ```ts
  server: { port: 5173, host: '127.0.0.1', strictPort: true },
  preview: { port: 4173, host: '127.0.0.1' },
  // Teste em outro aparelho: `vite --host` de forma explícita, quando precisar.
  ```
- **Muda o comportamento visível?** Sim, só para desenvolvedores: o dev server deixa de ser acessível pelo celular sem `--host`. Mudar a porta também evita conflito com o `piu-node` local.

---

## Informativos (sem risco atual)

- **I-01 — `localStorage` sem try/catch em `state/store.tsx:38` e `:204`.** Guarda só o tema. Os outros usos (`i18n/index.ts:61,64,102,109`, `lib/guide.ts:55,58`) já têm try/catch, e nada sensível vai para o storage (só tema, idioma, região e "guia oculto"). Em navegador com storage bloqueado, `initialTheme()` lança exceção e o painel não monta. É robustez, não segurança: envolver em `try { … } catch { return null }`. Não muda o comportamento visível.
- **I-02 — O `webRequest` permite `data:`, `blob:` e `devtools://`** (`main.ts:117`). `data:`/`blob:` servem para os downloads (CSV, backup) e para `img-src data:`. A navegação para `data:` já é barrada por `will-navigate`. Pode ficar assim.
- **I-03 — `POST /api/wallet/transfer` sem celular executa direto** (`api.ts:160-161`; nó: `app.ts:722-731`). É um lançamento no livro interno (`store.transfer`), com step-up obrigatório. Sugestão de produto: chamar de "registrar saque" ou exigir celular também aqui, para alinhar com "Assinar no celular".
- **I-04 — `npm audit`:**
  - `provider-panel --omit=dev`: **0** vulnerabilidades (8 dependências de produção).
  - `provider-desktop --omit=dev`: **0**. A auditoria vê só 1 dependência de produção, porque `electron` e o bundler são devDependencies e as dependências do `piu-node` entram no `main.cjs`.
  - `piu-node --omit=dev`, que é o que o desktop empacota: **0**.
  - `provider-desktop` completo, com dev: **6 moderadas** na cadeia `electron-builder` → `app-builder-lib` / `dmg-builder` / `@electron/universal` → `minimatch` (ReDoS em globparts). Só afetam o build, nenhuma high ou critical. Basta atualizar o `electron-builder` quando sair o patch.

## Itens do checklist sem achado (OK)

| Item | Situação |
|---|---|
| `contextIsolation` | `true` (`main.ts:141`) |
| `nodeIntegration` | `false` |
| `sandbox` | `true` na janela e `app.enableSandbox()` global (`main.ts:25`) |
| Preload / IPC | **Nenhum** preload e nenhum `ipcMain` (superfície zero; validação de sender não se aplica) |
| `webSecurity` / `allowRunningInsecureContent` | padrão (ativos), não sobrescritos |
| `webviewTag` | `false` + `will-attach-webview` bloqueado |
| Navegação | `will-navigate` e `will-redirect` presos à origem do nó; `window.open` sempre `deny` |
| Conteúdo remoto | nenhum: `webRequest.onBeforeRequest` cancela toda origem fora do nó |
| TLS | `setCertificateVerifyProc` aceita só `localhost` com o PEM do próprio nó (pinning) |
| Permissões | todas negadas, exceto `clipboard-sanitized-write` (request e check handlers) |
| DevTools | desligado quando empacotado (`devTools: !app.isPackaged`, menu idem) |
| CSP | `default-src 'none'; script-src 'self'; …; frame-ancestors 'none'` por header (Helmet no nó) e `<meta>`; sem `unsafe-inline` em script |
| Headers | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, COOP/CORP, Permissions-Policy, `Cache-Control: no-store` em `/api/` |
| CORS | nenhum plugin de CORS registrado: sem `Access-Control-Allow-Origin` (correto para API de mesma origem) |
| DNS rebinding | `Host` fora da lista recebe 421; por padrão escuta só em `127.0.0.1` |
| Sessão | cookie `__Host-piu_session`, HttpOnly, Secure, SameSite=Strict; token só como hash; logs com `redact` de cookie/CSRF |
| CSRF | `X-CSRF-Token` + checagem de `Origin`/`Sec-Fetch-Site` em todo POST/PUT/DELETE, inclusive `/api/pair` (anti login-CSRF) |
| Força bruta | código de 8 dígitos, uso único, 10 min, destruído após 5 erros, 60 s até o próximo; rate limit de 5/10 min por rota |
| Step-up | operações sensíveis exigem código recente (5 min) |
| IDs | UUID (`randomUUID`) e rotas com `pattern: UUID`; ids `'tx'+Date.now()` só nas linhas otimistas da UI/demonstração |
| XSS | nenhum `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` ou `document.write`; único `href` dinâmico é constante do servidor, com `rel="noopener noreferrer"` |
| Clickjacking | `frame-ancestors 'none'` + XFO + o painel cai para "demo" quando está num iframe (`api.ts:107`) |
| Segredos no bundle | nenhum em `provider-panel/dist` nem em `provider-desktop/dist/main.cjs` (busca por chaves, tokens e PEM privados) |
| Criptografia falsa | nenhuma: base64url só como codificação de armazenamento; backup com scrypt (N limitado entre MIN_N e MAX_N) + XChaCha20-Poly1305 com cabeçalho como AAD |
| Arquivo de restauração | limite de 256 KiB no painel e no nó; parâmetros do KDF validados (sem DoS de memória por N arbitrário) |
| Preferências | `desktop.json` 0600, pasta 0700, gravação atômica, parse com coerção para booleano |
| Instância única | `requestSingleInstanceLock` |

## Logs de console no código de produção

| Arquivo:linha | Conteúdo | Em produção? |
|---|---|---|
| `apps/provider-desktop/src/main.ts:75` | `log: msg => { if (!app.isPackaged) console.log(msg); }` | **Não** (só fora do pacote). O código de pareamento vai por `onCode`, nunca por `log`. |
| `apps/provider-panel/scripts/check-responsive.mjs:137,138,139,142` | mensagens do script de checagem responsiva | Não (ferramenta de dev, fora do bundle) |
| `apps/provider-panel/src/**` | **nenhum** `console.*` | — |
| `apps/provider-desktop/build.mjs:19` | `console.log('dist/main.cjs pronto')` | Não (script de build) |

## Prioridade sugerida
1. **M-01**: pareamento automático no processo principal, sem código. Mudança pequena, que fecha o único caminho em que JavaScript na página consegue step-up.
2. **M-02**: Developer ID + notarização + Authenticode + `SHA256SUMS` assinado. Pré-requisito para B-01.
3. **B-02** e **B-04**: uma linha cada.
4. **B-03**: `safeStorage` para as sementes Ed25519.
5. **B-01**: atualização automática assinada, depois de M-02.

---

## Correções aplicadas (06/11/2026)

Escopo: `apps/provider-desktop`, `apps/provider-panel` e a parte do `apps/piu-node` que o desktop usa. Nenhuma mudança no fio nem nos fluxos aprovados (pareamento de outros navegadores, login do painel, step-up, relay).

Verificação: `piu-node` com 104 testes (103 passando; a falha restante, `lunes.test.ts` "cópia fiel de apps/mobile/src/lib", já existia e vem de edições em andamento no `apps/mobile`). `provider-desktop`: `npm run typecheck`, `npm test` (novo, 1 teste) e `npm run build` passam. `provider-panel`: `npm run typecheck`, `npm test` (97 testes, igual a antes) e `npm run build` passam. O app Electron **não** foi aberto nesta rodada: o caminho do cookie foi coberto pelo teste do `piu-node` e pelo typecheck da API do Electron.

| Achado | Status | Arquivos |
|---|---|---|
| M-01 | **corrigido** (e o bug do `latestCode`) | `provider-desktop/src/main.ts`; `piu-node/src/app.ts`, `src/server.ts`, `src/security/session.ts` |
| M-02 | adiado: exige conta Apple Developer e certificado Authenticode (custo, decisão da Lunes) | — |
| B-01 | adiado: depende de M-02 (atualização sem assinatura é pior que nenhuma) | — |
| B-02 | **corrigido** | `provider-desktop/src/external.ts` (novo), `src/main.ts` |
| B-03 | adiado: exige um "selador" no `piu-node` e migração do `keys.json`; o prompt do Keychain sem Developer ID e o Linux sem keyring pedem teste em aparelho. Não é trivial nem sem risco de perder a chave | — |
| B-04 | **corrigido** | `provider-desktop/electron-builder.yml` |
| B-05 | **corrigido** (só o `host`; a porta continua 8420) | `provider-panel/vite.config.ts`, `README.md` |
| I-01 a I-04 | sem mudança (informativos) | — |

### M-01 — auto-pareamento pelo mundo da página
- ANTES: `autoPair` fazia `executeJavaScript(fetch('/api/session'))` e, com 401, gerava um código (`node.issueCode()`) e o mandava para `/api/pair` pelo JavaScript da página. O código, que também serve de step-up, passava pelo renderer, e `latestCode` ficava com um código já invalidado.
- DEPOIS: nada de `executeJavaScript` nem de código. O processo principal confere o cookie atual direto no nó embutido (`node.app.inject('/api/session')`, sem rede e sem a página). Se não houver sessão viva, cria uma com `node.localSession(nome, rótulo)` e grava o token com `session.defaultSession.cookies.set` (`__Host-piu_session`, `secure`, `httpOnly`, `sameSite: 'strict'`, `path: '/'`, sem `domain`, validade de 12 h como a do nó). Só recarrega se o cookie gravado bater e a sessão responder, para não entrar em loop de recarga. Como nenhum código é gerado, o código de Nó → Mostrar código continua válido (o bug do `latestCode` some).
- Reforço além do proposto: a sessão local nasce **sem step-up** (`authAt = 0`). Antes (e na proposta do relatório), um script hostil que chamasse `/api/logout` e recarregasse ganhava uma sessão nova com step-up de 15 min sem ver código nenhum. Agora ganha só a sessão; transferir, backup, restauração ou rotação da chave, encerrar sessões e reiniciar continuam pedindo o código do diálogo nativo.
- Teste (no `piu-node`): "sessão local (app desktop): abre sem código, não consome o código vigente e não vale como step-up". Confere também que o mesmo nome volta à mesma conta, que o step-up pelo código continua funcionando e que não há rota HTTP para isso.
- Visível: **sim, pouco**. Na primeira operação sensível depois de abrir o app, o painel pede o código (Nó → Mostrar código, Cmd/Ctrl+K). Antes, os primeiros 15 min depois de abrir dispensavam o código.
- Complemento adiado (no `piu-node`): códigos separados para pareamento e step-up (`Pairing` distintos).

### B-02 — `shell.openExternal` com qualquer `https://`
- ANTES: `if (url.startsWith('https://') && !url.startsWith(origin())) void shell.openExternal(url);`
- DEPOIS: `externalUrl(url)` só aceita `https:` sem porta e sem usuário/senha, com host exato em `EXTERNAL_HOSTS = {'blockexplorer.lunes.io'}` (o `github.com` do exemplo ficou de fora porque o painel não tem link para ele). A URL vai normalizada para o `openExternal`.
- Teste: `provider-desktop/test/external.test.ts` (o pacote ganhou `npm test`: `node --test test/*.test.ts`, com o strip de tipos do Node 22). Cobre o explorer, subdomínio, sufixo enganoso, `user@host`, porta, `http:`, `file:`, `smb:` e `javascript:`.
- Visível: não. O botão do explorer na Carteira continua abrindo.

### B-04 — fuse `grantFileProtocolExtraPrivileges`
- ANTES: ausente (o padrão do Electron mantém os privilégios extras de `file://`).
- DEPOIS: `grantFileProtocolExtraPrivileges: false` em `electronFuses`. A versão do `electron-builder` do projeto (26.18.1) conhece esse fuse.
- Teste: não há teste automatizado de fuses (só vale no pacote gerado por `dist:*`, que não foi rodado). O app nunca carrega `file://`.

### B-05 — dev server do Vite na rede
- ANTES: `server`/`preview` com `host: true` (`0.0.0.0:8420`), sem CSP.
- DEPOIS: `host: 'localhost'` nos dois (e `strictPort` no dev). Para testar de outro aparelho: `npm run dev -- --host`, de forma explícita. A porta continua 8420, para não mudar o README nem o hábito de quem desenvolve; o conflito com um `piu-node` local na mesma porta continua.
- Teste: não há (configuração de desenvolvimento). `check:responsive` serve o `dist` por conta própria e não depende do dev server.
