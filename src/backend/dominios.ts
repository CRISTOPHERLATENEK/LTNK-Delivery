/**
 * "Que loja é este domínio?" — fonte ÚNICA da resposta.
 *
 * POR QUE EXISTE: essa decisão precisa ser idêntica em todo lugar que a faz. O
 * `/api/tema` resolvia por conta própria e o Open Graph (og.ts) nasceu com uma
 * regra diferente e incompleta — resultado: o cartão do link no WhatsApp podia
 * dizer uma coisa e a página abrir com a marca de outra. Regra duplicada é regra
 * que diverge no próximo domínio cadastrado.
 *
 * A regra: domínio próprio da loja VENCE o "loja única" global do admin. Assim
 * pizzariadapaula.com.br mostra a pizzaria, enquanto o domínio principal da
 * plataforma continua mostrando o marketplace inteiro. Vale pros domínios de
 * hoje e pros que forem cadastrados depois, sem tocar em código: quem decide é
 * a coluna `dominio_personalizado` da loja.
 */
import db from './db-mysql';

/**
 * Normaliza o Host do request pro formato em que o domínio é GRAVADO
 * (rotas/lojista.ts e rotas/admin.ts salvam sem protocolo, sem www, minúsculo).
 * Sem normalizar igual, `www.loja.com` e `Loja.com:443` nunca casariam com
 * `loja.com` no banco — e o lojista veria o white-label falhar sem motivo
 * aparente.
 */
export function normalizarHost(host: string | undefined): string {
  return (host || '').split(':')[0].toLowerCase().replace(/^www\./, '');
}

/** Config simples (tabela configuracoes) do tenant atual. */
async function valorConfig(chave: string, padrao = ''): Promise<string> {
  const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return r?.valor ?? padrao;
}

/**
 * Id da loja que este Host representa, ou 0 quando o domínio é da plataforma
 * (marketplace com várias lojas). Roda dentro do contexto de tenant já resolvido.
 */
export async function lojaIdDoHost(host: string | undefined): Promise<number> {
  let lojaId = Number(await valorConfig('loja_padrao_id', '0')) || 0;
  const h = normalizarHost(host);
  if (h) {
    const porDominio = await db.prepare(
      "SELECT id FROM lojas WHERE dominio_personalizado = ? AND status_aprovacao = 'aprovada'"
    ).get(h) as { id: number } | undefined;
    if (porDominio) lojaId = porDominio.id;
  }
  return lojaId;
}
