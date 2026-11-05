# Piu — continuação da auditoria de design, 05/11/2026

Base: checkpoint a3b1171, na branch codex/piu-checkpoint-2026-11-05.

## Alterações

- Pedidos de Por perto: cartões com borda/raio e espaçamento do design, avatar listrado local, balão com canto inferior esquerdo, taxa e preferências em bg2, recusa em outline. Ações empilhadas em telas pequenas ou traduções longas. Nenhum dado novo de idade inventado.
- Match: cores, bordas e sobreposição dos avatares, tipografia, pílula e rodapé. Conteúdo pode rolar em telas baixas. Animações existentes e redução de movimento preservadas.
- Aba Por perto mostra a quantidade real de pedidos pendentes e um rótulo de acessibilidade correspondente.
- Comunidade apresenta canais antes de grupos.
- Receber: endereço completo/selecionável em pílula e botão copiar com alvo de 44 px, reutilizando a ação existente.
- Alerta grave vigente: título com a tipografia especificada. Avisos comunitários e demais estados preservados.
- Conexão provider: quando já há pareamento, botão Equipamentos pareados abre as configurações reais existentes.
- Corrigido erro real no histórico web: o fetch global era invocado com receiver incorreto, causando Illegal invocation. Agora é ligado a globalThis; fetch injetado nos testes é preservado. Cópia do piu-node regenerada pelo script.

## Validação desta rodada

- Typecheck integrado mobile e typecheck piu-node passaram; export web e build Android de homologação passaram.
- 18/18 testes Por perto/créditos; 21/21 alertas/pagamento/pedido; 14/14 provider/nodeApi; histórico mobile 12/12; node/history+sync 4/4. Novo teste reproduziu a chamada fetch incorreta antes da correção e passou depois, sem acessar rede.
- Conferência web em 390×844 e tema escuro: QR, endereço público de fixture em duas linhas sem corte, botão copiar e demais ações visíveis. Histórico consultou o indexador e exibiu corretamente lista vazia para esse endereço. Nenhuma transação enviada; nenhum erro de console observado ao final.
- O botão de copiar exibiu retorno de sucesso. O acesso ao clipboard pela integração de automação do navegador retornou vazio; o conteúdo da área de transferência não foi certificado nesta rodada. A ação de copiar do aplicativo não foi substituída.
- Cards com pedidos reais, Match real e alerta grave com dados reais ainda precisam de conferência com participantes/dispositivos. Foram comparados ao design no código e cobertos pelos testes existentes de comportamento; não foram simulados como funcionalidades de produção.
- ESLint permanece ausente, conforme o checkpoint inicial. Nenhum pacote de lint adicionado. Lint vital Android passou.

## P0 ainda pendentes

- Certificação do equipamento por 120 pacotes/3 vizinhos e validador não tem backend implementado; nenhuma tela foi feita para fingir certificação.
- Regras de banda/armazenamento/horário já existem no detalhe do equipamento. A etapa dedicada de configuração do protótipo ainda não foi reproduzida.
- Conexão real por QR/HTTPS fixado/código continua existente; descoberta local e envio do pacote pelo celular continuam pendentes.
- Verificação da cópia, página de recebimento do Wi-Fi Direct e fluxo completo de custódia fora de alcance continuam na fila.
- Animações adicionais, envio da carteira nos três apps, RTL árabe, revisão linguística e decisões externas continuam conforme o relatório inicial.
