/**
 * Envio de mensagens de WhatsApp via API oficial da Meta (Cloud API).
 * Cada loja usa suas PRÓPRIAS credenciais (phone_number_id + token),
 * obtidas pelo lojista no Business Manager da Meta — nós só disparamos.
 *
 * Mensagens business-initiated (fora da janela de 24h de atendimento) só
 * podem usar um TEMPLATE previamente aprovado pela Meta — texto livre não
 * funciona aqui. O nome do template e a ordem das variáveis são responsa-
 * bilidade do lojista (ele cria o template lá na Meta); aqui só preenchemos
 * os valores na ordem combinada.
 */
import { descriptografar } from './cripto';
import db from './db-mysql';
import { enviarTextoNaoOficial } from './whatsapp-nao-oficial';

const brl = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

const API_BASE = 'https://graph.facebook.com/v20.0';

export interface CredenciaisWhatsAppOficial {
  phoneNumberId: string;
  tokenCriptografado: string;
  templateNome: string;
}

/** Normaliza telefone BR pro formato E.164 sem "+" que a Meta espera (ex.: 5511999999999). */
export function telefoneParaWhatsApp(digitos: string): string | null {
  const d = digitos.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}

interface ResultadoEnvio { ok: boolean; erro?: string; }

/**
 * Envia a mensagem de confirmação de pedido via template. `parametros` são
 * as variáveis do template na ordem em que o lojista as definiu na Meta
 * (normalmente: [nome do cliente, número do pedido, valor total]).
 */
