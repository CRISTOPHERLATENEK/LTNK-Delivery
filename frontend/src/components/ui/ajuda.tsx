/**
 * AJUDA CONTEXTUAL — um `?` ao lado do título, com a resposta ali.
 *
 * O painel não tinha nada disso. A alternativa que se costuma escolher — tour
 * guiado na primeira entrada — falha pelo motivo óbvio: ninguém lembra de tour.
 * Lembra do `?` que estava ali no momento em que travou.
 *
 * SÓ TEXTO E IMAGEM, sem vídeo. Vídeo exige sair, assistir e voltar, e quem
 * está com o cliente na frente não faz isso; além disso envelhece calado quando
 * a tela muda, e ninguém regrava. Texto e diagrama vivem no repositório, entram
 * no diff e se corrigem numa linha.
 *
 * O RESUMO É A PEÇA PRINCIPAL, não um rótulo pro diagrama. Ele tem que resolver
 * sozinho para quem não vai abrir mais nada — e essa é a maioria.
 */
import { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConteudoAjuda {
  titulo: string;
  /** A explicação. Deve bastar sozinha — o diagrama é reforço, não a resposta. */
  resumo: string;
  /**
   * O que ESTA tela decide, em uma frase.
   *
   * Separado do resumo de propósito: quem chega numa tela pela primeira vez
   * pergunta "pra que isto serve?" antes de "como uso?", e misturar as duas
   * respostas num parágrafo faz a primeira se perder.
   */
  paraQue?: string;
  /** O engano que mais custa nesta tela. Some quando não há um. */
  cuidado?: string;
  /** Caminho do diagrama em `public/ajuda`. */
  imagem?: string;
  /** Folha para imprimir, quando existir. */
  imprimivel?: string;
}

/**
 * O catálogo, num lugar só.
 *
 * Centralizado de propósito: texto de ajuda espalhado pelas telas é o que
 * envelhece sem ninguém notar — some a função e a explicação dela fica. Aqui dá
 * pra revisar tudo de uma vez quando o produto muda.
 *
 * A COBERTURA É TOTAL: toda tela do painel tem entrada. Ajuda pela metade ensina
 * o lojista a não procurar.
 */
export const AJUDA: Record<string, ConteudoAjuda> = {

  /* ─────────────── Começar ─────────────── */

  'loja-dados': {
    titulo: 'Dados da loja e o endereço público',
    paraQue: 'Define o nome, o endereço físico e o LINK que você vai divulgar.',
    resumo: 'O campo "slug" é o endereço da sua loja na internet: '
      + 'seudominio.com.br/pizzaria-do-ze. Ele aparece no QR code, no perfil da rede social e '
      + 'em toda mensagem que você mandar. Alguns nomes são recusados porque já pertencem ao '
      + 'sistema — "pedidos", "carrinho", "conta", "admin". Se o sistema recusar, é isso.',
    cuidado: 'Trocar o slug depois QUEBRA os links já distribuídos: QR code impresso, link '
      + 'fixado no grupo, perfil do Instagram. Escolha antes de divulgar.',
  },

  'horario-fechar': {
    titulo: 'Horário: turnos e os dois jeitos de fechar',
    paraQue: 'Decide quando a loja aceita pedido sozinha, sem você abrir e fechar na mão.',
    resumo: 'Cada dia aceita mais de um turno. Quem fecha entre o almoço e a janta clica em '
      + '"+ fechar no intervalo" e declara 11:00–15:00 e 18:00–23:00 — sem isso seria preciso '
      + 'declarar 11 às 23, e a loja ficaria aberta às 16h recebendo pedido com a cozinha vazia. '
      + 'Turno que vira a madrugada (18:00 às 02:00) o sistema entende sozinho.',
    cuidado: 'Com o horário automático ligado, "Fechar agora" é uma PAUSA DE 2 HORAS — depois a '
      + 'loja reabre sozinha. Para encerrar o dia, use "Encerrar o dia". A mensagem diz a hora '
      + 'exata em que ela reabre; leia antes de ir embora.',
    imagem: '/ajuda/fechar-loja.svg',
  },

  /* ─────────────── Cardápio ─────────────── */

  'produtos-lista': {
    titulo: 'A lista de produtos',
    paraQue: 'É o seu cardápio inteiro, na mesma ordem em que o cliente vê.',
    resumo: 'Os produtos aparecem agrupados por categoria e por faixa (subcategoria), na ordem '
      + 'exata da vitrine — foi feito assim para você conferir a decisão onde ela é tomada. '
      + 'Cada card tem: o interruptor "À venda", as alças de ordenação, e os botões de editar, '
      + 'duplicar e excluir.',
    imagem: '/ajuda/alcas-ordenacao.svg',
  },

  'produtos-ordem': {
    titulo: 'A ordem do cardápio',
    paraQue: 'Decide o que o cliente vê primeiro ao abrir a loja.',
    resumo: 'Arraste pela alça, ou use as setas — que existem porque arrastar não funciona em '
      + 'tela de toque. Vale para os três níveis: categoria, faixa e produto dentro da faixa. '
      + 'A 1ª fileira é a primeira que o cliente vê; ponha ali o que sustenta a casa, não o que '
      + 'o alfabeto escolheu.',
    cuidado: 'As alças SOMEM quando há busca ou filtro ativo. Com meia lista na tela, "põe na 2ª" '
      + 'mandaria uma posição que não é a real e o cardápio se embaralharia. Clique em "Todas".',
    imagem: '/ajuda/alcas-ordenacao.svg',
  },

  'produto-item': {
    titulo: 'Aba Item: o que o cliente vê',
    paraQue: 'Nome, foto, descrição, preço e onde o produto fica no cardápio.',
    resumo: 'Todo campo obrigatório vive nesta aba — se o salvar reclamar, é aqui. A foto é '
      + 'reduzida automaticamente no envio: acima de 600 KB o sistema recomprime, então pode '
      + 'subir a que você tem. Ela aparece INTEIRA, sem corte.',
    cuidado: 'Foto em pé numa moldura quadrada mostra faixa branca dos lados. Se a maioria das '
      + 'suas fotos for em pé, mude o formato da moldura em Configurações → Visual — é mais '
      + 'barato que refazer as fotos.',
  },

  'complementos-grupo': {
    titulo: 'Complementos: um grupo para vários produtos',
    paraQue: 'Define o que o cliente escolhe: tamanho, sabores, borda, adicionais.',
    resumo: 'Um grupo pode servir vários produtos AO MESMO TEMPO, e é isso que separa uma '
      + 'pizzaria organizada de uma bagunça: com 30 pizzas ligadas ao mesmo grupo de Borda, '
      + 'subir o Catupiry é UMA edição em vez de trinta. Duplicar um produto LIGA ao mesmo grupo '
      + '— não copia. É de propósito: as 30 pizzas nascem de duplicação, e copiar recriaria a dor '
      + 'inteira.',
    cuidado: 'Antes de mudar um preço, olhe quantos produtos usam o grupo — o painel mostra. '
      + 'A mudança vale para todos eles.',
    imagem: '/ajuda/grupo-compartilhado.svg',
  },

  'complementos-soltar': {
    titulo: 'Quando um produto precisa ser diferente',
    paraQue: 'Tira UM produto do grupo compartilhado, sem afetar os outros.',
    resumo: '"Soltar deste produto" clona o grupo só para ele. Se apenas uma pizza tem borda '
      + 'recheada especial, solte essa: as outras continuam juntas e continuam se editando de '
      + 'uma vez só.',
    cuidado: 'Depois de soltar, aquele produto deixa de receber as mudanças do grupo original. '
      + 'É o preço de ser diferente — solte só quando for mesmo necessário.',
  },

  'complementos-preco': {
    titulo: 'Como os sabores são cobrados',
    paraQue: 'Decide a conta quando o cliente escolhe mais de um sabor.',
    resumo: 'São três modos. SOMAR cobra todos os adicionais. MAIOR cobra só o do sabor mais '
      + 'caro. PROPORCIONAL divide pelos pedaços. Na mesma pizza de 4 sabores, isso é a '
      + 'diferença entre R$ 93, R$ 69 e R$ 57.',
    cuidado: 'Com SOMAR, uma pizza de 4 sabores caros fica impagável e o cliente desiste no '
      + 'carrinho. Pizzaria costuma usar MAIOR ou PROPORCIONAL.',
    imagem: '/ajuda/modo-preco.svg',
  },

  'complementos-tamanho': {
    titulo: 'Tamanho que libera sabores',
    paraQue: 'Faz o limite de sabores depender do tamanho escolhido, sem configurar duas vezes.',
    resumo: 'Num grupo com papel "Tamanho", cada opção diz quantos sabores libera: Grande '
      + 'libera 2, Família libera 4. O cliente escolhe o tamanho e o limite de sabores muda '
      + 'sozinho na tela dele.',
    cuidado: 'Sem um grupo de Tamanho, o limite passa a ser o "máximo de escolhas" do próprio '
      + 'grupo de sabores. É assim que os componentes de um combo têm limites diferentes usando '
      + 'a MESMA lista de sabores.',
  },

  'composicao-combo': {
    titulo: 'Composição: montar um combo',
    paraQue: 'Faz um produto ser feito de outros produtos, cada um com os complementos dele.',
    resumo: 'Cada item do combo vira um bloco separado na tela do cliente. Numa promoção de duas '
      + 'pizzas, ele escolhe os sabores de cada uma, e a cozinha recebe dividido. O componente '
      + 'deve ser cadastrado como produto normal com "vender avulso" DESLIGADO na aba '
      + 'Configurações — assim ele existe para o combo e não aparece no cardápio nem no PDV.',
    cuidado: 'Não use "pausado" para esconder um componente. Pausado quer dizer temporariamente '
      + 'fora, e o painel vai mostrar assim — mentindo sobre o motivo. E excluir um produto que '
      + 'é componente é RECUSADO: remova da composição antes.',
    imagem: '/ajuda/anatomia-combo.svg',
  },

  'produto-config': {
    titulo: 'Aba Configurações do produto',
    paraQue: 'Define como o item se comporta: onde vende, se controla estoque, se é destaque.',
    resumo: 'Aqui ficam os interruptores de canal (cardápio e PDV são separados: dá para vender '
      + 'só no balcão), o controle de estoque, o destaque, e o "vender avulso" que esconde '
      + 'componentes de combo.',
    cuidado: 'Com controle de estoque ligado, o produto SOME do cardápio ao zerar. Vender um '
      + 'combo baixa o estoque dos componentes — dois pedaços da mesma pizza consomem duas '
      + 'unidades.',
    imagem: '/ajuda/estoque-combo.svg',
  },

  'produto-fiscal': {
    titulo: 'Aba Fiscal do produto',
    paraQue: 'Guarda os códigos que a nota fiscal exige para este item.',
    resumo: 'NCM, CFOP, CSOSN, origem e unidade comercial. Esses códigos dizem à Receita o que '
      + 'está sendo vendido e como é tributado, e viajam em cada nota emitida. Só importa se você '
      + 'emite NFC-e: quem não emite pode ignorar esta aba inteira, e o produto vende normalmente '
      + 'sem ela preenchida.',
    cuidado: 'Esses códigos são responsabilidade do SEU CONTADOR, não do sistema. Preencher por '
      + 'conta própria pode gerar nota com tributação errada.',
  },

  'categorias': {
    titulo: 'Categorias',
    paraQue: 'Agrupa o cardápio e define as faixas que o cliente vê ao rolar.',
    resumo: 'Aqui você renomeia, escolhe o ícone e a imagem de cada categoria, e define o estilo '
      + 'da vitrine. Renomear atualiza todos os produtos daquela categoria de uma vez.',
    cuidado: 'A ORDEM das categorias se ajusta aqui ou na lista de produtos — as duas telas '
      + 'mexem na mesma coisa. Se você não escolher imagem, a vitrine usa a foto do primeiro '
      + 'produto da categoria.',
  },

  /* ─────────────── Vender ─────────────── */

  'balcao-atalhos': {
    titulo: 'Balcão: vender pelo teclado',
    paraQue: 'Venda rápida no caixa, sem entregador e sem endereço.',
    resumo: 'Toque no produto e, se ele tiver complementos, a lista abre. Cada opção tem um '
      + 'NÚMERO: digite o número completo e ela é marcada. Enter adiciona à venda, Esc cancela, '
      + 'Backspace limpa. O painel da direita mostra tudo que já foi escolhido, com × para '
      + 'remover, e o total aparece composto (preço base + adicionais).',
    cuidado: 'Enquanto o número ainda puder crescer — numa lista longa, "3" pode virar 31 — o '
      + 'sistema ESPERA, e o que você digitou aparece no topo da janela. Se aparecer '
      + '"99 · não existe", o número não está na lista; não é a tecla que falhou.',
    imagem: '/ajuda/atalhos-balcao.svg',
    imprimivel: '/ajuda/cola-balcao.html',
  },

  'mesa-fluxo': {
    titulo: 'Mesas: comanda e rodadas de produção',
    paraQue: 'Atender no salão, acumulando itens até o cliente pedir a conta.',
    resumo: 'Abra a mesa, adicione itens (com os mesmos complementos do balcão) e clique em '
      + '"Enviar para produção" — isso manda para a cozinha E imprime a comanda do setor. O '
      + 'ícone de impressora no topo imprime a CONTA do cliente, com a composição de cada item.',
    cuidado: 'O envio trabalha em RODADAS: só vai o que ainda não foi enviado. Pediu mais no meio '
      + 'do jantar? Adicione e clique de novo — a cozinha não recebe os itens repetidos.',
    imagem: '/ajuda/fluxo-mesa.svg',
  },

  'caixa-turno': {
    titulo: 'Caixa: abertura, sangria e fechamento',
    paraQue: 'Controla o dinheiro físico da gaveta e fecha o turno conferindo.',
    resumo: 'Abra o caixa com o fundo de troco. Durante o turno, SANGRIA é dinheiro que sai '
      + '(sempre com motivo) e SUPRIMENTO é dinheiro que entra fora de venda. No fechamento '
      + 'você conta a gaveta e digita o valor; o sistema mostra a diferença contra o esperado '
      + '(abertura + vendas em dinheiro + suprimentos − sangrias).',
    cuidado: 'Lançou errado? CANCELE o movimento em vez de lançar o contrário — senão o turno '
      + 'fica com duas movimentações que nunca aconteceram, e a conferência do fim do dia não '
      + 'fecha. E a sangria não pode passar do dinheiro em caixa: se for recusada, quase sempre '
      + 'é um zero a mais.',
    imagem: '/ajuda/caixa-turno.svg',
  },

  'pedidos-fluxo': {
    titulo: 'Pedidos: do aceite à entrega',
    paraQue: 'É onde o pedido do delivery chega e caminha até sair para o cliente.',
    resumo: 'O pedido nasce pendente, você aceita, ele vai para produção, sai para entrega e é '
      + 'concluído. Cada etapa avisa o cliente. Pedido de balcão nasce já concluído — ele não '
      + 'passa por aqui.',
    cuidado: 'RECUSAR um pedido já pago ESTORNA o dinheiro automaticamente, e o estoque volta. '
      + 'É o caminho certo quando você não vai conseguir produzir — não deixe o pedido parado, '
      + 'porque o cliente pagou e está esperando.',
    imagem: '/ajuda/fluxo-pedido.svg',
  },

  'kds': {
    titulo: 'Cozinha (KDS)',
    paraQue: 'A tela da produção: o que fazer agora, em ordem de chegada.',
    resumo: 'Recebe de três origens — delivery, balcão e mesa — na mesma fila. Cada item mostra '
      + 'a COMPOSIÇÃO (o que produzir: tamanho, sabores, borda) e, separada, a OBSERVAÇÃO do '
      + 'cliente (como produzir: "sem cebola"). Marcar como pronto avisa o salão e o cliente.',
    cuidado: 'A cozinha pode ter logins próprios, criados em Cozinha (KDS) no menu Mais. Assim a '
      + 'tela da produção não precisa da senha do dono.',
    imagem: '/ajuda/kds-fluxo.svg',
  },

  /* ─────────────── Dinheiro ─────────────── */

  'entrega-taxa': {
    titulo: 'Entrega: como a taxa é decidida',
    paraQue: 'Define quanto o cliente paga de frete conforme onde ele mora.',
    resumo: 'Você cadastra a taxa por BAIRRO, e o sistema sugere a distância ao digitar o nome. '
      + 'Bairro que não estiver na lista usa a taxa PADRÃO da loja. Também dá para desenhar '
      + 'áreas no mapa quando o bairro não descreve bem a sua região.',
    cuidado: 'O bairro digitado e ainda NÃO adicionado se perde ao sair da tela — o sistema '
      + 'avisa antes. E a taxa padrão é o que vale para todo endereço fora das zonas: deixá-la '
      + 'baixa demais é entregar longe de graça.',
    imagem: '/ajuda/entrega-taxa.svg',
  },

  'pagamentos': {
    titulo: 'Pagamentos: Pix e cartão',
    paraQue: 'Liga o pagamento online, que cai direto na SUA conta.',
    resumo: 'Cada loja usa a própria conta — não há token compartilhado. Existem dois modos, '
      + 'TESTE e PRODUÇÃO, com um token cada. Comece pelo teste: ele exercita o fluxo inteiro '
      + '(QR, confirmação, pedido entrando, cupom) SEM mover dinheiro. Só depois troque para '
      + 'produção.',
    cuidado: 'As credenciais são gravadas mascaradas e o painel nunca mostra o token completo de '
      + 'volta — guarde o original onde você o gerou. E teste UMA VEZ o estorno (recusando um '
      + 'pedido pago de valor pequeno): é o caminho que ninguém conhece até precisar.',
    imagem: '/ajuda/pagamento-modos.svg',
  },

  'fiscal': {
    titulo: 'Fiscal: NFC-e e o certificado',
    paraQue: 'Emite a nota fiscal do consumidor a cada venda.',
    resumo: 'Precisa do certificado digital A1 (arquivo .pfx ou .p12) e dos dados da empresa — '
      + 'CNPJ, razão social, inscrição estadual e o regime tributário. O certificado assina cada '
      + 'nota emitida e vale UM ANO. A tela mostra o andamento de cada etapa, incluindo o teste '
      + 'de comunicação com a Secretaria da Fazenda, que é onde a configuração costuma travar.',
    cuidado: 'Vencido, a emissão para no MESMO DIA. O painel avisa no Início a partir de 30 dias '
      + 'antes e muda de tom na última semana — não espere ficar vermelho, porque renovar leva '
      + 'dias e a fila do balcão não espera.',
  },

  'relatorios': {
    titulo: 'Relatórios',
    paraQue: 'Mostra faturamento, itens mais vendidos e desempenho por período.',
    resumo: 'Os números vêm dos pedidos concluídos: faturamento do período, ticket médio, itens '
      + 'mais vendidos e desempenho por forma de pagamento. Vendas de balcão, mesa e delivery '
      + 'entram juntas, porque para o caixa da loja é tudo receita — e dá para separar por período '
      + 'quando você quer comparar semanas.',
    cuidado: 'Pedido cancelado ou recusado não entra no faturamento — se o número parecer baixo, '
      + 'confira quantos foram recusados no período antes de procurar erro.',
  },

  'cupons': {
    titulo: 'Cupons de desconto',
    paraQue: 'Cria códigos que o cliente aplica no carrinho.',
    resumo: 'Desconto por valor fixo (R$ 10 off) ou percentual (10%), com data de validade e '
      + 'limite de quantas vezes pode ser usado. O cliente digita o código no carrinho e vê o '
      + 'desconto antes de fechar. No seu lado, ele aparece discriminado no pedido e no cupom '
      + 'impresso, então a conferência do caixa fecha.',
    cuidado: 'Cupom percentual sem valor máximo em pedido grande custa caro. Defina limite de '
      + 'usos antes de divulgar em rede social — cupom que viraliza sem teto vira prejuízo.',
  },

  /* ─────────────── Aparência e acesso ─────────────── */

  'visual': {
    titulo: 'Visual da loja',
    paraQue: 'Define a cara da vitrine: cores, logo, capa e formato dos cards.',
    resumo: 'A cor principal é aplicada em toda a loja do cliente: botões, destaques e detalhes '
      + 'seguem ela. Aqui também ficam o logo, a capa do topo, o estilo dos cards e o FORMATO DA '
      + 'MOLDURA das fotos — quadrada, retrato ou paisagem. É a moldura que decide se as suas '
      + 'fotos aparecem cheias ou com faixa nas laterais.',
    cuidado: 'O logo é a imagem mais baixada da sua loja, porque aparece em toda tela. Um logo '
      + 'de 1,5 MB pode ser metade do peso do cardápio: suba uma versão leve e o sistema '
      + 'comprime o resto.',
  },

  'banners': {
    titulo: 'Banners',
    paraQue: 'Faixas promocionais no topo do cardápio.',
    resumo: 'Faixas que aparecem no topo do cardápio, antes dos produtos. Cada uma tem imagem, '
      + 'posição na sequência e um interruptor de ativo — então dá para deixar a de Natal '
      + 'cadastrada e desligada o ano inteiro. Servem para promoção do dia, aviso de feriado ou '
      + 'lançamento que você quer que ninguém deixe passar.',
    cuidado: 'Banner que ninguém desativa vira mentira: promoção de terça aparecendo no sábado '
      + 'ensina o cliente a ignorar a faixa inteira.',
  },

  'whatsapp': {
    titulo: 'WhatsApp',
    paraQue: 'Avisa o cliente pelo WhatsApp a cada etapa do pedido.',
    resumo: 'Configurado aqui, o sistema manda a confirmação do pedido e os avisos de mudança de '
      + 'status direto no WhatsApp do cliente, sem ninguém digitar. É o canal que mais reduz o '
      + '"cadê meu pedido?" — que é a ligação que chega justamente na hora de maior movimento, '
      + 'quando ninguém tem mão livre para atender.',
    cuidado: 'Mensagem automática em excesso irrita. Avise o essencial — aceito, saiu para '
      + 'entrega — e deixe o resto para quem perguntar.',
  },

  'usuarios': {
    titulo: 'Usuários do painel',
    paraQue: 'Um login por pessoa, com acesso só ao que ela precisa.',
    resumo: 'Crie um usuário para cada pessoa em vez de compartilhar a senha do dono. Cada um '
      + 'recebe as áreas que usa: quem opera o caixa não precisa ver relatório de faturamento. '
      + 'Só o dono cria e bloqueia usuários.',
    cuidado: 'Usuário criado ANTES deste recurso tem acesso total até você definir as áreas '
      + 'dele. Vale revisar a lista uma vez. E bloquear é melhor que excluir: preserva o '
      + 'histórico de quem fez o quê.',
    imagem: '/ajuda/permissoes.svg',
  },

  'seguranca': {
    titulo: 'Segurança',
    paraQue: 'Protege o painel além da senha.',
    resumo: 'A verificação em duas etapas exige um código do celular além da senha. É o que '
      + 'segura o painel quando uma senha vaza — e senha vaza mais do que se imagina, porque '
      + 'costuma ser reaproveitada de outro serviço.',
    cuidado: 'Guarde os códigos de recuperação num lugar que não seja o próprio celular. Perder '
      + 'o aparelho sem eles significa depender do suporte para voltar a entrar.',
  },

  'impressao': {
    titulo: 'Impressão',
    paraQue: 'Define a largura da bobina e o que sai no rodapé do cupom.',
    resumo: 'Escolha 80 ou 58 mm conforme a sua impressora. A impressão passa por um AGENTE '
      + 'instalado no computador da loja — é ele que fala com a impressora térmica.',
    cuidado: 'Impressora parou? Primeiro veja se o agente está aberto; depois se o computador e '
      + 'a impressora estão na MESMA REDE — é a causa mais comum e não aparece como erro no '
      + 'painel. A venda nunca depende da impressora: feche normal e reimprima depois.',
    imprimivel: '/ajuda/cola-balcao.html',
  },

  'entregadores': {
    titulo: 'Entregadores',
    paraQue: 'Cadastra quem entrega e dá a cada um o app de entrega.',
    resumo: 'Cada entregador recebe um login próprio e, pelo app dele, vê só os pedidos '
      + 'atribuídos a ele, com endereço e rota. Telefone e e-mail são únicos entre todas as contas '
      + 'do sistema — inclusive contas de cliente —, porque a mesma pessoa não pode existir duas '
      + 'vezes com papéis diferentes.',
    cuidado: 'Se o cadastro reclamar de telefone repetido, aquele número já está em outra conta '
      + '— inclusive de cliente. Use outro número ou ajuste a conta existente.',
  },

  'clientes': {
    titulo: 'Clientes',
    paraQue: 'Quem já comprou de você, com histórico e endereços.',
    resumo: 'A lista se preenche sozinha conforme os pedidos entram: nome, telefone, endereços '
      + 'usados e o histórico de compras de cada um. Serve para duas coisas do dia a dia — '
      + 'reconhecer cliente recorrente quando ele liga, e conferir o endereço antes de despachar '
      + 'a entrega quando a observação está confusa.',
    cuidado: 'São dados pessoais de terceiros. Use para atender, não para montar lista de '
      + 'disparo — e trate pedido de exclusão com seriedade.',
  },

  'avaliacoes': {
    titulo: 'Avaliações',
    paraQue: 'Nota e comentário do cliente depois do pedido.',
    resumo: 'Depois do pedido concluído o cliente dá nota e comentário, avaliando o pedido e o '
      + 'entregador separadamente. Você pode responder, e a resposta aparece publicamente junto da '
      + 'avaliação. As notas também alimentam a média que aparece na sua loja para quem está '
      + 'decidindo se pede.',
    cuidado: 'Responder avaliação ruim em público vale mais que responder as boas — quem lê '
      + 'está decidindo se pede, e uma resposta objetiva conta mais que a nota isolada.',
  },
};

export function Ajuda({ chave, className }: { chave: keyof typeof AJUDA | string; className?: string }) {
  const conteudo = AJUDA[chave];
  const [aberto, setAberto] = useState(false);

  /* Esc fecha. Um painel de ajuda que prende a pessoa é o oposto de ajuda. */
  useEffect(() => {
    if (!aberto) return;
    const ao = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', ao);
    return () => window.removeEventListener('keydown', ao);
  }, [aberto]);

  if (!conteudo) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Ajuda: ${conteudo.titulo}`}
        title={conteudo.titulo}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground/50 transition-colors hover:text-primary',
          className,
        )}
      >
        <HelpCircle className="size-[15px]" />
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onClick={() => setAberto(false)}>
          <aside
            className="flex h-full w-full max-w-[440px] flex-col bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <p className="min-w-0 flex-1 text-[16px] font-bold leading-tight">{conteudo.titulo}</p>
              <button
                type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              ><X className="size-4" /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <CorpoAjuda item={conteudo} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * O corpo do conteúdo, compartilhado entre o painel lateral e a tela de
 * Treinamento — para os dois nunca divergirem na ordem nem no tratamento.
 *
 * A ORDEM É "PRA QUE → COMO → CUIDADO", e não é arbitrária: quem abre a ajuda
 * numa tela desconhecida precisa saber o propósito antes do procedimento, e o
 * cuidado só faz sentido depois de entender o que a coisa faz.
 */
export function CorpoAjuda({ item }: { item: ConteudoAjuda }) {
  return (
    <>
      {item.paraQue && (
        <p className="text-[13.5px] font-semibold leading-relaxed text-primary">{item.paraQue}</p>
      )}
      <p className="text-[14.5px] leading-relaxed">{item.resumo}</p>

      {item.cuidado && (
        /* Faixa discreta, sem cor de alarme: é o erro que mais custa, não uma
           emergência. Vermelho aqui competiria com os avisos reais do painel. */
        <div className="rounded-xl border-l-[3px] border-amber-500/60 bg-amber-500/[0.06] py-2.5 pl-3.5 pr-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
            Onde se erra
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed">{item.cuidado}</p>
        </div>
      )}

      {item.imagem && (
        <img src={item.imagem} alt={item.titulo} loading="lazy"
          className="w-full rounded-xl border border-border bg-white" />
      )}

      {item.imprimivel && (
        <a href={item.imprimivel} target="_blank" rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[14px] font-semibold hover:bg-accent">
          Folha para imprimir
          <span className="text-[12px] font-normal text-muted-foreground">abre em nova aba</span>
        </a>
      )}
    </>
  );
}
