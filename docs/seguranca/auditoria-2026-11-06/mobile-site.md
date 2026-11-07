# Auditoria AppSec — Piu `apps/mobile` + `apps/site`

Data: 2026-11-06 · Modo: somente leitura (nenhum arquivo do repositório foi alterado) · Base: OWASP Mobile Top 10 2024, OWASP Top 10 2021, MASVS v2.

Escopo lido: `apps/mobile/src/**` (protocol, lib, state, app, ui), `apps/mobile/modules/**` (Kotlin: piu-node-link, piu-app-share, piu-transport), `android/app/src/*/AndroidManifest.xml`, `android/app/build.gradle`, `plugins/`, `app.json`, `eas.json`; APK de release já compilado em `android/app/build/outputs/apk/release/app-release.apk` (permissões e certificado conferidos com `aapt2`/`apksigner`); `apps/site/**` (astro.config, `_headers`, componentes, i18n de download). `npm audit --omit=dev` executado nos dois apps.

Decisões deliberadas respeitadas (não contadas como achado): sem `usesCleartextTraffic` no release; bloqueio de captura de tela só no chat; segurança de tela do iOS ignorada.

## Resumo

| Severidade | Qtde |
|---|---|
| Crítica | 0 |
| Alta | 1 |
| Média | 3 |
| Baixa | 7 |
| Info | 4 |

**Nota proposta: 80/100.** A base criptográfica e a carteira estão acima da média do mercado (detalhes em "O que está bem feito"). O que puxa a nota para baixo é lógica de fluxo em volta da frase de recuperação (deep link para telas de onboarding e política inconsistente de bloqueio do aparelho), não a criptografia.

Dependências (`npm audit --omit=dev --json`): **mobile: 0 high / 0 critical** (8 moderate, todas na cadeia de ferramentas do Expo: `@expo/cli`, `@expo/config`, `glob`…); **site: 0 vulnerabilidades**.

---

## Achados

### A-01 — Telas de restauração (`/restore`, `/migrate`) acessíveis por deep link depois do onboarding; frase atual é sobrescrita sem aviso
- **Severidade:** Alta
- **OWASP:** M8 Security Misconfiguration / M4 Insufficient Input/Output Validation (deep link) · A01 Broken Access Control
- **Local:** `apps/mobile/src/app/_layout.tsx:66-77`, `apps/mobile/src/state/keys.tsx:63-66`, `apps/mobile/src/app/migrate.tsx:98-102`, `apps/mobile/src/app/restore.tsx:70-84`, `apps/mobile/src/state/settings.tsx:73` (padrão `restoreMode = 'device'`)
- **Evidência:** o `OnboardingGuard` só redireciona quem **não** fez onboarding (`if (onboarded || …) return;`). Para quem já tem identidade, `piu://restore` e `piu://migrate` abrem normalmente (o Expo Router expõe toda rota pelo scheme `piu`, intent-filter `BROWSABLE` exportado). Dentro do app não existe caminho para essas telas após o onboarding — só o deep link. `KeysProvider.restore()` faz `savePhrase(w)` direto, sem conferir se já existe frase nem se ela tem backup.
- **Cenário de exploração:** golpe de "suporte"/"airdrop": a vítima recebe `piu://migrate` (ou `piu://restore`) num chat/site. Em `migrate` (modo padrão `device`) o app mostra a oferta com botão "Copiar código"; a vítima envia o código ao golpista, que monta uma resposta `piu-mig2:` com a frase **dele** e dita as 4 palavras (ele as tem, pois controla a oferta respondida). Ao confirmar, a frase original da vítima é apagada do cofre e substituída. Efeitos: (1) se não havia backup, a carteira Lunes original e a identidade são perdidas de forma irreversível; (2) a partir daí o endereço "da vítima" é do golpista — todo LUNES recebido e toda mensagem futura ficam com ele. Variante sem nenhum QR: `piu://restore` com a frase colada ("importe esta carteira para receber o bônus").
- **Correção (ANTES → DEPOIS):**
```tsx
// _layout.tsx — ANTES
useEffect(() => {
  if (onboarded || !first || PRE_ONBOARDING.has(first)) return;
  …
  router.replace('/welcome');
}, [onboarded, first]);

// DEPOIS: telas de onboarding/restauração não abrem com identidade existente
const ONBOARDING_ONLY = new Set(['welcome', 'identity', 'restore', 'migrate']); // 'keys' já se protege
useEffect(() => {
  if (!first) return;
  if (onboarded) { if (ONBOARDING_ONLY.has(first)) router.replace('/(tabs)'); return; }
  if (PRE_ONBOARDING.has(first)) return;
  …
  router.replace('/welcome');
}, [onboarded, first]);
```
```tsx
// state/keys.tsx — ANTES
restore: async words => { …; await savePhrase(w); preloaded = w; setPhrase(w); },
// DEPOIS: nunca troca uma frase existente por acidente
restore: async (words, o?: { replace?: boolean }) => {
  const w = words.map(x => x.trim().toLowerCase());
  if (!isValidPhrase(w)) throw new Error('Frase inválida.');
  const cur = preloaded;
  if (cur && cur.join(' ') !== w.join(' ') && !o?.replace) throw new Error('Já existe uma identidade neste aparelho. Apague os dados locais antes de restaurar outra.');
  await savePhrase(w); preloaded = w; setPhrase(w);
},
```
- **Muda comportamento/protocolo?** Comportamento: sim, pouco — quem já tem identidade não consegue mais abrir restauração por link (era um caminho não intencional; "trocar de identidade" passa a exigir "Apagar dados locais"). Protocolo: não.

---

