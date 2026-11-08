# Telas do rádio LoRa do Piu (para desenhar)

Pedido de design das telas do caminho B de `super-node-lora.md`: o rádio próprio do Piu (placa com firmware RNode, primeira placa Heltec V3) ao lado do Meshtastic. O código por trás já existe; faltam as telas. Mesmo visual do resto do app (`docs/design-spec.md`): tema claro e escuro (o escuro é obrigatório), largura de celular, textos em português (o app traduz para os outros idiomas). Os dados abaixo são de exemplo.

Ideia central para a pessoa: **é uma malha LoRa só, com dois caminhos possíveis** (o rádio do Piu e o Meshtastic). Quase ninguém precisa escolher; quem quiser, escolhe na aba Rede.

---

## 1. Linha LoRa na aba Rede

Hoje é a linha "Rádio LoRa" com chave liga/desliga. Ela passa a mostrar os dois rádios. Um quadro para cada estado:

**1a. Chave desligada.** Como hoje: "Rádio LoRa · Alertas e texto · conecte um adaptador". Desligada, nenhum dos dois rádios envia.

**1b. Ligada, nenhum rádio conectado.** Botão "Conectar rádio" (abre a tela 2).

**1c. Só um rádio conectado.** Uma linha de rádio:
- ícone de antena, nome ("Rádio do Piu · RNode 3F2A" ou "Meshtastic · T-Echo"), ponto verde;
- para o rádio do Piu: "Brasil · 904,75 MHz · Trocar" (abre a tela 4) e "2 Super Nodes por perto · 1 gateway";
- para o Meshtastic: bateria do rádio, como hoje;
- ação discreta "Conectar outro rádio".
- **Sem seletor de caminho** (não há o que escolher).

**1d. Os dois rádios conectados.** As duas linhas de rádio de 1c, e abaixo o **seletor de três opções** (segmentado, tudo visível):

`Automático` · `Só Piu` · `Só Meshtastic`

Com uma frase curta abaixo, que muda com a opção:
- Automático: "Usa o rádio do Piu; se ele cair, segue pelo Meshtastic."
- Só Piu: "Só pelo rádio do Piu. Se ele cair, as mensagens esperam."
- Só Meshtastic: "Só pelo Meshtastic. Bom para falar com quem só tem Meshtastic."

Na linha do rádio que está levando as mensagens agora, uma marca pequena "em uso".

**1e. Esperando o rádio escolhido** (modo "Só …" e esse rádio caiu). Aviso na própria linha, em cor de atenção:
- "Esperando o rádio do Piu · 2 mensagens na fila"
- botão "Enviar pelo Meshtastic agora" (só aparece se o outro rádio estiver conectado). Tocar troca para Automático.

**1f. Rádio do Piu sem tempo de rádio.** A região limita quanto tempo o rádio transmite. Texto discreto na linha: "Próxima mensagem em 40 s" (o envio continua sozinho).

**1g. Rádio do Piu conectado, mas não configurou.** Ponto vermelho, o motivo em uma linha (ex.: "A placa não aceitou a frequência da região") e "Ver o que fazer" (abre o estado 3h ou 3i).

**1h. Rádio perdido.** O rádio saiu do alcance ou desligou: "Rádio do Piu fora do alcance" e "Reconectar".

---

## 2. Escolher o tipo de rádio

Folha que abre em "Conectar rádio". Dois cartões:
- **Rádio do Piu**: "Placa com o firmware RNode (ex.: Heltec V3). Canal só do Piu, preferido quando os dois estão por perto." Abre a tela 3.
- **Meshtastic**: "Rádio com o firmware Meshtastic. Fala com a rede Meshtastic." Abre a folha de conexão do Meshtastic que já existe.

Link pequeno no pé: "Qual placa comprar?" (abre a lista de placas compatíveis).

---

## 3. Conectar o rádio do Piu

Folha no mesmo formato da conexão do Meshtastic ("Conectar rádio", título, texto de introdução, lista, etapas). Se ainda não houver região escolhida, a tela 4 abre antes desta.

Introdução: "Ligue a placa e deixe perto do celular. Ela precisa ter o firmware RNode."

**3a. Buscando.** Rótulo "PROCURANDO PELO BLUETOOTH" e a lista de rádios: nome ("RNode 3F2A", "RNode 77C1") e barras de sinal, do mais forte para o mais fraco. A lista cresce enquanto a folha está aberta.

