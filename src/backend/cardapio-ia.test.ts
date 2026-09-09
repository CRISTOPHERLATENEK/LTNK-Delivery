import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { interpretar, centavosOuNulo, acrescimoCentavos } from './cardapio-ia';

/*
 * O MONTADOR DE CARDÁPIO POR IA.
 *
 * O trabalho aqui não é chamar o modelo — é NÃO CONFIAR nele. A resposta chega
 * com campo faltando, tipo trocado, preço em formato de gente, grupo impossível
 * de satisfazer e JSON embrulhado em explicação. Validar é a função.
 *
 * E há uma regra que vale mais que todas as outras: PREÇO NUNCA É INVENTADO.
 * Um preço plausível chutado pelo modelo passa despercebido e vira venda no
 * prejuízo, item por item, sem ninguém notar. Preço nulo grita.
 */

const json = (o: unknown) => JSON.stringify(o);

describe('centavosOuNulo: o preço, ou nada', () => {
  it('inteiro positivo passa', () => {
    expect(centavosOuNulo(6500)).toBe(6500);
  });

  /*
   * TUDO QUE NÃO É INTEIRO EXATO CAI EM NULO — inclusive o que "daria pra
   * arredondar". `45.5` centavos é preço que ninguém conferiu; arredondar por
   * conta própria é escolher um valor no lugar do dono.
   */
  it('string, fração e zero caem em nulo', () => {
    expect(centavosOuNulo('6500')).toBeNull();
    expect(centavosOuNulo(45.5)).toBeNull();
    expect(centavosOuNulo(0)).toBeNull();
    expect(centavosOuNulo(-100)).toBeNull();
    expect(centavosOuNulo(null)).toBeNull();
    expect(centavosOuNulo(undefined)).toBeNull();
    expect(centavosOuNulo('quarenta e cinco')).toBeNull();
  });

  /* R$ 100 mil num item de cardápio é erro de casa decimal, não preço. */
  it('valor absurdo cai em nulo', () => {
    expect(centavosOuNulo(100_000_01)).toBeNull();
  });
});

describe('acrescimoCentavos: aqui zero é legítimo', () => {
  /*
   * A DIFERENÇA IMPORTA. Produto sem preço é erro; OPÇÃO sem acréscimo é o caso
   * comum — sabor de pizza que não muda o valor. Tratar as duas igual faria
   * toda opção grátis parecer pendência.
   */
  it('zero é acréscimo válido', () => {
    expect(acrescimoCentavos(0)).toBe(0);
  });

  it('lixo vira zero, não pendência', () => {
    expect(acrescimoCentavos('800')).toBe(0);
    expect(acrescimoCentavos(undefined)).toBe(0);
    expect(acrescimoCentavos(-5)).toBe(0);
  });
});

