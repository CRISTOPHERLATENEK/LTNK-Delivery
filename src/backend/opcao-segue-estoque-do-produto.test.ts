import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SELECT_OPCAO_ESGOTADA, SQL_OPCOES_DA_LOJA } from './grupos-sql';

/*
 * A OPÇÃO SEGUE O ESTOQUE DO PRODUTO A QUE ESTÁ LIGADA.
 *
 * "troquei o Monster Pacific Punch para zero, no produto ficou zerado. Mas
 *  quando vou no complemento, o produto ainda está disponível para venda para o
 *  cliente, mesmo contando no estoque. Esse quesito não pode errar."
 *
 * O vínculo `opcoes_itens.produto_id` servia SÓ para a baixa de estoque no ERP.
 * Nada olhava o saldo antes de OFERECER a opção: o produto sumia da vitrine ao
 * zerar e continuava à venda como complemento, na mesma tela, do mesmo cliente.
 *
 * É o pior formato de erro possível — o lojista faz a coisa certa, vê o produto
 * sumir da vitrine, conclui que resolveu, e continua vendendo pelo outro
 * caminho sem nenhum aviso até o cliente reclamar.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PUBLICO = semComentarios(ler('src', 'backend', 'rotas', 'publico.ts'));
const MODAL = semComentarios(ler('frontend', 'src', 'pages', 'cliente', 'modal-produto.tsx'));
const TIPOS = semComentarios(ler('frontend', 'src', 'types.ts'));
const OPCOES = semComentarios(ler('src', 'backend', 'opcoes-item.ts'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));

/** O SQL sem quebras de linha, para as asserções não dependerem da indentação. */
const regra = SELECT_OPCAO_ESGOTADA.replace(/\s+/g, ' ').trim();

describe('os três motivos que derrubam a opção', () => {
  /* Os três são o mesmo motivo por caminhos diferentes: "o produto não está à
     venda". Deixar de fora qualquer um deixa o buraco aberto por esse. */
  it('sem saldo, com controle de estoque ligado', () => {
    expect(regra).toContain('pv.controla_estoque = 1 AND pv.estoque <= 0');
  });

  it('pausado pelo lojista', () => {
    expect(regra).toContain('pv.disponivel = 0');
  });

  it('excluído', () => {
    expect(regra).toContain('pv.excluido = 1');
  });

  /*
   * ESTOQUE DESLIGADO NÃO DERRUBA. Produto sem controle de estoque tem
   * `estoque = 0` no banco por padrão — sem o `controla_estoque = 1` junto, a
   * regra esconderia TODO complemento de TODA loja que não usa estoque.
   */
  it('produto sem controle de estoque não é derrubado pelo zero', () => {
    const i = regra.indexOf('pv.estoque <= 0');
    expect(regra.slice(0, i)).toContain('pv.controla_estoque = 1 AND');
  });

  /*
   * `EXISTS` E NÃO `JOIN`: opção sem produto vinculado (`produto_id = 0`) tem
   * que sair como NÃO esgotada. Um JOIN a derrubaria da lista inteira, e aí
   * sumiriam do cardápio todos os complementos sem vínculo — que são a maioria.
   */
  it('opção sem produto vinculado não fica esgotada', () => {
    expect(regra.startsWith('EXISTS (')).toBe(true);
    expect(regra).toContain('WHERE pv.id = o.produto_id');
  });

  /*
   * ─────── SELO, E NÃO FILTRO ───────
   *
   * A primeira versão TIRAVA a opção da lista. O lojista recusou: "parece que
   * está sumindo, em vez de ficar como esgotado". O paralelo certo é o do
   * PRODUTO na vitrine — cinza, escrito, e não some. Sumir sem explicação faz o
   * cliente ligar perguntando onde foi parar o sabor.
   */
  it('é coluna do SELECT, não cláusula de WHERE', () => {
    expect(regra.endsWith('AS esgotado')).toBe(true);
    expect(regra).not.toContain('AND NOT EXISTS');
  });
});