**3b. Nada encontrado ainda.** "Nenhum rádio por perto ainda." e uma ajuda: "Não aparece? Confira se a placa está ligada e com o firmware RNode."

**3c. Pareando (PIN).** Cartão "O Android vai pedir um PIN":
- diferente do Meshtastic, **não há PIN de fábrica**: o número aparece só na tela da placa;
- "Aperte o botão PRG da placa para mostrar o PIN e digite os 6 números no aviso do Android."
- ilustração simples da placa com o número na tela, se couber.

**3d. Configurando.** Lista de etapas:
- ✓ Pareado
- ● Ajustando o canal: "Brasil · 904,75 MHz"
- ○ Entrando na malha LoRa

Botão "Cancelar".

**3e. Pronto.** Ícone de confirmação, "Rádio do Piu conectado", "RNode 3F2A · Brasil · 904,75 MHz"; se houver, "2 Super Nodes por perto". Botão "Concluir".

**3f. Erro de conexão.** Títulos conforme o motivo: "O rádio não respondeu", "Falta a permissão de Bluetooth", "O Bluetooth está desligado", "O PIN não confere". Dicas:
- Placa perto e ligada (a tela dela precisa estar acesa).
- PIN certo: o número que aparece na tela da placa.
- Placa livre: desconecte de outro celular ou computador.

Botões "Tentar de novo" e "Outro rádio".

**3g. Não é um rádio do Piu.** O aparelho respondeu, mas não tem o firmware RNode: "Este aparelho não tem o firmware RNode" e um passo curto de como instalar (link "Como instalar"). Botão "Outro rádio".

**3h. A placa não serve para esta região.** Ex.: placa de 433 MHz com a região Brasil (902–907,5 MHz). "Esta placa é de outra faixa de frequência" / "Ela não aceitou 904,75 MHz. Use uma placa de 915 MHz, ou troque a região se você estiver em outro país." Botões "Trocar região" e "Ver placas compatíveis".

**3i. Erro do rádio.** Falha interna da placa, com um código: "O rádio informou um erro (0x03)". Botões "Tentar de novo" e "Outro rádio".

---

## 4. Região do rádio

Tela (ou folha alta) com título "Região do rádio". Abre pela linha LoRa ("Trocar") ou antes da conexão quando ainda não há região.

**Topo:** "Use a região do país onde você está. É ela que define a frequência e quanto tempo o rádio pode transmitir."

**4a. Com sugestão.** Primeiro cartão "Sugerida pelo seu país": "Brasil · 902–907,5 MHz", com o botão "Usar esta".

**4b. Sem sugestão.** Para países sem regra conhecida (ex.: Argentina): "Não sabemos a regra do seu país. Escolha a região na lista; na dúvida, pergunte a quem já usa rádio LoRa por perto." Sem botão de continuar até escolher.

**Busca:** campo "Buscar país ou região".

**Lista (27 regiões).** Cada linha mostra:
- nome em português, por país ou bloco ("Brasil", "Estados Unidos e Canadá", "Europa 868 MHz", "Europa 433 MHz", "Índia", "Japão", "Austrália e Nova Zelândia", "Mundo 2,4 GHz" …);
- faixa: "902–907,5 MHz";
- em texto menor: "até 30 dBm · 10 % no ar" (potência máxima e limite de tempo no ar);
- marca na escolhida.

Fica à sua escolha agrupar por continente.

**Rodapé:** "Isto vale só para o rádio do Piu. A região do Meshtastic se escolhe no app oficial do Meshtastic."

**4c. Trocar com o rádio conectado.** Confirmação curta: "Trocar para Europa 868 MHz? O rádio muda de canal agora e passa a falar com quem usa essa região." Botões "Trocar" e "Cancelar". Depois, um aviso rápido: "Rádio do Piu em Europa 868 MHz".

---

## 5. Por onde a mensagem saiu (pequeno)

No detalhe ou na rota da mensagem, onde hoje aparece o meio: "via LoRa (Piu)" ou "via LoRa (Meshtastic)", com o mesmo ícone de antena. Mostra o efeito da escolha da tela 1d.

---

## Lista de quadros

1a–1h · 2 · 3a–3i · 4a, 4b e 4c · 5. No tema escuro (e no claro, se der). Se algum estado puder ser resolvido com o mesmo quadro de outro, indique.
