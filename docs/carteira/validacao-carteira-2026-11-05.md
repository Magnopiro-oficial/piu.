# Validação da carteira móvel — 05/11/2026

## Alterações

- Carteira própria no aplicativo nativo: endereço Lunes derivado da frase de recuperação já existente, sem substituir endereço externo salvo para consulta. O navegador mantém modo de consulta, sem cofre nativo.
- Envio: revisão de endereço, valor, saldo e taxa; autenticação do aparelho antes da assinatura; conferência da rede, da taxa e do nonce; bytes assinados persistidos cifrados antes da transmissão. Em resultado incerto, permanece o mesmo hash e o reenvio usa os mesmos bytes.
- Recuperação: falha geral de leitura, chave listada mas não retornada, dado cifrado ilegível ou registro inválido impedem novos envios e mostram orientação para conferir o histórico. Uma redefinição durante a gravação faz a operação falhar antes da transmissão.
- A seleção entre carteira própria e endereço externo não apaga o endereço observado anteriormente. Textos disponíveis nos 11 idiomas.

## Validação

- Testes automatizados usam redes simuladas e incluem autenticação cancelada, saldo insuficiente, alterações de taxa/nonce, falha de gravação, resposta perdida, confirmação, corrupção e redefinição durante gravação. Não há transação real nesses testes.
- Consulta pública somente de leitura em 05/11/2026 confirmou a gênese Lunes esperada, specVersion 107 e transactionVersion 2. O app bloqueia envio se a rede ou o runtime não forem os conferidos.
- O resultado de execução na carteira móvel usa o indexador Lunes, cruzando bloco finalizado e índice/identificação do extrinsic consultados no RPC. Trata ausência ou divergência como resultado incerto. Esse resultado depende da correção das fontes consultadas e não é uma prova independente de consenso.
- O APK de homologação usa identificador net.piu.app.checkpoint e assinatura de debug, separado do aplicativo original. Não deve ser distribuído como release.

## Pendente

- Teste de transferência real de 0,01 LUNES pelo proprietário e revisão independente permanecem pendentes; não foram feitos pagamentos reais nesta validação.
- Conferir recuperação de um registro adulterado na interface do A31 e outros fluxos reais antes de uma distribuição. Os cenários de corrupção e falha de disco foram testados em simulação, não alterando os dados reais do aparelho.
- O ESLint não está instalado/configurado no projeto; a tentativa de lint não concluiu. O build Android executa seu lint vital.
