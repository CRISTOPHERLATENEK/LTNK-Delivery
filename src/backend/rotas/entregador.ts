/**
 * Módulo do ENTREGADOR: corridas, aceite ATÔMICO, entrega ativa, histórico.
 */
import { Router } from 'express';
import { lancarPedidoNaMaquininha } from '../fluxoPedido';
import db, { comTransacao } from '../db-mysql';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, erroHttp } from '../util';
import { registrarEvento } from '../notificacoes';
import { enviarPush } from '../push';
import { emitirNfcePedido } from './lojista';

const router = Router();
router.use(autenticar, exigirPerfil('entregador'));

/**
 * Loja à qual este entregador está preso, ou `null` se ele é compartilhado.
 *
 * O cadastro prevê os dois casos (ver GET /lojista/entregadores): `loja_id`
 * preenchido = exclusivo daquela loja, nulo = atende qualquer uma. A rota do
 * lojista já respeitava isso; as do entregador não.
 */
async function lojaDoEntregador(usuarioId: number): Promise<number | null> {
  const u = await db.prepare('SELECT loja_id FROM usuarios WHERE id = ?').get(usuarioId) as { loja_id: number | null } | undefined;
  return u?.loja_id ?? null;
}

router.get('/corridas', async (req, res, next) => {
  try {
    /*
     * FILTRA PELA LOJA DELE. Sem isto, um entregador cadastrado exclusivamente
     * pela loja A via — e podia aceitar — as corridas da loja B do mesmo
     * cliente. Além de pegar entrega que ninguém autorizou, a lista traz
     * endereço do consumidor, valor e troco: dado de cliente de uma loja
     * exposto a entregador de outra.
     */
    const lojaId = await lojaDoEntregador(req.usuario!.id);
    const corridas = await db.prepare(
      `SELECT p.id, p.endereco_entrega, p.entrega_lat, p.entrega_lon, p.taxa_entrega_centavos, p.total_centavos,
              p.forma_pagamento, p.troco_para_centavos, p.criado_em,
              l.nome AS loja_nome, l.endereco AS loja_endereco
         FROM pedidos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.status = 'pronto' AND p.entregador_id IS NULL
          AND (? IS NULL OR p.loja_id = ?)
        ORDER BY p.id`
    ).all(lojaId, lojaId);
    res.json({ corridas });
  } catch (e) { next(e); }
});

/**
 * Aceite de corrida.
 *
 * DUAS DISPUTAS DIFERENTES acontecem aqui, e cada uma precisa da sua garantia:
 *
 * 1. DOIS ENTREGADORES na mesma corrida — resolvido pelo próprio UPDATE
 *    condicional (`AND status = 'pronto' AND entregador_id IS NULL`): só um
 *    consegue mudar a linha, o outro recebe changes = 0. Isso sempre funcionou.
 *
 * 2. O MESMO ENTREGADOR em duas corridas — NÃO era resolvido. A checagem de
 *    "já tem entrega ativa?" era um SELECT antes do UPDATE, e entre os dois cabe
 *    outra requisição: dois toques rápidos na lista, ou o app repetindo o envio,
 *    e ele ficava com duas corridas ao mesmo tempo. Medido antes da correção:
 *    11 de 15 tentativas simultâneas passaram, os dois pedidos com 200.
 *    O estrago é silencioso — `/atual` mostra uma corrida só, então a outra fica
 *    presa em "em_entrega" com um entregador que não a vê, e o cliente espera.
 *
 * A trava é na linha do ENTREGADOR (`usuarios ... FOR UPDATE`), porque o recurso
 * disputado é ele: a regra é "um entregador, uma corrida". Mesmo recurso usado
 * na abertura de caixa e no limite de banners.
 *
 * O comentário antigo dizia que "SQLite serializa escritas" — o projeto migrou
 * pra MySQL, e serialização de escrita nunca protegeu contra checar-depois-agir.
 */
