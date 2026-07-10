/**
 * Envio de e-mail transacional (recuperação de senha, por enquanto) via SMTP
 * genérico — funciona com qualquer provedor (Gmail, Hostinger, Brevo, Resend,
 * SES...). Configurado por variáveis de ambiente; se não configurado, os
 * envios falham de forma controlada (log + retorno false), sem derrubar o
 * servidor — mesmo padrão defensivo usado no push.ts para o VAPID.
 *
 * Variáveis de ambiente:
 *   SMTP_HOST, SMTP_PORT (padrão 587), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM (padrão: "Delivery" <SMTP_USER>), SMTP_SECURE ('1' = TLS direto)
 *   SMTP_TLS_INSECURE ('1' = não valida o certificado do servidor SMTP —
 *     só pra hospedagem compartilhada com certificado genérico que não bate
 *     com o hostname configurado; deixa a conexão vulnerável a MITM, então
 *     é opt-in, nunca o padrão)
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transportador: Transporter | null = null;
let avisado = false;

export function emailHabilitado(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function obterTransportador(): Promise<Transporter | null> {
  if (!emailHabilitado()) {
    if (!avisado) {
      console.warn('[EMAIL] SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS) — envio de e-mails desativado.');
      avisado = true;
    }
    return null;
  }
  if (!transportador) {
    console.log('[EMAIL] Configurando SMTP:', {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1',
      user: process.env.SMTP_USER,
      tlsInsecure: process.env.SMTP_TLS_INSECURE === '1',
    });
    transportador = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
      tls: { rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== '1' },
    });
    try {
      await transportador.verify();
      console.log('[EMAIL] ✅ Conexão SMTP verificada com sucesso.');
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      console.error('[EMAIL] ❌ Falha ao verificar conexão SMTP:', err.message, '| code:', err.code, '| syscall:', err.syscall);
      // Não desiste aqui — o verify() pode falhar por um motivo diferente do
      // envio de verdade (alguns servidores recusam o comando de teste mas
      // aceitam SEND normal); a tentativa real acontece em enviarEmail().
    }
  }
  return transportador;
}

/** Envia um e-mail. Nunca lança — best-effort, retorna se conseguiu enviar. */
export async function enviarEmail(destino: string, assunto: string, html: string): Promise<boolean> {
  const t = await obterTransportador();
  if (!t) return false;
  try {
    console.log('[EMAIL] Enviando para:', destino);
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || `"Delivery" <${process.env.SMTP_USER}>`,
      to: destino,
      subject: assunto,
      html,
    });
    console.log('[EMAIL] ✅ Enviado. messageId:', info.messageId, '| response:', info.response);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.error('[EMAIL] ❌ Falha ao enviar:', {
      message: err.message, code: err.code, errno: err.errno,
      syscall: err.syscall, hostname: (err as any).hostname,
      command: (err as any).command, response: (err as any).response,
      responseCode: (err as any).responseCode,
    });
    // Descarta o transportador cacheado — se a conexão morreu (timeout, DNS,
    // etc.), a próxima chamada cria uma nova do zero em vez de reusar uma
    // conexão quebrada indefinidamente.
    transportador = null;
    return false;
  }
}

/** E-mail de redefinição de senha. */
export function emailRedefinirSenha(nome: string, linkReset: string): { assunto: string; html: string } {
  return {
    assunto: 'Redefinir sua senha',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a;">Redefinir senha</h2>
        <p>Olá, ${nome}!</p>
        <p>Recebemos um pedido para redefinir sua senha. Clique no botão abaixo para escolher uma nova:</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${linkReset}" style="background: #dc2640; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Redefinir minha senha</a>
        </p>
        <p style="color: #666; font-size: 13px;">Esse link expira em 30 minutos. Se você não pediu essa redefinição, pode ignorar este e-mail — sua senha continua a mesma.</p>
      </div>
    `,
  };
}
