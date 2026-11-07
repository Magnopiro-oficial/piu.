# Central de Ajuda: análise do protótipo × o que existe hoje

Data: 07/11/2026. Páginas: `/ajuda/` (PT) e `/en/help/` (EN), uma página por guia (`/ajuda/<guia>/`, `/en/help/<guide>/`).

- **Fonte visual:** `design/handoff/design/PiuAjuda.dc.html`, com `piu-ajuda-dados.js` e `piu-ajuda-antenas.js` (entrega de 06/11).
- **Implementação:**
  - `apps/site/src/components/AjudaPage.astro`
  - `apps/site/src/components/AjudaScreen.astro`
  - `apps/site/src/styles/ajuda.css`
- **Textos:** `apps/site/src/i18n/ajuda.pt.ts` e `ajuda.en.ts`.

O protótipo foi tratado como **design, não como fonte de verdade**. Cada passo foi conferido no código, nos docs e em `apps/site/src/lib/releases.json`. Tudo o que não existe saiu ou foi reescrito. Este arquivo lista o que foi conferido (arquivo:linha), o que mudou e por quê, e o que ainda depende de engenharia.

Legenda de estado, a mesma da página "A rede":

| Estado | Significado |
|---|---|
| **JÁ FUNCIONA** | Está no app ou pacote publicado. |
| **EM TESTE** | O código existe, mas não foi validado em campo ou não está nos downloads. |
| **A CAMINHO** | Não existe. Nenhum guia ficou com esse estado. |

## 1. Mudanças gerais em relação ao protótipo

| Protótipo | Site | Por quê |
|---|---|---|
| Rotas por hash (`#ajuda/<guia>/<n>`), dados carregados por `<script>` em tempo de execução | Uma página estática por guia, com âncora por passo (`#passo-N` / `#step-N`) | Funciona sem JS. Respeita a CSP estrita (`script-src 'self'`). Cada guia tem URL própria e canônica, com `hreflang` para o mesmo guia no outro idioma. |
| Bloco técnico abre com botão React | `<details>` nativo; o botão Copiar só aparece com JS | Funciona sem JS e com leitor de tela. O Copiar leva só os comandos e ignora as linhas que começam com `#`, como no protótipo. |
| — | Botão "Copiar link deste passo" | Pedido de validação. Usa a área de transferência; sem permissão, mostra o endereço num aviso. |
| "Marcar como feito" | Igual, salvo em `localStorage['piu-ajuda-feito']` | Mesma chave e formato do protótipo. Fica no navegador e não sai do aparelho. |
| Sem selo de estado | Selo JÁ FUNCIONA / EM TESTE em cada cartão e guia | Deixa explícito o que ainda está em teste. |
| Sem aviso de estimativa | Caixa "Estimativas" nos guias de antena, com as fontes da Anatel | O designer avisou que alcances, medidas e cálculos são estimativas dele. |
| Downloads com nomes e versões fixos | Botões gerados de `releases.json` via `androidRelease.ts` e `desktopRelease.ts` | Sem versão inventada. Sem release publicado, o botão vira "em breve" e fica sem link. |
| Mini telas com valores de exemplo (nomes, códigos, palavras) | Nomes de telas e botões reais do app. Valores neutros (`—`, `•••`, `········`, "Seu nome"), ou o padrão real do app | Regra "sem dados fictícios apresentados como reais". Cada tela tem a legenda "Ilustração da tela. Os nomes são os do app; os valores são exemplos." |
| Animação `ajPing` nos itens destacados | Mantida | Com "reduzir movimento", a animação fica parada (`ajuda.css`, fim do arquivo; `site.css:54`). |
| Populares: android, share, openwrt, ant-groundplane, recovery | android, share, recovery, desktop, openwrt | A antena caseira é para o LoRa, que ainda está em teste. O Piu Desktop já tem release. |

Outras mudanças no site, pedidas pelos dois arquivos de design (`Piu Site.dc.html` e `Piu Site EN.dc.html`):

- **Menu da home:** link "Ajuda"/"Help" depois de Dúvidas/FAQ (`SitePage.astro:36`). Também entrou na coluna PRODUTO/PRODUCT do rodapé (`i18n/pt.ts`, `i18n/en.ts`).
- **Subnavegação da página "A rede":** ganhou "O meio certo" (`#caminho`) e "Celular + computador" (`#computador`), na ordem do design (`i18n/rede.pt.ts:48`, `rede.en.ts:9`). As duas seções já existiam (`RedePage.astro:257`, `:357`). O texto da rede no design é igual ao atual; nada mais mudou.

