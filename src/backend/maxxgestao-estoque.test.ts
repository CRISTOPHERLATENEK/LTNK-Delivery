import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  planejarEstoque, saldoParaEstoque, quantosSairiamDoAr, planoEstoqueVazio,
  type ProdutoComEstoque,
} from './maxxgestao-estoque';

/*
 * O SALDO DO MAXX GESTÃO VIRANDO ESTOQUE DO CARDÁPIO.
 *
 * O SALDO EXISTE NA API DELES — e eu tinha dito que não existia. Em 14/09/2026
 * sondei 25 caminhos prováveis, todos 404, e conclui que não havia. A forma
 * real é `/api/local-estoque/{id}/estoques/v1`, e só apareceu quando o lojista
 * abriu o swagger deles (que exige login). Adivinhar URL é um jeito ruim de
 * concluir que algo não existe.
 *
 * MEDIDO NO CADASTRO REAL DO GALDERIO em 15/09/2026, antes de escrever código:
 *
 *   variações com linha de estoque .... 1.219
 *   saldo > 0 / = 0 / < 0 ............. 738 / 306 / 175
 *   produtos à venda hoje ............. 644
 *   ficariam SEM saldo ................ 210  (33%)
 *
 * Um terço do cardápio sairia do ar no primeiro minuto — Coca-Cola Zero 2L e
 * Pepsi 2L com saldo zero, e 175 itens NEGATIVOS. O estoque do ERP não é
 * mantido item a item, e isso é o normal do comércio.
 *
 * É por isso que estes testes existem: eles prendem as três decisões que
 * impedem a sincronização de esvaziar uma loja.
 */

const nosso = (id: number, extra: Partial<ProdutoComEstoque> = {}): ProdutoComEstoque => ({
  id, variacaoErp: id, estoque: 0, controlaEstoque: false, disponivel: true, ...extra,
});

describe('o saldo que o ERP manda', () => {
  /*
   * NEGATIVO VIRA ZERO. O ERP admite estoque negativo e 175 itens do Galderio
   * estão assim. A coluna alimenta "só restam N" na tela do cliente, e "só
   * restam -4" é defeito visível.
   */
  it('negativo vira zero', () => {
    expect(saldoParaEstoque(-4)).toBe(0);
    expect(saldoParaEstoque(-0.5)).toBe(0);
  });

  /*
   * FRAÇÃO ARREDONDA PARA BAIXO. Mercadoria a peso vem com casas decimais; 2,8
   * caixas viram 2, porque prometer a terceira é prometer o que não tem.
   */
  it('fração arredonda para baixo, nunca para cima', () => {
    expect(saldoParaEstoque(2.8)).toBe(2);
    expect(saldoParaEstoque(0.9)).toBe(0);
    expect(saldoParaEstoque(13)).toBe(13);
  });

  it('valor estranho vale zero', () => {
    expect(saldoParaEstoque(NaN)).toBe(0);
    expect(saldoParaEstoque(Infinity)).toBe(0);
  });
});

describe('o que a passada grava', () => {
  it('grava o saldo que mudou', () => {
    const p = planejarEstoque(new Map([[1, 13], [2, 5]]), [nosso(1), nosso(2, { estoque: 5 })]);
    expect(p.ajustar).toEqual([{ id: 1, estoque: 13 }]);
    expect(p.semMudanca).toBe(1);
  });

  /*
   * PRODUTO SEM LINHA DE ESTOQUE NO ERP É DEIXADO EM PAZ — não é zerado.
   *
   * "O ERP não tem linha para este item" e "o ERP diz que acabou" são coisas
   * diferentes, e tratar a primeira como a segunda zeraria produto que ninguém
   * nunca inventariou. No Galderio são 16; numa loja que só inventaria bebida,
   * seriam todos os salgadinhos.
   */
  it('sem linha no ERP, não mexe', () => {
    const p = planejarEstoque(new Map([[1, 7]]), [nosso(1), nosso(2, { estoque: 40 })]);
    expect(p.ajustar).toEqual([{ id: 1, estoque: 7 }]);
    expect(p.semLinha).toBe(1);
  });

  it('produto que não veio do ERP fica de fora', () => {
    /* Produto que o lojista montou à mão não é da conta desta sincronização. */
    const p = planejarEstoque(new Map([[1, 7]]), [nosso(50, { variacaoErp: 0, estoque: 3 })]);
    expect(p.ajustar).toEqual([]);
    expect(p.semLinha).toBe(0);
  });

  it('saldo negativo grava zero, e não o negativo', () => {
    const p = planejarEstoque(new Map([[1, -4]]), [nosso(1, { estoque: 9 })]);
    expect(p.ajustar).toEqual([{ id: 1, estoque: 0 }]);
  });

  it('nada mudou é plano vazio', () => {
    const p = planejarEstoque(new Map([[1, 5]]), [nosso(1, { estoque: 5 })]);
    expect(planoEstoqueVazio(p)).toBe(true);
  });
});

