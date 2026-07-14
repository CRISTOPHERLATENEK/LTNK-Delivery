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
import db from './db';
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
export async function notificarPedidoWhatsApp(pedidoId: number): Promise<void> {
  try {
    const pedido = db.prepare(
      `SELECT p.id, p.total_centavos, p.loja_id, c.nome AS cliente_nome, c.telefone AS cliente_telefone
         FROM pedidos p JOIN usuarios c ON c.id = p.cliente_id
        WHERE p.id = ?`
    ).get(pedidoId) as { id: number; total_centavos: number; loja_id: number; cliente_nome: string; cliente_telefone: string } | undefined;
    if (!pedido || !pedido.cliente_telefone) return;

    const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(pedido.loja_id) as any;
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
      const texto = `Olá, ${pedido.cliente_nome}! Seu pedido #${pedido.id} de ${brl(pedido.total_centavos)} foi recebido pela ${loja.nome}. Acompanhe o status pelo app.`;
      const r = await enviarTextoNaoOficial(pedido.cliente_telefone, texto);
      if (!r.ok) console.warn(`[WhatsApp] Falha ao notificar pedido #${pedido.id} (loja ${pedido.loja_id}): ${r.erro}`);
    }
  } catch (e) {
    console.warn('[WhatsApp] Erro inesperado ao notificar pedido:', e);
  }
}
