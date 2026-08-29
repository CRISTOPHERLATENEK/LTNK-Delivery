/**
 * O PEDIDO DO IFOOD VIRA UM PEDIDO NOSSO.
 *
 * Aqui as decisões deixam de ser reversíveis: a partir deste ponto sai comida da
 * cozinha. Três delas merecem estar escritas, porque nenhuma é óbvia e todas
 * têm um jeito errado que parece certo.
 *
 * As dependências de banco entram por parâmetro para que o comportamento possa
 * ser provado sem MySQL — e o que precisa ser provado é justamente o que só
 * acontece quando algo dá errado no meio.
 */
import { traduzirPedido, conferirTotal, type PedidoTraduzido } from './ifood-pedido';

export interface DepsGravar {
  /** Pedido já existente com este id do iFood, se houver. */
  pedidoExistente: (ifoodId: string) => Promise<number | null>;
  /** Id do usuário sintético que representa os clientes do iFood nesta loja. */
  consumidorIfood: (lojaId: number) => Promise<number>;
  /** Nosso produto com este código externo, se existir no cardápio. */
  produtoPorCodigo: (lojaId: number, codigo: string) => Promise<number | null>;
  /** Grava tudo numa transação e devolve o id criado. */
  inserir: (dados: DadosPedido) => Promise<number>;
  registrar?: (nivel: 'info' | 'erro', mensagem: string) => void;
}

export interface DadosPedido {
  clienteId: number;
  lojaId: number;
  status: string;
  enderecoEntrega: string;
  tipoEntrega: 'entrega' | 'retirada';
  formaPagamento: string;
  pagamentoStatus: string;
  trocoParaCentavos: number | null;
  observacoes: string;
  subtotalCentavos: number;
  taxaEntregaCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
  origem: string;
  gatewayId: string;
  itens: Array<{
    produtoId: number | null;
    nome: string;
    precoUnitCentavos: number;
    quantidade: number;
    opcoesTexto: string;
    observacao: string;
  }>;
}

export interface ResultadoGravacao {
  pedidoId: number | null;
  criado: boolean;
  motivo?: string;
}

