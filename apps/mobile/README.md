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
- `src/app/`: rotas (Expo Router). Onboarding em `welcome`, `identity` e `keys`; as 5 abas em `(tabs)/`; a conversa em `chat/[id]`.
- `src/theme/`: tokens claro/escuro (segue o tema do aparelho), fontes e a opção "reduzir movimento".
- `src/ui/`: `T` (texto Geist/Geist Mono com os pesos do design), `Icon`, `Button`, `Avatar`, `Screen`, `RouteSheet`.
- `src/state/store.tsx`: identidades, conversas e envio com os estados criada → na fila → encaminhada → entregue.
- `src/data/seed.ts`: conversas de exemplo do protótipo (ilustrativas).
- `scripts/gen-icons.mjs`: gera `src/ui/icons.generated.ts` com os Material Symbols Rounded usados. Para usar um ícone novo, acrescente o nome em `scripts/icon-names.json` e rode `npm run icons`.

## Decisões técnicas
- **Ícones em SVG**: o React Native não suporta a fonte variável dos Material Symbols (peso e preenchimento). Os caminhos vêm dos pacotes oficiais `@material-symbols/svg-300` e `svg-400`, com versão preenchida para o estado ativo.
- **Pesos da Geist**: o design usa a fonte variável (ex.: 550 e 650). No app, o peso é arredondado para a centena mais próxima, com meio para cima.
- **Barra de status**: a do protótipo (9:41, bateria) é desenho; no aparelho quem cuida é o sistema, com as áreas seguras.

## Etapas
1. **Base, onboarding e Conversas** (feito): Boas-vindas, Identidade, Chaves, lista de Conversas, conversa com estados de entrega, "digitando…", reenviar e a folha "Rota da mensagem". As outras abas mostram o que chega em seguida.
2. Grupos, canais, comunidades, contato e verificação, arquivos em blocos.
3. Rede, modo nó, diagnóstico e provider no celular.
4. Carteira, convite P2P e Por perto.
5. Alertas e notificações, segurança e ajustes.

## Ainda simulado
- A geração das chaves é uma animação; a criptografia real entra com o módulo nativo.
- O envio percorre os estados por temporizador, e a Marina responde sozinha, como no protótipo.
- Nada é salvo entre aberturas do app ainda: o onboarding aparece de novo a cada início.
- Os identificadores das lojas (`bundleIdentifier` e `package`) ainda não estão definidos em `app.json`.
