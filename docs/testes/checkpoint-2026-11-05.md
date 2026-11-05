# Piu — checkpoint de 05/11/2026

## Entregue nesta retomada

- Mobile: concluídos os seis dicionários pendentes (alemão, italiano, japonês, chinês, árabe e hindi). Os 11 idiomas têm 1.645 chaves, com paridade de variáveis, plurais e nomes do produto.
- Corrigido crash real no Galaxy A31: Hermes não oferecia Intl.PluralRules. O núcleo usa regras Unicode CLDR para os 11 idiomas quando a API não existe, mantendo a implementação nativa quando disponível. Sem dependência nova no mobile.
- Aviso de troca de idioma passa a usar imediatamente o idioma escolhido.
- Conversas: cartão de mensagens aguardando rota, baseado na fila local; não atribui custódia a nós desconhecidos. A folha de rota respeita o prazo menor das mensagens temporárias.
- piu-node: sincronização dos módulos puros de idioma usados pelo núcleo da carteira.
- Carteira do provider: resposta perdida ou erro após tentativa de envio mantém acompanhamento pelo hash e bloqueia novo pedido; cobre failover entre endpoints e estados antigos. Sucesso exige System.ExtrinsicSuccess do índice correto em bloco finalizado; inclusão sozinha não basta. Contrato da API atualizado.
- Decoder de eventos usa @polkadot/types 16.5.6 via import dinâmico (27 pacotes adicionais; grupo @polkadot instalado ~29 MB). Nenhuma transação real enviada.
- Desktop: preparo de dependências compartilhadas, seleção da arquitetura Mac e nomes dos artefatos corrigidos. CI de validação adicionada; fluxo de release Mac/Linux/Windows já existia. Gerado DMG Mac Intel local.

## Validação

| Componente | Resultado |
| --- | --- |
| Mobile | Typecheck; 324/324 testes; export web; build Android release de homologação |
| Idiomas | 11 dicionários completos; teste sem Intl.PluralRules; categorias/decimais comparados ao Intl nativo |
| piu-node | Typecheck, build e 88/88 testes; depois da sincronização final do núcleo, 5/5 testes direcionados e typecheck |
| Painel provider | Typecheck, 96/96 testes e build |
| Piu Desktop | Typecheck, 54/54 testes e build; DMG x86_64 validado por hdiutil |
| Navegador | Criação de perfil de teste, troca de idioma em inglês/japonês/hindi; nenhum erro de console observado nesse fluxo |
| Galaxy A31, Android 12 | Instalação e atualização por ADB sobre Wi-Fi; reproduzido e corrigido crash em Conversas; nova versão permaneceu aberta, com navegação do usuário até backup (frase oculta) |

O ESLint do mobile não está configurado/instalado. A tentativa de expo lint não pôde executar a análise; nenhuma dependência de lint foi adicionada. O lint vital do build Android passou.

O controle do A31 foi por Wi-Fi. Esta rodada não certifica troca de mensagens entre dois aparelhos, alcance de rádio, segundo plano, consumo de bateria nem upgrade dos dados da instalação publicada. A instalação original net.piu.app foi preservada.

## Artefatos

- APK de homologação: Piu-0.1.0-android-checkpoint.apk. Nome no celular: Piu Teste. Identificador net.piu.app.checkpoint, assinatura de debug, instalado ao lado do original. Não é atualização de produção.
- Desktop: Piu-0.1.0-mac-x64-checkpoint.dmg. macOS 13 ou superior; sem assinatura/notarização Apple.

## Próximas frentes

1. Continuar auditoria app/design: fluxos provider de teste/configuração/conexão, verificação da cópia, página de recebimento do Wi-Fi Direct, diferenças P1 e animações P2. O cartão de fila desta rodada ainda não certifica o fluxo visual completo de fora de alcance.
2. Ligar o motor da carteira às telas de envio com biometria e assinatura no celular; concluir envio nos três aplicativos. O teste de 0,01 LUNES na Mainnet permanece pendente.
3. Auditoria visual do painel provider; downloads do site; recursos pendentes do desktop (BLE, grupos, canais, envio e backup). Executar releases remotos de instaladores apenas na etapa de distribuição.
4. Permanecem externas: Apple Developer, revisão criptográfica independente, validador/liquidação e bônus Lunes, revogação e chave de release dos pacotes, decisões de filtros de produto, revisão linguística humana e layout RTL árabe.

Este checkpoint inclui o trabalho local deixado pelo Claude e as correções acima. Não declara concluído o backlog completo ou a auditoria criptográfica.
