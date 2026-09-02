/**
 * EMITIR A NFC-E DO PEDIDO NO MAXX GESTÃO.
 *
 * Três chamadas, nesta ordem, e nenhuma delas é opcional:
 *
 *   POST /documento          → cria como PV (pedido de venda)
 *   POST /documento/{id}/transformar → vira modelo fiscal
 *   POST /documento/{id}/emitir      → sai a nota
 *
 * A PARTE PERIGOSA É A PRIMEIRA. `POST /documento` não é idempotente do lado
 * deles: chamar duas vezes cria dois documentos, cada um consumindo um número
 * da sequência fiscal. Por isso o id do documento é GRAVADO NO PEDIDO assim que
 * ele existe — e a criação só acontece quando o campo está vazio.
 *
 * O `idExterno` (o id do nosso pedido, dentro do documento) é a rede de
 * segurança da rede de segurança: se a resposta se perder no caminho e a marca
 * não for gravada, ele permite achar o documento órfão pelo número do pedido em
 * vez de criar outro às cegas.
 */
import db from './db-mysql';
import { agoraUTC } from './util';
import { descriptografar } from './cripto';
import { chamarMaxxGestao, ErroMaxxGestao, type OpcoesMaxxGestao } from './maxxgestao-cliente';
import { todasAsPaginas } from './maxxgestao-catalogo';
import {
  montarDocumento, diferencaDoTotal,
  type DadosDoPedido, type ItemPedido,
} from './maxxgestao-documento';

/** Uma forma de pagamento da natureza de operação, no ERP. */
export interface FormaPagamentoErp {
  id: number;
  nome: string;
}

/**
 * As formas de pagamento LIGADAS À NATUREZA DE OPERAÇÃO.
 *
 * Não é a lista geral do ERP: é o que aquela natureza aceita. Na conta da
 * Unimaxx esta lista voltava VAZIA em 02/09/2026 — configuração pendente no
 * portal deles, e é isso que impede a emissão até ser resolvido.
 */
export async function formasDaNatureza(
  token: string,
  idNatureza: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<FormaPagamentoErp[]> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p => {
    const d = await chamarMaxxGestao(
      token, `/api/natureza-operacao/${idNatureza}/pagamentos/v1?page=${p}&limit=100`, opcoes,
    ) as Record<string, unknown> | null;
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    return {
      page: Number(o.page ?? 1), limit: Number(o.limit ?? 0), total: Number(o.total ?? 0),
      totalPages: Number(o.totalPages ?? 1), hasNext: !!o.hasNext,
      items: Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [],
    };
  });
  return brutos
    .map(f => ({ id: Number(f.codigo ?? f.idPagamento ?? 0), nome: String(f.descricao ?? f.nome ?? '').trim() }))
    .filter(f => f.id > 0);
}

/**
 * Os nomes que cada forma nossa pode ter no ERP.
 *
 * Por NOME e não por número fixo porque a lista é de cada cliente: o "3" da
 * Unimaxx não é o "3" de outra loja, e número errado aqui é nota com forma de
 * pagamento errada — que a SEFAZ autoriza, porque o código é válido, e que só
 * aparece numa fiscalização.
 */
