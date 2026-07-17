/**
 * Vitrine de demonstração cross-tenant: "/demo/:slug".
 *
 * Cada loja mora num tenant com banco isolado (arquitetura SILO — ver
 * lib/api.ts comentário no topo). Normalmente o storefront de um tenant só é
 * alcançável pelo domínio/subdomínio dele. Essa rota existe pra deixar o
 * botão "Ver demonstração" da landing funcionar sem depender de DNS: ativa o
 * override de tenant (definirTenantDemo) pelo slug da URL, descobre a 1ª
 * loja aprovada daquele tenant e redireciona pro storefront normal
 * (/loja/:id) — dali em diante as chamadas de api() continuam carregando o
 * header X-Demo-Tenant enquanto o visitante estiver navegando dentro da
 * área cliente (ver tenantDemoAtivo() em lib/api.ts).
 */
import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { api, definirTenantDemo } from '@/lib/api';
import type { Loja } from '@/types';

export function PaginaDemo() {
  const { slug } = useParams();
  const [lojaId, setLojaId] = useState<number | null | 'erro'>(null);

  useEffect(() => {
    if (!slug) return;
    definirTenantDemo(slug);
    api<{ lojas: Loja[] }>('GET', '/api/lojas')
      .then(r => setLojaId(r.lojas[0]?.id ?? 'erro'))
      .catch(() => setLojaId('erro'));
  }, [slug]);

  if (lojaId === 'erro') {
    definirTenantDemo(null);
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">
        Essa demonstração não está disponível no momento.
      </div>
    );
  }
  if (lojaId) return <Navigate to={`/loja/${lojaId}`} replace />;
  return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando demonstração…</div>;
}
