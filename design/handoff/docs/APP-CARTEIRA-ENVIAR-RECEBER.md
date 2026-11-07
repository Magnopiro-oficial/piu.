# App mobile · Carteira → Enviar, Receber e cena de pagamento (especificação obrigatória)

> A primeira implementação saiu errada: **faltaram os botões Enviar/Receber**, **Receber sem QR code** e **pagamento sem animação**. Este documento é a fonte de verdade. Fonte: `design/PiuApp.dc.html` — tela `isWallet` (~linha 841), folha `sendOpen` (~2157), cena `payFly` (~2205), folha `receiveOpen` (~2330); lógica: `walletActions`, `qr()`, `startPay()`, `closePay()`, `payVals()`, `countBal()`.
> Código pronto: `docs/reference-code/app-wallet.js`. Imagens: `reference/app/wallet_send_receive/` (estados finais) + `reference/app/payment/` e `reference/app/receive_qr/` (quadros da animação) + vídeos `reference/video/app_payment.webm` e `app_receive_qr.webm`.

Viewport 390×844. Status bar 54px, barra de abas 84px.

## 1. Tela Carteira (`01-carteira.png`)
- Entrada da aba: `piuTab .34s cubic-bezier(.2,.8,.3,1)`.
- Título "Carteira" 36/700 (−0.045em) + pílula "Mainnet: ontem" (ícone `cloud_off`, borda `--line2`).
- Segmentado **Saldo | Créditos de rede** (altura 36, raio 11, trilho `--bg2` raio 14).
- **Cartão de saldo** (fundo `--ink`, texto `--invink`, raio 28, padding 22/20/18, margem 14/20): `piuCardIn .65s cubic-bezier(.2,.85,.3,1) .04s`; anel 250px girando `piuSpin 22s` com ponto; anel 142px fixo; brilho `piuShine 1.5s .55s`.
  - "Saldo disponível" 13px opacidade .7 + olho (`visibility`/`visibility_off`, preferência `piu.hideBal`).
  - Saldo 54/650 tabular-nums + "LUNES" 15/600. **Conta de 0 até o saldo em 950ms** ao entrar (`1-(1-p)^4`).
  - "+ 60,00 a liberar · bônus em validação".
  - **TRÊS BOTÕES OBRIGATÓRIOS** em grid de 3 colunas, gap 8:
    | ícone | rótulo | ação |
    |---|---|---|
    | `arrow_upward` | **Enviar** | abre folha Enviar (`walletSheet='send'`, zera hold) |
    | `arrow_downward` | **Receber** | abre folha Receber (`walletSheet='receive'`) |
    | `person_add` | **Convidar** | vai para Convite P2P |
    Círculo 52×52, fundo `--invink`, ícone `--ink` 24px; rótulo 12.5/550 abaixo (gap 7). `:active` scale(.88). Entrada `piuPop .5s cubic-bezier(.2,.9,.3,1.4)` com atraso **0.32s / 0.39s / 0.46s**.
  - Rodapé do cartão: `lunes:3P8xK2…Q7nM` Geist Mono 12px + `content_copy`, linha superior `rgba(127,127,127,.35)`.

