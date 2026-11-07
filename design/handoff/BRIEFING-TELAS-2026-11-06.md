# Briefing de telas — 06/11/2026

A lógica de tudo abaixo já está implementada e testada; falta só a parte visual. Cada tela lista o que mostra, as ações e os estados.
Nada aqui pode prometer recompensa paga: o programa de recompensas está desligado (`rewardsOn = false`).

## Celular — modo nó ("Do celular")

Contexto: o celular já retransmite mensagens sem internet (Bluetooth, Wi-Fi Direct). Virar nó é se cadastrar para, quando o programa abrir,
render por entregas comprovadas. Para evitar celulares falsos: caução pequena em LUNES (100 por padrão) + 7 dias + aval de 3 contatos que já são nós.
O celular rende no máximo metade do teto de um Piu Node.

1. **Entrada do modo nó** — opção "Do celular" no seletor "Do celular | Pelo terminal" (Provider → conectar).
   - Mostra: o que o modo faz (continua retransmitindo em segundo plano), aviso de bateria e dados móveis, aviso de que as recompensas ainda não estão abertas, valor da caução.
   - Ação: Ativar.
2. **Painel do modo nó** — uma etapa por fase, como uma trilha de progresso:
   - Precisa da caução (botão "Pagar caução");
   - Caução enviada, aguardando confirmação na rede;
   - Aguardando os 7 dias (faltam N dias);
   - Avais: X de 3;
   - Pronto (habilitado — estimativa local; quem decide é o validador);
   - Saiu do programa.
   - Também: créditos estimados (recibos e créditos, não é dinheiro), a chave do nó para copiar (para um operador de Piu Node avalizar), "Compartilhar arquivo de registro", "Sair do programa".
3. **Pagar caução** — folha igual à de Enviar da carteira, com segurar para assinar.
   - Mostra: valor, endereço da caução, taxa da rede.
   - Estados: em breve (endereço da caução ainda não definido), sem carteira, caução já enviada aguardando, caução já registrada, modo nó desligado.
   - Erros: os mesmos da carteira (saldo insuficiente, biometria cancelada, ocupado).
4. **Confirmar caução** — depois que a transação finaliza; pede biometria.
   - Resultados: confirmada, ainda não finalizada (tente depois), cancelada, precisa confirmar a frase de novo (leva a "Confirme a sua frase de novo").
5. **Pedir aval** — lista de contatos públicos aceitos, marcando a quem já pediu.
   - Ação: Pedir aval.
   - Vazio: sem contatos públicos.
6. **Pedidos de aval recebidos** — quem pediu, contador "X de 5 avais este mês".
   - Ações: Avalizar, Ignorar.
   - Bloqueios: só quem está no modo nó avaliza; não dá para avalizar a si mesmo; já avalizou; limite do mês.
   - Vazio: nenhum pedido. Sugestão: notificação quando chega um pedido.
7. **Sair do programa** — confirmação.
   - Explica: a devolução da caução é manual e pode demorar; os recibos deixam de render a partir da saída; o arquivo de registro (com o pedido de saída) precisa ser compartilhado.

## Desktop

8. **Piu bloqueado** (sobreposição na janela inteira) — aparece ao suspender o computador, depois de um tempo sem uso, ou com ⌘L / "Bloquear o Piu".
   - Mostra: ícone, motivo do bloqueio.
   - Ação: Desbloquear (Touch ID; em Mac sem Touch ID, Linux e Windows é uma confirmação do sistema — o texto não pode dizer "senha do sistema").
   - Estados: recusado/erro continua bloqueado.
9. **Verificar atualização** — "Verificar agora" em Sistema → Atualizações + resultado.
   - Mostra: versão instalada e a mais nova.
   - Ações: Abrir página da versão, Fechar.
   - Estados: em dia, versão nova disponível, sem conexão, erro do GitHub.
   - Decidir: o que substitui a escolha "Automático / Perguntar" do protótipo (sem assinatura não há instalação automática).

## Segunda leva — transações e provas pela malha (lógica pronta)

