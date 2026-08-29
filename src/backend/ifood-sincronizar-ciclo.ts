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
import { planejarSincronizacao, planoVazio, type PlanoSincronizacao } from './ifood-sincronizar';
import { aplicarSincronizacao, type ResultadoSincronizacao } from './ifood-sincronizar-gravar';
import { depsSincronizacaoIfood, lerProdutosDaLoja } from './ifood-importar-deps';

export const NADA_A_FAZER: ResultadoSincronizacao = Object.freeze({
  criados: 0, atualizados: 0, gruposNovos: 0, opcoesNovas: 0,
  falhas: [], sumiramDoIfood: [], travadosSemPreco: [],
});

/**
 * O que um ciclo devolve quando NÃO há nada a gravar — ou `null` se há.
 *
 * Ciclo sem gravação normalmente é silêncio: com um log por hora por loja, o
 * que importa vira invisível.
 *
 * A EXCEÇÃO é `travadosSemPreco`, e ela custou um teste ao vivo para aparecer.
 * Um produto à venda no iFood e pausado aqui por não ter preço não gera
 * gravação nenhuma — o plano fica vazio — então o aviso MAIS acionável que a
 * sincronização tem era justamente o único que nunca saía. O lojista ficaria
 * esperando um produto entrar no ar sem nada dizer por quê.
 *
 * `sumiramDoIfood` fica fora desta exceção de propósito: aquilo nunca se
 * resolve sozinho (o produto fica aqui para sempre, por decisão), então
 * repetiria a mesma lista toda hora, para sempre. O aviso de preço some assim
 * que o lojista põe o preço — que é justamente a ação que ele pede.
 *
 * Separada da função que faz o ciclo para poder ser provada sem rede nem banco.
 */
export function resultadoDeCicloSemGravacao(
  plano: PlanoSincronizacao,
): ResultadoSincronizacao | null {
  if (!planoVazio(plano)) return null;
  if (plano.travadosSemPreco.length === 0) return NADA_A_FAZER;
  return { ...NADA_A_FAZER, falhas: [], sumiramDoIfood: [], travadosSemPreco: plano.travadosSemPreco };
}

export async function sincronizarLojaIfood(
  cred: CredenciaisIfood,
  merchantId: string,
  lojaId: number,
  categoriaPadrao = 'iFood',
): Promise<ResultadoSincronizacao> {
  const doIfood = await lerCardapioIfood(cred, merchantId);
  const plano = planejarSincronizacao(doIfood, await lerProdutosDaLoja(lojaId));

  const semGravacao = resultadoDeCicloSemGravacao(plano);
  if (semGravacao) return semGravacao;

  return aplicarSincronizacao(lojaId, plano, categoriaPadrao, depsSincronizacaoIfood());
}

/** Uma linha só, para o log do servidor e para o comando. */
export function resumoDoCiclo(r: ResultadoSincronizacao): string {
  return `${r.criados} novo(s), ${r.atualizados} atualizado(s), ` +
         `${r.gruposNovos} grupo(s), ${r.opcoesNovas} opção(ões)`;
}