## 2. Guia a guia

Formato: **id** · título · estado no site. "Protótipo dizia" lista só o que estava errado ou não existe.

### Começar

**android** · Instalar o Piu no Android · JÁ FUNCIONA
- Conferido: `releases.json` (`android`: `Piu-0.1.1.apk`, 36.961.806 bytes, SHA-256 e certificado) via `src/lib/androidRelease.ts`; notas do release (Android 7+, 64 bits); onboarding "Criar identidade" → "Como você quer aparecer?" (`apps/mobile/src/i18n/pt-BR.ts:427`) → "Gerar minhas chaves" → "Suas chaves estão prontas." → "Entrar no Piu".
- Protótipo dizia: Android 9+, 38 MB, `Piu-0.1.4.apk`, certificado "4C9A 7B21…" (inventado), "Abra e escolha um nome" e "O app mostra 12 palavras" no onboarding.
- Mudou: versão, tamanho, hashes e certificado vêm de `releases.json`; requisito Android 7+ 64 bits; tela "Como você quer aparecer?" (pública/anônima); a frase não aparece no onboarding, então o passo 5 manda para Perfil → Backup cifrado das chaves.

**receive** · Receber o app de um amigo, sem internet · JÁ FUNCIONA
- Conferido: Perfil → Convidar para o Piu → "Está longe ou ainda não tem" (`pt-BR.ts:465`) → "A pessoa ainda não tem o Piu?" (`pt-BR.ts:474`) com Wi-Fi Direct ou Bluetooth; página local `192.168.49.1:8765` (`apps/mobile/src/lib/__tests__/wifiShare.test.ts:11`), janela de 10 min; cartão "Conferir o instalador" (`apps/mobile/src/ui/ApkIntegrityCard.tsx:29`).
- Protótipo dizia: "Perfil → Convidar → Ainda não tem"; rede "Piu-Convite" + 4 letras; porta 8080; "Confira o código" comparando um código entre os dois celulares.
- Mudou: nomes reais dos botões e dos passos ("1 · No celular dela, entre nesta rede", "2 · Ela abre a página e baixa o Piu"); porta 8765; a conferência é pelo "Certificado (SHA-256)" do cartão "Conferir o instalador".

**share** · Passar o app para outra pessoa · JÁ FUNCIONA
- Conferido: os mesmos de `receive`, mais o código de 4 palavras do convite ("Confiram este código").
- Protótipo dizia: "toque na sua foto e depois em Convidar", "Ainda não tem" / "Já tem o Piu", Android 9+, e que no iPhone "o Piu só pode vir pela App Store".
- Mudou: caminho real (Perfil → Convidar para o Piu → "Está longe ou ainda não tem" / "Sim, já tem"); escolha Wi-Fi Direct ou Bluetooth; o aviso do iPhone passou a dizer que o Piu ainda não está na App Store (só há app Android).

**recovery** · Guardar as 12 palavras e recuperar a conta · JÁ FUNCIONA
- Conferido: "Mostrar a frase" (`apps/mobile/src/app/backup.tsx:219`) com biometria/PIN (sem bloqueio de tela, recusa); "Confirme 3 palavras" (`pt-BR.ts:975`, 3 posições × 3 opções, sem limite de tentativas); "Onde guardar a cópia cifrada?" (`pt-BR.ts:984`); "Com a frase de 12 palavras" (`pt-BR.ts:1010`) traz chaves e carteira; "Confirme a sua frase de novo" (`apps/mobile/src/ui/NodeViews.tsx:374`).
- Protótipo dizia: "Ajustes → Segurança → Frase de recuperação" (não existe); "Errou 3 vezes? As posições mudam"; recuperação por "Já tenho uma conta"; "Suas conversas voltam quando os contatos estiverem por perto".
- Mudou: caminho Perfil → Backup cifrado das chaves; passo novo da cópia cifrada; recuperação por "Restaurar de outro aparelho" → "Com a frase de 12 palavras"; deixa claro que o histórico só volta com o arquivo de backup ou de outro aparelho seu.

### Ajudar a rede