### M-01 — Revelar/transferir a frase não exige bloqueio do aparelho (a carteira exige)
- **Severidade:** Média
- **OWASP:** M3 Insecure Authentication/Authorization · MASVS-AUTH-2
- **Local:** `apps/mobile/src/app/backup.tsx:58-63`, `apps/mobile/src/app/devices.tsx:69-71`; contraste com `apps/mobile/src/state/wallet.tsx:262-263` e `apps/mobile/src/app/scan.tsx:67-70`
- **Evidência:** `confirmDevice()` devolve `'unavailable'` quando o aparelho não tem PIN/biometria. Backup: `if (r === 'denied') return; setNoLock(...); setShown(true)` — mostra a frase. Transferência para aparelho novo: só bloqueia `'denied'`, envia a frase cifrada. Já a assinatura de transferência (`authorize`) e a aprovação do painel recusam `'unavailable'`.
- **Cenário:** celular sem bloqueio emprestado/esquecido por 1 minuto. O app impede enviar LUNES sem bloqueio, mas permite exibir as 12 palavras (ou exportá-las para o aparelho do atacante em Aparelhos → Adicionar). Com a frase, o atacante esvazia a carteira em outro dispositivo. A proteção da carteira é contornada pelo caminho mais sensível.
- **Correção:**
```tsx
// backup.tsx — ANTES
if (r === 'denied') { setDenied(true); return; }
setNoLock(r === 'unavailable');
setShown(true);
// DEPOIS (mesma regra da carteira)
if (r !== 'ok' && Platform.OS !== 'web') { r === 'denied' ? setDenied(true) : setNoLock(true); return; }
setShown(true);

// devices.tsx — ANTES
if (auth === 'denied') { …; return; }
// DEPOIS
if (auth !== 'ok') { showToast({ icon: 'gpp_bad', title: t('devices.transferCancelled'), body: auth === 'unavailable' ? t('scan.panel.needLock') : t('devices.notYou') }); setPair(null); return; }
```
- **Muda comportamento?** Sim: em aparelhos sem bloqueio, ver/transferir a frase passa a pedir que a pessoa ative um bloqueio (a mensagem `scan.panel.needLock` já existe). Protocolo: não.

---

### M-02 — Replay da primeira mensagem de um contato reinicia uma sessão Double Ratchet já estabelecida
- **Severidade:** Média (disponibilidade/integridade da conversa)
- **OWASP:** M5 Insecure Communication (replay) · A04 Insecure Design
- **Local:** `apps/mobile/src/protocol/sessions.ts:40-44`; dedup em `apps/mobile/src/protocol/router.ts:35,108-110` (`maxSeen: 100_000`, despejo FIFO)
- **Evidência:** se a sessão atual já recebeu algo (`cur?.established`) e a mensagem não abre nela, o código tenta `Session.respond(...)` e, se abrir, **substitui** a sessão. A mensagem inicial de uma sessão (X3DH estático-estático + 1º passo de DH) continua abrível enquanto o envelope não expira (TTL padrão 48 h, até 7 dias, `readInner` aceita). A única barreira contra o replay é o conjunto `seen` (100 mil ids, FIFO, também perdido em "Apagar dados locais").
- **Cenário:** um relay da malha (não confiável por definição) guarda o primeiro envelope de Alice para Bob. Depois inunda Bob com >100 mil envelopes distintos (limite de 600/min por vizinho; com vários vizinhos BLE/Wi-Fi Sybil, horas) para despejar o id do `seen`, e reenvia o envelope antigo. Bob troca a sessão boa por uma "nova" que Alice não tem: as mensagens nos dois sentidos passam a falhar em silêncio até alguém reinstalar/re-adicionar.
- **Correção:** guardar o `sentAt` da última mensagem autêntica por contato e só aceitar uma sessão nova se ela for mais recente; manter a anterior como alternativa (como o Signal faz com sessões arquivadas).
```ts
// sessions.ts — ANTES
if (cur?.established) {
  const fresh = Session.respond(this.me, m.from);
  const p2 = fresh.decrypt(m.body);
  if (p2) { this.sessions.set(m.fromId, fresh); return p2; }
  return null;
}
// DEPOIS
if (cur?.established) {
  if (m.sentAt <= (this.lastAt.get(m.fromId) ?? 0)) return null;        // replay de início antigo
  const fresh = Session.respond(this.me, m.from);
  const p2 = fresh.decrypt(m.body);
  if (!p2) return null;
  this.previous.set(m.fromId, cur);                                       // ainda abre mensagens da sessão antiga
  this.sessions.set(m.fromId, fresh); this.lastAt.set(m.fromId, m.sentAt);
  return p2;
}
// e, no caminho normal: if (pt) this.lastAt.set(m.fromId, Math.max(m.sentAt, this.lastAt.get(m.fromId) ?? 0));
// tentar `this.previous.get(id)?.decrypt(...)` antes de desistir; exportar/importar lastAt e previous.
```
- **Muda comportamento/protocolo?** Formato no fio: não. Comportamento: estado exportado ganha campos novos (compatível para frente); sessões reiniciadas com relógio muito atrasado podem ser recusadas até a próxima mensagem com horário correto.

---

### M-03 — Build de release cai silenciosamente na chave de debug pública
- **Severidade:** Média
- **OWASP:** M2 Inadequate Supply Chain Security · M7 Insufficient Binary Protections
- **Local:** `apps/mobile/android/app/build.gradle:124`, `apps/mobile/plugins/releaseSigningGradle.js:9,36`
- **Evidência:** `signingConfig System.getenv('PIU_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`. Sem a variável (CI mal configurado, máquina nova), `assembleRelease` gera um APK de release assinado com `debug.keystore` (senha `android`, chave conhecida por qualquer um). O APK atual está correto (certificado `595bdc6a…78b7ff31`, igual ao do site), então é risco de processo, não de artefato publicado.
- **Cenário:** o Piu se espalha de celular para celular (Quick Share, Wi-Fi Direct) e o Android só garante continuidade pela assinatura. Se algum release sair com a chave de debug, qualquer pessoa pode gerar um "Piu atualizado" malicioso, assinado com a mesma chave pública de debug, que instala por cima e lê o cofre (mesmo UID) — frase e carteira.
- **Correção:**
```groovy
// ANTES
signingConfig System.getenv('PIU_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug
// DEPOIS: release sem chave falha; teste local explícito com -PallowDebugSignedRelease
def piuStore = System.getenv('PIU_RELEASE_STORE_FILE')
if (!piuStore && !project.hasProperty('allowDebugSignedRelease')) {
  gradle.taskGraph.whenReady { g -> if (g.allTasks.any { it.name.toLowerCase().contains('release') }) throw new GradleException('PIU_RELEASE_STORE_FILE ausente: release não pode usar a chave de debug.') }
}
signingConfig piuStore ? signingConfigs.release : signingConfigs.debug
```
(aplicar no `releaseSigningGradle.js` para sobreviver ao `prebuild`; opcional: conferir no CI com `apksigner verify --print-certs` que o SHA-256 é `595bdc6a…`).
- **Muda comportamento?** Só para quem compila (build local de release sem chave passa a exigir a flag). App e protocolo: não.

