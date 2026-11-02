# Roteiro de testes em aparelhos reais

Estes testes cobrem o que **nunca rodou fora do simulador ou do navegador**. Cada um diz o que preparar, os passos, o resultado esperado e o que anotar se der errado. O critério de aceite do MVP técnico (seção 16 do documento de requisitos) pede medições reais de alcance, taxa de entrega, latência, bateria e limites por transporte: os testes 3, 4 e 10 produzem esses números.

**Como devolver:** para cada teste, `ok` ou `falhou` + o passo em que falhou + o que apareceu na tela (print) + o log. Em Android: `adb logcat | grep -i piu`. Em iPhone: Console do macOS com o aparelho conectado. No piu-node: o terminal ou `logread` no OpenWrt.

## Preparação

| Item | Para quê |
|---|---|
| 2 Android (de preferência um com Android 12+ e outro com 10/11) | transporte, notificações, segundo plano |
| 1 iPhone (iOS 16+) | Android ↔ iPhone, Face ID / Touch ID |
| 1 computador Linux e 1 Mac | app desktop do provider |
| Opcional: roteador OpenWrt 24.10 ou 25.12 (≥ 256 MB de RAM), 2 placas LoRa com firmware de modem KISS | testes 9 e 10 |
| Fita métrica ou o GPS do celular, cronômetro | alcance e latência |

Build: `apps/mobile` → `npx expo prebuild` e build de desenvolvimento (`npx expo run:android` / `npx expo run:ios`). Instale **o mesmo build** em todos os aparelhos.

## 1. Primeira abertura, chaves e biometria
1. Abra o app num aparelho com bloqueio configurado → Criar identidade → Gerar minhas chaves.
2. Perfil → Backup → Mostrar frase: deve pedir a biometria/PIN antes. Tente um print: deve ser bloqueado (Android) ou a tela deve ficar escondida (iPhone).
3. Privacidade → "Abrir o Piu com biometria" → ligue. Feche o app e abra: pede biometria. Troque de app e volte: pede de novo.
- **Esperado:** nenhum segredo aparece sem autenticar.
- **Anote:** modelo, versão do sistema, tipo de bloqueio (digital, rosto, PIN).

## 2. Contato pelo QR (câmera real)
1. Aparelho A: Perfil → Meu código. Aparelho B: Nova conversa → Escanear código → Abrir a câmera → aponte.
2. B: "Adicionar e conversar". Mande "oi".
3. Repita escaneando o mesmo QR com um terceiro aparelho: deve recusar (QR de uso único).
4. Na conversa, abra o contato → Verificar → Escanear QR do outro: "Código confere".
- **Esperado:** leitura em até 2 s; a conversa abre cifrada; uso único respeitado.

## 3. Mensagens sem internet: Android ↔ Android, Android ↔ iPhone
Em todos os aparelhos: **modo avião ligado**, depois Bluetooth e Wi‑Fi ligados de novo (sem rede conectada).
1. A ↔ B (Android ↔ Android) a 1 m: mande 20 mensagens alternadas. Anote quantas chegaram e o tempo até "entregue" (cronômetro ou o Diagnóstico).
2. Repita a 10 m, 30 m e 50 m (campo aberto) e com uma parede no meio.
3. Repita com Android ↔ iPhone.
4. Feche o app do destino, mande 3 mensagens, abra o app de novo: devem chegar (fila store-and-forward).
- **Esperado:** em 1–10 m, 100% entregue; o Diagnóstico mostra a taxa e a latência reais.
- **Anote (tabela):** distância, obstáculos, meio (aba Rede), entregues/enviadas, latência mediana.

## 4. Multihop com 3 aparelhos (A → B → C)
1. Coloque A e C longe o bastante para **não** se verem (teste: com B desligado, A não entrega a C). B no meio, com Modo nó ligado.
2. A manda 10 mensagens para C.
3. Em B, a carteira → Créditos de rede deve mostrar recibos pendentes → validados quando C receber.
- **Esperado:** C recebe tudo; B não consegue ler o conteúdo; aparece o crédito em B.
- **Anote:** entregues, latência, e se B mostrou crédito.

## 5. Arquivos e fotos
1. Mande uma foto (2–5 MB) e um PDF de A para B (a 2 m, sem internet).
2. No meio do envio, afaste B até cortar; reaproxime: deve continuar de onde parou.
- **Esperado:** "Entregue · integridade conferida (SHA-256)"; a foto abre igual.
- **Anote:** tempo total, se retomou ou recomeçou.