Sem internet, a transferência é assinada no celular, viaja de aparelho em aparelho até um gateway (Piu Node, computador ou celular com
internet e a opção ligada), que a publica na Lunes; um recibo volta pela malha. O recibo é só um aviso (qualquer relay poderia forjar):
a confirmação de verdade aparece quando o próprio celular volta a ter internet. Enquanto uma transferência estiver em trânsito, nenhuma
outra sai da carteira (proteção contra gastar duas vezes).

10. **Enviar sem internet** (dentro do Enviar da carteira, quando não há rede)
    - Mostra: aviso de que vai pela malha e pode ser liquidada horas ou dias depois; que nada novo sai da carteira até resolver; taxa estimada com folga; "dados da rede de N dias atrás".
    - Ação: segurar para assinar (igual ao Enviar).
    - Erros: "conecte-se à internet uma vez" (sem leitura recente da rede, ou com mais de 7 dias); saldo insuficiente com a folga da taxa.
11. **Em trânsito pela malha** — na atividade da carteira e no detalhe da transferência.
    - Mostra: "Assinada · viajando pela malha"; o que um gateway informou (na fila / em bloco / finalizada / recusada), marcado como "informado por um gateway, ainda não conferido"; depois "confirmada" quando o celular conferir com internet.
    - Ação: "Soltar de novo na malha".
12. **Usar este celular como gateway** — ajuste em Rede, com aviso de uso de dados e bateria.
13. **Enviar evidências pela malha** — no painel do modo nó, ao lado de "Compartilhar arquivo de registro"; estados: validador ainda não configurado, nada para enviar.
14. **Painel do Piu Node** — estado do gateway (enviadas, recusadas, na fila) e os ajustes ligar gateway / caixa do validador.

## Terceira leva — Pontos Piu com roteador Wi-Fi (desenho validado em docs/rede/pontos-piu-roteadores.md)

Celular e Desktop, salvo indicação. Nada pede a senha do Wi-Fi de casa; ponto sem internet por padrão; recompensas desligadas.

15. **Wi-Fi local em Rede** (celular) — linha/estado do novo transporte: ligado quando no Wi-Fi, aparelhos Piu encontrados na rede,
    motivo quando parado (sem Wi-Fi, bateria, roteador isolando clientes).
16. **Criar ponto Piu — início**: o que é um ponto (multiplicador / guardião), o que o dono controla, aviso de privacidade.
17. **Escolher a rede**: redes Wi-Fi próximas ou a atual; opção "Criar a rede neste celular" (celular velho como ponto, sem roteador).
18. **Teste automático**: etapas com progresso — aparelhos se enxergam · rede de casa protegida · internet (tem/não tem) · capacidade.
    Resultados: verde; amarelo com instrução (ex.: desligar isolamento entre visitantes, usar rede de visitante); vermelho com
    alternativa (roteador dedicado, criar a rede neste celular). Vermelho em "rede de casa exposta" bloqueia a ativação.
19. **Nível de compartilhamento**: Multiplicador · Guardião (limite de espaço e dias) · Guardião + distribuição do app ·
    Gateway (só se houver internet, desligado por padrão). Mostrar consumo estimado de bateria/espaço.
20. **Ativar** (decidido: um toque, sem segurar para assinar) e **QR do ponto**: QR de Wi-Fi padrão + nome do ponto; versão cartaz para imprimir; compartilhar.
21. **Painel do ponto**: atividade, aparelhos atendidos (só contagem), mensagens guardadas/repassadas, entregas comprovadas, espaço e
    dados, recompensas (desligadas), pausar, encerrar (encerrar apaga a chave do ponto e o que guarda de terceiros). Estados: ativo,
    pausado, rede caiu, roteador começou a isolar clientes.
22. **Visitante entrando num ponto** (celular): aviso "Ponto Piu por perto — entrar?" (decidido: os dois — notificação do sistema e aviso dentro do app) ao ver uma rede "Piu · …" ou ler o QR;
    estado conectado ao ponto; saiu do alcance.
23. **Página local do ponto** (navegador de quem ainda não tem o Piu): baixar o APK + SHA-256 e certificado para conferir
    (variação da página do envio por Wi-Fi Direct).
24. **Desktop como guardião** — mesmo assistente adaptado à janela (o computador usa a rede em que já está; sem "criar a rede").
