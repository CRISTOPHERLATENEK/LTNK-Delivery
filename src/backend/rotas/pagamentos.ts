/**
 * Pagamentos — integração Mercado Pago Pix (token por loja ou global via env).
 */
import { Router } from 'express';
import crypto from 'crypto';
import db, { abrirPool, comTenant, comTransacao } from '../db-mysql';
import { agoraUTC } from '../util';
import { notificarLojistaNovoPedido } from '../notificacoes';
import { descriptografar } from '../cripto';
import { tenantPorDbNome, listarTenants } from '../tenants-mysql';
import * as onz from '../onz';
// Cancelamento de pedido expirado passa pela máquina de estados (valida a
// transição, registra na linha do tempo e notifica) — nunca por UPDATE na mão.
import { transicionarStatus } from '../fluxoPedido';
import { Pedido } from '../../tipos/modelos';

const router = Router();

const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';

/**
 * Token da plataforma (fallback quando a loja não tem o próprio): configurável
 * pelo admin com um token de teste (TEST-) e um de produção (APP_USR-) lado a
 * lado, e um modo ativo escolhendo qual dos dois vale — assim dá pra testar o
 * Pix sem risco de gerar cobrança real, e trocar pra produção só apertando um
 * botão. Cai no MERCADOPAGO_ACCESS_TOKEN do .env se nada estiver configurado
 * (compatibilidade com o que já estava em produção antes dessa tela existir).
 */
async function tokenPlataformaMP(): Promise<string | null> {
  if (!BANCO_CENTRAL) return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
  const [rows] = await abrirPool(BANCO_CENTRAL).query(
    "SELECT chave, valor FROM configuracoes WHERE chave IN ('mercadopago_modo', 'mercadopago_token_teste', 'mercadopago_token_producao')"
  );
  const cfg: Record<string, string> = {};
  for (const r of rows as { chave: string; valor: string }[]) cfg[r.chave] = r.valor;
  const modo = cfg.mercadopago_modo === 'teste' ? 'teste' : 'producao';
  const cifrado = modo === 'teste' ? cfg.mercadopago_token_teste : cfg.mercadopago_token_producao;
  if (cifrado) {
    try { return descriptografar(cifrado); } catch { /* chave trocada/corrompido */ }
  }
  return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
}

/**
 * Obtém o token MP da loja: cada loja usa sua PRÓPRIA conta (Mercado Pago,
 * Sicoob, etc. — não tem token compartilhado entre lojas), com um par
 * teste/produção e um modo ativo, igual ao token da plataforma. `mercadopago_token`
 * é o campo antigo (uma loja, um token só) — mantido como fallback pra quem
 * configurou antes dessa tela existir. Só cai no token da plataforma se a loja
 * não tiver configurado nada disso ainda.
 */
/**
 * Token DA LOJA, sem cair no da plataforma.
 *
 * A diferença importa porque o token decide EM QUAL CONTA O DINHEIRO CAI. Com o
 * fallback, uma loja que nunca configurou o Mercado Pago recebe pagamento na conta
 * da PLATAFORMA — e ninguém percebe até a conciliação do mês, quando o lojista
 * cobra um dinheiro que está em outro CNPJ.
 *
 * No Pix o fallback era tolerável (a loja quase sempre usa a própria conta ONZ). No
 * cartão não há alternativa: é Mercado Pago ou nada, então o fallback silencioso vira
 * dinheiro no lugar errado.
 */
export async function tokenProprioMP(lojaId: number): Promise<string | null> {
  return (await credenciaisProprias(lojaId))?.token ?? null;
}

/** Token da loja + o MODO em que ele foi emitido (teste ou produção). */
async function credenciaisProprias(lojaId: number): Promise<{ token: string; modo: 'teste' | 'producao' } | null> {
  const row = await db.prepare(
    'SELECT mercadopago_token, mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo FROM lojas WHERE id = ?'
  ).get(lojaId) as {
    mercadopago_token: string | null; mercadopago_token_teste: string | null;
    mercadopago_token_producao: string | null; mercadopago_modo: string;
  } | undefined;
  if (!row) return null;
  const modo: 'teste' | 'producao' = row.mercadopago_modo === 'teste' ? 'teste' : 'producao';
  const cifrado = modo === 'teste' ? row.mercadopago_token_teste : row.mercadopago_token_producao;
  if (cifrado) {
    try { return { token: descriptografar(cifrado), modo }; } catch { /* chave trocada/corrompido */ }
  }
  if (row.mercadopago_token) {
    try { return { token: descriptografar(row.mercadopago_token), modo }; } catch { /* chave trocada/corrompido */ }
  }
  return null;
}

/** Cartão online só existe com RECEBEDOR PRÓPRIO configurado — ver `tokenProprioMP`. */
export async function cartaoOnlineAtivo(lojaId: number): Promise<boolean> {
  return !!(await tokenProprioMP(lojaId));
}

export async function getTokenMP(lojaId: number): Promise<string | null> {
  const row = await db.prepare(
    'SELECT mercadopago_token, mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo FROM lojas WHERE id = ?'
  ).get(lojaId) as {
    mercadopago_token: string | null; mercadopago_token_teste: string | null;
    mercadopago_token_producao: string | null; mercadopago_modo: string;
  } | undefined;
  if (row) {
    const cifrado = row.mercadopago_modo === 'teste' ? row.mercadopago_token_teste : row.mercadopago_token_producao;
    if (cifrado) {
      try { return descriptografar(cifrado); } catch { /* chave trocada/corrompido */ }
    }
    if (row.mercadopago_token) {
      try { return descriptografar(row.mercadopago_token); } catch { /* chave trocada/corrompido */ }
    }
  }
  return tokenPlataformaMP();
}

/** Pix online está disponível para essa loja? */
export type GatewayPix = 'mercadopago' | 'onz';

/** Gateway de Pix online escolhido pela loja (coluna lojas.pagamento_gateway). */
export async function gatewayDaLoja(lojaId: number): Promise<GatewayPix> {
  const row = await db.prepare('SELECT pagamento_gateway FROM lojas WHERE id = ?').get(lojaId) as
    { pagamento_gateway: string | null } | undefined;
  return row?.pagamento_gateway === 'onz' ? 'onz' : 'mercadopago';
}

/**
 * Credenciais da conta ONZ DA LOJA (cada cliente tem a própria conta na
 * Planner). Retorna null se a loja não configurou — aí o chamador cai na conta
 * da plataforma (.env), o que preserva quem já estava rodando assim.
 */
