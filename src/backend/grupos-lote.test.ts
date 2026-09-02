import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SQL_GRUPOS_DO_PRODUTO, SQL_GRUPOS_DA_LOJA, SQL_OPCOES_DA_LOJA, COLUNAS_GRUPO } from './grupos-sql';

/**
 * A LISTA DO PAINEL NÃO PODE VOLTAR A SER N+1.
 *
 * Medido na base real antes do conserto: 1.152 produtos = 1.198 consultas e
 * 1,5 segundo, sequenciais, só para montar a lista — mais do que tudo o resto
 * da tela somado. Era o "ficou lento com mil produtos".
 */
const fonte = (arq: string) => fs.readFileSync(path.join(__dirname, arq), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('os grupos do cardápio são lidos em lote', () => {
  it('a rota de produtos NÃO consulta grupo dentro de laço', () => {
    /*
     * A busca é pelo padrão que custava caro: `SQL_GRUPOS_DO_PRODUTO` (que
     * recebe UM id) usado na listagem. Ele continua existindo e é o certo para
     * ler um produto — o problema era o laço.
     */
    const f = fonte(path.join('rotas', 'lojista.ts'));
    const i = f.indexOf("router.get('/produtos'");
    const fim = f.indexOf('router.', i + 10);
    const trecho = f.slice(i, fim);
    expect(trecho).toContain('SQL_GRUPOS_DA_LOJA');
    expect(trecho).toContain('SQL_OPCOES_DA_LOJA');
    expect(trecho).not.toContain('SQL_GRUPOS_DO_PRODUTO');
    /* Nem a consulta de opções solta, que era a segunda metade do N+1. */
    expect(trecho).not.toContain('FROM opcoes_itens WHERE grupo_id = ?');
  });

  it('a consulta em lote traz o produto_id, senão não dá para agrupar', () => {
    expect(SQL_GRUPOS_DA_LOJA).toContain('pg.produto_id');
    expect(COLUNAS_GRUPO).toContain('pg.produto_id');
  });

  it('a ordem interna é a MESMA da consulta de um produto', () => {
    /*
     * `pg.ordem, g.id` define a sequência em que o cliente monta o pedido — e o
     * desempate por id existe porque na base real há produto com dois grupos na
     * mesma `ordem`. Trocar a ordem aqui mudaria o cardápio de todo mundo.
     */
    expect(SQL_GRUPOS_DO_PRODUTO).toContain('ORDER BY pg.ordem, g.id');
    expect(SQL_GRUPOS_DA_LOJA).toContain('ORDER BY pg.produto_id, pg.ordem, g.id');
    expect(SQL_OPCOES_DA_LOJA).toContain('ORDER BY o.ordem, o.id');
  });

  it('o recorte é pelos PRODUTOS da loja, não pelos grupos dela', () => {
    /* É o que garante o mesmo resultado da consulta individual: grupo que a
       loja possui mas não está ligado a produto nenhum não entra. */
    for (const sql of [SQL_GRUPOS_DA_LOJA, SQL_OPCOES_DA_LOJA]) {
      expect(sql).toContain('JOIN produtos p ON p.id = pg.produto_id');
      expect(sql).toContain('p.loja_id = ?');
      expect(sql).toContain('p.excluido = 0');
    }
  });

  it('as opções vêm por subconsulta, não por lista de ids montada aqui', () => {
    /* Lista de mil ids viraria uma query de dezenas de KB, e o MySQL tem limite
       de tamanho de pacote. */
    expect(SQL_OPCOES_DA_LOJA).toContain('IN (');
    expect(SQL_OPCOES_DA_LOJA).toContain('SELECT pg.grupo_id');
  });

  it('grupo sem opção vira array vazio, não undefined', () => {
    /* Grupo recém-criado não tem opção, e o painel espera um array — cair para
       undefined quebraria a tela no primeiro grupo vazio. */
    const f = fonte(path.join('rotas', 'lojista.ts'));
    expect(f).toContain('opcoesPorGrupo.get(vinculo.id) ?? []');
    expect(f).toContain('gruposPorProduto.get(p.id) ?? []');
  });
});

describe('as listas de pedidos também são lidas em lote', () => {
  /*
   * As duas rotas de pedidos do painel tinham (ou teriam) o mesmo N+1 da lista
   * de produtos: uma consulta de itens por pedido. A de ativos ainda tinha uma
   * segunda, de mensagens não lidas — e ela recarrega sozinha a cada 15
   * segundos, então eram até 400 idas ao banco quatro vezes por minuto em toda
   * loja aberta.
   *
   * O custo só aparece no dia de movimento: 20 pedidos ativos custam 40
   * consultas rápidas e ninguém nota. É o tipo de coisa que se descobre com o
   * cliente esperando.
   */
  const rotas = fonte(path.join('rotas', 'lojista.ts'));

  function trecho(rota: string) {
    const i = rotas.indexOf(`router.get('${rota}'`);
    expect(i, rota).toBeGreaterThan(0);
    const fim = rotas.indexOf('router.', i + 12);
    return rotas.slice(i, fim > i ? fim : undefined);
  }

  for (const rota of ['/pedidos', '/pedidos-historico']) {
    it(`${rota} não consulta itens dentro de laço`, () => {
      const t = trecho(rota);
      /* O que custava caro: `WHERE ip.pedido_id = ?` (um pedido por consulta).
         Em lote é `IN (...)`. */
      expect(t).not.toContain('WHERE ip.pedido_id = ?');
      expect(t).toContain('WHERE ip.pedido_id IN (');
    });
  }

  it('/pedidos conta mensagens não lidas com GROUP BY, não uma por pedido', () => {
    const t = trecho('/pedidos');
    expect(t).not.toContain('WHERE pedido_id = ? AND remetente');
    expect(t).toContain('GROUP BY pedido_id');
  });

  it('pedido sem mensagem vira zero, não undefined', () => {
    /* Pedido sem mensagem não aparece no GROUP BY: sem o `?? 0` a tela receberia
       undefined onde espera número, e o selo de mensagens sumiria ou quebraria. */
    expect(trecho('/pedidos')).toContain('naoLidasPorPedido.get(p.id) ?? 0');
  });

  it('pedido sem item vira array vazio', () => {
    /* Pedido cancelado antes de fechar existe sem item, e a tela espera array. */
    for (const rota of ['/pedidos', '/pedidos-historico']) {
      expect(trecho(rota), rota).toContain('?? []');
    }
  });

  it('lista vazia sai antes de montar o IN', () => {
    /* `IN ()` é erro de sintaxe no MySQL: sem esta saída, uma loja sem pedido
       nenhum receberia 500 em vez de lista vazia. */
    for (const rota of ['/pedidos', '/pedidos-historico']) {
      expect(trecho(rota), rota).toContain('if (!pedidos.length) return res.json({ pedidos: [] });');
    }
  });
});
