(function () {
var A = window.PIU_AJUDA; if (!A) return;
function add(lang, cat, guides) {
  var L = A[lang]; if (L.cats.some(function (c) { return c.id === 'ant'; })) return;
  var gi = L.cats.findIndex(function (c) { return c.id === 'gear'; });
  L.cats.splice(gi + 1, 0, cat);
  var di = L.guides.findIndex(function (g) { return g.cat === 'desk'; });
  L.guides.splice.apply(L.guides, [di, 0].concat(guides));
}
add('pt', { id: 'ant', t: 'Antenas', d: 'Do caseiro ao profissional, para quem gosta de pôr a mão na massa' }, [
  { id: 'ant-basics', cat: 'ant', icon: 'school', t: 'Antes de montar: o que faz um rádio chegar longe', sum: 'Altura, visada, cabo, ganho e limite legal. O que decide o alcance de verdade.', time: '10 min de leitura', lvl: 'Amador',
    needs: [],
    steps: [
      { t: 'Altura vale mais que ganho', d: 'Em 915 MHz o sinal anda quase em linha reta. Telhados, árvores e morros bloqueiam. Subir a antena alguns metros costuma render mais do que trocar por uma antena “mais forte”.', s: { f: 'w', t: 'Exemplo de alcance', u: 'piu-node.local:8420', i: [['row', 'window', 'Antena na janela · 3 m', '~800 m'], ['row', 'roofing', 'No telhado · 8 m', '~2,5 km'], ['row', 'water_drop', 'Na caixa-d’água · 15 m', '~5 km', 1], ['note', 'info', 'Valores de exemplo em área urbana. Varia muito de lugar para lugar.']] } },
      { t: 'Enxergue o outro lado, com folga', d: 'Além de “ver” a outra antena, o caminho precisa de espaço livre ao redor da linha reta entre elas: a zona de Fresnel. Mantenha pelo menos 60% dela sem obstáculos.', s: { f: 'w', t: 'Calculadora de enlace', u: 'piu-node.local:8420', i: [['field', 'Distância', '4 km'], ['field', 'Frequência', '915 MHz'], ['row', 'straighten', 'Folga mínima no meio', '10,9 m', 1]] },
        tech: ['Zona de Fresnel', 'r = 8,66 × √(D_km ÷ f_GHz)   # metros, no meio do enlace', '# 4 km em 915 MHz: r ≈ 18,1 m', '# 60% livre ≈ 10,9 m acima de telhados e copas'] },
      { t: 'Ganho é foco, não potência', d: 'Uma omni de 3 dBi espalha o sinal em volta, inclusive para baixo. Uma omni de 8 dBi achata o sinal como um disco: vai mais longe no plano, mas atende pior quem está bem abaixo dela. Uma Yagi joga quase tudo para um lado só.', s: { f: 'w', t: 'Qual antena', u: '', i: [['row', 'radio_button_checked', 'Omni 2–3 dBi', 'bairro em volta, terreno irregular'], ['row', 'trip_origin', 'Omni 6–8 dBi', 'mais longe, terreno plano', 1], ['row', 'arrow_right_alt', 'Yagi 10–13 dBi', 'um ponto distante']] } },
      { t: 'Cabo come sinal', d: 'Cada metro de cabo perde parte do sinal. Use o cabo mais curto possível, ou leve o rádio para perto da antena e desça só um cabo de rede.', s: { f: 'w', t: 'Perda em 915 MHz', u: '', i: [['row', 'cable', 'RG-174', '~1,0 dB por metro'], ['row', 'cable', 'RG-58', '~0,5 dB por metro'], ['row', 'cable', 'LMR-240', '~0,25 dB por metro'], ['row', 'cable', 'LMR-400', '~0,13 dB por metro', 1]] },
        tech: ['Conta rápida', '# cada 3 dB perdidos = metade da potência', '# 10 m de RG-58 ≈ 5 dB ≈ só 1/3 chega à antena', '# 10 m de LMR-400 ≈ 1,3 dB'] },
      { t: 'Respeite o limite legal', d: 'A faixa de 915 MHz tem limite de potência irradiada. Informe ao Piu o ganho da antena e a perda do cabo: ele ajusta a potência do rádio sozinho.', warn: 'Não altere o firmware do rádio para passar do limite. Além de proibido, atrapalha outros serviços e a própria rede.', s: { f: 'p', t: 'Antena', i: [['field', 'Ganho da antena', '8 dBi', 1], ['field', 'Cabo', 'LMR-400 · 6 m'], ['row', 'tune', 'Potência do rádio', 'ajustada ao limite', 1]] } },
      { t: 'Mesma polarização dos dois lados', d: 'Antenas em pé conversam com antenas em pé. Se uma estiver deitada, perde-se a maior parte do sinal. Na rede Piu, o padrão é vertical.' }
    ],
    fim: 'Agora escolha o seu nível: comece pela antena caseira ou vá direto para o telhado.' },

  { id: 'ant-groundplane', cat: 'ant', icon: 'construction', t: 'Antena caseira de ¼ de onda (ground plane)', sum: 'Um conector, fio de cobre e uma hora de trabalho. Costuma superar a antena que vem com o rádio.', time: '1 h', lvl: 'Amador',
    needs: ['Conector SMA ou N fêmea de painel, com 4 furos', '50 cm de fio de cobre rígido de 2,5 mm², ou vareta de latão', 'Ferro de solda, estanho, alicate e régua', 'Um pedaço de cano de PVC com tampa (opcional)'],
    steps: [
      { t: 'Entenda as medidas', d: 'Em 915 MHz, uma onda tem cerca de 328 mm. A antena usa um quarto disso: um fio em pé de cerca de 82 mm e quatro fios “radiais” um pouco maiores, inclinados para baixo.', s: { f: 'w', t: 'Medidas para 915 MHz', u: '', i: [['row', 'height', 'Elemento vertical', 'corte 84 mm, ajuste até ~82', 1], ['row', 'call_split', 'Radiais × 4', '88 mm cada'], ['row', 'rotate_right', 'Ângulo dos radiais', '45° para baixo'], ['row', 'electric_bolt', 'Impedância', '≈ 50 Ω com radiais a 45°']] },
        tech: ['Cálculo', 'λ = 300 ÷ 915 = 0,328 m', '¼ λ = 82 mm', '# corte 2–3 mm a mais e apare medindo'] },
      { t: 'Solde o elemento vertical', d: 'Corte 84 mm de fio. Solde no pino central do conector, bem reto. Deixe esfriar sem mexer.', tip: 'Raspe a ponta do fio e passe estanho nela antes de soldar. A solda pega mais rápido e esquenta menos o conector.' },
      { t: 'Solde os 4 radiais', d: 'Corte 4 fios de 88 mm. Solde um em cada furo do conector, formando uma cruz. Dobre todos para baixo, a cerca de 45°.', warn: 'Os radiais não podem encostar no pino central nem no elemento vertical.' },
      { t: 'Ajuste o comprimento', d: 'Com um NanoVNA ou medidor de ROE, apare o elemento vertical 1 mm por vez até a ROE ficar abaixo de 1,5 em 915 MHz. Sem medidor? Deixe em 82 mm: já funciona bem.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'tune', 'Frequência', '915 MHz'], ['row', 'monitoring', 'ROE (SWR)', '1,32', 1], ['row', 'trending_down', 'Perda de retorno', '−17 dB']] } },
      { t: 'Proteja da chuva', d: 'Coloque a antena dentro de um cano de PVC com tampa, ou passe silicone neutro na base. Água no conector estraga o sinal em poucas semanas.' },
      { t: 'Ligue e teste no Piu', d: 'Rosqueie a antena no rádio, informe o ganho (cerca de 2 dBi para esta antena) e rode o teste de alcance. Compare com a antena original.', s: { f: 'p', t: 'Antena', i: [['field', 'Tipo', 'Ground plane caseira'], ['field', 'Ganho', '2 dBi'], ['btn', 'Testar alcance', 1]] } }
    ],
    tech: ['Resumo', 'ganho típico: ~2 dBi · omnidirecional · polarização vertical', 'custo aproximado do material: menos que uma pizza', 'variação: dipolo de ½ onda com 2 braços de ~78 mm'],
    fim: 'Sua primeira antena está pronta. Coloque-a o mais alto que puder: é aí que ela rende.' },

  { id: 'ant-tuning', cat: 'ant', icon: 'monitoring', t: 'Medir e ajustar a antena com NanoVNA', sum: 'Confira se a antena está sintonizada em 915 MHz antes de subir no telhado.', time: '30 min', lvl: 'Intermediário',
    needs: ['NanoVNA (V2 ou H4) com o kit de calibração', 'Cabo SMA curto', 'A antena montada, longe de paredes e objetos de metal'],
    steps: [
      { t: 'Calibre o aparelho', d: 'Configure a varredura de 850 a 980 MHz. Calibre na ponta do cabo que vai à antena, com as peças do kit: OPEN, SHORT e LOAD, nesta ordem.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['field', 'Início', '850 MHz'], ['field', 'Fim', '980 MHz'], ['row', 'checklist', 'Calibração', 'OPEN · SHORT · LOAD', 1]] } },
      { t: 'Meça a antena', d: 'Ligue a antena e olhe a curva de ROE (SWR). O ponto mais baixo da curva mostra em que frequência a antena está sintonizada.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'south', 'Ponto mais baixo', '889 MHz', 1], ['row', 'monitoring', 'ROE em 915 MHz', '2,1']] } },
      { t: 'Interprete o resultado', d: 'Ponto mais baixo abaixo de 915 MHz: a antena está comprida, corte um pouco. Acima de 915: está curta, faça um elemento novo. ROE até 1,5 é ótimo; até 2 é aceitável.',
        tech: ['Referência rápida', 'ROE 1,5 ≈ 4% da potência volta', 'ROE 2,0 ≈ 11% volta', '1 mm no elemento de ¼ λ ≈ 11 MHz de deslocamento'] },
      { t: 'Apare aos poucos', d: 'Corte 1 mm de cada vez e meça de novo. É fácil cortar e impossível colar.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'south', 'Ponto mais baixo', '914 MHz', 1], ['row', 'monitoring', 'ROE em 915 MHz', '1,28', 1]] } },
      { t: 'Meça de novo no lugar final', d: 'Mastro, telhado e cabo mudam a sintonia. Depois de instalar, meça de novo pela ponta do cabo que chega ao rádio.' }
    ],
    fim: 'Antena sintonizada. Anote a ROE final: ela ajuda a perceber se algo estragou com o tempo.' },

  { id: 'ant-wifi', cat: 'ant', icon: 'wifi', t: 'Wi-Fi externo para uma praça ou rua', sum: 'Um roteador de área externa com OpenWrt cobre uma praça inteira para os celulares com Piu.', time: '2 h', lvl: 'Intermediário',
    needs: ['Roteador ou access point de área externa compatível com OpenWrt, em 2,4 GHz', 'Fonte PoE e cabo de rede blindado para área externa', 'Autorização do dono do imóvel', 'Um Piu Node na rede. Pode ser o próprio roteador.'],
    steps: [
      { t: 'Escolha a antena pelo formato do lugar', d: 'Praça redonda: omni no centro. Rua comprida: setorial ou painel apontado ao longo da rua. Prefira 2,4 GHz: atravessa melhor as árvores e todo celular tem.', s: { f: 'w', t: 'Qual antena', u: '', i: [['row', 'radio_button_checked', 'Omni 2,4 GHz', 'praça, quintal grande'], ['row', 'change_history', 'Setorial 90°', 'rua, campo de futebol', 1], ['row', 'crop_portrait', 'Painel 14 dBi', 'um prédio distante']] } },
      { t: 'Instale no alto, mas nem tanto', d: 'Entre 4 e 8 metros. Muito alto, o celular até recebe a antena, mas a antena não ouve o celular de volta: celular tem pouca potência.', tip: 'Setoriais costumam ficar inclinadas de 5° a 10° para baixo.' },
      { t: 'Instale o OpenWrt e o Piu Node', d: 'Siga o guia “Montar um Piu Node no roteador OpenWrt”. Ligue só o Wi-Fi 2,4 GHz para celulares e a ligação com o nó principal.' },
      { t: 'Crie a rede aberta da praça', d: 'Crie uma rede com nome como piu.praca-central e isolamento de clientes ligado. Os celulares não se enxergam direto, só pelo Piu Node.',
        tech: ['Pelo terminal (OpenWrt)', 'uci set wireless.piu=wifi-iface', "uci set wireless.piu.device='radio0'", "uci set wireless.piu.mode='ap'", "uci set wireless.piu.ssid='piu.praca-central'", "uci set wireless.piu.isolate='1'", "uci set wireless.piu.network='piu'", 'uci commit wireless && wifi reload'] },
      { t: 'Meça a cobertura andando', d: 'Ande pela praça com o Piu aberto em Ajustes → Diagnóstico. Onde o sinal ficar abaixo de −75 dBm, considere um segundo ponto.', s: { f: 'p', t: 'Diagnóstico', i: [['row', 'wifi', 'Rede', 'piu.praca-central'], ['row', 'signal_cellular_alt', 'Sinal', '−68 dBm', 1], ['row', 'hub', 'Vizinhos Piu', '12']] } }
    ],
    fim: 'A praça tem cobertura Piu. Quem passa entra na malha sem precisar de internet.' },

  { id: 'ant-roof', cat: 'ant', icon: 'roofing', t: 'Antena omni profissional no telhado', sum: 'Fibra de vidro, cabo de baixa perda, conectores N e aterramento. Uma instalação para durar anos.', time: '1 dia', lvl: 'Profissional',
    needs: ['Antena omni de fibra de vidro para 915 MHz, de 5 a 8 dBi, com conector N', 'Mastro galvanizado de 1¼" e dois suportes', 'Cabo LMR-400 ou equivalente, com conectores N crimpados', 'Protetor de surto coaxial e haste de aterramento', 'Fita autofusão e fita isolante com proteção UV', 'Uma segunda pessoa para ajudar'],
    steps: [
      { t: 'Planeje o lugar', d: 'Escolha o ponto mais alto e livre, acima da caixa-d’água e de antenas de TV. Fique longe dos fios de energia: no mínimo 1,5 vez a altura do mastro.', warn: 'Nunca instale perto da rede elétrica. Se o mastro cair, ele não pode alcançar fio nenhum.' },
      { t: 'Decida onde fica o rádio', d: 'Rádio embaixo e cabo coaxial subindo: mais simples, mas perde sinal no cabo. Rádio numa caixa vedada junto da antena e cabo de rede descendo: perde quase nada. Acima de 10 m de cabo, prefira a caixa no alto.', s: { f: 'w', t: 'Comparação', u: '', i: [['row', 'cable', 'Rádio embaixo · 15 m de LMR-400', '−2 dB'], ['row', 'settings_ethernet', 'Rádio no alto · cabo de rede', '≈ 0 dB', 1]] },
        tech: ['Caixa no alto', '# caixa IP65 com Raspberry Pi + rádio LoRa USB', '# alimentação PoE 802.3af pelo mesmo cabo de rede', 'piu-node radio enable lora0 --region BR915 --antenna-gain 6 --cable-loss 0.3'] },
      { t: 'Monte o mastro', d: 'Fixe o mastro com dois suportes afastados pelo menos 50 cm. A antena fica no topo, sem nada de metal na altura dela num raio de 1 metro.' },
      { t: 'Passe e vede o cabo', d: 'Antes de o cabo entrar na casa, faça uma curva para baixo, como uma gota, para a água escorrer. Nos conectores externos, enrole fita autofusão esticada e cubra com fita isolante UV.', tip: 'Prenda o cabo no mastro a cada 50 cm com abraçadeira UV. Cabo balançando quebra o conector.' },
      { t: 'Aterre e proteja contra raios', d: 'Instale o protetor de surto na entrada da casa e ligue-o à haste de aterramento com cabo de cobre de 10 mm² ou mais. Aterre também o mastro.', warn: 'Aterramento malfeito é pior que nenhum. Na dúvida, chame um eletricista.' },
      { t: 'Meça e informe ao Piu', d: 'Meça a ROE pela ponta do cabo (veja o guia do NanoVNA). No Piu, informe o ganho da antena e a perda do cabo: a potência é ajustada ao limite legal.', s: { f: 'p', t: 'Antena do telhado', i: [['field', 'Ganho', '6 dBi'], ['field', 'Cabo', 'LMR-400 · 15 m · 2 dB'], ['row', 'tune', 'Potência do rádio', 'ajustada ao limite', 1], ['btn', 'Salvar']] } }
    ],
    fim: 'Instalação pronta para anos. Revise conectores e fitas a cada 6 meses.' },

  { id: 'ant-yagi', cat: 'ant', icon: 'arrow_right_alt', t: 'Enlace direcional com Yagi entre bairros', sum: 'Duas antenas apontadas uma para a outra ligam pontos a vários quilômetros.', time: '2 a 4 h', lvl: 'Profissional',
    needs: ['Duas antenas Yagi de 915 MHz, de 10 a 13 dBi', 'Dois Piu Nodes com rádio LoRa, um em cada ponta', 'Mastros firmes nas duas pontas', 'Bússola ou app de mapa, e alguém do outro lado com celular'],
    steps: [
      { t: 'Faça a conta antes de comprar', d: 'Potência + ganho das antenas − perdas nos cabos − perda no caminho precisa ficar bem acima da sensibilidade do rádio. No mundo real, desconte de 20 a 30 dB do resultado ideal.', s: { f: 'w', t: 'Calculadora de enlace', u: 'piu-node.local:8420', i: [['field', 'Distância', '10 km'], ['row', 'trending_down', 'Perda no caminho', '111,7 dB'], ['row', 'signal_cellular_alt', 'Recebido (ideal)', '−76 dBm'], ['row', 'verified', 'Folga sobre a sensibilidade', '53 dB', 1]] },
        tech: ['Cálculo de enlace', 'FSPL(dB) = 32,45 + 20·log10(f_MHz) + 20·log10(D_km)', '# 915 MHz, 10 km: 32,45 + 59,2 + 20 = 111,7 dB', 'Prx = Ptx + Gtx + Grx − cabos − FSPL', '# 14 + 12 + 12 − 2 − 111,7 ≈ −76 dBm', '# sensibilidade LoRa SF9 ≈ −129 dBm'] },
      { t: 'Confirme a visada', d: 'Num mapa de relevo, veja se não há morro no meio. Da ponta A, com binóculo, tente enxergar a ponta B. Lembre da folga de Fresnel do guia “Antes de montar”.' },
      { t: 'Monte com a mesma polarização', d: 'Os elementos das duas Yagis precisam estar na mesma posição: em pé nas duas pontas. Na rede Piu, o padrão é vertical.' },
      { t: 'Aponte pela bússola', d: 'Pelo mapa, aponte a Yagi A na direção da B. Do outro lado, faça o mesmo. Aperte só o suficiente para ainda conseguir girar.' },
      { t: 'Ajuste fino pelo sinal', d: 'Abra o teste de alinhamento no Piu. Gire a antena 2° por vez e pare onde o sinal ficar mais forte. Depois, o outro lado faz o mesmo.', s: { f: 'p', t: 'Alinhamento', i: [['prog', 'Sinal agora · −92 dBm', '68%'], ['row', 'star', 'Melhor até agora', '−89 dBm', 1], ['btn', 'Fixar posição', 1]] },
        tech: ['Pelo terminal', 'piu-node radio align lora0 --peer piu.serra-norte', '# mostra RSSI e SNR a cada segundo'] },
      { t: 'Trave e registre', d: 'Aperte as abraçadeiras, marque a posição com fita e anote o azimute e o sinal. Se o sinal cair no futuro, você sabe para onde voltar.' }
    ],
    fim: 'Os dois bairros estão ligados. Mensagens curtas e alertas cruzam a distância sem internet.' }
]);

add('en', { id: 'ant', t: 'Antennas', d: 'From homemade to professional, for hands-on tinkerers' }, [
  { id: 'ant-basics', cat: 'ant', icon: 'school', t: 'Before you build: what makes a radio reach far', sum: 'Height, line of sight, cable, gain and the legal limit. What really decides range.', time: '10 min read', lvl: 'Hobbyist',
    needs: [],
    steps: [
      { t: 'Height beats gain', d: 'At 915 MHz the signal travels almost in a straight line. Roofs, trees and hills block it. Raising the antenna a few meters usually does more than swapping for a “stronger” antenna.', s: { f: 'w', t: 'Range example', u: 'piu-node.local:8420', i: [['row', 'window', 'Antenna at a window · 3 m', '~800 m'], ['row', 'roofing', 'On the roof · 8 m', '~2.5 km'], ['row', 'water_drop', 'On the water tank · 15 m', '~5 km', 1], ['note', 'info', 'Example values in an urban area. Varies a lot by place.']] } },
      { t: 'See the other side, with clearance', d: 'Besides “seeing” the other antenna, the path needs free space around the straight line between them: the Fresnel zone. Keep at least 60% of it clear.', s: { f: 'w', t: 'Link calculator', u: 'piu-node.local:8420', i: [['field', 'Distance', '4 km'], ['field', 'Frequency', '915 MHz'], ['row', 'straighten', 'Minimum clearance at midpoint', '10.9 m', 1]] },
        tech: ['Fresnel zone', 'r = 8.66 × √(D_km ÷ f_GHz)   # meters, at link midpoint', '# 4 km at 915 MHz: r ≈ 18.1 m', '# 60% clear ≈ 10.9 m above roofs and treetops'] },
      { t: 'Gain is focus, not power', d: 'A 3 dBi omni spreads the signal around, including downward. An 8 dBi omni flattens it like a disc: farther on the horizon, worse for anyone far below. A Yagi throws almost everything one way.', s: { f: 'w', t: 'Which antenna', u: '', i: [['row', 'radio_button_checked', 'Omni 2–3 dBi', 'around the neighborhood, hilly terrain'], ['row', 'trip_origin', 'Omni 6–8 dBi', 'farther, flat terrain', 1], ['row', 'arrow_right_alt', 'Yagi 10–13 dBi', 'one distant point']] } },
      { t: 'Cable eats signal', d: 'Every meter of cable loses some signal. Use the shortest cable you can, or move the radio next to the antenna and run only a network cable down.', s: { f: 'w', t: 'Loss at 915 MHz', u: '', i: [['row', 'cable', 'RG-174', '~1.0 dB per meter'], ['row', 'cable', 'RG-58', '~0.5 dB per meter'], ['row', 'cable', 'LMR-240', '~0.25 dB per meter'], ['row', 'cable', 'LMR-400', '~0.13 dB per meter', 1]] },
        tech: ['Quick math', '# every 3 dB lost = half the power', '# 10 m of RG-58 ≈ 5 dB ≈ only 1/3 reaches the antenna', '# 10 m of LMR-400 ≈ 1.3 dB'] },
      { t: 'Respect the legal limit', d: 'The 915 MHz band has a radiated power limit. Tell Piu your antenna gain and cable loss: it sets the radio power for you.', warn: 'Don’t modify the radio firmware to exceed the limit. It’s illegal and it disrupts other services and the network itself.', s: { f: 'p', t: 'Antenna', i: [['field', 'Antenna gain', '8 dBi', 1], ['field', 'Cable', 'LMR-400 · 6 m'], ['row', 'tune', 'Radio power', 'set to the limit', 1]] } },
      { t: 'Same polarization on both ends', d: 'Upright antennas talk to upright antennas. If one is lying flat, most of the signal is lost. On the Piu network, vertical is the standard.' }
    ],
    fim: 'Now pick your level: start with the homemade antenna or go straight to the roof.' },

  { id: 'ant-groundplane', cat: 'ant', icon: 'construction', t: 'Homemade ¼-wave antenna (ground plane)', sum: 'A connector, copper wire and an hour of work. It usually beats the antenna that ships with the radio.', time: '1 h', lvl: 'Hobbyist',
    needs: ['Female SMA or N panel connector with 4 holes', '50 cm of solid 2.5 mm² copper wire, or brass rod', 'Soldering iron, solder, pliers and a ruler', 'A piece of PVC pipe with a cap (optional)'],
    steps: [
      { t: 'Understand the measurements', d: 'At 915 MHz, one wavelength is about 328 mm. The antenna uses a quarter of that: an upright wire of about 82 mm and four slightly longer “radials” angled downward.', s: { f: 'w', t: 'Measurements for 915 MHz', u: '', i: [['row', 'height', 'Vertical element', 'cut 84 mm, trim to ~82', 1], ['row', 'call_split', 'Radials × 4', '88 mm each'], ['row', 'rotate_right', 'Radial angle', '45° downward'], ['row', 'electric_bolt', 'Impedance', '≈ 50 Ω with radials at 45°']] },
        tech: ['Math', 'λ = 300 ÷ 915 = 0.328 m', '¼ λ = 82 mm', '# cut 2–3 mm long and trim while measuring'] },
      { t: 'Solder the vertical element', d: 'Cut 84 mm of wire. Solder it to the connector’s center pin, perfectly straight. Let it cool without moving it.', tip: 'Scrape and tin the wire tip before soldering. The joint takes faster and heats the connector less.' },
      { t: 'Solder the 4 radials', d: 'Cut 4 wires of 88 mm. Solder one into each connector hole, forming a cross. Bend them all down to about 45°.', warn: 'Radials must not touch the center pin or the vertical element.' },
      { t: 'Trim to length', d: 'With a NanoVNA or SWR meter, trim the vertical element 1 mm at a time until SWR is below 1.5 at 915 MHz. No meter? Leave it at 82 mm: it already works well.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'tune', 'Frequency', '915 MHz'], ['row', 'monitoring', 'SWR', '1.32', 1], ['row', 'trending_down', 'Return loss', '−17 dB']] } },
      { t: 'Weatherproof it', d: 'Put the antenna inside a capped PVC pipe, or seal the base with neutral-cure silicone. Water in the connector ruins the signal within weeks.' },
      { t: 'Connect and test in Piu', d: 'Screw the antenna onto the radio, enter its gain (about 2 dBi for this design) and run the range test. Compare with the stock antenna.', s: { f: 'p', t: 'Antenna', i: [['field', 'Type', 'Homemade ground plane'], ['field', 'Gain', '2 dBi'], ['btn', 'Test range', 1]] } }
    ],
    tech: ['Summary', 'typical gain: ~2 dBi · omnidirectional · vertical polarization', 'approximate material cost: less than a pizza', 'variant: ½-wave dipole with two ~78 mm arms'],
    fim: 'Your first antenna is ready. Mount it as high as you can: that’s where it pays off.' },

  { id: 'ant-tuning', cat: 'ant', icon: 'monitoring', t: 'Measure and tune with a NanoVNA', sum: 'Check the antenna is tuned to 915 MHz before you climb the roof.', time: '30 min', lvl: 'Intermediate',
    needs: ['NanoVNA (V2 or H4) with its calibration kit', 'A short SMA cable', 'The finished antenna, away from walls and metal objects'],
    steps: [
      { t: 'Calibrate the device', d: 'Set the sweep from 850 to 980 MHz. Calibrate at the end of the cable that goes to the antenna, using the kit pieces: OPEN, SHORT and LOAD, in that order.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['field', 'Start', '850 MHz'], ['field', 'Stop', '980 MHz'], ['row', 'checklist', 'Calibration', 'OPEN · SHORT · LOAD', 1]] } },
      { t: 'Measure the antenna', d: 'Connect the antenna and look at the SWR curve. Its lowest point shows the frequency the antenna is tuned to.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'south', 'Lowest point', '889 MHz', 1], ['row', 'monitoring', 'SWR at 915 MHz', '2.1']] } },
      { t: 'Read the result', d: 'Lowest point below 915 MHz: the antenna is long, trim a little. Above 915: it’s short, make a new element. SWR up to 1.5 is great; up to 2 is acceptable.',
        tech: ['Quick reference', 'SWR 1.5 ≈ 4% of power reflected', 'SWR 2.0 ≈ 11% reflected', '1 mm on a ¼ λ element ≈ 11 MHz shift'] },
      { t: 'Trim a little at a time', d: 'Cut 1 mm at a time and measure again. Cutting is easy; un-cutting is impossible.', s: { f: 'w', t: 'NanoVNA', u: '', i: [['row', 'south', 'Lowest point', '914 MHz', 1], ['row', 'monitoring', 'SWR at 915 MHz', '1.28', 1]] } },
      { t: 'Measure again in place', d: 'Mast, roof and cable shift the tuning. After installing, measure again from the cable end that reaches the radio.' }
    ],
    fim: 'Antenna tuned. Write down the final SWR: it helps you notice if something degrades over time.' },

  { id: 'ant-wifi', cat: 'ant', icon: 'wifi', t: 'Outdoor Wi-Fi for a square or street', sum: 'An outdoor router with OpenWrt covers a whole square for phones with Piu.', time: '2 h', lvl: 'Intermediate',
    needs: ['An outdoor router or access point that supports OpenWrt, on 2.4 GHz', 'A PoE injector and shielded outdoor network cable', 'Permission from the property owner', 'A Piu Node on the network. It can be the router itself.'],
    steps: [
      { t: 'Pick the antenna for the shape of the place', d: 'Round square: omni in the center. Long street: sector or panel aimed along it. Prefer 2.4 GHz: it gets through trees better and every phone has it.', s: { f: 'w', t: 'Which antenna', u: '', i: [['row', 'radio_button_checked', 'Omni 2.4 GHz', 'square, large yard'], ['row', 'change_history', 'Sector 90°', 'street, soccer field', 1], ['row', 'crop_portrait', 'Panel 14 dBi', 'one distant building']] } },
      { t: 'Mount it high, but not too high', d: 'Between 4 and 8 meters. Too high and phones hear the antenna, but the antenna can’t hear the phones back: phones transmit with little power.', tip: 'Sector antennas are usually tilted 5° to 10° downward.' },
      { t: 'Install OpenWrt and Piu Node', d: 'Follow “Set up a Piu Node on an OpenWrt router”. Turn on only 2.4 GHz Wi-Fi for phones and the link to the main node.' },
      { t: 'Create the open square network', d: 'Create a network named like piu.central-square, with client isolation on. Phones don’t see each other directly, only through the Piu Node.',
        tech: ['From a terminal (OpenWrt)', 'uci set wireless.piu=wifi-iface', "uci set wireless.piu.device='radio0'", "uci set wireless.piu.mode='ap'", "uci set wireless.piu.ssid='piu.central-square'", "uci set wireless.piu.isolate='1'", "uci set wireless.piu.network='piu'", 'uci commit wireless && wifi reload'] },
      { t: 'Walk the coverage', d: 'Walk around the square with Piu open on Settings → Diagnostics. Where the signal drops below −75 dBm, consider a second point.', s: { f: 'p', t: 'Diagnostics', i: [['row', 'wifi', 'Network', 'piu.central-square'], ['row', 'signal_cellular_alt', 'Signal', '−68 dBm', 1], ['row', 'hub', 'Piu neighbors', '12']] } }
    ],
    fim: 'The square has Piu coverage. Anyone passing by joins the mesh, no internet needed.' },

  { id: 'ant-roof', cat: 'ant', icon: 'roofing', t: 'Professional omni antenna on the roof', sum: 'Fiberglass, low-loss cable, N connectors and grounding. An install built to last years.', time: '1 day', lvl: 'Professional',
    needs: ['Fiberglass omni antenna for 915 MHz, 5 to 8 dBi, N connector', '1¼" galvanized mast and two brackets', 'LMR-400 cable or equivalent, with crimped N connectors', 'Coaxial surge protector and ground rod', 'Self-amalgamating tape and UV-rated electrical tape', 'A second person to help'],
    steps: [
      { t: 'Plan the spot', d: 'Choose the highest, clearest point, above the water tank and TV antennas. Stay away from power lines: at least 1.5 times the mast height.', warn: 'Never install near power lines. If the mast falls, it must not reach any wire.' },
      { t: 'Decide where the radio goes', d: 'Radio downstairs with coax running up: simpler, but the cable loses signal. Radio in a sealed box next to the antenna with a network cable running down: loses almost nothing. Above 10 m of cable, prefer the box up top.', s: { f: 'w', t: 'Comparison', u: '', i: [['row', 'cable', 'Radio below · 15 m LMR-400', '−2 dB'], ['row', 'settings_ethernet', 'Radio up top · network cable', '≈ 0 dB', 1]] },
        tech: ['Box up top', '# IP65 box with a Raspberry Pi + USB LoRa radio', '# PoE 802.3af power over the same network cable', 'piu-node radio enable lora0 --region BR915 --antenna-gain 6 --cable-loss 0.3'] },
      { t: 'Mount the mast', d: 'Fix the mast with two brackets at least 50 cm apart. The antenna sits at the top, with no metal at its height within 1 meter.' },
      { t: 'Run and seal the cable', d: 'Before the cable enters the house, make a downward drip loop so water runs off. On outdoor connectors, wrap stretched self-amalgamating tape and cover it with UV tape.', tip: 'Strap the cable to the mast every 50 cm with UV cable ties. A swinging cable breaks its connector.' },
      { t: 'Ground it and protect against lightning', d: 'Install the surge protector where the cable enters the house and bond it to the ground rod with 10 mm² copper or thicker. Ground the mast too.', warn: 'Bad grounding is worse than none. If in doubt, call an electrician.' },
      { t: 'Measure and tell Piu', d: 'Measure SWR from the cable end (see the NanoVNA guide). In Piu, enter antenna gain and cable loss: power is set to the legal limit.', s: { f: 'p', t: 'Roof antenna', i: [['field', 'Gain', '6 dBi'], ['field', 'Cable', 'LMR-400 · 15 m · 2 dB'], ['row', 'tune', 'Radio power', 'set to the limit', 1], ['btn', 'Save']] } }
    ],
    fim: 'An install ready for years. Check connectors and tape every 6 months.' },

  { id: 'ant-yagi', cat: 'ant', icon: 'arrow_right_alt', t: 'Directional Yagi link between neighborhoods', sum: 'Two antennas aimed at each other connect points several kilometers apart.', time: '2 to 4 h', lvl: 'Professional',
    needs: ['Two 915 MHz Yagi antennas, 10 to 13 dBi', 'Two Piu Nodes with LoRa radios, one at each end', 'Sturdy masts at both ends', 'A compass or map app, and someone at the other end with a phone'],
    steps: [
      { t: 'Do the math before buying', d: 'Power + antenna gains − cable losses − path loss must sit well above the radio’s sensitivity. In the real world, subtract 20 to 30 dB from the ideal result.', s: { f: 'w', t: 'Link calculator', u: 'piu-node.local:8420', i: [['field', 'Distance', '10 km'], ['row', 'trending_down', 'Path loss', '111.7 dB'], ['row', 'signal_cellular_alt', 'Received (ideal)', '−76 dBm'], ['row', 'verified', 'Margin over sensitivity', '53 dB', 1]] },
        tech: ['Link budget', 'FSPL(dB) = 32.45 + 20·log10(f_MHz) + 20·log10(D_km)', '# 915 MHz, 10 km: 32.45 + 59.2 + 20 = 111.7 dB', 'Prx = Ptx + Gtx + Grx − cables − FSPL', '# 14 + 12 + 12 − 2 − 111.7 ≈ −76 dBm', '# LoRa SF9 sensitivity ≈ −129 dBm'] },
      { t: 'Confirm line of sight', d: 'On a terrain map, check there’s no hill in between. From end A, with binoculars, try to spot end B. Remember the Fresnel clearance from “Before you build”.' },
      { t: 'Match polarization', d: 'Both Yagis’ elements must sit the same way: upright at both ends. On the Piu network, vertical is the standard.' },
      { t: 'Aim by compass', d: 'Using the map, aim Yagi A toward B. Do the same at the other end. Tighten just enough that you can still turn it.' },
      { t: 'Fine-tune by signal', d: 'Open the alignment test in Piu. Turn the antenna 2° at a time and stop where the signal is strongest. Then the other end does the same.', s: { f: 'p', t: 'Alignment', i: [['prog', 'Signal now · −92 dBm', '68%'], ['row', 'star', 'Best so far', '−89 dBm', 1], ['btn', 'Lock position', 1]] },
        tech: ['From a terminal', 'piu-node radio align lora0 --peer piu.serra-norte', '# prints RSSI and SNR every second'] },
      { t: 'Lock it and record it', d: 'Tighten the clamps, mark the position with tape and write down the azimuth and signal. If the signal drops later, you know where to return.' }
    ],
    fim: 'The two neighborhoods are linked. Short messages and alerts cross the distance without internet.' }
]);
})();