export async function credenciaisOnzDaLoja(lojaId: number): Promise<onz.CredenciaisLoja | null> {
  const row = await db.prepare(
    'SELECT onz_client_id, onz_client_secret, onz_pix_key FROM lojas WHERE id = ?'
  ).get(lojaId) as { onz_client_id: string | null; onz_client_secret: string | null; onz_pix_key: string | null } | undefined;
  if (!row?.onz_client_id || !row.onz_client_secret || !row.onz_pix_key) return null;
  try {
    return {
      clientId: descriptografar(row.onz_client_id),
      clientSecret: descriptografar(row.onz_client_secret),
      chavePix: row.onz_pix_key,
    };
  } catch {
    // APP_SECRET trocado ou dado corrompido: melhor tratar como "não
    // configurado" (e cair no fallback) do que quebrar o checkout.
    console.error(`[onz] credenciais da loja ${lojaId} ilegíveis — usando a conta da plataforma.`);
    return null;
  }
}

/**
 * Pix online disponível pra essa loja? Depende do gateway escolhido:
 *  - mercadopago: precisa de token (da loja ou o da plataforma/env);
 *  - onz: precisa de credencial da loja OU da plataforma.
 */
export async function pagamentoOnlineAtivo(lojaId: number): Promise<boolean> {
  const gateway = await gatewayDaLoja(lojaId);
  if (gateway === 'onz') return onz.cashInDisponivel(await credenciaisOnzDaLoja(lojaId));
  return !!(await getTokenMP(lojaId));
}

/**
 * Cria a cobrança Pix no gateway da loja e devolve o QR pronto pra exibir —
 * ponto único de despacho (o checkout não precisa saber qual gateway é).
 * `notificationUrl` é usada só pelo Mercado Pago (a ONZ recebe o webhook por
 * uma URL registrada previamente na conta, no padrão Bacen).
 */
export async function criarCobrancaPix(
  lojaId: number, pedido: Pedido, dadosPagador: DadosPagador, notificationUrl?: string,
): Promise<PixGerado & { gateway: GatewayPix }> {
  const gateway = await gatewayDaLoja(lojaId);
  if (gateway === 'onz') {
    // Instrumentação: o cliente espera esta chamada com a tela em branco. Medido
    // localmente dá ~60ms com token em cache e ~1s na primeira (a autenticação).
    // Se em produção passar disso, o log aponta o culpado sem chutar.
    const t0 = Date.now();
    const cob = await onz.criarCobranca({
      pedidoId: pedido.id,
      valorCentavos: pedido.total_centavos,
      descricao: `Pedido #${pedido.id}`,
      // Cobra na conta DA LOJA (o dinheiro vai direto pra ela).
      cred: await credenciaisOnzDaLoja(lojaId),
    });
    const ms = Date.now() - t0;
    if (ms > 1500) console.warn(`[onz] cobrança do pedido ${pedido.id} levou ${ms}ms (lento).`);
    return {
      gateway: 'onz',
      // txid é o identificador que o webhook/consulta da ONZ usa.
      pagamento_id: cob.txid,
      status: cob.status,
      qr_code: cob.copiaECola,
      qr_code_base64: (cob.qrPngDataUrl || '').replace(/^data:image\/png;base64,/, ''),
    };
  }
  const pix = await criarPagamentoMercadoPago(lojaId, pedido, dadosPagador, notificationUrl);
  return { ...pix, gateway: 'mercadopago' };
}

export interface DadosPagador {
  email: string;
}

/** Dados do Pix retornados pro cliente: copia-e-cola + imagem do QR. */
export interface PixGerado {
  pagamento_id: string;
  status: string;
  qr_code: string;
  qr_code_base64: string;
}

/**
 * Cria um pagamento Pix no Mercado Pago e devolve o QR pronto pra exibir.
 * `notificationUrl` (opcional) é a URL que o MP chama ao mudar o status — deve
 * carregar o tenant dono do pedido (?t=<banco>) pra o webhook confirmar no
 * banco certo no modelo SILO (ver rota /webhook/mercadopago abaixo).
 */
export async function criarPagamentoMercadoPago(lojaId: number, pedido: Pedido, dadosPagador: DadosPagador, notificationUrl?: string): Promise<PixGerado> {
  const token = await getTokenMP(lojaId);
  if (!token) {
    throw new Error('Mercado Pago não configurado para esta loja.');
  }
  const resposta = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `pedido-${pedido.id}`,
    },
    body: JSON.stringify({
      transaction_amount: pedido.total_centavos / 100,
      description: `Pedido #${pedido.id}`,
      payment_method_id: 'pix',
      payer: { email: dadosPagador.email },
      external_reference: String(pedido.id),
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    }),
  });
  if (!resposta.ok) throw new Error(`Mercado Pago respondeu ${resposta.status}`);
  const dados = await resposta.json() as {
    id: number | string;
    status: string;
    point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
  };
  const td = dados.point_of_interaction?.transaction_data;
  return {
    pagamento_id: String(dados.id),
    status: dados.status,
    qr_code: td?.qr_code || '',
    qr_code_base64: td?.qr_code_base64 || '',
  };
}

/**
 * CARTÃO ONLINE via CHECKOUT PRO (preferência + redirecionamento).
 *
 * POR QUE CHECKOUT PRO E NÃO CHECKOUT TRANSPARENTE (formulário de cartão na nossa
 * página) — três motivos concretos, na ordem em que pesam:
 *
 * 1. DADOS DE CARTÃO NUNCA PASSAM POR AQUI. No transparente, o número do cartão é
 *    digitado numa página nossa; mesmo com a tokenização feita pelo SDK do MP, o
 *    escopo de PCI sobe (SAQ A-EP) e passa a incluir este servidor. Com o Pro, o
 *    cartão é digitado no domínio do Mercado Pago.
 *
 * 2. NÃO PRECISA DE CREDENCIAL NOVA. O transparente exige a PUBLIC KEY da loja, que
 *    não guardamos hoje — cada lojista teria que colar mais um segredo. O Pro usa o
 *    mesmo access token que o Pix já usa.
 *
 * 3. NÃO MEXE NA CSP. O SDK do MP exigiria abrir `script-src` (e mais origens pro
 *    iframe e o fingerprint de antifraude) numa CSP que este projeto mantém fechada
 *    de propósito. Redirecionamento de navegação não precisa de nada disso.
 *
 * O PREÇO: o cliente sai do site da loja durante o pagamento. Num delivery isso é
 * aceitável — a tela do Mercado Pago é reconhecida e passa confiança pra digitar
 * cartão, que é justamente o momento em que confiança importa.
 *
 * O Pix continua com o fluxo PRÓPRIO (QR na nossa tela): ali sair do site seria
 * perda pura, porque o QR não precisa de ambiente seguro de terceiro.
 */
