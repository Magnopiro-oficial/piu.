# Assinatura de código do Piu Desktop e do Piu Provider (macOS e Windows)

Estado em 06/11/2026: **não há certificado nenhum.** O macOS sai com assinatura **ad-hoc** (o pacote fica íntegro e roda nos Macs com chip M, mas o Gatekeeper avisa "desenvolvedor não identificado") e o Windows sai **sem assinatura** (o SmartScreen avisa). Enquanto for assim, o site (`apps/site`, textos `openTitle`/`open` em `src/i18n/*.ts`) e as notas do release continuam com as instruções de "abrir mesmo assim".

A configuração já está pronta para o dia em que houver certificado: **basta criar os secrets** (ou exportar as variáveis num build local). Nenhum arquivo precisa mudar.

## Como funciona

- `apps/desktop/electron-builder.yml` e `apps/provider-desktop/electron-builder.yml` começam com `extends: ./electron-builder.signing.cjs`. YAML não tem condição; o `.cjs` decide pelo ambiente e devolve só os blocos `mac`/`win` de assinatura. Todo o resto (nome dos arquivos, fusíveis, alvos, ícones) continua no yml, que tem prioridade.
- A lógica é uma só para os dois apps: `scripts/electron-signing/index.cjs`. Os entitlements ficam ao lado, em `scripts/electron-signing/entitlements.mac.plist`.
- Vale para qualquer forma de chamar o electron-builder (`npm run dist:*`, `npx electron-builder ...`, o workflow), porque o yml é sempre o arquivo carregado.
- Cada build imprime uma linha com o estado, por exemplo:
  `• assinatura  macOS=adhoc  notarização=não  Windows=unsigned`
- Credencial pela metade (ex.: `APPLE_API_KEY_ID` sem `APPLE_API_ISSUER`) **para o build com erro**, para não sair um instalador sem notarizar sem ninguém perceber.

