/**
 * As três contas do editor de complementos do lojista. Nada de rede, nada de
 * React — só entrada e saída, pra dar pra testar sem montar tela.
 *
 * Estão juntas porque as três traduzem entre o que o lojista DIGITA e o que o
 * banco GUARDA, e é aí que o editor errava calado: ingrediente virando string
 * com vírgula sobrando, regra do grupo descrita de um jeito que não é o que o
 * cliente vai viver, e item colado em lote com o preço no nome.
 */

/* ─────────────────────────────────────────────────────────────────────────
 * INGREDIENTES COMO CHIPS
 *
 * No banco é UM campo de texto (`opcoes_itens.descricao`, 160 caracteres), e é
 * assim que o cliente lê no app: uma linha embaixo do nome do sabor. Na tela do
 * lojista são chips, porque digitar e apagar ingrediente num campo corrido dá
 * exatamente os defeitos que este módulo evita — vírgula dupla, espaço no
 * começo, item vazio no fim.
 * ───────────────────────────────────────────────────────────────────────── */

/** Quebra o campo do banco nos chips da tela. */
export function ingredientesDeTexto(descricao: string | null | undefined): string[] {
  return (descricao || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Junta os chips no campo do banco.
 *
 * `, ` e não `,`: é o texto que o CLIENTE lê no app, e "molho,mussarela,ovo"
 * sem espaço se lê como uma palavra só num telefone estreito.
 */
export function textoDeIngredientes(chips: string[]): string {
  return chips.map(s => s.trim()).filter(Boolean).join(', ');
}

/**
 * Acrescenta chips vindos de um rascunho digitado, sem duplicar.
 *
 * Aceita vários de uma vez porque colar "molho, mussarela, presunto" é o jeito
 * natural de preencher — obrigar um Enter por ingrediente seria trabalho que o
 * teclado já sabe fazer.
 *
 * A comparação ignora caixa: "Mussarela" e "mussarela" são o mesmo ingrediente,
 * e o chip repetido só polui a linha do cliente.
 *
 * O TETO DE 160 é o da coluna. Cortar aqui, e não no banco, é o que evita o
 * caso pior: MySQL truncando no meio de uma palavra sem ninguém avisar.
 */
export function comIngredientes(atuais: string[], rascunho: string, limite = 160): string[] {
  const vistos = new Set(atuais.map(s => s.toLowerCase()));
  const novos = [...atuais];
  for (const bruto of rascunho.split(',')) {
    const chip = bruto.trim();
    if (!chip || vistos.has(chip.toLowerCase())) continue;
    if (textoDeIngredientes([...novos, chip]).length > limite) break;
    novos.push(chip);
    vistos.add(chip.toLowerCase());
  }
  return novos;
}

/* ─────────────────────────────────────────────────────────────────────────
 * A REGRA DO GRUPO, EM PORTUGUÊS
 *
 * O cabeçalho mostrava "Obrigatório · até 3", que é o nome dos campos, não o
 * que acontece. O lojista precisa ler o que o CLIENTE vai viver, porque é
 * assim que ele percebe que configurou errado — "Pode pular" num grupo de
 * tamanho salta aos olhos; `obrigatorio: 0` não.
 * ───────────────────────────────────────────────────────────────────────── */

export interface RegraGrupo {
  /* `number` porque o MySQL devolve TINYINT como 0/1 e o formulário usa boolean —
     os dois chegam aqui, e converter na chamada seria converter em cada chamada. */
  obrigatorio: boolean | number;
  tipo: 'unico' | 'multiplo' | string;
  max_escolhas: number;
  /** 'sabores' muda quem manda no limite — ver `limiteDeSabores`. */
  papel?: string | null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * QUEM MANDA NO LIMITE DO GRUPO DE SABORES
 *
 * `maxEscolhasEfetivo` IGNORA o `max_escolhas` do grupo de sabores sempre que
 * algum tamanho define quantos sabores libera. Ou seja: numa pizzaria
 * configurada, o número do grupo NÃO VALE — o Gigante manda.
 *
 * O cabeçalho mostrava esse número mesmo assim: um grupo com `max_escolhas: 3`
 * dizia "até 3 · Precisa escolher de 1 a 3" numa pizza cujo Gigante libera 4. O
 * lojista lê 3, o cliente escolhe 4, e o servidor aceita os 4 (usa a mesma
 * função). Nada quebra — a tela do lojista só está errada, que é o defeito mais
 * difícil de achar: ele não dá erro, dá desconfiança.
 * ───────────────────────────────────────────────────────────────────────── */

export interface TamanhoSabores { nome: string; sabores?: number | null }

/**
 * A faixa real de sabores, vinda das opções do grupo de TAMANHO.
 *
 * `null` quando nenhum tamanho define nada — só aí o `max_escolhas` do grupo de
 * sabores volta a valer, e é por isso que o stepper continua existindo nesse
 * caso em vez de desaparecer de vez.
 *
 * Tamanho com `sabores` em branco fica FORA da faixa em vez de contar como 0:
 * ele não define limite nenhum, e um 0 no mínimo diria "pode escolher zero
 * sabores", que é o oposto.
 */
export function limiteDeSabores(tamanhos: TamanhoSabores[]): { min: number; max: number; detalhe: string } | null {
  const definem = tamanhos.filter(t => (t.sabores ?? 0) > 0);
  if (definem.length === 0) return null;
  const nums = definem.map(t => t.sabores as number);
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
    detalhe: definem.map(t => `${t.nome} ${t.sabores}`).join(' · '),
  };
}

/**
 * O rótulo do stepper de teto.
 *
 * "até 1" num grupo OBRIGATÓRIO é errado: "até" abre a porta pro zero, e
 * obrigatório é exatamente um. A frase da regra já dizia certo e o stepper ao
 * lado dizia outra coisa — duas leituras da mesma regra na mesma linha.
 */
export function rotuloTeto(g: RegraGrupo): string {
  const max = g.max_escolhas > 0 ? g.max_escolhas : 0;
  if (max === 0) return 'sem limite';
  if (g.obrigatorio && max === 1) return 'exatamente 1';
  return `até ${max}`;
}

export function fraseDaRegra(g: RegraGrupo, sabores?: { min: number; max: number } | null): string {
  /*
   * No grupo de sabores com tamanho definindo, a faixa é a DO TAMANHO. Repetir
   * o número do grupo aqui seria repetir a mentira num lugar mais legível.
   */
  if (g.papel === 'sabores' && sabores) {
    const faixa = sabores.min === sabores.max ? `${sabores.max}` : `${sabores.min} a ${sabores.max}`;
    return g.obrigatorio
      ? `Precisa escolher · o tamanho define quantos (${faixa})`
      : `Pode pular · o tamanho define quantos (${faixa})`;
  }

  const max = g.max_escolhas > 0 ? g.max_escolhas : 0;
  const pedacos = (n: number) => `${n} ${n === 1 ? 'opção' : 'opções'}`;

  if (g.obrigatorio) {
    if (g.tipo === 'unico' || max === 1) return 'Precisa escolher 1';
    return max > 0 ? `Precisa escolher de 1 a ${max}` : 'Precisa escolher ao menos 1';
  }
  if (g.tipo === 'unico' || max === 1) return 'Pode pular · escolhe 1';
  return max > 0 ? `Pode pular · até ${pedacos(max)}` : 'Pode pular · quantas quiser';
}

/* ─────────────────────────────────────────────────────────────────────────
 * COLAR VÁRIOS DE UMA VEZ
 *
 * Cadastrar sabor é cadastrar em lote: uma pizzaria tem trinta. Um por um, com
 * preço e seção em cada, é o trabalho manual que faz o lojista desistir de
 * configurar e deixar tudo num grupo só.
 *
 * O formato é o que a pessoa já tem escrito no caderno ou no WhatsApp:
 *
 *     [Tradicionais]
 *     Calabresa
 *     Portuguesa / 5
 *     [Especiais]
 *     Camarão / 18,50
 *
 * `[Nome]` numa linha própria muda a seção das linhas seguintes; `/ valor`
 * define o acréscimo. Linha vazia é ignorada.
 * ───────────────────────────────────────────────────────────────────────── */

export interface ItemColado {
  nome: string;
  /** Em reais, como o campo de preço espera. String vazia = sem acréscimo. */
  preco: string;
  secao: string;
}

export function linhasColadas(texto: string, secaoInicial = ''): ItemColado[] {
  const itens: ItemColado[] = [];
  let secao = secaoInicial;

  for (const bruta of (texto || '').split('\n')) {
    const linha = bruta.trim();
    if (!linha) continue;

    const cabecalho = /^\[(.*)\]$/.exec(linha);
    if (cabecalho) { secao = cabecalho[1].trim().slice(0, 40); continue; }

    /*
     * A ÚLTIMA barra manda, não a primeira: "Meia a meia / doce / 8" tem barra
     * no nome, e o preço é sempre o último pedaço. Sem isso o nome seria cortado
     * em "Meia a meia" e o preço viria "doce / 8" — inválido, e o item entraria
     * de graça.
     */
    const corte = linha.lastIndexOf('/');
    let nome = linha;
    let preco = '';
    if (corte > 0) {
      const cauda = linha.slice(corte + 1).trim().replace(/^R\$\s*/i, '');
      // Só é preço se for número. Barra em nome sem valor depois fica no nome.
      if (/^\d+([.,]\d{1,2})?$/.test(cauda)) {
        nome = linha.slice(0, corte).trim();
        preco = cauda.replace(',', '.');
      }
    }
    nome = nome.slice(0, 80).trim();
    if (nome) itens.push({ nome, preco, secao });
  }
  return itens;
}
