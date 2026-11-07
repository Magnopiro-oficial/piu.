# Auditoria AppSec — Piu Desktop (`apps/desktop`)

Data: 2026-11-06 · Modo: somente leitura (nenhum arquivo do repositório foi alterado; os dados reais em `~/Library/Application Support/Piu` não foram lidos).
Escopo: `apps/desktop/src/**`, `electron-builder.yml`, `build.mjs`, `vite.config.ts` e o código compartilhado do celular que o desktop empacota (`apps/mobile/src/lib/desktopLink.ts`, `backupFile.ts`, `ss58.ts`, `lunesRpc.ts`, `protocol/lnnp.ts`, `protocol/fragment.ts`; lido apenas onde afeta o desktop).
Produção: Lunes Mainnet.

## Resumo

| Severidade | Qtde |
|---|---|
| Crítica | 0 |
| Alta | 1 |
| Média | 5 |
| Baixa | 6 |
| Info | 6 |

**Nota proposta: 72/100.** A base é sólida: checklist do Electron quase completo, criptografia do vínculo bem desenhada (X25519 + HKDF + XChaCha20 com contador, cert pinado amarrado às palavras), backup com scrypt N=2^16 e AEAD sobre o cabeçalho, diário de pagamento que falha fechado e desktop que **não assina nada**. Os problemas reais são de **ciclo de vida do segredo** (cofre ilegível tratado como vazio), **exposição local da frase** (revelar sem reautenticação, captura de tela liberada fora da conversa, switches de depuração no build empacotado) e **robustez do pareamento** (DoS por qualquer host da LAN, confirmação por botão "são iguais").

`npm audit --omit=dev`: **0 vulnerabilidades** (64 deps de produção). Com dev: 6 moderadas (cadeia `electron-builder` → `minimatch`), nenhuma alta/crítica. Ressalva: as libs que entram por caminho relativo de `apps/mobile` (`@noble/*`, `@scure/bip39` do mobile) são resolvidas de `apps/mobile/node_modules` e **não** são cobertas pelo audit do desktop — rodar o audit lá também.

### Top 5
1. **A-01** Cofre/estado ilegíveis viram "não existe" → nova chave de dados sobrescreve a antiga e a frase pode ser sobrescrita — `src/main/vault.ts:30-32,49-55`, `src/main/core.ts:101-113,252-258`.
2. **M-05** Build empacotado aceita `--remote-debugging-port` e roda sem hardened runtime → malware do mesmo usuário chama `window.piu.revealPhrase()` sem prompt do Keychain — `src/main/main.ts:202-230`, `electron-builder.yml:37-38`.
3. **M-01** `revealPhrase` sem reautenticação; `createIdentity` devolve a frase ao renderer sem necessidade — `src/main/core.ts:264,286`, `src/main/main.ts:120-122`.
4. **M-02** Proteção contra captura só com conversa aberta; frase, QR do vínculo e carteira ficam capturáveis — `src/shared/screenSecurity.ts:25-28`, `src/main/main.ts:89-93`.
5. **M-03** Servidor do vínculo: slot único sem timeout de handshake, oferta sem expiração após falha, escuta em `0.0.0.0` → DoS do pareamento por qualquer host da LAN — `src/main/desktopLink.ts:82,113,117-122`.

---

## Achados

### A-01 — Cofre ou estado ilegível é tratado como inexistente (perda silenciosa de dados e possível sobrescrita da frase)
- **Severidade:** Alta
- **OWASP:** A04:2021 Insecure Design / A08 Software and Data Integrity Failures
- **Local:** `src/main/vault.ts:30-32` (`read` engole qualquer erro e devolve `null`), `src/main/vault.ts:49-55` (`dataKey` gera chave nova e grava por cima), `src/main/store.ts:45` (`load` → `null` em qualquer erro), `src/main/core.ts:101-113` (abre "limpo"), `src/main/core.ts:252-258` / `267-273` (`createIdentity`/`restoreIdentity` só checam `this.mesh`, não se já existe `phrase.bin`).
- **Evidência:**
  ```ts
  private read(name: string): string | null {
    try { return this.ss.decryptString(readFileSync(join(this.dir, name))); } catch { return null; }
  }
  async dataKey(): Promise<Buffer> {
    const saved = this.read(DATAKEY_FILE);
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return Buffer.from(saved, 'hex');
    const key = Buffer.alloc(32); globalThis.crypto.getRandomValues(key);
    this.write(DATAKEY_FILE, key.toString('hex'));   // sobrescreve a chave antiga
  ```
- **Cenário:** no macOS o app é assinado ad-hoc (`identity: "-"`), então cada build novo tem outro cdhash e o Keychain pergunta de novo se "Piu" pode usar o item "Piu Safe Storage". Se a pessoa clicar **Negar** (ou o Keychain estiver bloqueado, ou o libsecret do Linux não responder a tempo), `decryptString` lança → `read` devolve `null` → `dataKey()` cria e **grava** uma chave nova → `state.bin` (sessões Double Ratchet, contatos, histórico) e `payments.bin` ficam ilegíveis para sempre (o journal passa a "blocked", o estado é sobrescrito no próximo `saveNow`). A frase também lê `null`: a UI volta para a tela inicial e oferece "Criar identidade"; ao criar, `setPhrase` **sobrescreve `phrase.bin`** — a identidade anterior e a carteira Lunes derivada dela somem se não houver backup.
- **Correção (ANTES → DEPOIS):**
  ```ts
  // ANTES (vault.ts)
  private read(name: string): string | null {
    try { return this.ss.decryptString(readFileSync(join(this.dir, name))); } catch { return null; }
  }
  // DEPOIS
  export class VaultLockedError extends Error {}
  private read(name: string): string | null {
    let raw: Buffer;
    try { raw = readFileSync(join(this.dir, name)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    try { return this.ss.decryptString(raw); }
    catch { throw new VaultLockedError('O cofre do sistema recusou o acesso. Desbloqueie o Keychain/chaveiro e abra o Piu de novo.'); }
  }
  private write(name: string, plain: string, { overwrite = false } = {}) {
    if (!this.secure) throw new Error('...');
    const file = join(this.dir, name);
    if (!overwrite && existsSync(file)) throw new Error('Já existe um segredo guardado; não vou sobrescrever.');
    // ... tmp + rename, e manter `file + '.bak'` da versão anterior
  }
  ```
  ```ts
  // core.ts open(): não engolir VaultLockedError; mostrar erro e NÃO criar store/chave nova
  const key = await this.vault.dataKey();   // sem .catch(() => null)
  // createIdentity/restoreIdentity: recusar se phrase.bin existir (exigir "Apagar tudo" explícito antes)
  if (this.vault.hasPhrase()) throw new Error('Já existe uma frase guardada neste computador.');
  ```
  `Store.load()` também deve distinguir "não existe" (ENOENT → `null`) de "ilegível" (lançar; renomear o arquivo para `state.bin.corrupt-<ts>` antes de qualquer novo `save`).
