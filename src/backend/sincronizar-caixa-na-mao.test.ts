import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { estoqueDerivado, lerComposicaoGravada } from './maxxgestao-estoque';

/*
 * O BOTÃO "SINCRONIZAR ESTOQUE" ZERAVA A CAIXA DE CERVEJA.
 *
 * Relato do lojista: "as caixas de cerveja não estão calculando corretamente de
 * acordo com as latas — cliquei em sincronizar e ele zerou; a caixa tem a lata
 * amarrada nela".
 *
 * A caixa é COMPOSIÇÃO no Maxx Gestão (12× a lata). No modo "Multiplicar
 * Quantidade pelo Estoque" quem se movimenta é a LATA; o registro do kit fica
 * parado, quase sempre em zero. O ciclo automático já sabia disso —
 * `saldoEfetivo` põe a composição na frente do saldo próprio. O BOTÃO não
 * passava por lá: perguntava o saldo próprio da caixa, recebia o zero residual
 * e gravava esgotado, com as latas todas na prateleira.
 *
 * Era o mesmo bug que o módulo de estoque existe para impedir, chegando por um
 * caminho que não passava pela regra.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const DEPS = semComentarios(ler('src', 'backend', 'maxxgestao-importar-deps.ts'));

/** Só o corpo da rota do botão, para não medir o ciclo por engano. */
const ROTA = (() => {
  const i = LOJISTA.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
  expect(i).toBeGreaterThan(0);
  const j = LOJISTA.indexOf('\nrouter.', i + 10);
  return LOJISTA.slice(i, j > 0 ? j : undefined);
})();

describe('o leitor da composição gravada tem um dono só', () => {
  /*
   * Enquanto era privado do módulo de importação, o botão não tinha como
   * enxergar composição nenhuma. Agora mora junto de `estoqueDerivado`, que é
   * quem consome o resultado.
   */
  it('mora no módulo de estoque, e a importação importa de lá', () => {
    expect(DEPS).toContain("from './maxxgestao-estoque'");
    expect(DEPS).toContain('lerComposicaoGravada as lerComposicao');
    /* Não sobrou cópia privada com o mesmo trabalho. */
    expect(DEPS).not.toContain('function lerComposicao(bruto');
  });

  it('lê o formato que o ciclo grava', () => {
    expect(lerComposicaoGravada('[{"v":715,"q":12}]')).toEqual([{ variacao: 715, quantidade: 12 }]);
  });

  /*
   * `[]` é "não é composto" e JSON quebrado é "não sei" — os dois viram
   * `undefined`, que deixa o produto em paz. Devolver lista vazia aqui faria a
   * caixa ser zerada por causa de um JSON estragado.
   */
  it('vazio e ilegível não viram composição', () => {
    expect(lerComposicaoGravada('[]')).toBeUndefined();
    expect(lerComposicaoGravada('{ isto não é json')).toBeUndefined();
    expect(lerComposicaoGravada(null)).toBeUndefined();
  });

  /* Quantidade zero dividiria por zero lá na frente. */
  it('item sem quantidade é descartado', () => {
    expect(lerComposicaoGravada('[{"v":715,"q":0}]')).toBeUndefined();
  });
});

describe('a conta da caixa, medida', () => {
  /* O caso do relato: HEINEKEN CAIXA = 12× HEINEKEN LATA, 35 latas. */
  it('35 latas de 12 em 12 dão 2 caixas, não 0', () => {
    const comp = lerComposicaoGravada('[{"v":715,"q":12}]');
    expect(estoqueDerivado(comp, new Map([[715, 35]]))).toBe(2);
  });

  /*
   * ESTE É O BUG INTEIRO EM UMA LINHA: o saldo próprio da caixa é 0 e não
   * entra na conta. Quem responde é a lata.
   */
  /*
   * COMPONENTE SEM LINHA DE ESTOQUE DERRUBA A CONTA INTEIRA PARA `null`, e não
   * é preciosismo: um kit de dois itens em que só um foi inventariado daria o
   * número do inventariado, e esse número é uma promessa que a loja não pode
   * cumprir — o outro item pode estar zerado.
   */
  it('componente sem saldo não deixa o outro responder sozinho', () => {
    const dois = [{ variacao: 715, quantidade: 12 }, { variacao: 900, quantidade: 1 }];
    expect(estoqueDerivado(dois, new Map([[715, 35]]))).toBeNull();
    expect(estoqueDerivado(dois, new Map([[715, 35], [900, 4]]))).toBe(2);
  });

  it('o zero residual do kit não entra na conta', () => {
    const comp = lerComposicaoGravada('[{"v":715,"q":12}]');
    const saldos = new Map([[715, 35], [716, 0]]);
    expect(estoqueDerivado(comp, saldos)).toBe(2);
  });
});