export async function criarPreferenciaCartao(
  lojaId: number,
  pedido: Pedido,
  dadosPagador: DadosPagador,
  opcoes: { notificationUrl?: string; urlRetorno?: string } = {},
): Promise<{ preferencia_id: string; url: string }> {
  /*
   * `tokenProprioMP` e NÃO `getTokenMP`: sem o token da própria loja, o segundo cairia
   * no da plataforma e o cartão do cliente pagaria na CONTA ERRADA — silenciosamente,
   * até alguém conferir o extrato no fim do mês.
   */
  const cred = await credenciaisProprias(lojaId);
  if (!cred) {
    throw new Error('Esta loja ainda não conectou uma conta do Mercado Pago para receber por cartão.');
  }
  const token = cred.token;

  const corpo: Record<string, unknown> = {
    items: [{
      title: `Pedido #${pedido.id}`,
      quantity: 1,
      currency_id: 'BRL',
      unit_price: pedido.total_centavos / 100,
    }],
    payer: { email: dadosPagador.email },
    // `external_reference` é o que amarra a notificação ao pedido: o id do
    // pagamento só existe depois que o cliente paga, então é por aqui que o
    // webhook encontra o pedido (ver `processarWebhookMP`).
    external_reference: String(pedido.id),
    /*
     * SÓ CARTÃO nesta preferência. Boleto num delivery não faz sentido (o pedido
     * sairia antes de o dinheiro cair, ou o cliente esperaria três dias pelo
     * lanche), e Pix já tem fluxo próprio com QR na nossa tela — deixá-lo aqui
     * duplicaria o caminho e confundiria quem escolheu "cartão".
     */
    payment_methods: {
      excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }],
    },
    ...(opcoes.notificationUrl ? { notification_url: opcoes.notificationUrl } : {}),
    ...(opcoes.urlRetorno
      ? {
          back_urls: { success: opcoes.urlRetorno, pending: opcoes.urlRetorno, failure: opcoes.urlRetorno },
          // Volta sozinho pro acompanhamento do pedido quando aprovado, sem o
          // cliente precisar achar o botão "voltar ao site".
          auto_return: 'approved',
        }
      : {}),
  };

  const resposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Mesmo pedido reenviado (duplo clique, retry de rede) devolve a MESMA
      // preferência em vez de criar uma cobrança nova.
      'X-Idempotency-Key': `pref-pedido-${pedido.id}`,
    },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({})) as { message?: string };
    throw new Error(erro.message || `Mercado Pago recusou criar o checkout (HTTP ${resposta.status}).`);
  }
  const dados = await resposta.json() as { id: string; init_point?: string; sandbox_init_point?: string };
  /*
   * A URL SEGUE O MODO DA CREDENCIAL, e isso não é detalhe: o MP devolve as DUAS
   * (`init_point` e `sandbox_init_point`) na mesma resposta. Mandar quem está em
   * homologação pro `init_point` de produção abre uma tela pedindo cartão de verdade
   * com credencial de teste — erro na cara do cliente, e no teste de homologação
   * parece que "a integração não funciona".
   *
   * A primeira versão deste código preferia produção sempre. Está errado: quem manda
   * é o modo em que o token foi emitido.
   */
  const url = cred.modo === 'teste'
    ? (dados.sandbox_init_point || dados.init_point)
    : (dados.init_point || dados.sandbox_init_point);
  if (!url) throw new Error('Mercado Pago não devolveu a URL do checkout.');
  return { preferencia_id: dados.id, url };
}

/**
 * Estorna um pagamento Pix aprovado NO GATEWAY QUE O PROCESSOU — ponto único
 * de despacho, espelhando `criarCobrancaPix`.
 *
 * POR QUE ISTO EXISTE: o cash-in ganhou dois gateways (Mercado Pago e ONZ),
 * mas o estorno continuou chamando o Mercado Pago direto, sem olhar quem tinha
 * processado. Um pedido pago via ONZ mandava o txid da ONZ pra API do MP: não
 * estornava, e o cliente ficava sem o dinheiro de volta.
 *
 * O gateway vem do PRÓPRIO PEDIDO (`pedidos.pagamento_gateway`, gravado no
 * checkout), e não da configuração atual da loja — se o lojista trocar de
 * gateway depois, os pedidos antigos ainda precisam ser estornados onde foram
 * pagos.
 */
export async function estornarPagamentoPix(
  lojaId: number, gateway: string | null | undefined, pagamentoGatewayId: string,
): Promise<void> {
  if (gateway === 'onz') {
    // A devolução tem que sair da MESMA conta que recebeu — a da loja (cada
    // cliente tem a própria conta ONZ). Sem isso, tentaríamos devolver da conta
    // da plataforma e a API recusaria (txid inexistente lá).
    await onz.devolverCobranca(pagamentoGatewayId, await credenciaisOnzDaLoja(lojaId));
    return;
  }
  // Sem gateway gravado = pedido anterior ao campo, quando só existia o MP.
  await estornarPagamentoMercadoPago(lojaId, pagamentoGatewayId);
}

/**
 * Estorna (reembolso total) um pagamento Pix aprovado direto na API do
 * Mercado Pago. Lança com a mensagem de erro do MP se recusar (ex.: prazo de
 * estorno do Pix expirado, ou o pagamento já foi estornado antes).
 */
