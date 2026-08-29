/**
 * UM CICLO DE SINCRONIZAÇÃO DE UMA LOJA.
 *
 * Existe para o laço do servidor e o comando manual passarem pelo MESMO
 * caminho. Com duas orquestrações, o "sincronizar agora" do suporte provaria
 * uma coisa e o ciclo automático faria outra — e a diferença só apareceria na
 * loja de alguém.
 *
 * Não conhece tenant nem `setInterval`: quem chama já resolveu em qual banco
 * está. Assim dá para rodar um ciclo isolado, de comando, sem subir servidor.
 */
import type { CredenciaisIfood } from './ifood-cliente';
import { lerCardapioIfood } from './ifood-catalogo';
import { planejarSincronizacao, planoVazio } from './ifood-sincronizar';
import { aplicarSincronizacao, type ResultadoSincronizacao } from './ifood-sincronizar-gravar';
import { depsSincronizacaoIfood, lerProdutosDaLoja } from './ifood-importar-deps';

export const NADA_A_FAZER: ResultadoSincronizacao = Object.freeze({
  criados: 0, atualizados: 0, gruposNovos: 0, opcoesNovas: 0,
  falhas: [], sumiramDoIfood: [], travadosSemPreco: [],
});

export async function sincronizarLojaIfood(
  cred: CredenciaisIfood,
  merchantId: string,
  lojaId: number,
  categoriaPadrao = 'iFood',
): Promise<ResultadoSincronizacao> {
  const doIfood = await lerCardapioIfood(cred, merchantId);
  const plano = planejarSincronizacao(doIfood, await lerProdutosDaLoja(lojaId));

  /*
   * Plano vazio devolve o resultado zerado E as listas de relatório zeradas:
   * quem chama usa isso para não escrever log de ciclo que não fez nada. Com um
   * log por hora por loja, o que importa vira invisível.
   */
  if (planoVazio(plano)) return NADA_A_FAZER;

  return aplicarSincronizacao(lojaId, plano, categoriaPadrao, depsSincronizacaoIfood());
}

/** Uma linha só, para o log do servidor e para o comando. */
export function resumoDoCiclo(r: ResultadoSincronizacao): string {
  return `${r.criados} novo(s), ${r.atualizados} atualizado(s), ` +
         `${r.gruposNovos} grupo(s), ${r.opcoesNovas} opção(ões)`;
}