---

### B-01 — Biometria só na interface: segredo no cofre não exige autenticação para ser lido
- **Severidade:** Baixa
- **OWASP:** M3 Insecure Authentication · MASVS-AUTH-2 / MASVS-STORAGE-1
- **Local:** `apps/mobile/src/lib/vault.ts:14`, `apps/mobile/src/lib/deviceAuth.ts:16-24`
- **Evidência:** `SecureStore` usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (bom), mas sem `requireAuthentication`; `authenticateAsync` não está ligado a uma operação criptográfica (CryptoObject). A frase é lida em `preloadKeys()` na abertura e fica na memória do JS.
- **Cenário:** só em aparelho comprometido (root/Frida) ou app instrumentado: basta pular o `confirmDevice` para assinar ou exibir a frase. Sem isso, não explorável.
- **Correção:** guardar uma cópia da frase (ou a chave de dados) com `requireAuthentication: true` e ler essa cópia só para assinar/revelar; o resto do app usa só as chaves públicas/derivadas.
```ts
// ANTES
const OPTS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// DEPOIS (item separado, lido só na hora de assinar/revelar)
const SIGN_OPTS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: true, authenticationPrompt: 'Confirme para assinar' };
```
- **Muda comportamento?** Sim: a biometria passa a ser pedida pelo sistema ao ler o segredo (substitui o `confirmDevice` atual); troca de biometria invalida o item e exige restaurar pela frase/backup. Protocolo: não.

### B-02 — Permissões além do necessário no APK de release
- **Severidade:** Baixa
- **OWASP:** M8 Security Misconfiguration · MASVS-PLATFORM
- **Local:** `apps/mobile/android/app/src/main/AndroidManifest.xml:6-7` (e APK de release, conferido com `aapt2 dump permissions`)
- **Evidência:** o release declara `RECORD_AUDIO` e `SYSTEM_ALERT_WINDOW` embora `app.json` diga `microphonePermission: false`/`recordAudioAndroid: false`; também `com.google.android.c2dm.permission.RECEIVE` e o serviço FCM com `enableRemoteNotifications: false`; `READ_MEDIA_IMAGES` (o seletor de fotos do sistema não precisa).
- **Cenário:** não há exploração direta; aumenta superfície (um bug/injeção futura teria microfone e sobreposição de tela à disposição) e passa sinal ruim para usuário e lojas.
- **Correção:**
```xml
<!-- ANTES -->
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
<!-- DEPOIS (main/AndroidManifest.xml; manter SYSTEM_ALERT_WINDOW só em src/debug) -->
<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
<uses-permission android:name="com.google.android.c2dm.permission.RECEIVE" tools:node="remove"/>
```
(de preferência via `android.blockedPermissions` no `app.json`, para sobreviver ao prebuild).
- **Muda comportamento?** Não para o usuário (nenhuma função usa microfone/overlay/push remoto). Protocolo: não.

### B-03 — "Enviar o Piu" (Wi-Fi Direct/Quick Share) entrega o APK sem forma de conferir integridade
- **Severidade:** Baixa
- **OWASP:** M2 Inadequate Supply Chain Security
- **Local:** `apps/mobile/src/lib/wifiShare.ts:33-43`, `apps/mobile/modules/piu-app-share/android/src/main/java/expo/modules/piuappshare/PiuAppShareModule.kt:190-209`
- **Evidência:** a página local (HTTP dentro de rede WPA2 com senha nova por sessão — bom) não mostra SHA-256 do APK nem o certificado de assinatura; quem recebe por Bluetooth também não tem como conferir.
- **Cenário:** quem está na mesma rede Wi-Fi Direct (recebeu o QR) ou um "amigo" que repassa um APK adulterado: o receptor não tem referência para comparar com `595B DC6A … 78B7 FF31` do site.
- **Correção:** calcular no módulo `SHA-256` do APK e do certificado (`PackageManager.GET_SIGNING_CERTIFICATES`) e exibir na página e na tela do app ("Confira: certificado 595B DC6A … FF31"). Ex.: `downloadPageHtml(fileName, size, lang, { apkSha, certSha })` → `<p class=mono>Certificado SHA-256: ${certSha}</p>`.
- **Muda comportamento?** Só visual (mais um texto na página e na tela). Protocolo: não.

### B-04 — Site: integridade de download só com hash truncado e fixo no texto; assinatura GPG ainda não existe
- **Severidade:** Baixa
- **OWASP:** A08 Software and Data Integrity Failures
- **Local:** `apps/site/src/i18n/pt.ts:95` (e `en.ts`), `apps/site/src/lib/desktopRelease.ts:42-50,62`
- **Evidência:** o APK mostra `SHA-256 6e21 b8e9 … 0234 0c25` (16 de 64 hex) escrito à mão no i18n; os arquivos desktop têm `sha256` vazio; `RELEASE_KEY_FPR = ''` (sem `SHA256SUMS.txt.asc`). O APK local compilado (`8353…aa06`) já difere do texto — mostra como o valor fixo fica desatualizado fácil.
- **Cenário:** conta/release do GitHub comprometida ou CDN trocando o arquivo: sem hash completo nem assinatura independente, a pessoa não tem como detectar. (O transporte é HTTPS do GitHub, então MITM de rede não se aplica.)
- **Correção:** gerar os valores no build a partir do `SHA256SUMS.txt` do release (mesma fonte de `desktopRelease.ts`), exibir o hash **completo** (com botão copiar) e publicar a chave GPG.
```ts
// ANTES (pt.ts)
signature: ['Certificado do app (SHA-256) · 595B DC6A … 78B7 FF31', 'Piu-0.1.0.apk · SHA-256 6e21 b8e9 … 0234 0c25'],
// DEPOIS (lib/androidRelease.ts, preenchido pelo script de release)
export const ANDROID_FILE = { file: 'Piu-0.1.0.apk', sha256: '<64 hex>', certSha256: '595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31' };
```
- **Muda comportamento?** Só visual. Protocolo: não.