router.post('/corridas/:id/aceitar', async (req, res, next) => {
  try {
    const agora = agoraUTC();
    const lojaId = await lojaDoEntregador(req.usuario!.id);

    await comTransacao(async (tx) => {
      // Mutex: quem chegar depois espera aqui até a primeira transação fechar.
      await tx.prepare('SELECT id FROM usuarios WHERE id = ? FOR UPDATE').get(req.usuario!.id);

      const ativa = await tx.prepare(
        "SELECT id FROM pedidos WHERE entregador_id = ? AND status = 'em_entrega'"
      ).get(req.usuario!.id) as { id: number } | undefined;
      if (ativa) throw erroHttp(409, `Você já está com a entrega #${ativa.id} em andamento. Conclua-a primeiro.`);

      /*
       * O vínculo com a loja é conferido AQUI e não só na listagem: esconder a
       * corrida da lista não impede ninguém de chamar a rota com o id na mão.
       */
      const resultado = await tx.prepare(
        `UPDATE pedidos
            SET entregador_id = ?, status = 'em_entrega', atualizado_em = ?, entregador_etapa = 'aceita'
          WHERE id = ? AND status = 'pronto' AND entregador_id IS NULL
            AND (? IS NULL OR loja_id = ?)`
      ).run(req.usuario!.id, agora, req.params.id, lojaId, lojaId);

      if (resultado.changes === 0) {
        /*
         * DIZ O MOTIVO CERTO. O UPDATE falha por três razões diferentes e a
         * mensagem única culpava sempre "outro entregador" — o que faz o
         * entregador exclusivo de uma loja ficar tentando de novo, sem entender,
         * e depois ligar pro suporte.
         */
        const p = await tx.prepare(
          'SELECT status, entregador_id, loja_id FROM pedidos WHERE id = ?'
        ).get(req.params.id) as { status: string; entregador_id: number | null; loja_id: number } | undefined;
        if (!p) throw erroHttp(404, 'Corrida não encontrada.');
        if (lojaId !== null && p.loja_id !== lojaId) {
          throw erroHttp(403, 'Essa corrida é de uma loja que você não atende.');
        }
        if (p.entregador_id !== null) {
          throw erroHttp(409, 'Essa corrida não está mais disponível (outro entregador aceitou primeiro).');
        }
        throw erroHttp(409, `Essa corrida não está pronta pra sair (situação atual: ${p.status}).`);
      }

      await tx.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
        .run(req.params.id, 'em_entrega', agora);
      await tx.prepare('INSERT INTO etapas_entrega (pedido_id, etapa, criado_em) VALUES (?, ?, ?)')
        .run(req.params.id, 'aceita', agora);
    });

    /*
     * Aviso ao cliente FORA da transação, depois do commit: notificar "saiu pra
     * entrega" e a transação cair depois deixaria o consumidor esperando um
     * entregador que nunca aceitou.
     */
    await registrarEvento(Number(req.params.id), 'saiu_para_entrega');

    /*
     * LANÇA NA MAQUININHA daqui também, e não só de `transicionarStatus`.
     *
     * Esta rota grava `em_entrega` com UPDATE próprio — precisa da transação com
     * trava no entregador para garantir "um entregador, uma corrida" — então não
     * passa pelo funil de status. A versão anterior do comentário em
     * `fluxoPedido` afirmava que aquele era o ponto único por onde todo status
     * passa; não é, e por causa dessa afirmação o pedido 88 saiu para entrega
     * sem cobrança nenhuma chegar no aparelho.
     *
     * Não bloqueia a resposta: a corrida foi aceita, e maquininha fora do ar não
     * pode transformar isso em erro para o entregador.
     */
    lancarPedidoNaMaquininha(Number(req.params.id))
      .catch(e => console.error(`[tef] falha ao lançar o pedido ${req.params.id} na maquininha:`, e));

    res.json({ ok: true, mensagem: 'Corrida aceita! Boa entrega.' });
  } catch (e) { next(e); }
});

