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
- `src/app/`: rotas (Expo Router). Onboarding em `welcome`, `identity` e `keys`; as 5 abas em `(tabs)/`; a conversa em `chat/[id]`; `contact/[id]`, `group/[id]`, `community/[id]`, `new` e `new-channel`; `diagnostics`; o provider em `provider/` (`intro`, `add`, `connect`, `test`, `config`, o painel em `index`, `device/[id]` e `earnings`).
- `src/theme/`: tokens claro/escuro (segue o tema do aparelho), fontes e a opção "reduzir movimento".
- `src/ui/`: `T` (texto Geist/Geist Mono com os pesos do design), `Icon`, `Button`, `Avatar`, `Screen`, `Sheet` (folha inferior), `Dialog`, `Toast` (banner in-app), `Controls` (segmentado, toggle, rótulos), `RouteSheet`, `AttachSheet`, `FileBubble`.
- `src/state/store.tsx`: identidades, conversas, envio com os estados criada → na fila → encaminhada → entregue, verificação de contatos, grupo (membros, permissões, versão da chave), canais, arquivos em blocos e banners.
- `src/state/network.tsx`: Modo nó, transportes, limites, equipamentos do provider e o rascunho do assistente “Adicionar equipamento”.
- `src/data/seed.ts` e `src/data/network.ts`: dados de exemplo do protótipo (ilustrativos).
- `scripts/gen-icons.mjs`: gera `src/ui/icons.generated.ts` com os Material Symbols Rounded usados. Para usar um ícone novo, acrescente o nome em `scripts/icon-names.json` e rode `npm run icons`.

## Decisões técnicas
- **Ícones em SVG**: o React Native não suporta a fonte variável dos Material Symbols (peso e preenchimento). Os caminhos vêm dos pacotes oficiais `@material-symbols/svg-300` e `svg-400`, com versão preenchida para o estado ativo.
- **Pesos da Geist**: o design usa a fonte variável (ex.: 550 e 650). No app, o peso é arredondado para a centena mais próxima, com meio para cima.
- **Barra de status**: a do protótipo (9:41, bateria) é desenho; no aparelho quem cuida é o sistema, com as áreas seguras.

## Etapas
1. **Base, onboarding e Conversas** (feito): Boas-vindas, Identidade, Chaves, lista de Conversas, conversa com estados de entrega, "digitando…", reenviar e a folha "Rota da mensagem". As outras abas mostram o que chega em seguida.
2. **Grupos, canais, comunidades, contato e arquivos** (feito): verificar contato com código 12×5 e QR; administração do grupo com convite, permissões e troca de chave (v4 → v5) ao remover alguém; criar canal público, privado ou secreto, com identidade pública ou anônima; comunidade; nova conversa; anexar e enviar arquivo em blocos, que pausa sozinho quando a rota vira LoRa e confere a integridade no fim.
3. **Rede, modo nó, diagnóstico e provider** (feito): aba Rede com radar de nós (imitações `piu.*` sem assinatura aparecem como ignoradas), Modo nó com o aviso do iPhone, transportes, limites e nós alcançáveis; Diagnóstico local sem telemetria; provider no celular com assistente de 4 etapas (equipamento, conexão e pareamento por código ou vínculo do Ponto de Acesso, teste real, regras com nome `piu.*`), painel, equipamento (pausar, atualizar, reiniciar, revogar) e ganhos.
4. Carteira, convite P2P e Por perto.
5. Alertas e notificações, segurança e ajustes.

## Ainda simulado
- A geração das chaves é uma animação; a criptografia real entra com o módulo nativo.
- O envio percorre os estados por temporizador, e a Marina responde sozinha, como no protótipo.
- O envio de arquivo é simulado (blocos por temporizador); a câmera e o seletor de arquivos entram com os módulos nativos.
- Novo grupo, nova comunidade, escanear código, convidar e enviar localização mostram que chegam numa próxima versão.
- O QR é um placeholder (listras), como no design.
- Rede e provider usam dados de exemplo: a busca de equipamentos, o envio do pacote, o pareamento e o teste real são simulados por temporizador, até existir a API do `piu-node` e o transporte nativo.
- Nada é salvo entre aberturas do app ainda: o onboarding aparece de novo a cada início.
- Os identificadores das lojas (`bundleIdentifier` e `package`) ainda não estão definidos em `app.json`.