describe('interpretar: proposta a partir do que o modelo devolveu', () => {
  it('caso bom, completo', () => {
    const p = interpretar(json({
      categorias: ['Pizzas', 'Bebidas'],
      produtos: [
        {
          nome: 'Pizza Calabresa Grande', descricao: 'Molho, mussarela e calabresa',
          categoria: 'Pizzas', precoCentavos: 6500,
          grupos: [{
            nome: 'Borda recheada', obrigatorio: false, min: 0, max: 1,
            opcoes: [{ nome: 'Catupiry', precoCentavos: 800 }],
          }],
        },
        { nome: 'Refrigerante 2L', descricao: '', categoria: 'Bebidas', precoCentavos: 1200, grupos: [] },
      ],
    }));

    expect(p.produtos).toHaveLength(2);
    expect(p.produtos[0].precoCentavos).toBe(6500);
    expect(p.produtos[0].grupos[0].opcoes[0].precoCentavos).toBe(800);
    expect(p.categorias).toEqual(['Pizzas', 'Bebidas']);
    expect(p.semPreco).toEqual([]);
  });

  /*
   * A REGRA CENTRAL. Item sem preço volta com nulo E entra em `semPreco`, para
   * a tela poder cobrar antes de criar. Sem a lista, a tela teria que varrer os
   * produtos para descobrir — e quem esquece de varrer publica preço 1 centavo.
   */
  it('produto sem preço volta nulo e é listado', () => {
    const p = interpretar(json({
      produtos: [{ nome: 'Marmita executiva', categoria: 'Almoço', grupos: [] }],
    }));
    expect(p.produtos[0].precoCentavos).toBeNull();
    expect(p.semPreco).toEqual(['Marmita executiva']);
  });

  it('JSON embrulhado em explicação ainda é lido', () => {
    const p = interpretar(`Claro! Segue o cardápio:\n\`\`\`json\n${json({
      produtos: [{ nome: 'Açaí 500ml', categoria: 'Açaí', precoCentavos: 1800, grupos: [] }],
    })}\n\`\`\`\nQualquer coisa me avise.`);
    expect(p.produtos).toHaveLength(1);
    expect(p.produtos[0].nome).toBe('Açaí 500ml');
  });

  it('resposta que não é JSON devolve proposta vazia, não estoura', () => {
    expect(interpretar('não consegui montar').produtos).toEqual([]);
    expect(interpretar('').produtos).toEqual([]);
    expect(interpretar('{ isto não fecha').produtos).toEqual([]);
  });

  it('produto sem nome é descartado, e a tela sabe', () => {
    const p = interpretar(json({ produtos: [{ categoria: 'X', precoCentavos: 100 }] }));
    expect(p.produtos).toEqual([]);
    expect(p.descartados).toContain('produto sem nome');
  });

  /* Dois produtos com o mesmo nome viram duas linhas iguais no cardápio, e o
     cliente não sabe qual escolher. */
  it('nome repetido entra uma vez só', () => {
    const p = interpretar(json({
      produtos: [
        { nome: 'Coca 2L', categoria: 'Bebidas', precoCentavos: 1200, grupos: [] },
        { nome: 'coca 2l', categoria: 'Bebidas', precoCentavos: 1300, grupos: [] },
      ],
    }));
    expect(p.produtos).toHaveLength(1);
    expect(p.descartados.some(d => /repetido/.test(d))).toBe(true);
  });

  /*
   * GRUPO IMPOSSÍVEL DE SATISFAZER. O modelo devolve `min: 2, max: 1` com
   * naturalidade — e na tela do cliente isso é um pedido que ele NUNCA consegue
   * fechar: faltam escolhas e não cabem mais.
   */
  it('min maior que max é corrigido, não repassado', () => {
    const p = interpretar(json({
      produtos: [{
        nome: 'Pizza 2 sabores', categoria: 'Pizzas', precoCentavos: 5000,
        grupos: [{
          nome: 'Sabores', obrigatorio: true, min: 2, max: 1,
          opcoes: [{ nome: 'Calabresa', precoCentavos: 0 }, { nome: 'Mussarela', precoCentavos: 0 }],
        }],
      }],
    }));
    const g = p.produtos[0].grupos[0];
    expect(g.max).toBeGreaterThanOrEqual(g.min);
  });

  it('min não pode passar do número de opções', () => {
    const p = interpretar(json({
      produtos: [{
        nome: 'Combo', categoria: 'Combos', precoCentavos: 3000,
        grupos: [{ nome: 'Escolha', obrigatorio: true, min: 5, max: 9, opcoes: [{ nome: 'A', precoCentavos: 0 }] }],
      }],
    }));
    const g = p.produtos[0].grupos[0];
    expect(g.min).toBeLessThanOrEqual(1);
    expect(g.max).toBeLessThanOrEqual(1);
  });

  it('grupo obrigatório não fica com mínimo zero', () => {
    const p = interpretar(json({
      produtos: [{
        nome: 'X', categoria: 'Y', precoCentavos: 100,
        grupos: [{ nome: 'Sabor', obrigatorio: true, min: 0, max: 1, opcoes: [{ nome: 'A', precoCentavos: 0 }] }],
      }],
    }));
    expect(p.produtos[0].grupos[0].min).toBe(1);
  });

  /* Grupo sem opção nenhuma na tela é um bloco vazio que o lojista não sabe se
     deve preencher ou apagar. */
  it('grupo sem opções é descartado', () => {
    const p = interpretar(json({
      produtos: [{
        nome: 'X', categoria: 'Y', precoCentavos: 100,
        grupos: [{ nome: 'Vazio', obrigatorio: false, min: 0, max: 1, opcoes: [] }],
      }],
    }));
    expect(p.produtos[0].grupos).toEqual([]);
  });

  /*
   * CATEGORIA SAI DOS PRODUTOS, não da lista do modelo. Ele lista categoria que
   * não usa e usa categoria que não listou; a lista dele serve para ORDENAR.
   */
  it('categoria que ninguém usa não entra', () => {
    const p = interpretar(json({
      categorias: ['Sobremesas', 'Bebidas'],
      produtos: [{ nome: 'Coca', categoria: 'Bebidas', precoCentavos: 1200, grupos: [] }],
    }));
    expect(p.categorias).toEqual(['Bebidas']);
  });

  it('categoria usada e não listada entra no fim', () => {
    const p = interpretar(json({
      categorias: ['Bebidas'],
      produtos: [
        { nome: 'Coca', categoria: 'Bebidas', precoCentavos: 1200, grupos: [] },
        { nome: 'Pudim', categoria: 'Sobremesas', precoCentavos: 900, grupos: [] },
      ],
    }));
    expect(p.categorias).toEqual(['Bebidas', 'Sobremesas']);
  });

  it('produto sem categoria cai em Geral', () => {
    const p = interpretar(json({ produtos: [{ nome: 'X', precoCentavos: 100 }] }));
    expect(p.produtos[0].categoria).toBe('Geral');
  });

  /* Resposta gigante não pode virar 500 produtos: além de certo tamanho, deixou
     de ser cardápio e virou alucinação em série. */
  it('respeita um teto de produtos', () => {
    const muitos = Array.from({ length: 400 }, (_, i) => ({
      nome: `Item ${i}`, categoria: 'Geral', precoCentavos: 100, grupos: [],
    }));
    expect(interpretar(json({ produtos: muitos })).produtos.length).toBeLessThanOrEqual(120);
  });
});

