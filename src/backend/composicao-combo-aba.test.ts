import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A ABA COMPOSIÇÃO REFEITA.
 *
 * O que estava errado, e que este arquivo prende para não voltar:
 *
 *  1. A caixa "Este produto não é um combo" era um AVISO PASSIVO ocupando o
 *     maior bloco da aba, sem nada clicável — e contradizendo a lista de
 *     produtos aberta logo abaixo. Virou interruptor: diz o estado e muda o
 *     estado.
 *  2. A lista de produtos não tinha BUSCA: 40+ itens numa janela de ~180px.
 *  3. Não existia a tela do "depois" — nada mostrava os itens já no combo com
 *     quantidade, ordem e remoção.
 *  4. Faltava A CONTA (soma das partes × preço cobrado), que é a razão de
 *     existir do combo.
 *
 * E o defeito mais traiçoeiro, que tem teste próprio no fim: calcular
 * `soma - preço` com soma 0 anunciava "Acréscimo" num produto que nunca foi
 * combo.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));

/** O corpo do componente, para as buscas não pegarem outra parte do arquivo. */
const COMBO = (() => {
  const i = TELA.indexOf('function ComposicaoCombo(');
  expect(i).toBeGreaterThan(0);
  const f = TELA.indexOf('\nfunction ', i + 10);
  return TELA.slice(i, f > 0 ? f : undefined);
})();

describe('a chave de modo no lugar do aviso', () => {
  it('a caixa de aviso passivo não existe mais', () => {
    expect(TELA).not.toContain('Este produto não é um combo');
  });

  it('é um interruptor de verdade, com rótulo e estado', () => {
    expect(COMBO).toContain("role=\"switch\"");
    expect(COMBO).toContain('aria-checked={ehCombo}');
    expect(COMBO).toContain('Este produto é um combo');
  });

  /*
   * O ESTADO CONTINUA DERIVADO. Um produto é combo quando TEM item; a chave
   * guarda só a intenção de quem ainda não adicionou nada. Uma coluna
   * `eh_combo` voltaria a poder discordar da lista, que é o defeito que a
   * tabela responde sozinha.
   */
  it('combo continua sendo "tem item", com a chave só por cima', () => {
    expect(COMBO).toContain('const ehCombo = modoManual ?? itens.length > 0');
    expect(SCHEMA).not.toContain('eh_combo');
  });

  /* Desligar apaga itens — e apagar sem perguntar é o jeito mais rápido de
     alguém perder uma composição de cinco produtos com um clique torto. */
  it('desligar com itens dentro pergunta antes', () => {
    const i = COMBO.indexOf('async function alternarModo');
    expect(i).toBeGreaterThan(0);
    const corpo = COMBO.slice(i, COMBO.indexOf('\n  }', i));
    expect(corpo).toContain('confirmar(');
    expect(corpo).toContain('itens.length === 0');
  });
});

describe('os itens do combo', () => {
  it('a lista mostra quantidade, subtotal e complementos herdados', () => {
    expect(COMBO).toContain('Itens deste combo');
    expect(COMBO).toContain('brl(item.preco_centavos * qtd(item))');
    expect(COMBO).toContain('item.complementos');
  });

  /* O resumo é o que responde "quantas peças o cliente leva" sem somar na mão. */
  it('o resumo conta produtos e peças', () => {
    expect(COMBO).toContain('const pecas = itens.reduce((t, i) => t + qtd(i), 0)');
  });

  it('o stepper trava em 1 e em 20', () => {
    const i = COMBO.indexOf('async function mudarQuantidade');
    const corpo = COMBO.slice(i, COMBO.indexOf('\n  }', i));
    expect(corpo).toContain('Math.min(20, Math.max(1, nova))');
    expect(COMBO).toContain('disabled={qtd(item) <= 1}');
    expect(COMBO).toContain('disabled={qtd(item) >= 20}');
  });

  it('dá para reordenar arrastando', () => {
    expect(COMBO).toContain('draggable');
    expect(COMBO).toContain('onDrop={() => soltar(i)}');
  });

  /*
   * A ALÇA TAMBÉM ANDA PELO TECLADO. `draggable` do HTML5 é inerte em toque e
   * invisível para quem navega por teclado — sem as setas, reordenar seria um
   * recurso só de quem tem mouse.
   */
  it('a alça responde às setas', () => {
    expect(COMBO).toContain("e.key === 'ArrowUp'");
    expect(COMBO).toContain("e.key === 'ArrowDown'");
  });

  it('o vazio diz o que fazer', () => {
    expect(COMBO).toContain('Nenhum item ainda. Busque abaixo o primeiro produto do combo.');
  });
});