**phone-node** · Ajudar a rede com o seu celular (modo nó) · JÁ FUNCIONA (passos 1–4); passo 5 descreve o programa fechado
- Conferido: interruptor "Modo nó" (ligado por padrão); "LIMITES DO NÓ" (`pt-BR.ts:93`): "Parar abaixo de" 20/30/50% e "Espaço para terceiros" 256 MB/512 MB/1 GB (`pt-BR.ts:96`); "Tráfego de terceiros por dia" 50/200/500 MB (`pt-BR.ts:311`); "Prazo máximo" 24 h/48 h/7 dias (`pt-BR.ts:281`). Programa (`apps/mobile/src/lib/phoneNodeCore.ts`): caução 100 (`:38`), `BOND_ADDRESS = null` (`:44`), 7 dias (`:46`), 3 avais (`:47`), 5/mês (`:48`), aval 90 dias (`:50`), pedido 3 dias (`:52`), 7 dias seguidos (`:54`), devolução 7 dias (`:56`), 1 GB livre (`:62`), `REWARDS_ON = false` (`:64`). Tela "Este celular vira um nó." (`apps/mobile/src/i18n/piu11/pt-BR.ts:30`) e requisito "endereço da caução não publicado" (`pt-BR.ts:1875`).
- Protótipo dizia: "Ajustes → Modo nó"; caução de **10 LUNES**; **2 avais**; 2 GB e mensagens por até **14 dias**; "segure para pagar" e virar nó em 7 dias.
- Mudou: guia passou a ser sobre o que já funciona (retransmitir com limites) e um aviso no topo de que o programa de caução **não abriu**, o endereço não foi publicado e as recompensas estão desligadas; valores corrigidos para 100 LUNES, 3 avais, até 1 GB e no máximo 7 dias.

**point** · Criar um Ponto Piu com o Wi-Fi de um lugar · EM TESTE
- Conferido: Rede → PONTOS PIU → "Criar ponto Piu" (`apps/mobile/src/transport/lan/lanCheck.ts:2`) → "Em qual rede?" → "Testar esta rede" (`apps/mobile/src/i18n/pontos/pt-BR.ts:70`); quatro verificações e verde/amarelo/vermelho (`pontos/pt-BR.ts:108`); Multiplicador / Guardião / Guardião + app / Gateway (guardião até 1 GB e até 7 dias, padrão 512 MB · 7 dias); "Ativar ponto" (`apps/mobile/src/lib/pointCore.ts:7`); Cartaz → PDF; "Entrar no ponto" (`pontos/pt-BR.ts:239`, Android 10+); hotspot Android 8+; descoberta UDP 8423 e mDNS `_piu._udp`; LNNP v1 em 8422/TCP.
- Protótipo dizia: "Ajustes → Pontos Piu"; lista de Wi-Fi por perto para escolher; para o vermelho, "ligar o isolamento de clientes"; mDNS `_piu._tcp`; "se a rede cair, o ponto pausa sozinho".
- Mudou: caminho real; o Piu usa a rede em que o celular já está; **o conselho do isolamento estava invertido** (com isolamento ligado os celulares não se enxergam; o amarelo do app pede para desligar); `_piu._udp`; o ponto volta sozinho. Estado EM TESTE porque o código não está na tag `android-v0.1.1` (seção 4).

### Equipamentos

**openwrt** · Montar um Piu Node no roteador OpenWrt · EM TESTE
- Conferido: `packaging/openwrt/README.md:3` (128 MB+), `:23–25` (23.05 não inicia; 24.10 recomendado; 25.12 usa `.apk`), `:32` (arquiteturas com FPU), `:35` (128 MB mínimo, 256 confortável); `files/piu-node.init:35–52` (UCI → `PIU_*`) e `:149–168` (`main.host` → `PIU_NODE_HOSTS`); `files/piu-node.config:42–49` (`broadcast`, `peer`, `memory_mb` 16); `apps/piu-node/src/config.ts:109–110` (porta 8420, hosts padrão); painel "Parear este navegador" (`apps/provider-panel/src/i18n/pt-BR.ts:227`) e "Acesso a este painel" → "Parear celular" (`:163`).
- Protótipo dizia: OpenWrt 23.05+; "Baixar → Piu Node" neste site; `piu-node_0.4.2_aarch64.ipk`; upload por Sistema → Software; "o pacote confere a própria assinatura"; `http://piu-node.local:8420`; `piu-node pair`; "Ajustes → Provider → Adicionar equipamento"; malha 802.11s.
- Mudou: 24.10; pacote real `piu-node_0.1.0-1_all.ipk` (só artifact do CI ou build); instalação por `scp -O` + `opkg`; código de pareamento em `/etc/piu-node/pairing-code`; painel em `https://<IP>:8420` com conferência da impressão digital; caminho real do celular; saíram assinatura do pacote, `piu-node pair` e 802.11s (não existem).