describe('a fiação: rota e tela', () => {
  const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'cardapio-ia.tsx'), 'utf8');
  const produtos = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'produtos.tsx'), 'utf8');

  /* Asserções por TEXTO e não por regex aqui de propósito: a primeira versão
     deste bloco virou lixo porque eu construí as regex com escape na mão. */
  const rotaSugerir = rotas.slice(rotas.indexOf("router.post('/cardapio/sugerir'"));

  it('a rota existe e é da loja que pergunta', () => {
    expect(rotas).toContain("router.post('/cardapio/sugerir'");
    expect(rotaSugerir.slice(0, 1800)).toContain('minhaLoja(req)');
  });

  /* Sem chave, 503 com a mensagem que diz o que falta — não 500 genérico. */
  it('sem chave, responde 503 com explicação', () => {
    expect(rotaSugerir.slice(0, 1800)).toContain('SemChaveIA');
    expect(rotaSugerir.slice(0, 1800)).toContain('503');
  });

  /*
   * A ROTA SÓ SUGERE. Se ela gravasse, a proposta de um modelo entraria no
   * cardápio sem ninguém ver — e cardápio é preço.
   */
  it('a rota de sugestão não escreve nada', () => {
    const corpo = rotaSugerir.slice(0, rotaSugerir.indexOf('});'));
    expect(corpo).not.toContain('INSERT');
    expect(corpo).not.toContain('UPDATE');
    expect(corpo).not.toContain('DELETE');
  });

  /*
   * AS CATEGORIAS EXISTENTES VÃO NO PEDIDO. Sem isso o modelo cria "Bebidas"
   * ao lado de "Beb." que o lojista já usava, e o cardápio fica com duas
   * categorias sinônimas — confuso pro cliente e chato de arrumar.
   */
  it('manda as categorias que a loja já tem', () => {
    expect(rotaSugerir.slice(0, 1800)).toContain('SELECT DISTINCT categoria');
  });

  /*
   * A TELA NÃO DEIXA CRIAR SEM PREÇO. É a regra central do módulo, e sem
   * bloqueio na tela ela não existe: o produto entraria com preço de 1 centavo.
   */
  it('a tela trava a criação enquanto faltar preço', () => {
    expect(tela).toContain('disabled={criando || semPreco > 0}');
    expect(tela).toContain('if (!proposta || semPreco > 0) return;');
  });

  /* Reusa os endpoints que já existem, sem "criar em lote" novo. */
  it('cria pelos endpoints existentes', () => {
    expect(tela).toContain("'POST', '/api/lojista/produtos'");
    expect(tela).toContain('/grupos`');
    expect(tela).toContain('/opcoes`');
  });

  /*
   * NASCE PAUSADO. O dono revisou PREÇO nesta tela; a descrição foi escrita
   * pela IA e ninguém leu com calma. Publicar direto põe texto não revisado na
   * frente do cliente.
   */
  it('produto nasce pausado, e a tela avisa', () => {
    expect(tela).toContain('disponivel: false');
    expect(tela).toContain('Criados pausados');
  });

  /* Um produto que falha não para os outros: melhor 28 de 30 criados com a
     lista do que zero e um erro genérico. */
  it('falha de um não aborta os demais', () => {
    expect(tela).toContain('problemas.push');
  });

  /* Oferecido no estado VAZIO, que é onde vale mais: loja sem produto tem o
     cardápio na cabeça do dono e nada digitado. */
  it('aparece no estado vazio da tela de produtos', () => {
    const vazio = produtos.slice(produtos.indexOf('Nenhum produto ainda'));
    expect(vazio.slice(0, 1400)).toContain('setMontandoIA(true)');
  });
});

