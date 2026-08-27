import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { precoDoGrupo } from './opcoes-preco';

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

describe('fase 2: o balcão usa o mesmo validador do delivery', () => {
  const lojista = semComentarios(fs.readFileSync(raiz('rotas', 'lojista.ts'), 'utf8'));
  const rota = lojista.slice(
    lojista.indexOf("router.post('/comandas/:id/itens'"),
    lojista.indexOf("router.put('/itens-comanda/:id'"));

  /*
   * ANTES: `precoVigente(produto)` — o preço BASE, ignorando as escolhas. A
   * pizza que no delivery sai a R$ 77 era registrada a R$ 45.
   */
  it('preço vem da validação, não do preço base', () => {
    expect(rota).toMatch(/validarOpcoesDoItem\(produto, req\.body\.opcoes/);
    expect(rota).not.toMatch(/precoUnit = precoVigente\(produto/);
  });

  it('grava as escolhas nas colunas da fase 1', () => {
    const insert = rota.slice(rota.indexOf('INSERT INTO comanda_itens'));
    expect(insert).toMatch(/opcoes_texto, opcoes_ids/);
  });

  /*
   * A EXIGÊNCIA DE OBRIGATÓRIOS SEGUE DESLIGADA NO BALCÃO — de propósito, e
   * este teste existe pra que isso seja uma DECISÃO e não um esquecimento.
   *
   * Ligar antes de o PDV ter a tela de escolha deixaria o balcão incapaz de
   * vender os 9 produtos com grupo obrigatório: hoje ele vende errado, ligado
   * não venderia nada. A fase 3 traz a tela e troca este teste pelo oposto.
   */
  it('ainda não exige os obrigatórios (a tela do PDV é a fase 3)', () => {
    expect(rota).toMatch(/exigirObrigatorios: false/);
  });
});

describe('o delivery não pode perder a exigência', () => {
  const cliente = semComentarios(fs.readFileSync(raiz('rotas', 'cliente.ts'), 'utf8'));

  /*
   * O flag nasceu pro balcão. Se algum dia ele vazar pro delivery, o cliente
   * fecha um pedido de pizza sem sabor e a cozinha recebe o impossível — sem
   * erro nenhum aparecendo. O padrão é exigir; o delivery não passa opção
   * alguma, e é assim que tem que continuar.
   */
  it('chama o validador sem desligar nada', () => {
    expect(cliente).toMatch(/validarOpcoesDoItem\(produto, item\.opcoes\)/);
    expect(cliente).not.toMatch(/exigirObrigatorios/);
  });
});

/*
 * A REGRESSÃO QUE ESTA FASE PODIA CAUSAR: o balcão que NÃO manda opções — que é
 * todo o balcão até a fase 3 — precisa cobrar exatamente o que cobrava antes.
 *
 * A troca foi de `precoVigente(produto)` para `validarOpcoesDoItem(...)`. As
 * duas só coincidem porque a validação PARTE de `precoVigente` e soma
 * `precoDoGrupo` de cada grupo — e `precoDoGrupo` de lista vazia é 0, em
 * qualquer `modo_preco`. Se algum dia deixar de ser, todo item de balcão muda
 * de preço em silêncio.
 */
describe('sem escolhas, o preço não muda', () => {
  const opcoesItem = fs.readFileSync(raiz('opcoes-item.ts'), 'utf8');

  it('a validação parte do preço vigente do produto', () => {
    expect(opcoesItem).toMatch(/let precoUnit = precoVigente\(produto, dataBrasilia\(\)\)/);
  });

  it('e só soma o grupo quando há escolha', () => {
    expect(opcoesItem).toMatch(/precoUnit \+= precoDoGrupo\(grupo, escolhidas\)/);
  });

  it('grupo sem escolha vale zero em todo modo de preço', () => {
    for (const modo of ['somar', 'maior', 'proporcional'] as const) {
      expect(precoDoGrupo({ modo_preco: modo } as never, [])).toBe(0);
    }
  });
});
