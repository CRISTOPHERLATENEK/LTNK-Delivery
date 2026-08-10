/**
 * Roteamento principal — cliente como app principal; outros perfis em rotas
 * dedicadas (lojista, entregador, admin).
 */
import { useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Home, ShoppingBag, Receipt, User } from 'lucide-react';
import { AppLayout, NavBadge } from '@/components/app-layout';
import { useCarrinho, totalItensCarrinho } from '@/lib/carrinho';
import { rotaInicioCliente, corLojaAtual } from '@/lib/loja-atual';
import { useTema } from '@/lib/tema';
// Área do CLIENTE fica no bundle principal: é a rota que todo visitante abre
// (cardápio, carrinho, checkout) — atrasá-la com um chunk extra só pioraria.
import { PaginaVitrine } from '@/pages/cliente/vitrine';
import { PaginaDemo } from '@/pages/cliente/demo';
import { PaginaLoja } from '@/pages/cliente/loja';
import { PaginaCarrinho } from '@/pages/cliente/carrinho';
import { PaginaPedidos } from '@/pages/cliente/pedidos';
import { PaginaPedido } from '@/pages/cliente/pedido';
import { PaginaConta } from '@/pages/cliente/conta';
import { EsqueciSenha, RedefinirSenha } from '@/pages/esqueci-senha';
import { Guard } from '@/components/guards';
import { lazySeguro } from '@/lib/lazy-seguro';
import { AvisoOffline } from '@/components/aviso-offline';

/**
 * Painéis internos (lojista, entregador, cozinha, admin) entram por lazy: são
 * usados por uma minoria de sessões, mas somavam ~1 MB baixado por TODO
 * visitante do cardápio. Com import() o chunk só desce quando alguém abre a
 * rota — o cliente final passa a baixar apenas o app dele.
 */
const PainelLojista = lazySeguro(() => import('@/pages/lojista/painel').then(m => ({ default: m.PainelLojista })));
const TelaEntregador = lazySeguro(() => import('@/pages/entregador').then(m => ({ default: m.TelaEntregador })));
const PainelCozinha = lazySeguro(() => import('@/pages/cozinha/painel').then(m => ({ default: m.PainelCozinha })));
const TelaAdmin = lazySeguro(() => import('@/pages/admin').then(m => ({ default: m.TelaAdmin })));
const TelaMarca = lazySeguro(() => import('@/pages/admin/marca').then(m => ({ default: m.TelaMarca })));
const TelaLanding = lazySeguro(() => import('@/pages/admin/marca/landing').then(m => ({ default: m.TelaLanding })));
const TelaConfiguracoes = lazySeguro(() => import('@/pages/admin/configuracoes').then(m => ({ default: m.TelaConfiguracoes })));
const TelaAdmins = lazySeguro(() => import('@/pages/admin/admins').then(m => ({ default: m.TelaAdmins })));
const TelaLojistas = lazySeguro(() => import('@/pages/admin/lojistas').then(m => ({ default: m.TelaLojistas })));
const TelaLojas = lazySeguro(() => import('@/pages/admin/lojas').then(m => ({ default: m.TelaLojas })));
const TelaPedidosAdmin = lazySeguro(() => import('@/pages/admin/pedidos-admin').then(m => ({ default: m.TelaPedidosAdmin })));
const TelaBanners = lazySeguro(() => import('@/pages/admin/banners').then(m => ({ default: m.TelaBanners })));
const TelaRepasses = lazySeguro(() => import('@/pages/admin/repasses').then(m => ({ default: m.TelaRepasses })));
const TelaMonitor = lazySeguro(() => import('@/pages/admin/monitor').then(m => ({ default: m.TelaMonitor })));
const TelaEntregadores = lazySeguro(() => import('@/pages/admin/entregadores').then(m => ({ default: m.TelaEntregadores })));
const TelaTenants = lazySeguro(() => import('@/pages/admin/tenants').then(m => ({ default: m.TelaTenants })));
const TelaAssinaturas = lazySeguro(() => import('@/pages/admin/assinaturas').then(m => ({ default: m.TelaAssinaturas })));
const TelaAuditoria = lazySeguro(() => import('@/pages/admin/auditoria').then(m => ({ default: m.TelaAuditoria })));
const TelaMinhaConta = lazySeguro(() => import('@/pages/admin/minha-conta').then(m => ({ default: m.TelaMinhaConta })));

/** Fallback enquanto o chunk do painel baixa. */
function CarregandoPainel() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/*
 * BANNER FLUTUANTE DE PEDIDO ATIVO — REMOVIDO.
 *
 * Ele ficava fixo no rodapé com 'Aguardando a loja' e um link pro pedido. Só se
 * escondia na própria tela do pedido, então aparecia POR CIMA do checkout — na
 * hora de digitar o cartão, que é o pior momento possível pra tapar a tela.
 *
 * E o caminho que ele oferecia já existe duas vezes: depois de pagar, o app leva
 * sozinho pro acompanhamento, e a aba 'Pedidos' está sempre ali na barra de
 * baixo. Era um terceiro atalho pro mesmo lugar, cobrindo conteúdo e consultando
 * /api/cliente/pedidos a cada 8 segundos em toda navegação do cliente.
 */
