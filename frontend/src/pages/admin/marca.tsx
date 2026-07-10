/**
 * "Marca da plataforma" (white label nível altíssimo) — o super admin define
 * a identidade visual completa: nome, slogan, logo, favicon, imagem de
 * compartilhamento, cores (primária + secundária), cantos, tipografia e SEO.
 * Tudo com preview ao vivo aplicado na própria interface.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Palette, Save, Eye, Type, SquareDashedBottom, Image as ImageIcon, Megaphone, Store } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useTema, FONTES, foregroundContraste } from '@/lib/tema';
import { cn } from '@/lib/utils';
import type { TemaMarca, RaioMarca, FonteMarca } from '@/types';

const RAIO_OPCOES: { valor: RaioMarca; label: string; classe: string }[] = [
  { valor: 'reto', label: 'Reto', classe: 'rounded-[3px]' },
  { valor: 'suave', label: 'Suave', classe: 'rounded-xl' },
  { valor: 'redondo', label: 'Redondo', classe: 'rounded-[1.4rem]' },
];

export function TelaMarca() {
  const { marca, previsualizar, recarregar } = useTema();
  const { mostrar } = useToast();
  const [form, setForm] = useState<TemaMarca>(marca);
  const [enviando, setEnviando] = useState(false);

  // Lojas para o seletor de "loja única" (white label)
  const lojasQ = useQuery({
    queryKey: ['admin-lojas-marca'],
    queryFn: () => api<{ lojas: { id: number; nome: string; status_aprovacao: string }[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  useEffect(() => { setForm(marca); }, [marca]);

  // Preview ao vivo de TODA a marca enquanto edita
  useEffect(() => { previsualizar(form); }, [form, previsualizar]);

  // Ao sair sem salvar, reverte o preview para o tema persistido
  useEffect(() => () => { recarregar(); }, [recarregar]);

  function up<K extends keyof TemaMarca>(k: K, v: TemaMarca[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/tema', form);
      await recarregar();
      mostrar({ tipo: 'sucesso', titulo: 'Marca atualizada! 🎨', descricao: 'O visual aplicou em toda a plataforma.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const corFg = foregroundContraste(form.cor_primaria);
  const contrasteClaro = corFg === '0 0% 100%';

  return (
    <AdminLayout titulo="Marca">
    <div className="space-y-5 pb-4 max-w-5xl">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Palette className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Marca da plataforma</h1>
          <p className="text-sm text-muted-foreground">White label — identidade que todos os clientes vão ver.</p>
        </div>
      </div>

      <form onSubmit={salvar} className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ───────────── Coluna de edição ───────────── */}
        <div className="space-y-5 order-2 lg:order-1">
          {/* Identidade */}
          <Secao icone={Store} titulo="Identidade">
            <div>
              <Label htmlFor="nome">Nome da marca</Label>
              <Input id="nome" required maxLength={60} value={form.nome}
                onChange={e => up('nome', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="slogan">Slogan</Label>
              <Input id="slogan" maxLength={120} value={form.slogan}
                onChange={e => up('slogan', e.target.value)}
                placeholder="Ex.: Peça das melhores lojas da sua região" />
            </div>
          </Secao>

          {/* Imagens */}
          <Secao icone={ImageIcon} titulo="Imagens">
            <ImageUpload label="Logo" value={form.logo_url}
              onChange={v => up('logo_url', v)} aspectRatio="square" />
            <ImageUpload label="Favicon (ícone da aba)" value={form.favicon_url}
              onChange={v => up('favicon_url', v)} aspectRatio="square" />
            <div>
              <ImageUpload label="Banner da tela de login" value={form.login_banner_url}
                onChange={v => up('login_banner_url', v)} aspectRatio="wide" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aparece no topo do card de login (/conta). Vazio = usa a ilustração padrão. Ideal ~1200×480px.
              </p>
            </div>
          </Secao>

          {/* Cores */}
          <Secao icone={Palette} titulo="Cores">
            <CampoCor label="Cor primária" valor={form.cor_primaria}
              onChange={v => up('cor_primaria', v)} />
            <div className={cn(
              'rounded-lg px-3 py-2 text-xs flex items-center gap-2',
              contrasteClaro ? 'bg-foreground text-background' : 'bg-foreground/5'
            )}>
              <span className="inline-flex size-4 items-center justify-center rounded-full"
                style={{ background: form.cor_primaria, color: `hsl(${corFg})` }}>A</span>
              Texto sobre a cor será <b>{contrasteClaro ? 'branco' : 'escuro'}</b> (contraste automático).
            </div>
            <CampoCor label="Cor secundária (opcional)" valor={form.cor_secundaria}
              onChange={v => up('cor_secundaria', v)} permiteVazio />
          </Secao>

          {/* Cantos */}
          <Secao icone={SquareDashedBottom} titulo="Cantos">
            <div className="flex gap-2">
              {RAIO_OPCOES.map(op => (
                <button key={op.valor} type="button" onClick={() => up('raio', op.valor)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-2 border-2 p-3 transition-colors',
                    op.classe,
                    form.raio === op.valor ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <span className={cn('size-9 bg-primary', op.classe)} />
                  <span className="text-xs font-semibold">{op.label}</span>
                </button>
              ))}
            </div>
          </Secao>

          {/* Tipografia */}
          <Secao icone={Type} titulo="Tipografia">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(FONTES) as FonteMarca[]).map(f => (
                <button key={f} type="button" onClick={() => up('fonte', f)}
                  style={{ fontFamily: FONTES[f].stack }}
                  className={cn(
                    'rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                    form.fonte === f ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}>
                  <div className="text-base font-bold leading-none">Aa</div>
                  <div className="mt-1 text-xs text-muted-foreground">{FONTES[f].label}</div>
                </button>
              ))}
            </div>
          </Secao>

          {/* SEO / Compartilhamento */}
          <Secao icone={Megaphone} titulo="SEO e compartilhamento">
            <div>
              <Label htmlFor="descricao">Descrição (Google e redes sociais)</Label>
              <textarea id="descricao" rows={2} maxLength={200} value={form.descricao}
                onChange={e => up('descricao', e.target.value)}
                placeholder="Uma frase que descreve a plataforma. Aparece no Google e ao compartilhar o link."
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="text-xs text-muted-foreground mt-1">{form.descricao.length}/200</p>
            </div>
            <ImageUpload label="Imagem de compartilhamento (Open Graph)"
              value={form.og_image} onChange={v => up('og_image', v)} aspectRatio="wide" />
          </Secao>

          {/* Modo de exibição: loja única (white label) ou marketplace */}
          <Secao icone={Eye} titulo="Modo de exibição">
            <div className="space-y-2">
              {/* Marketplace */}
              <button type="button" onClick={() => up('loja_id', 0)}
                className={cn('w-full flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors',
                  form.loja_id === 0 ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <Store className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm">Marketplace (várias lojas)</div>
                  <div className="text-xs text-muted-foreground">A home mostra todas as lojas, ofertas e categorias (estilo iFood).</div>
                </div>
              </button>
              {/* Loja única */}
              <div className={cn('rounded-xl border-2 p-3 transition-colors',
                form.loja_id > 0 ? 'border-primary bg-primary/5' : 'border-border')}>
                <div className="flex items-start gap-3">
                  <Eye className="size-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Loja única (white label)</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Este link abre direto <b>uma loja</b>, sem listar as outras.
                    </div>
                    <select
                      value={form.loja_id || ''}
                      onChange={e => up('loja_id', Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Selecione a loja deste link…</option>
                      {(lojasQ.data ?? []).map(l => (
                        <option key={l.id} value={l.id}>
                          {l.nome}{l.status_aprovacao !== 'aprovada' ? ' (não aprovada)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </Secao>

          <Button type="submit" size="lg" className="w-full" disabled={enviando}>
            <Save className="size-4" />
            {enviando ? 'Salvando…' : 'Salvar marca'}
          </Button>
        </div>

        {/* ───────────── Preview fixo ───────────── */}
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Eye className="size-3.5" /> Pré-visualização ao vivo
            </div>
            <PreviewApp form={form} />
          </div>
        </div>
      </form>
    </div>
    </AdminLayout>
  );
}

/* ───────────────────────── subcomponentes ───────────────────────── */

function Secao({ icone: Icone, titulo, children }: {
  icone: typeof Palette; titulo: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Icone className="size-4 text-primary" /> {titulo}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function CampoCor({ label, valor, onChange, permiteVazio }: {
  label: string; valor: string; onChange: (v: string) => void; permiteVazio?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input type="color" value={valor || '#000000'}
          onChange={e => onChange(e.target.value)}
          className="h-11 w-14 rounded-xl border border-input cursor-pointer shrink-0" />
        <Input value={valor} onChange={e => onChange(e.target.value)}
          maxLength={7} placeholder={permiteVazio ? '— derivada da primária' : '#dc2640'}
          className="font-mono uppercase" />
        {permiteVazio && valor && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}

/** Mock realista que reflete cor, cantos e fonte em tempo real. */
function PreviewApp({ form }: { form: TemaMarca }) {
  const fonte = FONTES[form.fonte]?.stack ?? FONTES.inter.stack;
  return (
    <div className="rounded-2xl border-2 border-dashed border-border p-3 bg-muted/30"
      style={{ fontFamily: fonte }}>
      <div className="rounded-xl overflow-hidden border border-border bg-background shadow-sm">
        {/* Header da marca */}
        <div className="flex items-center gap-2.5 p-3 border-b border-border">
          {form.logo_url ? (
            <img src={form.logo_url} alt="" className="size-9 rounded-xl object-cover" />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-extrabold">
              {(form.nome || 'D').charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-extrabold leading-tight truncate text-sm">{form.nome || 'Nome da marca'}</div>
            <div className="text-[11px] text-muted-foreground truncate">{form.slogan || 'Seu slogan aqui'}</div>
          </div>
        </div>

        {/* Conteúdo mock */}
        <div className="p-3 space-y-3">
          {/* Card de produto */}
          <div className="flex gap-3 rounded-xl border border-border p-2.5">
            <div className="size-14 rounded-lg bg-accent shrink-0 flex items-center justify-center text-xl">🍔</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">X-Burguer Especial</div>
              <div className="text-[11px] text-muted-foreground line-clamp-1">Pão, carne, queijo e bacon</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-bold text-sm">R$ 24,90</span>
                <Badge variant="success" className="text-[9px] px-1.5">Promo</Badge>
              </div>
            </div>
          </div>

          {/* Chips */}
          <div className="flex gap-1.5 flex-wrap">
            <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">Selecionado</span>
            <span className="rounded-full bg-accent text-accent-foreground px-2.5 py-1 text-[11px] font-semibold">Lanches</span>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">Bebidas</span>
          </div>

          {/* Botões */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1">Adicionar</Button>
            <Button size="sm" variant="outline">Ver mais</Button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground mt-2">
        É assim que o cliente vê o app.
      </p>
    </div>
  );
}
