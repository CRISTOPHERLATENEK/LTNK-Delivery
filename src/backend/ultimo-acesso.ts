/**
 * QUANDO A PESSOA ENTROU PELA ÚLTIMA VEZ.
 *
 * Existe para uma pergunta que o suporte faz sempre e ninguém conseguia
 * responder: "esse lojista está usando o sistema?". Sem o dado, a única pista
 * era o último pedido — que diz se a LOJA vendeu, não se o dono entrou. Loja com
 * pedido pelo app e lojista que não abre o painel há dois meses é exatamente o
 * cliente que cancela sem avisar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GRAVADO NO LOGIN, NUNCA A CADA REQUISIÇÃO.
 *
 * A tentação é marcar em toda chamada autenticada, o que daria "visto há 30
 * segundos". Seria um UPDATE por requisição em `usuarios` — a tabela mais lida
 * do sistema — para uma informação que ninguém olha com essa precisão. A
 * pergunta real é "entrou esta semana?", e o login responde.
 * ─────────────────────────────────────────────────────────────────────────
 */
import db from './db-mysql';
import { agoraUTC } from './util';

/**
 * Marca o acesso. NUNCA lança: falhar aqui não pode impedir alguém de entrar —
 * seria trocar um dado de conveniência por um cliente sem acesso.
 */
export async function registrarAcesso(usuarioId: number): Promise<void> {
  try {
    await db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?')
      .run(agoraUTC(), usuarioId);
  } catch { /* melhor esforço */ }
}
