import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { proximoNumero, maiorNumero, ultimaPagina, serieValida } from './maxxgestao-numeracao';
import { montarDocumento, type DadosDoPedido, type ConfigDocumento } from './maxxgestao-documento';

/*
 * SÉRIE E NÚMERO DO DOCUMENTO NO MAXX GESTÃO.
 *
 * "tem que sair a serie do pedido e numero do documento."
 *
 * O delivery montava o documento SEM os dois, e a API pública não recusa. A
 * documentação de cada campo diz, com todas as letras:
 *
 *   numero → "Número do documento. Quando não informado, grava 0."
 *   serie  → "Série do documento. Retorna string vazia quando não informada."
 *
 * Resultado, medido na tela do Gestão: todo pedido vindo do delivery com
 * Número 0 e Série vazia, ao lado de um do PDV com Número 13 e Série 1. Nenhum
 * erro, nenhum log, HTTP 200 em todos.
 *
 * A API PÚBLICA NÃO GERA A SEQUÊNCIA — li os 258 endpoints, não existe "próximo
 * número"; os únicos caminhos com "série" são de rastreio de MERCADORIA. Quem
 * numera é o cliente.
 *
 * DECISÃO DO LOJISTA: sequência única com o PDV — mesma série, contagem
 * contínua. Por isso o número é perguntado ao ERP a cada pedido, e não guardado
 * aqui: um contador nosso ficaria para trás a cada venda do balcão.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EMITIR = semComentarios(ler('src', 'backend', 'maxxgestao-emitir.ts'));
const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));
const ROTAS = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));

describe('a série', () => {
  it('vazia vale 1, que é a série do PDV', () => {
    expect(serieValida('')).toBe('1');
    expect(serieValida(null)).toBe('1');
    expect(serieValida(undefined)).toBe('1');
    /* Espaço em branco é vazio: cair nele devolveria série em branco, que é
       exatamente o defeito que se veio consertar. */
    expect(serieValida('   ')).toBe('1');
  });

  it('o que o lojista gravou vence', () => {
    expect(serieValida('2')).toBe('2');
    expect(serieValida(' A1 ')).toBe('A1');
  });

  it('nasce como coluna aditiva, com 1 de padrão', () => {
    expect(SCHEMA).toContain(`['lojas', 'maxxgestao_serie', "maxxgestao_serie VARCHAR(3) NOT NULL DEFAULT '1'"]`);
  });

  /* Recusa em vez de cair no padrão: gravar '1' calado quando pediram outra
     coisa faria o lojista concluir que o campo não funciona. */
  it('a rota recusa série inválida em vez de assumir 1', () => {
    const i = ROTAS.indexOf("router.put('/erp/serie'");
    expect(i).toBeGreaterThan(0);
    const corpo = ROTAS.slice(i, i + 900);
    expect(corpo).toContain('/^[0-9A-Za-z]{1,3}$/.test(bruto)');
    expect(corpo).toContain('res.status(400)');
    expect(corpo).toContain('UPDATE lojas SET maxxgestao_serie = ?');
  });
});

describe('quantas páginas a listagem tem', () => {
  it('divide arredondando para cima', () => {
    expect(ultimaPagina(100, 50)).toBe(2);
    expect(ultimaPagina(101, 50)).toBe(3);
    expect(ultimaPagina(1, 50)).toBe(1);
  });

  /* `total` ausente vale UMA página: a primeira leitura já trouxe o que há, e
     pedir a página zero seria chamada jogada fora. */
  it('sem total, uma página', () => {
    expect(ultimaPagina(undefined, 50)).toBe(1);
    expect(ultimaPagina(0, 50)).toBe(1);
    expect(ultimaPagina('lixo', 50)).toBe(1);
  });
});

describe('o maior número de uma página', () => {
  it('acha o maior, esteja onde estiver', () => {
    expect(maiorNumero({ items: [{ numero: 3 }, { numero: 12 }, { numero: 7 }] })).toBe(12);
  });

  /* O ERP devolve número como texto em alguns lugares, e `null` nos documentos
     quebrados — os que nasceram com zero por causa deste mesmo defeito. */
  it('aguenta texto, nulo e zero', () => {
    expect(maiorNumero({ items: [{ numero: '9' }, { numero: null }, { numero: 0 }] })).toBe(9);
    expect(maiorNumero({ items: [] })).toBe(0);
    expect(maiorNumero(null)).toBe(0);
  });
});

/** Um `ler` de mentira: devolve as páginas que o teste combinar. */
function erpFalso(paginas: Record<string, unknown>) {
  const pedidos: string[] = [];
  const ler = async (caminho: string) => {
    pedidos.push(caminho);
    const chave = Object.keys(paginas).find(k => caminho.includes(k));
    return (chave ? paginas[chave] : { items: [], total: 0 }) as never;
  };
  return { ler, pedidos };
}

