/**
 * O QUE UMA SESSÃO DE CONVIDADO ALCANÇA.
 *
 * Convidado é quem fecha o pedido só com nome e WhatsApp, sem criar conta (ver
 * POST /auth/convidado). O pedido precisa de `cliente_id`, então uma conta é
 * criada de verdade — e como o telefone é único no banco, um número que já
 * pediu antes REUSA a conta existente, com endereço e histórico dela.
 *
 * É aí que mora o risco, e é o que este arquivo fecha: sem limite, qualquer
 * pessoa que digitasse o número de outra abriria a conta dela e veria onde ela
 * mora. Num app de entrega, endereço de casa.
 *
 * A REGRA É LISTA DE PERMISSÃO, não de proibição — e isso é deliberado. Lista
 * de proibição erra em silêncio: alguém acrescenta uma rota nova, esquece de
 * proibir, e ela nasce aberta para convidado. Lista de permissão erra ao
 * contrário: a rota nova nasce FECHADA, alguém tenta usar, recebe um erro
 * claro, e a decisão de liberar passa por uma pessoa.
 *
 * O QUE O CONVIDADO PODE, em uma frase: montar e fechar UM pedido, e cuidar
 * daquele pedido. Nada de histórico, nada de endereços salvos, nada de perfil.
 */

/** Regra: método HTTP + o caminho (relativo a /api/cliente). */
interface Regra {
  metodos: string[];
  /** Caminho exato, ou o padrão com `:id` no lugar do id do pedido. */
  caminho: string;
}

/**
 * O que vale ANTES de existir pedido — a sessão nasce assim, para poder criar.
 *
 * `POST /enderecos` está aqui e `GET /enderecos` NÃO: criar o endereço da
 * entrega é necessário; listar os que já estão salvos é justamente o que não
 * pode. Convidado que já pediu antes digita o endereço de novo — é o preço de
 * não pedir senha, e é um preço que ele paga sabendo.
 */
const ANTES_DO_PEDIDO: Regra[] = [
  { metodos: ['POST'], caminho: '/carrinho/conferir' },
  { metodos: ['POST'], caminho: '/cupons/validar' },
  { metodos: ['POST'], caminho: '/frete' },
  { metodos: ['POST'], caminho: '/enderecos' },
  { metodos: ['POST'], caminho: '/pedidos' },
];

/**
 * O que vale DEPOIS, e só para o pedido que a sessão criou.
 *
 * Pagar, conferir o pagamento, acompanhar, conversar com a loja, cancelar e
 * avaliar. É a vida de um pedido — e é o que a pessoa esperaria poder fazer
 * sem ter criado conta.
 */
const DO_PROPRIO_PEDIDO: Regra[] = [
  { metodos: ['GET'], caminho: '/pedidos/:id' },
  { metodos: ['POST'], caminho: '/pedidos/:id/pagar-cartao' },
  { metodos: ['POST'], caminho: '/pedidos/:id/conferir-pagamento' },
  { metodos: ['POST'], caminho: '/pedidos/:id/conferir-pix' },
  { metodos: ['POST'], caminho: '/pedidos/:id/cancelar' },
  { metodos: ['GET', 'POST'], caminho: '/pedidos/:id/mensagens' },
  { metodos: ['POST'], caminho: '/pedidos/:id/avaliar' },
  { metodos: ['POST'], caminho: '/pedidos/:id/avaliar-entregador' },
];

/** Normaliza para comparar: sem barra no fim, sem query. */
function limpar(caminho: string): string {
  const semQuery = caminho.split('?')[0];
  return semQuery.length > 1 ? semQuery.replace(/\/+$/, '') : semQuery;
}

/**
 * A SESSÃO DE CONVIDADO PODE CHAMAR ISTO?
 *
 * `pedidoDaSessao` é o único pedido que ela alcança — nulo enquanto ela ainda
 * não criou nenhum.
 *
 * Devolve o MOTIVO quando não pode, porque "403" sozinho manda a pessoa
 * procurar defeito onde não tem: ela precisa saber que a saída é criar conta ou
 * entrar, não tentar de novo.
 */
export function convidadoPodeAlcancar(
  metodo: string,
  caminho: string,
  pedidoDaSessao: number | null,
): { pode: true } | { pode: false; motivo: string } {
  const m = (metodo || '').toUpperCase();
  const c = limpar(caminho || '');

  for (const r of ANTES_DO_PEDIDO) {
    if (r.caminho === c && r.metodos.includes(m)) {
      /*
       * CRIAR PEDIDO SÓ UMA VEZ POR SESSÃO. Sem isto, a mesma sessão de
       * convidado continuaria criando pedido depois de já ter um — e cada
       * pedido novo ficaria fora do alcance dela (o token aponta para o
       * primeiro), então ela criaria pedidos que não consegue acompanhar.
       */
      if (c === '/pedidos' && pedidoDaSessao !== null) {
        return { pode: false, motivo: 'Este pedido já foi enviado. Comece um novo pedido para pedir de novo.' };
      }
      return { pode: true };
    }
  }

  for (const r of DO_PROPRIO_PEDIDO) {
    const molde = r.caminho.replace(':id', String(pedidoDaSessao ?? 0));
    if (pedidoDaSessao !== null && molde === c && r.metodos.includes(m)) {
      return { pode: true };
    }
    /*
     * MESMO CAMINHO, OUTRO PEDIDO: a mensagem diz que é de outro pedido, não
     * que a rota não existe. É a diferença entre "você não pode isso" e "você
     * está no lugar errado".
     */
    const outroPedido = new RegExp(`^${r.caminho.replace(':id', '\\d+')}$`);
    if (outroPedido.test(c) && r.metodos.includes(m)) {
      return { pode: false, motivo: 'Esse pedido não é deste acompanhamento. Entre na sua conta para ver seus pedidos.' };
    }
  }

  return {
    pode: false,
    motivo: 'Para isso é preciso ter uma conta. Crie uma senha para guardar seus endereços e ver seus pedidos.',
  };
}
