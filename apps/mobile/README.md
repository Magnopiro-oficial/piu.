# App Piu (Android e iOS)

App mobile do Piu, recriado a partir de `design/PiuApp.dc.html`. Feito com **Expo** (SDK 58), **Expo Router** e TypeScript. O transporte P2P (Bluetooth LE, Wi-Fi Direct/Nearby, USB serial para LoRa) vai exigir módulos nativos; o Expo permite isso com *development builds* e config plugins.

```bash
npm install
npm start          # Expo Dev Server (Android, iOS ou web)
npm run web        # abre no navegador
npm run typecheck
npm run export:web # gera dist/ da versão web (usada nos testes)
npm test           # testes do protocolo (criptografia e roteamento)
```

## Estrutura
- `src/app/`: rotas (Expo Router). Onboarding em `welcome`, `identity`, `keys`, `restore` e `migrate`; as 5 abas em `(tabs)/`; a conversa em `chat/[id]`; `contact/[id]`, `group/[id]`, `community/[id]`, `new` e `new-channel`; `diagnostics`; o provider em `provider/` (`intro`, `add`, `connect`, `test`, `config`, o painel em `index`, `device/[id]` e `earnings`); `wallet/referrals`; o convite P2P em `invite/` (`index`, `share`, `page`, `verify`, `accept`); Por perto em `nearby/` (`[id]`, `requests`, `match`); `scan` (adicionar contato pelo QR) e `my-code` (meu QR); `backup`, `devices`, `notifications`, `settings/[page]` (privacy, storage, battery), a prévia da tela bloqueada em `lock` e o alerta de emergência em `alert`.
- `src/theme/`: tokens claro/escuro (segue o tema do aparelho), fontes e a opção "reduzir movimento".
- `src/ui/`: `T` (texto Geist/Geist Mono com os pesos do design), `Icon`, `Button`, `Avatar`, `Screen`, `Sheet` (folha inferior), `Dialog`, `Toast` (banner in-app), `Controls` (segmentado, toggle, rótulos), `RouteSheet`, `AttachSheet`, `FileBubble`, `WalletSheets` (enviar e receber LUNES), `Stripes` (placeholder listrado das fotos), `Settings` (grupos e linhas de ajustes, cartão de opção). O `Dialog` aceita `hold` (segurar para confirmar ações irreversíveis).
- `src/state/store.tsx`: identidades, conversas, envio com os estados criada → na fila → encaminhada → entregue, verificação de contatos, grupo (membros, permissões, versão da chave), canais, arquivos em blocos e banners.
- `src/state/network.tsx`: Modo nó, transportes, limites, equipamentos do provider e o rascunho do assistente “Adicionar equipamento”.
- `src/state/wallet.tsx`: saldo (inicial − enviados − reservados + recebidos), envio, visibilidade em Por perto, convites pagos (valor reservado), pedidos recebidos e a taxa escolhida.
- `src/state/settings.tsx`: privacidade, armazenamento, bateria, notificações, backup feito, aparelhos desconectados e o modo de restauração.
- `src/state/reset.tsx`: “Apagar dados locais” apaga o que está salvo, remonta os provedores de estado e volta às Boas-vindas.
- `src/lib/persist.ts`: dados salvos no aparelho (AsyncStorage, prefixo `piu:v1:`). Tudo é lido antes do splash sumir; `usePersisted` substitui o `useState` nos provedores e grava com 250 ms de atraso. Mensagens em trânsito voltam para a fila e envios de arquivo ficam pausados ao reabrir o app.
- `src/lib/responsive.ts`: `useLayout()` com a largura/altura da tela, `compact` (< 375 px) e `short` (< 700 px).
- `src/data/seed.ts`, `src/data/network.ts`, `src/data/wallet.ts` e `src/data/settings.ts`: dados de exemplo do protótipo (ilustrativos).
- `src/transport/`: transporte P2P (`getTransport()`): o nativo quando existe, senão o simulado; permissões do Android. `src/state/transport.tsx` liga o transporte depois do onboarding, enquanto Bluetooth LE ou Wi-Fi Direct estiverem ativos na aba Rede, e o Diagnóstico mostra o estado e os vizinhos.
- `modules/piu-transport/`: módulo nativo local (Kotlin com Nearby Connections; Swift com Bluetooth LE). Protocolo, limitações e como testar em aparelhos estão no [README do módulo](modules/piu-transport/README.md).
- `src/protocol/`: protocolo de comunicação (protótipo v0): chaves, envelope cifrado, grupos com troca de chave, roteamento store-and-forward, fragmentação, recibos e código de segurança. TypeScript puro, testado com `npm test`. Detalhes, requisitos atendidos e pontos em aberto no [README do protocolo](src/protocol/README.md).
- `src/messaging/`: mensagens reais. `card.ts` é o cartão de contato assinado (o QR); `messenger.ts` liga as sessões cifradas, o roteador e o transporte, com confirmação de entrega cifrada; `testDevice.ts` é o aparelho de teste da simulação. `src/state/messaging.tsx` conecta tudo ao app. Detalhes no [README das mensagens](src/messaging/README.md).
- `scripts/gen-icons.mjs`: gera `src/ui/icons.generated.ts` com os Material Symbols Rounded usados. Para usar um ícone novo, acrescente o nome em `scripts/icon-names.json` e rode `npm run icons`.

