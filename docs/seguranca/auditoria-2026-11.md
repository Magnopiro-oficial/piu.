# Auditoria de segurança: Piu (novembro de 2026)

Escopo: todo o repositório `lunes-platform/piu.`:
- `apps/mobile`: app Expo/React Native, protocolo `src/protocol` e módulo nativo `modules/piu-transport`;
- `apps/provider-panel`: painel do provider, SPA servida pelo `piu-node`;
- `apps/site`: site Astro estático;
- CI no GitHub Actions.

Método: leitura do código, `npm audit`, testes de ataque automatizados (32 testes do protocolo) e testes de navegador sob os headers reais (Playwright).

Referências:
- [OWASP Top 10 (2021)](https://owasp.org/Top10/), mapeamento obrigatório;
- [OWASP Mobile Top 10 (2024)](https://owasp.org/www-project-mobile-top-10/), complementar, porque o produto principal é um app.

---

## 1. Resumo executivo

O Piu **não tem servidor central por desenho**: as mensagens viajam entre aparelhos, cifradas de ponta a ponta. Por isso, uma parte do checklist clássico de API (rotas HTTP, JWT, CORS, Helmet, SQL, CSRF) **não se aplica a nada que exista hoje no repositório**. A seção 2.9 explica por que cada item é N/A e o que vale para quando o `piu-node` expuser uma API.

O risco real estava em outro lugar: **segredos e dados no aparelho**, **controles de segurança que não funcionavam** e **ausência de defesa em profundidade no front**.

| | Crítico | Alto | Médio | Baixo |
|---|---|---|---|---|
| Encontrados | 0 | 4 | 8 | 7 |
| Corrigidos nesta auditoria | 0 | 4 | 7 | 2 |
| Rebaixados com mitigação | 0 | 0 | 1 → Baixo (V-04) | 0 |
| Pendentes (limitações aceitas e documentadas) | 0 | 0 | 0 | 6 (V-04, V-12, V-16 a V-19) |

V-07 e V-08 dependiam de um `piu-node` que não existia no repositório. Ele foi criado (`apps/piu-node`) com a camada de acesso segura, e o painel passou a usá-la. Os dois estão corrigidos.

**Risco sistêmico (antes das correções).** Os três achados altos do app se somavam numa mesma cadeia de ataque. Alguém com o celular desbloqueado nas mãos, ou com acesso ao backup do Google Drive:
1. lia todas as conversas e a carteira **em texto puro**;
2. abria a frase de recuperação **sem nenhuma autenticação**;
3. o "bloqueio por biometria" que a pessoa tinha ligado **não fazia nada**.

Isso equivale a tomar a identidade e os LUNES. Os três foram corrigidos.

---

## 2. Vulnerabilidades (com OWASP)

Legenda: **P** = probabilidade de exploração, **I** = impacto.

### 2.1 Armazenamento e criptografia

#### V-01 · Dados do app em texto puro no AsyncStorage e incluídos no backup do Android
- **Severidade:** Alto (P média · I alto). **Status:** corrigido.
- **Onde:** `apps/mobile/src/lib/persist.ts` gravava `JSON.stringify(value)` direto. `app.json` não desligava `allowBackup`, cujo padrão no Android é `true`.
- **Risco:** conversas, contatos, carteira e ajustes ficavam legíveis em disco. Iam para o backup automático do Google Drive e eram extraíveis por `adb backup`, por root ou por perícia.
- **OWASP:** A02 *Cryptographic Failures*, porque dado sensível ficava em repouso sem cifra. Também M9 *Insecure Data Storage*.
- **Correção:**
  - AES-256-GCM em cada valor, com chave de 256 bits gerada pelo gerador seguro do sistema e guardada no Keychain/Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, fora de backups);
  - o nonce de 96 bits é aleatório, e o nome do campo entra como dado associado;
  - o formato antigo é migrado na abertura;
  - ao apagar os dados, a chave é destruída (crypto-shredding);
  - `android.allowBackup: false`.

#### V-02 · Frase de recuperação exibida sem reautenticação e sem bloqueio de captura
- **Severidade:** Alto (P média · I crítico). **Status:** corrigido.
- **Onde:** `apps/mobile/src/app/backup.tsx`: tocar em "Mostrar a frase" bastava.
- **Risco:** quem tem a frase tem identidade, contatos e carteira. Bastava o aparelho desbloqueado por alguns segundos, ou um print que fosse parar na galeria e na nuvem.
- **OWASP:** A07 *Identification and Authentication Failures*, porque uma operação sensível não exigia nova prova de posse. Também M3 *Insecure Authentication/Authorization*.
- **Correção:**
  - biometria ou PIN do aparelho antes de revelar (`expo-local-authentication`);
  - aviso se o aparelho não tem bloqueio nenhum;
  - prints e gravação de tela bloqueados (`FLAG_SECURE`) durante o backup.

#### V-03 · "Abrir o Piu com biometria" era só um interruptor visual
- **Severidade:** Alto (P alta · I alto). **Status:** corrigido.
- **Onde:** `apps/mobile/src/app/settings/[page].tsx`: o toggle salvava `priv.lock` e nada lia o valor.
- **Risco:** era um controle de segurança falso. A pessoa acreditava estar protegida e não estava, o que é pior do que não oferecer a opção.
- **OWASP:** A04 *Insecure Design*, porque o controle existia na interface mas não no fluxo. Também M3.
- **Correção:**
  - bloqueio real (`ui/AppLock.tsx`) ao abrir o app e ao voltar do segundo plano;
  - ligar ou desligar o bloqueio exige autenticação;
  - o app fica desfocado na troca de apps no iPhone;
  - na web a opção fica desabilitada, com explicação.

#### V-04 · Na versão web, a frase e a chave de dados ficam no `localStorage`
- **Severidade:** Baixo (era Médio; P baixa · I alto se houvesse produção web). **Status:** mitigado e aceito.
- **Onde:** `apps/mobile/src/lib/vault.ts`.
- **Risco:** um XSS ou extensão maliciosa leria os segredos. Hoje a versão web do app **não é publicada**: serve só para demonstração e para os testes de CI.
- **OWASP:** A02.
- **Mitigação:**
  - aviso na geração das chaves e no backup ("sem cofre seguro, não use com chaves reais");
  - a web nunca deve ser publicada como produto sem WebAuthn ou passphrase.

### 2.2 Controle de acesso

#### V-05 · Links `piu://` abriam telas internas antes do onboarding, e `/migrate` concluía sem chaves
- **Severidade:** Médio (P média · I médio). **Status:** corrigido.
- **Onde:** a raiz `apps/mobile/src/app/_layout.tsx` não tinha guarda de rota. `migrate.tsx` chamava `finishOnboarding()` incondicionalmente.
- **Risco:** um link malicioso levava a pessoa para carteira, backup ou ajustes num estado sem identidade. O `piu://migrate` deixava o app "pronto" sem nenhuma chave, um estado inconsistente.
- **OWASP:** A01 *Broken Access Control*, porque havia rotas acessíveis fora do estado que as autoriza.
- **Correção:**
  - `OnboardingGuard`: só as telas de onboarding ficam acessíveis antes de criar a identidade (inclusive por link);
  - a migração exige chaves.

#### V-06 · Qualquer remetente podia distribuir "nova chave do grupo" (protocolo)
- **Severidade:** Médio (P média · I alto quando os grupos usarem o protocolo). **Status:** corrigido.
- **Onde:** `apps/mobile/src/protocol/envelope.ts`: `decodeGroupKey` não tinha política de quem pode enviar.
- **Risco:** um membro ou terceiro podia injetar uma chave controlada por ele, ou reinstalar uma chave antiga (rollback). Isso reabriria o grupo para quem foi removido.
- **OWASP:** A01, porque faltava autorização numa operação administrativa.
- **Correção:** `acceptGroupKey` aceita a chave só de admin do grupo e só com versão maior que a atual. Teste dedicado.

#### V-07 · Painel do provider sem modelo de autenticação para o `piu-node`
- **Severidade:** Alto (P alta na rede local · I alto). **Status:** **corrigido** com `apps/piu-node` (PR #17) e a tela de pareamento do painel (PR #18).
- **Onde:** `apps/provider-panel`. A SPA é servida em `http://piu-node.local:8420` e oferece ações de operador (revogar credencial, transferir LUNES, mudar limites) sem nenhuma etapa de autenticação ou pareamento.
- **Risco:** quando o painel estiver ligado a uma API real, qualquer aparelho na mesma rede Wi-Fi poderá executar essas ações. O tráfego HTTP também pode ser interceptado.
- **OWASP:** A01 e A07.
- **Correção** (`apps/piu-node`, 14 testes de ataque):
  - pareamento por código de 8 dígitos mostrado só no equipamento (uso único, 10 min, hash e comparação em tempo constante), destruído após 5 erros de qualquer IP, e mais 5 tentativas por IP a cada 10 min;
  - sessão em cookie `__Host-` (`HttpOnly`, `Secure`, `SameSite=Strict`), com token só como hash, expiração por inatividade e logout no servidor;
  - CSRF por mesma origem mais `X-CSRF-Token`, conferidos em `onRequest`, antes de ler o corpo;
  - posse conferida em cada ação (IDOR devolve 404) e ids UUID v4;
  - step-up de 15 min para transferir LUNES;
  - lista de `Host` contra DNS rebinding, Helmet, CORS fechado, somente HTTPS com certificado próprio, erros genéricos e logs sem segredos.
  - O painel exige pareamento antes de exibir qualquer coisa e manda o token CSRF em toda ação (testado ponta a ponta).
  - Próximo passo: passkeys (WebAuthn) depois do primeiro pareamento.

### 2.3 Exposição de dados sensíveis

- **Logs no front: seguro.** Não há nenhum `console.*` em `apps/*/src` (verificado por busca), nem log nos módulos nativos. As mensagens de erro na interface são genéricas ("não foi possível guardar as chaves no cofre do aparelho"), sem stack trace.
- **Retornos de API: N/A.** Não existe API. Entre aparelhos, o envelope expõe só os metadados mínimos de roteamento:
  - o remetente vai selado dentro do conteúdo cifrado;
  - o destino lógico muda por dia e, depois da primeira resposta, deriva do segredo da sessão;
  - o tamanho é preenchido em blocos de 256 B a 16 KB.

  A prova de entrega revela um segredo, não a identidade de quem recebeu.

#### V-08 · Link de pacote do instalador por HTTP na rede local
- **Severidade:** Médio (P baixa · I alto). **Status:** **corrigido** (PRs #17 e #18).
- **Onde:** `apps/provider-panel/src/wizard/AddDeviceWizard.tsx` copiava `http://piu-node.local/pkg/…`.
- **Risco:** um atacante na mesma rede pode trocar o pacote no caminho (MITM). Hoje a interface diz que o pacote é "assinado", mas a verificação acontece no equipamento, fora deste repositório.
- **OWASP:** A08 *Software and Data Integrity Failures*.
- **Correção:**
  - os pacotes são servidos por HTTPS e só aparecem com manifesto Ed25519 assinado pela chave de release **fixada** e com o arquivo conferido (tamanho e SHA-256);
  - `scripts/verify-package.mjs` faz o instalador conferir de novo antes de executar;
  - o painel mostra o hash e o comando de verificação ao lado do link.
- **Decisão pendente do usuário:** gerar e guardar a chave de release da Lunes (`npm run release:keygen`), idealmente em HSM ou cofre.

### 2.4 Identificadores e enumeração

- **Seguro.** Não há endpoints. Os ids que trafegam são hashes criptográficos:
  - envelope: SHA-256 truncado, 128 bits;
  - identidade: `piu:` + 128 bits do hash das chaves.

  Ids locais (`'n' + Date.now()`) nunca saem do aparelho. **Não há IDs incrementais expostos.** Para a futura API do `piu-node`, use UUIDv7 ou ids aleatórios de 128 bits e nunca a chave primária do banco.

### 2.5 Headers e servidor

#### V-09 · Site e painel sem CSP nem headers de segurança
- **Severidade:** Médio (P baixa hoje, sem entrada de usuário · I alto se surgir um XSS). **Status:** corrigido.
- **Onde:** `apps/site` e `apps/provider-panel` não tinham `_headers` nem CSP. O site tinha um script de tema inline, e o Vite embutia as fontes como `data:`.
- **Risco:** sem defesa em profundidade contra XSS e clickjacking. O painel podia ser exibido em iframe de qualquer origem.
- **OWASP:** A05 *Security Misconfiguration*.
- **Correção:**
  - **Painel:** CSP estrita em `<meta>` (vale também no `piu-node`) e em `_headers` (`default-src 'none'`, `script-src 'self'`); assets sem `data:`; `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP e HSTS.
  - **Site:** CSP com **hashes** gerada pelo Astro (`security.csp`); script de tema externo; o painel embutido só pode ser exibido pelo próprio site (`frame-ancestors 'self'`).
  - Conferido no navegador: **0 violações**.
- **Helmet:** o site e o painel são estáticos. O `piu-node` (Node/Fastify) usa `@fastify/helmet` com a mesma CSP do painel, mais `Permissions-Policy`.
- **Fingerprinting:** o build não expõe `X-Powered-By`, versões nem source maps. Mantenha `sourcemap: false` em produção.

### 2.6 CORS

- **N/A hoje e seguro por padrão.** Nenhuma resposta envia `Access-Control-Allow-Origin`. O site e o painel não fazem requisições a outras origens (`connect-src 'self'`). A sincronização de tema entre o site e o iframe usa `postMessage` com origem fixa (`location.origin`), e o painel valida `e.origin` e aceita só `'light' | 'dark'`.

### 2.7 Malha P2P (disponibilidade)

#### V-10 · Roteador sem limite por vizinho
- **Severidade:** Médio (P média · I médio). **Status:** corrigido.
- **Onde:** `apps/mobile/src/protocol/router.ts`.
- **Risco:** um vizinho podia inundar o nó com envelopes, gastando CPU com cabeçalhos e enchendo a fila.
- **OWASP:** A04 (falta de limite de recursos no desenho); equivale a "rate limiting".
- **Correção:** balde de fichas por vizinho (600 envelopes por minuto, rajada de 120), aplicado antes de qualquer criptografia. Teste dedicado.

#### V-11 · Remontagem BLE do iPhone sem teto de memória
- **Severidade:** Médio (P média · I médio, com o app derrubado). **Status:** corrigido.
- **Onde:** `modules/piu-transport/ios/PiuTransportModule.swift`, em `partial`.
- **Risco:** blocos de milhares de mensagens que nunca se completam esgotam a memória.
- **OWASP:** A04.
- **Correção:**
  - no máximo 32 KB por envelope;
  - no máximo 64 remontagens abertas;
  - expiração em 60 s.

#### V-12 · O transporte aceita qualquer conexão
- **Severidade:** Baixo. **Status:** aceito por desenho.
- **Risco:** o transporte não autentica ninguém, e quem confere identidade é a camada de cima (assinatura do remetente e código de segurança). Combinado com V-10 e V-11, isso limita o abuso.

### 2.8 Cadeia de suprimentos e CI

#### V-13 · Workflows sem `permissions` explícitas
- **Severidade:** Médio (P baixa · I alto). **Status:** corrigido.
- **Risco:** o `GITHUB_TOKEN` herdava as permissões padrão da organização, possivelmente de escrita. Uma dependência comprometida no CI poderia alterar o repositório.
- **OWASP:** A08.
- **Correção:**
  - `permissions: contents: read` em todos os workflows;
  - `persist-credentials: false` no checkout.

#### V-14 · Actions por tag mutável (`@v4`)
- **Severidade:** Baixo. **Status:** corrigido: fixadas por SHA (v4.4.0).

#### V-15 · Sem Dependabot nem portão de auditoria
- **Severidade:** Baixo. **Status:** corrigido.
- **Correção:**
  - Dependabot semanal para os 3 apps e as Actions;
  - `npm audit --omit=dev --audit-level=high` falha o CI.

#### V-16 · `npm audit`: 12 avisos moderados no app
- **Severidade:** Baixo. **Status:** aceito; acompanhado pelo Dependabot.
- **Detalhe:** os avisos estão em `glob` e `minimatch` dentro do `@expo/cli`, ferramenta de build que não entra no app. O painel e o site têm 0 avisos.

### 2.9 Hardening geral: o que é N/A e por quê

- **SQL injection:** não há banco de dados nem SQL em nenhum app. Para o `piu-node`: consultas parametrizadas sempre, e ORM sem concatenação de strings.
- **XSS:** seguro.
  - React e Astro escapam toda saída.
  - Não há `dangerouslySetInnerHTML`, `innerHTML`, `set:html`, `eval` nem `new Function` (verificado).
  - O site usa `textContent`.
  - Agora há CSP estrita como segunda camada.
- **CSRF:** N/A. Não há cookies, sessão nem formulários que mudem estado num servidor. Para o `piu-node`: `SameSite=Strict` mais token anti-CSRF.
- **Rate limiting e força bruta:**
  - não há login no repositório;
  - o roteador P2P agora tem limite por vizinho;
  - o desbloqueio do app usa a biometria do sistema, que já limita as tentativas.
- **JWT, RBAC e IDOR:** N/A, não há API.

#### V-17 a V-19 · Limitações do protocolo (documentadas em `apps/mobile/src/protocol/README.md`)
- **V-17**, Baixo: as primeiras mensagens de uma sessão, antes da resposta, dependem da chave de identidade do destinatário (sem pre-keys).
- **V-18**, Baixo: as chaves dos contatos de **demonstração** são derivadas de ids públicos. Servem só para exibir o código real e não existem em produção.
- **V-19**, Baixo: os algoritmos são candidatos. O documento de requisitos exige **threat modeling formal e auditoria independente antes de produção**, e esta auditoria não substitui aquela.

---

## 3. Correções aplicadas (ANTES / DEPOIS)

### V-01 · Cifragem em repouso (`apps/mobile/src/lib/persist.ts`)

Antes:
```ts
AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
```

Depois:
```ts
function seal(key: string, value: unknown): string {
  if (!dataKey) throw new Error('Chave de dados indisponível.');
  const nonce = new Uint8Array(12); globalThis.crypto.getRandomValues(nonce);
  const ct = gcm(dataKey, nonce, enc.encode(PREFIX + key)).encrypt(enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.length); out.set(nonce); out.set(ct, 12);
  return MARK + b64(out);                       // AES-256-GCM, chave de 256 bits no Keychain/Keystore
}
// …
let sealed: string;
try { sealed = seal(key, value); } catch { return; } // sem chave, NUNCA grava em texto puro
AsyncStorage.setItem(PREFIX + key, sealed).catch(() => {});
```
Também: `app.json` → `"android": { "allowBackup": false }`; e `clearPersisted()` chama `clearDataKey()`, destruindo a chave.

### V-02 · Frase só depois de autenticar (`apps/mobile/src/app/backup.tsx`)

Antes:
```tsx
<Button label={shown ? 'Já anotei' : 'Mostrar a frase'} onPress={() => (shown ? setStep('confirm') : setShown(true))} />
```

Depois:
```tsx
usePreventCapture('backup');                      // FLAG_SECURE no Android, bloqueio de gravação no iPhone
const reveal = async () => {
  const r = await confirmDevice('Mostrar a frase de recuperação'); // biometria ou PIN do aparelho
  if (r === 'denied') { setDenied(true); return; }
  setNoLock(r === 'unavailable');                 // sem bloqueio no aparelho: mostra com aviso explícito
  setShown(true);
};
<Button label={shown ? 'Já anotei' : 'Mostrar a frase'} onPress={() => (shown ? setStep('confirm') : void reveal())} />
```

### V-03 · Bloqueio real (`apps/mobile/src/ui/AppLock.tsx`, `settings/[page].tsx`)

Antes:
```tsx
<ToggleRow name="Abrir o Piu com biometria" on={priv.lock} onChange={t('lock')} />  // nada lia priv.lock
```

Depois:
```tsx
<ToggleRow name="Abrir o Piu com biometria" disabled={Platform.OS === 'web'} on={priv.lock} onChange={async () => {
  const r = await confirmDevice(priv.lock ? 'Desligar o bloqueio do Piu' : 'Ligar o bloqueio do Piu');
  if (r === 'ok') setPriv({ lock: !priv.lock });
}} />
// _layout.tsx: <AppLock /> cobre o app ao abrir e ao voltar do segundo plano até autenticar.
```

### V-05 · Guarda de rotas (`apps/mobile/src/app/_layout.tsx`)

Antes: nenhuma checagem. Qualquer `piu://<rota>` abria a tela.

Depois:
```tsx
const PRE_ONBOARDING = new Set(['welcome', 'identity', 'keys', 'restore', 'migrate']);
function OnboardingGuard() {
  const segments = useSegments();
  const { onboarded } = useStore();
  const first = segments[0] as string | undefined;
  useEffect(() => { if (!onboarded && first && !PRE_ONBOARDING.has(first)) router.replace('/welcome'); }, [onboarded, first]);
  return null;
}
// migrate.tsx: if (!identities) { router.replace('/restore'); return; }
```

### V-06 · Chave de grupo só de admin (`apps/mobile/src/protocol/envelope.ts`)

Antes: `decodeGroupKey(m.body)` aceito de qualquer remetente.

Depois:
```ts
export function acceptGroupKey(m: Opened, isAdmin: (fromId: string, groupId: string) => boolean, currentVersion: (groupId: string) => number): GroupKey | null {
  if (m.type !== MsgType.GroupKey) return null;
  const k = decodeGroupKey(m.body);
  if (!k) return null;
  const gid = toHex(k.groupId);
  if (!isAdmin(m.fromId, gid)) return null;          // só admin distribui chave
  if (k.version <= currentVersion(gid)) return null; // sem rollback para chave antiga
  return k;
}
```

### V-09 · Headers e CSP (`apps/provider-panel/public/_headers`, `index.html`; `apps/site/public/_headers`, `astro.config.mjs`)

Antes: nenhum header, script de tema inline e fontes como `data:`.

Depois (painel):
```
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```

Depois (site):
```js
// astro.config.mjs: CSP com hashes em <meta>, sem 'unsafe-inline' para scripts
security: { csp: { algorithm: 'SHA-256', directives: ["default-src 'none'", "img-src 'self' data:", "font-src 'self'", /* … */],
  scriptDirective: { resources: ["'self'"] },
  styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] } } },
build: { format: 'directory', inlineStylesheets: 'never' },
vite: { build: { assetsInlineLimit: 0 } },
```

### V-10 · Limite por vizinho (`apps/mobile/src/protocol/router.ts`)

Antes: `ingest()` processava tudo o que chegava.

Depois:
```ts
ingest(bytes: Uint8Array, from: string | null, now: number): IngestResult {
  if (from !== null && !this.take(from, now)) return { status: 'rejected', reason: 'limite do vizinho' };
  // …
}
private take(peer: string, now: number): boolean {         // balde de fichas por vizinho
  const b = this.buckets.get(peer) ?? { tokens: this.limits.peerBurst, at: now };
  b.tokens = Math.min(this.limits.peerBurst, b.tokens + ((now - b.at) * this.limits.peerPerMinute) / 60);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  this.buckets.set(peer, b);
  return ok;
}
```

### V-13 / V-14 / V-15 · CI (`.github/workflows/*.yml`, `.github/dependabot.yml`)

Antes:
```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
```

Depois:
```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
    with:
      persist-credentials: false
  - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
  - run: npm ci
  - name: Auditoria de dependências (falha em alto/crítico)
    run: npm audit --omit=dev --audit-level=high
```

---

## 4. Security Score

Fórmula pedida: −30 por crítico, −20 por alto, −10 por médio e −5 por baixo; +5 por boas práticas avançadas e +5 por defesa em profundidade.

**Antes das correções:**
- 4 altos (−80), 8 médios (−80) e 7 baixos (−35) = −195;
- o resultado fica abaixo de zero e é limitado a 0;
- os bônus não se aplicavam, porque a frase ficava exposta e o bloqueio era falso.

🔢 **Security Score inicial: 0/100**, **Crítico** (risco sistêmico, ver resumo executivo).

**Depois das correções** (o que resta: 6 baixos aceitos e documentados):
- 6 baixos (−30), o que dá 70;
- +5 por boas práticas avançadas:
  - criptografia auditada (`@noble`), suíte trocável, Double Ratchet;
  - CSP com hashes;
  - Actions fixadas por SHA;
  - 32 testes de ataque no CI.
- +5 por defesa em profundidade: cofre do sistema + cifragem em repouso + bloqueio do app + CSP + limite por vizinho; no `piu-node`, pareamento + sessão + CSRF + posse + step-up + TLS.

🔢 **Security Score final: 80/100**, **Bom (com melhorias)**.

Para chegar ao nível *enterprise* (90+), faltam:
- a revisão formal e independente da criptografia (V-19);
- pre-keys para as primeiras mensagens (V-17);
- passkeys no `piu-node`;
- tirar a versão web de demonstração do caminho dos segredos (V-04).

---

## 5. Recomendações estratégicas

1. **`piu-node`.** Já feito em `apps/piu-node`: pareamento, sessão curta `SameSite=Strict`, CSRF, autorização por recurso, limite de tentativas, Helmet, CORS fechado, TLS, logs sem segredos e pacotes assinados. Falta para produção:
   - passkeys (WebAuthn) depois do primeiro pareamento;
   - pareamento também por QR, com a impressão digital do certificado embutida (fixação automática);
   - gerar a chave de release da Lunes e guardá-la em HSM ou cofre;
   - ligar a camada de acesso ao motor LNNP e à carteira real, já que hoje os dados são de referência.
2. **Threat modeling formal e auditoria criptográfica independente**, como o próprio documento de requisitos exige. Prioridades: sessões com pre-keys, MLS para grupos e antifraude com auditoria real de retransmissão.
3. **Publicação do site atrás da Cloudflare:**
   - WAF gerenciado (regras OWASP) e proteção contra DDoS;
   - TLS 1.3 com "Always Use HTTPS";
   - HSTS com preload, depois de definido o domínio;
   - os headers de `_headers`.

   O site é estático, então o WAF protege sobretudo a disponibilidade. Para o `piu-node`, que roda na rede local, um WAF de nuvem não se aplica; valem os controles do item 1.
4. **Hardening do app nativo:**
   - detecção de root/jailbreak, como aviso e não como bloqueio;
   - App Attest / Play Integrity, para o antifraude de recompensas;
   - pinning do próprio instalador no "Convidar para o Piu";
   - nunca publicar a versão web com segredos.
5. **Processo:**
   - Dependabot e o portão de `npm audit` já ativos;
   - adicionar análise estática (CodeQL) e secret scanning no GitHub;
   - testes de ataque do protocolo obrigatórios em todo PR (já estão no CI);
   - revisão de segurança como item fixo do checklist de PR.
