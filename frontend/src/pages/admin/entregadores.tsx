/**
 * Entregadores — visão da plataforma: métricas e bloqueio/desbloqueio.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from './layout';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import {
  Cabecalho, Toolbar, Busca, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Num, Status, Vazio, Botao, PainelLateral, baixarCsv,
} from './ui';

interface Entregador {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  bloqueado: 0 | 1;
  entregas: number;
  ativas: number;
  criado_em: string;
  /** Presente só na lista agregada do painel master. */
  tenant_id?: number;
  tenant_nome?: string;
}

type Situacao = 'todos' | 'disponiveis' | 'em_rota' | 'bloqueados';

const ROTULO: Record<Situacao, string> = {
  todos: 'Todos',
  disponiveis: 'Disponíveis',
  em_rota: 'Em rota',
  bloqueados: 'Bloqueados',
};

export function TelaEntregadores() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const [termo, setTermo] = useState('');
  const [aba, setAba] = useState<Situacao>('todos');
  const [aberto, setAberto] = useState<Entregador | null>(null);

  const consulta = useQuery({
    queryKey: ['admin-entregadores'],
    queryFn: () => api<{ entregadores: Entregador[] }>('GET', '/api/admin/entregadores').then(r =>
      /*
       * SUM() do MySQL volta como TEXTO, não número.
       * Somar isso com + concatenava em vez de somar: quatro entregadores com
       * 0, 0, 1 e 2 entregas viravam "00012 entregas no total". Converte aqui,
       * na entrada, pra ninguém precisar lembrar disso lá embaixo.
       */
      r.entregadores.map(e => ({ ...e, entregas: Number(e.entregas) || 0, ativas: Number(e.ativas) || 0 }))),
    refetchInterval: 15000,
  });
  const entregadores = consulta.data ?? [];

  async function alternarBloqueio(e: Entregador) {
    const acao = e.bloqueado ? 'desbloquear' : 'bloquear';
    const Acao = acao[0].toUpperCase() + acao.slice(1);
    if (!(await confirmar({ titulo: `${Acao} ${e.nome}?`, confirmar: Acao, destrutivo: !e.bloqueado }))) return;
    try {
      // `tenant_id` junto: o id do entregador se repete entre clientes, e sem
      // ele o bloqueio cairia no usuário de mesmo id do banco central.
      await api('POST', `/api/admin/usuarios/${e.id}/bloquear-desbloquear${e.tenant_id ? `?tenant_id=${e.tenant_id}` : ''}`);
      mostrar({ tipo: 'sucesso', titulo: `Entregador ${e.bloqueado ? 'desbloqueado' : 'bloqueado'}.` });
      setAberto(null);
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const totalEntregas = entregadores.reduce((s, e) => s + e.entregas, 0);
  const emRota = entregadores.reduce((s, e) => s + e.ativas, 0);

  /*
   * A situação de cada entregador é derivada, não é coluna: bloqueado vence
   * tudo, senão ter entrega ativa quer dizer que está em rota. Calculada uma
   * vez só pra o status da linha e a contagem do filtro não divergirem.
   */
  const situacao = (e: Entregador): Exclude<Situacao, 'todos'> =>
    e.bloqueado ? 'bloqueados' : e.ativas > 0 ? 'em_rota' : 'disponiveis';

  const busca = termo.trim().toLowerCase();
  const filtrados = entregadores.filter(e => {
    if (aba !== 'todos' && situacao(e) !== aba) return false;
    if (!busca) return true;
    return `${e.nome} ${e.email} ${e.telefone ?? ''}`.toLowerCase().includes(busca);
  });

  const contagem = (s: Situacao) =>
    s === 'todos' ? entregadores.length : entregadores.filter(e => situacao(e) === s).length;

  function exportar() {
    baixarCsv(
      'entregadores',
      ['Nome', 'E-mail', 'Telefone', 'Situação', 'Entregas', 'Em rota'],
      filtrados.map(e => [
        e.nome, e.email, e.telefone ?? '', ROTULO[situacao(e)], e.entregas, e.ativas,
      ]),
    );
  }

  return (
    <AdminLayout titulo="Entregadores">
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Entregadores"
          subtitulo={
            consulta.isLoading ? 'Carregando…' : (
              <>
                {entregadores.length} cadastrados · {emRota} em rota agora · {totalEntregas} entregas no total
              </>
            )
          }
        />

        <Toolbar>
          <div className="min-w-[200px] flex-1">
            <Busca valor={termo} aoMudar={setTermo} placeholder="Buscar por nome, e-mail ou telefone…" />
          </div>
          <Segmented
            valor={aba}
            aoMudar={setAba}
            opcoes={(['todos', 'disponiveis', 'em_rota', 'bloqueados'] as Situacao[])
              .map(s => ({ v: s, label: ROTULO[s], contagem: contagem(s) }))}
          />
        </Toolbar>

        {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {consulta.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Tabela colunas="minmax(0,1.4fr) minmax(0,1fr) 90px 130px">
            <TabelaCabecalho>
              <span>Nome</span>
              <span>Telefone</span>
              <span className="text-right">Entregas</span>
              <span>Situação</span>
            </TabelaCabecalho>
            {filtrados.map((e, i) => (
              <TabelaLinha
                key={`${e.tenant_id ?? 0}-${e.id}`}
                primeira={i === 0}
                aoClicar={() => setAberto(e)}
              >
                <CelulaNome
                  nome={
                    <>
                      {e.nome}
                      {e.tenant_nome && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          {e.tenant_nome}
                        </span>
                      )}
                    </>
                  }
                  sub={e.email}
                />
                {e.telefone ? <Num className="text-[12.5px]">{e.telefone}</Num> : <Vazio />}
                <Num className="text-right">{e.entregas}</Num>
                <Status tom={e.bloqueado ? 'erro' : e.ativas > 0 ? 'atencao' : 'ok'}>
                  {ROTULO[situacao(e)].replace(/s$/, '')}
                </Status>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={filtrados.length}
              filtro={aba === 'todos' ? undefined : ROTULO[aba]}
              aoExportar={filtrados.length > 0 ? exportar : undefined}
            />
          </Tabela>
        )}

        <PainelLateral
          aberto={!!aberto}
          titulo={aberto?.nome ?? ''}
          subtitulo={aberto?.tenant_nome}
          aoFechar={() => setAberto(null)}
          rodape={aberto && (
            <Botao
              variante={aberto.bloqueado ? 'primario' : 'perigo'}
              onClick={() => void alternarBloqueio(aberto)}
            >
              {aberto.bloqueado ? 'Desbloquear' : 'Bloquear'}
            </Botao>
          )}
        >
          {aberto && (
            <dl className="text-[13px]">
              {([
                ['Situação', ROTULO[situacao(aberto)].replace(/s$/, '')],
                ['E-mail', aberto.email || '—'],
                ['Telefone', aberto.telefone || '—'],
                ['Entregas concluídas', String(aberto.entregas)],
                ['Entregas em rota', String(aberto.ativas)],
                ['Cadastrado em', aberto.criado_em?.slice(0, 10) ?? '—'],
              ] as [string, string][]).map(([k, v], i) => (
                <div
                  key={k}
                  className="flex gap-3 py-2"
                  style={{ borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)' }}
                >
                  <dt className="w-[150px] shrink-0" style={{ color: 'var(--adm-rotulo)' }}>{k}</dt>
                  <dd className="min-w-0 flex-1"><Num>{v}</Num></dd>
                </div>
              ))}
            </dl>
          )}
        </PainelLateral>
      </div>
    </AdminLayout>
  );
}