- **Muda comportamento visível / compatibilidade com o celular?** Sim no visível (com o cofre negado o app mostra erro em vez de abrir vazio); não no protocolo (nada muda no fio).

---

### M-01 — Frase revelada sem reautenticação; frase trafega ao renderer sem necessidade
- **Severidade:** Média
- **OWASP:** A07:2021 Identification and Authentication Failures / A04 Insecure Design
- **Local:** `src/main/core.ts:286` (`revealPhrase() { return this.vault.getPhrase(); }`), `src/main/main.ts:122`, `src/main/core.ts:264` (`createIdentity` devolve `{ phrase }`, mas `Auth.tsx:69` não usa o valor), `src/renderer/screens/Settings.tsx:297`.
- **Evidência:** um clique em "Mostrar" (Ajustes → Backup) chama `window.piu.revealPhrase()` e recebe as 12 palavras; nenhum prompt do sistema. A frase controla a identidade **e** a carteira LUNES (mesma derivação do celular, `identity.ts:35`).
- **Cenário:** computador desbloqueado por um minuto (colega, assistência técnica, parente) → Ajustes → Backup → Mostrar → foto da tela → drenagem da carteira na Mainnet a partir de outro aparelho.
- **Correção:**
  ```ts
  // ANTES (main.ts)
  revealPhrase: () => core.revealPhrase(),
  // DEPOIS
  revealPhrase: async () => {
    if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      await systemPreferences.promptTouchID('mostrar a frase de recuperação do Piu');
    } else {
      // Windows/Linux: pedir confirmação com a senha do backup ou digitar 2 palavras sorteadas da frase
      throw new Error('Confirme sua identidade para ver a frase.');
    }
    return core.revealPhrase();
  },
  // core.ts createIdentity: não devolver a frase
  return { ok: true };
  ```
  Opcional: ocultar automaticamente após 60 s e ao perder o foco.
- **Muda comportamento visível / compatibilidade?** Sim no visível (prompt de Touch ID/senha); não no protocolo.

---

### M-02 — "Segurança da tela" só vale com conversa aberta; frase, QR e carteira capturáveis
- **Severidade:** Média
- **OWASP:** A04:2021 Insecure Design
- **Local:** `src/shared/screenSecurity.ts:25-28` (`protect: supported && enabled && conversationOpen`), `src/main/main.ts:89-93`, `src/renderer/App.tsx:104`.
- **Evidência:** a proteção é ligada só por `setConversationOpen(true)`. A tela Ajustes → Backup (frase em claro), a tela do QR `piu-link:` (que contém `k`, `s`, `c` da oferta) e a Carteira ficam com `setContentProtection(false)`.
- **Cenário:** um gravador de tela, um app de reunião compartilhando a tela ou um malware com permissão de Gravação de Tela captura a frase quando a pessoa clica em "Mostrar"; ou captura o QR e conecta antes do celular (ver M-04).
- **Correção:**
  ```ts
  // ANTES
  return { supported, protect: supported && enabled && conversationOpen, note: ... };
  // DEPOIS: sensível = conversa aberta OU frase visível OU QR de vínculo OU carteira
  export function screenSecurityFor(platform: string, enabled: boolean, sensitive: { conversation: boolean; secret: boolean }) {
    const supported = screenSecuritySupported(platform);
    // segredo (frase/QR) é protegido mesmo com o ajuste desligado
    return { supported, protect: supported && (sensitive.secret || (enabled && sensitive.conversation)), note: ... };
  }
  ```
  e um IPC `setSecretVisible(bool)` chamado por Settings (frase), Auth (QR/palavras) e Wallet.
- **Muda comportamento visível / compatibilidade?** Sim (capturas dessas telas saem pretas); não no protocolo.

---

### M-03 — Servidor do vínculo: DoS por qualquer host da LAN e oferta reaproveitável
- **Severidade:** Média
- **OWASP:** A04:2021 Insecure Design / A05 Security Misconfiguration
- **Local:** `src/main/desktopLink.ts:82` (escuta `0.0.0.0`), `:117-122` (slot único, sem timeout para o `hello`, para a renovação do QR), `:113` (falha → estado `dropped`, sem renovar), `offerExpired` (`src/shared/desktopLink.ts:32`) **nunca é usado** no servidor.
- **Evidência:**
  ```ts
  private onConnection(sock: WebSocket) {
    if (this.sock || !this.offer) { sock.close(1013, 'ocupado'); return; }
    this.sock = sock;
    if (this.renewTimer) { clearInterval(this.renewTimer); this.renewTimer = null; }
  ```
