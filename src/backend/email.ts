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
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transportador: Transporter | null = null;
let avisado = false;

export function emailHabilitado(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function obterTransportador(): Transporter | null {
  if (!emailHabilitado()) {
    if (!avisado) {
      console.warn('[EMAIL] SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS) — envio de e-mails desativado.');
      avisado = true;
    }
    return null;
  }
  if (!transportador) {
    transportador = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transportador;
}

/** Envia um e-mail. Nunca lança — best-effort, retorna se conseguiu enviar. */
export async function enviarEmail(destino: string, assunto: string, html: string): Promise<boolean> {
  const t = obterTransportador();
  if (!t) return false;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || `"Delivery" <${process.env.SMTP_USER}>`,
      to: destino,
      subject: assunto,
      html,
    });
    return true;
  } catch (e) {
    console.error('[EMAIL] Falha ao enviar:', (e as Error).message);
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
