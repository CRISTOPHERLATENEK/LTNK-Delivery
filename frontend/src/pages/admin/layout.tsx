/**
 * Layout do painel admin — sidebar no desktop, drawer no mobile.
 * Substitui o AppLayout genérico em todas as páginas do admin.
 *
 * SEM ÍCONE NO MENU, de propósito. Quinze itens com quinze ícones viram uma
 * coluna de pictogramas que ninguém aprende: "Repasses" e "Assinaturas" não têm
 * desenho óbvio, e o olho acaba lendo o texto de qualquer jeito. O ícone só
 * ocupava a largura que o rótulo precisava para não truncar.
 */
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api, encerrarSessao, sessaoUsuario, ehSuperAdmin } from '@/lib/api';

interface NavItem {
  rota: string;
  label: string;
  somenteSuper?: boolean;
  /** Filete separando blocos de intenção — ver comentário em ITENS. */
  divisorDepois?: boolean;
}

/*
 * LISTA ÚNICA, não seis grupos.
 *
 * Metade dos grupos tinha UM item — 'Financeiro' com só Repasses, 'Operação'
 * separada de 'Pessoas' sem que a divisão ajudasse a achar nada. Títulos de
 * seção existem pra reduzir a busca; com um item cada, só empurram o menu pra
 * baixo e escondem o resto atrás de rolagem.
 *
 * A ordem é por FREQUÊNCIA DE USO, e os divisores separam blocos de intenção:
 * o dia a dia primeiro, cadastro no meio, configuração no fim.
 */
const ITENS: NavItem[] = [
  { rota: '/painel-admin',              label: 'Painel' },
  { rota: '/painel-admin/monitor',      label: 'Monitor', divisorDepois: true },

  { rota: '/painel-admin/pedidos',      label: 'Pedidos' },
  { rota: '/painel-admin/lojas',        label: 'Lojas' },
  { rota: '/painel-admin/entregadores', label: 'Entregadores' },
  { rota: '/painel-admin/banners',      label: 'Banners', divisorDepois: true },

  /*
   * 'Clientes' é o nome do tenant em TODO lugar agora. Antes a mesma coisa
   * aparecia como 'Tenants' no título e 'Bancos por loja' no menu — dois nomes
   * técnicos pra algo que, do ponto de vista do negócio, é o cliente que
   * contratou a plataforma.
   */
  { rota: '/painel-admin/clientes',     label: 'Clientes',    somenteSuper: true },
  { rota: '/painel-admin/assinaturas',  label: 'Assinaturas', somenteSuper: true },
  { rota: '/painel-admin/lojistas',     label: 'Lojistas',    somenteSuper: true },
  { rota: '/painel-admin/revendedores', label: 'Revendedores', somenteSuper: true, divisorDepois: true },

  { rota: '/painel-admin/repasses',      label: 'Repasses',      somenteSuper: true },
  { rota: '/painel-admin/marca',         label: 'Marca',         somenteSuper: true },
  { rota: '/painel-admin/marca/landing', label: 'Landing page',  somenteSuper: true },
  { rota: '/painel-admin/configuracoes', label: 'Configurações', somenteSuper: true },
  { rota: '/painel-admin/admins',        label: 'Admins',        somenteSuper: true },
  { rota: '/painel-admin/auditoria',     label: 'Auditoria',     somenteSuper: true },
];

