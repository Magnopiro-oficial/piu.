# Teste manual — rede local (Wi-Fi) no celular (fase 1)

Aparelhos: Galaxy A31 (APK de release com o módulo `piu-lan`) + Piu Desktop, os dois no **mesmo roteador**.
Referência: `docs/rede/pontos-piu-roteadores.md` (fase 1), código em `apps/mobile/src/transport/lan/` e
`apps/mobile/modules/piu-lan/`.

## Preparação
- [ ] Desktop com a rede local ligada (tela Rede mostra a porta, padrão 8422/TCP e 8423/UDP).
- [ ] Firewall do computador liberando 8422/TCP e 8423/UDP na rede privada.
- [ ] No A31: aba Rede → linha **Wi-Fi Mesh** ligada (de fábrica). Bluetooth LE e Wi-Fi Direct como estiverem.
- [ ] `adb logcat | grep -i "piu-lan\|LAN:"` aberto para ver erros.

## 1. Descoberta e enlace (roteador com internet)
- [ ] Em até ~10 s o Desktop aparece como vizinho no celular (meio "Wi-Fi local") e o celular aparece na tela Rede do Desktop.
- [ ] Mensagem celular → contato que está no Desktop chega; resposta volta.
- [ ] Foto/arquivo de alguns MB vai pela rede local (rota da mensagem mostra "Wi-Fi local"), visivelmente mais rápido que por Bluetooth.
- [ ] Desligar Bluetooth e Wi-Fi Direct na aba Rede: o vizinho do Desktop continua e as mensagens seguem.
- [ ] Desligar **Wi-Fi Mesh**: o vizinho do Desktop some em poucos segundos; Bluetooth/Nearby seguem como antes.

## 2. Roteador SEM internet (tirar o cabo da WAN)
- [ ] O Android pode avisar "sem internet": continuar conectado. O vizinho do Desktop continua/reaparece.
- [ ] Mensagens e arquivos seguem entre celular e Desktop.

## 3. Dados móveis / troca de rede
- [ ] Desligar o Wi-Fi do celular (só dados móveis): a rede local desliga sozinha (nada escutando no IP dos dados).
- [ ] Religar o Wi-Fi: a rede local volta e reencontra o Desktop sem abrir o app de novo.
- [ ] Trocar para outra rede Wi-Fi: religa na rede nova (IP novo).

## 4. Dois celulares + Desktop (se houver um segundo Android)
- [ ] Os dois celulares se veem pela rede local e pelo Bluetooth como **um vizinho só** (sem duplicar na lista).
- [ ] Ponte: celular B só com Bluetooth (Wi-Fi desligado), perto do A; A no Wi-Fi com o Desktop. Mensagem do Desktop para B chega via A.

## 5. Segundo plano e bateria
- [ ] Modo nó ligado + "Retransmitir em segundo plano": app em segundo plano com o aviso fixo; mensagem do Desktop chega em até 1 min.
- [ ] Tela desligada por 10 min (Doze): a mensagem ainda chega (pode atrasar). Anotar o atraso.
- [ ] Bateria abaixo do limite (ou modo de economia) fora da tomada: enlace continua, anúncio fica a cada 30 s (logcat), sem varredura.

## 6. Descoberta em camadas
- [ ] Roteador com "isolamento de AP/clientes" ligado (rede de visitante): o celular **não** vê o Desktop. (Esperado.)
- [ ] Se o roteador bloquear broadcast mas não mDNS: vizinho aparece pelo mDNS (`_piu._udp`).
- [ ] Sem broadcast nem mDNS: depois de ~3 min sem ninguém, a varredura da /24 (porta 8422) acha o Desktop (logcat "varrendo").

## 7. Compatibilidade (API `runLanCheck`, sem tela ainda)
Pelo console de desenvolvimento ou um botão temporário de debug: `useLanTransport().runLanCheck({ knownPeer: '<IP do Desktop>:8422' })`.
- [ ] Rede de casa normal: `verdict` amarelo com `routerAdminReachable` (e `internet` se houver).
- [ ] Rede de visitante isolada: `isolation: 'suspected'`, vermelho.
- [ ] Nada além de conexões TCP abre/fecha nos testes (conferir no Wireshark se quiser: só SYN/SYN-ACK/RST ou FIN, sem dados).

## 8. Regressão
- [ ] Bluetooth LE celular ↔ iPhone continua igual.
- [ ] Nearby/Wi-Fi Direct celular ↔ celular continua igual.
- [ ] Envio do app por Wi-Fi Direct (piu-app-share) continua igual.

Anotar para cada item: ok / falhou + o que apareceu no logcat.

## 9. Pontos Piu (fase 2 — telas P1–P9)
Pré-requisito: build Android com os módulos piu-lan e piu-app-share atualizados (hotspot, varredura, entrar na rede, página do ponto).

