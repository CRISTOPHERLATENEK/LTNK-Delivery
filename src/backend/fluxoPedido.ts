/**
 * Máquina de estados do pedido — fonte única da verdade do fluxo oficial.
 *   pendente -> aceito -> preparando -> pronto -> em_entrega -> entregue
 * Terminais alternativos: cancelado (pelo cliente, só em pendente) e recusado (pelo lojista).
 */
import { acaoParaStatus, escolherMotivoCancelamento, motivoDaRecusaDeCancelamento, type StatusNosso } from './ifood-status';
import { avisarStatusIfood, motivosDeCancelamento, solicitarCancelamento, ErroIfood, credenciaisDoAmbiente as credenciaisIfoodDoAmbiente } from './ifood-cliente';
import db from './db-mysql';
import { agoraUTC, erroHttp } from './util';
import { registrarEvento, notificarEntregadoresCorridaDisponivel } from './notificacoes';
import { Pedido, StatusPedido } from '../tipos/modelos';

/**
 * Endereço público da loja, pra montar o link de acompanhamento.
 *
 * Prefere o domínio próprio do lojista: é o que o cliente reconhece, e é o
 * único que funciona se a loja não usa o endereço padrão da plataforma. Cai no
 * URL_PUBLICA do ambiente quando não há domínio configurado, e devolve `null`
 * se não houver nenhum dos dois — sem link é melhor que link quebrado.
 */
async function urlPublicaDaLoja(lojaId: number): Promise<string | null> {
  try {
    const l = await db.prepare('SELECT dominio_personalizado FROM lojas WHERE id = ?')
      .get(lojaId) as { dominio_personalizado: string | null } | undefined;
    if (l?.dominio_personalizado) return `https://${l.dominio_personalizado}`;
  } catch { /* segue pro ambiente */ }
  return process.env.URL_PUBLICA || null;
}

export const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  pendente:   ['aceito', 'recusado', 'cancelado'],
  aceito:     ['preparando'],
  preparando: ['pronto'],
  pronto:     ['em_entrega'],
  em_entrega: ['entregue'],
  entregue:   [],
  cancelado:  [],
  recusado:   [],
};

export const ROTULOS: Record<StatusPedido, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando',
  pronto: 'Pronto', em_entrega: 'Em entrega', entregue: 'Entregue',
  cancelado: 'Cancelado', recusado: 'Recusado',
};

const EVENTOS_NOTIFICAVEIS: Partial<Record<StatusPedido, string>> = {
  aceito: 'pedido_aceito',
  preparando: 'pedido_preparando',
  pronto: 'pedido_pronto',
  recusado: 'pedido_recusado',
  em_entrega: 'saiu_para_entrega',
  entregue: 'entregue',
};

interface OpcoesTransicao {
  /** Colunas extras para atualizar no mesmo UPDATE (ex.: motivo_recusa). */
  camposExtras?: Record<string, string | number | null>;
  /**
   * A mudança VEIO do iFood — não vai voltar para lá, e pode cancelar de
   * qualquer estado. Ver `ehCancelamentoVindoDeFora` e o bloco de aviso.
   */
  vindoDoIfood?: boolean;
}

/**
 * O iFood mandou cancelar um pedido que aqui já passou do "pendente"?
 *
 * A tabela de transições só deixa cancelar de 'pendente', e essa regra é do
 * NOSSO fluxo: depois de aceito, quem desiste é o lojista pela recusa. Só que o
 * pedido do iFood tem outro dono — o cliente cancela no app dele, a qualquer
 * momento, e isso não é um pedido de permissão: é um fato.
 *
 * Sem esta exceção o evento chegava, a transição era recusada com 409, virava
 * uma linha de log e o pedido ficava em 'preparando' PARA SEMPRE: a cozinha
 * seguia montando, o entregador saía com um pedido que não existe mais, e a
 * comida ia para o lixo com a loja pagando por ela.
 *
 * Só vale para 'cancelado' e só vindo de fora. O lojista continua sem poder
 * cancelar um pedido já aceito pelo painel — essa é uma decisão de produto, e
 * não é esta a hora de mudá-la.
 */
