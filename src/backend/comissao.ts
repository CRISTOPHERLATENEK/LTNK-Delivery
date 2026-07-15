/**
 * Comissão da plataforma — fonte única.
 * Cada loja pode ter uma comissão própria (lojas.comissao_percentual). Quando
 * for NULL, vale a comissão global definida em configuracoes.
 */
import db from './db-mysql';

export async function comissaoPercentualDaLoja(lojaId: number): Promise<number> {
  const loja = await db.prepare('SELECT comissao_percentual FROM lojas WHERE id = ?')
    .get(lojaId) as { comissao_percentual: number | null } | undefined;
  if (loja && loja.comissao_percentual != null) return loja.comissao_percentual;

  const global = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'comissao_percentual'")
    .get() as { valor: string } | undefined;
  return global ? Number(global.valor) : 10;
}
