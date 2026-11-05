# Auditoria do app mobile × design oficial (05/11/2026)

Comparação de `apps/mobile/src` com `design/handoff/design/PiuApp.dc.html` e as referências renderizadas em `design/handoff/reference/app/{light,dark}` (gere com `design/handoff/tools/capture.mjs`). A base visual já é fiel (tokens, fontes, ícones, botões, folhas, diálogos, toasts, toggles, transições de tela e abertura). Abaixo, o que falta ou difere.

## P0 — tela ou fluxo ausente
1. **provTest**: teste real do equipamento, PASSO 3 DE 4, 5 checagens (`check_circle`/`pending`/vazio a cada 800 ms), "Configurar regras" desabilitado até o fim.
2. **provConfig / provAp**: PASSO 4 DE 4, nome do equipamento, nome público `piu.` + `[a-z0-9-]` até 28 com selo de disponibilidade, nota "Pontos de acesso não geram créditos próprios", "Ativar como provider".
3. **verify**: primeira abertura, "Verificando sua cópia do Piu…", 5 checagens × 750 ms, "Continuar" desabilitado até o fim (a checagem real depende da assinatura de release).
4. **recvPage**: página servida pelo celular no envio por Wi-Fi Direct (`lib/wifiShare.ts`): "Cardeal convidou você", código de segurança, Confere / Não confere, download com progresso.
5. **provConnect** no formato do design: segmentado "Do celular | Pelo terminal", cartão do pacote assinado + "Enviar pacote", "PROCURANDO NA REDE LOCAL" (`provScan` 1,9 s), pareamento por 6 dígitos.
6. **Conversa com fila**: cartão tracejado "X está fora de alcance · guardada no nó… expira em N h" (raio 18, 310 px, `schedule_send` 18).

## P1 — diferença visível
7. **requests**: cartão borda `line2` raio 24 gap 14; avatar 52 listrado; nome 16/650 com idade; chip de taxa `bg2` raio 10 12.5/600; balão `bub` 16/16/16/6 15/1.45; "Recusar" outline; preferências em `bg2`.
8. **match**: borda dos avatares 5 px, sobreposição −28, iniciais 30/650, título 40/700/−0.05, pílula 13.5/600; animações `piuInL/piuInR .7s cubic-bezier(.2,.9,.3,1.15)` (±70 px, rotação ∓8°), título `piuUp .5s .35s`, pílula `piuPop .45s .6s`.
9. **nearProfile**: idade no título, bio 16/1.45, chips de interesses (32 px, raio 16, borda `line2`), 3 indicadores do carrossel (24×4), proximidade com ponto 7 px em sans 13.5, sombra `0 2px 8px rgba(0,0,0,.12)` nos botões do topo (+ campos no anúncio de presença).
10. **nearby** (cartão): "nome, idade" + bio em 2 linhas.
11. **provider** (painel no celular): cartão invertido de ganhos com número herói e 14 barras `piuGrow` 600 ms defasadas; "Próxima liquidação · lote"; "ENTREGAS HOJE" com 3 KPIs; linhas com classe e nome público.
12. **provDevice / provEarnings**: barras de interfaces (`piuShrinkInv`), armazenamento para terceiros, KPIs do dia, créditos por tipo, barra Pagos/Validados/Pendentes/Rejeitados.
13. **share**: segmentado Wi-Fi Direct | Bluetooth com estimativa, "Aguardando o outro aparelho…" com progresso, palavras em grade 2×2 de 50 px, cartão do APK com assinatura e SHA-256.
14. **receive**: "Receber de alguém por perto · Pagamento assinado sem internet" e endereço em pílula `bg2` com `content_copy`.
15. **send**: UI do design (contatos 52, valor herói 60/650, chips 1/5/10, resumo Disponível/Taxa/Liquidação, "Assinar e enviar" com `fingerprint`) — entra com a carteira própria (etapa 4).
16. **notifSettings**: botão "Testar com o app fechado" (54, `ink`, `smartphone`).
17. Badge de pedidos pendentes na aba **Por perto**.
18. **emergency**: título 36/700/−0.045, `piuPop .5s` no ícone, `piuUp .5s .15s` no título e `.5s .3s` no cartão.
19. **migrate**: ilustração dos dois aparelhos (124×180) com o pacote em `piuTravel 1.3s`.

## P2 — detalhe
20. Badges de não lidas e da aba com `piuPop .32s cubic-bezier(.2,.9,.3,1.4)` (hoje spring).
21. Ícones da barra de abas com `wght` 350.
22. `piuPop` no selo `verified` do cabeçalho (.4s), no ícone do Dialog (.45s .1s) e no ícone do toast sem moeda (.4s .15s).
23. **lock**: `piuUp` no relógio (.5s) e nas notificações, defasadas.
24. **network**: legenda do radar no canto inferior esquerdo; estado de nó "imitação não verificada".
25. **community**: ordem CANAIS → GRUPOS e subtítulo "Comunidade · N membros · N administradores".
26. StepHeader do provider com "DE 4".
27. **backup**: desfoque real da frase (ex.: `expo-blur`).

Esforço aproximado: P0 ≈ 6 dias, P1 ≈ 7,5 dias, P2 ≈ 1,5 dia.