export async function enviarTemplateOficial(
  cred: CredenciaisWhatsAppOficial,
  telefoneDestino: string,
  parametros: string[],
): Promise<ResultadoEnvio> {
  if (!cred.phoneNumberId || !cred.tokenCriptografado) {
    return { ok: false, erro: 'WhatsApp oficial não configurado nesta loja.' };
  }
  const destino = telefoneParaWhatsApp(telefoneDestino);
  if (!destino) return { ok: false, erro: 'Telefone do cliente inválido.' };

  let token: string;
  try { token = descriptografar(cred.tokenCriptografado); }
  catch { return { ok: false, erro: 'Token do WhatsApp inválido ou corrompido — reconfigure na loja.' }; }

  try {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 10000);
    const resp = await fetch(`${API_BASE}/${cred.phoneNumberId}/messages`, {
      method: 'POST',
      signal: controlador.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'template',
        template: {
          name: cred.templateNome || 'confirmacao_pedido',
          language: { code: 'pt_BR' },
          components: parametros.length ? [{
            type: 'body',
            parameters: parametros.map(texto => ({ type: 'text', text: texto })),
          }] : undefined,
        },
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      const msg = corpo?.error?.message || `Falha ao enviar (HTTP ${resp.status}).`;
      return { ok: false, erro: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha de rede ao enviar WhatsApp.' };
  }
}

/** Testa as credenciais fazendo uma chamada leve (consulta o próprio número). */
export async function testarCredenciaisOficial(phoneNumberId: string, tokenCriptografado: string): Promise<ResultadoEnvio> {
  if (!phoneNumberId || !tokenCriptografado) return { ok: false, erro: 'Preencha phone_number_id e token.' };
  let token: string;
  try { token = descriptografar(tokenCriptografado); }
  catch { return { ok: false, erro: 'Token inválido.' }; }
  try {
    const resp = await fetch(`${API_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      return { ok: false, erro: corpo?.error?.message || `Credenciais inválidas (HTTP ${resp.status}).` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha de rede.' };
  }
}

/**
 * Ponto único chamado pelo fluxo de pedido: manda a confirmação por
 * WhatsApp SE a loja tiver o envio automático ligado e um método
 * configurado. Nunca lança — é best-effort, igual ao push/e-mail: uma
 * falha aqui não pode derrubar a criação do pedido, que já aconteceu.
 * Suporta os dois métodos: 'oficial' (template aprovado na Meta) e
 * 'nao_oficial' (texto livre via sessão WBAPI/QR — sem restrição de janela
 * de 24h porque não passa pela Meta).
 */
const ROTULO_PAGAMENTO: Record<string, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_entrega: 'Cartão na entrega',
  cartao_online: 'Cartão (pago online)',
};

/**
 * Confirmação do pedido no WhatsApp.
 *
 * O QUE MUDOU E POR QUÊ: a mensagem antiga listava só `1x Pizza Gigante` e o
 * total. Some com os quatro sabores, a borda e o refrigerante — que é
 * exatamente o que o cliente confere numa pizzaria. O dado já estava no banco
 * (`itens_pedido.opcoes_texto`); a consulta é que não buscava.
 *
 * O ENDEREÇO também entra, e não é enfeite: é lendo essa mensagem que a pessoa
 * percebe que digitou o número errado, enquanto ainda dá tempo de avisar.
 *
 * Só vale pro método NÃO-OFICIAL (texto livre). O oficial passa por template
 * aprovado na Meta, que não aceita corpo variável desse tamanho.
 */
async function montarTextoConfirmacao(pedido: {
  id: number; cliente_nome: string; total_centavos: number; forma_pagamento: string;
}, lojaNome: string, baseUrl: string): Promise<string> {
  const itens = await db.prepare(
    'SELECT nome_produto, quantidade, preco_unit_centavos, opcoes_texto FROM itens_pedido WHERE pedido_id = ? ORDER BY id'
  ).all(pedido.id) as {
    nome_produto: string; quantidade: number; preco_unit_centavos: number; opcoes_texto: string | null;
  }[];

  /*
   * COLUNAS QUALIFICADAS (`p.` / `l.`) — não é preciosismo: `taxa_entrega_centavos`
   * existe nas DUAS tabelas, e sem o prefixo o MySQL recusa a query inteira por
   * ambiguidade. Como esta consulta monta a confirmação de todo pedido, o erro
   * derrubaria o WhatsApp da loja inteira.
   */
  const extra = await db.prepare(
    `SELECT p.subtotal_centavos, p.taxa_entrega_centavos, p.desconto_centavos, p.cupom_codigo,
            p.troco_para_centavos, p.observacoes, p.endereco_entrega, p.tipo_entrega, l.tempo_estimado_min
       FROM pedidos p JOIN lojas l ON l.id = p.loja_id WHERE p.id = ?`
  ).get(pedido.id) as {
    subtotal_centavos: number; taxa_entrega_centavos: number; desconto_centavos: number;
    cupom_codigo: string; troco_para_centavos: number | null; observacoes: string;
    endereco_entrega: string; tipo_entrega?: string; tempo_estimado_min: number;
  } | undefined;

  const linhas: string[] = [
    `Olá, ${pedido.cliente_nome}! Seu pedido *#${pedido.id}* na *${lojaNome}* foi confirmado. 🎉`,
    '',
    '*SEU PEDIDO*',
  ];

  for (const i of itens) {
    linhas.push(`${i.quantidade}x ${i.nome_produto} — ${brl(i.preco_unit_centavos * i.quantidade)}`);
    /*
     * As opções entram INDENTADAS, uma por linha. Num combo de pizza são os
     * quatro sabores, a borda e o refrigerante — a parte que o cliente lê pra
     * conferir se pediu certo. Numa linha só, viram um borrão.
     */
    if (i.opcoes_texto) {
      for (const op of i.opcoes_texto.split('·').map(t => t.trim()).filter(Boolean)) {
        linhas.push(`   • ${op}`);
      }
    }
  }

  if (extra?.observacoes) {
    linhas.push('', `*Observação:* ${extra.observacoes}`);
  }

  linhas.push('', '- - - - - - - - - - - - - - -');
  if (extra) {
    linhas.push(`Subtotal: ${brl(extra.subtotal_centavos)}`);
    if (extra.desconto_centavos > 0) {
      linhas.push(`Desconto${extra.cupom_codigo ? ` (${extra.cupom_codigo})` : ''}: -${brl(extra.desconto_centavos)}`);
    }
    linhas.push(`Entrega: ${extra.taxa_entrega_centavos === 0 ? 'Grátis' : brl(extra.taxa_entrega_centavos)}`);
  }
  linhas.push(`*TOTAL: ${brl(pedido.total_centavos)}*`);

  const pagamento = ROTULO_PAGAMENTO[pedido.forma_pagamento] || pedido.forma_pagamento;
  linhas.push('', `*Pagamento:* ${pagamento}`);
  // Troco só faz sentido em dinheiro, e é a informação que o entregador precisa
  // levar separada — dizer aqui evita a ligação de "tem troco pra quanto?".
  if (pedido.forma_pagamento === 'dinheiro' && extra?.troco_para_centavos) {
    linhas.push(`Troco para ${brl(extra.troco_para_centavos)}`);
  }

  if (extra?.endereco_entrega) {
    // RETIRADA precisa gritar aqui. Sob o título "ENTREGA", o cliente lê o
    // endereço da loja como se fosse o destino e fica esperando em casa.
    linhas.push('', extra.tipo_entrega === 'retirada' ? '*RETIRADA NO LOCAL*' : '*ENTREGA*', extra.endereco_entrega);
    if (extra.tempo_estimado_min) linhas.push(`Tempo estimado: ~${extra.tempo_estimado_min} min`);
  }

  const link = `${baseUrl.replace(/\/+$/, '')}/pedido/${pedido.id}`;
  linhas.push('', `Acompanhe em tempo real: ${link}`);
  return linhas.join('\n');
}

/**
 * Avisa o cliente numa troca de status (saiu para entrega, entregue).
 *
 * POR QUE EXISTE: até aqui o WhatsApp mandava só a confirmação e sumia. O
 * cliente ficava sem notícia justamente na parte em que fica ansioso — entre
 * "confirmado" e a comida na porta. O push cobre quem tem o app aberto; o
 * WhatsApp alcança quem fechou.
 *
 * Best-effort de propósito: falha aqui não pode derrubar a transição de status
 * do pedido, que é o que realmente importa.
 */
export async function avisarStatusWhatsApp(pedidoId: number, status: string, baseUrl: string): Promise<void> {
  const MENSAGENS: Record<string, (nome: string) => string> = {
    em_entrega: n => `🛵 Seu pedido saiu para entrega, ${n}! Já já chega aí.`,
    entregue: n => `✅ Pedido entregue, ${n}. Obrigado pela preferência! 😄`,
    pronto: n => `📦 Seu pedido está pronto, ${n}!`,
    /*
     * "Estou chegando" não é status do pedido — é o entregador apertando o botão
     * quando dobra a esquina. É a mensagem mais útil da lista: é ela que faz o
     * cliente descer, achar a chave, prender o cachorro. Até aqui ia só por
     * push, que só alcança quem tem o app instalado e com notificação ligada.
     */
    chegando: n => `🛵 O entregador está chegando, ${n}! Fique atento.`,
  };
  const montar = MENSAGENS[status];
  if (!montar) return;

  try {
    const pedido = await db.prepare(
      `SELECT p.id, p.loja_id, c.nome AS cliente_nome, c.telefone AS cliente_telefone
         FROM pedidos p JOIN usuarios c ON c.id = p.cliente_id
        WHERE p.id = ?`
    ).get(pedidoId) as { id: number; loja_id: number; cliente_nome: string; cliente_telefone: string } | undefined;
    if (!pedido?.cliente_telefone) return;

    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(pedido.loja_id) as any;
    // Mesma chave de consentimento da confirmação: quem desligou o aviso de
    // pedido não passa a receber aviso de status pela porta dos fundos.
    if (!loja?.whatsapp_enviar_confirmacao) return;
    /*
     * SÓ NO MÉTODO NÃO-OFICIAL. O oficial exige template aprovado na Meta por
     * tipo de mensagem, e mandar texto livre fora da janela de 24h seria
     * recusado — ou pior, marcaria o número como spam.
     */
    if (loja.whatsapp_metodo_ativo !== 'nao_oficial') return;

    const primeiroNome = String(pedido.cliente_nome || '').trim().split(/\s+/)[0] || 'tudo bem';
    // Sem domínio configurado a mensagem vai igual, só sem o link — "saiu para
    // entrega" é útil por si só, e calar por falta de link seria trocar um aviso
    // incompleto por nenhum.
    const link = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/pedido/${pedido.id}` : '';
    const texto = link
      ? `${montar(primeiroNome)}\n\nAcompanhe: ${link}`
      : montar(primeiroNome);
    const r = await enviarTextoNaoOficial(pedido.cliente_telefone, texto);
    if (!r.ok) console.warn(`[WhatsApp] Falha ao avisar status ${status} do pedido #${pedido.id}: ${r.erro}`);
  } catch (e) {
    console.warn('[WhatsApp] Erro inesperado ao avisar status:', e);
  }
}

export async function notificarPedidoWhatsApp(pedidoId: number, baseUrl: string): Promise<void> {
  try {
    const pedido = await db.prepare(
      `SELECT p.id, p.total_centavos, p.loja_id, p.forma_pagamento, c.nome AS cliente_nome, c.telefone AS cliente_telefone
         FROM pedidos p JOIN usuarios c ON c.id = p.cliente_id
        WHERE p.id = ?`
    ).get(pedidoId) as { id: number; total_centavos: number; loja_id: number; forma_pagamento: string; cliente_nome: string; cliente_telefone: string } | undefined;
    if (!pedido || !pedido.cliente_telefone) return;

    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(pedido.loja_id) as any;
    if (!loja || !loja.whatsapp_enviar_confirmacao) return;

    if (loja.whatsapp_metodo_ativo === 'oficial') {
      const r = await enviarTemplateOficial(
        {
          phoneNumberId: loja.whatsapp_oficial_phone_id || '',
          tokenCriptografado: loja.whatsapp_oficial_token || '',
          templateNome: loja.whatsapp_oficial_template || 'confirmacao_pedido',
        },
        pedido.cliente_telefone,
        [pedido.cliente_nome, `#${pedido.id}`, brl(pedido.total_centavos)],
      );
      if (!r.ok) console.warn(`[WhatsApp] Falha ao notificar pedido #${pedido.id} (loja ${pedido.loja_id}): ${r.erro}`);
    } else if (loja.whatsapp_metodo_ativo === 'nao_oficial') {
      const texto = await montarTextoConfirmacao(pedido, loja.nome, baseUrl);
      const r = await enviarTextoNaoOficial(pedido.cliente_telefone, texto);
      if (!r.ok) console.warn(`[WhatsApp] Falha ao notificar pedido #${pedido.id} (loja ${pedido.loja_id}): ${r.erro}`);
    }
  } catch (e) {
    console.warn('[WhatsApp] Erro inesperado ao notificar pedido:', e);
  }
}