/** Sequência válida das etapas manuais que o entregador vai marcando durante a corrida. */
const SEQUENCIA_ETAPAS = ['aceita', 'a_caminho_loja', 'chegou_loja', 'saiu_loja'] as const;
type EtapaEntrega = typeof SEQUENCIA_ETAPAS[number];

router.post('/corridas/:id/etapa', async (req, res, next) => {
  try {
    const etapa = String(req.body.etapa || '') as EtapaEntrega;
    const indice = SEQUENCIA_ETAPAS.indexOf(etapa);
    if (indice < 1) throw erroHttp(400, 'Etapa inválida.');

    const pedido = await db.prepare(
      "SELECT id, entregador_etapa FROM pedidos WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'"
    ).get(req.params.id, req.usuario!.id) as { id: number; entregador_etapa: string } | undefined;
    if (!pedido) throw erroHttp(409, 'Esta entrega não está em andamento com você.');

    // Entregas aceitas antes desta versão não têm entregador_etapa salva — trata como 'aceita'.
    const indiceAtual = Math.max(0, SEQUENCIA_ETAPAS.indexOf(pedido.entregador_etapa as EtapaEntrega));
    if (indice !== indiceAtual + 1) {
      throw erroHttp(409, 'Etapa fora de ordem — atualize a tela e tente de novo.');
    }

    const agora = agoraUTC();
    await db.prepare('UPDATE pedidos SET entregador_etapa = ? WHERE id = ?').run(etapa, pedido.id);
    await db.prepare('INSERT INTO etapas_entrega (pedido_id, etapa, criado_em) VALUES (?, ?, ?)')
      .run(pedido.id, etapa, agora);

    res.json({ ok: true, etapa });
  } catch (e) { next(e); }
});

router.get('/atual', async (req, res, next) => {
  try {
    const pedido = await db.prepare(
      `SELECT p.id, p.endereco_entrega, p.entrega_lat, p.entrega_lon, p.taxa_entrega_centavos, p.total_centavos,
              p.forma_pagamento, p.troco_para_centavos, p.observacoes, p.entregador_etapa, p.criado_em,
              l.nome AS loja_nome, l.endereco AS loja_endereco, l.lat AS loja_lat, l.lon AS loja_lon,
              u.nome AS cliente_nome, u.telefone AS cliente_telefone
         FROM pedidos p
         JOIN lojas l ON l.id = p.loja_id
         JOIN usuarios u ON u.id = p.cliente_id
        WHERE p.entregador_id = ? AND p.status = 'em_entrega'`
    ).get(req.usuario!.id) as { id: number } | undefined;

    if (!pedido) { res.json({ pedido: null }); return; }

    const etapas = await db.prepare(
      'SELECT etapa, criado_em FROM etapas_entrega WHERE pedido_id = ? ORDER BY id'
    ).all(pedido.id);

    res.json({ pedido: { ...pedido, etapas } });
  } catch (e) { next(e); }
});

/**
 * Rastreamento ao vivo: o entregador reporta sua posição GPS enquanto a
 * entrega está em andamento. Só grava se o pedido for dele e estiver em_entrega.
 */