**P1 · Wi-Fi local em Rede**
- [ ] No Wi-Fi: linha "Wi-Fi local" mostra "Ligado · <rede> · N aparelhos Piu" (nome só se o Android mostrar; no 13+ sem localização aparece sem nome).
- [ ] Sem Wi-Fi (dados móveis): "Parado · o celular não está num Wi-Fi" (P1a).
- [ ] Bateria abaixo do limite fora da tomada: "Econômico · bateria baixa" (P1b; o LAN segue ligado, só anuncia devagar).
- [ ] Rede de visitante com isolamento de clientes, depois de um teste P4 que suspeite isolamento: "Parado · este roteador…" + "Por quê?" (P1c).

**P3 · rede**
- [ ] Redes por perto aparecem (13+: só com "dispositivos Wi-Fi por perto"; 12-: localização precisa + localização do aparelho ligada). Negar a permissão: aviso "Sem permissão…", o resto da tela funciona.
- [ ] "Criar a rede neste celular" (LocalOnlyHotspot): o Android cria a rede; anotar nome/senha gerados, modelo e versão. Com o roteador do celular (tethering) ligado: erro "hotspot já está ligado".
- [ ] Com o hotspot ligado, o LAN do Piu passa a usar a interface dele (logcat: servidor TCP no IP do hotspot, 192.168.x.1). Outro celular entra no hotspot pelo QR e os dois se veem pelo Wi-Fi local.
- [ ] Hotspot com o celular também conectado a um Wi-Fi (STA+AP): anotar se o aparelho permite e qual rede o LAN usa.

**P4 · teste**
- [ ] Rede marcada "de visitante/só do ponto" num roteador separado: verde (ou amarelo só por "nenhum aparelho respondeu" se não houver outro celular com Piu).
- [ ] Rede principal da casa (chave desmarcada): vermelho, sem "Continuar" (P4c).
- [ ] Rede de visitante que alcança o roteador da casa (192.168.0.1/1.1 etc. respondem): vermelho.
- [ ] Página do roteador abrindo a partir da rede: amarelo com instrução, "Continuar assim" funciona.

**P5–P6 · ativar**
- [ ] Guardião: o painel mostra o espaço configurado; Ajustes de armazenamento do modo nó não diminuem (o ponto só aumenta os limites).
- [ ] QR de Wi-Fi: a câmera de outro Android e de um iPhone entra na rede (com senha digitada, sem senha numa rede aberta, e com nome acentuado "Piu · Praça").
- [ ] Compartilhar / Cartaz: a folha do sistema abre o PDF A4; imprimir pelo sistema; o QR impresso funciona na câmera.
- [ ] Nível "Guardião + app": de outro celular sem o Piu, conectado à rede do ponto, abrir `http://<IP do ponto>:8766/` (endereço no painel e no cartaz) e baixar o APK; conferir SHA-256 com o site. (piu.local NÃO resolve: o Android não publica nome mDNS de host.)
- [ ] O envio do app por Wi-Fi Direct (Perfil → Enviar o Piu) continua igual com a página do ponto ligada ao mesmo tempo.

**P7 · painel**
- [ ] Contagens sobem de verdade: outro celular passando (aparelhos atendidos hoje), mensagem de terceiros guardada/repassada, prova de entrega.
- [ ] Pausar: hotspot (forma B) desliga; Retomar: hotspot volta — anotar se o Android trocou nome/senha (o QR acompanha).
- [ ] Desligar o roteador do ponto: "A rede … caiu" (P7b); ao voltar, o ponto volta sozinho.
- [ ] Ligar "isolar clientes" no roteador com 2+ celulares ligados: em até ~2 min, "O roteador começou a isolar os visitantes" (P7c).
- [ ] Encerrar: mensagens de terceiros somem (contagem 0), chave apagada (reabrir o app: sem ponto).
- [ ] App em segundo plano com o ponto ativo e Bluetooth NEGADO: o aviso fixo do modo nó aparece e o ponto segue atendendo (Android 14+: serviço `connectedDevice` deve subir pelo CHANGE_WIFI_STATE declarado; anotar se o sistema recusar — logcat "Serviço do Modo nó não iniciou").

**P8 · visitante**
- [ ] Rede chamada "Piu · …" por perto, app aberto: folha "Ponto Piu por perto" (P8). "Agora não": não volta no mesmo dia.
- [ ] App em segundo plano (processo vivo, ex.: modo nó ligado): notificação "Ponto Piu por perto" (P8n), uma por ponto por dia, respeitando Ajustes → Notificações → Rede. Com o app morto não há aviso (limitação: sem serviço de varredura próprio).
- [ ] Ler o QR do cartaz pelo leitor do Piu (Adicionar contato → ler código): abre a folha P8.
- [ ] "Entrar no ponto" (Android 10+): o sistema pergunta; ao aceitar, a internet do celular continua pelos dados móveis/outro Wi-Fi e a faixa P8a aparece nas Conversas. Anotar aparelhos que trocam o Wi-Fi principal.
- [ ] Afastar-se do ponto: faixa "Você saiu do ponto" (P8b) some em 5 s; "Sair do ponto" em Rede → Pontos Piu desconecta.
- [ ] Rede do hotspot (forma B) em WPA3 só: entrar pelo app pode falhar (o pedido usa WPA2); anotar modelo.