**linux** · Piu Node no computador ou no Raspberry Pi · JÁ FUNCIONA (Piu Provider); Raspberry Pi só a partir do código
- Conferido: `releases.json` (`provider` 0.1.1: mac arm64/x64, win, AppImage, deb, SHA256SUMS); menu "Nó → Permitir acesso pela rede local" (`apps/provider-desktop/src/main.ts:6`); `apps/piu-node/src/config.ts` (variáveis `PIU_*`).
- Protótipo dizia: imagem `piu-node-0.4.2-rpi.img.xz`, `.deb` arm64/amd64, `/etc/piu-node/config.toml`, `journalctl -u piu-node`, `piu-node status`, `piu-node pair`.
- Mudou: **nada disso existe**. O guia oferece o Piu Provider e, no Raspberry Pi, rodar a partir do código (Node 20.19+). O menu do Provider só existe em PT; o guia EN avisa.

**lora** · Ligar um rádio LoRa ao Piu Node · EM TESTE
- Conferido: `apps/piu-node/src/config.ts:51,73` (`PIU_SERIAL`, formato `lora:<porta>@<baud>`), `:83` (SF 9), `:86` (ciclo 10%), `:87` (envelope 1536); modem KISS em `apps/piu-node/README.md:26–29`; UCI `serial.*` lido por `piu-node.init:45–52`.
- Protótipo dizia: `piu-node radio list`, `piu-node radio enable lora0 --region BR915`; o painel acha o rádio sozinho ("Rádio LoRa encontrado"); ativar pelo celular em Conexões; teste de alcance; "o Piu respeita o limite".
- Mudou: **`piu-node radio …` não existe** (o piu-node não tem subcomandos). A configuração passou a ser por UCI ou variáveis; não há tela de rádio nem teste de alcance; frequência e potência ficam no firmware do rádio. Aviso de que só foi testado com simulador.

### Antenas

Todos com a caixa "Estimativas" e fontes da Anatel (seção 5).

**ant-basics** · Antes de montar · JÁ FUNCIONA (informativo)
- Protótipo dizia: "Informe ao Piu o ganho da antena e a perda do cabo: ele ajusta a potência do rádio sozinho"; tela "Calculadora de enlace"; perda de cabo só em 915 MHz.
- Mudou: o Piu não ajusta potência e não há calculadora; o passo do limite legal foi reescrito com o texto da Anatel (2,4 GHz, 5 GHz e 902–928 MHz); Fresnel e perdas também para 2,4/5,8 GHz, marcados como estimativa.

**ant-groundplane** · Antena caseira de ¼ de onda para 915 MHz · EM TESTE (depende do LoRa)
- Protótipo dizia: "Ligue e teste no Piu… informe o ganho… e rode o teste de alcance".
- Mudou: o último passo manda para o guia do LoRa e explica que 2 dBi fica abaixo de 6 dBi (sem redução de potência). Medidas (82/88 mm) mantidas como ponto de partida.

**ant-tuning** · Medir e ajustar com NanoVNA · JÁ FUNCIONA (informativo)
- Mudou pouco: a varredura passou a ser "em torno da frequência da antena" e o requisito avisa que o H4 vai até ~1,5 GHz (para 2,4 GHz, um modelo como o V2).

**ant-wifi** · Wi-Fi externo para praça ou rua · EM TESTE
- Protótipo dizia: rede com `isolate='1'` ("os celulares só se enxergam pelo Piu Node"); medir em "Ajustes → Diagnóstico" com dBm.
- Mudou: **`isolate='0'`** (com isolamento ligado o Piu não funciona entre celulares, e o teste do Ponto Piu dá amarelo); rede separada, sem saída para a wan, seguindo o guia oficial do OpenWrt; regras só para 8422/TCP e 8423/UDP; broadcast na sub-rede "a confirmar"; o teste é o do Ponto Piu (o app não mostra dBm).

**ant-roof** · Antena externa no telhado · JÁ FUNCIONA (informativo)
- Protótipo dizia: antena 915 MHz; `piu-node radio enable lora0 --antenna-gain 6 --cable-loss 0.3`; "informe ao Piu … a potência é ajustada".
- Mudou: serve para Wi-Fi externo e LoRa; o comando saiu; a potência se ajusta no equipamento.

