# App Piu (Android e iOS)

App mobile do Piu, recriado a partir de `design/PiuApp.dc.html`. Feito com **Expo** (SDK 58), **Expo Router** e TypeScript. O transporte P2P (Bluetooth LE, Wi-Fi Direct/Nearby, USB serial para LoRa) vai exigir módulos nativos; o Expo permite isso com *development builds* e config plugins.

```bash
npm install
npm start          # Expo Dev Server (Android, iOS ou web)
npm run web        # abre no navegador
npm run typecheck
npm run export:web # gera dist/ da versão web (usada nos testes)
```

## Estrutura
- `src/app/`: rotas (Expo Router). Onboarding em `welcome`, `identity` e `keys`; as 5 abas em `(tabs)/`; a conversa em `chat/[id]`; `contact/[id]`, `group/[id]`, `community/[id]`, `new` e `new-channel`; `diagnostics`; o provider em `provider/` (`intro`, `add`, `connect`, `test`, `config`, o painel em `index`, `device/[id]` e `earnings`); `wallet/referrals`; o convite P2P em `invite/` (`index`, `share`, `page`, `verify`, `accept`); Por perto em `nearby/` (`[id]`, `requests`, `match`).
- `src/theme/`: tokens claro/escuro (segue o tema do aparelho), fontes e a opção "reduzir movimento".
- `src/ui/`: `T` (texto Geist/Geist Mono com os pesos do design), `Icon`, `Button`, `Avatar`, `Screen`, `Sheet` (folha inferior), `Dialog`, `Toast` (banner in-app), `Controls` (segmentado, toggle, rótulos), `RouteSheet`, `AttachSheet`, `FileBubble`, `WalletSheets` (enviar e receber LUNES), `Stripes` (placeholder listrado das fotos).
- `src/state/store.tsx`: identidades, conversas, envio com os estados criada → na fila → encaminhada → entregue, verificação de contatos, grupo (membros, permissões, versão da chave), canais, arquivos em blocos e banners.
- `src/state/network.tsx`: Modo nó, transportes, limites, equipamentos do provider e o rascunho do assistente “Adicionar equipamento”.
- `src/state/wallet.tsx`: saldo (inicial − enviados − reservados + recebidos), envio, visibilidade em Por perto, convites pagos (valor reservado), pedidos recebidos e a taxa escolhida.
- `src/lib/responsive.ts`: `useLayout()` com a largura/altura da tela, `compact` (< 375 px) e `short` (< 700 px).
- `src/data/seed.ts`, `src/data/network.ts` e `src/data/wallet.ts`: dados de exemplo do protótipo (ilustrativos).
- `scripts/gen-icons.mjs`: gera `src/ui/icons.generated.ts` com os Material Symbols Rounded usados. Para usar um ícone novo, acrescente o nome em `scripts/icon-names.json` e rode `npm run icons`.

## Decisões técnicas
- **Ícones em SVG**: o React Native não suporta a fonte variável dos Material Symbols (peso e preenchimento). Os caminhos vêm dos pacotes oficiais `@material-symbols/svg-300` e `svg-400`, com versão preenchida para o estado ativo.
- **Pesos da Geist**: o design usa a fonte variável (ex.: 550 e 650). No app, o peso é arredondado para a centena mais próxima, com meio para cima.
- **Telas de vários tamanhos**: o layout é fluido (flex e porcentagens) e foi conferido de 320 × 568 (iPhone SE 1ª geração) a 430 × 932, além de 600 px (dobráveis abertos). Abaixo de 375 px, `useLayout().compact` empilha pares de botões, reduz o respiro dos botões e do segmentado e encurta rótulos; a órbita das Boas-vindas e o radar se ajustam ao espaço. Prévias de mensagem e endereços técnicos usam reticências de propósito.
- **Barra de status**: a do protótipo (9:41, bateria) é desenho; no aparelho quem cuida é o sistema, com as áreas seguras.

## Etapas
1. **Base, onboarding e Conversas** (feito): Boas-vindas, Identidade, Chaves, lista de Conversas, conversa com estados de entrega, "digitando…", reenviar e a folha "Rota da mensagem". As outras abas mostram o que chega em seguida.
2. **Grupos, canais, comunidades, contato e arquivos** (feito): verificar contato com código 12×5 e QR; administração do grupo com convite, permissões e troca de chave (v4 → v5) ao remover alguém; criar canal público, privado ou secreto, com identidade pública ou anônima; comunidade; nova conversa; anexar e enviar arquivo em blocos, que pausa sozinho quando a rota vira LoRa e confere a integridade no fim.
3. **Rede, modo nó, diagnóstico e provider** (feito): aba Rede com radar de nós (imitações `piu.*` sem assinatura aparecem como ignoradas), Modo nó com o aviso do iPhone, transportes, limites e nós alcançáveis; Diagnóstico local sem telemetria; provider no celular com assistente de 4 etapas (equipamento, conexão e pareamento por código ou vínculo do Ponto de Acesso, teste real, regras com nome `piu.*`), painel, equipamento (pausar, atualizar, reiniciar, revogar) e ganhos.
4. **Carteira, convite P2P e Por perto** (feito): carteira com saldo, enviar (assinado, entra na fila da malha) e receber (QR, pagamento por perto), bônus de boas-vindas em 4 etapas, distribuição (25 LUNES por pessoa ativa 7 dias), convidados e créditos de rede; convite P2P por Wi-Fi Direct ou Bluetooth com código de segurança de 4 palavras, página local (confere / não confere), verificação da cópia em 5 checagens e aceite; Por perto recíproco (desliga sozinho), grade de perfis públicos sem localização exata, perfil com convite pago (até 140 caracteres, valor reservado e devolvido em 24 h se recusado), pedidos (aceitar, recusar em silêncio, bloquear e denunciar, taxa 1/3/5/10) e a tela de conversa aberta.
5. Alertas e notificações, segurança e ajustes.

## Ainda simulado
- A geração das chaves é uma animação; a criptografia real entra com o módulo nativo.
- O envio percorre os estados por temporizador, e a Marina responde sozinha, como no protótipo.
- O envio de arquivo é simulado (blocos por temporizador); a câmera e o seletor de arquivos entram com os módulos nativos.
- Novo grupo, nova comunidade, escanear código e enviar localização mostram que chegam numa próxima versão.
- O QR é um placeholder (listras), como no design.
- Rede e provider usam dados de exemplo: a busca de equipamentos, o envio do pacote, o pareamento e o teste real são simulados por temporizador, até existir a API do `piu-node` e o transporte nativo.
- Carteira e Por perto usam valores ilustrativos (o modelo econômico ainda está em aberto): assinaturas, liquidação na Mainnet, transferência P2P do instalador e proximidade são simulados; as fotos são placeholders listrados.
- Nada é salvo entre aberturas do app ainda: o onboarding aparece de novo a cada início.
- Os identificadores das lojas (`bundleIdentifier` e `package`) ainda não estão definidos em `app.json`.
