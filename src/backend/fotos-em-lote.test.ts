import { describe, it, expect } from 'vitest';
import { processar, SQL_SEM_FOTO, PAUSA_PADRAO, type ProdutoSemFoto, type Ferramentas } from './fotos-em-lote';
import type { ImagemConvertida } from './imagem-web';
import type { Fundo } from './fundo-branco';

/*
 * A BUSCA DE FOTOS EM LOTE.
 *
 * O QUE ESTÁ EM JOGO: isto roda em cima do catálogo de uma loja de verdade e
 * grava foto em produto de verdade. Medido em 10/09/2026, a Galderio tem 281
 * produtos à venda sem foto e 255 deles com código de barras — um erro aqui é
 * um erro repetido 255 vezes.
 *
 * As duas garantias que este arquivo tranca:
 *   1. o ENSAIO não escreve nada (é o padrão da ferramenta);
 *   2. foto que já existe NUNCA é sobrescrita, nem na seleção nem na escrita.
 *
 * A rede e o banco entram por parâmetro (`Ferramentas`): o que precisa ser
 * provado é a decisão, e ela não depende de haver MySQL na máquina que roda a
 * suíte.
 */

const PRODUTOS: ProdutoSemFoto[] = [
  { id: 1, nome: 'AMSTEL LATA 350ML', codigo_barras: '7891991015493' },
  { id: 2, nome: 'VINHO DA SERRA', codigo_barras: '7896052605279' },
  { id: 3, nome: 'AGUA COM GAS', codigo_barras: '7894900011609' },
];

function imagemFalsa(): ImagemConvertida {
  return { buffer: Buffer.alloc(40_000, 7), extensao: '.webp', mime: 'image/webp', largura: 800, altura: 800 };
}

const fundoBom: Fundo = {
  cantos: [1, 1, 1, 1], piorCanto: 1, global: 0.8, conteudo: 0.2, temProduto: true, branco: true,
};

/** Uma bancada: registra tudo o que a ferramenta tentou fazer. */
function bancada(achou: (codigo: string) => boolean, ligou = true) {
  const escritas: string[] = [];
  const ligacoes: Array<{ id: number; url: string; credito: string }> = [];
  const esperas: number[] = [];
  const f: Ferramentas = {
    achar: (async (codigo: string) => achou(codigo)
      ? {
        ok: true,
        achado: {
          fonte: 'cosmos' as const, nomeNaBase: 'Cerveja', marca: 'Marca',
          credito: 'Cosmos / Bluesoft', imagem: imagemFalsa(), fundo: fundoBom, previa: 'data:image/webp;base64,xx',
        },
      }
      : { ok: false, motivo: 'fundo-nao-branco' as const, fonteTentada: 'openfoodfacts' as const }
    ) as Ferramentas['achar'],
    gravarArquivo: async (_b, ext) => { escritas.push(ext); return `/uploads/x${escritas.length}${ext}`; },
    ligarAoProduto: async (id, url, credito) => { ligacoes.push({ id, url, credito }); return ligou; },
    esperar: async (ms) => { esperas.push(ms); },
    log: () => {},
  };
  return { f, escritas, ligacoes, esperas };
}

describe('o ensaio', () => {
  /*
   * ENSAIO NÃO ESCREVE — é o padrão da ferramenta, e é o que permite olhar
   * antes. A busca acontece igual, porque é ela que diz o que daria certo.
   */
  it('procura tudo e não grava nada', async () => {
    const b = bancada(() => true);
    const r = await processar(PRODUTOS, { valendo: false }, b.f);
    expect(r.tentados).toBe(3);
    expect(r.porFonte.cosmos).toBe(3);
    expect(r.gravados).toBe(0);
    expect(b.escritas).toEqual([]);
    expect(b.ligacoes).toEqual([]);
  });
});

describe('valendo', () => {
  it('grava o arquivo e liga ao produto', async () => {
    const b = bancada(() => true);
    const r = await processar(PRODUTOS, { valendo: true }, b.f);
    expect(r.gravados).toBe(3);
    expect(b.escritas).toEqual(['.webp', '.webp', '.webp']);
    expect(b.ligacoes.map(l => l.id)).toEqual([1, 2, 3]);
    /* O crédito sobe junto com a foto: a licença da fonte exige atribuição. */
    expect(b.ligacoes[0].credito).toBe('Cosmos / Bluesoft');
  });

  /*
   * O LOJISTA GANHA A CORRIDA. Entre montar a lista e gravar passam minutos, e
   * nesses minutos ele pode ter subido a foto dele — que vale mais que a minha.
   * `ligarAoProduto` devolvendo `false` significa "já tinha foto", e isso não
   * pode ser contado como sucesso nem repetido.
   */
  it('produto que ganhou foto no meio do caminho não é sobrescrito', async () => {
    const b = bancada(() => true, false);
    const r = await processar(PRODUTOS, { valendo: true }, b.f);
    expect(r.gravados).toBe(0);
    expect(r.porMotivo['ja-tinha-foto']).toBe(3);
  });

  /* Produto sem foto boa não vira escrita nenhuma — nem arquivo órfão. */
  it('o que não achou não grava', async () => {
    const b = bancada(cod => cod === '7891991015493');
    const r = await processar(PRODUTOS, { valendo: true }, b.f);
    expect(r.gravados).toBe(1);
    expect(b.escritas.length).toBe(1);
    expect(r.porMotivo['fundo-nao-branco']).toBe(2);
  });
});