export async function gravarPedidoIfood(
  lojaId: number,
  bruto: Record<string, unknown>,
  deps: DepsGravar,
): Promise<ResultadoGravacao> {
  const log = deps.registrar ?? (() => {});
  const p: PedidoTraduzido = traduzirPedido(bruto);

  if (!p.ifoodId) return { pedidoId: null, criado: false, motivo: 'pedido sem id' };

  /*
   * IDEMPOTÊNCIA POR ID DO IFOOD, além da deduplicação de eventos.
   *
   * Parece redundante — a tabela de eventos vistos já impede reprocessar o
   * mesmo evento. Não é: dois eventos DIFERENTES podem se referir ao mesmo
   * pedido (PLACED reentregue com id novo, ou um CONFIRMED que chega antes do
   * PLACED). Sem esta trava, o mesmo pedido vira dois no painel e a cozinha
   * produz duas vezes.
   */
  const jaExiste = await deps.pedidoExistente(p.ifoodId);
  if (jaExiste !== null) {
    return { pedidoId: jaExiste, criado: false, motivo: 'pedido já existe' };
  }

  /*
   * AS CONTAS PRECISAM FECHAR ANTES DE SAIR COMIDA.
   *
   * Se o total do iFood não bate com a soma que calculamos, alguma coisa na
   * tradução está errada. Gravar assim mesmo produz o pior desfecho: a comida
   * sai, a nota sai, e a diferença só aparece na conciliação semanas depois,
   * quando ninguém mais liga uma coisa à outra.
   *
   * Não é bloqueio absoluto — é 1 centavo de tolerância, porque arredondamento
   * de item existe e recusar um pedido bom por um centavo seria pior.
   */
  const diferenca = conferirTotal(p);
  if (Math.abs(diferenca) > 1) {
    log('erro',
      `[ifood] pedido ${p.displayId} (${p.ifoodId}) NÃO gravado: as contas não fecham ` +
      `(diferença de ${diferenca} centavos entre o total do iFood e a soma dos itens)`);
    return { pedidoId: null, criado: false, motivo: `divergência de ${diferenca} centavos` };
  }

  const clienteId = await deps.consumidorIfood(lojaId);

  /*
   * PRODUTO QUE NÃO EXISTE NO NOSSO CARDÁPIO NÃO IMPEDE O PEDIDO.
   *
   * `itens_pedido.produto_id` é anulável de propósito. O cardápio do iFood é
   * mantido lá e pode divergir do nosso — um item que não casa é comum, não é
   * exceção. Recusar o pedido inteiro por causa disso seria transformar um
   * problema de cadastro num pedido perdido, com o cliente já tendo pago.
   *
   * O nome vem do iFood de qualquer jeito, então a cozinha e o cupom continuam
   * corretos. O que se perde é a baixa de estoque desse item, e essa perda é
   * registrada.
   */
  const itens: DadosPedido['itens'] = [];
  const semCasar: string[] = [];
  for (const i of p.itens) {
    const produtoId = i.codigoExterno ? await deps.produtoPorCodigo(lojaId, i.codigoExterno) : null;
    if (produtoId === null) semCasar.push(`${i.nome}${i.codigoExterno ? ` (${i.codigoExterno})` : ''}`);
    itens.push({
      produtoId,
      nome: i.nome,
      precoUnitCentavos: i.precoUnitCentavos,
      quantidade: i.quantidade,
      opcoesTexto: i.opcoesTexto,
      observacao: i.observacao,
    });
  }
  if (semCasar.length) {
    log('erro', `[ifood] pedido ${p.displayId}: ${semCasar.length} item(ns) sem produto correspondente — sem baixa de estoque: ${semCasar.join(', ')}`);
  }

  /*
   * OBSERVAÇÕES CARREGAM O QUE A TABELA NÃO COMPORTA.
   *
   * O número curto do iFood (`displayId`) é como o cliente e o atendente do
   * iFood se referem ao pedido — sem ele na tela, ninguém consegue casar uma
   * reclamação com o pedido daqui. O pagamento dividido também mora aqui,
   * porque `forma_pagamento` é uma coluna só.
   */
  const partes = [`iFood #${p.displayId}`];
  if (p.teste) partes.push('PEDIDO DE TESTE');
  if (p.pagamento.dividido) partes.push(`Pagamento: ${p.pagamento.detalhe}`);
  if (p.taxasExtrasCentavos > 0) {
    partes.push(`Taxa de serviço iFood: R$ ${(p.taxasExtrasCentavos / 100).toFixed(2).replace('.', ',')}`);
  }
  if (p.clienteNome) partes.push(`Cliente: ${p.clienteNome}`);
  if (p.clienteTelefone) partes.push(`Contato iFood: ${p.clienteTelefone}`);
  if (p.observacoes) partes.push(p.observacoes);

  const pedidoId = await deps.inserir({
    clienteId,
    lojaId,
    /*
     * NASCE 'pendente', não 'aceito'.
     *
     * O evento PLACED diz que o cliente fez o pedido, não que a loja aceitou —
     * e a confirmação tem SLA no iFood. Criar já aceito seria confirmar em nome
     * do lojista sem ele ter visto.
     */
    status: 'pendente',
    enderecoEntrega: p.endereco || 'Retirada no balcão',
    tipoEntrega: p.tipoEntrega,
    formaPagamento: p.pagamento.forma,
    /*
     * Já pago no iFood vira 'aprovado'; na entrega fica 'na_entrega'. Marcar
     * tudo como aprovado faria o entregador não cobrar quem devia pagar.
     */
    pagamentoStatus: p.pagamento.online ? 'aprovado' : 'na_entrega',
    trocoParaCentavos: p.pagamento.trocoParaCentavos,
    observacoes: partes.join(' | '),
    subtotalCentavos: p.subtotalCentavos,
    taxaEntregaCentavos: p.taxaEntregaCentavos,
    descontoCentavos: p.descontoCentavos,
    totalCentavos: p.totalCentavos,
    origem: 'ifood',
    gatewayId: p.ifoodId,
    itens,
  });

  log('info', `[ifood] pedido ${p.displayId} criado como #${pedidoId}${p.teste ? ' (TESTE)' : ''}`);
  return { pedidoId, criado: true };
}
