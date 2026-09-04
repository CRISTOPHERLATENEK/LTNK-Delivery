/**
 * Log de auditoria — todas as ações administrativas mutáveis (aprovar/
 * suspender/excluir loja, criar/promover/remover admin, mudar comissão,
 * editar marca/configurações, criar/editar tenant, bloquear/desbloquear
 * usuário) ficam registradas aqui com quem fez, quando e o alvo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from './layout';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { dataLocal } from '@/lib/format';
import {
  Cabecalho, Toolbar, Busca, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Num, Status, Vazio, baixarCsv, type Tom,
} from './ui';

interface Registro {
  id: number;
  admin_id: number | null;
  admin_nome: string;
  admin_email: string;
  acao: string;
  alvo_tipo: string;
  alvo_id: number | null;
  alvo_desc: string;
  detalhes: string;
  criado_em: string;
}

/*
 * O TOM VEM DO VERBO, não do objeto.
 *
 * `loja.suspender` e `admin.remover` são coisas diferentes com a mesma
 * gravidade; o que a cor precisa dizer é se a ação TIROU algo do ar. Mapear
 * por objeto obrigaria uma entrada nova a cada tipo de alvo que aparecesse.
 */
const TOM_DO_VERBO: Record<string, Tom> = {
  aprovar: 'ok', criar: 'ok', desbloquear: 'ok',
  suspender: 'erro', excluir: 'erro', remover: 'erro', bloquear: 'erro',
  promover: 'atencao', rebaixar: 'atencao',
  editar: 'neutro', alterar: 'neutro',
};

function tomAcao(acao: string): Tom {
  const verbo = acao.split('.')[1] || acao;
  return TOM_DO_VERBO[verbo] ?? 'neutro';
}

const ROTULOS: Record<string, string> = {
  'loja.aprovar': 'Loja aprovada', 'loja.suspender': 'Loja suspensa', 'loja.criar': 'Loja criada',
  'loja.excluir': 'Loja excluída', 'loja.comissao': 'Comissão da loja alterada',
  'usuario.bloquear': 'Usuário bloqueado', 'usuario.desbloquear': 'Usuário desbloqueado',
  'admin.criar': 'Admin criado', 'admin.remover': 'Admin removido',
  'admin.promover': 'Promovido a super admin', 'admin.rebaixar': 'Rebaixado de super admin',
  'comissao.alterar': 'Comissão global alterada', 'marca.editar': 'Marca da plataforma editada',
  'configuracoes.editar': 'Configurações gerais editadas',
  'tenant.criar': 'Cliente criado', 'tenant.editar': 'Cliente editado',
  'modulo.criar': 'Módulo criado', 'modulo.editar': 'Módulo editado',
};

function rotuloAcao(acao: string): string {
  return ROTULOS[acao] || acao;
}

/*
 * A CATEGORIA É O OBJETO da ação, tirada do próprio código (`loja.aprovar` →
 * `loja`). Lista fixa envelheceria a cada ação nova que alguém registrasse, e
 * a tela deixaria de mostrar o filtro sem ninguém notar.
 */
type Categoria = 'todas' | string;

export function TelaAuditoria() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<Categoria>('todas');

  const consulta = useQuery({
    queryKey: ['admin-auditoria', de, ate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (de) params.set('de', de);
      if (ate) params.set('ate', ate);
      return api<{ registros: Registro[] }>('GET', `/api/admin/auditoria?${params}`).then(r => r.registros);
    },
  });

  const todos = consulta.data ?? [];

  /* As categorias presentes nos dados, na ordem em que aparecem. */
  const categorias = Array.from(new Set(todos.map(r => r.acao.split('.')[0]))).slice(0, 5);

  const lista = todos.filter(r => {
    const casaCategoria = categoria === 'todas' || r.acao.split('.')[0] === categoria;
    const t = busca.toLowerCase();
    const casaBusca = !busca
      || r.admin_nome.toLowerCase().includes(t)
      || r.alvo_desc.toLowerCase().includes(t)
      || rotuloAcao(r.acao).toLowerCase().includes(t);
    return casaCategoria && casaBusca;
  });

  function exportar() {
    baixarCsv(
      'auditoria',
      ['Data', 'Admin', 'E-mail', 'Ação', 'Alvo', 'Detalhes'],
      lista.map(r => [
        dataLocal(r.criado_em), r.admin_nome, r.admin_email,
        rotuloAcao(r.acao), r.alvo_desc, r.detalhes,
      ]),
    );
  }

  return (
    <AdminLayout titulo="Auditoria">
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Auditoria"
          subtitulo={
            consulta.isLoading
              ? 'Carregando…'
              : `${todos.length} ${todos.length === 1 ? 'registro' : 'registros'} · quem fez o quê e quando`
          }
        />

        <Toolbar>
          <div className="min-w-[200px] flex-1">
            <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por admin, ação ou alvo…" />
          </div>
          {/* Período troca o CONJUNTO consultado (vai na query), diferente do
              segmented de categoria, que restringe o que já veio. */}
          <input
            type="date" value={de} onChange={e => setDe(e.target.value)} aria-label="De"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }}
          />
          <input
            type="date" value={ate} onChange={e => setAte(e.target.value)} aria-label="Até"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }}
          />
        </Toolbar>

        {categorias.length > 1 && (
          <Toolbar>
            <Segmented
              valor={categoria}
              aoMudar={setCategoria}
              opcoes={[
                { v: 'todas', label: 'Todas', contagem: todos.length },
                ...categorias.map(c => ({
                  v: c,
                  label: c.charAt(0).toUpperCase() + c.slice(1),
                  contagem: todos.filter(r => r.acao.split('.')[0] === c).length,
                })),
              ]}
            />
          </Toolbar>
        )}

        {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {consulta.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Tabela colunas="minmax(0,1.1fr) minmax(0,1.4fr) 150px 130px">
            <TabelaCabecalho>
              <span>Admin</span>
              <span>Alvo</span>
              <span>Data</span>
              <span>Ação</span>
            </TabelaCabecalho>
            {lista.map((r, i) => (
              <TabelaLinha key={r.id} primeira={i === 0}>
                <CelulaNome nome={r.admin_nome} sub={r.admin_email} />
                <div className="min-w-0">
                  <div className="truncate">{r.alvo_desc || <Vazio />}</div>
                  {r.detalhes && (
                    <div className="truncate text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>{r.detalhes}</div>
                  )}
                </div>
                <Num className="text-[12px]">{dataLocal(r.criado_em)}</Num>
                <Status tom={tomAcao(r.acao)}>{rotuloAcao(r.acao)}</Status>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={lista.length}
              filtro={categoria === 'todas' ? undefined : categoria}
              aoExportar={lista.length > 0 ? exportar : undefined}
            />
          </Tabela>
        )}
      </div>
    </AdminLayout>
  );
}
