import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * FASE 1 DO BALCÃO COM OPÇÕES — só as colunas.
 *
 * Hoje mesa e balcão lançam o item pelo preço BASE e sem escolha nenhuma: uma
 * pizza que no delivery sai a R$ 77 (sabor + borda) é registrada a R$ 45, e a
 * cozinha recebe "Pizza Artesanal" sem tamanho nem sabor.
 *
 * O que esta fase promete é não mudar NADA. A promessa não se verifica olhando
 * o schema — se verifica provando que ninguém escreve nem lê as colunas novas.
 * É isso que torna a fase reversível: aplicar hoje e decidir a fase 2 depois.
 */
const raiz = (...p: string[]) => path.resolve(__dirname, ...p);
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');

describe('fase 1: as colunas existem', () => {
  const schema = fs.readFileSync(raiz('schema-mysql.ts'), 'utf8');

  it('a tabela nova nasce com elas', () => {
    const i = schema.indexOf('CREATE TABLE IF NOT EXISTS comanda_itens');
    const ddl = schema.slice(i, schema.indexOf('`,', i));
    expect(ddl).toMatch(/opcoes_texto\s+TEXT/);
    expect(ddl).toMatch(/opcoes_ids\s+TEXT/);
  });

  /* O CREATE não alcança banco já criado — sem o ALTER, o tenant existente
     ficaria sem as colunas e a fase 2 quebraria só em produção. */
  it('a tabela que já existe ganha as colunas', () => {
    expect(schema).toMatch(/ALTER TABLE comanda_itens ADD COLUMN \$\{ddl\}/);
    const i = schema.indexOf("TABLE_NAME = 'comanda_itens'");
    expect(i).toBeGreaterThan(-1);
  });

  /* Mesmos nomes de `itens_pedido`: nome divergente obrigaria a uma tradução na
     fase 2, que é onde os dois canais voltariam a discordar sobre preço. */
  it('usa os mesmos nomes do delivery', () => {
    const i = schema.indexOf('CREATE TABLE IF NOT EXISTS itens_pedido');
    const ddl = schema.slice(i, schema.indexOf('`,', i));
    expect(ddl).toMatch(/opcoes_texto/);
    expect(ddl).toMatch(/opcoes_ids/);
  });
});

describe('fase 1: nada lê nem escreve ainda', () => {
  const lojista = semComentarios(fs.readFileSync(raiz('rotas', 'lojista.ts'), 'utf8'));

  /*
   * ESTE TESTE MUDA NA FASE 2, de propósito.
   *
   * Enquanto ele passa, a fase 1 é reversível: reverter o deploy não deixa dado
   * escrito que ninguém mais entende. Quando a fase 2 chegar, ele deve ser
   * trocado por um que exija o oposto — não apagado.
   */
  it('o INSERT do item de comanda não grava as colunas', () => {
    const insert = lojista.match(/INSERT INTO comanda_itens[^`']*/g) || [];
    expect(insert.length).toBeGreaterThan(0);
    for (const sql of insert) {
      expect(sql).not.toMatch(/opcoes_texto|opcoes_ids/);
    }
  });

  it('nenhuma consulta de comanda seleciona as colunas', () => {
    const trechos = lojista.match(/SELECT[^;]{0,400}FROM comanda_itens/g) || [];
    for (const sql of trechos) {
      expect(sql).not.toMatch(/opcoes_texto|opcoes_ids/);
    }
  });
});
