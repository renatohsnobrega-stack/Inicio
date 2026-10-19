// Dados da Caderneta da Criança – Menino, 7ª edição (Ministério da Saúde, 2024), licença CC BY-NC-SA 4.0.
// Marcos: "Avaliação dos Marcos de Desenvolvimento", p. 79 a 85 (texto de "Como pesquisar" transcrito da Caderneta).
// Cada faixa tem os marcos que a criança deve ter atingido ao FINAL dela (p. 79).
// Idade corrigida: p. 20 e p. 79. Consultas recomendadas: p. 68 a 76.
const Caderneta = (() => {
  const FONTE = 'Caderneta da Criança – Menino, 7ª ed., Ministério da Saúde, 2024';
  const URL = 'https://bvsms.saude.gov.br/bvs/publicacoes/caderneta_crianca_menino_passaporte_cidadania_7ed.pdf';

  const m = (id, nome, como) => ({ id, nome, como });
  const FAIXAS = [
    { ini: 0, fim: 1, pag: 81, marcos: [
      m('postura', 'Postura: pernas e braços fletidos, cabeça lateralizada', 'Deite a criança em superfície plana, de costas, com a barriga para cima; observe se seus braços e pernas ficam flexionados e sua cabeça lateralizada.'),
      m('observa-rosto', 'Observa um rosto', 'Posicione seu rosto a aproximadamente 30 cm acima do rosto da criança. Observe se a criança olha para você, de forma evidente.'),
      m('reage-som', 'Reage ao som', 'Fique atrás da criança e bata palmas ou balance um chocalho a cerca de 30 cm de cada orelha da criança e observe se ela reage ao estímulo sonoro com movimentos nos olhos ou mudança da expressão facial.'),
      m('eleva-cabeca', 'Eleva a cabeça', 'Coloque a criança de bruços (barriga para baixo) e observe se ela levanta a cabeça, desencosta o queixo da superfície, sem virar para um dos lados.'),
    ] },
    { ini: 1, fim: 2, pag: 81, marcos: [
      m('sorri', 'Sorri quando estimulada', 'Sorria e converse com a criança; não lhe faça cócegas ou toque sua face. Observe se ela responde com um sorriso.'),
      m('abre-maos', 'Abre as mãos', 'Observe se em alguns momentos a criança abre as mãos espontaneamente.'),
      m('emite-sons', 'Emite sons', 'Observe se a criança emite algum som, que não seja choro. Caso não seja observado pergunte ao acompanhante se faz em casa.'),
      m('movimenta-membros', 'Movimenta os membros', 'Observe se a criança movimenta ativamente os membros superiores e inferiores.'),
    ] },
    { ini: 2, fim: 4, pag: 81, marcos: [
      m('contato-social', 'Responde ativamente ao contato social', 'Fique à frente do bebê e converse com ele. Observe se ele responde com sorriso e emissão de sons como se estivesse “conversando” com você. Pode pedir que a mãe o faça.'),
      m('segura-objetos', 'Segura objetos', 'Ofereça um objeto tocando no dorso da mão ou dedos da criança. Esta deverá abrir as mãos e segurar o objeto pelo menos por alguns segundos.'),
      m('ri-alto', 'Emite sons, ri alto', 'Fique à frente da criança e converse com ela. Observe se ela emite sons (gugu, eeee etc.), veja se ela ri emitindo sons (gargalhada).'),
      m('apoia-antebracos', 'Levanta a cabeça e apoia-se nos antebraços, de bruços', 'Coloque a criança de bruços, numa superfície firme. Chame sua atenção à frente com objetos ou seu rosto e observe se ela levanta a cabeça apoiando-se nos antebraços.'),
    ] },
    { ini: 4, fim: 6, pag: 81, marcos: [
      m('busca-objetos', 'Busca ativa de objetos', 'Coloque um objeto ao alcance da criança (sobre a mesa ou na palma de sua mão) chamando sua atenção para ele. Observe se ela tenta alcançá-lo.'),
      m('leva-boca', 'Leva objetos à boca', 'Ofereça um objeto na mão da criança e observe se ela o leva à boca.'),
      m('localiza-som', 'Localiza o som', 'Faça um barulho suave (sino, chocalho etc.) próximo à orelha da criança e observe se ela vira a cabeça em direção ao objeto que produziu o som. Repita no lado oposto.'),
      m('rola', 'Muda de posição (rola)', 'Coloque a criança em superfície plana de barriga para cima. Incentive-a a virar para a posição de bruços.'),
    ] },
    { ini: 6, fim: 9, pag: 82, marcos: [
      m('esconde-achou', 'Brinca de esconde-achou', 'Coloque-se à frente da criança e brinque de aparecer e desaparecer, atrás de um pano ou de outra pessoa. Observe se a criança faz movimentos para procurá-lo quando desaparece, como tentar puxar o pano ou olhar atrás da outra pessoa.'),
      m('transfere', 'Transfere objetos de uma mão para outra', 'Ofereça um objeto para que a criança segure. Observe se ela o transfere de uma mão para outra. Se não fizer, ofereça outro objeto e observe se ela transfere o primeiro para outra mão.'),
      m('duplica-silabas', 'Duplica sílabas', 'Observe se a criança fala “papá”, “dadá”, “mamã”. Se não o fizer, pergunte à mãe se o faz em casa.'),
      m('senta', 'Senta-se sem apoio', 'Coloque a criança numa superfície firme, ofereça-lhe um objeto para que ela segure e observe se ela fica sentada sem o apoio das mãos para equilibrar-se.'),
    ] },
    { ini: 9, fim: 12, pag: 82, marcos: [
      m('imita-gestos', 'Imita gestos', 'Faça algum gesto conhecido pela criança como bater palmas ou dar tchau e observe se ela o imita. Caso ela não o faça, peça à mãe para estimulá-la.'),
      m('pinca', 'Faz pinça', 'Coloque próximo à criança um objeto pequeno ou uma bolinha de papel. Chame atenção da criança para que ela o pegue. Observe se ao pegá-lo ela usa o movimento de pinça, com qualquer parte do polegar associado ao indicador.'),
      m('jargao', 'Produz “jargão”', 'Observe se a criança produz uma conversação incompreensível consigo mesma, com você ou com a mãe (jargão). Caso não seja possível observar, pergunte se ela o faz em casa.'),
      m('anda-apoio', 'Anda com apoio', 'Observe se a criança consegue dar alguns passos com apoio.'),
    ] },
    { ini: 12, fim: 15, pag: 82, marcos: [
      m('mostra-quer', 'Mostra o que quer', 'A criança indica o que quer sem que seja por meio do choro, podendo ser por meio de palavras ou sons, apontando ou estendendo a mão para alcançar. Considerar a informação do acompanhante.'),
      m('blocos-caneca', 'Coloca blocos na caneca', 'Coloque três blocos e a caneca sobre a mesa, em frente à criança. Estimule-a a colocar os blocos dentro da caneca, por meio de demonstração e fala. Observe se a criança consegue colocar pelo menos um bloco dentro da caneca e soltá-lo.'),
      m('uma-palavra', 'Diz uma palavra', 'Observe se durante o atendimento a criança diz pelo menos uma palavra que não seja nome de membros da família ou de animais de estimação. Considere a informação do acompanhante.'),
      m('anda-sem-apoio', 'Anda sem apoio', 'Observe se a criança já anda bem, com bom equilíbrio, sem se apoiar.'),
    ] },
    { ini: 15, fim: 18, pag: 82, marcos: [
      m('colher', 'Usa colher ou garfo', 'A criança usa colher ou garfo, derramando pouco fora da boca. Considere a informação do acompanhante.'),
      m('torre-2', 'Constrói torre de 2 cubos', 'Observe se a criança consegue colocar um cubo sobre o outro sem que ele caia ao retirar sua mão.'),
      m('tres-palavras', 'Fala 3 palavras', 'Observe se durante o atendimento a criança diz três palavras que não sejam nome de membros da família ou de animais de estimação. Considere a informação do acompanhante.'),
      m('anda-tras', 'Anda para trás', 'Peça à criança para abrir uma porta ou gaveta e observe se ela dá dois passos para trás sem cair.'),
    ] },
    { ini: 18, fim: 24, pag: 83, marcos: [
      m('tira-roupa', 'Tira roupa', 'Observe se a criança é capaz de remover alguma peça de roupa, tais como: sapatos que exijam esforço para sua remoção, casacos, calças ou camisetas. Considerar informação do acompanhante.'),
      m('torre-3', 'Constrói torre de 3 cubos', 'Observe se a criança consegue empilhar três cubos sem que eles caiam ao retirar sua mão.'),
      m('aponta-figuras', 'Aponta 2 figuras', 'Observe se a criança é capaz de apontar duas de um grupo de cinco figuras.'),
      m('chuta-bola', 'Chuta bola', 'Observe se a criança chuta a bola sem apoiar-se em objetos.'),
    ] },
    { ini: 24, fim: 30, pag: 83, marcos: [
      m('veste-supervisao', 'Veste-se com supervisão', 'Pergunte aos cuidadores se a criança é capaz de vestir alguma peça de roupa tais como: calcinha, cueca, meias, sapatos, casaco etc.'),
      m('torre-6', 'Constrói torre de 6 cubos', 'Observe se a criança consegue empilhar seis cubos sem que eles caiam ao retirar sua mão.'),
      m('frase-2', 'Frases com 2 palavras', 'Observe se a criança combina pelo menos duas palavras formando uma frase com significado que indique uma ação, tais como: “quer água”, “quer papar”, “chuta bola”. Considere a informação do acompanhante.'),
      m('pula-2-pes', 'Pula com ambos os pés', 'Observe se pula com os dois pés, atingindo o chão ao mesmo tempo, mas não necessariamente no mesmo lugar.'),
    ] },
    { ini: 30, fim: 36, pag: 83, marcos: [
      m('brinca-criancas', 'Brinca com outras crianças', 'Pergunte ao acompanhante se a criança participa de brincadeiras com outras crianças de sua idade.'),
      m('desenho-linha', 'Imita o desenho de uma linha', 'Observe, após demonstração, se a criança faz uma linha ou mais (no papel), de pelo menos 5 cm de comprimento.'),
      m('reconhece-acoes', 'Reconhece 2 ações', 'Observe se a criança aponta a figura de acordo com a ação, tais como: “quem mia?”, “quem late?”, “quem fala?”, “quem galopa?”.'),
      m('arremessa', 'Arremessa bola', 'Observe se a criança arremessa a bola acima do braço.'),
    ] },
    { ini: 36, fim: 42, pag: 83, marcos: [
      m('veste-camiseta', 'Veste uma camiseta', 'Pergunte aos cuidadores se a criança é capaz de vestir sua camiseta e/ou casaco sem botão ou zíper, sem ajuda.'),
      m('polegar', 'Move o polegar com a mão fechada', 'Demonstre para a criança e observe se ela é capaz de mover o polegar para cima em sinal de “OK” ou “legal” ou “tudo bem”, com uma ou ambas as mãos.'),
      m('adjetivos-2', 'Compreende 2 adjetivos', 'Verifique se a criança é capaz de compreender dois adjetivos. Pergunte: “O que você faz quando está com fome?”, “O que você faz quando está com frio?”, “O que você faz quando está cansado?”. Verifique se suas respostas são coerentes, tais como: “Eu como”, “Eu visto casaco”, “Eu vou deitar” etc.'),
      m('equilibrio-1', 'Equilibra-se em cada pé 1 segundo', 'Após demonstração, verifique se a criança consegue equilibrar-se em um pé só, sem apoiar-se em nenhum objeto, pelo menos um segundo, dando-lhe três tentativas. Repita com o outro pé.'),
    ] },
    { ini: 42, fim: 48, pag: 84, marcos: [
      m('emparelha-cores', 'Emparelha cores', 'Observe se a criança é capaz de emparelhar objetos da mesma cor, por exemplo os cubos.'),
      m('copia-circulo', 'Copia círculos', 'Forneça à criança um lápis e uma folha de papel. Mostre-lhe a figura de um círculo e verifique se ela é capaz de desenhar qualquer forma de aproximação com um círculo, que esteja fechada ou quase fechada.'),
      m('fala-clara', 'Fala clara e compreensível', 'Durante a avaliação observe a inteligibilidade da fala da criança (articulação e verbalização de ideias em sequência).'),
      m('pula-1-pe', 'Pula em um pé só', 'Demonstre e verifique se a criança consegue pular em um pé só, duas ou mais vezes, sem apoiar-se em um objeto.'),
    ] },
    { ini: 48, fim: 54, pag: 84, marcos: [
      m('veste-sem-ajuda', 'Veste-se sem ajuda', 'Pergunte aos cuidadores se a criança é capaz de se vestir, sem alguma ajuda.'),
      m('copia-cruz', 'Copia cruz', 'Forneça à criança um lápis e uma folha de papel. Mostre-lhe a figura de uma cruz e verifique se ela é capaz de desenhar duas linhas que se cruzem próximo ao seu ponto médio.'),
      m('preposicoes-4', 'Compreende 4 preposições', 'Dê à criança um bloco e peça: “Coloque o bloco em cima da mesa”, “Coloque o bloco embaixo da mesa”, “Coloque um bloco na minha frente”, “Coloque um bloco atrás de mim”. Observe se ela cumpre adequadamente os quatro comandos.'),
      m('equilibrio-3', 'Equilibra-se em cada pé 3 segundos', 'Procedimento semelhante a “Equilibra-se em cada pé 1 segundo” com o tempo de 3 segundos ou mais.'),
    ] },
    { ini: 54, fim: 60, pag: 84, marcos: [
      m('escova-dentes', 'Escova dentes sem ajuda', 'Pergunte aos cuidadores se a criança é capaz de escovar os dentes, sem ajuda ou supervisão (durante algum tempo), inclusive na colocação da pasta de dentes, na escovação dos dentes posteriores e no uso do fio dental. Verifique se a criança recebeu treino para isso.'),
      m('linha-comprida', 'Aponta a linha mais comprida', 'Mostre para a criança uma ficha contendo o desenho de duas linhas paralelas em posição vertical. Verifique se ela é capaz de apontar a linha mais comprida, mesmo mudando a posição do papel. Em três tentativas, mudando a posição do papel, ela deve acertar as três, ou cinco em seis tentativas.'),
      m('define-5', 'Define 5 palavras', 'Verifique se a criança é capaz de definir cinco palavras. Faça perguntas do tipo “O que é uma bola?” ou “O que você sabe sobre o rio?”. Use palavras do seu contexto de vida. Terá que lhe responder cinco de sete palavras. A definição é aceitável quando inclui: 1) uso; 2) forma; 3) material do que é feito; 4) categoria geral. Ex.: Rio = tem peixe, água, pescar.'),
      m('equilibrio-5', 'Equilibra-se em um pé 5 segundos', 'Procedimento semelhante a “Equilibra-se em cada pé 1 segundo” com o tempo de 5 segundos ou mais.'),
    ] },
    { ini: 60, fim: 66, pag: 85, marcos: [
      m('faz-de-conta', 'Brinca de fazer de conta com outras crianças', 'Pergunte aos cuidadores se a criança participa de brincadeiras de fazer de conta (ex.: casinha, escola), tanto no contexto familiar quanto no escolar.'),
      m('desenha-pessoa', 'Desenha pessoa com 6 partes', 'Forneça à criança um lápis e uma folha de papel (sem pauta). Peça a ela para que desenhe uma pessoa (menino, menina, mamãe, papai etc.). Certifique-se de que ela tenha terminado o desenho antes de pontuar o item do teste. As partes do corpo presentes em pares deverão ser consideradas como uma parte apenas (orelhas, olhos, braços, mãos, pernas e pés). Considere como certo somente se ambas as partes do par forem desenhadas.'),
      m('analogia', 'Faz analogia', 'Pergunte à criança, devagar e distintamente, uma questão de cada vez: “Se o cavalo é grande, o rato é…”, “Se o fogo é quente, o gelo é…”, “Se o Sol brilha durante o dia, a lua brilha durante…”. A criança deverá completar corretamente duas das três frases.'),
      m('ponta-calcanhar', 'Marcha ponta-calcanhar', 'Demonstre à criança como andar em linha reta, encostando a ponta de um pé no calcanhar do outro. Ande aproximadamente oito passos desta forma, e então peça para que a criança o imite. Se necessário, demonstre várias vezes (pode-se facilitar a compreensão comparando este andar com o “andar na corda bamba”). Até três tentativas são permitidas. Se a criança conseguir dar quatro ou mais passos em linha reta, com o calcanhar a, no máximo, 2,5 cm da ponta do pé, sem apoiar-se, terá alcançado este marco.'),
    ] },
    { ini: 66, fim: 72, pag: 85, marcos: [
      m('regras-jogos', 'Aceita e segue regras nos jogos de mesa', 'Pergunte aos cuidadores se a criança é capaz de aceitar e seguir regras dos jogos de mesa.'),
      m('copia-quadrado', 'Copia um quadrado', 'Forneça à criança um lápis e uma folha de papel (sem pauta). Mostre a ela o desenho de um quadrado. Não nomear a figura nem mover seu dedo ou o lápis para demonstrar como desenhá-la. Peça para a criança “Faça um desenho como este!”. Podem ser fornecidas três tentativas. Se a criança for incapaz de copiar o quadrado da ficha, mostre a ela como fazê-lo, desenhando dois lados opostos (paralelos) e depois os outros dois lados opostos (em vez de desenhar o quadrado com um movimento contínuo). Três demonstrações e tentativas podem ser fornecidas.'),
      m('define-7', 'Define 7 palavras', 'Procedimento semelhante ao item “Define 5 palavras”. Agora deve definir 7 palavras.'),
      m('equilibrio-7', 'Equilibra-se em cada pé por 7 segundos', 'Procedimento semelhante a “Equilibra-se em cada pé 1 segundo” com o tempo de 7 segundos ou mais.'),
    ] },
  ];
  // Faixa 0–1 mês, 1–2 meses, 1 ano e 6 meses a 2 anos…
  const idadeTxt = meses => {
    if (meses < 24) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    const a = Math.floor(meses / 12), r = meses % 12;
    return `${a} anos${r ? ` e ${r} meses` : ''}`;
  };
  FAIXAS.forEach((f, i) => { f.i = i; f.nome = `${idadeTxt(f.ini)} a ${idadeTxt(f.fim)}`.replace(/^0 meses/, 'Nascimento'); });
  const MARCOS = Object.fromEntries(FAIXAS.flatMap(f => f.marcos.map(x => [x.id, { ...x, faixa: f.i }])));

  // Consultas registradas na Caderneta (p. 68 a 76). "dias" = idade aproximada da consulta.
  const CONSULTAS = [
    { nome: '1ª semana', dias: 7 }, { nome: '1º mês', meses: 1 }, { nome: '2º mês', meses: 2 }, { nome: '4º mês', meses: 4 },
    { nome: '6º mês', meses: 6 }, { nome: '9º mês', meses: 9 }, { nome: '12º mês', meses: 12 }, { nome: '18º mês', meses: 18 },
    { nome: '24º mês', meses: 24 }, { nome: '36º mês', meses: 36 },
  ];

  return { FONTE, URL, FAIXAS, MARCOS, CONSULTAS };
})();