describe('o botão passa pela mesma regra do ciclo', () => {
  it('lê a composição gravada antes de perguntar o saldo próprio', () => {
    expect(ROTA).toContain('composicao_erp');
    const iComp = ROTA.indexOf('lerComposicaoGravada(p.composicao_erp)');
    const iProprio = ROTA.indexOf('saldoDeUmProduto(token, p.maxxgestao_variacao_id');
    expect(iComp).toBeGreaterThan(0);
    expect(iProprio).toBeGreaterThan(iComp);
  });

  it('deriva pelo componente em vez de ler o saldo da caixa', () => {
    expect(ROTA).toContain('const derivado = estoqueDerivado(composicao, saldos);');
    expect(ROTA).toContain('saldoDeUmProduto(token, item.variacao, local');
  });

  /*
   * O ciclo descobre composições algumas por passada. Quem clica no botão não
   * vai esperar a vez na fila para ver a caixa certa — e o resultado fica
   * gravado, então o ciclo não repergunta.
   */
  it('descobre a composição na hora quando ainda não sabe', () => {
    expect(ROTA).toContain('composicaoDoProduto(token, p.maxxgestao_variacao_id');
    expect(ROTA).toContain('await gravarComposicao(loja.id, p.id, itens);');
  });

  /*
   * COMPONENTE SEM LINHA DE ESTOQUE NÃO ZERA A CAIXA. "O ERP não tem registro"
   * e "o ERP diz que acabou" são coisas diferentes — e a segunda leitura é
   * justamente a que tirou a caixa do ar.
   */
  it('componente sem registro devolve sem_registro, e não zero', () => {
    const i = ROTA.indexOf('if (derivado === null) {');
    expect(i).toBeGreaterThan(0);
    const bloco = ROTA.slice(i, i + 700);
    expect(bloco).toContain('tem_registro: false');
    expect(bloco).toContain('estoque: Number(p.estoque ?? 0)');
    expect(bloco).toContain('Faça a entrada de estoque no item, não na caixa.');
  });

  /*
   * A CONTA VOLTA PARA A TELA. "3 em estoque" num produto com 40 latas no ERP
   * parece o mesmo defeito que se acabou de consertar.
   */
  it('devolve a conta que produziu o número', () => {
    expect(ROTA).toContain('por_unidade: i.quantidade');
    expect(ROTA).toContain('saldo_no_erp: saldos.get(i.variacao) ?? null');
  });
});

describe('o interruptor de não sincronizar vale no botão também', () => {
  /*
   * O ciclo respeitava `estoque_erp_ignorar`; o botão não. Quem desligou a
   * sincronização de um produto e clicou por engano via o estoque que controla
   * à mão ser sobrescrito pelo ERP, sem aviso.
   */
  it('recusa com explicação em vez de sobrescrever', () => {
    const i = ROTA.indexOf('if (p.estoque_erp_ignorar) {');
    expect(i).toBeGreaterThan(0);
    const bloco = ROTA.slice(i, i + 400);
    expect(bloco).toContain('res.status(400)');
    expect(bloco).toContain('está desligada neste produto');
  });

  /* E recusa ANTES de gastar chamada no ERP — 20 req/min é o teto da conta. */
  it('recusa antes de falar com o ERP', () => {
    expect(ROTA.indexOf('if (p.estoque_erp_ignorar) {'))
      .toBeLessThan(ROTA.indexOf('saldoDeUmProduto'));
  });
});
