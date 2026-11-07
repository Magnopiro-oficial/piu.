# Piu Desktop

O mensageiro Piu para computador (macOS Intel e Apple Silicon, Linux, Windows). Electron 45 + React (Vite), com o
núcleo do app do celular (`apps/mobile/src/protocol`, `messaging`, `lib`) importado por caminho relativo e
empacotado pelo esbuild/Vite — nada é copiado nem editado lá.

## Como funciona

- **Processo principal** (`src/main`): identidade (frase de 12 palavras no cofre do sistema via `safeStorage`:
  Keychain no macOS, Secret Service no Linux, DPAPI no Windows), estado cifrado (AES-256-GCM, chave no cofre),
  o nó de pessoa (`MeshNode`: o `Messenger` do celular com Double Ratchet, envelopes selados e fila
  store-and-forward) e os transportes.
- **Transporte LAN** (`src/transport/lnnpLan.ts`): LNNP v1 pela rede local, o mesmo enlace do `piu-node`
  (anúncio UDP 8423, enlace TCP 8422, handshake HELLO/AUTH, registros cifrados, fragmentos). Se a porta 8422
  estiver ocupada (um piu-node no mesmo computador), usa uma porta livre e anuncia a porta real.
- **Bluetooth LE** (`src/transport/bleStub.ts`): interface pronta, implementação numa próxima versão.
- **Renderer** (`src/renderer`): React em sandbox, `contextIsolation`, sem `nodeIntegration`, CSP estrita
  (`connect-src 'none'`); fala com o app só pela ponte do preload (`window.piu`). Visual portado do protótipo
  `design_handoff_piu/design/Piu Desktop.dc.html` (tokens, keyframes, Geist / Geist Mono / Material Symbols
  autossuficientes).
- **Segurança da tela** (Ajustes → Privacidade, padrão ligado): `setContentProtection(true)` enquanto uma
  conversa estiver aberta (macOS e Windows); no Linux o sistema não permite.
- **Carteira**: só leitura — endereço Lunes informado, saldo da Mainnet pelo cliente leve do celular.

## Rodar

```bash
cd apps/desktop
npm run deps      # dependências dos núcleos compartilhados (mobile e piu-node)
npm ci
npm run dev        # compila main/preload (esbuild) + renderer (Vite) e abre o Electron
npm test           # node:test (lógica pura, transporte LAN, interop com piu-node real)
npm run build      # só compila
npm run dist:mac   # .dmg/.zip da arquitetura atual (ad-hoc; Developer ID se houver certificado)
npm run dist:mac -- --x64 --arm64 # ambas as arquiteturas do Mac
npm run dist:linux # AppImage e .deb
npm run dist:win   # instalador NSIS x64
```

Variáveis para testar duas instâncias na mesma máquina (mesmos nomes do piu-node): `PIU_LNNP_PORT`,
`PIU_LNNP_DISCOVERY_PORT`, `PIU_LNNP_BROADCAST` (lista `host:porta`), `PIU_LNNP_LISTEN`. Ex.:

```bash
PIU_LNNP_DISCOVERY_PORT=8443 PIU_LNNP_BROADCAST=127.0.0.1:8433 npx electron . --user-data-dir=/tmp/piu-a
PIU_LNNP_PORT=8432 PIU_LNNP_DISCOVERY_PORT=8433 PIU_LNNP_BROADCAST=127.0.0.1:8443 npx electron . --user-data-dir=/tmp/piu-b
```

## Conectar ao celular por QR (modelo WhatsApp Web) — lado do desktop

Protocolo da lib compartilhada `apps/mobile/src/lib/desktopLink.ts` (importada daqui; `src/shared/desktopLink.ts`
só tem a oferta renovável e a tradução do modelo do celular). `src/main/desktopLink.ts`: servidor **wss://**
(HTTPS com certificado autoassinado P-256 em `<userData>/link-tls`, fixado pelo QR: `c` = SHA-256 do DER) +
`ws`. QR `piu-link:1?h=…&k=…&s=…&c=…` renovado a cada 30 s; `hello` em claro; HKDF-SHA256 (salt = s, info
`piu/v1/desktop-link`) → uma chave por sentido; 3 palavras de `SHA-256(s ‖ pk_desktop ‖ pk_celular ‖ c)`;
quadros de TEXTO base64url `0x01 ‖ u64be(n) ‖ XChaCha20-Poly1305` (AD = header); fechamento 4001/4002;
`ready {name}` depois da confirmação; `pong` a cada `ping` e ping próprio a cada 25 s; `snapshot`/`event`/`ack`
do celular, `cmd` (`send` com `ref`, `read`) do desktop; tipos desconhecidos ignorados. Queda → volta ao QR.
Vetores de compatibilidade (`VECTORS` do celular) e cliente simulado em `test/desktopLink*.test.ts`.

## Celular pela rede local

Os celulares hoje falam **Nearby Connections / Bluetooth LE** (`apps/mobile/src/transport`: `nearby | ble | sim`);
não há transporte LNNP por Wi-Fi no app do celular. Por isso o desktop conversa com outros desktops e com
nós `piu-node` pela LAN; um celular alcança o desktop quando (a) o celular ganhar um transporte LNNP/TCP pela
Wi-Fi, ou (b) o desktop ganhar BLE. A camada de mensagens já é a mesma (`Messenger`), então nada muda nos
envelopes: só o enlace.

## Validação e instaladores no GitHub Actions

O workflow `desktop-ci.yml` instala também as dependências dos núcleos compartilhados, confere os tipos,
executa os testes (incluindo LAN e vínculo QR com TLS) e compila o app a cada alteração relevante.

O workflow existente `release-desktop.yml` gera macOS x64/arm64, Linux x64 e Windows x64 via
`release-electron.yml`. Pode ser executado manualmente com uma versão para guardar apenas os artefatos;
a tag `desktop-v<versão>` gera um release em rascunho. Os nomes incluem SO e arquitetura.
A arquitetura é escolhida pelo job, sem empacotar as duas versões do Mac em cada runner.

Assinatura de código: hoje ad-hoc no macOS e sem assinatura no Windows. Liga sozinha quando os
certificados estiverem no ambiente/secrets (`electron-builder.signing.cjs`); ver
[docs/distribuicao/assinatura.md](../../docs/distribuicao/assinatura.md).
