/**
 * Fila de solicitações — clientes que os revendedores pediram e ainda não
 * existem.
 *
 * Nada aqui foi provisionado: aprovar é o que cria o banco. Por isso a recusa
 * é barata (não há o que desfazer) e a aprovação é a decisão de peso.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Check, X, Handshake, Building2, Mail, Phone, Trash2 } from 'lucide-react';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import {
  Toolbar, Segmented, Tabela, TabelaCabecalho, TabelaLinha, TabelaRodape,
  CelulaNome, Num, Status, Botao, PainelLateral, Secao,
} from './ui';
import { dataLocal } from '@/lib/format';

interface Solicitacao {
  id: number;
  /** 'cadastro' cria o cliente; 'exclusao' APAGA um que ja existe. */
  tipo: 'cadastro' | 'exclusao';
  motivo_pedido: string | null;
  revendedor_id: number;
  revendedor_nome: string | null;
  nome: string;
  slug: string;
  nome_loja: string;
  categoria: string;
  dono_nome: string;
  dono_email: string;
  dono_telefone: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  motivo_recusa: string | null;
  tenant_id: number | null;
  criado_em: string;
  decidido_em: string;
}

export function PainelSolicitacoes() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [recusando, setRecusando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const consulta = useQuery({
    queryKey: ['admin-solicitacoes'],
    queryFn: () => api<{ solicitacoes: Solicitacao[] }>('GET', '/api/admin/solicitacoes').then(r => r.solicitacoes),
  });
  /*
   * ABRE EM "AGUARDANDO", não em "todas".
   *
   * Esta tela existe para uma fila de trabalho: o que já foi aprovado ou
   * recusado é histórico, e no meio dele a pendência de hoje se perde. "Todas"
   * fica a um clique para quem precisa conferir o que decidiu.
   */
  const [filtro, setFiltro] = useState<'pendente' | 'todas'>('pendente');
  const todas = consulta.data ?? [];
  const pendentes = todas.filter(s => s.status === 'pendente');
  const lista = filtro === 'pendente' ? pendentes : todas;

  async function aprovar(s: Solicitacao) {
    const exclusao = s.tipo === 'exclusao';
    const ok = await confirmar({
      titulo: exclusao ? `Apagar ${s.nome}?` : `Aprovar ${s.nome}?`,
      // O que a aprovação FAZ, dito antes de fazer: é aqui que a infraestrutura
      // do cliente passa a existir (ou deixa de existir) de verdade.
      descricao: exclusao
        ? 'Apaga o cliente e o banco de dados dele — pedidos, produtos, clientes, histórico. Não tem volta. '
          + 'Se a intenção é só tirar do ar, suspenda o cliente em vez de apagar.'
        : `Cria o banco de dados do cliente e o acesso de ${s.dono_nome}. `
          + `O endereço ${s.slug}.maxxpedidos.com.br passa a funcionar, e o cliente entra na conta de ${s.revendedor_nome || 'quem pediu'}.`,
      confirmar: exclusao ? 'Apagar definitivamente' : 'Aprovar e criar',
      destrutivo: exclusao,
      // Digitar o identificador obriga a olhar QUAL cliente vai sumir — o
      // botão fica onde estava o "Aprovar" do pedido de cadastro, e a mão vai
      // sozinha.
      exigirTexto: exclusao ? s.slug : undefined,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await api('POST', `/api/admin/solicitacoes/${s.id}/aprovar`, exclusao ? { confirmacao: s.slug } : undefined);
      mostrar(exclusao
        ? { tipo: 'sucesso', titulo: 'Cliente apagado.', descricao: `${s.nome} e o banco dele não existem mais.` }
        : { tipo: 'sucesso', titulo: 'Cliente criado.', descricao: `${s.slug}.maxxpedidos.com.br já está no ar.` });
      qc.invalidateQueries({ queryKey: ['admin-solicitacoes'] });
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      qc.invalidateQueries({ queryKey: ['admin-revendedores'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setOcupado(false);
    }
  }

  async function recusar(s: Solicitacao) {
    setOcupado(true);
    try {
      await api('POST', `/api/admin/solicitacoes/${s.id}/recusar`, { motivo });
      mostrar({ tipo: 'info', titulo: 'Solicitação recusada.', descricao: 'O revendedor vê o motivo no painel dele.' });
      setRecusando(null); setMotivo('');
      qc.invalidateQueries({ queryKey: ['admin-solicitacoes'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Toolbar>
        <Segmented
          valor={filtro}
          aoMudar={setFiltro}
          opcoes={[
            { v: 'pendente' as const, label: 'Aguardando', contagem: pendentes.length },
            { v: 'todas' as const, label: 'Todas', contagem: todas.length },
          ]}
        />
      </Toolbar>

      {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

      {consulta.isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <Tabela colunas="minmax(0,1.3fr) minmax(0,1fr) 130px 130px 170px">
          <TabelaCabecalho>
            <span>Cliente pedido</span>
            <span>Revendedor</span>
            <span>Quando</span>
            <span>Situação</span>
            <span />
          </TabelaCabecalho>
          {lista.map((s, i) => (
            <TabelaLinha key={s.id} primeira={i === 0}>
              <CelulaNome
                nome={
                  <>
                    {s.nome}
                    {/*
                      PEDIDO DE EXCLUSÃO É PALAVRA, não cor de borda.
                      Antes o card inteiro ficava vermelho, e numa fila com
                      quatro pedidos a diferença entre "criar" e "APAGAR" era o
                      tom da borda — perto demais do reflexo de clicar no botão
                      verde. Agora está escrito ao lado do nome.
                    */}
                    {s.tipo === 'exclusao' && (
                      <span className="ml-1.5 text-[11px] font-semibold" style={{ color: 'var(--adm-erro)' }}>
                        pedido de exclusão
                      </span>
                    )}
                  </>
                }
                sub={s.tipo === 'exclusao'
                  ? s.slug
                  : `${s.slug} · ${s.nome_loja} · ${s.categoria}`}
              />
              <CelulaNome
                nome={s.revendedor_nome || 'revendedor removido'}
                /* No pedido de exclusão não existe "dono a cadastrar" — o
                   cliente já é de alguém, e as colunas vêm vazias. */
                sub={s.tipo === 'exclusao' ? '' : s.dono_email}
              />
              <Num className="text-[12px]">{dataLocal(s.criado_em)}</Num>
              <Status tom={
                s.status === 'aprovada' ? 'ok'
                  : s.status === 'recusada' ? 'erro'
                    : s.tipo === 'exclusao' ? 'erro' : 'atencao'
              }>
                {s.status === 'pendente' ? 'Aguardando' : s.status === 'aprovada' ? 'Aprovada' : 'Recusada'}
              </Status>
              <div className="flex items-center justify-end gap-1.5">
                {s.status === 'pendente' && recusando !== s.id && (
                  <>
                    <Botao
                      altura={30}
                      variante={s.tipo === 'exclusao' ? 'perigo' : 'primario'}
                      desabilitado={ocupado}
                      onClick={() => aprovar(s)}
                    >
                      {s.tipo === 'exclusao' ? 'Apagar cliente' : 'Aprovar'}
                    </Botao>
                    <Botao altura={30} desabilitado={ocupado}
                      onClick={() => { setRecusando(s.id); setMotivo(''); }}>
                      Recusar
                    </Botao>
                  </>
                )}
              </div>
            </TabelaLinha>
          ))}
          <TabelaRodape
            total={lista.length}
            filtro={filtro === 'pendente' ? 'Aguardando' : undefined}
          />
        </Tabela>
      )}

      {!consulta.isLoading && lista.length === 0 && !consulta.isError && (
        <p className="pt-4 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
          {filtro === 'pendente'
            ? 'Nada aguardando análise.'
            : 'Nenhuma solicitação ainda. Quando um revendedor pedir um cliente novo, ele aparece aqui.'}
        </p>
      )}

      {/*
        A RECUSA ABRE EM PAINEL, com o motivo obrigatório.
        Antes crescia dentro do card e empurrava os pedidos seguintes; e o
        motivo é obrigatório porque sem ele o revendedor reenvia o mesmo pedido
        sem saber o que mudar, e a fila vira um ciclo.
      */}
      <PainelLateral
        aberto={recusando !== null}
        titulo="Recusar solicitação"
        subtitulo={lista.find(s => s.id === recusando)?.nome}
        aoFechar={() => { setRecusando(null); setMotivo(''); }}
        rodape={
          <>
            <Botao altura={30} onClick={() => { setRecusando(null); setMotivo(''); }}>Cancelar</Botao>
            <Botao
              altura={30}
              variante="perigo"
              desabilitado={ocupado || motivo.trim().length < 3}
              onClick={() => {
                const s = lista.find(x => x.id === recusando);
                if (s) void recusar(s);
              }}
            >
              Confirmar recusa
            </Botao>
          </>
        }
      >
        <Secao titulo="Motivo">
          <div className="px-3 py-3">
            <p className="pb-2 text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>
              Por que está recusando? O revendedor vai ler.
            </p>
            <textarea
              rows={3}
              maxLength={300}
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ex.: o identificador escolhido é muito genérico, use o nome da marca."
              className="w-full resize-none px-2.5 py-2 text-[13px] outline-none"
              style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </div>
        </Secao>
      </PainelLateral>
    </>
  );
}
