# Piu Desktop · Carteira → Enviar e Receber (especificação obrigatória)

> A primeira implementação saiu errada: **sem QR code** em Receber e **sem os valores pré-definidos** em Enviar. Este documento é a fonte de verdade. Reproduza **exatamente**, compare com os PNG em `reference/desktop/wallet_send_receive/` e use o código pronto em `docs/reference-code/desktop-wallet.js` (QR, formatação, estados).
> Fonte original: `design/Piu Desktop.dc.html` — template linhas ~543–597, lógica `walletVals()`, `qr()`, `balance()`, `startBal()`.

## Referências visuais (janela 1280×820, captura a 71%)
| Arquivo | Estado |
|---|---|
| `01-enviar-padrao.png` | Enviar aberto: Marina selecionada, valor **5**, chip **5** ativo |
| `02-enviar-ana-25.png` | Ana selecionada, chip **25** ativo |
| `03-enviar-erro-saldo.png` | Valor 80 > saldo: aviso + botão a 35% |
| `04-enviado-sucesso.png` | Sucesso; saldo contou 58,40 → 53,40; linha nova "na malha" |
| `05-receber-qr-200ms.png` / `06-…500ms.png` | QR nascendo do centro para fora |
| `07-receber-qr-final.png` | QR completo com ícone Piu no centro |
| `08-enviar-escuro.png` / `09-receber-escuro.png` | Tema escuro (o cartão do QR continua **branco**) |

## Onde fica
Página Carteira: grid `minmax(0,1.35fr) minmax(0,1fr)`, gap 20, máx. 980px, padding 30/36/40.
- Coluna esquerda: título, cartão de saldo, movimentações.
- **Coluna direita** (padding-top 52px): o **painel Enviar/Receber aparece no topo desta coluna**, acima de "Créditos de rede". Não é modal, não é rota nova, não é folha inferior.

Botões do cartão de saldo: `Enviar` (ícone `north_east`) · `Receber` (`south_west`) · `Converter` (`swap_horiz`).
- Botão ativo = o do painel aberto: fundo `var(--invink)`, texto `var(--ink)`. Inativos: fundo `rgba(127,127,127,.22)`, texto `var(--invink)`. Altura 48, raio 24, flex:1, gap 10, fonte 600 14px.
- Clicar Enviar → `wSheet='send', sendDone=false`. Receber → `wSheet='receive'`. Converter → **não abre painel**, só toast "Conversão disponível quando a malha alcançar a Mainnet" (ícone `cloud_off`).
- Botão de pagar dentro da conversa (`payments`) abre a Carteira com Enviar e o contato da conversa pré-selecionado (se for marina/ana/pedro/joao).

## Painel (container comum)
- `border-radius:24px; background:var(--bg); padding:20px; gap:16px; box-shadow: 0 0 0 1px var(--line2) inset, 0 24px 60px -30px rgba(0,0,0,.35)`
- Entrada: `piuSide .45s cubic-bezier(.2,.85,.3,1) both` (translateX 40px → 0, opacity 0 → 1).
- Cabeçalho: título 18/700, letter-spacing −0.02em — **"Enviar LUNES"**, **"Enviado"** (após sucesso) ou **"Receber LUNES"**. Botão fechar 30×30 raio 15, fundo `--bg2`, ícone `close` 17px → `wSheet=null`.

## ENVIAR — formulário

### 1. Destinatários (4 fixos, nesta ordem)
| id | iniciais | nome exibido | nome completo |
|---|---|---|---|
| marina | MA | Marina | Marina Alves |
| ana | AC | Ana | Ana Costa |
| pedro | PL | Pedro | Pedro Lima |
| joao | JS | João | João Souza |

Linha `display:flex; gap:12px`, cada item flex:1, coluna centrada gap 6. Avatar 48×48 círculo, 600 14px. Selecionado: fundo `--ink`, texto `--invink`, `scale(1.08)`; não selecionado: fundo `--bg3`, texto `--ink`, `scale(1)`. Transição `background .25s, color .25s, transform .3s cubic-bezier(.2,.9,.3,1.5)`. Nome 12/550.
Entrada escalonada: `piuPop .45s {0.10 + i·0.05}s cubic-bezier(.2,.9,.3,1.5) both`.
**Padrão: `sendTo = 'marina'`.**

### 2. Valor
Input centralizado (largura 150, alinhado à direita, sem borda/fundo, 700 48px, letter-spacing −0.05em, tabular-nums) + "LUNES" 16/600 `--ink2`, baseline, gap 8, padding 10/0/2.
**Valor inicial: `"5"`.** Aceita só `[0-9,.]`; vírgula = decimal.

### 3. Valores pré-definidos (OBRIGATÓRIO)
Chips **1 · 5 · 10 · 25**, centralizados, gap 6. Altura 30, min-width 48, padding 0 12, raio 15, 600 13px.
Chip cujo número == valor atual: fundo `--ink`, texto `--invink`; demais: fundo `--bg2`, texto `--ink`. Clique define o valor (`sendAmt = "25"`). `:active` scale(.92). Transição `background .2s, color .2s, transform .2s`.

### 4. Resumo (grid 2 colunas)
Fundo `--bg2`, raio 16, padding 13/15, gap 9/14, 13px; rótulo `--ink2`, valor à direita 550.
- Para → nome completo do selecionado
- Disponível → saldo formatado + " LUNES" (`••••` se saldo oculto)
- Taxa → `0,01 LUNES`
- Liquidação → `quando a malha alcançar a Mainnet`