- **Cenário:** (a) qualquer máquina na mesma Wi-Fi/VPN/rede de café abre um TLS+WebSocket na porta mostrada (ou faz varredura) e **não manda nada**: o celular verdadeiro recebe "ocupado" para sempre e o QR para de renovar. (b) Manda um `hello` inválido: `fail` → `dropClient(reason)` → estado `dropped` sem nova oferta; repetido em laço, impede o pareamento. (c) Em `dropped`, `this.offer` continua válido sem prazo: um QR fotografado minutos antes ainda serve para um `hello` aceito.
- **Correção:**
  ```ts
  // DEPOIS (desktopLink.ts)
  const HELLO_TIMEOUT_MS = 10_000;
  private onConnection(sock: WebSocket) {
    if (this.sock || !this.offer || offerExpired(this.offer, this.now())) { sock.close(1013, 'ocupado'); return; }
    this.sock = sock;
    const helloTimer = setTimeout(() => { if (!hs) fail('tempo esgotado esperando o celular', CLOSE_BAD_SESSION); }, HELLO_TIMEOUT_MS);
    // ... no handshake OK: clearTimeout(helloTimer)
    // NÃO parar o renewTimer até o handshake passar.
  }
  // falha ANTES do handshake: não vai para 'dropped'; descarta só o socket e renova a oferta
  const fail = (reason: string, code?: number) => {
    if (this.sock !== sock) return;
    if (!hs) { this.sock = null; try { sock.close(code ?? 1008); } catch {} this.offer = null; this.renew(); return; }
    this.dropClient(reason, code);
  };
  // listen: usar o host anunciado no QR em vez de 0.0.0.0
  https.listen(this.o.port ?? 0, this.o.listen ?? host, ...)
  ```
  Opcional: limitar tentativas de handshake por IP (ex.: 5/min).
- **Muda comportamento visível / compatibilidade?** Visível: pouco (QR continua renovando mesmo com tentativas inválidas). Protocolo: não — o celular já trata 1013/4001; o timeout de 10 s é bem maior que o tempo real do `hello`.

---

### M-04 — Confirmação das 3 palavras é um botão "são iguais": dá para vincular a um "celular" falso
- **Severidade:** Média
- **OWASP:** A07:2021 Identification and Authentication Failures
- **Local:** `src/main/desktopLink.ts:201-211` (`confirm()` só exige estado `confirm`), `:183-192` (snapshot define `walletAddress` "do celular"), `src/main/core.ts:184-187` (essa carteira vira origem do Receber/Enviar), `src/renderer/screens/Auth.tsx` (passo `confirm`).
- **Evidência:** quem tiver o QR (foto, captura — M-02 —, alguém olhando a tela) conecta primeiro; o celular verdadeiro recebe "ocupado" e não mostra palavras. O desktop mostra 3 palavras e um botão de confirmar; se a pessoa confirma por hábito, o atacante manda um `snapshot` com conversas falsas e `wallet` = endereço dele (SS58 válido passa em `walletFromLink`).
- **Cenário:** o QR do **Receber** da Carteira passa a mostrar o endereço do atacante; quem paga a vítima paga o atacante. Tudo que a vítima digita no desktop vai para o atacante (`cmd send`). O comentário do protocolo assume que "a pessoa compara e cancela"; a UI não força a comparação.
- **Correção (só UI, sem mudar o fio):**
  ```tsx
  // ANTES: palavras + botão "São iguais"
  // DEPOIS: escolher, entre 4 opções, a 3ª palavra que o CELULAR mostra
  const options = shuffle([words[2], ...decoysFromSameWordlist(3)]);
  <p>Qual é a última palavra que aparece no celular?</p>
  {options.map(w => <button onClick={() => w === words[2] ? window.piu.linkConfirm() : window.piu.linkCancel()}>{w}</button>)}
  ```
  Errar cancela e gera QR novo. Sem o celular verdadeiro exibindo as palavras, a pessoa não consegue acertar além do chute (1/4, e o atacante perde a oferta).
  Defesa adicional: no estado vinculado, mostrar na Carteira "Endereço do celular vinculado: 5Abc…xyz — confira no celular" antes de exibir o QR do Receber.
- **Muda comportamento visível / compatibilidade?** Visível: sim (seleção em vez de botão). Protocolo: não.

---

### M-05 — Build empacotado aceita depuração remota e roda sem hardened runtime
- **Severidade:** Média
- **OWASP:** A05:2021 Security Misconfiguration / A08 Software and Data Integrity Failures
- **Local:** `src/main/main.ts:202-230` (nenhuma checagem de switches), `src/main/main.ts:60-62` (o próprio comentário cita "capturas pelo DevTools remoto"), `electron-builder.yml:37-38` (`identity: "-"`, `hardenedRuntime: false`).
- **Evidência:** os fuses desligam `--inspect`/`NODE_OPTIONS`/`runAsNode` (ótimo), mas `--remote-debugging-port`/`--remote-debugging-pipe` são switches do Chromium e continuam valendo no app empacotado. Sem hardened runtime, o macOS também respeita `DYLD_INSERT_LIBRARIES` no binário.
- **Cenário:** malware rodando como o mesmo usuário (sem root, sem acesso ao Keychain, porque o item "Piu Safe Storage" é restrito ao app) executa `open -a Piu --args --remote-debugging-port=9222`, conecta no CDP e roda `await window.piu.revealPhrase()` no renderer → recebe a frase **sem prompt do Keychain**, burlando a ACL que é justamente o que protege a frase. Mesmo efeito com injeção de dylib.
- **Correção:**
  ```ts
  // DEPOIS (main.ts, antes do app.whenReady)
  if (app.isPackaged) {
    const bad = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk', 'js-flags'];
    if (bad.some(s => app.commandLine.hasSwitch(s))) { app.exit(1); }
  }
  ```
  ```yaml
  # electron-builder.yml: assim que houver Developer ID
  mac:
    identity: "Developer ID Application: ..."
    hardenedRuntime: true
    notarize: true
  electronFuses:
    grantFileProtocolExtraPrivileges: false   # ver B-06
  ```