export async function estornarPagamentoMercadoPago(lojaId: number, pagamentoGatewayId: string): Promise<void> {
  const token = await getTokenMP(lojaId);
  if (!token) throw new Error('Mercado Pago não configurado para esta loja.');
  const resposta = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoGatewayId)}/refunds`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        /*
         * OBRIGATÓRIA NO ESTORNO — o Mercado Pago recusa sem ela ("Header
         * X-Idempotency-Key can't be null"), e a recusa do pedido era abortada
         * junto (de propósito: melhor não recusar do que recusar sem devolver).
         *
         * A chave é o PAGAMENTO, não o instante: se a mesma devolução for
         * tentada de novo — retry de rede, lojista clicando duas vezes — o MP
         * devolve o mesmo estorno em vez de mandar o dinheiro duas vezes.
         */
        'X-Idempotency-Key': `estorno-pagamento-${pagamentoGatewayId}`,
      },
    },
  );
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo.message || `Mercado Pago recusou o estorno (HTTP ${resposta.status}).`);
  }
}

async function processarWebhookMP(pagamentoId: string, lojaIdDica?: number): Promise<void> {
  /*
   * Descobre qual loja gerou o pagamento pra usar o token certo.
   *
   * `lojaIdDica` vem da `notification_url` (&loja=<id>) e É NECESSÁRIA no cartão:
   * no Checkout Pro o id do pagamento só existe DEPOIS que o cliente paga, então na
   * primeira notificação não há `pagamento_gateway_id` gravado e a busca abaixo não
   * acha nada. Sem a dica, cairia no token da PLATAFORMA — que não enxerga um
   * pagamento feito na conta da loja: a consulta falharia em silêncio e o pedido
   * nunca seria confirmado. No Pix isso não aparecia porque lá o id é gravado no
   * momento da criação da cobrança.
   */
  const pedidoRow = await db.prepare(
    'SELECT loja_id FROM pedidos WHERE pagamento_gateway_id = ?'
  ).get(pagamentoId) as { loja_id: number } | undefined;
  const lojaId = pedidoRow?.loja_id ?? lojaIdDica;
  const token = lojaId ? await getTokenMP(lojaId) : await tokenPlataformaMP();
  if (!token) return;

  const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resposta.ok) return;
  const pagamento = await resposta.json() as { status: string; external_reference: string };

  const pedidoId = Number(pagamento.external_reference);
  const aprovado = pagamento.status === 'approved';
  if (!pedidoId) return;

  // UPDATE condicional idempotente: só "vence" a PRIMEIRA aprovação (o MP
  // reenvia o mesmo webhook várias vezes). Assim o lojista é notificado 1x só.
  const r = await db.prepare(
    `UPDATE pedidos SET pagamento_status = ?, pagamento_gateway = 'mercadopago',
            pagamento_gateway_id = ?, atualizado_em = ?
      WHERE id = ? AND pagamento_status <> ?`
  ).run(aprovado ? 'aprovado' : 'recusado', pagamentoId, agoraUTC(), pedidoId,
        aprovado ? 'aprovado' : 'recusado');

  // O webhook do MP é assíncrono e pode chegar DEPOIS do cliente já ter
  // cancelado o pedido (ex.: cancelou rápido enquanto o pagamento ainda
  // estava em processamento). Marca pagamento_status normalmente (útil pro
  // lojista saber que precisa estornar), mas não avisa "novo pedido" pra um
  // pedido que já morreu.
  if (aprovado && r.changes > 0) {
    const pedido = await db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedidoId) as { status: string } | undefined;
    if (pedido?.status !== 'cancelado') {
      await notificarLojistaNovoPedido(pedidoId);
    }
  }
}

/**
 * Valida o header `x-signature` do webhook contra `MERCADOPAGO_WEBHOOK_SECRET`
 * (algoritmo documentado pelo MP: HMAC-SHA256 de um manifest com id/request-id/
 * ts). Opt-in de propósito — sem o secret configurado, aceita como sempre
 * aceitou (mitigado por sempre reconsultar o pagamento na API do MP antes de
 * confiar em qualquer coisa do corpo da notificação); com o secret, rejeita
 * notificação forjada/sem assinatura válida.
 */
/**
 * Segredo de assinatura DA LOJA, com o do .env como reserva.
 *
 * Por loja porque o Mercado Pago emite a assinatura por APLICAÇÃO, e cada
 * lojista usa a conta dele: um segredo global validaria a notificação de uma
 * loja e rejeitaria a de todas as outras.
 *
 * O do `.env` continua valendo como reserva pra loja que ainda não colou o
 * dela — e pra conta da própria plataforma, que não tem loja associada.
 */
async function segredoWebhookDaLoja(lojaId?: number): Promise<string | null> {
  if (lojaId) {
    try {
      const row = await db.prepare('SELECT mercadopago_webhook_secret FROM lojas WHERE id = ?')
        .get(lojaId) as { mercadopago_webhook_secret: string | null } | undefined;
      if (row?.mercadopago_webhook_secret) return descriptografar(row.mercadopago_webhook_secret);
    } catch { /* segue pro .env */ }
  }
  return process.env.MERCADOPAGO_WEBHOOK_SECRET || null;
}

function assinaturaMpValida(req: import('express').Request, dataId: string, secret: string | null): boolean {
  if (!secret) return true;
  const cabecalho = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (typeof cabecalho !== 'string' || typeof requestId !== 'string') return false;
  const partes: Record<string, string> = {};
  for (const par of cabecalho.split(',')) {
    const [k, v] = par.trim().split('=');
    if (k && v) partes[k] = v;
  }
  if (!partes.ts || !partes.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    const a = Buffer.from(esperado);
    const b = Buffer.from(partes.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

/** Comparação de token resistente a timing (mesmo padrão do webhook do WhatsApp). */
function tokenConfere(recebido: string, esperado: string): boolean {
  if (!esperado) return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Confirma um Pix recebido da ONZ (cash-in) e avisa o lojista.
 * Idempotente: o UPDATE condicional só "vence" a primeira confirmação, então
 * reenvios do webhook (a ONZ re-tenta) não notificam o lojista duas vezes.
 */
async function confirmarPixOnz(txid: string, valorCentavos: number): Promise<boolean> {
  const pedido = await db.prepare(
    "SELECT id, total_centavos FROM pedidos WHERE pagamento_gateway = 'onz' AND pagamento_gateway_id = ?"
  ).get(txid) as { id: number; total_centavos: number } | undefined;
  if (!pedido) return false; // não é deste tenant — quem chamou tenta o próximo

  // Confere o valor: pagamento a menos NÃO aprova o pedido (evita liberar
  // pedido pago parcialmente). Fica em 'aguardando' pro lojista resolver.
  if (valorCentavos > 0 && valorCentavos < pedido.total_centavos) {
    console.warn(`[onz] Pix de ${valorCentavos} < total ${pedido.total_centavos} do pedido ${pedido.id} — não aprovado.`);
    return true; // achamos o pedido (só não aprovamos) — não procure em outro tenant
  }

  const r = await db.prepare(
    `UPDATE pedidos SET pagamento_status = 'aprovado', atualizado_em = ?
      WHERE id = ? AND pagamento_status <> 'aprovado'`
  ).run(agoraUTC(), pedido.id);
  if (r.changes > 0) await notificarLojistaNovoPedido(pedido.id);
  return true;
}

/**
 * Acha o tenant dono do txid e confirma lá. Tenta primeiro o tenant sugerido
 * na URL (`?t=`, caminho rápido) e, se não achar, varre os demais.
 *
 * POR QUE VARRER: a conta ONZ é UMA da plataforma, com UMA chave Pix, e o
 * `PUT /webhook/{chave}` aceita UMA URL. Logo todos os tenants recebem pelo
 * mesmo webhook. Sem essa varredura, só o tenant fixado na URL teria pagamento
 * confirmado e os outros ficariam eternamente "aguardando" — e seria preciso
 * mexer no servidor a cada cliente novo. Assim registra-se a URL uma única vez
 * e qualquer tenja futuro passa a funcionar sozinho.
 *
 * O txid é único por pedido (prefixo + aleatório), então não há ambiguidade.
 */
async function confirmarPixOnzEmQualquerTenant(txid: string, valorCentavos: number, dbNomeSugerido: string): Promise<void> {
  if (dbNomeSugerido) {
    const sugerido = await tenantPorDbNome(dbNomeSugerido);
    if (sugerido && await comTenant(sugerido.db_nome, () => confirmarPixOnz(txid, valorCentavos))) return;
  }
  for (const t of await listarTenants()) {
    if (t.db_nome === dbNomeSugerido) continue; // já tentado acima
    try {
      if (await comTenant(t.db_nome, () => confirmarPixOnz(txid, valorCentavos))) return;
    } catch (e) {
      // Um tenant com banco fora do ar não pode impedir os outros de confirmar.
      console.error(`[onz] falha ao procurar txid ${txid} no tenant ${t.db_nome}:`, e);
    }
  }
  console.warn(`[onz] txid ${txid} não encontrado em nenhum tenant — ignorado.`);
}

/**
 * REDE DE SEGURANÇA do cash-in: confere na API da ONZ os pedidos que ficaram
 * `aguardando` e confirma os que já foram pagos.
 *
 * POR QUE EXISTE: o webhook é o caminho normal, mas é frágil por natureza —
 * basta o servidor estar fora do ar no instante da notificação, a URL não estar
 * registrada naquela chave Pix, ou a ONZ desativar o webhook após falhas
 * consecutivas, e o pedido fica "aguardando" PARA SEMPRE mesmo pago. Aconteceu
 * de verdade: dois pedidos pagos (R$ 217,49 e R$ 166,69) ficaram presos porque a
 * chave da loja não tinha webhook registrado. Sem reconciliação, o único
 * remédio era alguém notar na mão.
 *
 * Roda no tenant ATUAL (chame dentro de comTenant). Idempotente: reusa o mesmo
 * UPDATE condicional do webhook, então não notifica o lojista duas vezes nem
 * conflita com uma notificação que chegue no meio.
 */
export async function reconciliarPagamentosOnz(horasParaTras = 48): Promise<{ conferidos: number; confirmados: number; expirados: number }> {
  const limite = new Date(Date.now() - horasParaTras * 3600_000).toISOString();
  const pendentes = await db.prepare(
    `SELECT id, loja_id, status, pagamento_gateway_id FROM pedidos
      WHERE pagamento_gateway = 'onz' AND pagamento_status = 'aguardando'
        AND pagamento_gateway_id <> '' AND criado_em >= ?
      ORDER BY id DESC LIMIT 200`
  ).all(limite) as Array<{ id: number; loja_id: number; status: string; pagamento_gateway_id: string }>;
  if (pendentes.length === 0) return { conferidos: 0, confirmados: 0, expirados: 0 };

  // Uma credencial por loja, não por pedido (várias pendências da mesma loja são
  // comuns) — evita reler e decifrar o mesmo segredo em looping.
  const credPorLoja = new Map<number, onz.CredenciaisLoja | null>();
  let confirmados = 0, expirados = 0;

  for (const p of pendentes) {
    try {
      if (!credPorLoja.has(p.loja_id)) credPorLoja.set(p.loja_id, await credenciaisOnzDaLoja(p.loja_id));
      const credLoja = credPorLoja.get(p.loja_id) ?? null;

      let cob;
      try {
        cob = await onz.consultarCobranca(p.pagamento_gateway_id, credLoja);
      } catch (e) {
        // 404 na conta da loja + a loja TEM conta própria = a cobrança pode ter
        // nascido antes disso, na conta da plataforma (fallback). Acontece de
        // verdade: pedido cobrado hoje na plataforma, credencial própria
        // cadastrada amanhã. Tenta lá antes de desistir.
        const status = (e as { status?: number }).status;
        if (status !== 404 || !credLoja) throw e;
        cob = await onz.consultarCobranca(p.pagamento_gateway_id, null);
      }

      if (!cob.pago) {
        // Cobrança REMOVIDA sem nenhum Pix = expirou (ou o recebedor removeu).
        // É estado TERMINAL na ONZ: não existe pagar depois. Então o pedido não
        // pode ficar "aguardando" pra sempre — some da fila com motivo explícito.
        //
        // Só mexe em pedido ainda `pendente`: se o lojista já aceitou, ele pode
        // ter combinado outro meio de pagamento, e a decisão humana vence.
        if (String(cob.status).startsWith('REMOVIDA') && p.status === 'pendente') {
          try {
            await transicionarStatus(p.id, 'cancelado', {
              camposExtras: { motivo_recusa: 'Pagamento Pix não confirmado — o prazo da cobrança expirou.' },
            });
            expirados++;
            console.log(`[onz] reconciliação: pedido ${p.id} cancelado (cobrança ${cob.status}, sem pagamento).`);
          } catch (e) {
            console.error(`[onz] reconciliação: não consegui cancelar o pedido ${p.id}:`, (e as Error).message);
          }
        }
        continue;
      }
      // Mesmo caminho do webhook: valida valor, é idempotente e notifica o lojista.
      if (await confirmarPixOnz(p.pagamento_gateway_id, cob.valorPagoCentavos)) {
        confirmados++;
        console.log(`[onz] reconciliação: pedido ${p.id} confirmado (Pix já havia caído).`);
      }
    } catch (e) {
      // Um pedido problemático não pode impedir a conferência dos outros.
      //
      // 404 é PERMANENTE (o txid não existe em nenhuma das contas — ex.: cobrança
      // de um ambiente antigo) e a reconciliação roda a cada 5 min: logar sempre
      // enche o log de ruído eterno e esconde problema real. Registra uma vez por
      // pedido, por processo.
      const status = (e as { status?: number }).status;
      const msg = (e as Error).message;
      if (status === 404) {
        if (!avisado404.has(p.pagamento_gateway_id)) {
          avisado404.add(p.pagamento_gateway_id);
          console.warn(`[onz] reconciliação: cobrança do pedido ${p.id} não existe em nenhuma conta (não vou avisar de novo).`);
        }
        continue;
      }
      console.error(`[onz] reconciliação: falha no pedido ${p.id}:`, msg);
    }
  }
  return { conferidos: pendentes.length, confirmados, expirados };
}

/**
 * txids já reportados como inexistentes (404), pra não repetir o aviso a cada
 * ciclo. Em memória de propósito: reiniciar o processo reavisa uma vez, o que é
 * aceitável e evita coluna nova só pra controle de log.
 */
const avisado404 = new Set<string>();

/**
 * Última consulta por pedido, pra não deixar o cliente (ou uma aba esquecida)
 * metralhar a API do PSP. 2,5s casa com o polling de ~3s da tela do QR.
 */
const ultimaConferencia = new Map<number, number>();
const INTERVALO_MIN_CONFERENCIA = 2500;

/**
 * Confere NA HORA, direto na API da ONZ, se o Pix de um pedido já caiu — e
 * confirma se sim.
 *
 * POR QUE EXISTE: o webhook é instantâneo mas não é garantido (§ armadilha do
 * webhook por chave), e a reconciliação só roda a cada 5 min — uma eternidade
 * com o cliente parado na tela do QR. Enquanto essa tela está aberta, sabemos
 * que o pagamento está acontecendo AGORA, então vale perguntar ativamente.
 *
 * Devolve `true` se o pedido está pago (já estava ou acabou de ser confirmado).
 */
export async function conferirPixAgora(pedidoId: number): Promise<boolean> {
  const pedido = await db.prepare(
    'SELECT id, loja_id, status, pagamento_status, pagamento_gateway, pagamento_gateway_id FROM pedidos WHERE id = ?'
  ).get(pedidoId) as {
    id: number; loja_id: number; status: string;
    pagamento_status: string; pagamento_gateway: string | null; pagamento_gateway_id: string | null;
  } | undefined;
  if (!pedido) return false;
  if (pedido.pagamento_status === 'aprovado') return true;
  // Só faz sentido pra Pix ONZ ainda aguardando (o Mercado Pago tem o webhook
  // dele, e pedido cancelado/entregue não tem o que conferir).
  if (pedido.pagamento_gateway !== 'onz' || pedido.pagamento_status !== 'aguardando') return false;
  if (!pedido.pagamento_gateway_id) return false;

  const agora = Date.now();
  const ultima = ultimaConferencia.get(pedidoId) ?? 0;
  if (agora - ultima < INTERVALO_MIN_CONFERENCIA) return false; // freio anti-abuso
  ultimaConferencia.set(pedidoId, agora);

  const cob = await onz.consultarCobranca(pedido.pagamento_gateway_id, await credenciaisOnzDaLoja(pedido.loja_id));
  if (!cob.pago) return false;
  // Mesmo caminho do webhook: idempotente e notifica o lojista uma vez só.
  await confirmarPixOnz(pedido.pagamento_gateway_id, cob.valorPagoCentavos);
  const depois = await db.prepare('SELECT pagamento_status FROM pedidos WHERE id = ?')
    .get(pedidoId) as { pagamento_status: string } | undefined;
  return depois?.pagamento_status === 'aprovado';
}

/**
 * Public key da loja — a credencial que o NAVEGADOR usa pra montar o formulário
 * de cartão. Pública por definição; não é segredo e não autoriza cobrança.
 */
export async function publicKeyMP(lojaId: number): Promise<string | null> {
  const row = await db.prepare('SELECT mercadopago_public_key FROM lojas WHERE id = ?')
    .get(lojaId) as { mercadopago_public_key: string | null } | undefined;
  return row?.mercadopago_public_key || null;
}

export interface DadosCartaoBrick {
  token: string;
  payment_method_id: string;
  issuer_id?: string;
  installments?: number;
  payer?: { email?: string; identification?: { type?: string; number?: string } };
}

/**
 * COBRA O CARTÃO na conta da loja, a partir do token gerado no navegador.
 *
 * É o caminho do Checkout Bricks: o cliente digita o cartão em campos servidos
 * pelo próprio Mercado Pago (iframes), o SDK devolve um TOKEN de uso único, e é
 * esse token que chega aqui. O número do cartão nunca passa por este servidor —
 * é o que mantém o escopo de PCI no mesmo nível do redirecionamento (SAQ A),
 * com a diferença de o cliente não sair da loja.
 *
 * IDEMPOTÊNCIA É OBRIGATÓRIA AQUI, mais do que na preferência: ali um retry
 * duplicava uma intenção de pagamento; aqui duplicaria uma COBRANÇA. Duplo
 * clique, rede instável ou retry do navegador cobrariam o cliente duas vezes.
 * A chave é o pedido, então a segunda chamada devolve o mesmo pagamento.
 */
export async function criarPagamentoCartao(
  lojaId: number,
  pedido: Pedido,
  dados: DadosCartaoBrick,
  opcoes: { notificationUrl?: string; emailPadrao?: string } = {},
): Promise<{ id: string; status: string; status_detail: string }> {
  const token = await getTokenMP(lojaId);
  if (!token) throw new Error('Mercado Pago não configurado para esta loja.');

  const corpo: Record<string, unknown> = {
    // O valor vem do PEDIDO, nunca do que o navegador mandou: quem digita o
    // cartão não pode escolher quanto vai pagar.
    transaction_amount: pedido.total_centavos / 100,
    token: dados.token,
    payment_method_id: dados.payment_method_id,
    installments: dados.installments || 1,
    ...(dados.issuer_id ? { issuer_id: dados.issuer_id } : {}),
    description: `Pedido #${pedido.id}`,
    external_reference: String(pedido.id),
    payer: {
      email: dados.payer?.email || opcoes.emailPadrao,
      ...(dados.payer?.identification?.number
        ? { identification: dados.payer.identification }
        : {}),
    },
    ...(opcoes.notificationUrl ? { notification_url: opcoes.notificationUrl } : {}),
  };

  const resposta = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `pagamento-pedido-${pedido.id}`,
    },
    body: JSON.stringify(corpo),
  });

  const d = await resposta.json().catch(() => ({})) as {
    id?: number | string; status?: string; status_detail?: string; message?: string;
  };
  if (!resposta.ok || !d.id) {
    throw new Error(d.message || `Mercado Pago recusou a cobrança (HTTP ${resposta.status}).`);
  }
  return { id: String(d.id), status: d.status || '', status_detail: d.status_detail || '' };
}

