# Piu Provider para computador (Linux e macOS)

App desktop (Electron) que transforma este computador num nó do provider e mostra o painel. É o mesmo painel de `apps/provider-panel`, servido pelo `piu-node` (`apps/piu-node`), que roda **dentro do app**. Funciona sem internet.

```bash
npm run deps        # instala piu-node e painel (uma vez)
npm ci
npm run start       # empacota o processo principal e abre o app (precisa do painel: npm run build:panel)
npm run typecheck
npm run dist:linux  # release/: AppImage e .deb (x64)
npm run dist:mac    # release/: .dmg e .zip — rodar num Mac
```

## Como funciona
- **Retransmissão:** o `piu-node` embutido sobe o motor LNNP (enlace TCP 8422 e descoberta UDP 8423 na rede local, handshake autenticado, só envelopes cifrados). Este computador guarda e repassa mensagens de terceiros conforme os limites de Configurações. O painel continua só em `localhost`, a menos que "Permitir acesso pela rede local" esteja ligado. Variáveis `PIU_LNNP_*` (ver o README do `piu-node`) ajustam portas e vizinhos fixos; `PIU_LNNP=0` desliga.
- Ao abrir, o app sobe o `piu-node` embutido (`startNode`) com a pasta de dados em `<dados do app>/node` (`0700`), certificado TLS próprio e a API. A porta é a 8420, ou outra livre se ela estiver ocupada.
- A janela abre `https://localhost:<porta>` e **pareia sozinha**: o processo principal faz o papel da tela do equipamento, gera o código e entra com o nome do usuário do sistema. Parear de novo com o mesmo nome volta à mesma conta.
- **Nó → Mostrar código de pareamento** (Ctrl/⌘ K): para entrar por outro navegador da rede ou confirmar operações sensíveis (transferir LUNES, encerrar sessões). O código nunca vai para a rede.
- **Nó → Permitir acesso pela rede local**: o nó passa a responder também em `piu-node.local`, `<computador>.local` e nos IPs da rede (reinicia o app). Desligado por padrão: só este computador acessa.
- Fechar a janela no Linux deixa o nó ligado na **bandeja** (Abrir painel, Mostrar código, Sair). No macOS, como de costume, o app continua no Dock; "Abrir ao iniciar a sessão" fica no menu Nó.

## Segurança
| Ponto | Como |
|---|---|
| Janela | `contextIsolation`, `sandbox` (todos os processos), sem `nodeIntegration`, sem `webview`, DevTools só fora do pacote. A página não tem acesso ao Node nem a uma ponte com o processo principal |
| TLS | só o certificado do próprio nó, comparado pelo PEM, e só em `localhost`; qualquer outro é recusado |
| Navegação | a janela não navega para fora do nó; links externos HTTPS abrem no navegador do sistema; nenhuma requisição para outra origem (bloqueio no `webRequest`, além da CSP do painel) |
| Permissões | todas negadas (câmera, microfone, localização, notificações da página…), exceto copiar texto |
| Rede | por padrão o nó escuta só em `127.0.0.1`; outros nomes de host recebem 421 (anti DNS rebinding) |
| Código de pareamento | gerado no processo principal; aparece só num diálogo local |
| Pacote | `asar` com verificação de integridade; fuses: sem `RunAsNode`, sem `NODE_OPTIONS`, sem `--inspect`, só carrega o app de dentro do `asar`, cookies cifrados |
| Dados | `desktop.json` e estado do nó com `0600`; nada vai para servidores externos |

O processo principal é **um único arquivo** (`dist/main.cjs`, esbuild) com o `piu-node` e as dependências dele. O app instalado não tem `node_modules`.

## Instaladores
- **Linux:** `npm run dist:linux` gera `Piu Provider-<versão>.AppImage` e `piu-provider-desktop_<versão>_amd64.deb` (testados nesta máquina: o app sobe, pareia e só responde em localhost).
- **macOS:** `npm run dist:mac` num Mac gera `.dmg` e `.zip`. **Sem assinatura nem notarização** por enquanto: na primeira abertura, clique com o botão direito no app → Abrir. Para distribuir, a Lunes precisa de uma conta Apple Developer (certificado "Developer ID Application") e de configurar `mac.identity` e a notarização.
- **Pendente (decisão da Lunes):** `appId` no `electron-builder.yml` (identificador do app, como os das lojas) e a chave pública de release (`PIU_RELEASE_PUBKEY`) para oferecer pacotes do instalador.

## Limitações
- A retransmissão usa a rede local (Wi-Fi/Ethernet) com outros `piu-node`; ainda não fala com os celulares, que usam Bluetooth/Wi-Fi Direct. Visão geral, Malha e Ganhos do painel continuam com dados de exemplo (o nó já expõe estatísticas reais em `GET /api/relay`).
- No Linux, a bandeja depende do ambiente gráfico (`libappindicator`). Sem bandeja, fechar a janela encerra o app.
- Não há atualização automática.