- **Muda comportamento visível / compatibilidade?** Não para quem usa normalmente (só os testes que usam `--remote-debugging-port` com build empacotado precisariam de build de dev); não no protocolo.

---

### B-01 — IPC sem validação do remetente; `setPrefs` aceita qualquer chave/valor
- **Severidade:** Baixa
- **OWASP:** A01:2021 Broken Access Control / A03 Injection (validação de entrada)
- **Local:** `src/main/main.ts:164-168` (handler não olha `e.senderFrame`), `src/main/main.ts:153` + `src/main/core.ts:436-438` (`{ ...this.state.prefs, ...patch }` sem allowlist).
- **Evidência:** `setPrefs({ walletAddress: 'qualquer coisa', peers: ['x'], screenSecurity: false })` burla `validateAddress` (`core.ts:405`) e `parsePeerAddress` (`core.ts:376`); `displayName` não-string faz `.trim()` lançar.
- **Cenário:** só explorável se o renderer for comprometido (hoje não há sink de XSS — ver "Feito bem"), mas é exatamente a defesa em profundidade que segura um XSS futuro numa carteira.
- **Correção:**
  ```ts
  // ANTES
  ipcMain.handle('piu', async (_e, method: string, ...args: unknown[]) => { const fn = methods[method]; ... });
  // DEPOIS
  ipcMain.handle('piu', async (e, method: string, ...args: unknown[]) => {
    if (!e.senderFrame || e.senderFrame !== win?.webContents.mainFrame || !e.senderFrame.url.startsWith(rendererOrigin() + '/')) throw new Error('Origem não autorizada.');
    if (!Object.hasOwn(methods, method)) throw new Error('Método desconhecido.');
    return methods[method]!(...(args as never[]));
  });
  // core.setPrefs: allowlist + tipos
  const ALLOWED: Record<keyof Prefs, (v: unknown) => boolean> = { theme: v => ['system','light','dark'].includes(v as string), notifications: isBool, /*...*/ walletAddress: v => v === null || (typeof v === 'string' && !validateAddress(v)), peers: v => Array.isArray(v) && v.length <= 32 && v.every(p => parsePeerAddress(p) === p) };
  ```
  Obs.: `methods[method]` com `method = 'constructor'`/`'toString'` hoje resolve para funções do `Object.prototype` (não exploráveis, mas `Object.hasOwn` fecha isso).
- **Muda comportamento?** Não; protocolo não.

### B-02 — `openExternal` e `setWindowOpenHandler` abrem qualquer `https://`
- **Severidade:** Baixa · **OWASP:** A01/A10 (redirecionamento não validado)
- **Local:** `src/main/main.ts:50`, `src/main/main.ts:154`; o renderer **não usa** `openExternal` (grep).
- **Cenário:** com o renderer comprometido, abre página de phishing no navegador padrão ("restaure sua frase"). Superfície morta.
- **Correção:** remover o método do `PiuApi`/preload; no handler, só uma allowlist:
  ```ts
  const EXTERNAL = new Set(['https://lunes.io', 'https://explorer.lunes.io', 'https://github.com']);
  contents.setWindowOpenHandler(({ url }) => { try { const u = new URL(url); if (u.protocol === 'https:' && EXTERNAL.has(u.origin)) void shell.openExternal(u.href); } catch {} return { action: 'deny' }; });
  ```
- **Muda comportamento?** Não (nada usa hoje); protocolo não.

### B-03 — Beacon UDP não autenticado faz o desktop discar TCP para IP:porta arbitrários, sem limite
- **Severidade:** Baixa · **OWASP:** A04 / A10 SSRF (LAN)
- **Local:** `src/transport/lnnpLan.ts:325-333` (`onBeacon` → `dial(\`${address}:${b.port}\`)`), `:337-356` (`outbound` sem teto para destinos descobertos).
- **Cenário:** um host da LAN manda beacons (endereço de origem UDP forjável) com portas variadas → o desktop abre conexões TCP para qualquer IP/porta e escreve o HELLO do LNNP (varredura de portas "em nome" do desktop, centenas de sockets a cada 5 s).
- **Correção:**
  ```ts
  private onBeacon(msg: Buffer, address: string) {
    // ...validações atuais...
    if (!isPrivateLan(address)) return;                       // 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7
    if (this.discoveredDials() >= 16) return;                  // teto de discagens descobertas pendentes
    if (!this.beaconRate.allow(address)) return;               // 1 discagem/IP a cada 30 s
    this.dial(`${address}:${b.port}`);
  }
  ```
- **Muda comportamento?** Não para uso normal; protocolo LNNP não.

