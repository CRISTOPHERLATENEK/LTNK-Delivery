import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, Plus, Trash2, ToggleLeft, ToggleRight, Tag } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';

interface Banner {
  id: number;
  titulo: string;
  subtitulo: string;
  imagem: string;
  loja_id: number | null;
  loja_nome: string | null;
  produto_id: number | null;
  produto_nome: string | null;
  link_url: string | null;
  ordem: number;
  ativo: 0 | 1;
}

interface LojaSimples { id: number; nome: string; }
interface ProdutoSimples { id: number; nome: string; categoria: string; }

const FORM_VAZIO = {
  titulo: '', subtitulo: '', imagem: '',
  loja_id: '', produto_id: '', link_url: '', ordem: '0',
};

export function TelaBanners() {
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: ['admin-banners'],
    queryFn: () => api<{ banners: Banner[] }>('GET', '/api/admin/banners').then(r => r.banners),
  });

  const lojas = useQuery({
    queryKey: ['admin-lojas-simples'],
    queryFn: () => api<{ lojas: LojaSimples[] }>('GET', '/api/admin/lojas?limit=200').then(r => r.lojas),
    enabled: criando,
  });

  const produtosDaLoja = useQuery({
    queryKey: ['admin-produtos-loja', form.loja_id],
    queryFn: () => api<{ produtos: ProdutoSimples[] }>('GET', `/api/admin/lojas/${form.loja_id}/produtos`).then(r => r.produtos),
    enabled: criando && !!form.loja_id,
  });

  function campo(k: keyof typeof FORM_VAZIO) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(f => {
        const next = { ...f, [k]: e.target.value };
        // Ao trocar de loja, limpa produto selecionado
        if (k === 'loja_id') next.produto_id = '';
        return next;
      });
    };
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/admin/banners', {
        titulo: form.titulo,
        subtitulo: form.subtitulo,
        imagem: form.imagem,
        loja_id: form.loja_id ? Number(form.loja_id) : null,
        produto_id: form.produto_id ? Number(form.produto_id) : null,
        link_url: form.link_url || null,
        ordem: Number(form.ordem),
        ativo: 1,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Banner criado!' });
      setForm(FORM_VAZIO);
      setCriando(false);
      qc.invalidateQueries({ queryKey: ['admin-banners'] });
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof ApiError ? err.message : 'Erro ao salvar.' });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(b: Banner) {
    try {
      await api('PUT', `/api/admin/banners/${b.id}`, { ativo: b.ativo ? 0 : 1 });
      qc.invalidateQueries({ queryKey: ['admin-banners'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(id: number) {
    if (!(await confirmar({ titulo: 'Excluir este banner?', confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/admin/banners/${id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Banner removido.' });
      qc.invalidateQueries({ queryKey: ['admin-banners'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <AdminLayout titulo="Banners">
      <div className="space-y-5 max-w-4xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <Image className="size-6 text-primary" /> Banners do carrossel
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Imagens exibidas na página inicial. Clique em um banner leva à loja ou abre o produto direto.
            </p>
          </div>
          <Button onClick={() => setCriando(c => !c)}>
            <Plus className="size-4" /> Novo banner
          </Button>
        </div>

        {criando && (
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <h3 className="font-bold mb-4">Novo banner</h3>
              <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Título *</Label>
                  <Input required value={form.titulo} onChange={campo('titulo')} placeholder="Ex.: Promoção de Verão" />
                </div>
                <div className="sm:col-span-2">
                  <Label>Subtítulo (opcional)</Label>
                  <Input value={form.subtitulo} onChange={campo('subtitulo')} placeholder="Ex.: Só hoje com 30% off" />
                </div>
                <div className="sm:col-span-2">
                  <Label>URL da imagem *</Label>
                  <Input required type="url" value={form.imagem} onChange={campo('imagem')} placeholder="https://exemplo.com/banner.jpg" />
                  {form.imagem && (
                    <img src={form.imagem} alt="Preview" className="mt-2 h-32 w-full object-cover rounded-xl border border-border bg-muted" />
                  )}
                </div>

                {/* Loja */}
                <div>
                  <Label>Loja (opcional)</Label>
                  <select
                    value={form.loja_id}
                    onChange={campo('loja_id')}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Nenhuma loja —</option>
                    {lojas.data?.map(l => (
                      <option key={l.id} value={l.id}>{l.nome}</option>
                    ))}
                  </select>
                </div>

                {/* Produto (aparece quando loja selecionada) */}
                <div>
                  <Label>Produto para abrir ao clicar</Label>
                  <select
                    value={form.produto_id}
                    onChange={campo('produto_id')}
                    disabled={!form.loja_id}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-40"
                  >
                    <option value="">— Só ir à loja —</option>
                    {produtosDaLoja.data?.map(p => (
                      <option key={p.id} value={p.id}>[{p.categoria}] {p.nome}</option>
                    ))}
                  </select>
                  {form.loja_id && !form.produto_id && (
                    <p className="text-xs text-muted-foreground mt-1">Sem produto: o banner abre o cardápio da loja.</p>
                  )}
                  {form.produto_id && (
                    <p className="text-xs text-primary mt-1">O banner vai abrir diretamente o modal deste produto.</p>
                  )}
                </div>

                <div>
                  <Label>Ordem</Label>
                  <Input type="number" min="0" value={form.ordem} onChange={campo('ordem')} />
                </div>
                <div>
                  <Label>Link externo (se não usar loja)</Label>
                  <Input type="url" value={form.link_url} onChange={campo('link_url')} placeholder="https://..." />
                </div>

                <div className="sm:col-span-2 flex gap-3">
                  <Button type="submit" className="flex-1" disabled={enviando}>
                    {enviando ? 'Salvando…' : 'Criar banner'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { setCriando(false); setForm(FORM_VAZIO); }}>
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {consulta.isLoading && (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
        )}

        {!consulta.isLoading && (consulta.data?.length ?? 0) === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Nenhum banner cadastrado ainda.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {consulta.data?.map(b => (
            <Card key={b.id} className={b.ativo ? '' : 'opacity-60'}>
              <CardContent className="p-4 flex items-center gap-4">
                <img
                  src={b.imagem}
                  alt={b.titulo}
                  className="size-20 rounded-xl object-cover border border-border shrink-0 bg-muted"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{b.titulo}</span>
                    <Badge variant={b.ativo ? 'success' : 'secondary'}>
                      {b.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">ordem {b.ordem}</span>
                  </div>
                  {b.subtitulo && (
                    <p className="text-xs text-muted-foreground mt-0.5">{b.subtitulo}</p>
                  )}
                  {b.loja_nome && (
                    <p className="text-xs text-muted-foreground mt-0.5">Loja: {b.loja_nome}</p>
                  )}
                  {b.produto_nome && (
                    <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
                      <Tag className="size-3" /> Abre: {b.produto_nome}
                    </p>
                  )}
                  {b.link_url && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">🔗 {b.link_url}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => alternarAtivo(b)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title={b.ativo ? 'Desativar' : 'Ativar'}
                  >
                    {b.ativo
                      ? <ToggleRight className="size-6 text-primary" />
                      : <ToggleLeft className="size-6" />
                    }
                  </button>
                  <button
                    onClick={() => excluir(b.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    title="Excluir"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
