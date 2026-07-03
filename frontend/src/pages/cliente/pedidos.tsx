/**
 * Histórico de pedidos do cliente com "pedir de novo" e atalho de acompanhamento.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt, RotateCcw, Eye } from 'lucide-react';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { adicionarAoCarrinho } from '@/lib/carrinho';
import type { Pedido, Loja } from '@/types';

export function PaginaPedidos() {
  const usuario = sessaoUsuario();
  const navigate = useNavigate();
  const { mostrar } = useToast();

  const consulta = useQuery({
    queryKey: ['meus-pedidos'],
    queryFn: () => api<{ pedidos: Pedido[] }>('GET', '/api/cliente/pedidos').then(r => r.pedidos),
    enabled: !!usuario,
  });

  if (!usuario) {
    return (
      <Vazio
        icone={<Receipt className="size-9 text-primary" />}
        titulo="Veja seus pedidos"
        texto="Entre na sua conta para acompanhar seu histórico."
        botao={<Button asChild size="lg"><Link to="/conta">Entrar</Link></Button>}
      />
    );
  }

  if (consulta.isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  }

  if (consulta.data && consulta.data.length === 0) {
    return (
      <Vazio
        icone={<Receipt className="size-9 text-primary" />}
        titulo="Nenhum pedido ainda"
        texto="Quando você fizer seu primeiro pedido, ele vai aparecer aqui."
        botao={<Button asChild size="lg"><Link to="/">Ver lojas</Link></Button>}
      />
    );
  }

  async function pedirDeNovo(pedidoId: number) {
    try {
      type Repetir = { loja_id: number; itens: any[]; indisponiveis: string[] };
      const dados = await api<Repetir>('GET', `/api/cliente/pedidos/${pedidoId}/repetir`);
      if (dados.itens.length === 0) {
        mostrar({ tipo: 'erro', titulo: 'Nada disponível', descricao: 'Nenhum item desse pedido está no cardápio hoje.' });
        return;
      }
      const { loja } = await api<{ loja: Loja }>('GET', `/api/lojas/${dados.loja_id}`);
      let ok = true;
      for (const item of dados.itens) {
        ok = ok && adicionarAoCarrinho(loja, {
          produto_id: item.produto_id,
          nome: item.nome,
          preco_centavos: item.preco_centavos,
          quantidade: item.quantidade,
          opcoes: item.opcoes || [],
          opcoes_texto: item.opcoes_texto || '',
        });
        if (!ok) return;
      }
      if (dados.indisponiveis.length) {
        mostrar({ tipo: 'info', titulo: 'Alguns itens ficaram de fora', descricao: dados.indisponiveis.join(', ') });
      }
      navigate('/carrinho');
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold px-1">Meus pedidos</h2>
      {consulta.data?.map(p => (
        <Card key={p.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold">#{p.id} · {p.loja_nome}</div>
                <div className="text-xs text-muted-foreground">{dataLocal(p.criado_em)}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <div className="text-sm font-bold mt-2">{brl(p.total_centavos)}</div>
            <div className="flex gap-2 mt-3">
              <Button asChild variant="outline" size="sm">
                <Link to={`/pedido/${p.id}`}>
                  <Eye className="size-4" />
                  Acompanhar
                </Link>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => pedirDeNovo(p.id)}>
                <RotateCcw className="size-4" />
                Pedir de novo
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function Vazio({
  icone, titulo, texto, botao,
}: { icone: React.ReactNode; titulo: string; texto: string; botao?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 space-y-4">
      <div className="size-20 rounded-full bg-accent flex items-center justify-center">{icone}</div>
      <h2 className="text-xl font-bold">{titulo}</h2>
      <p className="text-muted-foreground max-w-sm">{texto}</p>
      {botao}
    </div>
  );
}