describe('a mesma regra nos dois lados', () => {
  /*
   * O QUE O CLIENTE VÊ e o que ele PAGA. Com a regra escrita duas vezes, a
   * segunda diverge — e divergir aqui significa o cardápio esconder e o
   * checkout aceitar, ou o cliente escolher na tela e levar erro ao fechar.
   */
  it('o menu público manda o selo para a tela', () => {
    expect(PUBLICO).toContain("SELECT_OPCAO_ESGOTADA } from '../grupos-sql'");
    expect(PUBLICO).toContain('${SELECT_OPCAO_ESGOTADA}');
  });

  /*
   * A LISTA DA VALIDAÇÃO INCLUI O ESGOTADO. Filtrar aqui o faria sumir do
   * pedido em SILÊNCIO — o cliente escolheria na tela e pagaria sem ele.
   */
  it('a validação carrega o esgotado junto, e recusa pelo nome', () => {
    expect(OPCOES).toContain("import { SELECT_OPCAO_ESGOTADA } from './grupos-sql'");
    expect(OPCOES).toContain('`SELECT o.*, ${SELECT_OPCAO_ESGOTADA} FROM opcoes_itens o');
    expect(OPCOES).toContain('está esgotado. Escolha outra opção em');
    expect(OPCOES).toContain('erroHttp(409');
  });

  /* A recusa vem ANTES de a escolha ser registrada: registrar e falhar depois
     deixaria a opção esgotada no texto do pedido de quem tentasse. */
  it('recusa antes de registrar a escolha', () => {
    expect(OPCOES.indexOf('const acabou = escolhidas.find'))
      .toBeLessThan(OPCOES.indexOf('for (const o of escolhidas) reconhecidas.push'));
  });

  /*
   * O FRAGMENTO FALA DE `o`, então as duas consultas precisam usar esse apelido
   * na tabela de opções. A do menu listava colunas sem prefixo e passou a usar
   * `o.` — sem isso o SQL nem compila, mas um `SELECT *` mascararia.
   */
  it('as duas consultas apelidam a tabela de opções como `o`', () => {
    expect(PUBLICO).toContain('FROM opcoes_itens o');
    expect(OPCOES).toContain('FROM opcoes_itens o');
  });

  /* Nenhuma das duas escreveu a condição à mão em vez de usar o fragmento. */
  it('nenhuma das duas tem cópia da regra', () => {
    for (const fonte of [PUBLICO, OPCOES]) {
      expect(fonte).not.toContain('pv.controla_estoque');
    }
  });
});

describe('o editor do lojista continua mostrando tudo', () => {
  /*
   * A REGRA NÃO VALE NO PAINEL, e isso é deliberado: o lojista precisa VER o
   * Monster zerado no grupo para saber por que ele sumiu do cardápio. Esconder
   * dele também transformaria "está esgotado" em "sumiu", que é o tipo de coisa
   * que vira chamado de suporte.
   */
  it('a listagem do painel não filtra por estoque', () => {
    expect(SQL_OPCOES_DA_LOJA).not.toContain('controla_estoque');
    expect(SQL_OPCOES_DA_LOJA).not.toContain('NOT EXISTS');
  });

  it('o painel não importa o fragmento', () => {
    expect(LOJISTA).not.toContain('SELECT_OPCAO_ESGOTADA');
  });
});

describe('o vínculo e a marca de "não baixa" continuam exclusivos', () => {
  /*
   * É o que dispensa tratar `sem_estoque` na regra: opção marcada como "não
   * baixa" tem `produto_id = 0`, então o `NOT EXISTS` não acha nada e ela
   * aparece normalmente. Se essa exclusividade cair, a regra passa a esconder
   * opção que nunca deveria olhar estoque.
   */
  it('o servidor zera o vínculo quando marcam "não baixa"', () => {
    expect(LOJISTA).toContain('if (semEstoque === 1) produtoVinculado = 0;');
    expect(LOJISTA).toContain('if (req.body.produto_id !== undefined && produtoVinculado > 0) semEstoque = 0;');
  });
});