router.post('/corridas/:id/localizacao', async (req, res, next) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw erroHttp(400, 'Coordenadas inválidas.');
    }
    const resultado = await db.prepare(
      `UPDATE pedidos
          SET entregador_lat = ?, entregador_lng = ?, entregador_local_em = ?
        WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'`
    ).run(lat, lng, agoraUTC(), req.params.id, req.usuario!.id);
    if (resultado.changes === 0) {
      throw erroHttp(409, 'Esta entrega não está em andamento com você.');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * "Estou chegando": avisa o cliente que o entregador está próximo.
 * Marca o pedido e dispara uma notificação push (funciona com o app fechado).
 */
router.post('/corridas/:id/chegando', async (req, res, next) => {
  try {
    const pedido = await db.prepare(
      `SELECT p.id, p.cliente_id, l.nome AS loja_nome
         FROM pedidos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.id = ? AND p.entregador_id = ? AND p.status = 'em_entrega'`
    ).get(req.params.id, req.usuario!.id) as
      { id: number; cliente_id: number; loja_nome: string } | undefined;
    if (!pedido) throw erroHttp(409, 'Esta entrega não está em andamento com você.');

    await db.prepare('UPDATE pedidos SET aviso_chegada_em = ? WHERE id = ?')
      .run(agoraUTC(), pedido.id);

    await registrarEvento(pedido.id, 'entregador_chegando');

    await enviarPush(pedido.cliente_id, {
      titulo: '🛵 Seu pedido está chegando!',
      corpo: `O entregador da ${pedido.loja_nome} está quase aí. Prepare-se para receber!`,
      url: `/pedido/${pedido.id}`,
      tag: `chegando-${pedido.id}`,
    });

    /*
     * TAMBÉM NO WHATSAPP, e não só push.
     *
     * Esta é a mensagem mais útil de todas: é ela que faz o cliente descer,
     * achar a chave, prender o cachorro. Push só alcança quem instalou o app e
     * deixou a notificação ligada — que é a minoria. WhatsApp chega em todo
     * mundo que deu o número.
     *
     * Best-effort: falhar aqui não pode fazer o entregador achar que não avisou.
     */
    {
      const base = `${req.protocol}://${req.get('host')}`;
      const { avisarStatusWhatsApp } = await import('../whatsapp');
      avisarStatusWhatsApp(pedido.id, 'chegando', base)
        .catch(e => console.warn('[WhatsApp] aviso de chegada falhou:', e));
    }

    res.json({ ok: true, mensagem: 'Cliente avisado!' });
  } catch (e) { next(e); }
});

router.post('/corridas/:id/entregar', async (req, res, next) => {
  try {
    const emCurso = await db.prepare(
      "SELECT entregador_etapa FROM pedidos WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'"
    ).get(req.params.id, req.usuario!.id) as { entregador_etapa: string } | undefined;
    if (emCurso && emCurso.entregador_etapa !== 'saiu_loja') {
      throw erroHttp(409, 'Marque que já saiu da loja antes de confirmar a entrega.');
    }

    const agora = agoraUTC();
    const resultado = await db.prepare(
      `UPDATE pedidos SET status = 'entregue', atualizado_em = ?
        WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'`
    ).run(agora, req.params.id, req.usuario!.id);
    if (resultado.changes === 0) {
      throw erroHttp(409, 'Esta entrega não está em andamento com você.');
    }
    await db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
      .run(req.params.id, 'entregue', agora);
    await registrarEvento(Number(req.params.id), 'entregue');

    /*
     * CRÉDITO OU DÉBITO da maquininha, informado por quem estava lá.
     *
     * A NFC-e precisa distinguir (tPag 03 x 04) e o sistema não conversa com a
     * máquina — até aqui todo cartão na entrega saía declarado como crédito. O
     * entregador é o único que vê qual botão foi apertado, e este é o único
     * momento em que ele está com o pedido na mão.
     *
     * OPCIONAL de propósito: não informar mantém o comportamento de antes
     * (crédito). Travar a confirmação de entrega por um campo fiscal deixaria o
     * entregador parado na porta do cliente.
     *
     * Gravado ANTES de emitir a nota, senão a emissão leria o valor velho.
     */
    const tipoCartao = req.body?.tipo_cartao;
    if (tipoCartao === 'credit_card' || tipoCartao === 'debit_card') {
      await db.prepare(
        "UPDATE pedidos SET pagamento_tipo = ? WHERE id = ? AND forma_pagamento = 'cartao_entrega'"
      ).run(tipoCartao, req.params.id);
    }
    // Auto-emite a NFC-e da venda entregue (se a loja tiver NFC-e ativa + certificado).
    // Fire-and-forget: não bloqueia nem falha a confirmação de entrega.
    emitirNfcePedido(Number(req.params.id)).catch(() => { /* nota fica registrada com o erro */ });
    res.json({ ok: true, mensagem: 'Entrega confirmada. Obrigado!' });
  } catch (e) { next(e); }
});

router.get('/historico', async (req, res, next) => {
  try {
    const periodo = ['dia', 'semana', 'mes'].includes(req.query.periodo as string)
      ? (req.query.periodo as 'dia' | 'semana' | 'mes') : 'semana';
    const dias = { dia: 1, semana: 7, mes: 30 }[periodo];
    const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

    type Entrega = { id: number; endereco_entrega: string; taxa_entrega_centavos: number; atualizado_em: string; loja_nome: string };
    const entregas = await db.prepare(
      `SELECT p.id, p.endereco_entrega, p.taxa_entrega_centavos, p.atualizado_em,
              l.nome AS loja_nome
         FROM pedidos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.entregador_id = ? AND p.status = 'entregue' AND p.atualizado_em >= ?
        ORDER BY p.id DESC`
    ).all(req.usuario!.id, inicio) as Entrega[];

    const totalFretes = entregas.reduce((soma, e) => soma + e.taxa_entrega_centavos, 0);
    res.json({ periodo, entregas, total_fretes_centavos: totalFretes });
  } catch (e) { next(e); }
});

// ----- Chat do pedido -------------------------------------------------------

/** Confere que o pedido pertence a este entregador antes de deixar ler/escrever. */
async function minhaCorridaAtiva(pedidoId: string | number, entregadorId: number) {
  const pedido = await db.prepare('SELECT id FROM pedidos WHERE id = ? AND entregador_id = ?')
    .get(pedidoId, entregadorId) as { id: number } | undefined;
  if (!pedido) throw erroHttp(404, 'Pedido não encontrado ou não é seu.');
  return pedido;
}

router.get('/corridas/:id/mensagens', async (req, res, next) => {
  try {
    const pedido = await minhaCorridaAtiva(req.params.id, req.usuario!.id);
    const mensagens = await db.prepare(
      'SELECT id, remetente, texto, criado_em FROM mensagens_pedido WHERE pedido_id = ? ORDER BY id'
    ).all(pedido.id);
    await db.prepare("UPDATE mensagens_pedido SET lida = 1 WHERE pedido_id = ? AND remetente = 'cliente'").run(pedido.id);
    res.json({ mensagens });
  } catch (e) { next(e); }
});

router.post('/corridas/:id/mensagens', async (req, res, next) => {
  try {
    const pedido = await minhaCorridaAtiva(req.params.id, req.usuario!.id);
    const texto = String(req.body.texto || '').trim().slice(0, 500);
    if (!texto) throw erroHttp(400, 'Escreva uma mensagem.');
    const info = await db.prepare(
      `INSERT INTO mensagens_pedido (pedido_id, remetente, texto, criado_em) VALUES (?, 'entregador', ?, ?)`
    ).run(pedido.id, texto, agoraUTC());
    res.status(201).json({ mensagem_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

/** Preferência de como o entregador quer conversar com o cliente. */
router.get('/config/chat', async (req, res, next) => {
  try {
    const u = await db.prepare('SELECT entregador_chat_metodo FROM usuarios WHERE id = ?').get(req.usuario!.id) as { entregador_chat_metodo: string };
    res.json({ metodo: u.entregador_chat_metodo || 'app' });
  } catch (e) { next(e); }
});

router.put('/config/chat', async (req, res, next) => {
  try {
    const metodo = req.body.metodo === 'whatsapp' ? 'whatsapp' : 'app';
    await db.prepare('UPDATE usuarios SET entregador_chat_metodo = ? WHERE id = ?').run(metodo, req.usuario!.id);
    res.json({ ok: true, metodo });
  } catch (e) { next(e); }
});

export default router;
