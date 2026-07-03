/**
 * Guards de acesso — bloqueiam a renderização da tela inteira para quem
 * não tem permissão, redirecionando para uma área segura.
 *
 * IMPORTANTE: esses guards são apenas UX (esconder a casca). A segurança
 * REAL acontece no backend, que devolve 403 mesmo se alguém burlar o front.
 */
import { Navigate } from 'react-router-dom';
import { sessaoUsuario, ehSuperAdmin } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Crown } from 'lucide-react';
import { AppLayout } from '@/components/app-layout';
import type { Perfil } from '@/types';

interface Props {
  perfis: Perfil[];
  /** Se true, exige também super_admin = 1 (além do perfil 'admin'). */
  exigeSuperAdmin?: boolean;
  children: React.ReactNode;
  /** Para onde redirecionar se não estiver logado. Padrão: '/conta'. */
  redirectTo?: string;
}

/**
 * Esconde a tela se o usuário não tiver o perfil exigido.
 *  - Não logado          → redireciona para redirectTo (padrão /conta)
 *  - Logado com perfil errado → mostra "acesso negado"
 *  - Operacional tentando entrar em rota só de super → mostra "só o super admin pode"
 */
export function Guard({ perfis, exigeSuperAdmin, children, redirectTo = '/conta' }: Props) {
  const usuario = sessaoUsuario();

  if (!usuario) return <Navigate to={redirectTo} replace />;

  if (!perfis.includes(usuario.perfil as Perfil)) {
    return (
      <TelaAcessoNegado
        titulo="Esta área não é para você"
        mensagem="Você está logado, mas essa parte do sistema é restrita a outro tipo de conta."
        icone={<ShieldAlert className="size-9 text-destructive" />}
      />
    );
  }

  if (exigeSuperAdmin && !ehSuperAdmin()) {
    return (
      <TelaAcessoNegado
        titulo="Apenas o super admin"
        mensagem="Só o dono da plataforma pode entrar aqui. Fale com ele se você precisa de acesso."
        icone={<Crown className="size-9 text-amber-500" />}
      />
    );
  }

  return <>{children}</>;
}

function TelaAcessoNegado({
  titulo, mensagem, icone,
}: { titulo: string; mensagem: string; icone: React.ReactNode }) {
  return (
    <AppLayout itens={[]}>
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent">
            {icone}
          </div>
          <h2 className="text-xl font-extrabold">{titulo}</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">{mensagem}</p>
          <Button asChild size="lg" variant="outline">
            <a href="/">Voltar para o início</a>
          </Button>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