## 2. Folha Enviar (`02-enviar-folha.png`)
Scrim `--scrim` (`piuFade .22s`), toque fecha. Folha: fundo `--bg`, raio 30 30 0 0, padding 10/20/34, gap 18, `piuSheet .38s cubic-bezier(.2,.9,.3,1)` (sobe de translateY(100%)), alça 38×5.
1. "Enviar LUNES" 22/700.
2. **Destinatários** Marina (MA) · Ana (AC) · Pedro (PL) · João (JS), gap 14, largura 62 cada. Círculo 52×52 com **borda 1.5px `--ink`**; selecionado: fundo `--ink`, texto `--invink`, nome 650; demais fundo transparente, nome 450. **Padrão Marina.**
3. **Valor**: input centralizado 650 56px (−0.055em), `inputMode="decimal"`, aceita `[0-9,.]`, **inicial "5"**; "LUNES" 14/600 `--ink2` abaixo.
4. **Valores pré-definidos (OBRIGATÓRIO)**: chips **"1 LUNES" · "5 LUNES" · "10 LUNES"**, centralizados, gap 6; altura 32, padding 0 14, raio 16, fundo `--bg2`, 550 13.5px. Clique define o valor.
5. Resumo (fundo `--bg2`, raio 18, padding 14/16, 13px): Disponível `58,40 LUNES` · Taxa estimada `0,01 LUNES` · Liquidação `quando a malha alcançar a Mainnet`.
6. **Botão "Segure para assinar e enviar"** (ícone `fingerprint`): altura 56, raio 28, fundo `--ink`, 600 16px; opacity 1 se `0 < valor ≤ saldo`, senão 0.35.
   - **Segurar 900ms** (requestAnimationFrame): camada `--invink` a 24% cresce da esquerda (largura = p·100%); botão `scale(1 − p·0.03)`; peso do ícone `400 + p·300`; rótulo vira "Assinando…".
   - Soltar antes: zera e a dica abaixo vira "Continue segurando até completar" (600, `--ink`). Dica padrão: "A chave nunca sai deste aparelho" (`--ink2`).
   - Teclado: Enter/Espaço dispara direto. Bloquear menu de contexto, `touch-action:none`, `user-select:none`.
   - Ao completar → `startPay()` (cena abaixo).

## 3. Cena de pagamento (tela cheia) — ver `04-pagamento-recibo.png`, `reference/app/payment/*.png` e `app_payment.webm`
Camada `position:absolute; inset:0; z-index:40`, fundo `--ink`, texto `--invink`. Tempos a partir do fim do gesto (t=0):

| t | Evento |
|---|---|
| 0 | Íris abre: `piuIrisIn .75s cubic-bezier(.7,0,.2,1)` — `clip-path: circle(0 → 150% at 50% 93%)` (sai do botão) |
| 0.30s | Fundo de pontos 22px (`radial-gradient` invink 17%) `piuFade 1s` |
| 0.35s | Topo: "PAGAMENTO P2P" + valor (Geist Mono 11.5), barra 2px enchendo `piuShrinkInv 3.6s cubic-bezier(.45,0,.25,1) .3s`, status com ponto pulsando |
| 0.25s | Círculo 168px `piuPop .6s`; arco desenha `piuDraw .85s .3s` (r=76, dasharray 478); digital 86px com linha de leitura `piuScanY .55s .3s infinite alternate` |
| 0.40s | `sig 9f2c41d8e07a5b33c1…a01b` digitando `piuType .7s steps(27)` |
| 0.42s | folha Enviar some (`payCover`) · 0.76s fecha a folha |
| 1.10s | "Assinando" some; 1.12s digital some; 1.15s anel `piuRingS`; **1.18s selo `verified` `piuPop .5s`**; 1.20s "Assinado" sobe |
| 1.60s | Bloco de assinatura sai `piuOutUp .45s` |
| 1.75s | Valor 64/700 + "LUNES para Marina" sobem (top 452) |
| 2.05s | Nó "Você" 52px em (169,674) `piuPop` |
| 2.10s | Rota pontilhada `195,700 88,575 300,455 110,335 195,205` aparece |
| 2.20s | Valor encolhe virando moeda `piuToCoin .35s` (desce 208px, scale .1) |
| 2.20/2.28/2.36s | Nós intermediários 14px: **7F·A2 Wi-Fi Direct** (81,568), **C2·19 Wi-Fi Mesh** (293,448), **88·E0 Bluetooth** (103,328) |
| 2.40s | **Moeda "L" 30px voa pela rota** `piuCoinFly 1.4s linear` + gira `piuCoin` (rotateY 720°), com 3 rastros (atrasos +.05/.10/.15s, opacidades .38/.22/.12, escalas .86/.74/.62); linha sólida desenha `piuDraw 1.4s linear` (dasharray 790) |
| 2.44s | Destinatário 68px (161,171) com iniciais `piuPop`; nome abaixo em 2.5s |
| 2.69 / 3.13 / 3.52s | Cada nó acende `piuLit .25s` + onda `piuRing .9s` quando a moeda passa |
| 3.80s | Chegada: destinatário `piuBump .55s`, 3 anéis `piuRingS 1.1s` (+0/.14/.28s), **16 faíscas** `piuSpark .8s` |
| 4.15s | Cena da rota sai `piuOutSoft .45s` |
| 4.30s | Recibo: círculo 124px desenha `piuDraw .6s` (4.32s), check desenha 4.8s, anel 4.95s |
| 4.55s | "5,00 LUNES" 60/700 sobe · 4.65s "Marina recebeu a transação assinada" |
| 4.80s | Tabela: Rota `Você → 3 nós → Marina` · Tempo na malha `1,4 s` · Taxa `0,01 LUNES` · Liquidação `quando um gateway alcançar a Mainnet` · tx `9f2c…a01b` |
| 5.00s | Botão **Concluir** (56px, fundo `--invink`) |