### B-04 — Dados vindos do celular sem validação de tipo/tamanho; estado local sem teto
- **Severidade:** Baixa · **OWASP:** A03/A04 (entrada não confiável)
- **Local:** `src/shared/desktopLink.ts:46-74,77-112` (`c.name`, `m.text`, `m.sender`, `m.id`, `chatId` usados sem checar tipo/tamanho), `src/main/desktopLink.ts:154-166`; `src/shared/conversations.ts:31-35` (mensagens da malha acumulam sem limite em `state.bin`).
- **Evidência:** `text: m.text` vai direto para `{m.text}` no React (`Chats.tsx:319`). `text` objeto → React lança "Objects are not valid as a React child" → tela branca; `chatId: 'constructor'` → `conv.byContact['constructor'].filter` lança → sessão cai. Não há poluição de protótipo (chaves computadas em spread viram propriedades próprias). O celular é o principal confiável depois do pareamento, então o impacto real é robustez/DoS (e M-04 transforma isso em ataque).
- **Correção:**
  ```ts
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  const safeId = (x: unknown) => (typeof x === 'string' && /^[\w:.\-]{1,64}$/.test(x) && !['__proto__','constructor','prototype'].includes(x) ? x : null);
  export function messageFromLink(chatId: string, m: LinkMsg, nowSec: number): Message | null {
    const id = safeId(m?.id); if (!id || m.from === 'sys') return null;
    return { id, contactId: chatId, dir: m.from === 'me' ? 'out' : 'in', text: str(m.text, 4000), at: Number.isFinite(m.at) ? Math.floor(m.at! / 1000) : nowSec, ... };
  }
  // usar Map/Object.create(null) em byContact/readCount; limitar chats (≤ 2000) e mensagens por conversa (≤ 500, as mais novas)
  ```
- **Muda comportamento?** Não para dados válidos; protocolo não (só recusa o que o celular legítimo nunca manda).

### B-05 — Linux: não confere o backend do safeStorage; API síncrona depreciada
- **Severidade:** Baixa · **OWASP:** A02 Cryptographic Failures
- **Local:** `src/main/vault.ts:28`.
- **Evidência:** `secure` = `isEncryptionAvailable()` (marcada `@deprecated` no `electron.d.ts` do Electron 45). No Linux, se algo chamar `setUsePlainTextEncryption(true)` ou o backend cair em `basic_text`, a "cifra" usa senha fixa conhecida.
- **Correção:**
  ```ts
  get secure() {
    try {
      if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) return false;
      return this.ss.isEncryptionAvailable();
    } catch { return false; }
  }
  ```
  (expor `getSelectedStorageBackend` em `SafeStorageLike`; migrar para `isAsyncEncryptionAvailable`/`encryptStringAsync` quando possível).
- **Muda comportamento?** Só em Linux sem chaveiro (passa a recusar, como a documentação do próprio vault promete); protocolo não.

### B-06 — Origem por prefixo sem barra; `file://` com privilégios extras
- **Severidade:** Baixa · **OWASP:** A05
- **Local:** `src/main/main.ts:28` (`pathToFileURL(dir).href` sem `/` final), `:40` e `:53` (`startsWith(rendererOrigin())` também aceita `.../renderer-qualquer/`; `onBeforeRequest` libera **qualquer** `data:`/`blob:`).
- **Cenário:** sem impacto direto hoje (ninguém escreve ao lado de `dist/renderer` dentro do asar), mas é a fronteira de toda a política.
- **Correção:** `const rendererOrigin = () => pathToFileURL(rendererDir()).href + '/';` e, de preferência, servir por `protocol.handle('app', ...)` com `registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }])` + fuse `grantFileProtocolExtraPrivileges: false`.
- **Muda comportamento?** Não; protocolo não.

---

## Info (sem risco atual relevante)
- **I-01** CSP com `style-src 'unsafe-inline'` (`main.ts:44`, `index.html:6`): sem scripts inline, impacto só de injeção de CSS. A `<meta>` não tem `frame-ancestors` (ignorado em meta; o cabeçalho tem).
- **I-02** Botão "Colar" da frase (`Auth.tsx:71-73`) usa `navigator.clipboard.readText()`, mas o handler de permissões só libera `clipboard-sanitized-write` → o botão falha. Se for consertar, faça via IPC no processo principal (`clipboard.readText()`) e **limpe o clipboard** depois de ler a frase (`clipboard.clear()` se o conteúdo for a frase).
- **I-03** Segredos efêmeros não são zerados: `offer.sk`, `keys.send/recv` do vínculo e `DerivedKeys.walletSeed` (`identity.ts:34`, nunca usado pelo desktop — remover). Em JS isso é só higiene.
- **I-04** Notificação de pedido de conversa usa o nome escolhido pelo desconhecido (`main.ts:107-109`): "Suporte Lunes quer conversar" é phishing fácil. Prefixar "Pedido de conversa ·" e o id curto.
- **I-05** O saldo é lido nos nós públicos `wss://*.lunes.io` (`lunesRpc.ts:21-25`) — o endereço vai para esses servidores a cada 60 s (privacidade, não integridade).
- **I-06** Dependências: prod 0 vulnerabilidades; dev 6 moderadas (`electron-builder`/`app-builder-lib`/`dmg-builder`/`@electron/universal`/`electron-builder-squirrel-windows`/`minimatch`), sem alta/crítica. Electron 45.2.1, `ws` 8.22.1, `selfsigned` 5.5.0. Auditar também `apps/mobile` (código empacotado por caminho relativo).

---

