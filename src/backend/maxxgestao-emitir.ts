/**
 * MANDAR O PEDIDO PARA O MAXX GESTÃO.
 *
 * Uma chamada: `POST /documento` como `PV` (pedido de venda), com os itens
 * vinculados às mercadorias do ERP. **A parte fiscal é resolvida lá** — decisão
 * do dono do projeto, e a certa: natureza de operação, forma de pagamento e
 * tributação são cadastro do ERP, e cada uma que tentássemos resolver daqui
 * seria palpite sobre dado que não é nosso.
 *
 * `transformar` e `emitir` existem na API e chegaram a ser chamados aqui.
 * Saíram junto com essa decisão: o pedido chega, e quem fecha a nota é quem tem
 * o certificado e a numeração.
 *
 * A PARTE PERIGOSA CONTINUA SENDO A CRIAÇÃO. `POST /documento` não é
 * idempotente do lado deles: chamar duas vezes cria dois documentos. Por isso o
 * id é GRAVADO NO PEDIDO assim que ele existe, e a criação só acontece com o
 * campo vazio.
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

export interface ResultadoEmissao {
  /** O documento foi criado no ERP? A NOTA é emitida lá, por gente. */
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
export async function enviarPedidoAoErp(
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
  } catch (e) {
    const erro = e as ErroMaxxGestao;
    return { emitiu: false, motivo: `não consegui ler a configuração do ERP: ${erro.message}` };
  }

  /*
   * A FORMA DE PAGAMENTO É TENTATIVA, NÃO REQUISITO.
   *
   * Se estiver ligada à natureza no ERP, o documento chega completo. Se não —
   * e hoje `/natureza-operacao/1/pagamentos` volta vazio — o pedido vai sem, e
   * a forma é escolhida lá. Falhar aqui bloquearia o envio por causa de um
   * cadastro que não é nosso.
   */
  try {
    idPagamento = acharPagamento(await formasDaNatureza(token, idNatureza, opcoes), dados.formaPagamento);
  } catch (e) {
    console.log(`[erp] pedido ${pedidoId}: não consegui ler as formas de pagamento (${(e as Error).message}) — vai sem`);
  }
  if (idPagamento <= 0) {
    console.log(`[erp] pedido ${pedidoId}: a forma "${dados.formaPagamento}" não está ligada à natureza ${idNatureza} — documento vai sem forma de pagamento`);
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

  /* MARCA O DOCUMENTO. Ele existe: sem gravar, uma segunda passada criaria
     outro para a mesma venda. */
  await db.prepare('UPDATE pedidos SET maxxgestao_documento_id = ?, maxxgestao_emitido_em = ? WHERE id = ?')
    .run(documento, agoraUTC(), pedidoId);

  console.log(`[erp] pedido ${pedidoId}: enviado ao Maxx Gestão como documento ${documento} em ${Date.now() - comecou}ms`);
  return { emitiu: true, documento };

}
