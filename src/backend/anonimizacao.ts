/**
 * Anonimização de conta de cliente — o "excluir minha conta" da LGPD.
 *
 * NÃO APAGA A LINHA, substitui o que identifica a pessoa. Apagar de verdade
 * levaria os pedidos com ela (há chave estrangeira de `pedidos.cliente_id` para
 * `usuarios.id`), e pedido é documento fiscal: some da escrituração, do
 * faturamento do lojista e da nota emitida. A LGPD pede que o dado pessoal
 * deixe de existir, não que a venda seja negada — e o art. 16 guarda a exceção
 * expressa para cumprimento de obrigação legal.
 *
 * O que sobra é a venda sem dono: valor, itens, data. O que vai embora é quem
 * comprou, onde mora e como falar com a pessoa.
 */

/** Domínio reservado pela RFC 2606 — nunca resolve, nunca entrega e-mail. */
const DOMINIO_MORTO = 'anonimizado.invalid';

export interface DadosAnonimos {
  nome: string;
  email: string;
  /** Vazio, não nulo: a coluna gerada `telefone_unico` usa NULLIF(telefone, ''). */
  telefone: string;
  cpf: string;
}

/**
 * E-mail que substitui o real.
 *
 * Carrega o id porque `usuarios.email` é UNIQUE: um valor fixo como
 * "removido@..." funcionaria na primeira conta e explodiria na segunda, e o
 * erro apareceria como "não foi possível excluir" sem dizer por quê.
 */
export function emailAnonimo(id: number): string {
  return `removido-${Math.trunc(id)}@${DOMINIO_MORTO}`;
}

/** Reconhece uma conta já anonimizada — o pedido é idempotente. */
export function ehAnonimizado(email: string | null | undefined): boolean {
  return String(email ?? '').toLowerCase().endsWith(`@${DOMINIO_MORTO}`);
}

/**
 * Os valores que entram no lugar dos reais.
 *
 * `telefone` e `cpf` vão VAZIOS e não nulos porque as duas colunas têm índice
 * único sobre `NULLIF(coluna, '')`: vazio vira NULL no índice, e vários NULL
 * convivem. Deixar o dado antigo ali seria anonimizar só pela metade — o
 * telefone identifica a pessoa tão bem quanto o nome.
 */
export function dadosAnonimos(id: number): DadosAnonimos {
  return {
    nome: 'Cliente removido',
    email: emailAnonimo(id),
    telefone: '',
    cpf: '',
  };
}

/** Texto que substitui endereço de entrega gravado no pedido. */
export const ENDERECO_ANONIMO = 'Endereço removido a pedido do cliente';

/** Texto que substitui comentário de avaliação e mensagem de chat. */
export const TEXTO_ANONIMO = '[removido a pedido do cliente]';
