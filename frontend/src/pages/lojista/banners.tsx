import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, Plus, Trash2, ToggleLeft, ToggleRight, Tag, GripVertical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ImageUpload } from '@/components/ui/image-upload';
import { api, ApiError } from '@/lib/api';

interface BannerLoja {
  id: number;
  titulo: string;
  subtitulo: string;
  imagem: string;
  produto_id: number | null;
  produto_nome: string | null;
  link_url: string | null;
  ordem: number;
  ativo: 0 | 1;
  botao_texto?: string;
}

interface ProdutoSimples { id: number; nome: string; categoria: string; }

const FORM_VAZIO = { titulo: '', subtitulo: '', imagem: '', produto_id: '', link_url: '', ordem: '0', botao_texto: '' };
const MAX_BANNERS_ATIVOS = 5;

export function BannersLoja() {
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const bannersQ = useQuery({
    queryKey: ['lojista-banners'],
    queryFn: () => api<{ banners: BannerLoja[] }>('GET', '/api/lojista/banners').then(r => r.banners),
  });

  const produtosQ = useQuery({
    queryKey: ['lojista-produtos-simples'],
    queryFn: () => api<{ produtos: ProdutoSimples[] }>('GET', '/api/lojista/produtos')
      .then((r: any) => (r.produtos ?? r) as ProdutoSimples[]),
    enabled: criando,
  });

  const ativosNoLimite = (bannersQ.data?.filter(b => b.ativo).length ?? 0) >= MAX_BANNERS_ATIVOS;

  function campo(k: keyof typeof FORM_VAZIO) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.imagem) {
      mostrar({ tipo: 'erro', titulo: 'Adicione uma imagem para o banner.' });
      return;
    }
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/banners', {
        titulo: form.titulo,
        subtitulo: form.subtitulo,
        imagem: form.imagem,
        produto_id: form.produto_id ? Number(form.produto_id) : null,
        link_url: form.link_url || null,
        ordem: Number(form.ordem),
        botao_texto: form.botao_texto,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Banner criado!' });
      setForm(FORM_VAZIO);
      setCriando(false);
      qc.refetchQueries({ queryKey: ['lojista-banners'] });
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof ApiError ? err.message : 'Erro ao salvar.' });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(b: BannerLoja) {
    try {
      await api('PUT', `/api/lojista/banners/${b.id}`, { ativo: b.ativo ? 0 : 1 });
      qc.refetchQueries({ queryKey: ['lojista-banners'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(id: number) {
    if (!(await confirmar({ titulo: 'Excluir este banner?', confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/banners/${id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Banner removido.' });
      qc.refetchQueries({ queryKey: ['lojista-banners'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Image className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">Banners da loja</h1>
            <p className="text-sm text-muted-foreground">Aparecem no topo do seu cardápio para os clientes.</p>
          </div>
        </div>
        <Button onClick={() => setCriando(c => !c)} size="sm" disabled={ativosNoLimite}>
          <Plus className="size-4" /> Novo banner
        </Button>
      </div>

      {ativosNoLimite && (
        <p className="text-xs text-amber-600 -mt-2">
          Máximo de {MAX_BANNERS_ATIVOS} banners ativos. Desative um pra criar outro.
        </p>
      )}

      {criando && (
        <Card className="border-primary/30">
          <CardContent className="p-5">
            <h3 className="font-bold mb-4">Novo banner</h3>
            <form onSubmit={salvar} className="space-y-3">
              <div>
                <Label>Título *</Label>
                <Input required value={form.titulo} onChange={campo('titulo')} placeholder="Ex.: Promoção de fim de semana" />
              </div>
              <div>
                <Label>Subtítulo / descrição (aparece menor, abaixo do título)</Label>
                <Input value={form.subtitulo} onChange={campo('subtitulo')} placeholder="Ex.: 30% de desconto em todos os combos" />
              </div>
              <div>
                <Label>Texto do botão (opcional)</Label>
                <Input value={form.botao_texto} onChange={campo('botao_texto')} placeholder="Ex.: Peça já" maxLength={40} />
              </div>
              <ImageUpload
                label="Imagem do banner *"
                value={form.imagem}
                onChange={url => setForm(f => ({ ...f, imagem: url }))}
                aspectRatio="wide"
              />

              <div>
                <Label>Produto que abre ao clicar (opcional)</Label>
                <select
                  value={form.produto_id}
                  onChange={campo('produto_id')}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Só abrir o cardápio —</option>
                  {produtosQ.data?.map(p => (
                    <option key={p.id} value={p.id}>[{p.categoria}] {p.nome}</option>
                  ))}
                </select>
                {form.produto_id ? (
                  <p className="text-xs text-primary mt-1">O cliente vai cair direto no modal deste produto.</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Sem produto: o banner só leva ao cardápio.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ordem (menor = aparece primeiro)</Label>
                  <Input type="number" min="0" value={form.ordem} onChange={campo('ordem')} />
                </div>
                <div>
                  <Label>Link externo (opcional)</Label>
                  <Input type="url" value={form.link_url} onChange={campo('link_url')} placeholder="https://..." />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
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

      {bannersQ.isLoading && (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
      )}

      {!bannersQ.isLoading && (bannersQ.data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-10 text-center space-y-2">
            <Image className="size-10 mx-auto text-muted-foreground/40" />
            <p className="font-semibold text-muted-foreground">Nenhum banner ainda</p>
            <p className="text-sm text-muted-foreground">
              Crie banners com fotos atraentes para destacar promoções no topo do seu cardápio.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {bannersQ.data?.map(b => (
          <Card key={b.id} className={b.ativo ? '' : 'opacity-55'}>
            <CardContent className="p-4 flex items-center gap-3">
              <GripVertical className="size-4 text-muted-foreground/40 shrink-0" />
              <img
                src={b.imagem}
                alt={b.titulo}
                className="size-16 rounded-xl object-cover border border-border shrink-0 bg-muted"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-tight truncate">{b.titulo}</p>
                {b.subtitulo && <p className="text-xs text-muted-foreground mt-0.5 truncate">{b.subtitulo}</p>}
                {b.produto_nome && (
                  <p className="text-xs text-primary mt-1 flex items-center gap-1">
                    <Tag className="size-3" /> Abre: {b.produto_nome}
                  </p>
                )}
                {!b.produto_nome && !b.link_url && (
                  <p className="text-xs text-muted-foreground mt-1">Leva ao cardápio</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => alternarAtivo(b)}
                  disabled={!b.ativo && ativosNoLimite}
                  className="text-muted-foreground hover:text-primary transition-colors p-1 disabled:opacity-40 disabled:pointer-events-none"
                  title={b.ativo ? 'Desativar' : ativosNoLimite ? `Máximo de ${MAX_BANNERS_ATIVOS} ativos` : 'Ativar'}
                >
                  {b.ativo
                    ? <ToggleRight className="size-6 text-primary" />
                    : <ToggleLeft className="size-6" />
                  }
                </button>
                <button
                  onClick={() => excluir(b.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