## Decisões técnicas
- **Ícones em SVG**: o React Native não suporta a fonte variável dos Material Symbols (peso e preenchimento). Os caminhos vêm dos pacotes oficiais `@material-symbols/svg-300` e `svg-400`, com versão preenchida para o estado ativo.
- **Pesos da Geist**: o design usa a fonte variável (ex.: 550 e 650). No app, o peso é arredondado para a centena mais próxima, com meio para cima.
- **Dados no aparelho**: AsyncStorage 2.2.0 (versão indicada pelo Expo SDK 58), que funciona em Android, iOS e web (localStorage). Sem servidor: nada sai do aparelho.
- **Telas de vários tamanhos**: o layout é fluido (flex e porcentagens) e foi conferido de 320 × 568 (iPhone SE 1ª geração) a 430 × 932, além de 600 px (dobráveis abertos). Abaixo de 375 px, `useLayout().compact` empilha pares de botões, reduz o respiro dos botões e do segmentado e encurta rótulos; a órbita das Boas-vindas e o radar se ajustam ao espaço. Prévias de mensagem e endereços técnicos usam reticências de propósito.
- **Barra de status**: a do protótipo (9:41, bateria) é desenho; no aparelho quem cuida é o sistema, com as áreas seguras.

## Etapas
1. **Base, onboarding e Conversas** (feito): Boas-vindas, Identidade, Chaves, lista de Conversas, conversa com estados de entrega, "digitando…", reenviar e a folha "Rota da mensagem". As outras abas mostram o que chega em seguida.
2. **Grupos, canais, comunidades, contato e arquivos** (feito): verificar contato com código 12×5 e QR; administração do grupo com convite, permissões e troca de chave (v4 → v5) ao remover alguém; criar canal público, privado ou secreto, com identidade pública ou anônima; comunidade; nova conversa; anexar e enviar arquivo em blocos, que pausa sozinho quando a rota vira LoRa e confere a integridade no fim.
3. **Rede, modo nó, diagnóstico e provider** (feito): aba Rede com radar de nós (imitações `piu.*` sem assinatura aparecem como ignoradas), Modo nó com o aviso do iPhone, transportes, limites e nós alcançáveis; Diagnóstico local sem telemetria; provider no celular com assistente de 4 etapas (equipamento, conexão e pareamento por código ou vínculo do Ponto de Acesso, teste real, regras com nome `piu.*`), painel, equipamento (pausar, atualizar, reiniciar, revogar) e ganhos.
4. **Carteira, convite P2P e Por perto** (feito): carteira com saldo, enviar (assinado, entra na fila da malha) e receber (QR, pagamento por perto), bônus de boas-vindas em 4 etapas, distribuição (25 LUNES por pessoa ativa 7 dias), convidados e créditos de rede; convite P2P por Wi-Fi Direct ou Bluetooth com código de segurança de 4 palavras, página local (confere / não confere), verificação da cópia em 5 checagens e aceite; Por perto recíproco (desliga sozinho), grade de perfis públicos sem localização exata, perfil com convite pago (até 140 caracteres, valor reservado e devolvido em 24 h se recusado), pedidos (aceitar, recusar em silêncio, bloquear e denunciar, taxa 1/3/5/10) e a tela de conversa aberta.
5. **Perfil, segurança, ajustes e alertas** (feito): aba Perfil com identidade pública/anônima, impressão digital e ajustes; backup das chaves em 3 passos (frase de 12 palavras oculta até tocar, confirmar 3 palavras, onde guardar a cópia cifrada); restaurar de outro aparelho, pela frase ou por arquivo, com migração em 5 etapas; aparelhos (desconectar, revogar perdido); Privacidade, Armazenamento e Bateria e limites (com estimativa de gasto como nó); Notificações sem servidor (pré-visualização, tipos, silêncio) com prévia da tela bloqueada; alerta de emergência assinado em tela cheia; apagar dados locais segurando o botão.