## O que está bem feito
- **Janela:** `contextIsolation: true`, `sandbox: true` + `app.enableSandbox()`, `nodeIntegration: false`, `webviewTag: false`, DevTools desligado no pacote; `will-navigate`, `will-redirect`, `will-attach-webview` bloqueados; `setWindowOpenHandler` sempre nega.
- **Rede do renderer:** `onBeforeRequest` só permite os próprios arquivos; CSP com `script-src 'self'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`.
- **Permissões:** handlers de request e check negam tudo menos notificações e escrita sanitizada no clipboard.
- **Preload mínimo:** só `invoke('piu', método, …)` e canais `piu:<evento>`; nada de `ipcRenderer` cru exposto.
- **Fuses:** `runAsNode`, `NODE_OPTIONS`, `--inspect` desligados; integridade do asar e `onlyLoadAppFromAsar` ligados; cookies cifrados.
- **Sem XSS:** mensagens, nomes e prévias são texto do React (`{m.text}`); nenhum `dangerouslySetInnerHTML`, `innerHTML`, `eval` ou link montado a partir de dados.
- **Vínculo:** X25519 efêmero por QR, HKDF com sal = sessão e chaves separadas por sentido, XChaCha20-Poly1305 com nonce = contador (sem reuso: cada sentido tem chave própria e contador estrito), header como AD, quadro repetido/fora de ordem/adulterado mata a sessão, tamanho conferido antes de decodificar, `hello` com sessão comparada por `equal`, chaves zero recusadas, hash do certificado na transcrição das palavras (amarra TLS ao QR), cert P-256 com chave `0600`.
- **Segredos em repouso:** frase só no `safeStorage` (nunca grava sem cofre), estado em AES-256-GCM com IV aleatório e gravação atômica, journal de pagamentos com AAD, `fsync` e falha fechada.
- **Backup:** scrypt N=2^16/r=8/p=1, sal 16 B, XChaCha20-Poly1305 com o cabeçalho inteiro como AD (impede downgrade do custo), senha normalizada NFKC, arquivo `0600` com `wx` só após o diálogo de salvar.
- **Carteira:** desktop **não assina** (só monta `payment_request`; o celular revisa e assina); SS58 com checksum BLAKE2b e prefixos 57/42; quantia em texto/planck sem float; destino ≠ origem; status do celular validado (UUID, hash `0x…64`, estado terminal não regride, hash divergente vira `unknown`).
- **LAN (LNNP):** handshake assinado pela chave do nó, `ReplayGuard`, limite de 4 KiB no handshake e 64 KiB por quadro, timeout de 5 s, `maxPending` 16, `maxLinks` 64, remontagem com teto de 64 KiB/64 pendentes; `parsePeerAddress` estrito.
- **Logs:** só com `!app.isPackaged`, sem frase, chaves ou textos de mensagem.

---

## Correções aplicadas (06/11/2026)

Escopo: só `apps/desktop/**` (nada em `apps/mobile` nem `apps/piu-node`). Nenhuma mudança no protocolo com o celular (piu-link, snapshot, LNNP): o fio é o mesmo; só muda o que o desktop aceita e mostra. TDD: cada teste abaixo foi escrito antes e falhou antes da correção.
Resultado: `npm test` **105 → 127 testes, todos passando**; `npm run typecheck` ok; `npm run build` ok. Não validado na interface gráfica real (rodar o app em dev usaria a pasta de dados real em `~/Library/Application Support/Piu`, que não foi tocada).

| Achado | Status |
|---|---|
| A-01 | Corrigido |
| M-01 | Corrigido (com limite: sem Touch ID a reautenticação é uma confirmação nativa) |
| M-02 | Corrigido |
| M-03 | Corrigido (limite por IP não feito) |
| M-04 | Corrigido (só UI/escolha local; protocolo igual) |
| M-05 | Corrigido no código; hardened runtime/notarização pendentes (precisa de Developer ID) |
| B-01 | Corrigido |
| B-02 | Corrigido |
| B-03 | Corrigido |
| B-04 | Corrigido |
| B-05 | Corrigido (checagem do backend; migração para a API assíncrona não feita) |
| B-06 | Corrigido (barra final); `protocol.handle('app')` e fuse `grantFileProtocolExtraPrivileges` não feitos |

### A-01 — cofre/estado ilegível falha fechado
- **Arquivos:** `src/main/vault.ts`, `src/main/store.ts`, `src/main/core.ts`, `src/shared/types.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/App.tsx`, `src/renderer/screens/Locked.tsx` (novo).
- **ANTES:** `read()` engolia qualquer erro e devolvia `null`; `dataKey()` gerava e gravava chave nova por cima; `Store.load()` devolvia `null` para arquivo ilegível; `createIdentity`/`restoreIdentity` só checavam `this.mesh` → com o Keychain negado, a UI oferecia "Criar identidade" e `setPhrase` sobrescrevia `phrase.bin`.
- **DEPOIS:** `read()` só devolve `null` em `ENOENT`; existir e não abrir é `VaultLockedError`. `write()` nunca grava por cima de um arquivo existente; `setPhrase` recusa se `hasPhrase()`. `datakey.bin` com conteúdo inesperado também é `VaultLockedError`. `Store.load()` lança `StoreUnreadableError`; o núcleo move a cópia para `state.bin.corrupt-<ts>` (`quarantine()`) antes de qualquer gravação. `PiuCore.open()` entra em `locked` (sem store, sem diário de pagamentos, sem gravação) quando o cofre recusa, quando a frase guardada não abre ou está vazia; `session().state === 'locked'` com `lockedReason`. `createIdentity`/`restoreIdentity`/`linkStart` recusam com frase guardada ou cofre bloqueado. Nova tela "Cofre bloqueado" com **Tentar de novo** (`retryVault` → `core.retryOpen()`), sem atalho para criar identidade.
- **Testes:** `test/vault.test.ts` (Keychain negado não troca a chave; frase ilegível lança; `setPhrase` não sobrescreve; datakey inválida lança), `test/store.test.ts` (ilegível lança + quarentena preserva o arquivo), `test/coreVault.test.ts` (novo: abertura com acesso negado → `locked`, nenhum byte de `phrase.bin`/`datakey.bin`/`state.bin`/`payments.bin` muda, "tentar de novo" volta à MESMA identidade; `phrase.bin` ilegível como frase → `locked` e criar recusa; `state.bin` adulterado → quarentena e a identidade sobe).