### B-05 — Painel do provider: QR `piup:` sobrescreve pareamento sem confirmação; destino de `piut:` sem checksum SS58
- **Severidade:** Baixa
- **OWASP:** M4 Insufficient Input/Output Validation
- **Local:** `apps/mobile/src/app/scan.tsx:49-53`, `apps/mobile/src/lib/approvals.ts:53`
- **Evidência:** ler um `piup:` com o mesmo `phoneId` troca o segredo salvo imediatamente (`filter(...)` + `saveApprovalNodes`). `parseRequest` aceita `lunes:` + base58 de 26–44 caracteres sem `decodeSs58`.
- **Cenário:** QR malicioso colado/escaneado desfaz o pareamento com o nó real (negação de serviço das aprovações); destino com checksum errado é exibido como se válido (o dinheiro sai pelo piu-node, que precisa validar também).
- **Correção:**
```ts
// approvals.ts — ANTES
if (j.t !== 'personal' && !/^lunes:[1-9A-HJ-NP-Za-km-z]{26,44}$/.test(j.t)) throw …
// DEPOIS
if (j.t !== 'personal' && !(typeof j.t === 'string' && j.t.startsWith('lunes:') && decodeSs58(j.t.slice(6)).ok)) throw new Error('Destino inválido.');
// scan.tsx: se já existe nó com o mesmo phoneId e segredo diferente, mostrar confirmação antes de salvar.
```
- **Muda comportamento?** Sim, levemente: um diálogo a mais ao re-parear; pedidos com endereço inválido passam a ser recusados. Protocolo: não (o formato do QR é o mesmo).

### B-06 — Recebimento de arquivos pode reter ~400 MB em memória
- **Severidade:** Baixa
- **OWASP:** M4 / A04 (consumo de recurso)
- **Local:** `apps/mobile/src/messaging/messenger.ts:266,675,657-663`
- **Evidência:** até 8 recebimentos simultâneos de até 50 MB cada, montados em `Map` + `Uint8Array` inteiro em RAM; imagens ≤1,5 MB viram data URI base64 dentro do estado persistido.
- **Cenário:** contato aceito (ou conta comprometida de um contato) oferece 8 arquivos de 50 MB por Wi-Fi Direct com download automático: o Hermes estoura memória e o app fecha repetidamente.
- **Correção:** limitar bytes totais em trânsito (ex.: `MAX_RX_BYTES = 64 MB`) e escrever blocos em arquivo temporário em vez de RAM.
```ts
// ANTES
if (this.fileRx.size - held >= 8 || held >= 100) return;
// DEPOIS
const inFlight = [...this.fileRx.values()].filter(r => !r.held).reduce((a, r) => a + r.size, 0);
if (this.fileRx.size - held >= 8 || held >= 100 || (!hold && inFlight + p.s > MAX_RX_BYTES)) return; // fica como "Baixar"
```
- **Muda comportamento?** Sim, pouco: arquivos grandes simultâneos ficam como "Baixar" em vez de automáticos. Protocolo: não.

### B-07 — Nomes e descrições aceitam caracteres de formatação bidi (spoofing visual)
- **Severidade:** Baixa
- **OWASP:** M4 Insufficient Input/Output Validation
- **Local:** `apps/mobile/src/messaging/card.ts:52-57` (`clampName`), `apps/mobile/src/lib/paymentRequest.ts:52` (`cleanDesc` remove `\p{Cc}`, não `\p{Cf}`), nomes de presença `messenger.ts:909`
- **Evidência:** U+202E (RLO), U+2066–2069, zero-width passam.
- **Cenário:** cartão de contato com nome "Ana‮lapyap‬" ou descrição de pedido de pagamento que inverte texto para parecer outro valor/destinatário na lista.
- **Correção:**
```ts
// ANTES
const cleanDesc = (s: string) => s.replace(/[\s\p{Cc}]+/gu, ' ').trim();
// DEPOIS (usar o mesmo helper em clampName, nomes de presença e grupos)
export const cleanText = (s: string) => s.replace(/[\p{Cc}\p{Cf}  ]+/gu, '').replace(/\s+/g, ' ').trim();
```
- **Muda comportamento?** Não visível para nomes normais. Protocolo: não (só saneamento na leitura/exibição; manter a assinatura sobre os bytes originais).

### Info
- **I-01 — Versão web guarda a frase em `localStorage`** (`apps/mobile/src/lib/vault.ts:18-27`). Documentado como demonstração; não publicar `expo export --platform web` com carteira real, ou bloquear criação/importação de frase com valor na web.
- **I-02 — `AppLock` abre sem autenticar quando o aparelho não tem bloqueio** (`apps/mobile/src/ui/AppLock.tsx:32`) e é só uma `View` por cima da navegação. Coerente com o texto da opção; considerar desabilitar a opção quando `deviceAuthAvailable()` é falso.
- **I-03 — Telas com a frase (backup) e o QR de resposta da migração ficam fora do bloqueio de captura** (decisão deliberada registrada). Se a decisão for revista, são as duas telas onde `FLAG_SECURE` mais vale.
- **I-04 — HSTS do site sem `preload`** (`apps/site/public/_headers:11`). Opcional, depois de fixar o domínio.

---

## `console.*` e logs em código de produção (lista completa)

| Arquivo:linha | Conteúdo | Sensível? |
|---|---|---|
| `apps/mobile/src/lib/piuSound.ts:23` | `console.warn('[piu-som] load falhou', String(e))` | Não |
| `apps/mobile/src/lib/piuSound.ts:36` | `console.warn('[piu-som]', String(e))` | Não |
| `apps/mobile/modules/piu-transport/.../BleEngine.kt:441` | `Log.w("PiuTransport", "Não foi possível abrir o servidor GATT.")` | Não |
| `apps/mobile/modules/piu-transport/.../BleEngine.kt:475` | `Log.w(..., "Anúncio BLE falhou: $errorCode")` | Não |
| `apps/mobile/modules/piu-transport/.../PiuRelayService.kt:52` | `Log.w(..., "Serviço do Modo nó não iniciou: ${e.message}")` | Não |

Nenhum log de frase, chave, endereço, conteúdo de mensagem ou token. Site: nenhum `console.*`.

## Segredos no bundle
Nenhum segredo encontrado em `src/`, `modules/`, `app.json`, `eas.json` ou no site. Endpoints embutidos são todos públicos e TLS (`wss://ws*.lunes.io`, `https://lunes-squid.lunes.io`, `https://blockexplorer.lunes.io`, `https://piu-node.local:8420` com pino). `.gitignore` exclui `*.jks/*.p12/*.key`. A senha do `debug.keystore` no gradle é a padrão pública (ver M-03).

