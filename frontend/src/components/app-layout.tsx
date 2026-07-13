import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, ShoppingBag, Receipt, User, LogOut, Bike } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { sessaoUsuario, encerrarSessao } from '@/lib/api';
import { useTema } from '@/lib/tema';
import type { ReactNode } from 'react';

interface ItemNav {
  rota: string;
  icone: typeof Home;
  rotulo: string;
  badge?: ReactNode;
  /** Marca como ativo só na rota exata (não nas sub-rotas). */
  fim?: boolean;
}

interface Props {
  children: ReactNode;
  /** Itens da navegação inferior. Se omitido, usa o padrão do cliente. */
  itens?: ItemNav[];
  /** Título no header. */
  titulo?: string;
  /** Subtítulo no header (ex.: "Olá, Carlos"). */
  subtitulo?: string;
}

const ITENS_CLIENTE: ItemNav[] = [
  { rota: '/', icone: Home, rotulo: 'Início' },
  { rota: '/carrinho', icone: ShoppingBag, rotulo: 'Carrinho' },
  { rota: '/pedidos', icone: Receipt, rotulo: 'Pedidos' },
  { rota: '/conta', icone: User, rotulo: 'Conta' },
];

export function AppLayout({ children, itens, titulo, subtitulo }: Props) {
  const usuario = sessaoUsuario();
  const itensNav = itens || ITENS_CLIENTE;
  const location = useLocation();
  const { marca } = useTema();
  const nomeMarca = titulo || marca.nome;
  // Raiz da área atual — o logo e o logout permanecem dentro da área
  // (entregador, lojista, admin), em vez de sempre jogar para o cardápio.
  const raiz = location.pathname.startsWith('/lojista') ? '/lojista'
    : location.pathname.startsWith('/entregador') ? '/entregador'
    : location.pathname.startsWith('/painel-admin') ? '/painel-admin'
    : '/';

  const sair = () => { encerrarSessao(); window.location.href = raiz; };

  const Logo = (
    <Link to={raiz} className="flex items-center gap-2.5 group min-w-0">
      {marca.logo_url ? (
        <img
          src={marca.logo_url}
          alt={nomeMarca}
          className="size-10 rounded-2xl object-cover shadow-sm group-hover:shadow-md transition-shadow shrink-0"
        />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm group-hover:shadow-md transition-shadow shrink-0">
          <Bike className="size-5" strokeWidth={2.5} />
        </div>
      )}
      <div className="flex flex-col leading-tight min-w-0">
        <span className="font-extrabold tracking-tight truncate">{nomeMarca}</span>
        {(subtitulo || usuario || marca.slogan) && (
          <span className="text-xs text-muted-foreground truncate">
            {subtitulo || (usuario ? `Olá, ${usuario.nome.split(' ')[0]}` : marca.slogan)}
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground lg:flex">
      {/* ───── Sidebar (somente desktop) ───── */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:w-64 lg:flex-col border-r border-border/60 bg-card/40 px-3 py-4">
        <div className="px-2 pb-4">{Logo}</div>
        <nav className="flex flex-1 flex-col gap-1 mt-2">
          {itensNav.map(item => {
            const Icone = item.icone;
            return (
              <NavLink
                key={item.rota}
                to={item.rota}
                end={item.fim ?? item.rota === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-rail"
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <div className="relative" data-nav-icon={item.rota}>
                      <Icone className="size-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                      {item.badge && (
                        <span className="absolute -right-2 -top-1.5">{item.badge}</span>
                      )}
                    </div>
                    <span className="truncate">{item.rotulo}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-3">
          <ThemeToggle />
          {usuario && (
            <Button variant="ghost" size="sm" onClick={sair} className="gap-2 text-muted-foreground">
              <LogOut className="size-4" /> Sair
            </Button>
          )}
        </div>
      </aside>

      {/* ───── Coluna principal ───── */}
      <div className="flex-1 min-w-0 lg:pl-64">
        {/* Header — somente mobile (no desktop a sidebar tem logo/ações) */}
        <header className="lg:hidden sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            {Logo}
            <div className="flex items-center gap-1">
              <ThemeToggle />
              {usuario && (
                <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
                  <LogOut className="size-5" />
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Conteúdo */}
        <main className="mx-auto max-w-3xl px-4 py-5 pb-32 lg:max-w-6xl lg:px-8 lg:py-8 lg:pb-10">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* ───── Bottom nav (somente mobile) ───── */}
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 backdrop-blur-md pb-safe">
        <div
          className="mx-auto grid max-w-3xl px-2"
          style={{ gridTemplateColumns: `repeat(${itensNav.length}, 1fr)` }}
        >
          {itensNav.map(item => {
            const Icone = item.icone;
            return (
              <NavLink
                key={item.rota}
                to={item.rota}
                end={item.fim ?? item.rota === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-semibold transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <div className="relative" data-nav-icon={item.rota}>
                      <Icone className="size-5" strokeWidth={isActive ? 2.5 : 2} />
                      {item.badge && (
                        <span className="absolute -right-2 -top-1.5">{item.badge}</span>
                      )}
                    </div>
                    <span>{item.rotulo}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <FlyToCartOverlay />
    </div>
  );
}

/**
 * Escuta o evento global 'voar-carrinho' (disparado por vooCarrinho() em
 * lib/carrinho.ts) e anima uma bolha saindo do ponto de origem até o ícone
 * de Carrinho visível no momento (mobile ou desktop, o que estiver na tela).
 * Existe aqui — não em loja.tsx/modal-produto.tsx — porque só o layout
 * conhece a posição real do ícone alvo.
 */
function FlyToCartOverlay() {
  const [voos, setVoos] = useState<{ id: number; from: { x: number; y: number }; to: { x: number; y: number } }[]>([]);

  useEffect(() => {
    function aoVoar(e: Event) {
      const origem = (e as CustomEvent<{ x: number; y: number }>).detail;
      const alvos = document.querySelectorAll<HTMLElement>('[data-nav-icon="/carrinho"]');
      let alvo: HTMLElement | null = null;
      for (const el of alvos) { if (el.offsetParent !== null) { alvo = el; break; } }
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      const id = Date.now() + Math.random();
      setVoos(v => [...v, { id, from: origem, to: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }]);
      setTimeout(() => setVoos(v => v.filter(x => x.id !== id)), 650);
    }
    window.addEventListener('voar-carrinho', aoVoar);
    return () => window.removeEventListener('voar-carrinho', aoVoar);
  }, []);

  return (
    <AnimatePresence>
      {voos.map(v => (
        <motion.div
          key={v.id}
          className="fixed z-[200] flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg pointer-events-none"
          style={{ left: 0, top: 0 }}
          initial={{ x: v.from.x - 12, y: v.from.y - 12, scale: 1, opacity: 1 }}
          animate={{ x: v.to.x - 12, y: v.to.y - 12, scale: 0.4, opacity: 0.6 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.2, 0.8, 0.3, 1] }}
        >
          <ShoppingBag className="size-3.5" />
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

/** Mini badge numérico para o item do carrinho. */
export function NavBadge({ valor }: { valor: number }) {
  if (!valor) return null;
  return (
    <Badge variant="default" className="px-1.5 py-0 h-4 min-w-4 text-[10px] leading-none rounded-full">
      {valor > 99 ? '99+' : valor}
    </Badge>
  );
}