export function ehCancelamentoVindoDeFora(
  novoStatus: StatusPedido,
  opcoes: { vindoDoIfood?: boolean },
): boolean {
  return novoStatus === 'cancelado' && opcoes.vindoDoIfood === true;
}

/**
 * Transição atômica de status:
 *  - valida que a transição é permitida pelo fluxo oficial
 *  - UPDATE condicional (WHERE status = ?) evita corrida entre abas
 *  - registra na linha do tempo e enfileira notificação quando aplicável
 */
export async function transicionarStatus(
  pedidoId: number,
  novoStatus: StatusPedido,
  opcoes: OpcoesTransicao = {},
): Promise<Pedido & Record<string, unknown>> {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as Pedido | undefined;
  if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

  /*
   * JÁ ESTÁ NO STATUS PEDIDO = sucesso, não conflito.
   *
   * Duplo clique em "Marcar como pronto", ou o painel aberto em duas abas: o
   * primeiro clique muda o status e o segundo levava 409 na cara do lojista —
   * um erro para uma ação que ALCANÇOU o que ele queria. Ele via "Transição
   * inválida" e ficava sem saber se funcionou.
   *
   * Não afrouxa a máquina de estados: só reconhece que ir de "pronto" para
   * "pronto" é chegar onde já se está. Transição de verdade inválida
   * (pendente → entregue) continua sendo recusada abaixo.
   */
  if (pedido.status === novoStatus) {
    return pedido as Pedido & Record<string, unknown>;
  }

  const permitidos = TRANSICOES[pedido.status];
  if (!permitidos.includes(novoStatus) && !ehCancelamentoVindoDeFora(novoStatus, opcoes)) {
    throw erroHttp(409,
      `Transição inválida: o pedido está "${ROTULOS[pedido.status]}" e não pode ir para "${ROTULOS[novoStatus]}".`);
  }

  const agora = agoraUTC();
  const extras = opcoes.camposExtras || {};
  const camposExtras = Object.keys(extras);
  const setExtras = camposExtras.map(c => `${c} = ?`).join(', ');

  const sql = `UPDATE pedidos SET status = ?, atualizado_em = ?${setExtras ? ', ' + setExtras : ''}
               WHERE id = ? AND status = ?`;
  const resultado = await db.prepare(sql).run(
    novoStatus, agora, ...camposExtras.map(c => extras[c]), pedidoId, pedido.status,
  );
  if (resultado.changes === 0) {
    throw erroHttp(409, 'O pedido foi atualizado por outra pessoa. Recarregue e tente de novo.');
  }

  await db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
    .run(pedidoId, novoStatus, agora);

  // Pedido não vai mais acontecer: devolve ao estoque o que havia sido reservado
  // (só produtos que controlam estoque).
  if (novoStatus === 'cancelado' || novoStatus === 'recusado') {
    const itens = await db.prepare(
      'SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?'
    ).all(pedidoId) as Array<{ produto_id: number; quantidade: number }>;
    for (const it of itens) {
      await db.prepare(
        'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
      ).run(it.quantidade, it.produto_id);
    }
  }

  /*
   * AVISO NO WHATSAPP a cada troca de status.
   *
   * Aqui porque `transicionarStatus` é o ponto único por onde TODO status passa
   * — o mesmo motivo já registrado logo abaixo pro pool de entregadores. Em
   * qualquer outro lugar, algum caminho ficaria de fora.
   *
   * Até aqui o WhatsApp mandava a confirmação e sumia: o cliente ficava sem
   * notícia justamente entre 'confirmado' e a comida na porta, que é quando ele
   * fica ansioso. O push cobre quem tem o app; o WhatsApp alcança quem fechou.
   *
   * Best-effort: falha de mensagem não pode derrubar a transição do pedido.
   */
  {
    // Sem domínio configurado a mensagem vai MESMO ASSIM, só sem o link:
    // 'saiu para entrega' é útil por si só, e calar por falta de link seria
    // trocar um aviso incompleto por nenhum.
    const base = await urlPublicaDaLoja(pedido.loja_id);
    const { avisarStatusWhatsApp } = await import('./whatsapp');
    avisarStatusWhatsApp(pedidoId, novoStatus, base ?? '')
      .catch(e => console.warn('[WhatsApp] aviso de status falhou:', e));
  }

  const eventoFila = EVENTOS_NOTIFICAVEIS[novoStatus];
  if (eventoFila) await registrarEvento(pedidoId, eventoFila);

  /**
   * Pedido PRONTO e sem entregador = corrida entrou no pool aberto: avisa os
   * entregadores. Feito aqui porque `transicionarStatus` é o ponto único por onde
   * todo status passa — em qualquer outro lugar, algum caminho ficaria de fora.
   *
   * Não avisa quando o lojista já atribuiu alguém (`entregador_id` preenchido):
   * nesse caso o push direto ao escolhido já é enviado em rotas/lojista.ts, e
   * chamar os outros só geraria corrida para algo que não está disponível.
   */
  if (novoStatus === 'pronto' && !pedido.entregador_id) {
    notificarEntregadoresCorridaDisponivel(pedidoId).catch(e =>
      console.error('[entregador] falha ao avisar corrida disponível:', e));
  }

  /*
   * AVISA O IFOOD, quando o pedido veio de lá.
   *
   * Aqui e não nas rotas porque `transicionarStatus` é o ponto único por onde
   * TODO status passa — mesmo motivo pelo qual a notificação e a linha do tempo
   * moram aqui. Espalhar pelas rotas seria garantir que a próxima rota nova
   * esquecesse de avisar, e o sintoma disso é o pior possível: o iFood cancela
   * o pedido sozinho por falta de confirmação (**8 minutos**) depois de a
   * comida já ter sido feita.
   *
   * NÃO BLOQUEIA a transição. Se o iFood estiver fora do ar, o lojista precisa
   * conseguir aceitar e produzir mesmo assim — recusar a mudança de status aqui
   * transformaria uma indisponibilidade deles em paralisia da cozinha.
   */
  if (pedido.origem === 'ifood') {
    avisarIfoodDoStatus(pedido as Pedido & Record<string, unknown>, novoStatus, opcoes.vindoDoIfood === true)
      .catch(e => console.error(`[ifood] falha ao avisar status do pedido ${pedidoId}:`, e));
  }

  return { ...pedido, status: novoStatus, atualizado_em: agora, ...extras };
}

