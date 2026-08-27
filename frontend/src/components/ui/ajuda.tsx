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
  /**
   * O PASSO A PASSO, quando o assunto é uma TAREFA e não uma tela.
   *
   * Explicação e tutorial resolvem coisas diferentes: quem já sabe o que a tela
   * faz precisa de referência, quem nunca usou precisa de ordem. Misturar os
   * dois num parágrafo atende mal os dois — daí o campo separado, numerado, com
   * o caminho da tela em cada passo.
   */
  passos?: string[];
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

  /* ═══════════ PASSO A PASSO — tarefas, não telas ═══════════ */

  'tut-produto': {
    titulo: 'Como criar um produto',
    paraQue: 'Do zero até ele aparecer no cardápio do cliente.',
    resumo: 'Das cinco abas do cadastro, só DUAS são obrigatórias: Item e, quando o produto tem '
      + 'escolhas, Complementos. Composição é só para combo, Fiscal só para quem emite nota. Com '
      + 'as duas primeiras prontas, o produto já está vendendo.',
    passos: [
      'Produtos → clique em "+ Novo produto".',
      'Na aba ITEM: nome, preço e categoria. Todos os campos obrigatórios estão aqui — se o salvar reclamar, é nesta aba que falta algo.',
      'Ainda em ITEM: solte a foto na área de imagem. O sistema reduz sozinho se ela for pesada.',
      'Aba COMPLEMENTOS: se o produto tem escolhas (tamanho, sabores, borda), monte aqui. Antes de criar um grupo novo, veja se já existe um igual — o mesmo grupo pode servir vários produtos.',
      'Aba CONFIGURAÇÕES: confira se está "À venda" e se aparece no cardápio e no PDV. É aqui também que se liga o controle de estoque.',
      'Salve e abra a sua loja em outra aba para conferir como o cliente vê.',
    ],
    cuidado: 'Vai cadastrar trinta pizzas? Faça UMA completa e use DUPLICAR. Duplicar liga ao '
      + 'mesmo grupo de complementos, então mudar o preço da borda depois é uma edição em vez de '
      + 'trinta.',
    imagem: '/ajuda/cadastro-produto.svg',
  },

  'tut-combo': {
    titulo: 'Como criar um combo',
    paraQue: 'Um produto feito de outros, cada um com as escolhas dele.',
    resumo: 'O combo é um produto normal que TEM outros produtos dentro. Cada item vira um bloco '
      + 'separado na tela do cliente — numa promoção de duas pizzas ele escolhe os sabores de '
      + 'cada uma, e a cozinha recebe dividido.',
    passos: [
      'Primeiro cadastre os COMPONENTES como produtos normais (ex.: "Pizza Gigante 45cm"), com os complementos deles.',
      'Em cada componente, aba CONFIGURAÇÕES: DESLIGUE "vender avulso". Assim ele existe para o combo e não aparece no cardápio nem no PDV.',
      'Agora crie o combo: "+ Novo produto", com o nome e o preço fechado da promoção.',
      'SALVE o combo antes de continuar — a próxima aba precisa de um produto que já exista.',
      'Reabra o combo na aba COMPOSIÇÃO e adicione os componentes, um por vez, com o rótulo que o cliente vai ler ("Pizza Gigante", "Broto").',
      'Se o combo inclui algo fixo (um refrigerante), coloque na aba COMPLEMENTOS do próprio combo.',
      'Abra a loja e confira: cada pizza deve aparecer como um bloco próprio, com os sabores dela.',
    ],
    cuidado: 'Não use "pausado" para esconder um componente — pausado quer dizer temporariamente '
      + 'fora, e o painel vai mostrar assim. E excluir um produto que é componente é RECUSADO: '
      + 'remova da composição do combo antes.',
    imagem: '/ajuda/anatomia-combo.svg',
  },

  'tut-pdv': {
    titulo: 'Como usar o PDV (balcão)',
    paraQue: 'Venda no caixa, com o cliente na sua frente.',
    resumo: 'O balcão é venda imediata: sem endereço, sem entregador, e o pedido já nasce '
      + 'concluído. O atendimento inteiro cabe no teclado — cada opção de complemento tem um '
      + 'número.',
    passos: [
      'Vendas → Balcão. Se você controla caixa, abra o caixa antes.',
      'Toque no produto, ou bipe o código de barras no campo do topo.',
      'Se o produto tiver complementos, a lista abre: DIGITE O NÚMERO da opção. Enter adiciona à venda, Esc cancela.',
      'Confira no painel da direita o que foi escolhido — o × remove um item. O total aparece composto: preço base + adicionais.',
      'Repita para os outros produtos. Item vendido por peso abre o teclado de peso sozinho.',
      'Precisa mandar para a cozinha antes de fechar? Use "Enviar para produção".',
      'Escolha a forma de pagamento, aplique desconto ou cupom se houver, e finalize. O cupom imprime.',
    ],
    cuidado: 'Botão claro NÃO é botão travado: falta alguma escolha obrigatória, e clicar nele '
      + 'rola até o grupo que falta. Se aparecer "99 · não existe", o número digitado não está na '
      + 'lista — não é a tecla que falhou.',
    imagem: '/ajuda/atalhos-balcao.svg',
    imprimivel: '/ajuda/cola-balcao.html',
  },

  'tut-mesa': {
    titulo: 'Como usar mesa',
    paraQue: 'Atender no salão, acumulando pedidos até o cliente pedir a conta.',
    resumo: 'A mesa acumula itens numa comanda. Você manda para a cozinha em RODADAS — só vai o '
      + 'que ainda não foi enviado — e fecha a conta no fim.',
    passos: [
      'Vendas → Mesas. Toque em "Abrir" na mesa que o cliente ocupou.',
      'Clique em "Adicionar itens" e escolha os produtos. Complementos funcionam igual ao balcão: digite o número.',
      'Clique em "Enviar para produção". Isso manda para a cozinha E imprime a comanda do setor.',
      'O cliente pediu mais no meio do jantar? Adicione e clique em enviar de novo — só o que é novo vai para a cozinha.',
      'Na hora da conta: clique no ícone de impressora no topo da comanda. Sai a conta com a composição de cada item.',
      'Escolha a forma de pagamento e feche. A mesa volta a ficar livre automaticamente.',
    ],
    cuidado: 'A comanda fica aberta até você fechar. Mesa ocupada no fim do expediente costuma '
      + 'ser comanda esquecida, não cliente — e ela continua somando no relatório do dia seguinte.',
    imagem: '/ajuda/fluxo-mesa.svg',
  },

  'tut-entregador': {
    titulo: 'Como usar entregador',
    paraQue: 'Cadastrar quem entrega e despachar o pedido para ele.',
    resumo: 'Cada entregador tem login próprio e, no aplicativo dele, vê só os pedidos que você '
      + 'atribuiu, com endereço e rota. Você acompanha tudo pelo painel.',
    passos: [
      'Configurações → Entregadores → cadastre nome, telefone, e-mail e uma senha inicial.',
      'Passe o login para ele e peça que entre pelo endereço da sua loja terminando em /entregador.',
      'Quando um pedido ficar pronto, abra-o em Pedidos e atribua o entregador.',
      'O pedido muda para "Saiu para entrega" e o cliente é avisado automaticamente.',
      'O entregador confirma a entrega pelo aplicativo, e o pedido é concluído.',
      'Em Avaliações você vê a nota que o cliente deu à entrega.',
    ],
    cuidado: 'Telefone e e-mail são ÚNICOS entre todas as contas do sistema, inclusive as de '
      + 'cliente. Se o cadastro reclamar de telefone repetido, aquele número já existe em outra '
      + 'conta — use outro ou ajuste a conta existente.',
    imagem: '/ajuda/fluxo-pedido.svg',
  },

  'tut-rotas': {
    titulo: 'Como criar rotas e taxas de entrega',
    paraQue: 'Define até onde você entrega e quanto cobra em cada lugar.',
    resumo: 'São três camadas, e o sistema tenta na ordem: primeiro uma ÁREA desenhada no mapa, '
      + 'depois a taxa do BAIRRO, e por último a taxa PADRÃO da loja. Ele para na primeira que '
      + 'casar com o endereço do cliente.',
    passos: [
      'Configurações → Entrega. Comece pela TAXA PADRÃO — é ela que vale para todo endereço que não casar com o resto.',
      'Adicione os bairros que você atende: digite o nome e o sistema sugere a distância.',
      'Informe a taxa de cada bairro e, se quiser, o tempo estimado. Clique em adicionar — o bairro digitado e não adicionado se perde ao sair da tela.',
      'Bairro grande demais, ou cortado por um rio? Desenhe uma ÁREA no mapa e dê a taxa dela: área tem prioridade sobre bairro.',
      'Confira fazendo um pedido de teste na sua loja, com um endereço de cada região.',
    ],
    cuidado: 'A taxa padrão é a rede de segurança E o buraco: baixa demais, todo endereço fora '
      + 'das suas zonas — inclusive muito longe — vai ser entregue por ela.',
    imagem: '/ajuda/entrega-taxa.svg',
  },

  'tut-caixa': {
    titulo: 'Como abrir e fechar o caixa',
    paraQue: 'Controlar o dinheiro da gaveta e conferir no fim do turno.',
    resumo: 'Você abre com o fundo de troco, opera o dia registrando o que entra e sai fora de '
      + 'venda, e fecha contando a gaveta. O sistema calcula o esperado e mostra a diferença.',
    passos: [
      'Vendas → Caixa → "Abrir caixa". Informe o fundo de troco que está na gaveta.',
      'Tirou dinheiro durante o turno? Lance uma SANGRIA, sempre com o motivo (pagamento de fornecedor, depósito).',
      'Colocou dinheiro que não é venda? Lance um SUPRIMENTO — mais troco, por exemplo.',
      'Lançou errado? CANCELE o movimento. Não lance o contrário para compensar.',
      'No fim: "Fechar caixa". Conte o dinheiro físico e digite o valor contado.',
      'Confira a diferença. Quebra de centavos é normal; diferença grande merece olhar os movimentos do turno.',
    ],
    cuidado: 'A sangria não pode passar do dinheiro em caixa. Se for recusada, confira o valor — '
      + 'quase sempre é um zero a mais.',
    imagem: '/ajuda/caixa-turno.svg',
  },

  'tut-pedido': {
    titulo: 'Como atender um pedido do delivery',
    paraQue: 'Do aviso na tela até o cliente receber.',
    resumo: 'O pedido do aplicativo chega em Pedidos e caminha por etapas. Cada mudança avisa o '
      + 'cliente automaticamente, então manter o status em dia é o que evita o "cadê meu pedido?".',
    passos: [
      'Pedidos → o pedido novo aparece como pendente, com aviso sonoro.',
      'Confira os itens e o endereço, e clique em ACEITAR. O cliente é avisado na hora.',
      'O pedido vai para a cozinha (KDS) e para a impressora, se você usa comanda.',
      'Quando ficar pronto, atribua um entregador — o status vira "Saiu para entrega".',
      'O entregador confirma no aplicativo dele, e o pedido é concluído.',
      'Não vai conseguir produzir? RECUSE. Se já estava pago, o dinheiro é estornado automaticamente e o estoque volta.',
    ],
    cuidado: 'Não deixe pedido pago parado na fila. O cliente pagou e está esperando: aceite ou '
      + 'recuse — recusar devolve o dinheiro sozinho.',
    imagem: '/ajuda/fluxo-pedido.svg',
  },

  'tut-pagamento': {
    titulo: 'Como ligar o Pix e o cartão',
    paraQue: 'Receber pagamento online, direto na sua conta.',
    resumo: 'Cada loja usa a própria conta do gateway. Existem dois modos, teste e produção, com '
      + 'um token cada — e o teste exercita o fluxo inteiro sem mover dinheiro.',
    passos: [
      'No portal do seu gateway (Mercado Pago, por exemplo), gere as credenciais de TESTE.',
      'Configurações → Pagamentos → cole as credenciais de teste e mude o modo para TESTE.',
      'Cadastre, no painel do gateway, a URL de notificação que a tela mostra.',
      'Faça um pedido de teste na sua loja e pague: o QR deve aparecer e o pedido deve confirmar sozinho.',
      'Funcionou? Gere as credenciais de PRODUÇÃO, cole, e mude o modo para produção.',
      'Faça UM pedido real de valor pequeno e confira se o dinheiro caiu na sua conta.',
      'Recuse esse pedido pelo painel: o dinheiro volta automaticamente. Assim você conhece o estorno antes de precisar dele.',
    ],
    cuidado: 'As credenciais são gravadas mascaradas e o painel nunca mostra o token completo de '
      + 'volta. Guarde o original onde você o gerou.',
    imagem: '/ajuda/pagamento-modos.svg',
  },

  /* ═══════════ REFERÊNCIA — as telas, uma a uma ═══════════ */

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

  'produto-cadastrar': {
    titulo: 'Cadastrar um produto, do zero',
    paraQue: 'O caminho completo: das cinco abas, só duas são obrigatórias.',
    resumo: 'Em Produtos, clique em "+ Novo produto". A aba ITEM tem tudo que o cliente vê — '
      + 'nome, foto, descrição, preço e categoria — e é onde vivem todos os campos obrigatórios: '
      + 'se o salvar reclamar, é lá que falta algo. Em COMPLEMENTOS você define o que o cliente '
      + 'escolhe (tamanho, sabores, borda); antes de criar um grupo novo, veja se já existe um '
      + 'igual, porque um grupo pode servir vários produtos ao mesmo tempo. COMPOSIÇÃO só '
      + 'interessa a combo, e FISCAL só a quem emite nota. Em CONFIGURAÇÕES ficam os '
      + 'interruptores: onde vende, estoque e destaque. Com Item e Complementos prontos, o '
      + 'produto já está no ar.',
    cuidado: 'A ordem importa mais do que parece: salve o produto ANTES de montar composição de '
      + 'combo, porque a aba precisa de um produto que já exista para referenciar. E se for '
      + 'cadastrar vários parecidos — trinta pizzas —, cadastre UM completo e depois DUPLIQUE: '
      + 'duplicar liga ao mesmo grupo de complementos, e você edita preço de borda uma vez só.',
    imagem: '/ajuda/cadastro-produto.svg',
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

      {/*
        OS PASSOS VÊM ANTES DO "ONDE SE ERRA" e antes do diagrama.
        Quem abriu um tutorial quer executar agora; o cuidado só faz sentido
        depois de saber a sequência, e o diagrama é reforço do que já foi lido.
      */}
      {item.passos && item.passos.length > 0 && (
        <ol className="space-y-2.5">
          {item.passos.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 pt-0.5 text-[14px] leading-relaxed">{p}</span>
            </li>
          ))}
        </ol>
      )}

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