/**
 * Aplica no pedido o resultado de um pagamento de cartão recém-criado.
 *
 * Reaproveita `processarWebhookMP` de propósito: ele reconsulta o pagamento na
 * API antes de gravar qualquer coisa e é idempotente, então webhook, conferência
 * na tela, reconciliação e esta chamada convergem no mesmo lugar — sem quatro
 * versões da regra de "quando um pedido vira pago".
 */
export async function aplicarResultadoCartao(pagamentoId: string, lojaId: number): Promise<void> {
  await processarWebhookMP(pagamentoId, lojaId);
}

/**
 * Pergunta ao Mercado Pago se o CARTÃO do pedido já foi pago, sem esperar o webhook.
 *
 * POR QUE EXISTE: o webhook do MP não é garantido. Homologando o cartão a gente
 * viu um pagamento `approved` cuja `notification_url` estava gravada certa no
 * pagamento e que MESMO ASSIM nunca foi notificado — nenhuma chamada chegou ao
 * servidor. Sem esta conferência o pedido fica em "aguardando pagamento" para
 * sempre: o cliente pagou e a loja nunca vê o pedido. É a pior falha do fluxo
 * inteiro, e depender de uma única entrega HTTP pra evitá-la é ingenuidade.
 *
 * O Pix já tinha esse resgate (`conferirPixAgora`); o cartão ficou de fora
 * porque se assumiu que "o Mercado Pago tem o webhook dele". Tem, e ele falha.
 *
 * SÓ AGE EM APROVAÇÃO. Recusa fica por conta do webhook de propósito: um pedido
 * marcado `recusado` sai do estado "aguardando" e nunca mais é conferido aqui —
 * então marcar recusa cedo demais fecharia a porta pra uma segunda tentativa do
 * cliente que ainda estivesse em curso.
 */