## Manifesto Android / deep links / componentes
- `allowBackup=false` (app.json e APK conferido). Sem `usesCleartextTraffic` no release (só em `src/debug` e `src/debugOptimized`, ok).
- Único componente exportado: `MainActivity` (LAUNCHER + `piu://` BROWSABLE). Providers (`PiuShareFileProvider`, FileSystem, Sharing, Clipboard, ImagePicker) e `PiuRelayService` com `exported=false`; `PiuShareFileProvider` só expõe `cache/piu-share/`.
- Deep links: além de A-01, nenhuma rota executa ação sensível sozinha (`wallet?send=` só abre a folha; `scan?verify=` exige ler o QR do contato; `invite/accept` mostra o cartão e pede toque; `devices?add=` só abre o leitor).
- Sem WebView no app (não há `react-native-webview`).

## O que está bem feito
- **Armazenamento:** frase e chave de dados só no Keystore (`SecureStore`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); todo o resto do AsyncStorage cifrado com AES-256-GCM, nonce aleatório de 96 bits e o nome do campo como AAD (impede trocar valores entre campos); migração do formato antigo regrava cifrado; "Apagar dados" faz crypto-shredding. `persistNow` para estado que não pode voltar atrás (catraca, transferência assinada).
- **Criptografia:** só @noble/@scure; RNG do sistema (`expo-crypto`) via polyfill; nenhum `Math.random` em material criptográfico; HKDF com rótulo de domínio por uso; X25519/Ed25519 com vínculo assinado entre as chaves; XChaCha20-Poly1305 com nonce aleatório de 24 bytes; Double Ratchet com chave de mensagem única (nonce zero seguro), limites de chaves puladas e estado só muda com mensagem autêntica; remetente selado; cabeçalho como AAD e na assinatura (anti-reembrulho); anti-downgrade por suíte; LNNP com handshake assinado sobre as duas transcrições, anti-replay de desafio, chaves por sentido e contador estritamente crescente; código de segurança estilo Signal. Backup com scrypt N=2^16 e cabeçalho inteiro como AAD (impede rebaixar o custo).
- **Carteira (Mainnet):** SS58 com checksum blake2b e prefixos 57/42; valores em `bigint` sem ponto flutuante; specVersion/transactionVersion/gênese fixados e conferidos ao vivo (recusa assinar se o runtime mudar); segunda cotação logo antes de assinar ("review_required" se nonce/taxa/saldo mudarem); `checkedSigned` decodifica o extrinsic assinado e confere assinante, destino, valor, era, nonce, assinatura e hash; validação da transação no nó (`validateTransaction`) e conferência da taxa com os bytes assinados antes do envio; registro persistido cifrado **antes** do `author_submitExtrinsic`; retry reenvia os mesmos bytes, nunca reassina; era mortal de 64 blocos; segredo sr25519 zerado após uso; assinatura recusada sem bloqueio do aparelho; prompt biométrico mostra valor e destino.
- **Pagamento pedido pelo desktop:** só após confirmação das palavras, `expectedFrom` precisa ser a conta própria, ids únicos por sessão, expira em 120 s, revisão completa na tela do celular e biometria.
- **Vínculo com desktop:** chave pública e pino do certificado chegam pela câmera; WebSocket nativo só `wss://` com pino SHA-256 do certificado; nada sai antes de conferir as palavras; quadro adulterado/repetido/fora de ordem mata a sessão; comandos do desktop validados (`parseCommand`, limites de tamanho).
- **Entrada não confiável:** limites explícitos em toda parte (envelope 32 KiB, fragmentos com teto de bytes/pendências e conferência por id, BLE com teto por remetente, cartão ≤1 KiB, payloads de pagamento com regex e teto, nomes de arquivo saneados, arquivos com SHA-256 conferido, limites contra enxurrada de estranhos/convites).
- **Site:** CSP estrita gerada pelo Astro com hashes (sem `unsafe-inline` em script), `frame-ancestors 'none'`, `X-Content-Type-Options`, HSTS, COOP/CORP, Permissions-Policy; nenhum `set:html`/`innerHTML`; nenhum script externo; links externos com `rel="noopener"`; servidor do APK com CSP `default-src 'none'` e só no IP da rede Wi-Fi Direct.
- **Notificações:** canais com `lockscreenVisibility: PRIVATE`; opção de ocultar prévia.

## Top 5 (ordem de prioridade)
1. A-01 — `apps/mobile/src/app/_layout.tsx:77` + `apps/mobile/src/state/keys.tsx:63-66`
2. M-01 — `apps/mobile/src/app/backup.tsx:61-63`, `apps/mobile/src/app/devices.tsx:70`
3. M-03 — `apps/mobile/android/app/build.gradle:124`
4. M-02 — `apps/mobile/src/protocol/sessions.ts:40-44`
5. B-02 — `apps/mobile/android/app/src/main/AndroidManifest.xml:6-7`

---

## Correções aplicadas (06/11/2026)

Método: TDD (teste falhando primeiro, depois a correção). Nada no fio mudou (payloads do mensageiro, LNNP, `piu-link`, vínculo com desktop, QRs `piup:`/`piut:`/`piu-mig2:`); celulares e desktops já instalados continuam compatíveis. Testes do mobile: **386 → 417** (todos passando), `tsc --noEmit` sem erros; `apps/desktop` (importa arquivos do mobile): **127/127**; `apps/site`: `npm run build` (com `astro check`) sem erros.

| Achado | Status |
|---|---|
| A-01 | Corrigido |
| M-01 | Corrigido |
| M-02 | Corrigido (sem mudar o fio) |
| M-03 | Corrigido |
| B-01 | Corrigido depois (ver "Correções aplicadas — B-01 e B-03") |
| B-02 | Corrigido |
| B-03 | Corrigido depois (ver "Correções aplicadas — B-01 e B-03") |
| B-04 | Corrigido (hash completo de uma fonte só; GPG segue pendente) |
| B-05 | Corrigido |
| B-06 | Corrigido (teto de bytes; blocos seguem na RAM) |
| B-07 | Corrigido |

