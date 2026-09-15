import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  planejarEstoque, planejarControleDeEstoque, type ProdutoComEstoque,
} from './maxxgestao-estoque';

/*
 * "A SINCRONIZAÇÃO NÃO MEXE NO ESTOQUE DESTE PRODUTO."
 *
 * ────────────────────────── O CASO, MEDIDO ──────────────────────────────────
 *
 * O lojista monta o POTE DE JACK TRADICIONAL no delivery: o pote é o produto, e
 * dentro dele o cliente escolhe 2 gelos e 1 energético. O que sai da prateleira
 * é o gelo e o whisky — o "pote" em si não é inventariado.
 *
 * Só que ele existe no Maxx Gestão, com SKU 1203, e lá o saldo dele estava em
 * −7 (medido em 15/09/2026, com o SKU presente na lista de 1.219 linhas do
 * local de estoque). Com saldo negativo, a rotina de estoque:
 *
 *   1. ligava `controla_estoque` (porque "tem linha no ERP");
 *   2. gravava estoque 0;
 *   3. e o pote amanhecia ESGOTADO no cardápio.
 *
 * Desligar "Controlar estoque" no painel não resolvia: dois minutos depois a
 * rotina via de novo "tem linha no ERP e o controle está desligado" e ligava
 * outra vez — porque para ela esse estado sempre significou "ainda não liguei
 * este". Confirmado na base do Galderio às 19:37 do mesmo dia.
 *
 * Faltava o painel poder dizer que foi DE PROPÓSITO. Nas palavras do lojista:
 * "a única coisa que vou controlar vai ser o gelo mesmo".
 */

const nosso = (id: number, extra: Partial<ProdutoComEstoque> = {}): ProdutoComEstoque => ({
  id, variacaoErp: id, estoque: 0, controlaEstoque: false,
  estoqueDoErp: false, disponivel: true, ...extra,
});

describe('o produto marcado fica de fora', () => {
  /* O saldo do pote no ERP não descreve nada que exista na prateleira —
     gravá-lo seria escrever um número errado com confiança. */
  it('o saldo dele não é gravado', () => {
    const p = planejarEstoque(new Map([[1, -7], [2, 40]]), [
      nosso(1, { ignorarErp: true, estoque: 5 }),
      nosso(2, { estoque: 0 }),
    ], true);
    expect(p.ajustar.map(a => a.id)).toEqual([2]);
  });

  /* É o item 1 do defeito: era isto que esgotava o pote todo dia. */
  it('o bloqueio de venda não é ligado nele', () => {
    const p = planejarControleDeEstoque(new Map([[1, -7]]), [
      nosso(1, { ignorarErp: true }),
    ], true);
    expect(p.ligar).toEqual([]);
    expect(p.desligar).toEqual([]);
  });

  /*
   * O "NÃO MEXE" VALE INCLUSIVE PARA DESLIGAR.
   *
   * Tentador seria devolver ao normal o que a rotina tinha ligado antes da
   * marca. Mas o lojista pode ter deixado o controle LIGADO de propósito,
   * contando o estoque do pote na mão — e a marca diz "não mexa", não
   * "desligue".
   */
  it('nem desliga o que a rotina tinha ligado antes', () => {
    const p = planejarControleDeEstoque(new Map(), [
      nosso(1, { ignorarErp: true, estoqueDoErp: true, controlaEstoque: true }),
    ], true);
    expect(p.desligar).toEqual([]);
  });

  /* Com o esgotamento da loja desligado, o marcado também não é tocado. */
  it('vale também com o esgotamento automático desligado', () => {
    const p = planejarControleDeEstoque(new Map([[1, 3]]), [
      nosso(1, { ignorarErp: true, estoqueDoErp: true }),
    ], false);
    expect(p.desligar).toEqual([]);
  });
});