### M-01 — frase só com reautenticação; criação não devolve a frase
- **Arquivos:** `src/main/security.ts` (novo, `reauthForPhrase`), `src/main/main.ts`, `src/main/core.ts`, `src/shared/types.ts`, `src/renderer/screens/Settings.tsx`.
- **ANTES:** `revealPhrase: () => core.revealPhrase()` sem prompt; `createIdentity` devolvia `{ phrase }` (a UI não usava).
- **DEPOIS:** `revealPhrase` pede `systemPreferences.promptTouchID` no macOS com Touch ID; sem Touch ID (Macs Intel, Windows, Linux) mostra um diálogo nativo do processo principal ("Cancelar" é o padrão), que o renderer não consegue clicar. Recusa/erro → rejeita ("a frase continua oculta"). Touch ID recusado não cai para o diálogo. `createIdentity` devolve `void`. Na tela Backup a frase some sozinha em 60 s, ao perder o foco da janela e ao sair da página, e as palavras não ficam guardadas no estado do renderer depois de ocultar.
- **Limite:** o Electron não expõe a senha da sessão nem o Windows Hello; sem Touch ID, a proteção contra "computador destravado" é só a confirmação explícita + aviso.
- **Testes:** `test/security.test.ts` (Touch ID ok/recusado, confirmação nativa, erro → recusa), `test/coreVault.test.ts` (`createIdentity` devolve `undefined`).

### M-02 — sem captura de tela em frase, vínculo e carteira
- **Arquivos:** `src/shared/screenSecurity.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts`, `src/renderer/ui.tsx` (`useSecretScreen`), `Settings.tsx`, `Auth.tsx`, `Wallet.tsx`.
- **ANTES:** `protect: supported && enabled && conversationOpen`.
- **DEPOIS:** `screenSecurityFor(platform, enabled, { conversation, secret })` → `protect: supported && (secret || (enabled && conversation))`. IPC `setSecretVisible('phrase'|'link'|'wallet', bool)` (allowlist `SECRET_SCREENS`). Protegidas SEMPRE (mesmo com o ajuste desligado): Ajustes → Backup (frase e senha do arquivo), etapas QR/confirmação do vínculo, a etapa de digitar a frase em Restaurar, e a Carteira inteira. Recarregar a página zera as marcas.
- **Testes:** `test/screenSecurity.test.ts` (segredo protege com ajuste desligado; Linux nunca).

### M-03 — servidor do vínculo resiste a DoS na LAN e não reaproveita oferta
- **Arquivos:** `src/main/desktopLink.ts`.
- **ANTES:** escuta em `0.0.0.0`; slot único sem prazo para o `hello`; renovação do QR parava na conexão; falha antes do handshake → `dropped` com a oferta ainda válida; `offerExpired` nunca usado.
- **DEPOIS:** `HELLO_TIMEOUT_MS = 10 s` (fecha com 1008 e libera o slot). Falha ANTES do handshake (hello inválido, conexão muda, fechou) só libera o slot e gera oferta nova — sem `dropped`. Oferta vencida (`offerExpired`) ou já consumida → `1013` na conexão. A oferta é consumida no handshake (`offer = null`), então depois de `dropped` o QR antigo não serve. Escuta no IPv4 anunciado no QR (`listen ?? host ?? localHosts()[0]`), não em `0.0.0.0`; se esse IP sumir (trocou de rede), `start()` sobe o servidor de novo no endereço atual.
- **Não feito:** limite de tentativas por IP (opcional no relatório).
- **Testes:** `test/desktopLinkServer.test.ts` (conexão muda derrubada no prazo, "ocupado" enquanto isso, QR novo e celular real conecta; hello inválido não vai para `dropped` e troca a oferta; QR antigo → 4001; QR vencido → 1013; oferta usada depois de `dropped` → 1013; sem `listen` escuta só no host do QR). Teste existente de sessão errada passou a conferir `waiting` em vez de `dropped`.

### M-04 — confirmação escolhendo a palavra certa
- **Arquivos:** `src/main/desktopLink.ts` (`linkConfirmOptions`, `confirm(word)`), `src/main/core.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/types.ts` (`LinkState.confirm` ganha `options`), `src/renderer/screens/Auth.tsx`.
- **ANTES:** 3 palavras na tela + botão "Os códigos são iguais".
- **DEPOIS:** o desktop mostra as 2 primeiras palavras e um "?"; a pessoa toca na 3ª entre 4 opções (iscas da mesma lista BIP39, nenhuma igual às 3 palavras, embaralhadas com `crypto.randomInt`). A conferência é no processo principal (`confirm(word)`): errada → `bye` ao celular ("código não confere no computador"), QR novo e aviso na tela. A 3ª palavra não vai ao renderer. Protocolo igual (o celular continua mostrando as 3 palavras; o `bye` é o mesmo do cancelar).
- **Não feito:** o aviso extra na Carteira ("Endereço do celular vinculado: confira no celular").
- **Testes:** `test/desktopLinkServer.test.ts` (opções: 4 distintas, contêm a 3ª e nenhuma das 2 primeiras; palavra errada/vazia → `waiting`, QR novo, celular recebe `bye` e nunca `ready`; certa → `linked`). Testes existentes passaram a chamar `confirm(phone.words[2])`.

### M-05 — app empacotado recusa switches de depuração
- **Arquivos:** `src/main/security.ts` (`forbiddenDebugSwitches`), `src/main/main.ts`.
- **ANTES:** nenhuma checagem; `open -a Piu --args --remote-debugging-port=9222` abria CDP.
- **DEPOIS:** com `app.isPackaged`, antes de qualquer janela: se `process.argv` (`--x`, `-x`, `/x` no Windows, sem diferenciar maiúsculas, até `--`) ou `app.commandLine.hasSwitch` trouxer `remote-debugging-port|pipe|address`, `remote-allow-origins`, `inspect`, `inspect-brk`, `inspect-port`, `inspect-publish-uid` ou `js-flags`, mostra um aviso e sai (`app.exit(1)`). Em desenvolvimento continua aceitando (testes automatizados).
- **Pendente (fora do código):** `hardenedRuntime: true` + identidade Developer ID + notarização em `electron-builder.yml` (sem certificado não dá para ligar sem quebrar a assinatura ad-hoc).
- **Testes:** `test/security.test.ts`.