## 6. Segundo plano e bateria (Android)
1. Em B: Modo nó ligado + "Retransmitir em segundo plano". Bloqueie a tela por 30 min.
2. Durante esse tempo, A manda mensagens para C passando por B (como no teste 4).
3. Anote a bateria de B antes e depois (Configurações → Bateria do sistema → Piu).
- **Esperado:** as mensagens passam com a tela de B bloqueada; consumo anotado.
- **Anote:** % de bateria por hora do Piu, se o sistema matou o app.

## 7. Notificações
1. Com o app em segundo plano, mande uma mensagem: aparece a notificação; toque nela → abre a conversa.
2. Ative "Ocultar prévia": a notificação não mostra o texto.
- **Anote:** se chegou, atraso, se a prévia respeitou o ajuste.

## 8. Migrar de aparelho e revogar
1. Aparelho novo: Restaurar → De outro aparelho → mostra um QR. Aparelho antigo: Aparelhos → Adicionar aparelho → escaneie.
2. Confira as 4 palavras nos dois. Conclua.
3. No novo, a conversa com B deve continuar (B pode precisar conferir o código de segurança de novo).
4. No antigo: Aparelhos → Desconectar o aparelho novo. B deve ver o aviso de revogação.
- **Anote:** se as conversas vieram, se o aviso chegou a B.

## 9. Provider: desktop, painel e aprovação no celular
1. Linux: instale o `.deb` ou rode o AppImage. Mac: abra o `.dmg` (sem assinatura: botão direito → Abrir).
2. O painel abre sozinho; Configurações → Parear celular → no celular, Nova conversa → Escanear código → digite os 6 dígitos no painel.
3. Carteira → Transferir 1 LUNES → "Assinar no celular": escaneie o QR, confira o código de 6 dígitos, aprove com a biometria, digite o código de aprovação no painel.
4. Opcional: OpenWrt — `opkg install piu-node_*.ipk` (24.10) ou o `.apk` (25.12), `logread -f`, abra `https://<ip do roteador>:8420`.
- **Esperado:** pareamento e aprovação sem internet; o saldo cai uma vez só.
- **Anote:** sistema, se o Mac pediu permissão de rede, memória usada pelo piu-node no roteador (`top`).

## 10. LoRa como ponte de longa distância (com placas)
O LoRa é a ponte entre malhas distantes: só mensagens pequenas, nunca mídia.
1. Duas placas LoRa com firmware de modem KISS, cada uma num computador ou roteador com o piu-node: `PIU_SERIAL=lora:/dev/ttyUSB0@115200`, `PIU_LORA_SF`, `PIU_LORA_BW_KHZ` e `PIU_LORA_CR` iguais aos do firmware.
2. Confirme o enlace: `GET /api/relay` mostra o vizinho com meio `lora`.
3. Afaste: 100 m, 500 m, 1 km, 2 km, 5 km (o máximo que der, com linha de visada e sem). Em cada ponto, mande 20 mensagens curtas de um celular ligado a um nó para um celular ligado ao outro.
4. Mande uma foto: ela **não** deve ir pelo rádio (fica guardada até haver outro meio).
- **Anote (tabela):** distância, visada (sim/não), SF/banda, entregues/enviadas, latência, `airtimeMs`, `retries` e `dutyUsedPercent` de `/api/relay`.
- **Ajuste se precisar:** perdas altas → SF maior (alcança mais, transmite mais devagar).

## 11. Lunes: conferência da Mainnet e pagamento de teste
Endereços de produção: `wss://ws.lunes.com`, `wss://ws-lunes-main-01.lunes.io`, `wss://ws-lunes-main-02.lunes.io` e `wss://ws-archive.lunes.io`.
1. **Mainnet, só leitura:** `cd apps/settlement && npm ci && npm run mainnet:check`. Não usa chave nem envia nada.
2. **Pagamento de teste numa chain local** (sem dinheiro real):
   - no repositório `lunes-platform/lunes-nightly`, rode `./artefacts/lunes-node --dev --tmp`; a chain fica em `ws://127.0.0.1:9944`;
   - aqui: `npm run validator:demo -- dados`, depois `validator:close` duas vezes (épocas 2026-S40 e 2026-S41, como no README);
   - pague com a conta de desenvolvimento: `PIU_SETTLEMENT_SEED=//Alice npm run lot:pay -- dados/lotes/piu-lote-2026-S41.json --ws ws://127.0.0.1:9944 --confirm piu-lote-2026-S41`;
   - por fim, `npm run validator:paid -- --lot piu-lote-2026-S41`.
3. **Mainnet com valor mínimo**, só depois dos passos 1 e 2: um lote de 5 LUNES para uma carteira própria, pago pela conta da tesouraria.
- **Esperado:**
  - no passo 1, todos os itens `[ok]`;
  - no passo 2, o lote finalizado e marcado como pago;
  - no passo 3, o lote aparece no explorador com o remark `piu/lote/v1`.
