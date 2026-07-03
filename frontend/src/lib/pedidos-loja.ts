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

export function usePedidosLojaAtivos(opcoes?: { enabled?: boolean }) {
  return useQuery({
    queryKey: CHAVE_PEDIDOS_ATIVOS,
    queryFn: () =>
      api<{ pedidos: PedidoComItens[] }>('GET', '/api/lojista/pedidos').then(r => r.pedidos),
    refetchInterval: 4000,
    enabled: opcoes?.enabled ?? true,
  });
}