/**
 * Manda a ação correspondente para o iFood.
 *
 * Separada para ficar testável e para o `catch` de quem chama não engolir um
 * erro de programação junto com uma falha de rede.
 */
async function avisarIfoodDoStatus(
  pedido: Pedido & Record<string, unknown>,
  novoStatus: StatusPedido,
  vindoDoIfood = false,
): Promise<void> {
  /*
   * NÃO DEVOLVER O ECO. Quando a mudança veio de um evento do iFood, avisar de
   * volta é contar a eles o que eles acabaram de nos contar. No melhor caso é
   * uma chamada inútil por evento; no cancelamento é pior — seria pedir o
   * cancelamento de um pedido que o próprio iFood já cancelou, e a resposta
   * disso enche o log de falha para uma coisa que deu certo.
   */
  if (vindoDoIfood) return;

  const orderId = String(pedido.pagamento_gateway_id ?? '').trim();
  if (!orderId) return;

  const tipo = String(pedido.tipo_entrega ?? 'entrega') === 'retirada' ? 'retirada' : 'entrega';
  const acao = acaoParaStatus(novoStatus as StatusNosso, tipo);
  /* Status que não tem correspondente lá (pendente, entregue) não vira chamada:
     seria pedir 404 e encher o log sem informar nada. */
  if (!acao) return;

  /*
   * CANCELAMENTO NÃO PASSA POR AQUI, de propósito.
   *
   * `requestCancellation` exige um código de motivo obtido antes em
   * `GET /cancellationReasons`, e um código inventado é recusado. Cancelar pela
   * metade é o pior caminho: o lojista veria "cancelado" no painel e o cliente
   * continuaria esperando a comida. Fica registrado para ser feito inteiro.
   */

  const cred = credenciaisIfoodDoAmbiente();
  if (!cred) return;

  /*
   * O SUCESSO TAMBÉM VAI PARA O LOG — e isso não é ruído.
   *
   * A primeira versão só registrava falha. Testando com um pedido real,
   * confirmei no painel e o log ficou mudo: não dava para saber se a
   * confirmação tinha saído, se tinha chegado, nem quanto tempo levou. E é
   * justamente esta chamada que tem PRAZO — oito minutos, contados da criação
   * do pedido no iFood.
   *
   * "Nenhum erro apareceu" não é prova de que aconteceu. Para a única ação do
   * sistema com relógio correndo contra, silêncio é a pior resposta possível.
   */
  const comecou = Date.now();
  if (acao === 'requestCancellation') {
    await pedirCancelamentoIfood(cred, pedido, orderId);
  } else {
    await avisarStatusIfood(cred, orderId, acao);
  }
  console.log(`[ifood] pedido ${pedido.id} → ${acao} avisado ao iFood em ${Date.now() - comecou}ms`);
}