Status no topo (troca em 1.15, 1.70, 2.69, 3.13, 3.52, 3.80s): "Assinando com a chave deste aparelho" → "Assinado · Ed25519" → "Saindo pelo Bluetooth" → "Salto 1 de 3 · Wi-Fi Direct" → "Salto 2 de 3 · Wi-Fi Mesh" → "Salto 3 de 3 · Bluetooth" → "Entregue a Marina".

**Concluir** → íris fecha `piuIrisOut .52s cubic-bezier(.6,0,.4,1)` (`circle(150% → 0 at 50% 24%)`); após 520ms a cena desmonta, o **saldo conta de 58,40 até 53,40 em 1300ms** e a nova linha do histórico entra com `piuRowFresh 1.8s .35s` (destaque que desbota).

## 4. Folha Receber (`03-receber-qr-final.png`, `reference/app/receive_qr/*.png`, `app_receive_qr.webm`)
Mesma folha/scrim de Enviar. Conteúdo (gap 18):
1. "Receber LUNES" 22/700.
2. **Cartão do QR**: fundo **#fff sempre**, padding 16, raio 26, `box-shadow:0 0 0 1px var(--line2), 0 24px 56px -22px rgba(0,0,0,.35)`, `piuPop .6s cubic-bezier(.2,.9,.3,1.25) .12s`. **Tocar gera um novo código** (seed+1, onda recomeça).
3. **Grade 29×29 em 200×200px**. Módulos `#0c0c0c`, raio 1px nos localizadores, 2px no resto. Centro 11–17 vazio.
4. **Onda do centro**: cada módulo `piuQr .35s {d}ms cubic-bezier(.2,.9,.3,1.5) both`, `d = 120 + round(hypot(r−14,c−14)·28)` na primeira vez; ao regenerar, sem os 120ms. Alternar o nome do keyframe (`piuQr`/`piuQrB`) a cada seed para reiniciar a animação.
5. **Linha de leitura**: barra 3px `#0c0c0c` com brilho, `piuScan 2.6s ease-in-out 1.1s infinite` (de cima a baixo, inset 16/10).
6. **Ícone Piu** central: caixa branca 48×48 raio 13 padding 4, `piuPop .5s 1s`; `brand/icon-192.png` 40×40 raio 10.
7. "toque no código para gerar outro" (ícone `refresh`, Geist Mono 11.5, `piuFade .4s 1.1s`).
8. Endereço: `lunes:3P8xK2mVt9…dE4hQ7nM` Geist Mono 13 + `content_copy`, fundo `--bg2` raio 14.
9. Linha "Receber de alguém por perto" (ícone `bluetooth`, subtítulo "Pagamento assinado sem internet") com interruptor 46×28 (ligado por padrão).
10. "Este endereço não está ligado às suas identidades de conversa." 12.5 `--ink2`.

Produção: QR real (versão 3, ECC H) com o endereço; manter o visual (grade 29×29, raio 2px, onda, linha de leitura, ícone).

## Checklist
- [ ] Cartão de saldo com **Enviar · Receber · Convidar** (círculos brancos 52px, entrada escalonada).
- [ ] Folha Enviar: 4 contatos, valor 5, chips 1/5/10 LUNES, resumo, botão de segurar 900ms com preenchimento.
- [ ] Cena de pagamento completa conforme a tabela (íris, assinatura, moeda pela rota, chegada, recibo, Concluir).
- [ ] Saldo conta para baixo após Concluir e nova linha destacada.
- [ ] Folha Receber com QR em onda, linha de leitura, ícone, tocar para regenerar.
- [ ] Comparar com `reference/app/wallet_send_receive/`, `payment/`, `receive_qr/` e os vídeos.
