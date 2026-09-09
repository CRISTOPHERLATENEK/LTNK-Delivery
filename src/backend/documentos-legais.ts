/**
 * OS DOCUMENTOS LEGAIS DA PLATAFORMA — versão e endereço.
 *
 * Antes disto, `termos_url` e `politica_url` eram campos de texto vazios no
 * admin, e vazio significava LINK NENHUM: a tela do cliente escondia a frase de
 * aceite de propósito, porque "você aceita os termos" sem ter termos para ler é
 * pior que silêncio. O efeito era a plataforma rodando sem cumprir o dever de
 * informar do art. 9º da LGPD, e o aceite gravado em `termos_aceitos_em`
 * apontando para uma versão vazia — aceite de nada.
 *
 * Agora os dois documentos VIAJAM COM O CÓDIGO, servidos pelo próprio app em
 * `/termos` e `/privacidade`. O campo do admin continua existindo e continua
 * ganhando: quem hospeda o documento em outro lugar (jurídico próprio, site
 * institucional) põe a URL lá e ela substitui a interna. O que muda é o padrão
 * — de "nada" para "o documento que a gente publica".
 *
 * A VERSÃO É DATA E MORA AQUI, junto do texto que ela nomeia. Se ela fosse só a
 * configuração do admin, mudar o texto sem lembrar de mudar o campo faria todo
 * mundo aparecer como tendo aceito a versão anterior — e ninguém descobriria,
 * porque as duas metades parecem certas sozinhas. Ao editar as páginas em
 * `frontend/src/pages/legal.tsx`, mude esta data no mesmo commit.
 */

/** Versão publicada dos documentos. Formato ISO curto, é o que vai no aceite. */
export const VERSAO_DOCUMENTOS = '2026-09-09';

/** Onde o próprio app serve cada documento, quando o admin não aponta pra fora. */
export const CAMINHO_TERMOS = '/termos';
export const CAMINHO_POLITICA = '/privacidade';

/**
 * O endereço a divulgar: o configurado, se houver, senão o interno.
 *
 * Recebe o valor já lido da configuração em vez de ler daqui: esta função é
 * usada nas rotas pública e do admin, e cada uma lê do banco do seu tenant.
 */
export function enderecoDoDocumento(configurado: string | null | undefined, interno: string): string {
  const v = String(configurado ?? '').trim();
  return v || interno;
}