## Segurança no aparelho
- **Segredos no cofre do sistema** (`src/lib/vault.ts`, Keychain/Keystore, só neste aparelho, fora de backups): a frase de recuperação e a chave de dados.
- **Dados cifrados em repouso** (`src/lib/persist.ts`): tudo o que o app salva no AsyncStorage é cifrado com AES-256-GCM (nonce aleatório, nome do campo como dado associado). Valor adulterado é descartado; formato antigo em texto puro é migrado na abertura. "Apagar dados locais" destrói a chave (crypto-shredding).
- **Android sem backup automático** (`android.allowBackup: false`).
- **Bloqueio do app** (Privacidade → "Abrir o Piu com biometria"): biometria ou PIN/senha ao abrir e ao voltar do segundo plano; ligar ou desligar exige autenticar; app desfocado na troca de apps (iPhone).
- **Frase de recuperação**: só aparece depois de autenticar no aparelho; prints e gravação de tela bloqueados no backup.
- **Rotas protegidas**: antes do onboarding, links `piu://` para telas internas voltam às Boas-vindas; a migração não conclui sem chaves.
- **Malha**: limite de envelopes por vizinho no roteador; remontagem BLE do iPhone com teto de memória.
- Na **web** (demonstração e testes) não há cofre nem bloqueio do aparelho: a frase e a chave de dados ficam no navegador, com aviso na tela.

## Ainda simulado
- **Chaves reais:** no onboarding é gerada uma frase de recuperação (12 palavras BIP39 em inglês), guardada no cofre do sistema (`expo-secure-store`: Keychain/Keystore, só neste aparelho). As identidades pública e anônima, a impressão digital, o código de segurança e o backup derivam dela, e restaurar pela frase recupera as mesmas chaves. Ainda são simulados: a transferência de outro aparelho ou por arquivo (que por enquanto gera chaves novas) e a revogação de aparelhos.
- **Mensagens reais com contatos adicionados pelo QR:** quem entra pelo QR (ou escreve primeiro, como pedido de conversa) conversa de verdade: Double Ratchet dentro do envelope selado, fila store-and-forward, transporte por perto e confirmação de entrega. No navegador e no Expo Go, use **Nova conversa → Escanear código → Usar o aparelho de teste** para ver o caminho completo sem dois celulares. Texto apenas por enquanto: arquivos, grupos e canais continuam simulados.
- **Contatos de exemplo:** recebem chaves determinísticas de demonstração (`src/lib/demoContacts.ts`), para que o código de segurança seja calculado com o algoritmo real.
- Com os **contatos de exemplo**, o envio percorre os estados por temporizador, e a Marina responde sozinha, como no protótipo.
- O envio de arquivo é simulado (blocos por temporizador); a câmera e o seletor de arquivos entram com os módulos nativos.
- Novo grupo, nova comunidade e enviar localização mostram que chegam numa próxima versão.
- Os QRs do Perfil, do convite, do contato e de "Meu código" são reais (cartão assinado, vale 24 h). Os da carteira, do grupo e do compartilhamento do app ainda são placeholders.
- O transporte nativo foi escrito, mas ainda não foi compilado nem testado em aparelhos. No navegador e no Expo Go, o transporte é simulado (vizinhos do protótipo e o aparelho de teste).
- Rede e provider usam dados de exemplo: a busca de equipamentos, o envio do pacote, o pareamento e o teste real são simulados por temporizador, até existir a API do `piu-node` e o transporte nativo.
- Carteira e Por perto usam valores ilustrativos (o modelo econômico ainda está em aberto): assinaturas, liquidação na Mainnet, transferência P2P do instalador e proximidade são simulados; as fotos são placeholders listrados.
- Notificações do sistema ainda não são disparadas: a tela bloqueada é uma prévia dentro do app, e os ajustes não chegam ao sistema operacional.
- Os identificadores das lojas (`bundleIdentifier` e `package`) ainda não estão definidos em `app.json`.