export async function conferirCartaoAgora(pedidoId: number): Promise<boolean> {
  const pedido = await db.prepare(
    'SELECT id, loja_id, pagamento_status, pagamento_gateway FROM pedidos WHERE id = ?'
  ).get(pedidoId) as {
    id: number; loja_id: number; pagamento_status: string; pagamento_gateway: string | null;
  } | undefined;
  if (!pedido) return false;
  if (pedido.pagamento_status === 'aprovado') return true;
  if (pedido.pagamento_gateway !== 'mercadopago' || pedido.pagamento_status !== 'aguardando') return false;

  const agora = Date.now();
  const ultima = ultimaConferencia.get(pedidoId) ?? 0;
  if (agora - ultima < INTERVALO_MIN_CONFERENCIA) return false; // freio anti-abuso
  ultimaConferencia.set(pedidoId, agora);

  const token = await getTokenMP(pedido.loja_id);
  if (!token) return false;

  /*
   * Busca por `external_reference` (o id do pedido) porque no Checkout Pro o id
   * do pagamento só nasce depois que o cliente paga — antes disso não temos nada
   * pra consultar diretamente. É a mesma chave que o webhook usa pra reencontrar
   * o pedido, então os dois caminhos convergem no mesmo pagamento.
   */
  const resposta = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(String(pedidoId))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resposta.ok) return false;
  const dados = await resposta.json() as { results?: Array<{ id: number | string; status: string }> };
  const aprovado = (dados.results ?? []).find(p => p.status === 'approved');
  if (!aprovado) return false;

  // Mesmo caminho do webhook: idempotente, e avisa o lojista uma vez só.
  await processarWebhookMP(String(aprovado.id), pedido.loja_id);
  const depois = await db.prepare('SELECT pagamento_status FROM pedidos WHERE id = ?')
    .get(pedidoId) as { pagamento_status: string } | undefined;
  return depois?.pagamento_status === 'aprovado';
}