| Ambiente | macOS | Windows |
|---|---|---|
| Nada definido (hoje) | ad-hoc (`identity: "-"`), sem hardened runtime, `notarize: false` | sem assinatura (`win.cscLink: ""`, para não usar o `.p12` da Apple por engano) |
| `CSC_LINK` + `CSC_KEY_PASSWORD`, ou `CSC_NAME` | Developer ID, hardened runtime, entitlements mínimos | (não muda) |
| + `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` (ou `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) | + notarização (notarytool) e grampo (*staple*) no `.app` | (não muda) |
| `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` | (não muda) | Authenticode com o `.pfx` |
| `AZURE_TRUSTED_SIGNING_*` + `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | (não muda) | Azure Trusted Signing, **só com o build rodando no Windows** |

Para conferir sem certificado nenhum o que o electron-builder vai receber (as variáveis podem ser falsas, só o `.p8` precisa existir):

```bash
cd apps/desktop
CSC_LINK=/caminho/devid.p12 CSC_KEY_PASSWORD=x \
APPLE_API_KEY=/caminho/AuthKey_ABC123.p8 APPLE_API_KEY_ID=ABC123 APPLE_API_ISSUER=<uuid> \
node -e "console.log(require('../../scripts/electron-signing/index.cjs').signingConfig())"
```

## Entitlements do macOS (hardened runtime)

Só valem com Developer ID (o build ad-hoc não usa hardened runtime). O mesmo arquivo serve para o app e para os helpers do Electron.

| Entitlement | Usa? | Por quê |
|---|---|---|
| `com.apple.security.cs.allow-jit` | **sim** | O V8 compila JavaScript em tempo de execução. Sem ele o hardened runtime derruba o app. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | não | Só era preciso no Electron antigo. O Electron 45 usa `MAP_JIT`; `allow-jit` basta. |
| `com.apple.security.cs.disable-library-validation` | não | Só serve para carregar `.dylib`/`.node` de outro time. Os dois apps não têm módulo nativo (bundle esbuild) e o Electron Framework é reassinado com o nosso Developer ID. |
| Câmera, microfone, localização, Bluetooth, USB | não | O Piu Desktop só **mostra** QR; quem escaneia é o celular. |
| Rede | não | App fora do App Sandbox não precisa de entitlement para TCP/UDP na rede local nem para o servidor HTTPS do vínculo. |

Notificações, Touch ID (`systemPreferences.promptTouchID`) e keychain (`safeStorage`) também não pedem entitlement fora do sandbox.

Sugestão à parte (vale também para o ad-hoc): incluir `NSLocalNetworkUsageDescription` no `mac.extendInfo` dos dois yml. No macOS 15 o sistema pede permissão de "rede local" ao app que faz broadcast/multicast na LAN (o transporte LNNP faz), e o texto desse pedido vem do Info.plist, não dos entitlements.

## macOS: o que comprar e como criar

1. **Apple Developer Program**: US$ 99 por ano. Inscreva como **organização** (Lunes) para o nome da empresa aparecer no aviso do macOS; a Apple pede o número **D-U-N-S** (gratuito, sai em alguns dias). Como pessoa física o certificado mostra o nome da pessoa.
2. **Certificado "Developer ID Application"** (só o *Account Holder* da conta cria):
   1. No Mac: Acesso às Chaves → Assistente de Certificado → *Solicitar um Certificado de uma Autoridade de Certificação* → "Salvo no disco". Gera um `.certSigningRequest`.
   2. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+** → *Developer ID Application* (sub-CA G2) → envie o `.certSigningRequest` → baixe o `.cer` e dê dois cliques (vai para o keychain "início de sessão").
   3. Acesso às Chaves → Meus Certificados → botão direito em *Developer ID Application: Lunes … (TEAMID)* → Exportar → `.p12` com senha forte.
   4. Guarde o `.p12` e a senha como as outras chaves da Lunes (cópias cifradas, nunca no repositório nem com agentes). Perder o `.p12` não é grave (dá para emitir outro); vazar é: revogue no portal.
3. **Chave da API para a notarização** (preferida ao Apple ID: não depende de senha de pessoa nem de 2FA):
   App Store Connect → Usuários e Acesso → Integrações → *Chaves da API da App Store Connect* → **Team Key** com papel **Developer** → baixe o `AuthKey_<KEYID>.p8` (só dá para baixar **uma vez**). Anote o **Key ID** e o **Issuer ID** (UUID no topo da página).
   Alternativa: Apple ID + senha de app (appleid.apple.com → Senhas de app) + Team ID.

### Build local assinado

```bash
cd apps/desktop   # ou apps/provider-desktop
export CSC_LINK=~/chaves/developer-id.p12 CSC_KEY_PASSWORD='…'
# ou, com o certificado já no keychain: export CSC_NAME="Developer ID Application: Lunes … (TEAMID)"
export APPLE_API_KEY=~/chaves/AuthKey_ABC123.p8 APPLE_API_KEY_ID=ABC123 APPLE_API_ISSUER=<uuid>
npm run dist:mac -- --x64 --arm64
```

A notarização leva de 1 a 15 minutos por arquitetura; o electron-builder espera e grampeia o ticket no `.app` antes de montar o `.dmg`/`.zip`.

## Windows: o que comprar

Desde junho de 2023 os certificados OV/EV de assinatura de código só são emitidos com a chave privada em hardware (token ou HSM na nuvem); não existe mais `.pfx` exportável novo. Por isso:

1. **Azure Trusted Signing** (recomendado se a Lunes for elegível): cerca de US$ 10 por mês (plano Basic). A Microsoft guarda a chave e faz a validação de identidade. **Confira a elegibilidade antes de contratar**: até a última verificação, a validação pública só atendia organizações dos EUA, Canadá, União Europeia e Reino Unido (e pessoas físicas dos EUA e Canadá). Se a Lunes for só brasileira, pode não servir.
   1. Assinatura do Azure → registrar o provedor `Microsoft.CodeSigning`.
   2. Criar uma conta **Trusted Signing** (a região define o endpoint, ex.: `https://eus.codesigning.azure.net`).
   3. *Identity validation* → **Public** → enviar os documentos da empresa e esperar a aprovação.
   4. *Certificate profile* → **Public Trust**, ligado à identidade validada.
   5. Entra ID → *App registrations* → novo app (é o "usuário" do CI) → criar um *client secret*.
   6. Na conta Trusted Signing → Controle de acesso (IAM) → papel **Trusted Signing Certificate Profile Signer** para esse app.
   7. `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` = o CN do certificado (o nome da empresa exatamente como validado).
2. **Certificado OV de uma CA** (Sectigo, DigiCert, SSL.com, Certum…): de US$ 200 a 500 por ano, entregue em token USB ou HSM na nuvem. O token USB não serve para o CI; o HSM na nuvem (ex.: SSL.com eSigner, DigiCert KeyLocker) precisa de um gancho próprio (`win.signtoolOptions.sign`) que **ainda não existe** aqui. O caminho `WIN_CSC_LINK` (`.pfx`) fica para um `.pfx` antigo exportável ou para testes com certificado próprio.

Mesmo assinado, o SmartScreen pode avisar nas primeiras semanas: a reputação vem do número de downloads limpos, também com certificado EV.

**Limite do CI hoje:** o job do Windows roda no Linux com Wine (o nome do repositório termina em ponto, `piu.`, e o runner `windows-latest` não monta essa pasta). Lá funciona o `.pfx` (o electron-builder assina com `osslsigncode`), mas **não** o Azure Trusted Signing, que exige PowerShell + `signtool` no Windows: com os secrets do Azure o job avisa e gera o instalador sem assinatura. Para usar o Azure no CI, uma das duas: renomear o repositório (sem ponto no fim) e mover o job para `windows-latest`, ou criar um job Windows depois do build que baixa o `.exe` e assina só o instalador (ex.: `azure/trusted-signing-action`).

## Secrets no GitHub

Settings → Secrets and variables → Actions → *New repository secret*. Todos são opcionais; o `release-electron.yml` entrega cada um só ao job da sua plataforma.

| Secret | Conteúdo |
|---|---|
| `CSC_LINK` | o `.p12` do Developer ID em base64: `base64 -i developer-id.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | a senha do `.p12` |
| `APPLE_API_KEY_P8` | o **conteúdo** do `AuthKey_<KEYID>.p8` (o workflow grava num arquivo temporário e passa o caminho em `APPLE_API_KEY`) |
| `APPLE_API_KEY_ID` | Key ID da chave da API |
| `APPLE_API_ISSUER` | Issuer ID (UUID) |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | alternativa à chave da API (não use as duas) |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | `.pfx` Authenticode em base64 e a senha |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | o app do Entra ID (passo 5 acima) |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` / `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` / `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE` / `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` | a conta Trusted Signing (não use junto com `WIN_CSC_LINK`) |

O passo "Assinatura / notarização (estado)" do workflow mostra no resumo do run o que foi ligado, e as notas do release em rascunho trocam o texto de "abrir mesmo assim" pelo de "assinado" quando os secrets existem.

## Como conferir

macOS (em cada `.app`, de preferência o que sai de dentro do `.dmg` baixado do release):

```bash
APP="/Volumes/Piu/Piu.app"
codesign -dv --verbose=4 "$APP"          # Authority=Developer ID Application: …, TeamIdentifier=…, flags=0x10000(runtime)
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - "$APP"      # só com.apple.security.cs.allow-jit
spctl -a -vv -t exec "$APP"              # accepted · source=Notarized Developer ID
xcrun stapler validate "$APP"            # The validate action worked!
```

Hoje (ad-hoc) o esperado é `flags=0x2(adhoc)`, `Signature=adhoc`, `TeamIdentifier=not set`, `codesign --verify --deep --strict` passando e o `spctl` **recusando** (`rejected`).

Windows (PowerShell com o Windows SDK):

```powershell
signtool verify /pa /v .\Piu-0.1.0-win-x64.exe
Get-AuthenticodeSignature .\Piu-0.1.0-win-x64.exe   # Status = Valid
```

No Linux/Mac: `osslsigncode verify Piu-0.1.0-win-x64.exe`.

## Quando ligar de verdade

- [ ] Secrets criados; um run manual do release (sem tag) mostra `macOS=developer-id … notarização=api-key` e `Windows=…` no log.
- [ ] Conferência acima nos instaladores baixados do run, em um Mac Intel e um com chip M e num Windows limpo.
- [ ] Atualizar por cima de uma versão ad-hoc: a assinatura muda, então o macOS pode pedir **uma vez** acesso ao item "Piu Safe Storage" do keychain (onde o `safeStorage` guarda a chave do cofre). A pessoa precisa clicar em **Permitir sempre**; negar deixa o cofre sem abrir. Testar isso antes e avisar nas notas da versão.
- [ ] Só então trocar os textos do site (`openTitle`/`open` em `apps/site/src/i18n/*.ts`) e tirar as instruções de "abrir mesmo assim". No macOS 15 o "botão direito → Abrir" não basta mais para apps sem notarização: vale o caminho Ajustes → Privacidade e Segurança → **Abrir mesmo assim**, que o site já explica.