describe('quem não está marcado segue como antes', () => {
  /*
   * A MARCA É EXCEÇÃO, e o gelo é a regra: é ele que o lojista quer controlar.
   * Sem este teste, "ignorar tudo" passaria.
   */
  it('o gelo continua tendo saldo e bloqueio', () => {
    const saldos = new Map([[1, -7], [580, 12]]);
    const nossos = [nosso(1, { ignorarErp: true }), nosso(580, { estoque: 0 })];
    const p = planejarEstoque(saldos, nossos, true);
    expect(p.ajustar).toEqual([{ id: 580, estoque: 12 }]);
    expect(p.ligarControle).toEqual([580]);
  });

  /* Produto sem a marca e com saldo negativo continua esgotando — é o
     comportamento que o lojista pediu e que está no ar. */
  it('saldo negativo sem marca continua esgotando', () => {
    const p = planejarEstoque(new Map([[9, -3]]), [nosso(9, { estoque: 4 })], true);
    expect(p.ajustar).toEqual([{ id: 9, estoque: 0 }]);
    expect(p.ligarControle).toEqual([9]);
  });
});

/* ───────────────────── o caminho do dado ───────────────────── */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));
const DEPS = semComentarios(ler('src', 'backend', 'maxxgestao-importar-deps.ts'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));

describe('a marca chega da tela até a decisão', () => {
  it('a coluna existe e nasce desligada', () => {
    const i = SCHEMA.indexOf("'produtos', 'estoque_erp_ignorar'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 200)).toContain('DEFAULT 0');
  });

  /*
   * O DEFEITO MAIS FÁCIL DE COMETER AQUI: gravar a marca e a rotina nunca lê-la.
   * O interruptor pareceria funcionar (fica ligado na tela) e o pote continuaria
   * esgotando sozinho — que é exatamente o sintoma de hoje.
   */
  it('a rotina lê a coluna do banco', () => {
    /* A COLUNA TEM QUE ESTAR NO SELECT, e não só no mapeamento: procurar o nome
       solto no arquivo deixava o teste passar com a coluna fora da consulta —
       foi o que a sabotagem mostrou. Sem ela no SELECT, `l.estoque_erp_ignorar`
       é `undefined` e a marca nunca vale. */
    const i = DEPS.indexOf('export async function produtosComEstoque');
    expect(i).toBeGreaterThan(0);
    const corpo = DEPS.slice(i, DEPS.indexOf('\n}', i));
    expect(corpo).toMatch(/SELECT[\s\S]*estoque_erp_ignorar[\s\S]*FROM produtos/);
    expect(corpo).toContain('ignorarErp: !!l.estoque_erp_ignorar');
  });

  it('a rota salva a marca', () => {
    /* É O CORPO DA REQUISIÇÃO QUE DECIDE. Trocar a condição por `false` deixava
       a rota sempre repetir o valor atual — o interruptor nunca salvaria, e o
       teste antigo passava porque só procurava o nome do campo solto. */
    expect(LOJISTA).toContain('corpo.estoque_erp_ignorar !== undefined');
    expect(LOJISTA).toContain('estoque_erp_ignorar = ?');
    expect(LOJISTA).toContain('c.estoqueErpIgnorar');
  });

  it('a tela manda e relê a marca', () => {
    expect(TELA).toContain('estoque_erp_ignorar: form.estoque_erp_ignorar');
    expect(TELA).toContain('estoque_erp_ignorar?: number }).estoque_erp_ignorar');
  });

  /*
   * O INTERRUPTOR SÓ APARECE EM PRODUTO VINDO DO ERP: sem vínculo não existe
   * sincronização para desligar, e a pergunta seria sobre um mecanismo que
   * aquele produto não tem.
   */
  it('o interruptor só aparece em produto vinculado ao ERP', () => {
    const i = TELA.indexOf('Não sincronizar o estoque deste produto');
    expect(i).toBeGreaterThan(0);
    expect(TELA.slice(Math.max(0, i - 400), i)).toContain('maxxgestao_variacao_id');
  });
});