describe('o próximo número, sem depender da ordem da lista', () => {
  /*
   * ISTO É O CORAÇÃO DO MÓDULO. `GET /api/documento/v1` aceita Serie, Modelo,
   * page e limit — e NENHUM parâmetro de ordenação. A documentação não diz em
   * que ordem a lista sai, e não consegui medir na conta de produção.
   *
   * Então leio as DUAS PONTAS: com `total` dá para pedir a última página, e o
   * maior número entre as duas é o último da série, venha a lista crescente ou
   * decrescente.
   */
  it('acerta com a lista do mais novo para o mais velho', async () => {
    const { ler } = erpFalso({
      'page=1': { total: 120, items: [{ numero: 120 }, { numero: 119 }] },
      'page=3': { total: 120, items: [{ numero: 2 }, { numero: 1 }] },
    });
    expect(await proximoNumero(ler, '1', 'PA')).toBe(121);
  });

  it('acerta com a lista do mais velho para o mais novo', async () => {
    const { ler } = erpFalso({
      'page=1': { total: 120, items: [{ numero: 1 }, { numero: 2 }] },
      'page=3': { total: 120, items: [{ numero: 119 }, { numero: 120 }] },
    });
    expect(await proximoNumero(ler, '1', 'PA')).toBe(121);
  });

  /* Série que cabe numa página só já veio inteira — a segunda chamada traria
     os mesmos documentos e gastaria uma das 20 requisições por minuto. */
  it('série curta gasta uma chamada só', async () => {
    const { ler, pedidos } = erpFalso({
      'page=1': { total: 13, items: [{ numero: 13 }, { numero: 12 }] },
    });
    expect(await proximoNumero(ler, '1', 'PA')).toBe(14);
    expect(pedidos.length).toBe(1);
  });

  /*
   * SÉRIE VAZIA COMEÇA NO 1, E NÃO NO 0. Zero é o número que os pedidos
   * quebrados receberam; reusá-lo misturaria "loja nova" com "documento que
   * nasceu sem número".
   */
  it('série sem nenhum documento começa no 1', async () => {
    const { ler } = erpFalso({ 'page=1': { total: 0, items: [] } });
    expect(await proximoNumero(ler, '1', 'PA')).toBe(1);
  });

  /*
   * ZERO É "NÃO SEI", e é diferente de 1. Leitura que não respondeu devolve 0
   * para quem chama decidir — mandar 1 aqui criaria um documento com o número
   * de outro.
   */
  it('leitura sem resposta devolve zero', async () => {
    const ler = async () => null;
    expect(await proximoNumero(ler, '1', 'PA')).toBe(0);
  });

  it('filtra pela série e pelo modelo', async () => {
    const { ler, pedidos } = erpFalso({ 'page=1': { total: 1, items: [{ numero: 5 }] } });
    await proximoNumero(ler, 'A1', 'PV');
    expect(pedidos[0]).toContain('Serie=A1');
    expect(pedidos[0]).toContain('Modelo=PV');
  });
});

const PEDIDO: DadosDoPedido = {
  id: 77,
  tipoEntrega: 'entrega',
  totalCentavos: 1000,
  formaPagamento: 'dinheiro',
  itens: [{ nome: 'ÁGUA MINERAL 510ML', quantidade: 1, precoUnitarioCentavos: 1000, variacaoErp: 985 }],
};
const CONFIG: ConfigDocumento = {
  idNaturezaOperacao: 1, idPessoa: 1, idUsuario: 5470, idPagamento: 1,
  modelo: 'PA', idCaixa: 0, dataHora: '2026-09-17T16:29:06',
  serie: '1', numero: 14,
};

describe('o documento montado', () => {
  it('leva série e número', () => {
    const { corpo } = montarDocumento(PEDIDO, CONFIG);
    const doc = (corpo as { documento: Record<string, unknown> }).documento;
    expect(doc.serie).toBe('1');
    expect(doc.numero).toBe(14);
  });

  /*
   * SEM NÚMERO, NEM A SÉRIE VAI. Mandar a série sozinha deixaria uma série
   * inteira com número zero — pior que o estado anterior, onde pelo menos o
   * zero estava sem série nenhuma e era identificável.
   */
  it('sem número, não manda nenhum dos dois', () => {
    const { corpo } = montarDocumento(PEDIDO, { ...CONFIG, numero: 0 });
    const doc = (corpo as { documento: Record<string, unknown> }).documento;
    expect(doc).not.toHaveProperty('numero');
    expect(doc).not.toHaveProperty('serie');
  });

  it('série vazia com número vira 1, e não string vazia', () => {
    const { corpo } = montarDocumento(PEDIDO, { ...CONFIG, serie: '' });
    const doc = (corpo as { documento: Record<string, unknown> }).documento;
    expect(doc.serie).toBe('1');
  });
});

describe('o envio pergunta ao ERP antes de subir', () => {
  it('lê o próximo número com a série e o modelo da loja', () => {
    expect(EMITIR).toContain('numeroDoDocumento = await proximoNumero(');
    expect(EMITIR).toContain('const serieDoDocumento = serieValida(loja?.maxxgestao_serie);');
    expect(EMITIR).toContain('modeloValido(loja?.maxxgestao_modelo),');
    expect(EMITIR).toContain('maxxgestao_id_caixa, maxxgestao_serie');
  });

  it('passa os dois para a montagem', () => {
    expect(EMITIR).toContain('serie: serieDoDocumento,');
    expect(EMITIR).toContain('numero: numeroDoDocumento,');
  });

  /*
   * FALHA NA LEITURA NÃO SEGURA O PEDIDO. Documento sem número se corrige no
   * ERP; venda que não chegou, não. Bloquear aqui trocaria um defeito de
   * cadastro por perda de pedido.
   */
  it('leitura que falhou deixa o pedido subir mesmo assim', () => {
    const i = EMITIR.indexOf('numeroDoDocumento = await proximoNumero(');
    const bloco = EMITIR.slice(i, i + 900);
    expect(bloco).toContain('} catch (e) {');
    expect(bloco).toContain('vai sem número');
    /* E não relança: o `catch` não pode terminar com throw nem com return. */
    expect(bloco.slice(bloco.indexOf('} catch (e) {'), bloco.indexOf('} catch (e) {') + 600))
      .not.toContain('throw');
  });
});
