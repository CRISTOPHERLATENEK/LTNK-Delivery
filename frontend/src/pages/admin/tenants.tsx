/**
 * Gestão de TENANTS (clientes do SaaS) — só super admin do painel principal.
 * Cada tenant tem seu próprio banco (.db) e domínio (multi-tenant SILO).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Globe, Power, Store, Wand2, ExternalLink, Database, Download, Loader2 } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, tokenSessao } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Tenant {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  db_arquivo: string;
  ativo: 0 | 1;
  criado_em: string;
  lojas: number;
}

function gerarSlug(nome: string): string {
  return nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function TelaTenants() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api<{ tenants: Tenant[] }>('GET', '/api/admin/tenants').then(r => r.tenants),
  });

  const vazio = { nome: '', slug: '', dominio: '', nome_loja: '', categoria: '', dono_nome: '', email: '', senha: '', telefone: '' };
  const [form, setForm] = useState(vazio);
  const [criando, setCriando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/admin/tenants', {
        nome: form.nome,
        slug: form.slug || gerarSlug(form.nome),
        dominio: form.dominio,
        nome_loja: form.nome_loja || form.nome,
        categoria: form.categoria,
        dono_nome: form.dono_nome,
        email: form.email,
        senha: form.senha,
        telefone: form.telefone,
      });
      mostrar({
        tipo: 'sucesso',
        titulo: 'Cliente criado!',
        descricao: `Já pode entrar com ${form.email} — banco provisionado e pronto.`,
      });
      setForm(vazio);
      setCriando(false);
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(t: Tenant) {
    try {
      await api('PUT', `/api/admin/tenants/${t.id}`, { ativo: t.ativo ? 0 : 1 });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function salvarDominio(t: Tenant, dominio: string) {
    try {
      await api('PUT', `/api/admin/tenants/${t.id}`, { dominio });
      mostrar({ tipo: 'sucesso', titulo: 'Domínio atualizado.' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const tenants = consulta.data ?? [];

  return (
    <AdminLayout titulo="Clientes">
      <div className="max-w-4xl space-y-5 mx-auto">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <Building2 className="size-5 text-primary" /> Clientes (Tenants)
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cada cliente tem seu próprio banco isolado e domínio.
            </p>
          </div>
          <Button onClick={() => setCriando(c => !c)}>
            <Plus className="size-4" /> Novo cliente
          </Button>
        </div>

        {/* Form de criação */}
        {criando && (
          <Card className="border-primary/40">
            <CardContent className="p-5">
              <form onSubmit={criar} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Nome do cliente *</Label>
                  <Input
                    required autoFocus
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value, slug: f.slug || gerarSlug(e.target.value) }))}
                    placeholder="Ex.: Pizzaria do João"
                  />
                </div>
                <div>
                  <Label>Slug (identificador) *</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.slug}
                      onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder="pizzaria-do-joao"
                      className="font-mono text-sm"
                    />
                    <button type="button" title="Gerar do nome"
                      onClick={() => setForm(f => ({ ...f, slug: gerarSlug(f.nome) }))}
                      className="shrink-0 flex items-center px-3 rounded-lg border border-input bg-muted text-xs font-semibold hover:bg-muted/80">
                      <Wand2 className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Vira o arquivo do banco: <span className="font-mono">tenants/{form.slug || 'slug'}.db</span></p>
                </div>
                <div>
                  <Label>Domínio (opcional)</Label>
                  <Input
                    value={form.dominio}
                    onChange={e => setForm(f => ({ ...f, dominio: e.target.value }))}
                    placeholder="cliente.com.br"
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Deixe em branco pra usar o subdomínio automático (<span className="font-mono">{form.slug || 'slug'}.seudominio.com</span>) —
                    não precisa configurar DNS nenhum. Domínio próprio exige apontar o DNS do cliente pro servidor.
                  </p>
                </div>

                <div className="sm:col-span-2 border-t pt-4 mt-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Loja e responsável (login inicial)</p>
                </div>

                <div>
                  <Label>Nome da loja</Label>
                  <Input
                    value={form.nome_loja}
                    onChange={e => setForm(f => ({ ...f, nome_loja: e.target.value }))}
                    placeholder={form.nome || 'Ex.: Pizzaria do João'}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Vazio = usa o nome do cliente.</p>
                </div>
                <div>
                  <Label>Categoria da loja</Label>
                  <Input
                    list="categorias-loja-sugestoes"
                    value={form.categoria}
                    onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    placeholder="Ex.: Pizzaria"
                  />
                  <datalist id="categorias-loja-sugestoes">
                    {['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria', 'Restaurante', 'Lanchonete', 'Marmitaria', 'Doceria'].map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-muted-foreground mt-1">Vazio = "Outros". Aparece na busca e nos filtros do cardápio.</p>
                </div>
                <div>
                  <Label>Nome do responsável *</Label>
                  <Input
                    required
                    value={form.dono_nome}
                    onChange={e => setForm(f => ({ ...f, dono_nome: e.target.value }))}
                    placeholder="Ex.: João da Silva"
                  />
                </div>
                <div>
                  <Label>E-mail de acesso *</Label>
                  <Input
                    required type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="joao@exemplo.com"
                  />
                </div>
                <div>
                  <Label>Senha inicial *</Label>
                  <Input
                    required type="text" minLength={6}
                    value={form.senha}
                    onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
                    placeholder="mín. 6 caracteres"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">O cliente troca depois, na tela dele.</p>
                </div>
                <div>
                  <Label>Telefone (opcional)</Label>
                  <Input
                    value={form.telefone}
                    onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div className="sm:col-span-2 flex gap-2">
                  <Button type="submit" disabled={enviando || !form.nome.trim() || !form.dono_nome.trim() || !form.email.trim() || form.senha.length < 6}>
                    {enviando ? 'Criando…' : 'Criar e provisionar'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setCriando(false)}>Cancelar</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Lista */}
        {consulta.isLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : tenants.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum cliente ainda. Clique em "Novo cliente".
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {tenants.map(t => (
              <TenantCard key={t.id} t={t} onToggle={() => alternarAtivo(t)} onSalvarDominio={d => salvarDominio(t, d)} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function TenantCard({ t, onToggle, onSalvarDominio }: {
  t: Tenant; onToggle: () => void; onSalvarDominio: (d: string) => void;
}) {
  const { mostrar } = useToast();
  const [editandoDom, setEditandoDom] = useState(false);
  const [dom, setDom] = useState(t.dominio || '');
  const [baixando, setBaixando] = useState(false);
  const master = t.slug === 'padrao';

  async function baixarBackup() {
    setBaixando(true);
    try {
      const token = tokenSessao();
      const resp = await fetch(`/api/admin/tenants/${t.id}/backup`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.erro || `Falha ao gerar o backup (HTTP ${resp.status}).`);
      }
      const blob = await resp.blob();
      const nome = resp.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `backup-${t.slug}-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrar({ tipo: 'sucesso', titulo: 'Backup baixado!' });
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof Error ? err.message : 'Falha ao baixar o backup.' });
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Card className={cn(!t.ativo && 'opacity-60')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Building2 className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{t.nome}</span>
              {master && <Badge variant="outline">principal</Badge>}
              {t.ativo ? <Badge variant="success">ativo</Badge> : <Badge variant="secondary">suspenso</Badge>}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="font-mono">{t.slug}</span>
              <span className="flex items-center gap-1"><Store className="size-3" /> {t.lojas} loja(s)</span>
              <span className="flex items-center gap-1"><Database className="size-3" /> {t.db_arquivo.split('/').pop()}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={baixarBackup} disabled={baixando} title="Baixar backup deste cliente">
              {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span className="hidden sm:inline">Backup</span>
            </Button>
            {!master && (
              <Button variant="ghost" size="sm" onClick={onToggle}>
                <Power className="size-4" /> {t.ativo ? 'Suspender' : 'Ativar'}
              </Button>
            )}
          </div>
        </div>

        {/* Domínio */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <Globe className="size-4 text-muted-foreground shrink-0" />
          {editandoDom ? (
            <>
              <Input value={dom} onChange={e => setDom(e.target.value)} placeholder="cliente.com.br" className="h-8 font-mono text-sm flex-1" />
              <Button size="sm" onClick={() => { onSalvarDominio(dom); setEditandoDom(false); }}>Salvar</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDom(t.dominio || ''); setEditandoDom(false); }}>Cancelar</Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-mono truncate">
                {t.dominio || <span className="text-muted-foreground not-italic">sem domínio</span>}
              </span>
              {t.dominio && (
                <button onClick={() => window.open(`https://${t.dominio}`, '_blank')}
                  className="text-muted-foreground hover:text-primary" title="Abrir site">
                  <ExternalLink className="size-4" />
                </button>
              )}
              {!master && (
                <button onClick={() => setEditandoDom(true)} className="text-xs font-semibold text-primary hover:underline">
                  {t.dominio ? 'editar' : 'definir'}
                </button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