### A-01 — restaurar/migrar por deep link com identidade existente
- **Arquivos:** `apps/mobile/src/lib/identityGuard.ts` (novo), `src/app/_layout.tsx`, `src/state/keys.tsx`, `src/app/restore.tsx`, `src/app/migrate.tsx`, `src/app/welcome.tsx`, i18n (11 idiomas: `restore.replace.*`).
- **ANTES:** `OnboardingGuard` só agia antes do onboarding; `piu://restore` e `piu://migrate` abriam com identidade criada e `KeysProvider.restore()` gravava a frase nova por cima da atual.
- **DEPOIS:** `onboardingRedirect(onboarded, first)` manda `restore`/`migrate` para `/(tabs)` quando já há identidade (`welcome`, `identity` e `keys` seguem abertas para "Ver boas-vindas"; `keys` nunca troca chaves). `restore(words, { replace })` chama `checkRestore`: frase diferente da que está no cofre lança `PhraseExistsError`, a não ser com `replace: true`, que só é posto pelo diálogo "Trocar a identidade deste aparelho?" (segurar o botão) em Restaurar/Migrar — caso de quem gerou uma frase no onboarding, não entrou e decidiu restaurar. Em "Ver boas-vindas" com identidade, o botão "Restaurar" não aparece.
- **Testes:** `src/lib/__tests__/identityGuard.test.ts` (guarda com e sem identidade; nunca troca frase sem `replace`; mesma frase passa).

### M-01 — revelar/transferir a frase sem bloqueio do aparelho
- **Arquivos:** `src/lib/identityGuard.ts` (`lockGate`), `src/app/backup.tsx`, `src/app/devices.tsx`, i18n (`backup.needLock`, `devices.needLock`).
- **ANTES:** `confirmDevice()` = `'unavailable'` mostrava a frase (com aviso) e enviava a frase cifrada ao aparelho novo.
- **DEPOIS:** `lockGate(r, web)`: só `'ok'` libera; `'unavailable'` vira `'needLock'` e a tela pede para ativar um bloqueio de tela (PIN, padrão, senha ou biometria) nos ajustes; na web (demonstração, sem bloqueio possível) segue como antes, com o aviso.
- **Testes:** `identityGuard.test.ts` (`lockGate`).

### M-02 — replay da primeira mensagem reiniciando a sessão Double Ratchet
- **Arquivos:** `src/protocol/sessions.ts`; ajuste de relógio em `src/messaging/__tests__/identidade.test.ts` (o teste 1.4 restaurava o aparelho novo no mesmo segundo da última mensagem do antigo; agora passa 60 s, como na vida real).
- **ANTES:** com sessão estabelecida, qualquer mensagem que abrisse como "primeira" (`Session.respond`) substituía a sessão.
- **DEPOIS:** o gerenciador guarda, por contato, o **início** da sessão atual (menor `sentAt` autêntico visto nela; `sentAt` é assinado pelo remetente). Sessão nova por cima de uma estabelecida só se `sentAt` > início; igual ou menor = replay → recusado. Comparar com o início (não com a última mensagem, como sugerido no achado) tolera relógio atrasado no aparelho novo: só recusa se o relógio dele estiver antes do começo da conversa atual. A sessão trocada fica em `previous` e ainda abre mensagens dela que cheguem atrasadas. Estado salvo: continua uma lista de sessões; as anteriores vão antes com `piuPrev: 1` e as atuais levam `piuSince` — a versão antiga do app, que fica com o último item de cada contato, continua lendo a sessão atual; estado antigo (sem `piuSince`) abre igual e passa a registrar o início na próxima mensagem autêntica.
- **Testes:** `src/protocol/__tests__/sessionReset.test.ts` (10): replay recusado com conversa ativa e parada; reinstalação legítima aceita; relógio atrasado depois do início aceito; mensagem atrasada da sessão antiga abre; início simultâneo intacto; persistência do início e da sessão anterior; compatibilidade nos dois sentidos com o formato antigo.
- **Limite:** um contato cujo aparelho novo esteja com o relógio **antes** do início da sessão atual não consegue reiniciar até o relógio passar desse ponto (as mensagens seguintes da sessão nova abrem sozinhas quando isso acontecer).

### M-03 — release assinado com a chave de debug
- **Arquivos:** `apps/mobile/plugins/releaseSigningGradle.js`, `apps/mobile/android/app/build.gradle`.
- **ANTES:** sem `PIU_RELEASE_STORE_FILE`, `assembleRelease` assinava com `debug.keystore`.
- **DEPOIS:** dentro de `signingConfigs.release`, se faltar `PIU_RELEASE_STORE_FILE` **ou** `PIU_RELEASE_STORE_PASSWORD` e não houver `-PallowDebugSignedRelease`, `gradle.taskGraph.whenReady` lança `GradleException` quando o grafo tem tarefa do módulo `:app` com "release" no nome. Debug não muda. O plugin também atualiza um `build.gradle` gerado pela versão anterior (prebuild sem `--clean`).
- **Conferido no Gradle (dry-run, `--offline`):** `:app:assembleRelease` sem as variáveis → falha com a mensagem; `:app:assembleDebug` → passa; `:app:assembleRelease -PallowDebugSignedRelease` → passa.
- **Testes:** `src/lib/__tests__/releaseSigning.test.ts` (+3: guarda presente e no lugar certo; upgrade do formato antigo; `build.gradle` do repositório já igual à saída do plugin).