describe('a tela mostra o esgotado em vez de esconder', () => {
  it('o tipo carrega o selo', () => {
    expect(TIPOS).toContain('esgotado?: number;');
  });

  /*
   * VISÍVEL E INERTE, como o produto esgotado na vitrine. O clique tinha que
   * parar junto: linha com cara de clicável que não faz nada é o defeito que o
   * bloco `bloqueada` já tinha resolvido para o limite do grupo.
   */
  it('não dá para escolher o esgotado', () => {
    expect(MODAL).toContain('const esgotada = Number(o.esgotado) === 1;');
    expect(MODAL).toContain('const inerte = bloqueada || esgotada;');
    expect(MODAL).toContain('onClick={() => !inerte && onAlternar(o)}');
    expect(MODAL).toContain('disabled={inerte}');
    expect(MODAL).toContain('aria-disabled={inerte}');
  });

  it('escreve Esgotado na linha', () => {
    expect(MODAL).toContain('{esgotada && (');
    expect(MODAL).toContain('Esgotado');
  });

  /* E continua na lista: some seria voltar ao que o lojista recusou. */
  it('não filtra a lista na tela', () => {
    expect(MODAL).not.toContain('filter(o => !o.esgotado');
    expect(MODAL).not.toContain('esgotado !== 1');
  });
});

describe('clicar de novo desmarca, em escolha única', () => {
  /*
   * "quando eu seleciono algum item, exemplo coca cola, não consigo desmarcar
   *  se eu clicar em cima de novo."
   *
   * O ramo de escolha única sempre SUBSTITUÍA (`[opcao.id]`): dava para trocar
   * de refrigerante, nunca para ficar sem. Em grupo opcional isso é um beco sem
   * saída — quem tocou sem querer carrega o adicional até o fim. E era
   * incoerente com o grupo de múltipla escolha ao lado, onde clicar de novo
   * sempre desmarcou: a mesma tela, dois comportamentos.
   */
  it('o mesmo id clicado de novo esvazia a escolha', () => {
    expect(MODAL).toContain("if (grupo.papel !== 'tamanho' && atual.includes(opcao.id)) {");
    const i = MODAL.indexOf("if (grupo.papel !== 'tamanho' && atual.includes(opcao.id)) {");
    expect(MODAL.slice(i, i + 200)).toContain('[k]: []');
  });

  /*
   * TAMANHO É A ÚNICA EXCEÇÃO. Ele define quantos sabores o grupo seguinte
   * libera, e trocá-lo APAGA os sabores já escolhidos. Desmarcar jogaria o
   * cliente num estado sem limite definido e ainda levaria junto o trabalho de
   * montar a pizza.
   */
  it('desmarcar vem ANTES da substituição, e poupa o tamanho', () => {
    const iDesmarca = MODAL.indexOf("atual.includes(opcao.id)) {\n          return { ...antigo, [k]: [] };");
    const iSubstitui = MODAL.indexOf("return { ...antigo, [k]: [opcao.id] };");
    expect(iDesmarca).toBeGreaterThan(0);
    expect(iDesmarca).toBeLessThan(iSubstitui);
    /* A limpeza dos sabores ao trocar de tamanho continua existindo. */
    expect(MODAL).toContain("if (g.papel === 'sabores') limpo[chaveEscolha(slot, g.id)] = [];");
  });
});

describe('o produto abre com a folha em branco', () => {
  /*
   * "a coca quando abre vem selecionado automático."
   *
   * Havia um efeito que marcava sozinho todo grupo OBRIGATÓRIO com UMA opção
   * só. O argumento era "grupo de um item não é escolha, é informação". Duas
   * coisas pesaram contra:
   *
   *   - conversava mal com o desmarcar que acabou de entrar: quem desmarcava a
   *     Coca ficava com o obrigatório pendente e ela NÃO voltava, porque o
   *     efeito só rodava na abertura;
   *   - marcar sozinho é o app decidindo por quem paga. "Já veio marcado" e "eu
   *     escolhi" são a mesma tela e resultados diferentes na reclamação.
   */
  it('nenhum grupo é marcado sozinho ao abrir', () => {
    expect(MODAL).not.toContain('p.grupo.obrigatorio && p.grupo.opcoes.length === 1');
    expect(MODAL).not.toContain('novo[k] = [g.opcoes[0].id]');
  });

  /*
   * E A TELA CONTINUA DIZENDO O QUE FALTA. Sem o auto-marcar, o grupo de uma
   * opção só volta a contar como pendente — se o rodapé também sumisse, o
   * cliente ficaria com o botão travado sem saber por quê, que é pior que o
   * problema original.
   */
  it('o rodapé continua apontando o obrigatório que falta', () => {
    expect(MODAL).toContain("paresSlotGrupo.filter(p => p.grupo.obrigatorio && (p.grupo.opcoes ?? []).length > 0)");
  });
});