### B-01 — IPC com remetente conferido e `setPrefs` com allowlist
- **Arquivos:** `src/main/main.ts`, `src/main/security.ts` (`isTrustedSender`), `src/main/prefs.ts` (novo, `sanitizePrefsPatch`).
- **ANTES:** handler sem olhar `senderFrame`; `methods[method]` resolvia `constructor`/`toString`; `setPrefs` fazia `{ ...prefs, ...patch }` com qualquer chave.
- **DEPOIS:** só a `webContents` da janela do Piu, quadro principal (`senderFrame.parent === null`) e URL dentro da pasta do renderer; `Object.hasOwn(methods, method)`. `setPrefs` da interface aceita só as chaves que a UI usa, com tipo/valores conferidos; `walletAddress` e `peers` recusados (têm `setWalletAddress`/`addPeer` com validação); chave desconhecida/`__proto__` → erro.
- **Testes:** `test/prefs.test.ts` (novo), `test/security.test.ts` (`isTrustedSender`).

### B-02 — links externos só da allowlist; `openExternal` removido
- **Arquivos:** `src/main/main.ts`, `src/main/security.ts` (`externalUrlAllowed`), `src/preload/preload.ts`, `src/shared/types.ts`.
- **ANTES:** qualquer `https://` ia para o navegador; método `openExternal` exposto sem uso.
- **DEPOIS:** `setWindowOpenHandler` só abre `https://lunes.io`, `https://explorer.lunes.io`, `https://github.com` (origem exata, sem credenciais na URL); método `openExternal` removido do `PiuApi`, do preload e do IPC.
- **Testes:** `test/security.test.ts`.

### B-03 — beacon não vira varredura
- **Arquivos:** `src/transport/lnnpLan.ts` (`isPrivateLan`).
- **ANTES:** qualquer beacon válido → `dial(ip:porta)` sem limite.
- **DEPOIS:** só endereços de rede local (10/8, 172.16/12, 192.168/16, 169.254/16, loopback, IPv6 ULA/link-local, IPv4 mapeado); um IP disca no máximo uma vez a cada 15 s (portas variadas não multiplicam) e no máximo 16 IPs diferentes por janela.
- **Efeito colateral:** um vizinho descoberto cujo enlace caiu volta em até 15 s (antes, no próximo beacon de 5 s). Vizinhos fixos não mudam.
- **Testes:** `test/lnnpLan.test.ts` (público ignorado, uma discagem por IP, teto de 16).

### B-04 — dados do celular saneados; históricos com teto
- **Arquivos:** `src/shared/desktopLink.ts`, `src/shared/conversations.ts`.
- **ANTES:** `m.text`, `m.sender`, `m.id`, `c.name`, `chatId` usados sem checar tipo/tamanho; `chatId: 'constructor'` derrubava a sessão; histórico local sem teto.
- **DEPOIS:** `safeLinkId` (string 1–64, nunca nome do `Object.prototype`/`__proto__`) para ids de conversa e mensagem; textos só string (`MAX_TEXT` = 4000, nomes/subtítulo/remetente 200); `at` só número finito; snapshot/eventos com tipos errados viram vazio ou são ignorados. Tetos do espelho: 2000 conversas, 1000 mensagens por conversa (ficam as mais novas). Local: 5000 mensagens por conversa (`MAX_LOCAL_MESSAGES`), com `readCount` ajustado; `messagesOf` só lê listas próprias.
- **Testes:** `test/desktopLink.test.ts` (tipos errados, ids perigosos, tetos), `test/conversations.test.ts` (teto local e `constructor`/`__proto__`).

### B-05 — Linux com `basic_text` não conta como cofre
- **Arquivos:** `src/main/vault.ts`, `src/main/core.ts` (passa a plataforma ao `Vault`).
- **ANTES:** `secure = isEncryptionAvailable()`.
- **DEPOIS:** no Linux, `getSelectedStorageBackend()` em `basic_text`/`unknown` (ou erro ao consultar) → `secure = false` (o app recusa guardar a frase, como já fazia sem chaveiro).
- **Não feito:** migração para `isAsyncEncryptionAvailable`/`encryptStringAsync`.
- **Testes:** `test/vault.test.ts`.

### B-06 — origem com barra final
- **Arquivos:** `src/main/main.ts`, `src/main/security.ts` (`rendererOriginOf`, `isRendererUrl`).
- **ANTES:** `startsWith(pathToFileURL(dir).href)` aceitava `.../renderer-qualquer/`.
- **DEPOIS:** a origem termina em `/` e é usada em `onBeforeRequest`, `will-navigate` e na checagem do IPC.
- **Não feito:** servir por `protocol.handle('app', …)` e desligar o fuse `grantFileProtocolExtraPrivileges` (pode quebrar os módulos do Vite por `file://`; precisa de teste com o pacote).
- **Testes:** `test/security.test.ts`.

### Mudanças visíveis para a pessoa
- Cofre negado/bloqueado na abertura: tela "Cofre bloqueado" com **Tentar de novo**, em vez de abrir vazio e oferecer "Criar identidade".
- "Mostrar" a frase pede Touch ID (ou confirmação nativa); a frase some em 60 s, ao trocar de janela ou de página.
- Capturas/compartilhamento de tela saem pretos em Backup, no QR/confirmação do vínculo, ao digitar a frase em Restaurar e na Carteira, mesmo com "Segurança da tela" desligada (macOS/Windows).
- Pareamento: em vez de "Os códigos são iguais", tocar na 3ª palavra mostrada no celular entre 4 opções; errar gera QR novo.
- App empacotado aberto com `--remote-debugging-port`/`--inspect`/`--js-flags`: mostra aviso e fecha.