/**
 * Varre pedidos de CARTÃO presos em "aguardando" e confirma os que já foram pagos.
 *
 * POR QUE NÃO BASTA A CONFERÊNCIA NA TELA: `conferirCartaoAgora` só roda quando
 * alguém abre a página do pedido. Se o cliente pagar e fechar o navegador — ou
 * simplesmente não voltar — ninguém pergunta ao Mercado Pago, e o pedido pago
 * fica invisível pro lojista pra sempre. O resgate não pode depender de uma tela
 * estar aberta; é o mesmo raciocínio da reconciliação do Pix, que já existia.
 *
 * NÃO CANCELA NADA por conta própria, diferente da versão do Pix. Lá a cobrança
 * some do PSP e isso é estado terminal — dá pra afirmar "expirou". Aqui um
 * pedido sem pagamento nenhum é indistinguível de "o cliente ainda está com o
 * checkout aberto numa aba", e cancelar por baixo dele seria pior que deixar
 * pendente.
 */
export async function reconciliarCartoesMP(horasParaTras = 48): Promise<{ conferidos: number; confirmados: number }> {
  const limite = new Date(Date.now() - horasParaTras * 3600_000).toISOString();
  const pendentes = await db.prepare(
    `SELECT id, loja_id FROM pedidos
      WHERE forma_pagamento = 'cartao_online' AND pagamento_status = 'aguardando'
        AND criado_em >= ?
      ORDER BY id DESC LIMIT 200`
  ).all(limite) as Array<{ id: number; loja_id: number }>;
  if (pendentes.length === 0) return { conferidos: 0, confirmados: 0 };

  // Um token por loja, não por pedido: várias pendências da mesma loja são o
  // caso comum, e decifrar o mesmo segredo em looping é desperdício.
  const tokenPorLoja = new Map<number, string | null>();
  let confirmados = 0;

  for (const p of pendentes) {
    try {
      if (!tokenPorLoja.has(p.loja_id)) tokenPorLoja.set(p.loja_id, await getTokenMP(p.loja_id));
      const token = tokenPorLoja.get(p.loja_id);
      if (!token) continue;

      const r = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(String(p.id))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) continue;
      const dados = await r.json() as { results?: Array<{ id: number | string; status: string }> };
      const aprovado = (dados.results ?? []).find(x => x.status === 'approved');
      if (!aprovado) continue;

      // Mesmo caminho do webhook: idempotente, e avisa o lojista uma vez só.
      await processarWebhookMP(String(aprovado.id), p.loja_id);
      const depois = await db.prepare('SELECT pagamento_status FROM pedidos WHERE id = ?')
        .get(p.id) as { pagamento_status: string } | undefined;
      if (depois?.pagamento_status === 'aprovado') confirmados++;
    } catch (e) {
      console.error(`[mercadopago] reconciliação do pedido ${p.id} falhou:`, (e as Error).message);
    }
  }
  return { conferidos: pendentes.length, confirmados };
}

/**
 * Minutos que um pedido de cartão pode ficar "aguardando" antes de ser cancelado.
 *
 * 30 é folgado de propósito: cobre quem abriu o formulário, foi buscar o cartão
 * e voltou. Curto demais cancelaria pedido de cliente que está pagando.
 */
const MINUTOS_ABANDONO_CARTAO = 30;

/**
 * Cancela pedido de CARTÃO abandonado, devolvendo estoque e uso de cupom.
 *
 * POR QUE ISTO É NECESSÁRIO: o pedido nasce ANTES do pagamento, e no mesmo
 * instante já baixa estoque e queima um uso do cupom. Quem desiste no formulário
 * do cartão deixa isso preso pra sempre — a última unidade fica reservada pra um
 * pedido que não existe, e o próximo cliente vê "esgotado". Foram 20 pedidos
 * nessa situação numa única tarde de testes.
 *
 * O Pix já tinha equivalente (a cobrança expira no PSP e a reconciliação
 * cancela); o cartão não tinha prazo nenhum.
 *
 * SÓ CANCELA DEPOIS DE PERGUNTAR AO MERCADO PAGO. Cancelar por tempo, sozinho,
 * mataria o pedido de quem pagou e cuja confirmação estava só atrasada — que é
 * exatamente a falha que a reconciliação existe pra cobrir.
 */
