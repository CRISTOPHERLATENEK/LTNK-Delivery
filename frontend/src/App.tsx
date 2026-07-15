/**
 * Roteamento principal — cliente como app principal; outros perfis em rotas
 * dedicadas (lojista, entregador, admin).
 */
import { useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, ShoppingBag, Receipt, User, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout, NavBadge } from '@/components/app-layout';
import { useCarrinho, totalItensCarrinho } from '@/lib/carrinho';
import { api, sessaoUsuario } from '@/lib/api';
import { PaginaVitrine } from '@/pages/cliente/vitrine';
import { PaginaLoja } from '@/pages/cliente/loja';
import { PaginaCarrinho } from '@/pages/cliente/carrinho';
import { PaginaPedidos } from '@/pages/cliente/pedidos';
import { PaginaPedido } from '@/pages/cliente/pedido';
import { PaginaConta } from '@/pages/cliente/conta';
import { PainelLojista } from '@/pages/lojista/painel';
import { TelaEntregador } from '@/pages/entregador';
import { PainelCozinha } from '@/pages/cozinha/painel';
import { TelaAdmin } from '@/pages/admin';
import { TelaMarca } from '@/pages/admin/marca';
import { TelaAdmins } from '@/pages/admin/admins';
import { TelaLojistas } from '@/pages/admin/lojistas';
import { TelaLojas } from '@/pages/admin/lojas';
import { TelaPedidosAdmin } from '@/pages/admin/pedidos-admin';
import { TelaBanners } from '@/pages/admin/banners';
import { TelaRepasses } from '@/pages/admin/repasses';
import { TelaMonitor } from '@/pages/admin/monitor';
import { TelaEntregadores } from '@/pages/admin/entregadores';
import { TelaTenants } from '@/pages/admin/tenants';
import { TelaAuditoria } from '@/pages/admin/auditoria';
import { EsqueciSenha, RedefinirSenha } from '@/pages/esqueci-senha';
import { Guard } from '@/components/guards';

const STATUS_ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];
const STATUS_EMOJI: Record<string, string> = {
  pendente: '⏳', aceito: '✅', preparando: '👨‍🍳', pronto: '📦', em_entrega: '🛵',
};
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Aguardando a loja', aceito: 'Pedido aceito!', preparando: 'Sendo preparado…',
  pronto: 'Pronto para entrega', em_entrega: 'Saiu para entrega! 🛵',
};

function BannerPedidoAtivo() {
  const usuario = sessaoUsuario();
  const location = useLocation();

  const consulta = useQuery({
    queryKey: ['pedidos-ativos-banner'],
    queryFn: () => api<{ pedidos: { id: number; status: string; loja_nome: string }[] }>(
      'GET', '/api/cliente/pedidos'
    ).then(r => r.pedidos),
    enabled: !!usuario,
    refetchInterval: 8000,
  });

  const ativo = consulta.data?.find(p => STATUS_ATIVOS.includes(p.status));
  if (!ativo || location.pathname === `/pedido/${ativo.id}`) return null;

  return (
    <Link
      to={`/pedido/${ativo.id}`}
      className="lg:hidden fixed bottom-[72px] inset-x-3 z-40 flex items-center gap-3 rounded-2xl bg-primary px-4 py-3 shadow-lg shadow-primary/30 text-primary-foreground"
    >
      <span className="text-xl shrink-0">{STATUS_EMOJI[ativo.status] ?? '📋'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold opacity-80 truncate">{ativo.loja_nome}</div>
        <div className="text-sm font-extrabold truncate">{STATUS_LABEL[ativo.status] ?? 'Pedido em andamento'}</div>
      </div>
      <ChevronRight className="size-5 shrink-0 opacity-80" />
    </Link>
  );
}

function ClienteLayout({ children }: { children: React.ReactNode }) {
  const carrinho = useCarrinho();
  const total = totalItensCarrinho(carrinho);
  const itens = [
    { rota: '/', icone: Home, rotulo: 'Início' },
    { rota: '/carrinho', icone: ShoppingBag, rotulo: 'Carrinho', badge: <NavBadge valor={total} /> },
    { rota: '/pedidos', icone: Receipt, rotulo: 'Pedidos' },
    { rota: '/conta', icone: User, rotulo: 'Conta' },
  ];
  return (
    <>
      <AppLayout itens={itens}>{children}</AppLayout>
      <BannerPedidoAtivo />
    </>
  );
}

export default function App() {
  useEffect(() => {
    // Título inicial — o TemaProvider sobrescreve com a marca configurada
    document.title = 'Delivery Já';
  }, []);

  return (
    <Routes>
      {/* Sem ClienteLayout: "/" tanto pode ser a landing do produto (sem nav de
          compras — carrinho/pedidos não fazem sentido numa página de marketing)
          quanto um redirect pra /loja/:id (que aí sim usa o layout de compras). */}
      <Route path="/" element={<PaginaVitrine />} />
      <Route path="/loja/:id" element={<ClienteLayout><PaginaLoja /></ClienteLayout>} />
      <Route path="/carrinho" element={<ClienteLayout><PaginaCarrinho /></ClienteLayout>} />
      <Route path="/pedidos" element={<ClienteLayout><PaginaPedidos /></ClienteLayout>} />
      <Route path="/pedido/:id" element={<ClienteLayout><PaginaPedido /></ClienteLayout>} />
      <Route path="/conta" element={<ClienteLayout><PaginaConta /></ClienteLayout>} />

      {/* Recuperação de senha — independente de área, usada pelas 4 telas de login */}
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />

      {/* Lojista — PainelLojista gerencia seu próprio login */}
      <Route path="/lojista/*" element={<PainelLojista />} />

      {/* Entregador — TelaEntregador gerencia seu próprio login (padrão lojista) */}
      <Route path="/entregador/*" element={<TelaEntregador />} />

      {/* Cozinha (KDS) — login próprio, vinculado a uma loja */}
      <Route path="/cozinha/*" element={<PainelCozinha />} />

      {/* Admin — cada página já tem seu próprio AdminLayout com sidebar */}
      <Route path="/painel-admin/marca"    element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaMarca /></Guard>} />
      <Route path="/painel-admin/admins"   element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaAdmins /></Guard>} />
      <Route path="/painel-admin/clientes" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaTenants /></Guard>} />
      <Route path="/painel-admin/lojistas" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaLojistas /></Guard>} />
      <Route path="/painel-admin/lojas"    element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaLojas /></Guard>} />
      <Route path="/painel-admin/monitor"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaMonitor /></Guard>} />
      <Route path="/painel-admin/entregadores" element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaEntregadores /></Guard>} />
      <Route path="/painel-admin/pedidos"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaPedidosAdmin /></Guard>} />
      <Route path="/painel-admin/banners"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaBanners /></Guard>} />
      <Route path="/painel-admin/repasses" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaRepasses /></Guard>} />
      <Route path="/painel-admin/auditoria" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaAuditoria /></Guard>} />

      {/* Admin — TelaAdmin gerencia seu próprio login */}
      <Route path="/painel-admin/*" element={<TelaAdmin />} />
    </Routes>
  );
}