### B-02 — permissões não usadas no release
- **Verificação antes de remover:** nenhuma gravação de áudio (`Recorder`, `RecordingPresets`, `requestRecordingPermissions*`), sobreposição (`SYSTEM_ALERT_WINDOW`, `canDrawOverlays`) ou push remoto (`*PushToken*`, `enableRemoteNotifications: false`) em `src/`, `modules/` e `plugins/`. O som do piu usa `expo-audio` só para tocar (mantém `MODIFY_AUDIO_SETTINGS`); notificações são locais (`POST_NOTIFICATIONS`, `VIBRATE` mantidas).
- **Arquivos:** `apps/mobile/app.json` (`android.blockedPermissions`), `android/app/src/main/AndroidManifest.xml` (`tools:node="remove"`).
- **ANTES:** release com `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` e `com.google.android.c2dm.permission.RECEIVE`.
- **DEPOIS:** as três removidas no manifesto final de release (conferido em `processReleaseManifest`: nenhuma das três; `POST_NOTIFICATIONS`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS` presentes). `src/debug` mantém `SYSTEM_ALERT_WINDOW` (menu de desenvolvimento). `usesCleartextTraffic` não foi tocado. `READ_MEDIA_IMAGES` não foi removida (fora do pedido).
- **Testes:** `src/lib/__tests__/androidPermissions.test.ts` (2).

### B-04 — site: hash do APK escrito à mão e truncado
- **Arquivos:** `apps/site/src/lib/androidRelease.ts` (novo), `src/lib/desktopRelease.ts` (exporta `REPO`), `src/i18n/pt.ts`, `src/i18n/en.ts`, `src/components/SitePage.astro`.
- **ANTES:** `signature: ['… 595B DC6A … 78B7 FF31', 'Piu-0.1.0.apk · SHA-256 6e21 b8e9 … 0234 0c25']` repetido em cada idioma; URL do APK também repetida.
- **DEPOIS:** uma fonte só (`ANDROID_SHA256`, `ANDROID_CERT_SHA256`, `ANDROID_FILE`, `ANDROID_URL`); o site mostra os dois hashes **completos** em grupos de 4 (selecionáveis). Valores conferidos, não inventados: APK = `digest` do asset `Piu-0.1.0.apk` no release `android-v0.1.0` do GitHub (`6e21b8e9…02340c25`, bate com o texto antigo); certificado = `apksigner verify --print-certs` (`595bdc6a…78b7ff31`). Valor fora do formato (64 hexa) quebra o build.
- **Pendente:** chave GPG e `SHA256SUMS.txt.asc` (decisão/cerimônia da Lunes); hashes do desktop continuam vazios até o release.

### B-05 — re-pareamento `piup:` sem confirmação; destino `piut:` sem checksum
- **Arquivos:** `apps/mobile/src/lib/approvals.ts`, `src/app/scan.tsx`, i18n (`scan.panel.repair.*`).
- **ANTES:** QR com o mesmo `phoneId` trocava o segredo na hora; destino aceito só por regex base58.
- **DEPOIS:** `pairingConflict(list, node)` detecta pareamento salvo com o mesmo `phoneId` e outro segredo → diálogo "Parear de novo com outro segredo?" antes de salvar (mesmo segredo atualiza direto). Destino `lunes:` só com `isLunesAddress` (checksum SS58, prefixos 57/42), como o piu-node já faz.
- **Testes:** `src/lib/__tests__/approvals.test.ts` (+2).

### B-06 — recebimentos de arquivo ocupando RAM
- **Arquivo:** `apps/mobile/src/messaging/messenger.ts` (`MAX_RX_BYTES = 64 MB`).
- **ANTES:** até 8 recebimentos automáticos de 50 MB montados em memória ao mesmo tempo.
- **DEPOIS:** a oferta só baixa sozinha se a soma dos recebimentos automáticos em andamento + o tamanho dela couber em 64 MB; senão fica como "Baixar" (tocar continua funcionando). Blocos seguem em RAM (escrever em arquivo temporário fica para depois).
- **Testes:** `src/messaging/__tests__/midia.test.ts` (+1 do teto; +1 do nome do arquivo, ver B-07).

### B-07 — controles bidi em nomes e descrições
- **Arquivos:** `apps/mobile/src/messaging/bidi.ts` (novo, `stripBidi`), `messaging/card.ts`, `messaging/nearby.ts`, `messaging/groups.ts`, `messaging/messenger.ts`, `lib/paymentRequest.ts`.
- **ANTES:** U+202A–U+202E e U+2066–U+2069 passavam em nomes de cartão, presença, grupo (nome, descrição, membros, subgrupos), pedidos de "por perto", entrada em grupo, convites, nome de arquivo e descrição de pedido de pagamento.
- **DEPOIS:** removidos na leitura/exibição (e no nome do próprio cartão). Assinaturas continuam sobre os bytes originais (o corpo da presença repassada não é mexido). Só esses controles saem: ZWJ/ZWNJ (emoji compostos, escritas indianas e árabes) ficam. Texto das mensagens não é alterado.
- **Testes:** `src/messaging/__tests__/bidi.test.ts` (5) e `midia.test.ts` (nome de arquivo).

### Não aplicados
- **B-01** (`requireAuthentication` no SecureStore): risco para instalações existentes — item novo exige migrar a frase, troca de biometria invalida o item e obriga restaurar pela frase/backup. Fica para uma mudança planejada com migração e teste em aparelho.
- **B-03** (SHA-256 do APK/certificado na página do "Enviar o Piu"): exige mudar o módulo nativo `piu-app-share` (Kotlin) e a página do fluxo de envio do APK por Wi-Fi Direct/Bluetooth/Quick Share, que ficou fora de escopo de propósito. O site agora mostra o certificado completo (B-04), que serve de referência para conferir.

### Mudanças visíveis para a pessoa
- Com identidade criada, links `piu://restore` e `piu://migrate` levam para as abas; em "Ver boas-vindas" não aparece "Restaurar". Trocar de identidade = "Apagar dados locais" e restaurar.
- Se houver outra frase no aparelho antes de entrar (gerada e não usada), Restaurar/Migrar pedem confirmação segurando o botão.
- Sem bloqueio de tela, "Mostrar a frase" (backup) e "Adicionar aparelho" (enviar as chaves) recusam e pedem para ativar um bloqueio.
- Re-parear o celular com o painel do provider usando outro segredo pede confirmação; pedido `piut:` com endereço de checksum errado é recusado.
- Vários arquivos grandes ao mesmo tempo: os que passam de 64 MB somados ficam como "Baixar".
- Nomes/descrições com caracteres de inversão de texto aparecem sem eles.
- Quem compila: `assembleRelease` sem a chave de release falha (teste local: `-PallowDebugSignedRelease`).

**Novo APK:** necessário (mudanças de JS e de manifesto). Assinar com a chave de release (certificado `595bdc6a…78b7ff31`) para instalar por cima das versões atuais; atualizar `ANDROID_SHA256` em `apps/site/src/lib/androidRelease.ts` com o arquivo publicado.

## Correções aplicadas — B-01 e B-03

### B-01 — frase atrás da biometria do sistema
- **Desenho e tradeoffs:** `docs/seguranca/biometria-cofre.md`.
- **Arquivos:** `apps/mobile/src/lib/phraseVault.ts` (novo, regras puras), `src/lib/vault.ts` (ligação com `expo-secure-store` 58.0.2: `requireAuthentication`, `authenticationPrompt`, `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`), `src/state/keys.tsx`, `src/state/wallet.tsx`, `src/app/backup.tsx`, `src/app/devices.tsx`, `src/app/restore.tsx`, `src/app/vault-recover.tsx` (novo), i18n (11 idiomas: `vault.*`, `vaultRecover.*`).
- **ANTES:** a frase ficava num item sem autenticação, era lida na abertura e ficava na memória do JS; assinar, revelar e transferir dependiam só do `confirmDevice` (interface).
- **DEPOIS:**
  - Abertura: só as **chaves do dia** (`piu.keys.v2`, sem autenticação): semente do Piu (identidades e nó, HKDF de mão única) + endereço da carteira. Mensagens, recibos e o serviço em segundo plano nunca pedem biometria. A chave de dados do AsyncStorage continua sem autenticação.
  - A frase sai do estado do app (`useKeys().phrase` não existe mais): `unlockPhrase(prompt)` lê do cofre só para revelar o backup, assinar (inclusive pedidos de pagamento do computador ligado) e transferir para outro aparelho, e o resultado é descartado depois (a carteira confere que a frase lida gera o mesmo endereço antes de assinar).
  - Com biometria forte **e** cópia da frase fora do aparelho (backup concluído, ou restaurado pela frase/arquivo), a frase vai para `piu.phrase.bio.v1` (`requireAuthentication: true`): a leitura é o pedido de biometria do sistema, ligado à chave do Keystore (substitui o `confirmDevice` nesses três lugares).
  - Migração no próximo uso sensível: grava o item novo, lê de volta e confere, marca, e só então apaga o antigo. Cancelar = operação cancelada, tudo intacto; outra falha = segue pelo caminho antigo e tenta de novo em 24 h. A frase nunca é apagada sem uma cópia verificada.
  - Biometria trocada/removida ou bloqueio de tela desligado (chave invalidada pelo sistema): tela "Confirme a sua frase de novo" (`/vault-recover`), por frase ou arquivo de backup; só aceita a frase desta identidade (mesma semente); conversas não são tocadas e não há aviso de troca de aparelho.
  - Sem biometria forte (só PIN, ou sem bloqueio): armazenamento e `confirmDevice` como antes; as recusas "ative um bloqueio de tela" (M-01) continuam.
- **Testes:** `src/lib/__tests__/phraseVault.test.ts` (19): abertura sem pedido; sem backup não migra; migração com ordem grava → confere → marca → apaga; `known` migra; só PIN/sem bloqueio/web; cancelar na gravação ou na leitura; falha com espera de 24 h; leitura diferente; marca que falha; travamento no meio; chave invalidada → recuperar (frase errada recusada); biometria removida, cancelar e bloqueio por tentativas não apagam nada; item com biometria sumido com o antigo presente; criar/restaurar; apagar dados; frase que não bate com a semente nunca é entregue; classificação dos erros nativos.
- **Precisa de aparelho real:** migração (2 pedidos no Android, 1 no iPhone, só uma vez), cancelamento, cadastrar digital nova → tela de recuperação, assinatura pelo computador ligado.

### B-03 — SHA-256 no "Enviar o Piu"
- **Arquivos:** `modules/piu-app-share/android/.../ApkIntegrity.kt` (novo: SHA-256 em blocos de 256 KiB, cache por caminho + data + tamanho), `PiuAppShareModule.kt` (`AsyncFunction("integrity")`, fora da thread principal; certificados por `GET_SIGNING_CERTIFICATES`/`apkContentsSigners`, `GET_SIGNATURES` antes do Android 9), `modules/piu-app-share/index.ts`, `src/lib/apkIntegrity.ts` (novo), `src/lib/wifiShare.ts`, `src/lib/sendApp.ts` (`loadApkIntegrity`, nunca lança), `src/ui/ApkIntegrityCard.tsx` (novo), `src/ui/WifiSharePanel.tsx`, `src/app/invite/share.tsx`, i18n (`wifiPage.check.*`, `apkCheck.*`).
- **ANTES:** página local e tela de envio sem nenhum valor para conferir.
- **DEPOIS:** a tela "Enviar o Piu" mostra "Conferir o instalador": certificado e SHA-256 do arquivo (curtos, `595B DC6A … 78B7 FF31`; toque mostra inteiro, segurar copia) e se o certificado é o oficial (comparado com `OFFICIAL_CERT_SHA256`, que um teste mantém igual a `ANDROID_CERT_SHA256` do site). A página do Wi-Fi Direct ganha o bloco "Confira antes de instalar" com os dois valores inteiros e a instrução de comparar com o site oficial (não instalar se o certificado for diferente). Transportes, permissões e o fluxo da página não mudaram; sem os valores (build antigo, falha), a página é byte a byte a de antes.
- **Ajuste junto:** a cópia em `cache/piu-share` também é refeita quando o app foi atualizado depois dela (antes só comparava o tamanho: uma atualização do mesmo tamanho mandaria o APK velho — e o hash exibido não seria o do arquivo enviado).
- **Testes:** `src/lib/__tests__/apkIntegrity.test.ts` (5): certificado igual ao do site; formato curto/inteiro; validação dos valores nativos; página com os valores (pt-BR e en) sem script; página sem valores idêntica à de antes. O módulo não tem configuração de teste Kotlin: `ApkIntegrity.kt` é Kotlin puro (sem Android), pronto para JUnit; conferido por compilação (`:piu-app-share:compileReleaseKotlin --offline`). Raciocínio: `MessageDigest` em blocos produz o mesmo resultado que `sha256sum`; o cache só reaproveita se caminho, data e tamanho forem os mesmos (atualização muda o `sourceDir` e a data); `apkContentsSigners` são os certificados atuais (o que `apksigner --print-certs` mostra), sem os de rotação.

### Mudanças visíveis — B-01 e B-03
- Depois de fazer o backup (ou restaurar pela frase/arquivo), num aparelho com biometria forte: na próxima vez em que mostrar a frase, assinar ou adicionar aparelho, o sistema pede a biometria (no Android duas vezes, só nessa vez: "Proteger a frase com a sua biometria" e o pedido da operação). Daí em diante, o pedido é o do sistema (sem alternativa de PIN no Android).
- Se a biometria mudar, mostrar a frase/assinar/adicionar aparelho leva a "Confirme a sua frase de novo"; conversas seguem normais.
- Voltar para uma versão anterior do app depois da migração abre como aparelho novo (restaurar pela frase/arquivo).
- "Enviar o Piu" mostra os SHA-256 e se o certificado é o oficial; a página do Wi-Fi Direct mostra os dois valores e manda comparar com o site.

**Novo APK:** necessário (código nativo do `piu-app-share` e JS).

