/**
 * Revendedores — quem traz clientes e cobra deles por fora.
 *
 * O modelo é revenda pura: o revendedor paga um CUSTO FIXO por cliente ativo, e
 * o que ele cobra do cliente final é problema dele. Por isso a tela mostra o
 * custo e a conta do mês, e não margem nenhuma — a plataforma não sabe, nem
 * precisa saber, quanto ele revende.
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Plus, Pencil, Trash2, Lock, Unlock, Building2, X } from 'lucide-react';
import { AdminLayout } from './layout';
import {
  Cabecalho, Toolbar, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Num, Botao, PainelLateral,
} from './ui';
import { PainelSolicitacoes } from './solicitacoes';
import { PainelModulos } from './modulos';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Revendedor {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  documento: string;
  custo_centavos: number;
  ativo: 0 | 1;
  bloqueado: 0 | 1;
  criado_em: string;
  clientes: number;
  clientes_ativos: number;
  mensalidades_centavos: number;
  modulos_centavos: number;
  total_centavos: number;
}

const FORM_VAZIO = { nome: '', email: '', senha: '', telefone: '', documento: '', custo: '' };

export function TelaRevendedores() {
  const { mostrar } = useToast();
  /*
   * SOLICITAÇÃO É PARTE DA RELAÇÃO com o revendedor, não um assunto à parte —
   * por isso aba e não item de menu separado. A rota /solicitacoes continua
   * valendo e abre já nesta aba: link antigo não pode virar página em branco.
   */
  const local = useLocation();
  const [aba, setAba] = useState<'revendedores' | 'solicitacoes' | 'modulos'>(
    local.pathname.endsWith('/solicitacoes') ? 'solicitacoes' : 'revendedores',
  );
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Revendedor | null>(null);

  const pendentesQ = useQuery({
    queryKey: ['admin-solicitacoes-pendentes'],
    queryFn: () => api<{ solicitacoes: { status: string }[] }>('GET', '/api/admin/solicitacoes')
      .then(r => r.solicitacoes.filter(s => s.status === 'pendente').length),
    staleTime: 60_000,
  });
  const pendentesSolic = pendentesQ.data ?? 0;

  const consulta = useQuery({
    queryKey: ['admin-revendedores'],
    queryFn: () => api<{ revendedores: Revendedor[] }>('GET', '/api/admin/revendedores').then(r => r.revendedores),
  });
  const lista = consulta.data ?? [];

  /*
   * A CONTA DO MÊS é custo × clientes ATIVOS, não × total.
   * Cliente suspenso não gera cobrança — somar todos daria um número que não
   * corresponde a nada que se possa cobrar de ninguém.
   */
  // Vem do servidor (conta-revendedor.ts) — a tela não recalcula, senão dois
  // lugares somariam a mesma coisa de jeitos que um dia divergem.
  const totalMes = lista.reduce((s, r) => s + (r.total_centavos || 0), 0);

  async function remover(r: Revendedor) {
    const ok = await confirmar({
      titulo: `Remover ${r.nome}?`,
      descricao: r.clientes > 0
        ? `Os ${r.clientes} clientes dele continuam funcionando normalmente — só perdem o vínculo comercial.`
        : 'Este revendedor não tem clientes vinculados.',
      confirmar: 'Remover',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/revendedores/${r.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Revendedor removido.' });
      qc.invalidateQueries({ queryKey: ['admin-revendedores'] });
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function alternarBloqueio(r: Revendedor) {
    try {
      await api('PUT', `/api/admin/revendedores/${r.id}`, { bloqueado: !r.bloqueado });
      mostrar({ tipo: 'info', titulo: r.bloqueado ? 'Revendedor desbloqueado.' : 'Revendedor bloqueado.' });
      qc.invalidateQueries({ queryKey: ['admin-revendedores'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <AdminLayout titulo="Revendedores">
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Revendedores"
          subtitulo={
            <>
              {lista.length} {lista.length === 1 ? 'cadastrado' : 'cadastrados'}
              {totalMes > 0 && ` · ${brl(totalMes)} por mês a receber`}
              {pendentesSolic > 0 && ` · ${pendentesSolic} solicitação(ões) aguardando`}
            </>
          }
          acoes={aba === 'revendedores' && (
            <Botao variante="primario" onClick={() => { setEditando(null); setCriando(true); }}>
              Novo revendedor
            </Botao>
          )}
        />

        <Toolbar>
          {/* As três abas viraram um segmented como o resto do painel: eram o
              único lugar com sublinhado, e duas linguagens para "escolha uma
              destas" na mesma ferramenta é o que faz cada tela parecer outra. */}
          <Segmented
            valor={aba}
            aoMudar={setAba}
            opcoes={[
              { v: 'revendedores' as const, label: 'Revendedores', contagem: lista.length },
              { v: 'solicitacoes' as const, label: 'Solicitações', contagem: pendentesSolic || undefined },
              { v: 'modulos' as const, label: 'Módulos' },
            ]}
          />
        </Toolbar>

        {aba === 'modulos' ? <PainelModulos /> : aba === 'solicitacoes' ? <PainelSolicitacoes /> : (
          <>
            {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

            {consulta.isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <Tabela colunas="minmax(0,1.4fr) 110px 120px 110px 130px">
                <TabelaCabecalho>
                  <span>Revendedor</span>
                  <span className="text-right">Clientes</span>
                  <span className="text-right">Por cliente</span>
                  <span className="text-right">No mês</span>
                  <span />
                </TabelaCabecalho>
                {lista.map((r, i) => (
                  <TabelaLinha key={r.id} primeira={i === 0} aoClicar={() => { setCriando(false); setEditando(r); }}>
                    <CelulaNome nome={r.nome} sub={r.email} />
                    <Num className="text-right">
                      {r.clientes_ativos}
                      {r.clientes !== r.clientes_ativos && (
                        <span style={{ color: 'var(--adm-dado)' }}>/{r.clientes}</span>
                      )}
                    </Num>
                    <Num className="text-right">{brl(r.custo_centavos)}</Num>
                    <div className="text-right">
                      <Num className="font-medium">{brl(r.total_centavos)}</Num>
                      {/* A quebra só aparece quando há módulo: sem eles,
                          "mensalidade R$ X + módulos R$ 0" é ruído. */}
                      {r.modulos_centavos > 0 && (
                        <div className="adm-num text-[11px]" style={{ color: 'var(--adm-dado)' }}>
                          {brl(r.mensalidades_centavos)} + {brl(r.modulos_centavos)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                      <Botao altura={30} onClick={() => alternarBloqueio(r)}>
                        {r.bloqueado ? 'Desbloquear' : 'Bloquear'}
                      </Botao>
                      <Botao altura={30} variante="perigo" onClick={() => remover(r)}>Remover</Botao>
                    </div>
                  </TabelaLinha>
                ))}
                <TabelaRodape total={lista.length} />
              </Tabela>
            )}

            {!consulta.isLoading && lista.length === 0 && !consulta.isError && (
              <p className="pt-4 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
                Nenhum revendedor ainda. Cadastre um e depois vincule os clientes dele.
              </p>
            )}
          </>
        )}
      </div>

      <PainelLateral
        aberto={criando || !!editando}
        titulo={editando ? editando.nome : 'Novo revendedor'}
        subtitulo={editando ? editando.email : 'Cadastro e custo por cliente'}
        aoFechar={() => { setCriando(false); setEditando(null); }}
      >
        <FormRevendedor
          editando={editando}
          onFechar={() => { setCriando(false); setEditando(null); }}
          onSalvo={() => {
            setCriando(false); setEditando(null);
            qc.invalidateQueries({ queryKey: ['admin-revendedores'] });
          }}
        />
      </PainelLateral>
    </AdminLayout>
  );
}

function FormRevendedor({ editando, onFechar, onSalvo }: {
  editando: Revendedor | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { mostrar } = useToast();
  const [form, setForm] = useState(editando
    ? {
        nome: editando.nome, email: editando.email, senha: '',
        telefone: editando.telefone, documento: editando.documento,
        custo: (editando.custo_centavos / 100).toFixed(2).replace('.', ','),
      }
    : FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      if (editando) {
        await api('PUT', `/api/admin/revendedores/${editando.id}`, form);
      } else {
        await api('POST', '/api/admin/revendedores', form);
      }
      mostrar({ tipo: 'sucesso', titulo: editando ? 'Revendedor atualizado.' : 'Revendedor criado.' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold">{editando ? `Editar ${editando.nome}` : 'Novo revendedor'}</h2>
          <Button variant="ghost" size="sm" onClick={onFechar}><X className="size-4" /></Button>
        </div>
        <form onSubmit={salvar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rev-nome">Nome</Label>
              <Input id="rev-nome" required value={form.nome} onChange={campo('nome')} />
            </div>
            <div>
              <Label htmlFor="rev-email">E-mail (login)</Label>
              {/*
                E-mail não muda depois de criado: ele é a chave do login, e
                trocá-lo aqui deixaria o revendedor sem conseguir entrar sem
                ninguém perceber.
              */}
              <Input id="rev-email" type="email" required value={form.email} onChange={campo('email')} disabled={!!editando} />
            </div>
            <div>
              <Label htmlFor="rev-senha">{editando ? 'Nova senha (deixe vazio pra manter)' : 'Senha (mín. 6)'}</Label>
              <Input id="rev-senha" type="password" required={!editando} minLength={6} value={form.senha} onChange={campo('senha')} autoComplete="new-password" />
            </div>
            <div>
              <Label htmlFor="rev-tel">Telefone</Label>
              <Input id="rev-tel" value={form.telefone} onChange={campo('telefone')} />
            </div>
            <div>
              <Label htmlFor="rev-doc">CPF/CNPJ</Label>
              <Input id="rev-doc" value={form.documento} onChange={campo('documento')} />
            </div>
            <div>
              <Label htmlFor="rev-custo">Quanto ele te paga por cliente</Label>
              <Input id="rev-custo" inputMode="decimal" placeholder="Ex.: 49,90" value={form.custo} onChange={campo('custo')} />
              <p className="mt-1 text-xs text-muted-foreground">
                Por cliente ativo, por mês. O que ele cobra do cliente final é com ele.
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</Button>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Badge do revendedor dono de um cliente — usada na tela de Clientes. */
export function SeloRevendedor({ nome, className }: { nome?: string | null; className?: string }) {
  if (!nome) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary', className)}>
      <Handshake className="size-2.5" /> {nome}
    </span>
  );
}
