import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  planejarEstoque, saldoParaEstoque, quantosSairiamDoAr, planoEstoqueVazio,
  planejarControleDeEstoque, leituraDeEstoqueConfiavel, QUEDA_MAXIMA_DA_LEITURA,
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
  id, variacaoErp: id, estoque: 0, controlaEstoque: false, estoqueDoErp: false,
  disponivel: true, ...extra,
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

  /*
   * LIGAR O BLOQUEIO MORA NUM LUGAR SÓ, e esse lugar só é alcançado pelo
   * interruptor que o lojista liga.
   *
   * Este teste já foi "nenhum lugar liga `controla_estoque`" — e a premissa
   * mudou quando o lojista pediu o esgotamento automático. O que continua
   * valendo, e é o que protege a loja, é que a passada COMUM (a que roda de
   * hora em hora sem ninguém pedir) não liga nada: ela só escreve o número.
   */
  it('só UMA função liga o bloqueio, e não é a da passada comum', () => {
    const arquivos = ['maxxgestao-estoque.ts', 'maxxgestao-sincronizar-ciclo.ts', 'maxxgestao-importar-deps.ts'];
    const ondeLiga: string[] = [];
    for (const a of arquivos) {
      const codigo = semComentarios(fs.readFileSync(path.join(__dirname, a), 'utf8'));
      for (const m of codigo.matchAll(/controla_estoque\s*=\s*1/g)) {
        /* Qual função contém esta linha? A última declarada antes dela. */
        const antes = codigo.slice(0, m.index);
        const decl = [...antes.matchAll(/function (\w+)/g)].pop();
        ondeLiga.push(`${a}:${decl ? decl[1] : '(solta)'}`);
      }
    }
    expect(ondeLiga).toEqual(['maxxgestao-importar-deps.ts:aplicarControleDeEstoque']);
  });

  /*
   * E ELA SÓ RECEBE PRODUTO PARA LIGAR QUANDO O INTERRUPTOR ESTÁ LIGADO —
   * provado pelo comportamento, não pela fonte: `planejarControleDeEstoque` com
   * `esgotarSozinho: false` não devolve ninguém para ligar, por mais saldo que
   * o ERP informe.
   */
  it('com o interruptor desligado, ninguém é ligado', () => {
    const { ligar } = planejarControleDeEstoque(
      new Map([[1, 10], [2, 0], [3, 5]]),
      [nosso(1), nosso(2), nosso(3)],
      false,
    );
    expect(ligar).toEqual([]);
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

describe('esgotar sozinho quando o saldo zera', () => {
  /*
   * O PEDIDO, NAS PALAVRAS DELE: "se um suco estiver com o estoque zero no
   * Maxx Gestão, o delivery tem que deixar automático como esgotado".
   *
   * O mecanismo já existia inteiro — com `controla_estoque` ligado e saldo
   * zero, a vitrine mostra "Esgotado" em cinza e não deixa abrir o produto.
   * Faltava ligá-lo nos produtos que vêm do ERP.
   */
  it('liga o controle nos produtos que têm saldo no ERP', () => {
    const { ligar, desligar } = planejarControleDeEstoque(
      new Map([[1, 10], [2, 0]]), [nosso(1), nosso(2)], true);
    /* O DE SALDO ZERO TAMBÉM ENTRA — é justamente ele que precisa esgotar. */
    expect(ligar).toEqual([1, 2]);
    expect(desligar).toEqual([]);
  });

  /*
   * PRODUTO SEM LINHA DE ESTOQUE NO ERP NÃO PASSA A ESGOTAR. Ele tem saldo zero
   * aqui porque ninguém o inventariou lá — esgotá-lo seria tirá-lo do ar sem
   * que ninguém tivesse dito que acabou. No Galderio são 16 produtos.
   */
  it('produto sem linha no ERP continua vendendo', () => {
    const { ligar } = planejarControleDeEstoque(new Map([[1, 10]]), [nosso(1), nosso(2)], true);
    expect(ligar).toEqual([1]);
  });

  it('não mexe em quem já está controlando', () => {
    const { ligar } = planejarControleDeEstoque(
      new Map([[1, 10]]), [nosso(1, { controlaEstoque: true })], true);
    expect(ligar).toEqual([]);
  });

  /*
   * DESLIGAR TEM VOLTA, E SÓ DO QUE FOI LIGADO AQUI.
   *
   * Sem a marca `estoqueDoErp`, desligar teria duas saídas ruins: deixar tudo
   * controlando para sempre, ou desligar também o produto que o lojista
   * controlava À MÃO — apagando uma decisão dele.
   */
  it('desligado, devolve só o que a sincronização tinha ligado', () => {
    const { ligar, desligar } = planejarControleDeEstoque(
      new Map([[1, 10], [2, 3]]),
      [
        nosso(1, { controlaEstoque: true, estoqueDoErp: true }),  /* nós ligamos */
        nosso(2, { controlaEstoque: true, estoqueDoErp: false }), /* o lojista ligou */
      ],
      false,
    );
    expect(ligar).toEqual([]);
    expect(desligar).toEqual([1]);
  });

  /*
   * PERDEU A LINHA NO ERP, PARA DE ESGOTAR. O produto deixou de ser
   * inventariado lá; mantê-lo esgotado por um saldo que ninguém mais atualiza é
   * tirá-lo do ar para sempre, em silêncio.
   */
  it('quem some do estoque do ERP volta a vender', () => {
    const { desligar } = planejarControleDeEstoque(
      new Map(), [nosso(1, { controlaEstoque: true, estoqueDoErp: true })], true);
    expect(desligar).toEqual([1]);
  });

  it('produto que não veio do ERP nunca é tocado', () => {
    const ligado = planejarControleDeEstoque(
      new Map([[0, 5]]), [nosso(9, { variacaoErp: 0, controlaEstoque: true, estoqueDoErp: true })], true);
    const desligado = planejarControleDeEstoque(
      new Map(), [nosso(9, { variacaoErp: 0, controlaEstoque: true, estoqueDoErp: true })], false);
    expect(ligado.ligar.concat(ligado.desligar)).toEqual([]);
    expect(desligado.ligar.concat(desligado.desligar)).toEqual([]);
  });

  /* Desligado é o padrão: `planejarEstoque` sem o terceiro argumento não pode
     ligar o esgotamento de ninguém. */
  it('o padrão é NÃO esgotar', () => {
    const p = planejarEstoque(new Map([[1, 0]]), [nosso(1)]);
    expect(p.ligarControle).toEqual([]);
  });
});

describe('ligar o interruptor vale NA HORA', () => {
  /*
   * DEFEITO QUE O LOJISTA ACHOU, em 15/09/2026, minutos depois de ligar.
   *
   * Ele ligou "esgotar sozinho" às 11:41. A rota gravava a coluna e pronto —
   * quem APLICAVA era a passada de hora em hora, e a próxima era às 12:00. Ele
   * abriu a vitrine, viu um produto com saldo -1 no Maxx Gestão ainda à venda,
   * e mandou um print com "???".
   *
   * Da tela, "vai valer daqui a uma hora" é indistinguível de "não funcionou" —
   * e a conclusão natural é que o sistema está quebrado. A aplicação custa 11 a
   * 13 chamadas ao ERP, o que cabe numa requisição.
   */
  const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const semComent = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const CODIGO = semComent(rotas);

  it('a rota do esgotamento aplica sem esperar a passada', () => {
    const i = CODIGO.indexOf("router.put('/erp/estoque-esgota'");
    expect(i).toBeGreaterThan(0);
    const corpo = CODIGO.slice(i, CODIGO.indexOf("router.put('/erp/sincronizacao-automatica'", i));
    expect(corpo).toContain('sincronizarEstoqueDaLoja(');
    /* E a gravação da coluna vem ANTES: aplicar com o valor antigo não faria
       nada, e a tela mostraria zero. */
    expect(corpo.indexOf('maxxgestao_estoque_esgota = ?'))
      .toBeLessThan(corpo.indexOf('sincronizarEstoqueDaLoja('));
  });

  it('escolher o local traz o saldo na hora', () => {
    const i = CODIGO.indexOf("router.put('/erp/local-estoque'");
    expect(i).toBeGreaterThan(0);
    const corpo = CODIGO.slice(i, i + 2000);
    expect(corpo).toContain('sincronizarEstoqueDaLoja(');
  });

  /*
   * E SE O LIMITE DO ERP ESTOURAR, A RESPOSTA NÃO MENTE. Um número inventado
   * seria pior que a espera: o lojista conferiria a vitrine contra ele.
   */
  it('falha ao aplicar não derruba a troca do ajuste', () => {
    const i = CODIGO.indexOf("router.put('/erp/estoque-esgota'");
    const corpo = CODIGO.slice(i, CODIGO.indexOf("router.put('/erp/sincronizacao-automatica'", i));
    expect(corpo).toMatch(/\.catch\(\(\) => null\)/);
    expect(corpo).toContain('aplicado_agora');
  });
});

describe('leitura de estoque encolhida é ignorada', () => {
  /*
   * O CASO: a listagem do ERP responder TRUNCADA — dizer `hasNext: false` no
   * meio, por um tropeço do lado deles. Nada falha, nada lança; só chegam 300
   * linhas onde havia 1.070.
   *
   * O ESTRAGO NÃO É PRODUTO SUMINDO, É PRODUTO PISCANDO. As 770 que faltaram
   * viram "sem linha no ERP", e com o esgotamento ligado isso significa "voltar
   * a vender"; dois minutos depois a leitura vem inteira e esgota tudo de novo.
   * O cliente vê preço aparecer e sumir a cada dois minutos.
   */
  it('metade das linhas some: leitura recusada', () => {
    expect(leituraDeEstoqueConfiavel(300, 1070)).toBe(false);
  });

  it('variação normal do cadastro passa', () => {
    expect(leituraDeEstoqueConfiavel(1065, 1070)).toBe(true);
    expect(leituraDeEstoqueConfiavel(900, 1070)).toBe(true);
    /* Cadastro cresce: leitura maior nunca é suspeita. */
    expect(leituraDeEstoqueConfiavel(2000, 1070)).toBe(true);
  });

  /*
   * A PRIMEIRA LEITURA SEMPRE PASSA — não há com o que comparar, e recusá-la
   * deixaria o estoque parado para sempre numa loja nova.
   */
  it('sem leitura anterior, aceita', () => {
    expect(leituraDeEstoqueConfiavel(50, 0)).toBe(true);
  });

  it('leitura vazia nunca é aceita', () => {
    expect(leituraDeEstoqueConfiavel(0, 0)).toBe(false);
    expect(leituraDeEstoqueConfiavel(0, 1070)).toBe(false);
  });

  it('a linha é a metade, e é ela que decide', () => {
    const n = 1000;
    expect(leituraDeEstoqueConfiavel(Math.ceil(n * QUEDA_MAXIMA_DA_LEITURA), n)).toBe(true);
    expect(leituraDeEstoqueConfiavel(Math.ceil(n * QUEDA_MAXIMA_DA_LEITURA) - 1, n)).toBe(false);
  });

  /*
   * A RÉGUA É A ÚLTIMA LEITURA BOA, e não uma fração dos produtos vinculados.
   * Uma loja pode legitimamente inventariar só as bebidas — 10% de cobertura é
   * o normal DELA, e uma régua baseada no cadastro a rejeitaria para sempre.
   */
  it('a régua acompanha a loja, não um palpite sobre o negócio dela', () => {
    /* Loja que só inventaria bebida: 80 linhas para 1.100 produtos, estável. */
    expect(leituraDeEstoqueConfiavel(80, 80)).toBe(true);
    expect(leituraDeEstoqueConfiavel(78, 80)).toBe(true);
    expect(leituraDeEstoqueConfiavel(20, 80)).toBe(false);
  });
});

describe('a passada de estoque consulta e atualiza a régua', () => {
  const ciclo = fs.readFileSync(path.join(__dirname, 'maxxgestao-sincronizar-ciclo.ts'), 'utf8');
  const semComent2 = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const C = semComent2(ciclo);

  it('confere antes de gravar qualquer coisa', () => {
    const iConfere = C.indexOf('leituraDeEstoqueConfiavel(');
    const iGrava = C.indexOf('aplicarEstoque(');
    expect(iConfere).toBeGreaterThan(0);
    expect(iConfere).toBeLessThan(iGrava);
  });

  /* Leitura boa é leitura boa mesmo sem nada a gravar: sem isso a régua
     envelhece e um dia rejeita a leitura inteira. */
  it('a régua é atualizada também quando nada muda', () => {
    const i = C.indexOf('if (planoEstoqueVazio(plano))');
    expect(C.slice(i, i + 220)).toContain('gravarLinhasDeEstoque');
  });
});