describe('a busca de produtos', () => {
  it('filtra por nome e por categoria', () => {
    expect(COMBO).toContain('const achados = (candidatos ?? []).filter(c =>');
    expect(COMBO).toContain('c.nome.toLowerCase().includes(alvo)');
    expect(COMBO).toContain("(c.categoria || '').toLowerCase().includes(alvo)");
  });

  /*
   * PRODUTO QUE JÁ ESTÁ NO COMBO CONTINUA CLICÁVEL: "2× Pizza Artesanal" é o
   * combo mais comum de pizzaria, e desabilitar a linha impediria justamente
   * ele. O aviso é no texto e no fundo.
   */
  it('o que já está no combo avisa, mas não bloqueia', () => {
    expect(COMBO).toContain('já está no combo');
    expect(COMBO).not.toContain('disabled={jaNoCombo.has(c.id)}');
  });

  it('sem resultado, diz que não achou', () => {
    expect(COMBO).toContain('Nenhum produto com esse nome.');
  });
});

describe('a conta do combo', () => {
  /*
   * ESTE É O DEFEITO QUE MAIS IMPORTA AQUI.
   *
   * Com soma 0, `soma - preço` dá o preço inteiro negativo, e o painel
   * anunciava "Acréscimo +R$ 79,90" num produto normal que nunca foi combo.
   * Número errado com cara de certo é pior que número nenhum — por isso a
   * conta inteira (e a porcentagem) fica atrás de "é combo E tem item E a soma
   * é maior que zero".
   */
  it('não calcula diferença sem combo, sem itens ou com soma zero', () => {
    expect(COMBO).toContain('const temConta = ehCombo && itens.length > 0 && somaCentavos > 0');
    expect(COMBO).toContain('const diferenca = temConta ? somaCentavos - precoCentavos : 0');
    expect(COMBO).toContain('const percentual = temConta && diferenca > 0');
  });

  /* Sem itens o painel COLAPSA: soma, desconto e preview não são renderizados,
     e o título vira "Preço". */
  it('o painel colapsa quando não há conta', () => {
    expect(COMBO).toContain("{temConta ? 'Preço do combo' : 'Preço'}");
    expect(COMBO).toContain("{temConta ? 'Preço cobrado' : 'Preço de venda'}");
    expect(COMBO).toContain('{temConta && (');
  });

  it('os três estados da diferença têm rótulo próprio', () => {
    expect(COMBO).toContain("diferenca > 0 ? 'Desconto do combo' : diferenca < 0 ? 'Acréscimo' : 'Diferença'");
  });

  it('o aviso lê a conta em português, nos três casos', () => {
    expect(COMBO).toContain('O cliente economiza');
    expect(COMBO).toContain('mais caro que a soma dos itens');
    expect(COMBO).toContain('Sem vantagem aparente para o cliente');
  });

  /*
   * O PREÇO É DO FORMULÁRIO, e não gravado aqui. O mesmo campo existe na aba
   * Item: se esta aba gravasse direto na API, o rascunho da outra
   * sobrescreveria de volta no Salvar — duas verdades para o mesmo número.
   */
  it('o campo de preço não grava sozinho', () => {
    expect(COMBO).toContain('aoMudarPreco(e.target.value)');
    const i = COMBO.indexOf('aria-label="Preço cobrado pelo combo"');
    expect(i).toBeGreaterThan(0);
    expect(COMBO.slice(Math.max(0, i - 600), i)).not.toContain('api(');
  });

  it('o preview mostra o que o cliente escolhe em cada item', () => {
    expect(COMBO).toContain('Como o cliente vê');
    expect(COMBO).toContain("o cliente escolhe: ${item.complementos}");
    expect(COMBO).toContain('nada para escolher');
  });
});

describe('o backend da quantidade e da ordem', () => {
  it('a coluna existe e nasce em 1', () => {
    const i = SCHEMA.indexOf("'combo_itens', 'quantidade'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 120)).toContain('DEFAULT 1');
  });

  it('a leitura devolve quantidade e os complementos herdados', () => {
    const i = LOJISTA.indexOf("router.get('/produtos/:id/combo'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('ci.quantidade');
    expect(corpo).toContain('AS complementos');
  });

  /* O teto é repetido no servidor de propósito: quem chama a rota não é
     obrigado a ser a tela, e "999 Coca" num combo é engano ou abuso. */
  it('a rota limita a quantidade a 20', () => {
    const i = LOJISTA.indexOf("router.put('/produtos/:id/combo/:itemId'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('Math.min(20, Math.max(1,');
  });

  /* Renomear e mudar quantidade são a mesma rota: mandar um sem o outro não
     pode apagar o que não foi mandado. */
  it('a rota preserva o campo que não veio', () => {
    const i = LOJISTA.indexOf("router.put('/produtos/:id/combo/:itemId'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('let rotulo = atual.rotulo');
    expect(corpo).toContain('let quantidade = atual.quantidade');
  });

  /*
   * A RENUMERAÇÃO É EM DOIS PASSOS, por causa da UNIQUE (combo_id, slot):
   * regravar direto esbarra em slot já ocupado no meio do caminho e o banco
   * recusa antes de a ordem final existir.
   */
  it('reordenar passa por uma faixa negativa antes de gravar a ordem final', () => {
    const i = LOJISTA.indexOf("router.put('/produtos/:id/combo'");
    expect(i).toBeGreaterThan(0);
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('-(i + 1)');
    expect(corpo).toContain('comTransacao');
  });
});
