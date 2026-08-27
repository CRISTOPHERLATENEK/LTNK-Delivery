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
  /*
   * FASE 3: A EXIGÊNCIA ESTÁ LIGADA — o oposto do que este teste pedia antes.
   *
   * A tela compacta abre pra todo produto com grupo e não deixa confirmar com
   * obrigatório vazio, então não existe mais caminho legítimo pra lançar pizza
   * sem sabor. A tela pode ser burlada (requisição direta ao endpoint); o
   * servidor é o que garante.
   */
  it('exige os obrigatórios, como o delivery', () => {
    expect(rota).not.toMatch(/exigirObrigatorios/);
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

describe('fase 3: a venda de balcão também usa o validador', () => {
  const lojista = semComentarios(fs.readFileSync(raiz('rotas', 'lojista.ts'), 'utf8'));
  const rota = lojista.slice(
    lojista.indexOf("router.post('/balcao', async"),
    lojista.indexOf("router.post('/balcao/hoje'") > 0
      ? lojista.indexOf("router.post('/balcao/hoje'")
      : lojista.indexOf("router.post('/balcao/enviar-cozinha'"));

  /*
   * A FASE 2 CORRIGIU SÓ A COMANDA. A venda de balcão passa por outra rota e
   * seguia cobrando `precoBase` — eu havia dito que a fase 2 cobria os dois.
   */
  it('preço unitário vem da validação, não do preço base', () => {
    expect(rota).toMatch(/validarOpcoesDoItem\(produto, it\.opcoes\)/);
    expect(rota).toMatch(/precoUnit: opc\.precoUnit/);
  });

  it('grava as escolhas no item do pedido', () => {
    expect(rota).toMatch(/opcoesIds: JSON\.stringify\(opc\.opcoesIds\)/);
  });

  /*
   * Produto por peso continua no preço BASE por kg: ali o que multiplica é o
   * peso, e acréscimo de opção por quilo não é conceito que exista no balcão.
   */
  it('produto por peso segue pelo preço por kg', () => {
    expect(rota).toMatch(/precoBase \* pesoG \/ 1000/);
  });
});

/**
 * FASE 4: A COZINHA RECEBE O QUE PRODUZIR.
 *
 * A venda finalizada já saía certa depois da fase 3. O que faltava era o envio
 * ANTECIPADO — "enviar cozinha" antes de fechar a conta, que é justamente o que
 * existe pra produção começar. Ele mandava "Pizza Artesanal" e nada mais.
 */
describe('fase 4: o ticket da cozinha leva a composição', () => {
  const lojista = semComentarios(fs.readFileSync(raiz('rotas', 'lojista.ts'), 'utf8'));
  const cozinha = semComentarios(fs.readFileSync(raiz('rotas', 'cozinha.ts'), 'utf8'));
  const schema = fs.readFileSync(raiz('schema-mysql.ts'), 'utf8');

  it('a coluna existe, na tabela nova e na já criada', () => {
    const i = schema.indexOf('CREATE TABLE IF NOT EXISTS cozinha_ticket_itens');
    expect(schema.slice(i, schema.indexOf('`,', i))).toMatch(/opcoes_texto TEXT/);
    expect(schema).toMatch(/ALTER TABLE cozinha_ticket_itens ADD COLUMN/);
  });

  /* Os DOIS caminhos gravam: mesa e balcão mandam pra cozinha por rotas
     diferentes, e corrigir um só deixaria metade da operação cega. */
  it('os dois envios gravam a composição', () => {
    const inserts = lojista.match(/INSERT INTO cozinha_ticket_itens[^`']*/g) || [];
    expect(inserts.length).toBe(2);
    for (const sql of inserts) expect(sql).toMatch(/opcoes_texto/);
  });

  /*
   * A PORTA DOS FUNDOS. Se o envio pra cozinha não exigisse os obrigatórios, o
   * atendente mandaria a pizza pra produção primeiro e a regra da fase 3 não
   * valeria — o mesmo defeito, por outro caminho.
   */
  it('o envio à cozinha valida as opções, sem desligar a exigência', () => {
    const rota = lojista.slice(
      lojista.indexOf("router.post('/balcao/enviar-cozinha'"),
      lojista.indexOf("router.post('/balcao/enviar-cozinha'") + 2000);
    expect(rota).toMatch(/validarOpcoesDoItem\(produto, it\.opcoes\)/);
    expect(rota).not.toMatch(/exigirObrigatorios/);
  });

  /*
   * COMPOSIÇÃO E OBSERVAÇÃO EM CAMPOS SEPARADOS — a lição que esta base já
   * pagou: empilhadas numa string só, a comanda imprimia tudo em maiúscula e
   * centralizado, e uma pizza de quatro sabores virava bloco ilegível.
   */
  it('a cozinha recebe composição e observação separadas', () => {
    expect(cozinha).toMatch(/composicao: i\.opcoes_texto \|\| ''/);
    expect(cozinha).toMatch(/detalhe: i\.observacao \|\| ''/);
  });
});