describe('o que este módulo NÃO faz', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'cardapio-ia.ts'), 'utf8');
  const exec = fonte.split('\n')
    .filter(l => { const t = l.trimStart(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
    .join('\n');

  /*
   * NÃO ESCREVE NADA. Cardápio é preço, e preço é dinheiro: um modelo criando
   * produto direto no ar é um jeito de vender comida pelo valor errado. Quem
   * grava é o lojista, depois de ver a proposta.
   */
  it('não toca no banco', () => {
    expect(exec).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(exec).not.toMatch(/from '\.\/db-mysql'/);
  });

  /* Sem chave, erro que DIZ o que fazer — senão a primeira pessoa a clicar
     recebe 500 sem pista e abre um chamado sobre o chamado. */
  it('sem chave, o erro explica o que falta', () => {
    expect(exec).toMatch(/class SemChaveIA/);
    expect(exec).toMatch(/ANTHROPIC_API_KEY/);
  });

  /* A instrução tem que proibir o chute de preço em texto, não só o código
     tratar o nulo: o modelo obedece a instrução, e o validador é a rede. */
  it('a instrução proíbe estimar preço', () => {
    expect(fonte).toMatch(/NUNCA estime/);
    expect(fonte).toMatch(/precoCentavos": null/);
  });

  /* E proíbe inventar item e adjetivo de qualidade — "artesanal" que o dono
     não disse é promessa que a loja passa a fazer sem saber. */
  it('a instrução proíbe inventar item e selo de qualidade', () => {
    expect(fonte).toMatch(/Não invente item/);
    expect(fonte).toMatch(/artesanal/);
  });

  /* Instrução estável cacheada: a partir da segunda chamada custa ~10%. */
  it('a instrução vai cacheada', () => {
    expect(exec).toMatch(/cache_control: \{ type: 'ephemeral' \}/);
  });

  /* `content` é união: pegar `content[0].text` devolve vazio quando o primeiro
     bloco é o raciocínio. */
  it('junta os blocos de texto, não o primeiro', () => {
    expect(exec).toMatch(/\.filter\(\(b\): b is Anthropic\.TextBlock/);
    expect(exec).not.toMatch(/content\[0\]\.text/);
  });
});
