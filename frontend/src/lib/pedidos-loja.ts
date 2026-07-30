/**
 * Fonte única dos pedidos ativos do lojista.
 *
 * Antes, três pontos (dashboard, lista de pedidos e o badge da navegação)
 * faziam GET /api/lojista/pedidos cada um com seu próprio timer. Aqui todos
 * compartilham a MESMA query do React Query (mesma chave) — uma só requisição
 * e um só intervalo de atualização, sem piscadas nem carga duplicada.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Pedido, ItemPedido } from '@/types';

export type PedidoComItens = Pedido & { itens: ItemPedido[] };

/** Status que contam como "pedido em andamento" (aparecem no painel ativo). */
export const STATUS_ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

/** Chave canônica — qualquer componente que usar este hook divide a mesma query. */
export const CHAVE_PEDIDOS_ATIVOS = ['pedidos-loja-ativos'] as const;

export const INTERVALO_MS = 4000;

interface Opcoes {
  enabled?: boolean;
  /**
   * Só quem passa `true` mantém o timer de atualização. Ver a explicação longa
   * abaixo — resumo: `refetchInterval` é POR OBSERVADOR.
   */
  conduzPolling?: boolean;
}

/**
 * Lê os pedidos ativos da loja. Por padrão apenas ACOMPANHA o cache: o React
 * Query avisa todos os observadores da mesma chave quando o dado muda, então
 * quem só exibe não precisa buscar nada.
 *
 * POR QUE `conduzPolling` EXISTE: `refetchInterval` não pertence à query, ele
 * pertence a CADA OBSERVADOR. Com o intervalo fixo dentro deste hook, todo
 * componente que o chamava criava o seu próprio timer de 4s — dois montados ao
 * mesmo tempo (o layout do painel + a tela de Dashboard ou de Pedidos) viravam
 * dois timers defasados pelo instante da montagem, ou seja o DOBRO de
 * requisições, cada uma trazendo os pedidos com todos os itens. O arquivo foi
 * criado pra acabar com exatamente esse problema e o reintroduzia sem querer.
 *
 * O condutor é o layout do painel do lojista (pages/lojista/painel.tsx), que
 * fica montado enquanto a área do lojista existe — ele envolve o <Routes>, e
 * sem sessão de lojista nem chega a renderizar as rotas.
 */
export function usePedidosLojaAtivos(opcoes?: Opcoes) {
  return useQuery({
    queryKey: CHAVE_PEDIDOS_ATIVOS,
    queryFn: () =>
      api<{ pedidos: PedidoComItens[] }>('GET', '/api/lojista/pedidos').then(r => r.pedidos),
    refetchInterval: opcoes?.conduzPolling ? INTERVALO_MS : false,
    enabled: opcoes?.enabled ?? true,
  });
}
