window.PIU_AJUDA = {
pt: {
  ui: { base: 'ajuda', kicker: 'CENTRAL DE AJUDA', h1: 'Passo a passo, sem complicação.', sub: 'Guias para instalar, passar o app adiante, ligar um nó e montar equipamentos. Cada passo mostra a tela que você vai ver. Quem entende de tecnologia encontra os comandos no bloco técnico.', search: 'Buscar: instalar, roteador, palavras, QR…', popular: 'Mais procurados', step: 'PASSO', of: 'DE', problem: 'PROBLEMA', done: 'Feito', mark: 'Marcar como feito', solved: 'Resolvido', markSolved: 'Marcar como resolvido', before: 'Antes de começar', progress: 'Seu progresso', doneCount: 'feitos', tech: 'Bloco técnico', copy: 'Copiar', copied: 'Copiado', tip: 'Dica', warn: 'Atenção', back: 'Ajuda', next: 'Próximo guia', stuck: 'Algo deu errado?', stuckLink: 'Ver problemas comuns', results: 'resultados', result: 'resultado', none: 'Nada encontrado. Tente outra palavra, como “instalar” ou “roteador”.', steps: 'passos', finish: 'Tudo pronto', reset: 'Recomeçar', inGuide: 'em', clear: 'Limpar' },
  cats: [
    { id: 'start', t: 'Começar', d: 'Instalar, receber e passar o Piu adiante' },
    { id: 'help', t: 'Ajudar a rede', d: 'Seu celular ou um lugar fortalecendo a malha' },
    { id: 'gear', t: 'Equipamentos', d: 'Roteador, computador e rádio' },
    { id: 'desk', t: 'Computador', d: 'O Piu no Mac e no Linux' },
    { id: 'fix', t: 'Problemas', d: 'Quando algo não sai como esperado' }
  ],
  guides: [
    { id: 'android', cat: 'start', icon: 'android', t: 'Instalar o Piu no Android', sum: 'Baixe o app pelo site e crie o seu perfil em poucos minutos.', time: '5 min', lvl: 'Fácil',
      needs: ['Celular Android 9 ou mais novo', '100 MB livres', 'Internet só para baixar. Sem internet? Veja “Receber o app de um amigo”.'],
      steps: [
        { t: 'Baixe o arquivo', d: 'No celular, abra este site e toque em Baixar APK. O arquivo tem 38 MB e vai para a pasta Downloads.', s: { f: 'p', t: 'piu.lunes.io', i: [['big', 'android', 'Piu para Android', 'APK assinado · 38 MB'], ['btn', 'Baixar APK', 1], ['text', 'Android 9 ou superior']] } },
        { t: 'Permita a instalação', d: 'Ao abrir o arquivo, o Android avisa que o navegador não pode instalar apps. Toque em Configurações e ligue “Permitir desta fonte”. Volte com a seta.', warn: 'Só faça isso com arquivos deste site ou de alguém que você conhece.', s: { f: 'p', t: 'Instalar apps desconhecidos', i: [['row', 'public', 'Chrome', 'navegador'], ['tog', 'Permitir desta fonte', 'só para este app', 1, 1], ['note', 'info', 'Você pode desligar de novo depois de instalar.']] } },
        { t: 'Instale', d: 'Toque em Instalar e espere alguns segundos. Se aparecer um aviso do Play Protect, toque em “Mais detalhes” e depois em “Instalar mesmo assim”.', s: { f: 'p', t: '', i: [['sys', 'Deseja instalar este app?', 'Piu · Lunes Network', ['Cancelar', 'Instalar']]] } },
        { t: 'Abra e escolha um nome', d: 'Não pede telefone nem e-mail. O nome aparece para os seus contatos e pode ser mudado depois.', s: { f: 'p', t: 'Criar perfil', i: [['big', 'waving_hand', 'Boas-vindas ao Piu', 'Como quer ser chamado?'], ['field', 'Seu nome', 'Maria', 1], ['btn', 'Continuar']] } },
        { t: 'Guarde as 12 palavras', d: 'O app mostra 12 palavras. Elas são a única forma de recuperar a sua conta. Escreva no papel antes de seguir.', tip: 'O guia “Guardar as 12 palavras” explica com calma.', s: { f: 'p', t: 'Sua frase', i: [['words', ['lua', 'ponte', 'sal', 'rio', 'casa', 'vento', 'pão', 'mar', 'fogo', 'trem', 'flor', 'sol']], ['btn', 'Já escrevi no papel', 1]] } }
      ],
      tech: ['Conferir a assinatura', 'sha256sum Piu-0.1.4.apk', 'apksigner verify --print-certs Piu-0.1.4.apk', '# certificado: 4C9A 7B21 … 09D3 E1F0'],
      fim: 'Seu Piu já funciona, mesmo sem internet. Troque QR com alguém por perto para mandar a primeira mensagem.' },

    { id: 'receive', cat: 'start', icon: 'phonelink_ring', t: 'Receber o app de um amigo, sem internet', sum: 'Quem já tem o Piu envia o app direto para o seu celular.', time: '4 min', lvl: 'Fácil',
      needs: ['Alguém por perto com o Piu instalado', 'Wi-Fi e Bluetooth ligados nos dois celulares. Não precisa de internet.', '100 MB livres'],
      steps: [
        { t: 'Peça para o amigo abrir o convite', d: 'No celular dele: Perfil → Convidar → “Ainda não tem”. Vai aparecer um QR.', s: { f: 'p', t: 'Convidar', i: [['row', 'qr_code_2', 'Já tem o Piu', 'adicionar como contato', 0, 1], ['row', 'install_mobile', 'Ainda não tem', 'enviar o app sem internet', 1, 1]] } },
        { t: 'Aponte a câmera para o QR', d: 'No seu celular, abra a câmera e aponte para a tela do amigo. Toque no aviso que aparece em cima.', tip: 'A câmera não reconheceu? Entre no Wi-Fi que aparece embaixo do QR, chamado Piu-Convite e mais 4 letras.', s: { f: 'p', t: 'Câmera', i: [['qr', 'Piu-Convite-7F2A'], ['note', 'link', 'Abrir 192.168.49.1']] } },
        { t: 'Baixe pela página do convite', d: 'Abre uma página que vem do celular do amigo, não da internet. Toque em Baixar o Piu.', s: { f: 'p', t: '192.168.49.1', i: [['big', 'phonelink_ring', 'Convite da Ana', 'O Piu, direto do celular dela'], ['btn', 'Baixar o Piu · 38 MB', 1], ['code', '4C9A … E1F0']] } },
        { t: 'Confira o código', d: 'Compare o código da página com o que aparece no celular do amigo. Se for igual, o arquivo é o original e ninguém mexeu nele.', warn: 'Se os códigos forem diferentes, não instale. Peça para o amigo fechar e abrir o convite de novo.', s: { f: 'p', t: 'Convite', i: [['text', 'O mesmo código precisa aparecer nos dois celulares:'], ['code', '4C9A … E1F0'], ['row', 'check_circle', 'Os dois são iguais', 'pode instalar', 1]] } },
        { t: 'Instale', d: 'Abra o arquivo baixado e siga os passos 2 e 3 do guia “Instalar o Piu no Android”: permita a instalação e toque em Instalar.', s: { f: 'p', t: '', i: [['sys', 'Deseja instalar este app?', 'Piu · Lunes Network', ['Cancelar', 'Instalar']]] } }
      ],
      tech: ['Como funciona por dentro', '# grupo Wi-Fi Direct temporário, criado pelo convite', 'servidor local: http://192.168.49.1:8080', 'APK assinado · SHA-256 conferido nos dois lados'],
      fim: 'O Piu chegou sem internet e sem loja. Agora é só abrir e escolher um nome.' },

    { id: 'share', cat: 'start', icon: 'send_to_mobile', t: 'Passar o app para outra pessoa', sum: 'Envie o Piu do seu celular para quem ainda não tem, sem internet.', time: '3 min', lvl: 'Fácil',
      needs: ['O Piu instalado no seu celular', 'A pessoa a até 10 metros', 'Celular dela com Android 9 ou mais novo'],
      steps: [
        { t: 'Abra Perfil → Convidar', d: 'Na tela inicial do Piu, toque na sua foto e depois em Convidar.', s: { f: 'p', t: 'Perfil', i: [['row', 'person', 'Maria', 'seu perfil'], ['row', 'person_add', 'Convidar', 'chamar alguém para o Piu', 1, 1], ['row', 'settings', 'Ajustes', '', 0, 1]] } },
        { t: 'Toque em “Ainda não tem”', d: 'É para quem não tem o app. Se a pessoa já tem, use “Já tem o Piu” para virarem contatos.', s: { f: 'p', t: 'Convidar', i: [['row', 'qr_code_2', 'Já tem o Piu', 'adicionar como contato', 0, 1], ['row', 'install_mobile', 'Ainda não tem', 'enviar o app sem internet', 1, 1]] } },
        { t: 'Mostre o QR', d: 'O seu celular cria uma pequena rede só para isso. Vire a tela para a pessoa apontar a câmera.', s: { f: 'p', t: 'Enviar o Piu', i: [['qr', 'Piu-Convite-7F2A'], ['code', '4C9A … E1F0'], ['note', 'lock', 'Este código aparece também no celular da pessoa.']] } },
        { t: 'Acompanhe o envio', d: 'Deixe os dois celulares perto e com a tela ligada. Em menos de um minuto o app chega.', s: { f: 'p', t: 'Enviar o Piu', i: [['big', 'send_to_mobile', 'Enviando para o celular do João', ''], ['prog', 'Enviado 24 de 38 MB', '62%'], ['ghost', 'Cancelar']] } },
        { t: 'Ajude a pessoa a instalar', d: 'Ela vai precisar permitir a instalação. Depois que abrir, troquem QR em Convidar → “Já tem o Piu” para virarem contatos.', s: { f: 'p', t: 'Enviar o Piu', i: [['big', 'check_circle', 'O João recebeu o Piu', 'Agora ele precisa instalar'], ['btn', 'Adicionar como contato', 1]] } }
      ],
      warn: 'iPhone não recebe o app assim: lá, o Piu só pode vir pela App Store.',
      fim: 'Mais um celular na rede. Cada pessoa nova deixa o caminho das mensagens mais curto.' },

    { id: 'recovery', cat: 'start', icon: 'key', t: 'Guardar as 12 palavras e recuperar a conta', sum: 'A frase que devolve a sua conta se o celular quebrar, sumir ou for trocado.', time: '5 min', lvl: 'Fácil',
      needs: ['Papel e caneta', 'Um lugar só seu, sem câmeras por perto'],
      steps: [
        { t: 'Abra a frase de recuperação', d: 'Ajustes → Segurança → Frase de recuperação. O app pede a sua digital ou senha do celular.', s: { f: 'p', t: 'Segurança', i: [['row', 'fingerprint', 'Bloqueio do app', 'digital', 0, 1], ['row', 'key', 'Frase de recuperação', '12 palavras', 1, 1], ['row', 'devices', 'Aparelhos conectados', '1 computador', 0, 1]] } },
        { t: 'Escreva as 12 palavras no papel', d: 'Na ordem, com o número de cada uma. Confira letra por letra.', warn: 'Não tire print, não mande por mensagem e não guarde na nuvem. Quem tiver estas palavras tem a sua conta.', s: { f: 'p', t: 'Sua frase', i: [['words', ['lua', 'ponte', 'sal', 'rio', 'casa', 'vento', 'pão', 'mar', 'fogo', 'trem', 'flor', 'sol']], ['note', 'visibility_off', 'Ninguém da Lunes vai pedir estas palavras.']] } },
        { t: 'Confirme algumas palavras', d: 'O app pergunta palavras fora de ordem. Errou 3 vezes? As posições mudam e você tenta de novo, com calma.', s: { f: 'p', t: 'Confirme a frase', i: [['text', 'Qual é a palavra nº 7?'], ['words', ['vento', 'pão', 'trem', 'mar'], 1], ['prog', '2 de 3', '66%']] } },
        { t: 'Guarde o papel em lugar seguro', d: 'Uma gaveta com chave, um documento importante, a casa de alguém de confiança. Pode fazer uma segunda cópia em outro lugar.', tip: 'Fogo e umidade estragam papel. Um saquinho plástico ajuda.', s: { f: 'p', t: 'Sua frase', i: [['big', 'verified_user', 'Frase confirmada', 'Guardada só com você'], ['btn', 'Concluir', 1]] } },
        { t: 'Para recuperar em outro celular', d: 'Instale o Piu, toque em “Já tenho uma conta” e digite as 12 palavras na ordem. Suas conversas voltam quando os contatos estiverem por perto.', s: { f: 'p', t: 'Recuperar conta', i: [['field', 'Palavra 1', 'lua'], ['field', 'Palavra 2', 'ponte', 1], ['text', '… até a palavra 12'], ['btn', 'Recuperar']] } }
      ],
      tech: ['Detalhes', '# as 12 palavras geram as suas chaves no próprio celular', '# a Lunes não tem cópia: sem as palavras, não há recuperação', '# identidade pública e anônima saem da mesma frase, com chaves separadas'],
      fim: 'Sua conta está protegida. Se trocar de celular, é só ter o papel em mãos.' },

    { id: 'phone-node', cat: 'help', icon: 'cell_tower', t: 'Ligar o modo nó no celular', sum: 'Seu celular passa a guardar e entregar mensagens dos outros, sem conseguir ler nenhuma.', time: '10 min + 7 dias', lvl: 'Médio',
      needs: ['O Piu atualizado', '10 LUNES na carteira para a caução', '2 contatos que já são nós para dar aval', 'Carregador por perto (recomendado)'],
      steps: [
        { t: 'Abra Ajustes → Modo nó', d: 'Toque em “Do celular”. O app explica o que muda e quanto o celular vai emprestar.', s: { f: 'p', t: 'Modo nó', i: [['row', 'smartphone', 'Do celular', 'este aparelho vira nó', 1, 1], ['row', 'router', 'De um equipamento', 'roteador, computador, rádio', 0, 1]] } },
        { t: 'Escolha quanto emprestar', d: 'O padrão é 2 GB de espaço, com mensagens guardadas por até 14 dias. O celular só ajuda com bateria acima de 30%. Dá para mudar depois.', s: { f: 'p', t: 'Limites', i: [['row', 'sd_card', 'Espaço para os outros', '2 GB'], ['tog', 'Só quando estiver carregando', '', 1], ['tog', 'Só no Wi-Fi', '', 0], ['btn', 'Continuar', 1]] } },
        { t: 'Pague a caução', d: 'São 10 LUNES que ficam guardados enquanto você for nó. Segure o botão até a barra completar: esse gesto é a sua assinatura.', tip: 'A caução volta para a sua carteira quando você sair.', s: { f: 'p', t: 'Caução', i: [['big', 'savings', '10 LUNES', 'devolvidos ao sair'], ['hold', 'Segure para pagar', 1]] } },
        { t: 'Confirme que é você', d: 'Use a digital. Se o app pedir, confirme também algumas das suas 12 palavras.', s: { f: 'p', t: 'Confirmar', i: [['big', 'fingerprint', 'Toque no sensor', 'para confirmar a caução'], ['ghost', 'Usar senha do celular']] } },
        { t: 'Peça 2 avais', d: 'Escolha contatos que já são nós. Cada um recebe o pedido e segura para avalizar. O pedido vale 3 dias.', s: { f: 'p', t: 'Pedir aval', i: [['row', 'person', 'Ana Souza', 'nó há 4 meses', 1], ['row', 'person', 'Seu Antônio', 'nó há 2 meses', 1], ['row', 'person', 'Lia', 'ainda não é nó'], ['btn', 'Enviar 2 pedidos', 1]] } },
        { t: 'Espere os 7 dias de teste', d: 'Nesses dias o celular já ajuda. A rede confere se ele fica disponível de verdade. Depois disso, você é nó.', s: { f: 'p', t: 'Modo nó', i: [['prog', 'Teste · dia 3 de 7', '43%'], ['row', 'check_circle', 'Caução paga', '10 LUNES'], ['row', 'check_circle', 'Avais', '2 de 2'], ['row', 'inventory_2', 'Guardando agora', '61 MB de outras pessoas']] } },
        { t: 'Para sair, quando quiser', d: 'Modo nó → Sair do modo nó. Segure para assinar. As mensagens guardadas são entregues a outros nós e a caução volta em 7 dias.', s: { f: 'p', t: 'Sair', i: [['note', 'schedule', 'A caução volta em 7 dias.'], ['hold', 'Segure para sair', 1]] } }
      ],
      tech: ['Limites usados', 'caução: 10 LUNES · devolvida 7 dias após sair', 'avais: 2 · cada nó dá até 5 por mês', 'armazenamento: 2 GB · envelopes vencem em 14 dias', 'retransmissão: bateria > 30% · até 200 MB/dia'],
      fim: 'Seu celular agora ajuda a levar mensagens. Você acompanha tudo em Ajustes → Modo nó.' },

    { id: 'point', cat: 'help', icon: 'storefront', t: 'Criar um Ponto Piu com o Wi-Fi de um lugar', sum: 'Uma padaria, uma escola ou uma igreja vira ponto de encontro das mensagens.', time: '8 min', lvl: 'Fácil',
      needs: ['Celular com o Piu conectado ao Wi-Fi do lugar', 'Ser responsável pelo lugar, ou ter autorização', 'Um lugar por onde passa gente'],
      steps: [
        { t: 'Abra Ajustes → Pontos Piu', d: 'Toque em Criar ponto. O app explica o que é um ponto e o que ele não faz.', s: { f: 'p', t: 'Pontos Piu', i: [['big', 'storefront', 'Crie um ponto', 'Quem passar por aqui troca mensagens'], ['btn', 'Criar ponto', 1]] } },
        { t: 'Escolha a rede do lugar', d: 'Aparecem os Wi-Fi por perto. Escolha o do lugar. O Piu não pede a senha do roteador nem muda nada nele.', tip: 'Sem Wi-Fi? Um celular velho pode criar a própria rede e ficar parado no lugar.', s: { f: 'p', t: 'Escolher a rede', i: [['row', 'wifi', 'Padaria do Zé', 'conectado', 1], ['row', 'wifi', 'Visitantes', ''], ['row', 'wifi_tethering', 'Criar rede própria', 'com este celular', 0, 1]] } },
        { t: 'Espere o teste automático', d: 'O app confere se os aparelhos do lugar ficariam visíveis aos visitantes. Verde: pode seguir. Amarelo: dá para seguir com cuidado. Vermelho: o ponto não liga.', warn: 'Deu vermelho? Peça para quem cuida do roteador ligar a “rede de visitantes” ou o “isolamento de clientes”, e teste de novo.', s: { f: 'p', t: 'Teste da rede', i: [['prog', 'Testando…', '80%'], ['row', 'check_circle', 'Aparelhos da casa', 'não aparecem'], ['row', 'check_circle', 'Celulares Piu', 'se encontram'], ['row', 'pending', 'Velocidade', 'medindo']] } },
        { t: 'Escolha o tipo de ponto', d: 'Multiplicador: faz os celulares se acharem enquanto estão ali. Guardião: além disso, guarda mensagens trancadas até a pessoa passar.', s: { f: 'p', t: 'Tipo de ponto', i: [['row', 'device_hub', 'Multiplicador', 'leve · não guarda nada', 0], ['row', 'inventory_2', 'Guardião', 'guarda até 2 GB trancados', 1]] } },
        { t: 'Ative com um toque', d: 'Ativar o ponto não mexe nos seus LUNES. Dá para pausar ou encerrar quando quiser.', s: { f: 'p', t: 'Antes de ativar', i: [['note', 'lock', 'Ninguém consegue ler o que passa pelo ponto.'], ['note', 'toll', 'Não move LUNES.'], ['btn', 'Ativar ponto', 1]] } },
        { t: 'Cole o cartaz', d: 'Imprima o cartaz com o QR e cole perto da entrada. Quem chega com o Piu recebe o aviso “Ponto Piu por perto, entrar?”.', s: { f: 'p', t: 'Cartaz', i: [['qr', 'Ponto Piu · Padaria do Zé'], ['btn', 'Imprimir cartaz', 1], ['ghost', 'Compartilhar']] } },
        { t: 'Acompanhe no painel', d: 'Veja quantas pessoas passaram e quantas mensagens foram entregues. Se a rede cair, o ponto pausa sozinho.', s: { f: 'p', t: 'Padaria do Zé', i: [['row', 'groups', 'Visitantes hoje', '38'], ['row', 'done_all', 'Entregues', '214'], ['row', 'inventory_2', 'Guardando', '1,1 GB'], ['ghost', 'Pausar ponto']] } }
      ],
      tech: ['Como o ponto funciona', '# descoberta: mDNS _piu._tcp na rede local', '# teste: isolamento de clientes e portas abertas', '# guardião: envelopes cifrados, nunca abertos'],
      fim: 'O lugar virou um Ponto Piu. Quem passa por ali troca mensagens mesmo sem internet.' },

    { id: 'openwrt', cat: 'gear', icon: 'router', t: 'Montar um Piu Node no roteador OpenWrt', sum: 'Um roteador ligado 24 horas guarda e entrega mensagens para o bairro.', time: '25 min', lvl: 'Médio',
      needs: ['Roteador com OpenWrt 23.05 ou mais novo, como o GL.iNet GL-MT3000', '256 MB de memória e 1 GB livre. Um pendrive serve.', 'Um computador ou celular no Wi-Fi do roteador', 'O Piu no celular, para parear'],
      steps: [
        { t: 'Confira se o roteador serve', d: 'No navegador, entre no painel do roteador. O endereço costuma estar na etiqueta embaixo dele, como 192.168.8.1. Em Status, veja a versão do OpenWrt e a arquitetura.', s: { f: 'w', t: 'Status', u: '192.168.8.1', i: [['row', 'memory', 'Firmware', 'OpenWrt 23.05.3', 1], ['row', 'developer_board', 'Arquitetura', 'aarch64', 1], ['row', 'storage', 'Memória', '512 MB']] } },
        { t: 'Baixe o pacote certo', d: 'Neste site, em Baixar → Piu Node, escolha o arquivo com o nome da arquitetura do passo anterior.', s: { f: 'w', t: 'Piu Node', u: 'piu.lunes.io/node', i: [['row', 'download', 'piu-node_0.4.2_aarch64.ipk', 'ARM 64 bits · GL.iNet, Xiaomi', 1], ['row', 'download', 'piu-node_0.4.2_mipsel.ipk', 'MIPS · roteadores antigos'], ['row', 'download', 'piu-node_0.4.2_x86_64.ipk', 'mini-PC com OpenWrt']] } },
        { t: 'Envie e instale', d: 'No painel do roteador: Sistema → Software → Enviar pacote. Escolha o arquivo e toque em Instalar. Leva uns 2 minutos.', warn: 'Não desligue o roteador da tomada durante a instalação.', tip: 'O pacote confere a própria assinatura antes de instalar. Se não conferir, nada é instalado.', s: { f: 'w', t: 'Sistema › Software', u: '192.168.8.1/cgi-bin/luci', i: [['field', 'Pacote', 'piu-node_0.4.2_aarch64.ipk'], ['prog', 'Instalando…', '70%'], ['btn', 'Instalar', 1]] },
          tech: ['Pelo terminal (SSH)', 'scp piu-node_0.4.2_aarch64.ipk root@192.168.8.1:/tmp/', 'ssh root@192.168.8.1', 'opkg update && opkg install /tmp/piu-node_0.4.2_aarch64.ipk', '/etc/init.d/piu-node enable && /etc/init.d/piu-node start'] },
        { t: 'Abra o painel do Piu Node', d: 'No navegador, digite piu-node.local:8420. Esse painel só abre dentro da sua rede.', s: { f: 'w', t: 'Piu Node', u: 'piu-node.local:8420', i: [['big', 'router', 'Piu Node instalado', 'GL-MT3000 · OpenWrt 23.05'], ['btn', 'Parear com o celular', 1]] } },
        { t: 'Pareie com o celular', d: 'No Piu: Ajustes → Provider → Adicionar equipamento → Ler QR. Aponte para o QR do painel.', s: { f: 'p', t: 'Adicionar equipamento', i: [['qr', 'piu-node.local'], ['note', 'router', 'Roteador encontrado: GL-MT3000']] },
          tech: ['Parear pelo terminal', 'piu-node pair', '# mostra o QR no próprio terminal'] },
        { t: 'Escolha o que ele empresta', d: 'Dê um nome, escolha o espaço para mensagens dos outros e quais conexões usar. Toque em Ativar.', s: { f: 'p', t: 'Roteador da sala', i: [['tog', 'Wi-Fi Mesh 5 GHz', 'entre roteadores', 1], ['tog', 'Wi-Fi 2,4 GHz', 'para celulares', 1], ['tog', 'Ethernet', '3 portas', 1], ['btn', 'Ativar', 1]] } }
      ],
      tech: ['Referência', 'painel local: http://piu-node.local:8420', 'config: /etc/config/piu-node', 'logs: logread -f | grep piu-node', 'malha: 802.11s no rádio de 5 GHz'],
      fim: 'Seu roteador é um Home Node. Os primeiros recibos aparecem no painel em alguns minutos.' },

    { id: 'linux', cat: 'gear', icon: 'developer_board', t: 'Piu Node no Linux ou Raspberry Pi', sum: 'Um computador ou Raspberry Pi ligado em casa vira nó da rede.', time: '15 min', lvl: 'Médio',
      needs: ['Raspberry Pi 4 ou 5, ou computador com Debian 12, Ubuntu 22.04 ou mais novo', '2 GB livres', 'Ligado na tomada e na rede de casa', 'O Piu no celular, para parear'],
      steps: [
        { t: 'Escolha o caminho', d: 'Raspberry Pi novo? Use a imagem pronta: é só gravar no cartão. Já usa o computador para outras coisas? Instale o pacote.', s: { f: 'w', t: 'Piu Node', u: 'piu.lunes.io/node', i: [['row', 'sd_card', 'Imagem pronta', 'Raspberry Pi · cartão SD', 1, 1], ['row', 'terminal', 'Pacote .deb', 'Debian, Ubuntu, Raspberry Pi OS', 0, 1]] } },
        { t: 'Grave a imagem no cartão', d: 'Abra o Raspberry Pi Imager. Em Sistema operacional, escolha “Usar arquivo” e selecione piu-node-0.4.2-rpi.img.xz. Escolha o cartão e toque em Gravar. Depois, coloque o cartão no Raspberry e ligue.', s: { f: 'w', t: 'Raspberry Pi Imager', u: '', i: [['field', 'Sistema operacional', 'piu-node-0.4.2-rpi.img.xz'], ['field', 'Armazenamento', 'Cartão SD · 32 GB'], ['btn', 'Gravar', 1]] } },
        { t: 'Ou instale o pacote', d: 'Num computador que você já usa, abra o terminal na pasta do arquivo baixado e rode os dois comandos abaixo.', s: { f: 't', t: 'Terminal', i: [['term', ['$ sudo apt install ./piu-node_0.4.2_arm64.deb', 'Conferindo assinatura… ok', 'Configurando piu-node (0.4.2)…', '$ sudo systemctl enable --now piu-node', '● piu-node.service · active (running)']]] },
          tech: ['Qual arquivo baixar', '# Raspberry Pi e ARM: piu-node_0.4.2_arm64.deb', '# PC e mini-PC: piu-node_0.4.2_amd64.deb', 'dpkg --print-architecture'] },
        { t: 'Pareie com o celular', d: 'Com a imagem pronta, abra piu-node.local:8420 no navegador e toque em Parear. Com o pacote, rode piu-node pair no terminal. Leia o QR pelo Piu: Ajustes → Provider → Adicionar equipamento.', s: { f: 't', t: 'Terminal', i: [['term', ['$ piu-node pair', 'Leia este QR no Piu:']], ['qr', '']] } },
        { t: 'Confira se está funcionando', d: 'No painel piu-node.local:8420 aparecem os vizinhos encontrados e os recibos de entrega. Em poucos minutos os números começam a subir.', s: { f: 'w', t: 'Raspberry do escritório', u: 'piu-node.local:8420', i: [['row', 'hub', 'Vizinhos', '5'], ['row', 'receipt_long', 'Recibos hoje', '128'], ['row', 'inventory_2', 'Na fila', '312 envelopes']] } }
      ],
      tech: ['Referência', 'painel local: porta 8420 · mDNS piu-node.local', 'config: /etc/piu-node/config.toml', 'logs: journalctl -u piu-node -f', 'estado: piu-node status'],
      fim: 'Seu computador é um Home Node. Deixe ligado: quanto mais tempo online, mais ele ajuda.' },

    { id: 'lora', cat: 'gear', icon: 'settings_input_antenna', t: 'Ligar um rádio LoRa', sum: 'Leve mensagens curtas por quilômetros, de bairro a bairro.', time: '30 min', lvl: 'Avançado',
      needs: ['Rádio LoRa USB de 915 MHz homologado pela Anatel, como um SX1262', 'Antena externa', 'Um Piu Node já funcionando: Linux, Raspberry Pi ou mini-PC', 'Um lugar alto: janela, laje ou telhado'],
      steps: [
        { t: 'Confira a homologação', d: 'Use só rádios com selo da Anatel para 915 MHz. A potência é limitada por lei e o Piu respeita esse limite.', warn: 'Rádios sem homologação podem atrapalhar outros serviços e são proibidos.', s: { f: 'p', t: 'Rádio', i: [['big', 'verified', 'Selo Anatel', '915 MHz · uso livre'], ['note', 'info', 'O número da homologação fica na etiqueta do rádio.']] } },
        { t: 'Coloque a antena antes de ligar', d: 'Rosqueie a antena no rádio. Leve a antena para o lugar mais alto possível, longe de paredes de concreto.', warn: 'Ligar o rádio sem antena pode queimá-lo.', s: { f: 'p', t: 'Montagem', i: [['row', 'settings_input_antenna', '1. Antena', 'rosqueada no rádio', 1], ['row', 'usb', '2. Cabo USB', 'só depois da antena'], ['row', 'roofing', '3. Lugar alto', 'janela ou telhado']] } },
        { t: 'Ligue o rádio no USB do nó', d: 'O Piu Node reconhece sozinho e mostra no painel “Rádio LoRa encontrado”. Toque em Usar este rádio.', s: { f: 'w', t: 'Conexões', u: 'piu-node.local:8420', i: [['row', 'settings_input_antenna', 'Rádio LoRa USB', 'SX1262 · ttyACM0', 1], ['btn', 'Usar este rádio', 1]] },
          tech: ['Pelo terminal', 'ls /dev/ttyACM*', 'piu-node radio list', 'piu-node radio enable lora0 --region BR915'] },
        { t: 'Ative pelo celular', d: 'No Piu: Ajustes → Provider → escolha o equipamento → Conexões. Ligue LoRa 915 MHz.', s: { f: 'p', t: 'Mini-PC da garagem', i: [['tog', 'LoRa 915 MHz', 'só texto e alertas', 1, 1], ['tog', 'Wi-Fi 6', 'malha', 1], ['tog', 'Ethernet', '2 portas', 1]] } },
        { t: 'Meça o alcance', d: 'O teste conta quantos rádios vizinhos o seu escuta e a que distância. Peça para alguém com outro rádio ajudar, ou espere os vizinhos aparecerem.', s: { f: 'p', t: 'Teste de alcance', i: [['prog', 'Escutando…', '75%'], ['row', 'hub', 'Rádios ouvidos', '4'], ['row', 'straighten', 'Mais distante', '4,1 km']] } },
        { t: 'Saiba o que passa pelo rádio', d: 'Só texto curto e alertas, como os da Defesa Civil. Fotos, vídeos e arquivos nunca vão pelo rádio: seguem por Wi-Fi quando houver.', s: { f: 'p', t: 'LoRa 915 MHz', i: [['row', 'chat', 'Texto', 'passa', 1], ['row', 'warning', 'Alertas oficiais', 'passam, com prioridade', 1], ['row', 'image_not_supported', 'Fotos e vídeos', 'nunca']] } }
      ],
      tech: ['Referência', 'região: BR915 · 902–907,5 e 915–928 MHz', 'potência e ciclo de uso limitados pelo nó', 'taxa típica: ~5,5 kbps · só texto e alertas'],
      fim: 'Seu nó agora fala por rádio. Mensagens curtas chegam a bairros onde não há Wi-Fi nem internet.' },

    { id: 'desktop', cat: 'desk', icon: 'laptop_mac', t: 'Piu Desktop no Mac e no Linux', sum: 'Instale no computador e espelhe as conversas do celular com segurança.', time: '6 min', lvl: 'Fácil',
      needs: ['macOS 12 ou mais novo, ou Linux: Ubuntu 20.04+, Debian 11+, Fedora 36+', 'O Piu no celular', 'Celular e computador perto um do outro'],
      steps: [
        { t: 'Baixe e instale', d: 'No Mac, abra o arquivo .dmg e arraste o Piu para Aplicativos. No Linux, baixe o AppImage, dê permissão de execução e abra.', s: { f: 'w', t: 'Piu-0.1.4-arm64.dmg', u: '', i: [['big', 'download_done', 'Arraste o Piu para Aplicativos', ''], ['row', 'apps', 'Aplicativos', 'solte aqui', 1]] },
          tech: ['Outras formas', 'brew install --cask piu', 'flatpak install flathub network.lunes.Piu', 'chmod +x Piu-0.1.4-x86_64.AppImage'] },
        { t: 'Escolha “Parear com o celular”', d: 'Na primeira abertura aparecem três opções. Parear espelha a conta do celular, que é o mais comum.', s: { f: 'w', t: 'Piu', u: '', i: [['row', 'qr_code_scanner', 'Parear com o celular', 'recomendado', 1, 1], ['row', 'key', 'Restaurar com 12 palavras', '', 0, 1], ['row', 'person_add', 'Identidade só para este computador', '', 0, 1]] } },
        { t: 'Leia o QR com o celular', d: 'No Piu do celular: Perfil → Aparelhos conectados → Conectar. Aponte para o QR no computador. Ele muda a cada 30 segundos.', s: { f: 'w', t: 'Parear', u: '', i: [['qr', 'muda em 24 s'], ['text', 'Perfil → Aparelhos conectados → Conectar']] } },
        { t: 'Confira as 3 palavras', d: 'O celular mostra 3 palavras. No computador, escolha a terceira entre quatro opções. É a prova de que ninguém se meteu no meio.', s: { f: 'w', t: 'Confirmar', u: '', i: [['text', 'lua · ponte · ?'], ['words', ['rio', 'sal', 'mar', 'pão'], 1]] } },
        { t: 'Pronto: conversas espelhadas', d: 'Conversas e contatos aparecem no computador. Pagamentos pedidos ali só saem depois de aprovados no celular.', tip: 'Para desconectar, use Perfil → Aparelhos conectados no celular.', s: { f: 'w', t: 'Piu', u: '', i: [['row', 'forum', 'Mutirão da rua', 'Lia: Levo uma extensão de 10 m'], ['row', 'person', 'Ana Souza', 'entregue'], ['note', 'front_hand', 'O computador nunca paga sozinho.']] } }
      ],
      fim: 'O Piu está no computador. O celular continua mandando: o computador espelha.' },

    { id: 'troubleshoot', cat: 'fix', icon: 'build', t: 'Resolver problemas comuns', sum: 'As dúvidas que mais aparecem, com o que fazer em cada uma.', time: '—', lvl: 'Fácil', kind: 'prob',
      needs: [],
      steps: [
        { t: 'A mensagem fica em “aguardando”', d: 'É normal quando não há ninguém com o Piu por perto. A mensagem sai sozinha quando surgir um caminho. Confira se o Wi-Fi e o Bluetooth estão ligados e abra o app perto de outras pessoas.' },
        { t: 'O Android não deixa instalar', d: 'Abra Configurações → Apps → Acesso especial → Instalar apps desconhecidos, escolha o navegador e ligue “Permitir desta fonte”. Se o Play Protect avisar, toque em “Mais detalhes” e “Instalar mesmo assim”, mas só depois de conferir o código.' },
        { t: 'Não acho o celular do amigo para passar o app', d: 'Ligue o Wi-Fi e a localização nos dois celulares: o Android exige a localização para criar o convite. Fiquem a menos de 10 metros e abram o convite de novo.' },
        { t: 'O celular esquenta ou gasta muita bateria', d: 'Em Modo nó, ligue “Só quando estiver carregando” e diminua o espaço emprestado. Fora do modo nó, o Piu só retransmite com bateria acima de 30%.' },
        { t: 'O teste do Ponto Piu deu vermelho', d: 'Os aparelhos do lugar ficariam visíveis aos visitantes. Peça para quem cuida do roteador ligar a rede de visitantes ou o isolamento de clientes e repita o teste.' },
        { t: 'O endereço piu-node.local não abre', d: 'Confira se o computador ou celular está no mesmo Wi-Fi do nó. Tente o número do aparelho, como 192.168.8.1:8420. No terminal, piu-node status mostra se o serviço está rodando.' },
        { t: 'O QR do computador não é lido', d: 'Aumente o brilho da tela e aproxime o celular. O QR muda a cada 30 segundos: se demorar, espere o próximo.' },
        { t: 'Perdi o celular', d: 'Instale o Piu em outro celular e recupere com as 12 palavras. Se o computador estava pareado, remova o aparelho perdido em Perfil → Aparelhos conectados.' },
        { t: 'A transferência de LUNES não confirma', d: 'Sem internet, ela viaja pela malha até um gateway e pode levar horas ou dias. Só aparece “confirmada” quando o seu celular conferir na rede Lunes. Enquanto isso, nenhuma outra transferência sai da carteira.' }
      ],
      fim: 'Não resolveu? Pergunte num canal público da sua comunidade dentro do próprio Piu.' }
  ]
},
en: {
  ui: { base: 'help', kicker: 'HELP CENTER', h1: 'Step by step, no fuss.', sub: 'Guides to install, pass the app on, turn on a node and set up equipment. Each step shows the screen you will see. Tech-savvy readers will find the commands in the technical block.', search: 'Search: install, router, words, QR…', popular: 'Most searched', step: 'STEP', of: 'OF', problem: 'ISSUE', done: 'Done', mark: 'Mark as done', solved: 'Solved', markSolved: 'Mark as solved', before: 'Before you start', progress: 'Your progress', doneCount: 'done', tech: 'Technical block', copy: 'Copy', copied: 'Copied', tip: 'Tip', warn: 'Heads up', back: 'Help', next: 'Next guide', stuck: 'Something went wrong?', stuckLink: 'See common issues', results: 'results', result: 'result', none: 'Nothing found. Try another word, like “install” or “router”.', steps: 'steps', finish: 'All set', reset: 'Start over', inGuide: 'in', clear: 'Clear' },
  cats: [
    { id: 'start', t: 'Get started', d: 'Install, receive and pass Piu on' },
    { id: 'help', t: 'Help the network', d: 'Your phone or a place strengthening the mesh' },
    { id: 'gear', t: 'Equipment', d: 'Router, computer and radio' },
    { id: 'desk', t: 'Computer', d: 'Piu on Mac and Linux' },
    { id: 'fix', t: 'Troubleshooting', d: 'When things don’t go as expected' }
  ],
  guides: [
    { id: 'android', cat: 'start', icon: 'android', t: 'Install Piu on Android', sum: 'Download the app from the website and create your profile in a few minutes.', time: '5 min', lvl: 'Easy',
      needs: ['Android 9 or newer', '100 MB free', 'Internet only to download. No internet? See “Get the app from a friend”.'],
      steps: [
        { t: 'Download the file', d: 'On your phone, open this website and tap Download APK. The file is 38 MB and goes to your Downloads folder.', s: { f: 'p', t: 'piu.lunes.io', i: [['big', 'android', 'Piu for Android', 'Signed APK · 38 MB'], ['btn', 'Download APK', 1], ['text', 'Android 9 or later']] } },
        { t: 'Allow the install', d: 'When you open the file, Android says the browser can’t install apps. Tap Settings and turn on “Allow from this source”. Go back with the arrow.', warn: 'Only do this with files from this website or from someone you know.', s: { f: 'p', t: 'Install unknown apps', i: [['row', 'public', 'Chrome', 'browser'], ['tog', 'Allow from this source', 'for this app only', 1, 1], ['note', 'info', 'You can turn it off again after installing.']] } },
        { t: 'Install', d: 'Tap Install and wait a few seconds. If a Play Protect warning shows up, tap “More details” and then “Install anyway”.', s: { f: 'p', t: '', i: [['sys', 'Do you want to install this app?', 'Piu · Lunes Network', ['Cancel', 'Install']]] } },
        { t: 'Open it and pick a name', d: 'No phone number or email needed. Your contacts see this name and you can change it later.', s: { f: 'p', t: 'Create profile', i: [['big', 'waving_hand', 'Welcome to Piu', 'What should we call you?'], ['field', 'Your name', 'Maria', 1], ['btn', 'Continue']] } },
        { t: 'Keep the 12 words', d: 'The app shows 12 words. They are the only way to recover your account. Write them on paper before moving on.', tip: 'The “Keep your 12 words” guide walks you through it.', s: { f: 'p', t: 'Your phrase', i: [['words', ['moon', 'bridge', 'salt', 'river', 'house', 'wind', 'bread', 'sea', 'fire', 'train', 'flower', 'sun']], ['btn', 'I wrote it down', 1]] } }
      ],
      tech: ['Verify the signature', 'sha256sum Piu-0.1.4.apk', 'apksigner verify --print-certs Piu-0.1.4.apk', '# certificate: 4C9A 7B21 … 09D3 E1F0'],
      fim: 'Piu already works, even without internet. Swap QR codes with someone nearby to send your first message.' },

    { id: 'receive', cat: 'start', icon: 'phonelink_ring', t: 'Get the app from a friend, offline', sum: 'Someone who has Piu sends the app straight to your phone.', time: '4 min', lvl: 'Easy',
      needs: ['Someone nearby with Piu installed', 'Wi-Fi and Bluetooth on in both phones. No internet needed.', '100 MB free'],
      steps: [
        { t: 'Ask your friend to open the invite', d: 'On their phone: Profile → Invite → “Doesn’t have it yet”. A QR code appears.', s: { f: 'p', t: 'Invite', i: [['row', 'qr_code_2', 'Already has Piu', 'add as contact', 0, 1], ['row', 'install_mobile', 'Doesn’t have it yet', 'send the app offline', 1, 1]] } },
        { t: 'Point your camera at the QR', d: 'On your phone, open the camera and point it at your friend’s screen. Tap the banner that pops up.', tip: 'Camera didn’t catch it? Join the Wi-Fi shown under the QR, named Piu-Convite plus 4 letters.', s: { f: 'p', t: 'Camera', i: [['qr', 'Piu-Convite-7F2A'], ['note', 'link', 'Open 192.168.49.1']] } },
        { t: 'Download from the invite page', d: 'A page opens, served by your friend’s phone, not the internet. Tap Download Piu.', s: { f: 'p', t: '192.168.49.1', i: [['big', 'phonelink_ring', 'Invite from Ana', 'Piu, straight from her phone'], ['btn', 'Download Piu · 38 MB', 1], ['code', '4C9A … E1F0']] } },
        { t: 'Check the code', d: 'Compare the code on the page with the one on your friend’s phone. If they match, the file is the original and nobody tampered with it.', warn: 'If the codes differ, don’t install. Ask your friend to close and reopen the invite.', s: { f: 'p', t: 'Invite', i: [['text', 'The same code must appear on both phones:'], ['code', '4C9A … E1F0'], ['row', 'check_circle', 'Both match', 'safe to install', 1]] } },
        { t: 'Install', d: 'Open the downloaded file and follow steps 2 and 3 of “Install Piu on Android”: allow the install and tap Install.', s: { f: 'p', t: '', i: [['sys', 'Do you want to install this app?', 'Piu · Lunes Network', ['Cancel', 'Install']]] } }
      ],
      tech: ['Under the hood', '# temporary Wi-Fi Direct group, created by the invite', 'local server: http://192.168.49.1:8080', 'signed APK · SHA-256 checked on both sides'],
      fim: 'Piu arrived with no internet and no store. Now just open it and pick a name.' },

    { id: 'share', cat: 'start', icon: 'send_to_mobile', t: 'Pass the app to someone', sum: 'Send Piu from your phone to someone who doesn’t have it, offline.', time: '3 min', lvl: 'Easy',
      needs: ['Piu installed on your phone', 'The other person within 10 meters', 'Their phone on Android 9 or newer'],
      steps: [
        { t: 'Open Profile → Invite', d: 'On Piu’s home screen, tap your photo and then Invite.', s: { f: 'p', t: 'Profile', i: [['row', 'person', 'Maria', 'your profile'], ['row', 'person_add', 'Invite', 'bring someone to Piu', 1, 1], ['row', 'settings', 'Settings', '', 0, 1]] } },
        { t: 'Tap “Doesn’t have it yet”', d: 'That’s for people without the app. If they already have it, use “Already has Piu” to become contacts.', s: { f: 'p', t: 'Invite', i: [['row', 'qr_code_2', 'Already has Piu', 'add as contact', 0, 1], ['row', 'install_mobile', 'Doesn’t have it yet', 'send the app offline', 1, 1]] } },
        { t: 'Show the QR', d: 'Your phone creates a small network just for this. Turn the screen so they can point their camera.', s: { f: 'p', t: 'Send Piu', i: [['qr', 'Piu-Convite-7F2A'], ['code', '4C9A … E1F0'], ['note', 'lock', 'This code also appears on their phone.']] } },
        { t: 'Watch it send', d: 'Keep both phones close with screens on. The app arrives in under a minute.', s: { f: 'p', t: 'Send Piu', i: [['big', 'send_to_mobile', 'Sending to João’s phone', ''], ['prog', 'Sent 24 of 38 MB', '62%'], ['ghost', 'Cancel']] } },
        { t: 'Help them install', d: 'They’ll need to allow the install. Once it’s open, swap QR codes in Invite → “Already has Piu” to become contacts.', s: { f: 'p', t: 'Send Piu', i: [['big', 'check_circle', 'João got Piu', 'Now he needs to install it'], ['btn', 'Add as contact', 1]] } }
      ],
      warn: 'iPhones can’t receive the app this way: there, Piu only comes from the App Store.',
      fim: 'One more phone on the network. Every new person makes the path for messages shorter.' },

    { id: 'recovery', cat: 'start', icon: 'key', t: 'Keep your 12 words and recover your account', sum: 'The phrase that brings your account back if your phone breaks, goes missing or is replaced.', time: '5 min', lvl: 'Easy',
      needs: ['Pen and paper', 'A private spot, no cameras around'],
      steps: [
        { t: 'Open the recovery phrase', d: 'Settings → Security → Recovery phrase. The app asks for your fingerprint or phone passcode.', s: { f: 'p', t: 'Security', i: [['row', 'fingerprint', 'App lock', 'fingerprint', 0, 1], ['row', 'key', 'Recovery phrase', '12 words', 1, 1], ['row', 'devices', 'Linked devices', '1 computer', 0, 1]] } },
        { t: 'Write the 12 words on paper', d: 'In order, with each word’s number. Check letter by letter.', warn: 'No screenshots, no messages, no cloud. Whoever has these words has your account.', s: { f: 'p', t: 'Your phrase', i: [['words', ['moon', 'bridge', 'salt', 'river', 'house', 'wind', 'bread', 'sea', 'fire', 'train', 'flower', 'sun']], ['note', 'visibility_off', 'No one from Lunes will ever ask for these words.']] } },
        { t: 'Confirm a few words', d: 'The app asks for words out of order. Got it wrong 3 times? The positions change and you try again, calmly.', s: { f: 'p', t: 'Confirm phrase', i: [['text', 'What is word #7?'], ['words', ['wind', 'bread', 'train', 'sea'], 1], ['prog', '2 of 3', '66%']] } },
        { t: 'Store the paper safely', d: 'A locked drawer, with important documents, at a trusted person’s home. You can make a second copy in another place.', tip: 'Fire and moisture ruin paper. A small plastic bag helps.', s: { f: 'p', t: 'Your phrase', i: [['big', 'verified_user', 'Phrase confirmed', 'Kept only by you'], ['btn', 'Finish', 1]] } },
        { t: 'To recover on another phone', d: 'Install Piu, tap “I already have an account” and type the 12 words in order. Your chats come back when your contacts are nearby.', s: { f: 'p', t: 'Recover account', i: [['field', 'Word 1', 'moon'], ['field', 'Word 2', 'bridge', 1], ['text', '… up to word 12'], ['btn', 'Recover']] } }
      ],
      tech: ['Details', '# the 12 words generate your keys on the phone itself', '# Lunes keeps no copy: without the words, there is no recovery', '# public and anonymous identities come from the same phrase, with separate keys'],
      fim: 'Your account is protected. If you switch phones, just have the paper at hand.' },

    { id: 'phone-node', cat: 'help', icon: 'cell_tower', t: 'Turn on node mode on your phone', sum: 'Your phone starts storing and delivering other people’s messages, without being able to read any.', time: '10 min + 7 days', lvl: 'Medium',
      needs: ['Piu up to date', '10 LUNES in your wallet for the deposit', '2 contacts who are already nodes to endorse you', 'A charger nearby (recommended)'],
      steps: [
        { t: 'Open Settings → Node mode', d: 'Tap “From this phone”. The app explains what changes and how much the phone will lend.', s: { f: 'p', t: 'Node mode', i: [['row', 'smartphone', 'From this phone', 'this device becomes a node', 1, 1], ['row', 'router', 'From a device', 'router, computer, radio', 0, 1]] } },
        { t: 'Choose how much to lend', d: 'The default is 2 GB of space, with messages kept for up to 14 days. The phone only helps with battery above 30%. You can change it later.', s: { f: 'p', t: 'Limits', i: [['row', 'sd_card', 'Space for others', '2 GB'], ['tog', 'Only while charging', '', 1], ['tog', 'Only on Wi-Fi', '', 0], ['btn', 'Continue', 1]] } },
        { t: 'Pay the deposit', d: '10 LUNES are held while you are a node. Hold the button until the bar fills: that gesture is your signature.', tip: 'The deposit returns to your wallet when you leave.', s: { f: 'p', t: 'Deposit', i: [['big', 'savings', '10 LUNES', 'returned when you leave'], ['hold', 'Hold to pay', 1]] } },
        { t: 'Confirm it’s you', d: 'Use your fingerprint. If asked, also confirm a few of your 12 words.', s: { f: 'p', t: 'Confirm', i: [['big', 'fingerprint', 'Touch the sensor', 'to confirm the deposit'], ['ghost', 'Use phone passcode']] } },
        { t: 'Ask for 2 endorsements', d: 'Pick contacts who are already nodes. Each gets the request and holds to endorse. The request lasts 3 days.', s: { f: 'p', t: 'Ask to endorse', i: [['row', 'person', 'Ana Souza', 'node for 4 months', 1], ['row', 'person', 'Mr. Antônio', 'node for 2 months', 1], ['row', 'person', 'Lia', 'not a node yet'], ['btn', 'Send 2 requests', 1]] } },
        { t: 'Wait out the 7-day trial', d: 'Your phone already helps during these days. The network checks that it really stays available. After that, you’re a node.', s: { f: 'p', t: 'Node mode', i: [['prog', 'Trial · day 3 of 7', '43%'], ['row', 'check_circle', 'Deposit paid', '10 LUNES'], ['row', 'check_circle', 'Endorsements', '2 of 2'], ['row', 'inventory_2', 'Storing now', '61 MB from others']] } },
        { t: 'To leave, whenever you want', d: 'Node mode → Leave node mode. Hold to sign. Stored messages are handed to other nodes and the deposit returns in 7 days.', s: { f: 'p', t: 'Leave', i: [['note', 'schedule', 'The deposit returns in 7 days.'], ['hold', 'Hold to leave', 1]] } }
      ],
      tech: ['Limits in use', 'deposit: 10 LUNES · returned 7 days after leaving', 'endorsements: 2 · each node gives up to 5 per month', 'storage: 2 GB · envelopes expire in 14 days', 'relay: battery > 30% · up to 200 MB/day'],
      fim: 'Your phone now helps carry messages. Track everything in Settings → Node mode.' },

    { id: 'point', cat: 'help', icon: 'storefront', t: 'Create a Piu Point with a venue’s Wi-Fi', sum: 'A bakery, a school or a church becomes a meeting point for messages.', time: '8 min', lvl: 'Easy',
      needs: ['A phone with Piu connected to the venue’s Wi-Fi', 'Being in charge of the venue, or having permission', 'A place where people pass by'],
      steps: [
        { t: 'Open Settings → Piu Points', d: 'Tap Create point. The app explains what a point does and what it doesn’t.', s: { f: 'p', t: 'Piu Points', i: [['big', 'storefront', 'Create a point', 'Everyone passing by swaps messages'], ['btn', 'Create point', 1]] } },
        { t: 'Pick the venue’s network', d: 'Nearby Wi-Fi networks show up. Pick the venue’s. Piu doesn’t ask for the router password or change anything on it.', tip: 'No Wi-Fi? An old phone can create its own network and stay in place.', s: { f: 'p', t: 'Pick network', i: [['row', 'wifi', 'Zé’s Bakery', 'connected', 1], ['row', 'wifi', 'Guests', ''], ['row', 'wifi_tethering', 'Create own network', 'with this phone', 0, 1]] } },
        { t: 'Wait for the automatic test', d: 'The app checks whether the venue’s devices would be visible to visitors. Green: go ahead. Yellow: go ahead carefully. Red: the point won’t turn on.', warn: 'Got red? Ask whoever runs the router to turn on the “guest network” or “client isolation”, then test again.', s: { f: 'p', t: 'Network test', i: [['prog', 'Testing…', '80%'], ['row', 'check_circle', 'Venue devices', 'not visible'], ['row', 'check_circle', 'Piu phones', 'can find each other'], ['row', 'pending', 'Speed', 'measuring']] } },
        { t: 'Choose the point type', d: 'Multiplier: helps phones find each other while there. Guardian: also keeps locked messages until the person passes by.', s: { f: 'p', t: 'Point type', i: [['row', 'device_hub', 'Multiplier', 'light · stores nothing', 0], ['row', 'inventory_2', 'Guardian', 'keeps up to 2 GB locked', 1]] } },
        { t: 'Turn it on with one tap', d: 'Turning on the point doesn’t touch your LUNES. You can pause or end it anytime.', s: { f: 'p', t: 'Before turning on', i: [['note', 'lock', 'No one can read what passes through the point.'], ['note', 'toll', 'Moves no LUNES.'], ['btn', 'Turn on point', 1]] } },
        { t: 'Put up the poster', d: 'Print the poster with the QR and put it near the entrance. Anyone arriving with Piu gets “Piu Point nearby, join?”.', s: { f: 'p', t: 'Poster', i: [['qr', 'Piu Point · Zé’s Bakery'], ['btn', 'Print poster', 1], ['ghost', 'Share']] } },
        { t: 'Follow it on the dashboard', d: 'See how many people passed by and how many messages were delivered. If the network drops, the point pauses on its own.', s: { f: 'p', t: 'Zé’s Bakery', i: [['row', 'groups', 'Visitors today', '38'], ['row', 'done_all', 'Delivered', '214'], ['row', 'inventory_2', 'Storing', '1.1 GB'], ['ghost', 'Pause point']] } }
      ],
      tech: ['How the point works', '# discovery: mDNS _piu._tcp on the local network', '# test: client isolation and open ports', '# guardian: encrypted envelopes, never opened'],
      fim: 'The venue is now a Piu Point. Anyone passing by swaps messages, even offline.' },

    { id: 'openwrt', cat: 'gear', icon: 'router', t: 'Set up a Piu Node on an OpenWrt router', sum: 'A router that’s on 24/7 stores and delivers messages for the neighborhood.', time: '25 min', lvl: 'Medium',
      needs: ['A router with OpenWrt 23.05 or newer, like the GL.iNet GL-MT3000', '256 MB of memory and 1 GB free. A USB stick works.', 'A computer or phone on the router’s Wi-Fi', 'Piu on your phone, to pair'],
      steps: [
        { t: 'Check the router works', d: 'In a browser, open the router’s admin page. The address is usually on the label underneath, like 192.168.8.1. Under Status, check the OpenWrt version and architecture.', s: { f: 'w', t: 'Status', u: '192.168.8.1', i: [['row', 'memory', 'Firmware', 'OpenWrt 23.05.3', 1], ['row', 'developer_board', 'Architecture', 'aarch64', 1], ['row', 'storage', 'Memory', '512 MB']] } },
        { t: 'Download the right package', d: 'On this website, under Download → Piu Node, pick the file named after the architecture from the previous step.', s: { f: 'w', t: 'Piu Node', u: 'piu.lunes.io/node', i: [['row', 'download', 'piu-node_0.4.2_aarch64.ipk', 'ARM 64-bit · GL.iNet, Xiaomi', 1], ['row', 'download', 'piu-node_0.4.2_mipsel.ipk', 'MIPS · older routers'], ['row', 'download', 'piu-node_0.4.2_x86_64.ipk', 'mini-PC with OpenWrt']] } },
        { t: 'Upload and install', d: 'In the router admin: System → Software → Upload package. Pick the file and tap Install. It takes about 2 minutes.', warn: 'Don’t unplug the router during the install.', tip: 'The package verifies its own signature before installing. If it doesn’t match, nothing is installed.', s: { f: 'w', t: 'System › Software', u: '192.168.8.1/cgi-bin/luci', i: [['field', 'Package', 'piu-node_0.4.2_aarch64.ipk'], ['prog', 'Installing…', '70%'], ['btn', 'Install', 1]] },
          tech: ['From a terminal (SSH)', 'scp piu-node_0.4.2_aarch64.ipk root@192.168.8.1:/tmp/', 'ssh root@192.168.8.1', 'opkg update && opkg install /tmp/piu-node_0.4.2_aarch64.ipk', '/etc/init.d/piu-node enable && /etc/init.d/piu-node start'] },
        { t: 'Open the Piu Node dashboard', d: 'In a browser, type piu-node.local:8420. This dashboard only opens inside your network.', s: { f: 'w', t: 'Piu Node', u: 'piu-node.local:8420', i: [['big', 'router', 'Piu Node installed', 'GL-MT3000 · OpenWrt 23.05'], ['btn', 'Pair with phone', 1]] } },
        { t: 'Pair with your phone', d: 'In Piu: Settings → Provider → Add device → Scan QR. Point at the QR on the dashboard.', s: { f: 'p', t: 'Add device', i: [['qr', 'piu-node.local'], ['note', 'router', 'Router found: GL-MT3000']] },
          tech: ['Pair from a terminal', 'piu-node pair', '# prints the QR right in the terminal'] },
        { t: 'Choose what it lends', d: 'Give it a name, choose the space for other people’s messages and which connections to use. Tap Activate.', s: { f: 'p', t: 'Living room router', i: [['tog', 'Wi-Fi Mesh 5 GHz', 'between routers', 1], ['tog', 'Wi-Fi 2.4 GHz', 'for phones', 1], ['tog', 'Ethernet', '3 ports', 1], ['btn', 'Activate', 1]] } }
      ],
      tech: ['Reference', 'local dashboard: http://piu-node.local:8420', 'config: /etc/config/piu-node', 'logs: logread -f | grep piu-node', 'mesh: 802.11s on the 5 GHz radio'],
      fim: 'Your router is a Home Node. The first receipts show up on the dashboard within minutes.' },

    { id: 'linux', cat: 'gear', icon: 'developer_board', t: 'Piu Node on Linux or Raspberry Pi', sum: 'A computer or Raspberry Pi running at home becomes a network node.', time: '15 min', lvl: 'Medium',
      needs: ['Raspberry Pi 4 or 5, or a computer with Debian 12, Ubuntu 22.04 or newer', '2 GB free', 'Plugged in and on your home network', 'Piu on your phone, to pair'],
      steps: [
        { t: 'Pick your path', d: 'New Raspberry Pi? Use the ready image: just flash the card. Already use the computer for other things? Install the package.', s: { f: 'w', t: 'Piu Node', u: 'piu.lunes.io/node', i: [['row', 'sd_card', 'Ready image', 'Raspberry Pi · SD card', 1, 1], ['row', 'terminal', '.deb package', 'Debian, Ubuntu, Raspberry Pi OS', 0, 1]] } },
        { t: 'Flash the image to the card', d: 'Open Raspberry Pi Imager. Under Operating system, choose “Use custom” and select piu-node-0.4.2-rpi.img.xz. Pick the card and tap Write. Then put the card in the Pi and power it on.', s: { f: 'w', t: 'Raspberry Pi Imager', u: '', i: [['field', 'Operating system', 'piu-node-0.4.2-rpi.img.xz'], ['field', 'Storage', 'SD card · 32 GB'], ['btn', 'Write', 1]] } },
        { t: 'Or install the package', d: 'On a computer you already use, open a terminal in the download folder and run the two commands below.', s: { f: 't', t: 'Terminal', i: [['term', ['$ sudo apt install ./piu-node_0.4.2_arm64.deb', 'Verifying signature… ok', 'Setting up piu-node (0.4.2)…', '$ sudo systemctl enable --now piu-node', '● piu-node.service · active (running)']]] },
          tech: ['Which file to get', '# Raspberry Pi and ARM: piu-node_0.4.2_arm64.deb', '# PC and mini-PC: piu-node_0.4.2_amd64.deb', 'dpkg --print-architecture'] },
        { t: 'Pair with your phone', d: 'With the ready image, open piu-node.local:8420 in a browser and tap Pair. With the package, run piu-node pair in the terminal. Scan the QR in Piu: Settings → Provider → Add device.', s: { f: 't', t: 'Terminal', i: [['term', ['$ piu-node pair', 'Scan this QR in Piu:']], ['qr', '']] } },
        { t: 'Check it’s working', d: 'The piu-node.local:8420 dashboard shows neighbors found and delivery receipts. Numbers start climbing within minutes.', s: { f: 'w', t: 'Office Raspberry', u: 'piu-node.local:8420', i: [['row', 'hub', 'Neighbors', '5'], ['row', 'receipt_long', 'Receipts today', '128'], ['row', 'inventory_2', 'Queued', '312 envelopes']] } }
      ],
      tech: ['Reference', 'local dashboard: port 8420 · mDNS piu-node.local', 'config: /etc/piu-node/config.toml', 'logs: journalctl -u piu-node -f', 'status: piu-node status'],
      fim: 'Your computer is a Home Node. Keep it on: the longer it’s online, the more it helps.' },

    { id: 'lora', cat: 'gear', icon: 'settings_input_antenna', t: 'Add a LoRa radio', sum: 'Carry short messages for kilometers, neighborhood to neighborhood.', time: '30 min', lvl: 'Advanced',
      needs: ['A 915 MHz USB LoRa radio certified for your country, like an SX1262', 'An external antenna', 'A working Piu Node: Linux, Raspberry Pi or mini-PC', 'A high spot: window, rooftop'],
      steps: [
        { t: 'Check certification', d: 'Only use radios certified for 915 MHz in your country (Anatel in Brazil). Power is limited by law and Piu respects that limit.', warn: 'Uncertified radios can interfere with other services and are prohibited.', s: { f: 'p', t: 'Radio', i: [['big', 'verified', 'Certified', '915 MHz · license-free'], ['note', 'info', 'The certification number is on the radio’s label.']] } },
        { t: 'Attach the antenna before powering on', d: 'Screw the antenna onto the radio. Take it to the highest spot you can, away from concrete walls.', warn: 'Powering the radio without an antenna can burn it out.', s: { f: 'p', t: 'Setup', i: [['row', 'settings_input_antenna', '1. Antenna', 'screwed on', 1], ['row', 'usb', '2. USB cable', 'only after the antenna'], ['row', 'roofing', '3. High spot', 'window or rooftop']] } },
        { t: 'Plug the radio into the node’s USB', d: 'Piu Node detects it and shows “LoRa radio found” on the dashboard. Tap Use this radio.', s: { f: 'w', t: 'Connections', u: 'piu-node.local:8420', i: [['row', 'settings_input_antenna', 'USB LoRa radio', 'SX1262 · ttyACM0', 1], ['btn', 'Use this radio', 1]] },
          tech: ['From a terminal', 'ls /dev/ttyACM*', 'piu-node radio list', 'piu-node radio enable lora0 --region BR915'] },
        { t: 'Turn it on from your phone', d: 'In Piu: Settings → Provider → pick the device → Connections. Turn on LoRa 915 MHz.', s: { f: 'p', t: 'Garage mini-PC', i: [['tog', 'LoRa 915 MHz', 'text and alerts only', 1, 1], ['tog', 'Wi-Fi 6', 'mesh', 1], ['tog', 'Ethernet', '2 ports', 1]] } },
        { t: 'Measure the range', d: 'The test counts how many neighboring radios yours hears, and how far. Ask someone with another radio to help, or wait for neighbors to show up.', s: { f: 'p', t: 'Range test', i: [['prog', 'Listening…', '75%'], ['row', 'hub', 'Radios heard', '4'], ['row', 'straighten', 'Farthest', '4.1 km']] } },
        { t: 'Know what goes over radio', d: 'Only short text and alerts, like Civil Defense ones. Photos, videos and files never go over radio: they wait for Wi-Fi.', s: { f: 'p', t: 'LoRa 915 MHz', i: [['row', 'chat', 'Text', 'goes through', 1], ['row', 'warning', 'Official alerts', 'go through, with priority', 1], ['row', 'image_not_supported', 'Photos and videos', 'never']] } }
      ],
      tech: ['Reference', 'region: BR915 · 902–907.5 and 915–928 MHz', 'power and duty cycle limited by the node', 'typical rate: ~5.5 kbps · text and alerts only'],
      fim: 'Your node now speaks radio. Short messages reach neighborhoods with no Wi-Fi or internet.' },

    { id: 'desktop', cat: 'desk', icon: 'laptop_mac', t: 'Piu Desktop on Mac and Linux', sum: 'Install it on your computer and mirror your phone’s chats safely.', time: '6 min', lvl: 'Easy',
      needs: ['macOS 12 or newer, or Linux: Ubuntu 20.04+, Debian 11+, Fedora 36+', 'Piu on your phone', 'Phone and computer close together'],
      steps: [
        { t: 'Download and install', d: 'On Mac, open the .dmg file and drag Piu to Applications. On Linux, download the AppImage, make it executable and open it.', s: { f: 'w', t: 'Piu-0.1.4-arm64.dmg', u: '', i: [['big', 'download_done', 'Drag Piu to Applications', ''], ['row', 'apps', 'Applications', 'drop here', 1]] },
          tech: ['Other ways', 'brew install --cask piu', 'flatpak install flathub network.lunes.Piu', 'chmod +x Piu-0.1.4-x86_64.AppImage'] },
        { t: 'Choose “Pair with phone”', d: 'Three options appear on first launch. Pairing mirrors your phone’s account, which is the most common.', s: { f: 'w', t: 'Piu', u: '', i: [['row', 'qr_code_scanner', 'Pair with phone', 'recommended', 1, 1], ['row', 'key', 'Restore with 12 words', '', 0, 1], ['row', 'person_add', 'Identity for this computer only', '', 0, 1]] } },
        { t: 'Scan the QR with your phone', d: 'In Piu on your phone: Profile → Linked devices → Link. Point at the QR on the computer. It changes every 30 seconds.', s: { f: 'w', t: 'Pair', u: '', i: [['qr', 'changes in 24 s'], ['text', 'Profile → Linked devices → Link']] } },
        { t: 'Check the 3 words', d: 'Your phone shows 3 words. On the computer, pick the third out of four options. It proves nobody got in the middle.', s: { f: 'w', t: 'Confirm', u: '', i: [['text', 'moon · bridge · ?'], ['words', ['river', 'salt', 'sea', 'bread'], 1]] } },
        { t: 'Done: chats mirrored', d: 'Chats and contacts show up on the computer. Payments requested there only go out after you approve them on your phone.', tip: 'To unlink, use Profile → Linked devices on your phone.', s: { f: 'w', t: 'Piu', u: '', i: [['row', 'forum', 'Street work party', 'Lia: I’ll bring a 10 m extension cord'], ['row', 'person', 'Ana Souza', 'delivered'], ['note', 'front_hand', 'The computer never pays on its own.']] } }
      ],
      fim: 'Piu is on your computer. The phone still calls the shots: the computer mirrors.' },

    { id: 'troubleshoot', cat: 'fix', icon: 'build', t: 'Fix common issues', sum: 'The questions that come up most, and what to do about each.', time: '—', lvl: 'Easy', kind: 'prob',
      needs: [],
      steps: [
        { t: 'My message stays on “waiting”', d: 'That’s normal when nobody with Piu is nearby. It goes out on its own once a path appears. Make sure Wi-Fi and Bluetooth are on and open the app near other people.' },
        { t: 'Android won’t let me install', d: 'Open Settings → Apps → Special access → Install unknown apps, pick your browser and turn on “Allow from this source”. If Play Protect warns you, tap “More details” and “Install anyway”, but only after checking the code.' },
        { t: 'I can’t find my friend’s phone to pass the app', d: 'Turn on Wi-Fi and location on both phones: Android requires location to create the invite. Stay within 10 meters and reopen the invite.' },
        { t: 'My phone gets hot or drains battery', d: 'In Node mode, turn on “Only while charging” and lower the space you lend. Outside node mode, Piu only relays with battery above 30%.' },
        { t: 'The Piu Point test came back red', d: 'The venue’s devices would be visible to visitors. Ask whoever runs the router to turn on the guest network or client isolation, then run the test again.' },
        { t: 'piu-node.local won’t open', d: 'Make sure your computer or phone is on the same Wi-Fi as the node. Try the device’s number instead, like 192.168.8.1:8420. In a terminal, piu-node status shows whether the service is running.' },
        { t: 'The computer’s QR won’t scan', d: 'Turn up screen brightness and bring the phone closer. The QR changes every 30 seconds: if it takes too long, wait for the next one.' },
        { t: 'I lost my phone', d: 'Install Piu on another phone and recover with your 12 words. If a computer was linked, remove the lost device under Profile → Linked devices.' },
        { t: 'My LUNES transfer won’t confirm', d: 'Offline, it travels across the mesh to a gateway and can take hours or days. It only shows “confirmed” once your phone checks it on the Lunes network. Meanwhile, no other transfer leaves your wallet.' }
      ],
      fim: 'Still stuck? Ask in a public channel of your community, right inside Piu.' }
  ]
}
};
