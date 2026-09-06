import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Percent, Filter, X, Download } from 'lucide-react';
import { AdminLayout } from './layout';
import {
  Cabecalho, Toolbar, Tabela, TabelaCabecalho, TabelaLinha, TabelaRodape,
  CelulaNome, Num, Botao, Secao, LinhaRotulada,
} from './ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, ehSuperAdmin, tokenSessao } from '@/lib/api';
import { brl } from '@/lib/format';

interface Repasse {
  loja_id: number;
  loja_nome: string;
  /** Comissão própria da loja; `null` = herda o padrão da plataforma. */
  comissao_percentual: number | null;
  pedidos: number;
  faturamento_centavos: number;
  comissao_centavos: number;
  repasse_centavos: number;
  /** Presentes só na lista agregada do painel master (loja_id se repete entre clientes). */
  tenant_id?: number;
  tenant_nome?: string;
}

export function TelaRepasses() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const superAdmin = ehSuperAdmin();
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [aplicados, setAplicados] = useState({ de: '', ate: '' });
  const [novaComissao, setNovaComissao] = useState('');
  const [salvandoComissao, setSalvandoComissao] = useState(false);

  const repassesQ = useQuery({
    queryKey: ['admin-repasses', aplicados],
    queryFn: () => {
      const params = new URLSearchParams();
      if (aplicados.de) params.set('de', aplicados.de);
      if (aplicados.ate) params.set('ate', aplicados.ate);
      const qs = params.toString();
      return api<{ repasses: Repasse[] }>('GET', `/api/admin/repasses${qs ? '?' + qs : ''}`).then(r =>
        // SUM()/COUNT() do MySQL voltam como TEXTO — os totais abaixo usam `+`
        // e concatenariam em vez de somar. Converte na entrada.
        r.repasses.map(x => ({
          ...x,
          pedidos: Number(x.pedidos) || 0,
          faturamento_centavos: Number(x.faturamento_centavos) || 0,
          comissao_centavos: Number(x.comissao_centavos) || 0,
          repasse_centavos: Number(x.repasse_centavos) || 0,
        })));
    },
  });

  const comissaoQ = useQuery({
    queryKey: ['admin-comissao'],
    queryFn: () => api<{ comissao_percentual: number }>('GET', '/api/admin/comissao'),
  });

  /*
   * ALTERAR A COMISSÃO GLOBAL PEDE CONFIRMAÇÃO, citando de quanto para quanto.
   *
   * É um campo de número que muda o quanto TODA loja sem acordo próprio recebe.
   * Digitar 1 no lugar de 10 é um deslize de teclado com consequência em
   * dinheiro, espalhada por todos os clientes, e que ninguém percebe olhando a
   * tela — a lista continua parecendo certa.
   */
  async function salvarComissao() {
    const atual = comissaoQ.data?.comissao_percentual ?? 0;
    const nova = Number(novaComissao);
    if (!Number.isFinite(nova) || nova < 0 || nova > 50) {
      mostrar({ tipo: 'erro', titulo: 'Informe um percentual entre 0 e 50.' });
      return;
    }
    const ok = await confirmar({
      titulo: `Alterar a comissão de ${atual}% para ${nova}%?`,
      descricao: 'Vale para os novos pedidos das lojas sem comissão própria. '
        + 'As lojas com percentual próprio não mudam.',
      confirmar: 'Alterar',
    });
    if (!ok) return;
    setSalvandoComissao(true);
    try {
      await api('PUT', '/api/admin/comissao', { comissao_percentual: Number(novaComissao) });
      mostrar({ tipo: 'sucesso', titulo: `Comissão atualizada para ${novaComissao}%` });
      comissaoQ.refetch();
      setNovaComissao('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setSalvandoComissao(false);
    }
  }

  async function exportarCsv() {
    try {
      const params = new URLSearchParams();
      if (aplicados.de) params.set('de', aplicados.de);
      if (aplicados.ate) params.set('ate', aplicados.ate);
      const qs = params.toString();
      const resp = await fetch(`/api/admin/repasses/csv${qs ? '?' + qs : ''}`, {
        headers: { Authorization: `Bearer ${tokenSessao('admin')}` },
      });
      if (!resp.ok) throw new Error('Falha ao gerar o CSV.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repasses-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      mostrar({ tipo: 'erro', titulo: err.message || 'Não foi possível exportar.' });
    }
  }

  const repasses = repassesQ.data ?? [];
  const totalFaturamento = repasses.reduce((s, r) => s + r.faturamento_centavos, 0);
  const totalComissao = repasses.reduce((s, r) => s + r.comissao_centavos, 0);
  const totalRepasse = repasses.reduce((s, r) => s + r.repasse_centavos, 0);

  const comissaoAtual = comissaoQ.data?.comissao_percentual ?? 0;

  return (
    <AdminLayout titulo="Repasses">
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Repasses"
          subtitulo={
            repassesQ.isLoading ? 'Carregando…' : (
              <>
                {repasses.length} {repasses.length === 1 ? 'loja' : 'lojas'} · {brl(totalFaturamento)} faturado ·
                {' '}{brl(totalComissao)} de comissão · {brl(totalRepasse)} a repassar
              </>
            )
          }
          acoes={<Botao onClick={exportarCsv}>Exportar CSV</Botao>}
        />

        {/* ── A comissão da plataforma ── */}
        <Secao titulo="Comissão da plataforma">
          <LinhaRotulada
            rotulo="Percentual atual"
            apoio="Vale para as lojas sem comissão própria"
            primeira
          >
            <div className="flex flex-wrap items-center gap-2">
              <Num className="text-[20px] font-medium">
                {comissaoQ.isLoading ? '—' : `${comissaoAtual}%`}
              </Num>
              {superAdmin && (
                <>
                  <input
                    type="number" min="0" max="50" step="0.5"
                    value={novaComissao}
                    onChange={e => setNovaComissao(e.target.value)}
                    placeholder="novo %"
                    aria-label="Novo percentual"
                    className="h-[34px] w-24 px-2 text-right text-[13px] outline-none"
                    style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }}
                  />
                  <Botao
                    variante="primario"
                    desabilitado={salvandoComissao || !novaComissao}
                    onClick={() => void salvarComissao()}
                  >
                    {salvandoComissao ? 'Salvando…' : 'Alterar'}
                  </Botao>
                </>
              )}
            </div>
          </LinhaRotulada>
        </Secao>

        {/*
          O PERÍODO TROCA O CONJUNTO CONSULTADO, não filtra o que já veio — por
          isso continua com botão. Aplicar a cada tecla digitada numa data
          dispararia uma consulta por dígito (0, 04, 04/0, …).
        */}
        <Toolbar>
          <input type="date" value={de} onChange={e => setDe(e.target.value)} aria-label="De"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }} />
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} aria-label="Até"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }} />
          <Botao onClick={() => setAplicados({ de, ate })}>Aplicar período</Botao>
          {(de || ate) && (
            <Botao onClick={() => { setDe(''); setAte(''); setAplicados({ de: '', ate: '' }); }}>Limpar</Botao>
          )}
        </Toolbar>

        {repassesQ.isError && <Falha compacto erro={repassesQ.error} aoTentar={() => repassesQ.refetch()} />}

        {repassesQ.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Tabela colunas="minmax(0,1.4fr) 80px 120px 120px 120px">
            <TabelaCabecalho>
              <span>Loja</span>
              <span className="text-right">Pedidos</span>
              <span className="text-right">Faturamento</span>
              <span className="text-right">Comissão</span>
              <span className="text-right">A repassar</span>
            </TabelaCabecalho>
            {repasses.map((r, i) => (
              <TabelaLinha key={`${r.tenant_id ?? 0}-${r.loja_id}`} primeira={i === 0}>
                <CelulaNome
                  nome={
                    <>
                      {r.loja_nome}
                      {/* Só quando acrescenta informação — ver comentário igual em Pedidos. */}
                      {r.tenant_nome && r.tenant_nome !== r.loja_nome && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          {r.tenant_nome}
                        </span>
                      )}
                    </>
                  }
                  /* COMISSÃO PRÓPRIA aparece como valor; herdada, como "padrão".
                     Sem distinguir, o lojista com acordo especial parece igual a
                     todo mundo — e a próxima mudança da comissão global o pega
                     sem ninguém perceber. */
                  sub={r.comissao_percentual != null
                    ? `${r.comissao_percentual}% próprio`
                    : `padrão (${comissaoAtual}%)`}
                />
                <Num className="text-right">{r.pedidos}</Num>
                <Num className="text-right">{brl(r.faturamento_centavos)}</Num>
                <Num className="text-right">{brl(r.comissao_centavos)}</Num>
                <Num className="text-right font-medium">{brl(r.repasse_centavos)}</Num>
              </TabelaLinha>
            ))}
            {repasses.length > 0 && (
              <TabelaLinha>
                <span className="text-[12px] font-semibold">Total</span>
                <span />
                <Num className="text-right font-semibold">{brl(totalFaturamento)}</Num>
                <Num className="text-right font-semibold">{brl(totalComissao)}</Num>
                <Num className="text-right font-semibold">{brl(totalRepasse)}</Num>
              </TabelaLinha>
            )}
            <TabelaRodape total={repasses.length} />
          </Tabela>
        )}

        {!repassesQ.isLoading && repasses.length === 0 && (
          <p className="pt-3 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
            Nenhum pedido entregue no período selecionado.
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