describe('educação com as fontes', () => {
  /*
   * PAUSA ENTRE PRODUTOS, inclusive nos que falharam. 255 consultas em rajada
   * é o tipo de coisa que faz um serviço gratuito bloquear o IP do servidor —
   * e aí a lupa do cadastro para de funcionar para todo mundo por causa de um
   * lote. A pausa depois da falha importa igual: 429 é falha, e insistir mais
   * rápido é o oposto do que ele pediu.
   */
  it('espera entre um produto e outro, achando ou não', async () => {
    const b = bancada(cod => cod === '7891991015493');
    await processar(PRODUTOS, { valendo: false, pausa: 250 }, b.f);
    expect(b.esperas).toEqual([250, 250, 250]);
  });

  it('a pausa padrão não é zero', () => {
    expect(PAUSA_PADRAO).toBeGreaterThanOrEqual(300);
  });
});

describe('a consulta que escolhe os produtos', () => {
  /*
   * A SELEÇÃO É PARTE DA REGRA. Produto com foto não entra na lista — e essa é
   * a primeira das duas barreiras contra sobrescrever o trabalho do lojista
   * (a segunda está no UPDATE).
   */
  it('só produto sem foto', () => {
    expect(SQL_SEM_FOTO).toContain("foto_url IS NULL OR foto_url = ''");
  });

  it('só produto com código de barras', () => {
    expect(SQL_SEM_FOTO).toContain("codigo_barras <> ''");
  });

  /* Produto excluído ou fora de venda não precisa de foto: gastar consulta de
     terceiro com ele é gastar cota por nada. */
  it('só produto à venda, e não o excluído', () => {
    expect(SQL_SEM_FOTO).toContain('excluido = 0');
    expect(SQL_SEM_FOTO).toContain('disponivel = 1 OR disponivel_pdv = 1');
  });

  it('é filtrada por loja', () => {
    expect(SQL_SEM_FOTO).toContain('loja_id = ?');
  });
});


describe('o lote aguenta o produto que explode', () => {
  /*
   * SAO 255 PRODUTOS E MINUTOS DE EXECUCAO. Uma excecao no 200o — disco cheio,
   * rede caindo no meio, imagem que faz o `sharp` lancar — abortava a corrida
   * inteira E LEVAVA O RELATORIO JUNTO: ninguem ficava sabendo o que ja tinha
   * sido gravado antes da queda.
   */
  it('busca que lanca vira uma linha de falha, e a fila continua', async () => {
    const b = bancada(() => true);
    let n = 0;
    const original = b.f.achar;
    b.f.achar = (async (codigo: string) => {
      n++;
      if (n === 2) throw new Error('rede caiu');
      return original(codigo);
    }) as typeof b.f.achar;

    const r = await processar(PRODUTOS, { valendo: true }, b.f);
    expect(r.tentados).toBe(3);
    expect(r.gravados).toBe(2);
    expect(r.porMotivo['erro']).toBe(1);
  });

  it('falha ao gravar tambem nao derruba o resto', async () => {
    const b = bancada(() => true);
    let n = 0;
    b.f.gravarArquivo = async () => {
      n++;
      if (n === 1) throw new Error('disco cheio');
      return '/uploads/ok.webp';
    };
    const r = await processar(PRODUTOS, { valendo: true }, b.f);
    expect(r.tentados).toBe(3);
    expect(r.gravados).toBe(2);
    expect(r.porMotivo['erro']).toBe(1);
  });

  /*
   * A PAUSA E A MEDIDA PELO OUTRO MODULO, nao um segundo palpite. Eu tinha
   * posto 400 ms — um terco do limite que `foto-por-codigo.ts` mediu na propria
   * Open Food Facts como o ponto em que ela barra.
   */
  it('a pausa e exatamente o limite medido', async () => {
    const { LIMITE_ENTRE_CHAMADAS } = await import('./foto-por-codigo');
    expect(PAUSA_PADRAO).toBe(LIMITE_ENTRE_CHAMADAS);
  });
});
