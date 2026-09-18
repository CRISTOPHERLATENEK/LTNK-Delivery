import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OPCAO_COM_PRODUTO_A_VENDA, SQL_OPCOES_DA_LOJA } from './grupos-sql';

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
const OPCOES = semComentarios(ler('src', 'backend', 'opcoes-item.ts'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));

/** O SQL sem quebras de linha, para as asserções não dependerem da indentação. */
const regra = OPCAO_COM_PRODUTO_A_VENDA.replace(/\s+/g, ' ').trim();

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
   * `NOT EXISTS` E NÃO `JOIN`: opção sem produto vinculado (`produto_id = 0`)
   * tem que continuar aparecendo. Um JOIN a derrubaria junto, e aí sumiriam do
   * cardápio todos os complementos que não têm vínculo nenhum — que são a
   * maioria.
   */
  it('opção sem produto vinculado continua aparecendo', () => {
    expect(regra.startsWith('AND NOT EXISTS (')).toBe(true);
    expect(regra).toContain('WHERE pv.id = o.produto_id');
  });
});

describe('a mesma regra nos dois lados', () => {
  /*
   * O QUE O CLIENTE VÊ e o que ele PAGA. Com a regra escrita duas vezes, a
   * segunda diverge — e divergir aqui significa o cardápio esconder e o
   * checkout aceitar, ou o cliente escolher na tela e levar erro ao fechar.
   */
  it('o menu público usa o fragmento', () => {
    expect(PUBLICO).toContain("OPCAO_COM_PRODUTO_A_VENDA } from '../grupos-sql'");
    expect(PUBLICO).toContain('${OPCAO_COM_PRODUTO_A_VENDA}');
  });

  it('a validação do pedido usa o mesmo fragmento', () => {
    expect(OPCOES).toContain("import { OPCAO_COM_PRODUTO_A_VENDA } from './grupos-sql'");
    expect(OPCOES).toContain('AND o.disponivel = 1 ${OPCAO_COM_PRODUTO_A_VENDA}');
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
    expect(LOJISTA).not.toContain('OPCAO_COM_PRODUTO_A_VENDA');
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
