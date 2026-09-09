import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { descrever, comoResolver, type ItemSemProduto } from './ifood-sem-produto';

/*
 * ITEM DO IFOOD QUE NÃO BAIXA ESTOQUE.
 *
 * O comportamento de ACEITAR o pedido está certo e não muda: o cliente já pagou
 * no iFood, e recusar por problema de cadastro transforma isso num pedido
 * perdido. O nome vem de lá, então cozinha e cupom saem corretos.
 *
 * O que estava errado é o que acontecia com a PERDA: uma linha no log de erro.
 * Log é onde a informação vai morar quando não há ninguém lendo — e aqui o que
 * mora lá é estoque divergindo do físico, item por item, até alguém contar
 * prateleira e não entender.
 */

const item = (over: Partial<ItemSemProduto> = {}): ItemSemProduto => ({
  nome: 'Pizza Calabresa G', codigo: 'PIZ-CAL-G',
  vezes: 3, unidades: 5, ultimoEm: '2026-09-01T12:00:00.000Z', ...over,
});

describe('descrever: o número que faz alguém agir', () => {
  /*
   * UNIDADES NA FRENTE, e é a decisão de texto que importa. "3 pedidos" não
   * diz o tamanho do problema; "5 unidades não baixaram" é exatamente o buraco
   * entre o sistema e a prateleira.
   */
  it('lidera pelas unidades, não pelos pedidos', () => {
    expect(descrever(item())).toBe('5 unidades em 3 pedidos — sem baixa de estoque');
  });

  it('singular quando é um só', () => {
    expect(descrever(item({ unidades: 1, vezes: 1 }))).toBe('1 unidade em 1 pedido — sem baixa de estoque');
  });

  it('diz o que se perdeu, não só que houve divergência', () => {
    expect(descrever(item())).toMatch(/sem baixa de estoque/);
  });
});

describe('comoResolver: instrução acionável, ou a verdade de que não dá', () => {
  /*
   * O CÓDIGO É O CONSERTO. O `externalCode` do iFood casa com
   * `produtos.codigo_barras` — com o código na mão, o lojista cola no produto e
   * o próximo pedido baixa estoque. Sem citar o código, a mensagem seria
   * "algo não bateu", que não dá o que fazer.
   */
  it('com código, manda cadastrar aquele código', () => {
    const t = comoResolver(item({ codigo: 'PIZ-CAL-G' }));
    expect(t).toMatch(/PIZ-CAL-G/);
    expect(t).toMatch(/c[óo]digo de barras/i);
  });

  /*
   * SEM CÓDIGO, NÃO EXISTE CHAVE PARA CASAR — e mandar "cadastre o código"
   * nesse caso manda a pessoa procurar algo que não existe. O conserto é do
   * outro lado, no cardápio do iFood.
   */
  it('sem código, diz que o conserto é no cardápio do iFood', () => {
    const t = comoResolver(item({ codigo: '' }));
    expect(t).toMatch(/sem c[óo]digo/i);
    expect(t).toMatch(/card[áa]pio do iFood/);
    /* E não pede para cadastrar um código que não veio. */
    expect(t).not.toMatch(/Cadastre o código \s*$/);
  });
});

describe('a consulta e a fiação', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'ifood-sem-produto.ts'), 'utf8');
  const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const gravar = fs.readFileSync(path.join(__dirname, 'ifood-gravar.ts'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'integracoes.tsx'), 'utf8');

  /*
   * SEM TABELA NOVA. O dado já estava no banco — item de pedido do iFood com
   * `produto_id` nulo — e nunca havia sido perguntado. Uma tabela de
   * divergências seria estado duplicado, que passa a poder divergir do pedido.
   */
  it('deriva dos pedidos, sem tabela própria', () => {
    expect(fonte).toMatch(/FROM itens_pedido/);
    expect(fonte).toMatch(/ip\.produto_id IS NULL/);
    expect(fonte).toMatch(/p\.origem = 'ifood'/);
    expect(fonte).not.toMatch(/CREATE TABLE/);
  });

  /* Agrupa pelo código também: dois itens com nomes parecidos e códigos
     diferentes são dois problemas de cadastro, não um. */
  it('agrupa por nome E código', () => {
    expect(fonte).toMatch(/GROUP BY ip\.nome_produto, ip\.codigo_externo/);
  });

  /*
   * A COLUNA PRECISA DO ALTER, não só do CREATE — o CREATE é IF NOT EXISTS e
   * não alcança banco que já existe. Foi a lição de um cadastro quebrado em
   * produção hoje, e aqui ela não pode se repetir: sem a coluna, a consulta
   * falha e a tela fica muda justamente sobre a divergência.
   */
  it('a coluna do código externo tem migração', () => {
    expect(schema).toMatch(/\['itens_pedido', 'codigo_externo'/);
  });

  /* Guardado mesmo quando CASOU: é o que permite descobrir depois qual código
     o iFood mandou para o item que não baixou estoque. */
  it('o código é gravado no item, casando ou não', () => {
    expect(gravar).toMatch(/codigoExterno: i\.codigoExterno \|\| ''/);
    const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
    expect(servidor).toMatch(/codigo_externo\)/);
  });

  it('a rota existe e é da loja que pergunta', () => {
    expect(rotas).toMatch(/router\.get\('\/ifood\/sem-produto'/);
    const rota = rotas.slice(rotas.indexOf("router.get('/ifood/sem-produto'"));
    expect(rota.slice(0, 600)).toMatch(/minhaLoja\(req\)/);
  });

  /*
   * A TELA MOSTRA SEMPRE ABERTO, fora de sanfona. É a única coisa naquela tela
   * que representa dinheiro escorrendo agora; dentro de uma sanfona ninguém
   * abriria, e o efeito seria o mesmo do log.
   */
  it('a tela mostra a lista sem precisar abrir nada', () => {
    expect(tela).toMatch(/semProduto\.length > 0 && \(/);
    const bloco = tela.slice(tela.indexOf('semProduto.length > 0 && ('));
    const antes = bloco.slice(0, bloco.indexOf('</div>'));
    expect(antes).not.toMatch(/<Sanfona/);
  });

  /* Falha nesta lista não pode derrubar a tela de integrações: é informação
     útil, não requisito para configurar o iFood. */
  it('a busca da lista falha em silêncio', () => {
    expect(tela).toMatch(/ifood\/sem-produto'\)[\s\S]{0,200}\.catch\(/);
  });
});