// Páginas que não sabem a cor da loja em si (não buscam a loja pra isso) —
// reaplicam a última cor vista em loja.tsx/pedido.tsx em vez de cair na cor
// padrão da plataforma. loja.tsx e pedido.tsx já cuidam da própria cor com
// dado fresco da API, então ficam de fora daqui.
const ROTAS_SEM_COR_PROPRIA = ['/carrinho', '/pedidos', '/conta'];

export function ClienteLayout({ children }: { children: React.ReactNode }) {
  const carrinho = useCarrinho();
  const total = totalItensCarrinho(carrinho);
  const { marca, aplicarCorPrimaria, resetarCorPrimaria } = useTema();
  const location = useLocation();

  // `marca` nas dependências: o tema da PLATAFORMA (/api/tema) carrega em
  // paralelo e, se resolver DEPOIS (comum num F5 direto nessas páginas),
  // sobrescreve --primary de volta pro padrão — reincluir `marca` faz esse
  // efeito rodar de novo e reaplicar a cor da loja (mesmo motivo documentado
  // em loja.tsx/pedido.tsx).
  useEffect(() => {
    if (!ROTAS_SEM_COR_PROPRIA.includes(location.pathname)) return;
    const cor = corLojaAtual();
    if (!cor) return;
    aplicarCorPrimaria(cor.cor, cor.corSecundaria);
    return () => { resetarCorPrimaria(); };
  }, [location.pathname, aplicarCorPrimaria, resetarCorPrimaria, marca]);

  const itens = [
    { rota: rotaInicioCliente(marca.loja_id || undefined), icone: Home, rotulo: 'Início', fim: true },
    { rota: '/carrinho', icone: ShoppingBag, rotulo: 'Carrinho', badge: <NavBadge valor={total} /> },
    { rota: '/pedidos', icone: Receipt, rotulo: 'Pedidos' },
    { rota: '/conta', icone: User, rotulo: 'Conta' },
  ];
  return (
    <>
      <AppLayout itens={itens}>{children}</AppLayout>
    </>
  );
}

/**
 * O painel admin só existe no domínio master da plataforma — domínio de
 * loja/demo (mesmo com uma conta 'admin' válida naquele tenant) não deve
 * nem mostrar a tela de login dele.
 */
function SoDominioMaster() {
  const { marca } = useTema();
  if (!marca.eh_master) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  useEffect(() => {
    // Título inicial — o TemaProvider sobrescreve com a marca configurada
    document.title = 'Delivery Já';
  }, []);

  return (
    // Suspense cobre as rotas lazy (painéis internos). As rotas do cliente são
    // estáticas e não passam por aqui — renderizam sem fallback nenhum.
    <Suspense fallback={<CarregandoPainel />}>
    {/* Fora do <Routes>: vale em TODAS as áreas (cliente, lojista, KDS,
        entregador, admin). Ficar sem rede é igualmente ruim em qualquer uma
        delas, e duplicar o aviso por área garantiria esquecer alguma. */}
    <AvisoOffline />
    <Routes>
      {/* Sem ClienteLayout: "/" tanto pode ser a landing do produto (sem nav de
          compras — carrinho/pedidos não fazem sentido numa página de marketing)
          quanto um redirect pra /:id (que aí sim usa o layout de compras). */}
      <Route path="/" element={<PaginaVitrine />} />
      <Route path="/demo/:slug" element={<PaginaDemo />} />
      <Route path="/:id" element={<ClienteLayout><PaginaLoja /></ClienteLayout>} />
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

      {/* Admin — só existe no domínio master (ver SoDominioMaster); cada
          página já tem seu próprio AdminLayout com sidebar. */}
      <Route element={<SoDominioMaster />}>
        <Route path="/painel-admin/marca"    element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaMarca /></Guard>} />
        <Route path="/painel-admin/marca/landing" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaLanding /></Guard>} />
        <Route path="/painel-admin/configuracoes" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaConfiguracoes /></Guard>} />
        <Route path="/painel-admin/admins"   element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaAdmins /></Guard>} />
        <Route path="/painel-admin/clientes" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaTenants /></Guard>} />
        <Route path="/painel-admin/assinaturas" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaAssinaturas /></Guard>} />
        <Route path="/painel-admin/lojistas" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaLojistas /></Guard>} />
        <Route path="/painel-admin/lojas"    element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaLojas /></Guard>} />
        <Route path="/painel-admin/monitor"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaMonitor /></Guard>} />
        <Route path="/painel-admin/entregadores" element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaEntregadores /></Guard>} />
        <Route path="/painel-admin/pedidos"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaPedidosAdmin /></Guard>} />
        <Route path="/painel-admin/banners"  element={<Guard perfis={['admin']} redirectTo="/painel-admin"><TelaBanners /></Guard>} />
        <Route path="/painel-admin/repasses" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaRepasses /></Guard>} />
        {/* Minha conta vale pra QUALQUER admin, não só super: trocar a própria
            senha e resetar o próprio 2FA não é privilégio administrativo. */}
        <Route path="/painel-admin/minha-conta" element={<Guard perfis={['admin']}><TelaMinhaConta /></Guard>} />
        <Route path="/painel-admin/auditoria" element={<Guard perfis={['admin']} exigeSuperAdmin redirectTo="/painel-admin"><TelaAuditoria /></Guard>} />

        {/* Admin — TelaAdmin gerencia seu próprio login */}
        <Route path="/painel-admin/*" element={<TelaAdmin />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