export function AdminLayout({ children, titulo }: { children: ReactNode; titulo?: string }) {
  const [drawerAberto, setDrawerAberto] = useState(false);
  const superAdmin = ehSuperAdmin();
  const u = sessaoUsuario();

  const itens = ITENS.filter(i => !i.somenteSuper || superAdmin);

  /*
   * LOJAS AGUARDANDO APROVAÇÃO viram um contador âmbar no menu.
   *
   * É a única pendência do admin que trava um cliente do outro lado: enquanto
   * ninguém aprova, a loja não vende. Sem o aviso, só descobria quem abrisse a
   * tela de Lojas por acaso.
   *
   * NÚMERO e não ponto: "tem coisa parada" e "tem trinta coisas paradas" pedem
   * urgências diferentes, e o ponto contava a mesma história nos dois casos.
   */
  const pendentes = useQuery({
    queryKey: ['admin-lojas-pendentes'],
    queryFn: () => api<{ lojas: { status_aprovacao: string }[] }>('GET', '/api/admin/lojas')
      .then(r => r.lojas.filter(l => l.status_aprovacao === 'pendente').length),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  /*
   * SOLICITAÇÕES PENDENTES — mesma lógica das lojas: é pendência que trava
   * alguém do outro lado. O revendedor pediu um cliente e está esperando; sem
   * aviso, a fila só aparece pra quem abrir a tela por acaso.
   */
  const solicPendentes = useQuery({
    queryKey: ['admin-solicitacoes-pendentes'],
    enabled: superAdmin,
    queryFn: () => api<{ solicitacoes: { status: string }[] }>('GET', '/api/admin/solicitacoes')
      .then(r => r.solicitacoes.filter(s => s.status === 'pendente').length),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  function sair() {
    encerrarSessao();
    window.location.href = '/painel-admin';
  }

  const conteudoSidebar = (
    <SidebarContent
      itens={itens}
      pendentesLojas={pendentes.data ?? 0}
      pendentesSolic={solicPendentes.data ?? 0}
      superAdmin={superAdmin}
      u={u}
      onSair={sair}
      aoNavegar={() => setDrawerAberto(false)}
    />
  );

  return (
    <div className="adm flex min-h-screen">
      {/* ── SIDEBAR DESKTOP ── */}
      <aside
        className="hidden md:flex md:flex-col shrink-0"
        style={{ width: 196, background: 'var(--adm-fundo2)', borderRight: '1px solid var(--adm-linha)' }}
      >
        {conteudoSidebar}
      </aside>

      {/* ── DRAWER MOBILE ── */}
      {drawerAberto && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/25" onClick={() => setDrawerAberto(false)} />
          <aside
            className="adm relative flex w-[220px] max-w-[80vw] flex-col"
            style={{ background: 'var(--adm-fundo2)', borderRight: '1px solid var(--adm-linha)' }}
          >
            {conteudoSidebar}
          </aside>
        </div>
      )}

      {/* ── ÁREA DE CONTEÚDO ── */}
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: '#fff' }}>
        {/* Header SÓ no mobile: no desktop a sidebar já diz onde a pessoa está,
            e a barra de breadcrumb repetia o título logo acima dele. */}
        <header
          className="flex h-12 shrink-0 items-center gap-3 px-4 md:hidden"
          style={{ borderBottom: '1px solid var(--adm-linha)' }}
        >
          <button
            onClick={() => setDrawerAberto(true)}
            aria-label="Abrir menu"
            className="px-1 text-[13px] font-medium"
          >
            Menu
          </button>
          <span className="text-[13.5px] font-semibold">{titulo ?? 'Admin'}</span>
        </header>

        <main className="min-w-0 flex-1 overflow-auto px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ itens, pendentesLojas, pendentesSolic, superAdmin, u, onSair, aoNavegar }: {
  itens: NavItem[];
  pendentesLojas: number;
  pendentesSolic: number;
  superAdmin: boolean;
  u: ReturnType<typeof sessaoUsuario>;
  onSair: () => void;
  aoNavegar: () => void;
}) {
  const contagemDe = (rota: string) =>
    rota === '/painel-admin/lojas' ? pendentesLojas
      : rota === '/painel-admin/revendedores' ? pendentesSolic
        : 0;

  return (
    <>
      <div className="px-3 py-4" style={{ borderBottom: '1px solid var(--adm-linha)' }}>
        <div className="text-[13px] font-semibold leading-tight">Painel Admin</div>
        <div className="text-[11px]" style={{ color: 'var(--adm-rotulo)' }}>
          {superAdmin ? 'Super admin' : 'Operacional'}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {itens.map(item => {
          const n = contagemDe(item.rota);
          return (
            <div key={item.rota}>
              <NavLink
                to={item.rota}
                onClick={aoNavegar}
                // `end` no Painel (senão TUDO fica ativo) e em Marca, que é
                // prefixo de /marca/landing — sem isso os dois acendiam juntos.
                end={item.rota === '/painel-admin' || item.rota === '/painel-admin/marca'}
                className={({ isActive }) => cn(
                  'flex items-center gap-2 px-2.5 py-[7px] text-[13px]',
                  isActive ? 'font-semibold' : 'font-normal',
                )}
                style={({ isActive }) => ({
                  /* Sem transition: `background` recebe o valor dinâmico, e
                     transition nela deixava o item ativo pintado no anterior. */
                  background: isActive ? 'var(--adm-ativo)' : 'transparent',
                  color: isActive ? 'var(--adm-fg)' : 'var(--adm-fg2)',
                  borderRadius: 4,
                })}
              >
                <span className="flex-1 truncate">{item.label}</span>
                {n > 0 && (
                  <span
                    className="adm-num text-[11px]"
                    style={{ color: 'var(--adm-pendencia)' }}
                    title={`${n} aguardando`}
                  >
                    {n}
                  </span>
                )}
              </NavLink>
              {item.divisorDepois && (
                <div className="my-1.5" style={{ borderTop: '1px solid var(--adm-linha2)' }} />
              )}
            </div>
          );
        })}
      </nav>

      {/* MINHA CONTA no rodapé: trocar a PRÓPRIA senha não é administrar os
          outros, e misturar as duas coisas fazia o admin procurar a própria
          conta numa tela de gerenciar terceiros. */}
      <div className="px-2 py-2" style={{ borderTop: '1px solid var(--adm-linha)' }}>
        <NavLink
          to="/painel-admin/minha-conta"
          onClick={aoNavegar}
          className="flex items-center gap-2 px-1.5 py-1.5"
          style={({ isActive }) => ({
            background: isActive ? 'var(--adm-ativo)' : 'transparent',
            borderRadius: 4,
          })}
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center text-[11px] font-semibold"
            style={{ background: 'var(--adm-ativo)', borderRadius: 4, color: 'var(--adm-fg)' }}
          >
            {u?.nome?.charAt(0).toUpperCase() ?? 'A'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{u?.nome ?? 'Admin'}</span>
            <span className="block truncate text-[11px]" style={{ color: 'var(--adm-rotulo)' }}>
              {superAdmin ? 'Super admin' : 'Operacional'}
            </span>
          </span>
        </NavLink>
        <button
          onClick={onSair}
          className="mt-0.5 w-full px-2.5 py-1.5 text-left text-[12.5px]"
          style={{ color: 'var(--adm-rotulo)', borderRadius: 4 }}
        >
          Sair
        </button>
      </div>
    </>
  );
}