**ant-link** (no protótipo, `ant-yagi`) · Enlace Wi-Fi ponto a ponto · EM TESTE
- Protótipo dizia: Yagi LoRa 915 MHz entre bairros; "teste de alinhamento no Piu"; `piu-node radio align lora0 --peer …`.
- Mudou: nem o alinhamento nem o comando existem. O guia passou a ser um enlace de 5 GHz com rádios comerciais em ponte, alinhados pelo medidor do fabricante; a única parte do Piu é o vizinho fixo `lnnp.peer` / `PIU_LNNP_PEERS` (`piu-node.config:44`, `config.ts:99`). Na faixa 5725–5850 MHz o ponto a ponto fixo não tem redução de potência conduzida (Anatel, item 10.5.2).

### Computador

**desktop** · Piu Desktop no Mac, no Windows e no Linux · JÁ FUNCIONA
- Conferido: `releases.json` (`desktop`, **hoje 0.1.1**; o pedido falava em 0.1.0, mas o JSON foi atualizado no commit `131f4e6` e o site o segue); primeira tela "Suas conversas, agora no computador." com 3 opções; QR renovado a cada 30 s; celular Perfil → "Conectar ao computador" → "Ler o QR do computador" (`apps/mobile/src/app/link-desktop.tsx:45`); computador mostra 2 palavras + 4 opções (`apps/desktop/src/main/desktopLink.ts:40`, `CONFIRM_OPTIONS`). Mac sem notarização: macOS 15+ Ajustes → Privacidade e Segurança → Abrir mesmo assim; 14 ou anterior, botão direito → Abrir. Windows: SmartScreen → Mais informações → Executar assim mesmo.
- Protótipo dizia: só Mac e Linux; 0.1.4; `brew install --cask piu`; `flatpak install …`; "Parear com o celular"; Perfil → Aparelhos conectados → Conectar; "escolha a terceira palavra".
- Mudou: Windows incluído; downloads do release (Apple Silicon, Intel, Windows, AppImage); Homebrew e Flatpak saíram (não existem); nomes reais dos botões; escolhe-se a **última** palavra mostrada no celular. A tela do celular só existe em PT; o guia EN cita os rótulos em PT.

### Problemas

**troubleshoot** · Resolver problemas comuns · 12 itens
- Conferido: TTL padrão 48 h (`apps/mobile/src/messaging/messenger.ts:345`), máximo 7 dias (`apps/mobile/src/protocol/envelope.ts:22`); 421 por `PIU_NODE_HOSTS` (`config.ts:110`); código de pareamento (10 min, uso único, 5 erros apagam); "Revogar aparelho perdido" (`pt-BR.ts:892`).
- Protótipo dizia: mensagem "aguardando"; `piu-node status`; Ponto vermelho → "ligar isolamento de clientes"; transferência de LUNES viajando pela malha "por horas ou dias"; "Perfil → Aparelhos conectados".
- Mudou: "na fila", com validade de 48 h (máx. 7 dias); comandos reais (`/etc/init.d/piu-node status`, `logread`); isolamento corrigido; envio de LUNES hoje exige internet (malha em teste); itens novos sobre código de pareamento, Mac/Windows sem assinatura e "Confirme a sua frase de novo".

## 3. O que depende de engenharia

1. **Programa de caução do modo nó:** publicar o `BOND_ADDRESS` (`phoneNodeCore.ts:44`) e decidir as recompensas (`:64`). Até lá, o guia diz que o programa não abriu.
2. **`.ipk` do OpenWrt nos downloads:** publicar o pacote num release e incluí-lo em `releases.json`; hoje é só artifact do CI. Falta validar num roteador real (RAM com o Node do feed, arquiteturas).
3. **LoRa:**
   - teste com placa real;
   - tela de rádio no painel, que hoje é só UCI/variáveis;
   - corrigir `packaging/openwrt/files/piu-node.config:66–70`. O exemplo usa `option device '/dev/ttyUSB0'`, mas o parser exige `lora:/dev/ttyUSB0@115200`, e o comentário "Descomente quando o piu-node suportar" está desatualizado.