export async function cancelarCartoesAbandonados(): Promise<{ cancelados: number }> {
  const limite = new Date(Date.now() - MINUTOS_ABANDONO_CARTAO * 60_000).toISOString();
  const velhos = await db.prepare(
    `SELECT id, loja_id FROM pedidos
      WHERE forma_pagamento = 'cartao_online' AND pagamento_status = 'aguardando'
        AND status = 'pendente' AND criado_em < ?
      ORDER BY id LIMIT 100`
  ).all(limite) as Array<{ id: number; loja_id: number }>;
  if (velhos.length === 0) return { cancelados: 0 };

  let cancelados = 0;
  for (const p of velhos) {
    try {
      // Última chance: se pagou e a notificação se perdeu, isto confirma em vez
      // de cancelar. Só segue pro cancelamento quem realmente não pagou.
      if (await conferirCartaoAgora(p.id)) continue;

      /*
       * DEVOLVE ANTES, CANCELA DEPOIS. Se a devolução falhar, o pedido continua
       * pendente e a próxima varredura tenta de novo — o contrário deixaria o
       * pedido cancelado com o estoque preso, que é o estado que ninguém vê.
       */
      await comTransacao(async (tx) => {
        const itens = await tx.prepare(
          'SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?'
        ).all(p.id) as Array<{ produto_id: number | null; quantidade: number }>;
        for (const it of itens) {
          if (!it.produto_id) continue;
          await tx.prepare(
            'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
          ).run(it.quantidade, it.produto_id);
        }
        const ped = await tx.prepare('SELECT cupom_codigo, loja_id FROM pedidos WHERE id = ?')
          .get(p.id) as { cupom_codigo: string; loja_id: number } | undefined;
        if (ped?.cupom_codigo) {
          await tx.prepare(
            'UPDATE cupons SET usos_count = GREATEST(usos_count - 1, 0) WHERE loja_id = ? AND codigo = ?'
          ).run(ped.loja_id, ped.cupom_codigo);
        }
        await tx.prepare("UPDATE pedidos SET pagamento_status = 'recusado' WHERE id = ?").run(p.id);
      });

      // Pela máquina de estados, como manda a casa: valida a transição, registra
      // na linha do tempo e notifica — nunca por UPDATE de status na mão.
      await transicionarStatus(p.id, 'cancelado', {
        camposExtras: { motivo_recusa: 'Pagamento com cartão não concluído.' },
      });
      cancelados++;
    } catch (e) {
      console.error(`[cartao] falha ao cancelar pedido abandonado ${p.id}:`, (e as Error).message);
    }
  }
  return { cancelados };
}

/**
 * Confere o pagamento online do pedido, seja qual for o gateway.
 *
 * Cada conferência sai fora sozinha quando o gateway não é o dela, então chamar
 * as duas é barato e evita que a tela precise saber por onde o pedido foi pago.
 */
export async function conferirPagamentoAgora(pedidoId: number): Promise<boolean> {
  return (await conferirPixAgora(pedidoId)) || (await conferirCartaoAgora(pedidoId));
}

/**
 * Webhook de Pix recebido da ONZ (cash-in), no padrão Bacen: o corpo traz
 * `{ pix: [{ txid, valor, endToEndId, ... }] }`.
 *
 * Autenticação: token secreto na URL (?tk=). O padrão Bacen prevê mTLS do PSP,
 * mas atrás de proxy/CDN o certificado do cliente não chega até aqui — o token
 * cumpre o papel de garantir que só a ONZ (que registrou a URL) consegue postar.
 *
 * `?t=` é só uma DICA do tenant provável (caminho rápido). Se o txid não estiver
 * lá, os outros tenants são varridos — assim a URL é registrada UMA VEZ e vale
 * pra todo cliente novo, sem voltar a mexer no servidor.
 */
router.post('/webhook/onz', async (req, res) => {
  res.status(200).json({ ok: true }); // responde rápido — o PSP não deve re-tentar por nossa lentidão
  try {
    const tk = typeof req.query.tk === 'string' ? req.query.tk : '';
    if (!tokenConfere(tk, process.env.ONZ_WEBHOOK_TOKEN || '')) return;

    const sugerido = typeof req.query.t === 'string' ? req.query.t : '';
    const lista = Array.isArray((req.body as { pix?: unknown[] })?.pix) ? (req.body as { pix: Array<Record<string, unknown>> }).pix : [];
    for (const p of lista) {
      const txid = String(p.txid || '');
      const valorCentavos = Math.round(Number(p.valor || 0) * 100);
      if (txid) await confirmarPixOnzEmQualquerTenant(txid, valorCentavos, sugerido);
    }
  } catch (e) {
    console.error('[onz] webhook falhou:', e);
  }
});

router.post('/webhook/mercadopago', async (req, res) => {
  try {
    // MP manda o id tanto no corpo quanto (em alguns formatos) na query
    // ?data.id=... — o manifest da assinatura é calculado sobre o valor da
    // QUERY quando presente (documentação do MP).
    const pagamentoId = (req.query['data.id'] as string | undefined) || (req.body && req.body.data && req.body.data.id);
    if (!pagamentoId) return res.status(200).json({ recebido: true });

    // SILO (um banco por tenant): a notification_url que gravamos no pagamento
    // traz ?t=<banco> do tenant dono do pedido. Sem isso, o webhook rodaria no
    // banco resolvido pelo Host (o domínio que o MP chamou) — que pode não ser
    // o do pedido, e a confirmação cairia no banco errado. Validamos `t` contra
    // o registro de tenants antes de trocar de contexto (nunca abrir banco
    // arbitrário a mando de quem chamou o webhook).
    const t = typeof req.query.t === 'string' ? req.query.t : '';
    const tenant = t ? await tenantPorDbNome(t) : undefined;
    // &loja=<id> na notification_url — ver `processarWebhookMP`.
    const lojaDica = Number(req.query.loja) || undefined;

    /*
     * A ASSINATURA SÓ PODE SER CONFERIDA DEPOIS DE ENTRAR NO TENANT: o segredo
     * mora na linha da loja, num dos bancos. Por isso a verificação acontece
     * aqui dentro, e não na porta de entrada como antes.
     *
     * `?loja=` vem da URL e portanto é controlada por quem chama — o que não
     * enfraquece nada: apontar pra outra loja só troca qual segredo é exigido,
     * e o conteúdo da notificação continua sendo ignorado (o status é sempre
     * reconsultado na API do MP dentro de `processarWebhookMP`).
     */
    const processar = async () => {
      const secret = await segredoWebhookDaLoja(lojaDica);
      if (!assinaturaMpValida(req, String(pagamentoId), secret)) {
        console.warn(`[mercadopago] webhook com assinatura inválida (loja ${lojaDica ?? '?'}), ignorado`);
        return; // 200 pro MP não ficar re-tentando; só não processa
      }
      await processarWebhookMP(String(pagamentoId), lojaDica);
    };

    if (tenant) await comTenant(tenant.db_nome, processar);
    else await processar();

    res.status(200).json({ recebido: true });
  } catch {
    res.status(200).json({ recebido: true });
  }
});

export default router;
