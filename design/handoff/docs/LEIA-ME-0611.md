# Entrega 06/11 · Piu

Abra tudo por um servidor local (os arquivos se carregam entre si):

    npx serve design

Depois acesse http://localhost:3000 e clique no arquivo. Precisa de internet só para as fontes (Geist e Material Symbols).

## Arquivos
- design/Piu 11 Modo no e malha.dc.html: modo nó no celular, transações pela malha, gateway e evidências (N1–N10)
- design/Piu 12 Desktop briefing.dc.html: Piu bloqueado, atualizações, painel do Piu Node e Desktop como guardião (E1–E5)
- design/Piu 13 Pontos Piu.dc.html: Pontos Piu com roteador Wi-Fi (P1–P9)
- design/Piu Site Rede.dc.html: página do site "A rede", com o fluxograma animado para leigos
- design/Piu Site.dc.html, Piu Site EN.dc.html, Piu 7 Provider computador.dc.html: o site e as páginas para onde ele leva
- design/Piu 9 e Piu 10: versões anteriores, só para consulta
- TELAS-BRIEFING-0611.md: cada item do briefing com o ID da tela e as decisões tomadas
- TELAS-NOVAS.md: documentação anterior (entrada, estados, ações)

## Animações (todas rodam sozinhas)
- Segurar para assinar: 0,9 s em linha reta. Soltar antes faz a barra voltar em 0,3 s. Depois de concluir, volta ao início em 2,2 s.
  Telas: N3 caução, N6 aval, N7 sair, N8 envio sem internet.
- Teste automático do ponto: uma etapa a cada 1,1 s, 4 etapas, pausa e recomeça (P4 e E4). "Continuar" acende no fim.
- Trilha do modo nó: a etapa atual pulsa (anel de 2,2 s).
- Em trânsito pela malha: o ponto atravessa a linha em 2,6 s, em loop (N9).
- Spinners: 0,9 s por volta. Erros chacoalham uma vez (0,45 s).
- Página "A rede":
  - abertura: pacotes percorrem a malha, um trecho a cada 1,3 s;
  - viagem do "oi": 6 passos, 2,6 s cada, com pausar, avançar e pular para um passo;
  - "No caminho": cada pergunta acende por 1,3 s;
  - transferência LUNES: 6 passos de 2,6 s;
  - seções aparecem conforme a rolagem.
- Com "reduzir movimento" ligado no sistema, todas as animações param.