### 5. Validação e botão
- `amt = parseFloat(valor.replace(',', '.')) || 0`; `ok = amt > 0 && amt <= saldo`.
- Se `amt > saldo`: texto "Valor maior que o saldo disponível" 12.5/550 centralizado, `piuUp .3s`.
- Botão "Enviar agora" (ícone `north_east`): altura 50, raio 25, fundo `--ink`, 600 15px, **opacity 1 se ok, 0.35 se não** (transição .2s). Clique só age se ok.

## ENVIAR — sucesso (`sendDone=true`)
Ao confirmar: adiciona `{to: nomeCompleto, amt, status:'na malha'}` no topo de `sent`; após **50ms** o saldo conta do valor anterior até o novo (`startBal(prev)`: 1100ms, easing `1-(1-p)^4`); após **2600ms** o status da linha vira vazio (selo some).
- Ícone 96×96: 2 anéis `piuRingL 1.2s ease-out` (segundo com atraso .2s, borda 2px `--ink`) + **14 partículas** 8px (`piuBurst .9s cubic-bezier(.1,.8,.3,1)`; ângulo i/14·2π, raio 80+(i%3)·22 px, atraso (i%4)·0.03s) + disco `--ink` com `north_east` 44px em `piuPop .55s cubic-bezier(.2,.9,.3,1.5)`.
- Texto (`piuUp .4s .2s`): "**5,00 LUNES para Marina Alves**" 18/700 + "Assinado e enviado pela malha. Liquida quando um nó alcançar a Mainnet." 13px `--ink2`.
- Botões (`piuUp .4s .3s`): "Enviar outro" (fundo `--bg2`, volta ao formulário com mesmo destinatário/valor) · "Pronto" (fundo `--ink`, fecha). Altura 44, raio 22.
- Movimentações: nova linha "Enviado para Marina Alves · agora · −5,00" com selo pulsante "na malha", entra com `piuMsgIn .45s cubic-bezier(.2,.9,.3,1.3)`.

## RECEBER (QR OBRIGATÓRIO)
Coluna centralizada, gap 14.
1. **Cartão do QR**: fundo **#fff sempre** (também no escuro), padding 14, raio 20, `box-shadow:0 0 0 1px var(--line2)`, `piuPop .55s cubic-bezier(.2,.9,.3,1.25) both`.
2. **Grade 29×29 em 190×190px** (`display:grid; grid-template-columns:repeat(29,minmax(0,1fr))`). Módulos ligados `#0c0c0c`; raio 1px nos 3 localizadores, 2px no resto.
3. **Nascimento em onda do centro**: cada módulo ligado anima `piuQr .35s {d}ms cubic-bezier(.2,.9,.3,1.5) both`, `d = round(hypot(r−14, c−14) · 28)` ms (centro 0ms, cantos ~550ms). `@keyframes piuQr{from{transform:scale(0);opacity:0}to{transform:none;opacity:1}}`.
4. Localizadores 7×7 nos cantos sup-esq, sup-dir, inf-esq (anel externo + núcleo 3×3), com 1 módulo de margem vazia. **Centro 7×7 (linhas/colunas 11–17) vazio** para o ícone.
5. **Ícone Piu central**: caixa branca 44×44 raio 11 padding 4, centrada; dentro `brand/icon-192.png` 36×36 raio 8.
6. Endereço (clicável → toast "Endereço copiado", ícone `content_copy`): largura 100%, altura 42, raio 12, fundo `--bg2`, Geist Mono 500 13px, texto `lunes:7f3a91c2…a912c19e` + ícone `content_copy` 16px.
7. Nota 12.5px `--ink2`, centralizada, line-height 1.45: "Funciona sem internet: o pagamento fica registrado e liquida quando a malha alcançar a Mainnet."

Em produção o QR deve codificar o endereço real (`lunes:<endereço>` ou URI de pagamento) com uma lib QR (versão 3 = 29×29, correção H para suportar o ícone). **Mantenha o mesmo visual**: grade 29×29, módulos com raio 2px, onda do centro, ícone no meio. O gerador pseudoaleatório em `reference-code/desktop-wallet.js` é só para o protótipo/visual.

## Saldo e formatação
- Saldo = `58,40 − soma(sent)`. Formato pt-BR: `n.toFixed(2)` com vírgula decimal e ponto de milhar.
- Fiat: `≈ R$ ` + saldo·0,42. Bloqueado: `+ 60,00 a liberar · bônus em validação`.
- Saldo oculto (preferência `piu.hideBal`, sincronizada com o celular): `••••••`, Disponível `••••`.
- Ao entrar na Carteira o saldo conta de 0 até o valor em 1100ms (`1-(1-p)^4`).

## Checklist antes de dar como pronto
- [ ] Painel aparece na coluna direita, acima de Créditos de rede, com `piuSide`.
- [ ] 4 avatares; Marina pré-selecionada; selecionado escala 1.08.
- [ ] Valor inicial 5; chips 1/5/10/25 presentes e o ativo invertido.
- [ ] Resumo com 4 linhas e taxa 0,01.
- [ ] Erro e botão 35% quando valor > saldo.
- [ ] Sucesso com anéis, 14 partículas, saldo contando e linha "na malha" que some após 2,6s.
- [ ] Receber com QR 29×29 em cartão branco, onda do centro, ícone Piu, endereço copiável.
- [ ] Tudo igual aos 9 PNG de `reference/desktop/wallet_send_receive/`, claro e escuro.
- [ ] `prefers-reduced-motion` e ajuste "Animações" desligam as animações (estado final direto).