const APELIDOS: Record<string, string[]> = {
  pix: ['pix'],
  cartao_online: ['cartao', 'cartão', 'credito', 'crédito', 'cartao de credito', 'cartão de crédito'],
  cartao_entrega: ['cartao', 'cartão', 'credito', 'crédito', 'debito', 'débito'],
  dinheiro: ['dinheiro', 'especie', 'espécie'],
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Acha a forma do ERP que corresponde à do pedido. Zero quando não acha.
 *
 * ZERO E NÃO UM CHUTE. Devolver a primeira da lista "para não falhar" é o
 * caminho para a nota sair com a forma errada — e quem chama trata o zero como
 * impedimento, que é o comportamento certo.
 */
export function acharPagamento(formas: FormaPagamentoErp[], formaDoPedido: string): number {
  const apelidos = (APELIDOS[formaDoPedido] ?? []).map(semAcento);
  if (!apelidos.length) return 0;
  /* Igualdade exata primeiro; só depois "contém". Sem isso, "CARTAO DEBITO"
     poderia ganhar de "CARTAO" numa loja que tem os dois. */
  for (const busca of [
    (n: string) => apelidos.includes(n),
    (n: string) => apelidos.some(a => n.includes(a)),
  ]) {
    const achou = formas.find(f => busca(semAcento(f.nome)));
    if (achou) return achou.id;
  }
  return 0;
}

/** O id do documento criado, tirado da resposta deles. */
export function idDoDocumento(resposta: unknown): number {
  const d = (resposta && typeof resposta === 'object' ? resposta : {}) as Record<string, unknown>;
  /* Três nomes possíveis porque a resposta de criação não está documentada; o
     primeiro que vier com número positivo vale. */
  for (const chave of ['id', 'codigo', 'idDocumento']) {
    const n = Number(d[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const dentro = (d.documento && typeof d.documento === 'object' ? d.documento : {}) as Record<string, unknown>;
  for (const chave of ['id', 'codigo', 'idDocumento']) {
    const n = Number(dentro[chave] ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * A CHAVE DA NFC-E, TIRADA DO XML.
 *
 * Quarenta e quatro dígitos. Sem guardá-la, o pedido fica com um "documento
 * 312" que só existe dentro do ERP: quem precisa achar a nota — o contador, o
 * cliente que pediu, a conferência do mês — não tem por onde começar.
 *
 * Dois formatos porque a NFC-e traz a chave nos dois lugares: no atributo
 * `Id="NFe4126..."` da infNFe e, quando é o protocolo, dentro de `<chNFe>`.
 */
export function chaveDoXml(xml: string): string {
  const porTag = /<chNFe>\s*(\d{44})\s*<\/chNFe>/.exec(xml);
  if (porTag) return porTag[1];
  const porId = /Id="NFe(\d{44})"/.exec(xml);
  return porId ? porId[1] : '';
}

export interface ResultadoEmissao {
  emitiu: boolean;
  documento?: number;
  motivo?: string;
  chave?: string;
}

/**
 * O caminho completo, para um pedido.
 *
 * NUNCA LANÇA. Emissão de nota que derruba a rota do entregador seria trocar um
 * problema fiscal por um problema operacional — o pedido tem que seguir mesmo
 * quando a nota não sai. O motivo vai no retorno e no log.
 */
export async function emitirPedidoNoErp(
  pedidoId: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<ResultadoEmissao> {
  const pedido = await db.prepare(
    `SELECT id, loja_id, total_centavos, forma_pagamento, tipo_entrega,
            maxxgestao_documento_id
       FROM pedidos WHERE id = ?`
  ).get(pedidoId) as {
    id: number; loja_id: number; total_centavos: number; forma_pagamento: string;
    tipo_entrega: string; maxxgestao_documento_id: number;
  } | undefined;
  if (!pedido) return { emitiu: false, motivo: 'pedido não encontrado' };

  /* JÁ TEM DOCUMENTO: não cria outro. Dois documentos para a mesma venda
     consomem dois números da sequência fiscal, e desfazer isso custa
     cancelamento. */
  if (Number(pedido.maxxgestao_documento_id) > 0) {
    return { emitiu: false, documento: Number(pedido.maxxgestao_documento_id), motivo: 'já tem documento' };
  }

  const loja = await db.prepare(
    'SELECT nfce_emissor, maxxgestao_token FROM lojas WHERE id = ?'
  ).get(pedido.loja_id) as { nfce_emissor: string | null; maxxgestao_token: string | null } | undefined;

  if (String(loja?.nfce_emissor ?? 'sistema') !== 'erp') {
    return { emitiu: false, motivo: 'esta loja não emite pelo Maxx Gestão' };
  }
  let token = '';
  try { token = loja?.maxxgestao_token ? descriptografar(loja.maxxgestao_token) : ''; } catch { token = ''; }
  if (!token) return { emitiu: false, motivo: 'token do Maxx Gestão não configurado' };

  const itens = await db.prepare(
    `SELECT i.nome_produto, i.quantidade, i.preco_unit_centavos,
            COALESCE(p.maxxgestao_variacao_id, 0) AS variacao
       FROM itens_pedido i
       LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ?`
  ).all(pedidoId) as Array<{
    nome_produto: string; quantidade: number; preco_unit_centavos: number; variacao: number;
  }>;

  const dados: DadosDoPedido = {
    id: pedido.id,
    totalCentavos: Number(pedido.total_centavos) || 0,
    formaPagamento: String(pedido.forma_pagamento ?? ''),
    tipoEntrega: String(pedido.tipo_entrega ?? 'entrega') === 'retirada' ? 'retirada' : 'entrega',
    itens: itens.map((i): ItemPedido => ({
      nome: i.nome_produto ?? '',
      quantidade: Number(i.quantidade) || 1,
      precoUnitarioCentavos: Number(i.preco_unit_centavos) || 0,
      variacaoErp: Number(i.variacao) || 0,
    })),
  };

  /*
   * A NATUREZA E O CONSUMIDOR PADRÃO vêm do ERP, não de constante nossa: são de
   * cada empresa. `idPessoaPadrao` é o consumidor final que dispensa cadastrar
   * cliente por venda.
   */
  let idNatureza = 0;
  let idPessoa = 0;
  let idPagamento = 0;
  try {
    const cfg = await chamarMaxxGestao(token, '/api/empresa/configuracoes/v1', opcoes) as Record<string, unknown> | null;
    idPessoa = Number(cfg?.idPessoaPadrao ?? 0);
    /* Natureza 1 = "VENDA DE MERCADORIA DENTRO DO ESTADO" (CFOP 5102) na conta
       conferida. Fica aqui como padrão até virar configuração por loja. */
    idNatureza = 1;
    idPagamento = acharPagamento(await formasDaNatureza(token, idNatureza, opcoes), dados.formaPagamento);
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    return { emitiu: false, motivo: `não consegui ler a configuração do ERP: ${erro.message}` };
  }

  const { corpo, impedimentos } = montarDocumento(dados, {
    idNaturezaOperacao: idNatureza,
    idPessoa,
    idPagamento,
    dataHora: agoraUTC(),
  });

  if (!corpo) {
    const motivo = impedimentos.join('; ');
    console.log(`[erp] pedido ${pedidoId} NÃO emitido: ${motivo}`);
    return { emitiu: false, motivo };
  }

  /* A diferença do total é a taxa de entrega, quase sempre. Registrar é o que
     permite descobrir o dia em que for outra coisa. */
  const diferenca = diferencaDoTotal(dados);
  if (diferenca !== 0) {
    console.log(`[erp] pedido ${pedidoId}: total do pedido difere da soma dos itens em ${diferenca} centavos (taxa de entrega?)`);
  }

  const comecou = Date.now();
  let documento = 0;
  try {
    documento = idDoDocumento(await chamarMaxxGestao(
      token, '/api/documento/v1', opcoes, { method: 'POST', body: JSON.stringify(corpo) }));
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    /*
     * FALHA NA CRIAÇÃO É O CASO INDEFINIDO. Com `httpStatus` zero (rede), o
     * documento pode ter sido criado do lado deles sem a resposta chegar —
     * repetir criaria o segundo. O `idExterno` é o que permite achar o órfão
     * depois; aqui a gente para e reporta.
     */
    const motivo = erro.httpStatus === 0
      ? `não sei se o documento foi criado (${erro.message}) — confira pelo idExterno ${pedidoId} antes de repetir`
      : `criação recusada: ${erro.message}`;
    console.log(`[erp] pedido ${pedidoId}: ${motivo}`);
    return { emitiu: false, motivo };
  }

  if (documento <= 0) {
    console.log(`[erp] pedido ${pedidoId}: o ERP aceitou a criação mas não devolveu o id do documento`);
    return { emitiu: false, motivo: 'o ERP não devolveu o id do documento' };
  }

  /* MARCA ANTES DE SEGUIR. O documento existe: se transformar ou emitir
     falharem, a próxima tentativa tem que continuar deste documento, nunca
     criar outro. */
  await db.prepare('UPDATE pedidos SET maxxgestao_documento_id = ? WHERE id = ?').run(documento, pedidoId);

  try {
    await chamarMaxxGestao(token, `/api/documento/${documento}/transformar/v1`, opcoes, { method: 'POST' });
    await chamarMaxxGestao(token, `/api/documento/${documento}/emitir/v1`, opcoes, { method: 'POST' });
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    console.log(`[erp] pedido ${pedidoId}: documento ${documento} criado, mas a emissão falhou: ${erro.message}`);
    return { emitiu: false, documento, motivo: erro.message };
  }

  await db.prepare('UPDATE pedidos SET maxxgestao_emitido_em = ? WHERE id = ?').run(agoraUTC(), pedidoId);

  /*
   * A CHAVE VEM DEPOIS, e falhar aqui NÃO desfaz a emissão.
   *
   * A nota já existe e já está autorizada; não ter conseguido ler o XML é
   * inconveniente, não erro fiscal. Tratar isso como falha faria a próxima
   * tentativa querer emitir de novo uma nota que já saiu.
   */
  let chave = '';
  try {
    const xml = await chamarMaxxGestao(token, `/api/documento/${documento}/xml/v1`, opcoes);
    chave = chaveDoXml(typeof xml === 'string' ? xml : JSON.stringify(xml ?? ''));
    if (chave) {
      await db.prepare('UPDATE pedidos SET maxxgestao_chave = ? WHERE id = ?').run(chave, pedidoId);
    }
  } catch (e) {
    console.log(`[erp] pedido ${pedidoId}: nota emitida, mas não consegui ler a chave: ${(e as Error).message}`);
  }

  console.log(
    `[erp] pedido ${pedidoId}: NFC-e emitida no documento ${documento}`
    + (chave ? ` (chave ${chave})` : ' (chave não lida)')
    + ` em ${Date.now() - comecou}ms`,
  );
  return { emitiu: true, documento, chave };
}