4. **`piu-node.local`:** anunciar por mDNS no OpenWrt, ou deixar de citar o nome como padrão.
5. **Raspberry Pi / Linux headless:** não há `.deb` do piu-node, unidade systemd nem imagem. O guia ensina a rodar a partir do código.
6. **Tela "Conectar ao computador" do celular sem tradução:** `apps/mobile/src/app/link-desktop.tsx` tem os textos fixos em PT. O mesmo vale para o menu "Nó" do Piu Provider (`apps/provider-desktop/src/main.ts:6`).
7. **Broadcast em redes novas (guia ant-wifi):** confirmar se a descoberta UDP 8423 funciona com `broadcast` da sub-rede.
8. **Carteira pela malha:** está em teste; hoje o envio exige internet.

## 4. Inconsistências encontradas

- **Tag `android-v0.1.1` × notas do release.** A tag aponta para `b4e5692`, que não tem o código de Pontos Piu, modo nó, LAN do celular nem "Conectar ao computador" (e tem `app.json` 0.1.0). As notas do release listam esses recursos.
  - Por isso, Pontos Piu ficou **EM TESTE**.
  - Os demais guias descrevem o código atual, que pode diferir do APK 0.1.1 publicado. Conferir quando sair o próximo APK.
- **Página "A rede" × notas do release.** A página marca Pontos Piu como "A CAMINHO" e diz que a LAN do celular está "a caminho", enquanto as notas dizem que estão no 0.1.1. Não alterei: o texto da rede segue o design e `docs/rede`, que está em edição.
- **Texto do provider no app.** O `provIntro` do app móvel (`apps/mobile/src/i18n/pt-BR.ts:1461` em diante) promete LUNES por entrega, com as recompensas desligadas.
- **`docs/economia/no-celular.md:98`** diz `minEndorsements` (2); a tabela do mesmo arquivo (`:127`) e o código (`phoneNodeCore.ts:47`) dizem 3.
- **`apps/piu-node/README.md:224`** ("Próximos passos") ainda lista o LoRa por USB como futuro, mas ele já existe em modo experimental (`README.md:26–29`).

## 5. Anatel (fontes)

- **Como foi lido:** o portal da Anatel estava em manutenção durante a conferência. O texto consolidado foi lido nas capturas do Wayback Machine de 04/10/2026:
  - `web.archive.org/web/20261004190157/…` (Ato 14.448)
  - `…/20251130041512/…` (Ato 14.158)
  - `…/20261003170813/…` (Res. 680)
- **Normas:**
  - [Resolução nº 680/2017](https://informacoes.anatel.gov.br/legislacao/resolucoes/2017/936-resolucao-680): regulamento de radiação restrita, em vigor; o antigo art. 9º foi revogado.
  - [Ato nº 14.448/2017](https://informacoes.anatel.gov.br/legislacao/atos-de-certificacao-de-produtos/2017/1139-ato-14448), Anexo I: requisitos técnicos.
  - [Ato nº 14.158/2025](https://informacoes.anatel.gov.br/legislacao/atos-de-certificacao-de-produtos/2025/2070-ato-14158): altera o Ato 14.448; obrigatório desde 06/04/2026.

Limites usados nos guias:

| Faixa | Limite |
|---|---|
| 902–907,5 e 915–928 MHz | 1 W de pico (digital). Salto de frequência: 1 W com ≥ 35 canais; 0,25 W com menos. Antena > 6 dBi reduz 1:1. |
| 2400–2483,5 MHz | 1 W de pico. Antena > 6 dBi reduz 1:1; ponto a ponto fixo reduz 1 dB a cada 3 dB (item 10.5.1). |
| 5725–5850 MHz | 1 W. Ponto a ponto fixo sem redução da potência conduzida (item 10.5.2); não vale para ponto-multiponto nem omni. |
| 5150–5250 MHz | Ponto de acesso até 30 dBm e 17 dBm/MHz. Ao ar livre, e.i.r.p. ≤ 21 dBm acima de 30° de elevação. |
| 5250–5350 e 5470–5725 MHz | min(24 dBm, 11 + 10 log B), 11 dBm/MHz; DFS e TPC obrigatórios. |

Alcances, perdas de cabo, medidas de antena e o orçamento de enlace são **estimativas** (do designer, revisadas aqui), não medições do projeto. Os guias dizem isso.

## 6. O que NÃO está pronto

- Nenhum guia foi testado ponta a ponta num aparelho real nesta tarefa. A conferência foi no código, nos docs e nos releases.
- Os textos EN de telas que só existem em PT estão indicados como tal.
- As capturas da Anatel são de 04/10/2026. Vale reconferir no portal quando ele voltar.