describe('a conta que o lojista vê antes de ligar o bloqueio', () => {
  /*
   * ESTE É O NÚMERO QUE DECIDE. Sem ele na tela, ligar "sem saldo = fora do ar"
   * é uma aposta; com ele, é uma escolha. No Galderio a resposta é 210 de 644.
   */
  it('conta só o que está à venda e veio do ERP', () => {
    const { aVenda, sairiam } = quantosSairiamDoAr(
      new Map([[1, 10], [2, 0], [3, -2]]),
      [
        nosso(1),                                   /* tem saldo: fica */
        nosso(2),                                   /* zerado: sai */
        nosso(3),                                   /* negativo: sai */
        nosso(4),                                   /* sem linha: sai */
        nosso(5, { disponivel: false }),            /* já pausado: não conta */
        nosso(6, { variacaoErp: 0 }),               /* não é do ERP: não conta */
      ],
    );
    expect(aVenda).toBe(4);
    expect(sairiam).toBe(3);
  });

  /*
   * SEM LINHA CONTA COMO SAIR. Com o bloqueio ligado e estoque zero gravado, o
   * produto some do mesmo jeito — o número na tela tem que ser o que VAI
   * acontecer, não o que seria elegante.
   */
  it('produto sem linha de estoque conta como saída', () => {
    const { sairiam } = quantosSairiamDoAr(new Map(), [nosso(1), nosso(2)]);
    expect(sairiam).toBe(2);
  });
});

describe('a sincronização NÃO liga o bloqueio de venda', () => {
  /*
   * A REGRA QUE JUSTIFICA O ARQUIVO INTEIRO, e por isso é asserção de fonte:
   * `controla_estoque` é o que BLOQUEIA a venda. Se a gravação o ligasse, 33%
   * do cardápio do Galderio sairia do ar na primeira passada, de madrugada.
   */
  const deps = fs.readFileSync(path.join(__dirname, 'maxxgestao-importar-deps.ts'), 'utf8');
  const semComentarios = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a gravação de estoque toca SÓ a coluna estoque', () => {
    const codigo = semComentarios(deps);
    const i = codigo.indexOf('export async function aplicarEstoque');
    expect(i).toBeGreaterThan(0);
    const corpo = codigo.slice(i, codigo.indexOf('\n}', i));
    expect(corpo).toContain('UPDATE produtos SET estoque = ?');
    expect(corpo).not.toContain('controla_estoque');
    expect(corpo).not.toContain('disponivel');
  });

  it('e nenhum lugar da sincronização liga controla_estoque', () => {
    const arquivos = ['maxxgestao-estoque.ts', 'maxxgestao-sincronizar-ciclo.ts', 'maxxgestao-importar-deps.ts'];
    for (const a of arquivos) {
      const codigo = semComentarios(fs.readFileSync(path.join(__dirname, a), 'utf8'));
      expect(codigo, a).not.toMatch(/controla_estoque\s*=\s*1/);
    }
  });
});

describe('a leitura do saldo é por LISTA, não por produto', () => {
  /*
   * A consulta individual existe (`/api/mercadoria/{id}/local-estoque/{id}/
   * estoque/v1`) e custaria UMA CHAMADA POR ITEM — 1.100 itens a 20 por minuto
   * é quase uma hora, com o mesmo orçamento que emite a NFC-e de cada pedido.
   * A listagem por local resolve em 11 a 13 chamadas de 100.
   */
  it('usa a listagem do local', () => {
    const cat = fs.readFileSync(path.join(__dirname, 'maxxgestao-catalogo.ts'), 'utf8');
    const i = cat.indexOf('export async function saldosDoLocal');
    expect(i).toBeGreaterThan(0);
    const corpo = cat.slice(i, i + 900);
    expect(corpo).toContain('/estoques/v1');
    expect(corpo).toContain('limit=100');
    /* NÃO a consulta item a item. */
    expect(corpo).not.toContain('/local-estoque/${idLocalEstoque}/estoque/v1');
  });
});