/**
 * Pede o cancelamento no iFood.
 *
 * Duas regras da documentação moldam isto, e nenhuma é opcional:
 *
 * 1. O CÓDIGO DE MOTIVO VEM DA LISTA DAQUELE PEDIDO. A lista muda conforme o
 *    momento (antes ou depois da confirmação) e a política da loja; um código
 *    válido em geral pode não estar na lista deste pedido, e aí é recusado. Por
 *    isso consultamos antes, sempre.
 *
 * 2. O 202 NÃO É CANCELAMENTO. "A solicitação de cancelamento não garante que o
 *    pedido foi cancelado (...) o pedido só é cancelado quando o evento
 *    CANCELLED é gerado." Pode vir `CANCELLATION_REQUEST_FAILED` no lugar.
 *
 * A segunda regra cria a única divergência que este código não consegue evitar
 * sozinho: aqui o pedido já foi marcado cancelado (o UPDATE aconteceu antes),
 * e se o iFood recusar, o cliente continua esperando a comida. O que dá para
 * fazer é gritar — e é o que o log faz, com o texto que o lojista precisa ler.
 *
 * Bloquear a transição local até o CANCELLED chegar seria pior: o iFood pode
 * demorar, pode estar fora do ar, e o lojista ficaria sem conseguir cancelar
 * nada no próprio sistema por causa disso.
 */
async function pedirCancelamentoIfood(
  cred: { clientId: string; clientSecret: string },
  pedido: Pedido & Record<string, unknown>,
  orderId: string,
): Promise<void> {
  const disponiveis = await motivosDeCancelamento(cred, orderId);

  /*
   * Lista vazia = 204, "nenhuma política encontrada": este pedido NÃO pode ser
   * cancelado pela API agora. Não é erro nosso, e insistir não muda — o que
   * resolve é o lojista falar com o suporte do iFood.
   */
  if (disponiveis.length === 0) {
    console.error(
      `[ifood] pedido ${pedido.id} (${orderId}) foi cancelado AQUI, mas o iFood não ofereceu ` +
      `nenhum motivo de cancelamento — o pedido segue ATIVO lá. Cancele pelo Gestor de Pedidos.`,
    );
    return;
  }

  const motivo = escolherMotivoCancelamento(
    disponiveis,
    String(pedido.motivo_recusa ?? ''),
  );
  if (!motivo) return;

  try {
    await solicitarCancelamento(cred, orderId, motivo);
  } catch (e) {
    const erro = e as ErroIfood & { corpoCodigo?: string };
    const explicacao = motivoDaRecusaDeCancelamento(String(erro.corpoCodigo ?? ''), erro.message);
    console.error(
      `[ifood] pedido ${pedido.id} (${orderId}) foi cancelado AQUI e o iFood RECUSOU: ${explicacao} ` +
      `O pedido segue ATIVO no iFood — cancele pelo Gestor de Pedidos.`,
    );
    return;
  }

  /*
   * Chegou aqui = 202. Repetindo, porque é o erro fácil: 202 é "recebi o
   * pedido de cancelamento", não "cancelei". A confirmação vem como evento
   * CANCELLED no polling; se vier CANCELLATION_REQUEST_FAILED, o ciclo avisa.
   */
  console.log(
    `[ifood] pedido ${pedido.id}: cancelamento SOLICITADO (motivo ${motivo}) — ` +
    `aguardando o evento CANCELLED para confirmar`,
  );
}
