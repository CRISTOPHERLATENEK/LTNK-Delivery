import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save, Eye, ExternalLink, Image as ImageIcon, Megaphone, Store, LayoutTemplate, Plus, Trash2, Check, Users, Star, Tag, HelpCircle, Rocket, Zap, Receipt } from 'lucide-react';
import { AdminLayout } from '../layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PreviewLanding, type LandingConfig } from './PreviewLanding';
import { ICONES_DISPONIVEIS, SecaoTituloEditor, ListaTextoEditavel, ListaIconeTituloDescEditavel } from './campos';
import { ICONES_LANDING } from '@/pages/cliente/landing';
import type { LandingRecurso, LandingDepoimento, LandingDestaque, LandingPlano, LandingFaq, LandingIconeTituloDesc, LandingStat, LandingAutomacaoItem, LandingCupomItem } from '@/types';
/**
 * Conteúdo editável da landing page do produto (domínio principal quando não
 * há loja padrão — ver "Modo de exibição" acima e frontend/src/pages/cliente/landing.tsx).
 */
function EditorLanding() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['admin-landing'],
    queryFn: () => api<LandingConfig>('GET', '/api/admin/landing'),
  });
  const [form, setForm] = useState<LandingConfig>({
    cta_texto: 'Ver demonstração', recursos: [], beneficios: [],
    comparativo_sem: [], comparativo_com: [], segmentos: [], depoimentos: [], destaques: [], planos: [], faq: [],
    hero_eyebrow: '', hero_titulo: '', hero_subtitulo: '', hero_imagem: '', hero_imagem_mobile: '', whatsapp: '', demo_url: '',
    como_funciona_titulo: '', como_funciona_subtitulo: '', como_funciona: [],
    atendimento_titulo: '', atendimento_subtitulo: '', stats: [],
    automacao_titulo: '', automacao_subtitulo: '', automacao: [],
    fiscal_eyebrow: '', fiscal_titulo: '', fiscal_texto: '', fiscal_selo_titulo: '', fiscal_selo_desc: '', fiscal_mini: [],
    cupom_itens: [], cupom_total: '',
    recursos_titulo: '', planos_titulo: '', planos_subtitulo: '', duvidas_titulo: '',
    cta_titulo: '', cta_subtitulo: '', cta_botao_demo_texto: '',
    whatsapp_msg_hero: '', whatsapp_msg_cta: '', whatsapp_msg_flutuante: '',
    footer_coluna_sistema: '', footer_coluna_contato: '',
    endereco: '', social_instagram: '', social_facebook: '', social_tiktok: '', social_youtube: '', social_x: '',
  });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (consulta.data) setForm(consulta.data); }, [consulta.data]);

  function upRecurso(i: number, campo: keyof LandingRecurso, valor: string) {
    setForm(f => ({ ...f, recursos: f.recursos.map((r, idx) => idx === i ? { ...r, [campo]: valor } as LandingRecurso : r) }));
  }

  function adicionarRecurso() {
    if (form.recursos.length >= 9) return;
    setForm(f => ({ ...f, recursos: [...f.recursos, { icone: 'store', titulo: '', desc: '' }] }));
  }

  function removerRecurso(i: number) {
    setForm(f => ({ ...f, recursos: f.recursos.filter((_, idx) => idx !== i) }));
  }

  function upDepoimento(i: number, campo: keyof LandingDepoimento, valor: string) {
    setForm(f => ({ ...f, depoimentos: f.depoimentos.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d) }));
  }

  function adicionarDepoimento() {
    if (form.depoimentos.length >= 12) return;
    setForm(f => ({ ...f, depoimentos: [...f.depoimentos, { texto: '', nome: '', negocio: '' }] }));
  }

  function removerDepoimento(i: number) {
    setForm(f => ({ ...f, depoimentos: f.depoimentos.filter((_, idx) => idx !== i) }));
  }

  function upDestaque(i: number, campo: keyof LandingDestaque, valor: string) {
    setForm(f => ({ ...f, destaques: f.destaques.map((d, idx) => idx === i ? { ...d, [campo]: valor } as LandingDestaque : d) }));
  }

  function adicionarDestaque() {
    if (form.destaques.length >= 4) return;
    setForm(f => ({ ...f, destaques: [...f.destaques, { imagem_url: '', titulo: '', desc: '', formato: 'navegador' }] }));
  }

  function removerDestaque(i: number) {
    setForm(f => ({ ...f, destaques: f.destaques.filter((_, idx) => idx !== i) }));
  }

  function upComoFunciona(i: number, campo: keyof LandingIconeTituloDesc, valor: string) {
    setForm(f => ({ ...f, como_funciona: f.como_funciona.map((r, idx) => idx === i ? { ...r, [campo]: valor } as LandingIconeTituloDesc : r) }));
  }
  function adicionarComoFuncionaItem() {
    if (form.como_funciona.length >= 3) return;
    setForm(f => ({ ...f, como_funciona: [...f.como_funciona, { icone: 'list', titulo: '', desc: '' }] }));
  }
  function removerComoFuncionaItem(i: number) {
    setForm(f => ({ ...f, como_funciona: f.como_funciona.filter((_, idx) => idx !== i) }));
  }

  function upFiscalMini(i: number, campo: keyof LandingIconeTituloDesc, valor: string) {
    setForm(f => ({ ...f, fiscal_mini: f.fiscal_mini.map((r, idx) => idx === i ? { ...r, [campo]: valor } as LandingIconeTituloDesc : r) }));
  }
  function adicionarFiscalMini() {
    if (form.fiscal_mini.length >= 4) return;
    setForm(f => ({ ...f, fiscal_mini: [...f.fiscal_mini, { icone: 'printer', titulo: '', desc: '' }] }));
  }
  function removerFiscalMini(i: number) {
    setForm(f => ({ ...f, fiscal_mini: f.fiscal_mini.filter((_, idx) => idx !== i) }));
  }

  function upStat(i: number, campo: keyof LandingStat, valor: string) {
    setForm(f => ({ ...f, stats: f.stats.map((s, idx) => idx === i ? { ...s, [campo]: valor } : s) }));
  }
  function adicionarStat() {
    if (form.stats.length >= 4) return;
    setForm(f => ({ ...f, stats: [...f.stats, { numero: '', texto: '' }] }));
  }
  function removerStat(i: number) {
    setForm(f => ({ ...f, stats: f.stats.filter((_, idx) => idx !== i) }));
  }

  function upAutomacao(i: number, campo: 'icone' | 'titulo' | 'desc', valor: string) {
    setForm(f => ({ ...f, automacao: f.automacao.map((a, idx) => idx === i ? { ...a, [campo]: valor } as LandingAutomacaoItem : a) }));
  }
  function upAutomacaoItens(i: number, itens: string[]) {
    setForm(f => ({ ...f, automacao: f.automacao.map((a, idx) => idx === i ? { ...a, itens } : a) }));
  }
  function adicionarAutomacao() {
    if (form.automacao.length >= 3) return;
    setForm(f => ({ ...f, automacao: [...f.automacao, { icone: 'zap', titulo: '', desc: '', itens: [] }] }));
  }
  function removerAutomacao(i: number) {
    setForm(f => ({ ...f, automacao: f.automacao.filter((_, idx) => idx !== i) }));
  }

  function upCupomItem(i: number, campo: keyof LandingCupomItem, valor: string) {
    setForm(f => ({ ...f, cupom_itens: f.cupom_itens.map((c, idx) => idx === i ? { ...c, [campo]: campo === 'q' ? Number(valor) || 1 : valor } as LandingCupomItem : c) }));
  }
  function adicionarCupomItem() {
    if (form.cupom_itens.length >= 6) return;
    setForm(f => ({ ...f, cupom_itens: [...f.cupom_itens, { q: 1, nome: '', v: '' }] }));
  }
  function removerCupomItem(i: number) {
    setForm(f => ({ ...f, cupom_itens: f.cupom_itens.filter((_, idx) => idx !== i) }));
  }

  function upPlano(i: number, campo: keyof LandingPlano, valor: unknown) {
    setForm(f => ({ ...f, planos: f.planos.map((p, idx) => idx === i ? { ...p, [campo]: valor } as LandingPlano : p) }));
  }
  function adicionarPlano() {
    if (form.planos.length >= 6) return;
    setForm(f => ({ ...f, planos: [...f.planos, { nome: '', preco: '', destaque: false, cta: 'Falar no WhatsApp', recursos: [] }] }));
  }
  function removerPlano(i: number) {
    setForm(f => ({ ...f, planos: f.planos.filter((_, idx) => idx !== i) }));
  }

  function upFaq(i: number, campo: keyof LandingFaq, valor: string) {
    setForm(f => ({ ...f, faq: f.faq.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d) }));
  }
  function adicionarFaq() {
    if (form.faq.length >= 15) return;
    setForm(f => ({ ...f, faq: [...f.faq, { pergunta: '', resposta: '' }] }));
  }
  function removerFaq(i: number) {
    setForm(f => ({ ...f, faq: f.faq.filter((_, idx) => idx !== i) }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (form.recursos.some(r => !r.titulo.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo recurso precisa de um título.' });
      return;
    }
    if (form.depoimentos.some(d => !d.texto.trim() || !d.nome.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo depoimento precisa de texto e nome.' });
      return;
    }
    if (form.destaques.some(d => !d.titulo.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo destaque precisa de um título.' });
      return;
    }
    if (form.planos.some(p => !p.nome.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Todo plano precisa de um nome.' });
      return;
    }
    if (form.faq.some(f => !f.pergunta.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Toda dúvida precisa de uma pergunta.' });
      return;
    }
    setEnviando(true);
    try {
      await api('PUT', '/api/admin/landing', {
        cta_texto: form.cta_texto,
        recursos: form.recursos,
        beneficios: form.beneficios.filter(b => b.trim()),
        comparativo_sem: form.comparativo_sem.filter(b => b.trim()),
        comparativo_com: form.comparativo_com.filter(b => b.trim()),
        segmentos: form.segmentos.filter(b => b.trim()),
        depoimentos: form.depoimentos,
        destaques: form.destaques,
        planos: form.planos.map(p => ({ ...p, recursos: p.recursos.filter(r => r.trim()) })),
        faq: form.faq,
        hero_eyebrow: form.hero_eyebrow,
        hero_titulo: form.hero_titulo,
        hero_subtitulo: form.hero_subtitulo,
        hero_imagem: form.hero_imagem,
        hero_imagem_mobile: form.hero_imagem_mobile,
        whatsapp: form.whatsapp,
        demo_url: form.demo_url,
        como_funciona_titulo: form.como_funciona_titulo,
        como_funciona_subtitulo: form.como_funciona_subtitulo,
        como_funciona: form.como_funciona,
        atendimento_titulo: form.atendimento_titulo,
        atendimento_subtitulo: form.atendimento_subtitulo,
        stats: form.stats,
        automacao_titulo: form.automacao_titulo,
        automacao_subtitulo: form.automacao_subtitulo,
        automacao: form.automacao.map(a => ({ ...a, itens: a.itens.filter(x => x.trim()) })),
        fiscal_eyebrow: form.fiscal_eyebrow,
        fiscal_titulo: form.fiscal_titulo,
        fiscal_texto: form.fiscal_texto,
        fiscal_selo_titulo: form.fiscal_selo_titulo,
        fiscal_selo_desc: form.fiscal_selo_desc,
        fiscal_mini: form.fiscal_mini,
        cupom_itens: form.cupom_itens,
        cupom_total: form.cupom_total,
        recursos_titulo: form.recursos_titulo,
        planos_titulo: form.planos_titulo,
        planos_subtitulo: form.planos_subtitulo,
        duvidas_titulo: form.duvidas_titulo,
        cta_titulo: form.cta_titulo,
        cta_subtitulo: form.cta_subtitulo,
        cta_botao_demo_texto: form.cta_botao_demo_texto,
        whatsapp_msg_hero: form.whatsapp_msg_hero,
        whatsapp_msg_cta: form.whatsapp_msg_cta,
        whatsapp_msg_flutuante: form.whatsapp_msg_flutuante,
        footer_coluna_sistema: form.footer_coluna_sistema,
        footer_coluna_contato: form.footer_coluna_contato,
        endereco: form.endereco,
        social_instagram: form.social_instagram,
        social_facebook: form.social_facebook,
        social_tiktok: form.social_tiktok,
        social_youtube: form.social_youtube,
        social_x: form.social_x,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Landing page atualizada!' });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const ABAS_LANDING = [
    { key: 'hero' as const, label: 'Topo', icone: LayoutTemplate },
    { key: 'geral' as const, label: 'Botão & benefícios', icone: Check },
    { key: 'passos' as const, label: 'Como funciona', icone: Rocket, count: form.como_funciona.length },
    { key: 'comparativo' as const, label: 'Comparativo', icone: Users, count: form.comparativo_sem.filter(s => s.trim()).length + form.comparativo_com.filter(s => s.trim()).length },
    { key: 'numeros' as const, label: 'Números', icone: Tag, count: form.stats.length },
    { key: 'automacao' as const, label: 'Automação', icone: Zap, count: form.automacao.length },
    { key: 'celular' as const, label: 'Destaques', icone: ImageIcon, count: form.destaques.length },
    { key: 'fiscal' as const, label: 'Nota fiscal', icone: Receipt, count: form.fiscal_mini.length },
    { key: 'recursos' as const, label: 'Recursos', icone: Store, count: form.recursos.length },
    { key: 'segmentos' as const, label: 'Segmentos', icone: Store, count: form.segmentos.filter(s => s.trim()).length },
    { key: 'planos' as const, label: 'Planos', icone: Tag, count: form.planos.length },
    { key: 'faq' as const, label: 'Dúvidas', icone: HelpCircle, count: form.faq.length },
    { key: 'depoimentos' as const, label: 'Depoimentos', icone: Star, count: form.depoimentos.length },
    { key: 'final' as const, label: 'CTA & rodapé', icone: Megaphone },
  ];
  type AbaLanding = typeof ABAS_LANDING[number]['key'];
  const [aba, setAba] = useState<AbaLanding>('hero');

  return (
    <form onSubmit={salvar} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4 order-2 lg:order-1 min-w-0">
        <p className="text-xs text-muted-foreground rounded-lg bg-accent/50 px-3 py-2">
          Esta é a página que aparece no domínio principal (quando o "Modo de exibição" está em "Landing page do produto").
          O botão principal leva pra loja de demonstração automaticamente.
        </p>

        {/* Abas de navegação das seções */}
        <div className="flex flex-wrap gap-2">
          {ABAS_LANDING.map(a => (
            <button key={a.key} type="button" onClick={() => setAba(a.key)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition-all',
                aba === a.key
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}>
              <a.icone className="size-4" />
              {a.label}
              {a.count !== undefined && a.count > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 text-[10px] font-extrabold',
                  aba === a.key ? 'bg-primary-foreground/20' : 'bg-accent',
                )}>{a.count}</span>
              )}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            {aba === 'hero' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Topo da página (hero)" desc="A primeira coisa que o visitante vê: chamada grande, subtítulo e a imagem do produto." />
                <div>
                  <Label htmlFor="hero_eyebrow">Selo (texto pequeno acima do título)</Label>
                  <Input id="hero_eyebrow" maxLength={80} value={form.hero_eyebrow}
                    onChange={e => setForm(f => ({ ...f, hero_eyebrow: e.target.value }))}
                    placeholder="Sistema para deliveries e restaurantes" />
                </div>
                <div>
                  <Label htmlFor="hero_titulo">Título principal (chamada grande)</Label>
                  <textarea id="hero_titulo" maxLength={120} rows={2} value={form.hero_titulo}
                    onChange={e => setForm(f => ({ ...f, hero_titulo: e.target.value }))}
                    placeholder="Gestão simples, fácil e eficiente para seu negócio"
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <Label htmlFor="hero_subtitulo">Subtítulo</Label>
                  <textarea id="hero_subtitulo" maxLength={240} rows={2} value={form.hero_subtitulo}
                    onChange={e => setForm(f => ({ ...f, hero_subtitulo: e.target.value }))}
                    placeholder="Cardápio, pedidos, entrega e fiscal — tudo em um só sistema."
                    className="w-full px-3 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <ImageUpload label="Print do painel (dentro do notebook do topo)"
                  value={form.hero_imagem} onChange={v => setForm(f => ({ ...f, hero_imagem: v }))} aspectRatio="wide" />
                <ImageUpload label="Print mobile (no celular sobreposto ao notebook)"
                  value={form.hero_imagem_mobile} onChange={v => setForm(f => ({ ...f, hero_imagem_mobile: v }))} aspectRatio="free" />
                <div>
                  <Label htmlFor="landing_whatsapp">WhatsApp (só números, com DDD)</Label>
                  <Input id="landing_whatsapp" maxLength={30} value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                    placeholder="47999998888" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Usado nos botões "Falar no WhatsApp", nos planos e no botão flutuante. Em branco, cai no telefone de suporte; sem nenhum, os botões de WhatsApp somem.
                  </p>
                </div>
              </div>
            )}

            {aba === 'geral' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Botão e benefícios" desc="Texto do botão principal e a listinha de benefícios com check." />
                <div>
                  <Label htmlFor="cta_texto">Texto do botão principal</Label>
                  <Input id="cta_texto" maxLength={60} value={form.cta_texto}
                    onChange={e => setForm(f => ({ ...f, cta_texto: e.target.value }))}
                    placeholder="Ver demonstração" />
                </div>
                <div>
                  <Label htmlFor="demo_url">Link do botão "Ver demonstração"</Label>
                  <Input id="demo_url" maxLength={300} value={form.demo_url}
                    onChange={e => setForm(f => ({ ...f, demo_url: e.target.value }))}
                    placeholder="/demo/unimaxx" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Deixe em branco pra usar a 1ª loja aprovada deste cliente automaticamente.
                    Se a loja de demo for de outro cliente (tenant), use <code>/demo/&lt;slug-do-cliente&gt;</code> —
                    funciona sem precisar de domínio próprio configurado. Só cole uma URL completa (https://...)
                    se a demo já tiver domínio funcionando de verdade.
                  </p>
                </div>
                <ListaTextoEditavel titulo="Benefícios (check no topo e no rodapé)" max={6}
                  itens={form.beneficios} onChange={v => setForm(f => ({ ...f, beneficios: v }))} />
              </div>
            )}

            {aba === 'passos' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Como funciona (3 passos)" desc="A seção de passos do zero ao primeiro pedido." />
                <div>
                  <Label>Título da seção</Label>
                  <Input maxLength={100} value={form.como_funciona_titulo} placeholder="Do zero ao primeiro pedido em *3 passos*"
                    onChange={e => setForm(f => ({ ...f, como_funciona_titulo: e.target.value }))} />
                  <p className="text-[11px] text-muted-foreground mt-1">Coloque *asteriscos* na palavra que deve ficar destacada (ex.: *3 passos*).</p>
                </div>
                <div>
                  <Label>Subtítulo</Label>
                  <Input maxLength={200} value={form.como_funciona_subtitulo} placeholder="Sem complicação, sem depender de ninguém pra configurar."
                    onChange={e => setForm(f => ({ ...f, como_funciona_subtitulo: e.target.value }))} />
                </div>
                <ListaIconeTituloDescEditavel itens={form.como_funciona} onUp={upComoFunciona} onAdd={adicionarComoFuncionaItem} onRemove={removerComoFuncionaItem} max={3} descMax={160} />
              </div>
            )}

            {aba === 'numeros' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Faixa de números" desc="Os 4 destaques em números (ex.: 2 min / do pedido à cozinha). Máx. 4." />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarStat} disabled={form.stats.length >= 4}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.stats.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={s.numero} maxLength={20} placeholder="Número (ex.: 2 min)" className="w-32 shrink-0" onChange={e => upStat(i, 'numero', e.target.value)} />
                    <Input value={s.texto} maxLength={60} placeholder="Texto (ex.: do pedido à cozinha)" onChange={e => upStat(i, 'texto', e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removerStat(i)}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                ))}
                {form.stats.length === 0 && <p className="text-xs text-muted-foreground">Nenhum número — usando os padrões embutidos.</p>}
              </div>
            )}

            {aba === 'automacao' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Automação de verdade" desc="Os 3 blocos de automação (Pix, notificação, avaliações). Máx. 3." />
                <div>
                  <Label>Título da seção</Label>
                  <Input maxLength={100} value={form.automacao_titulo} placeholder="Automação de *verdade*, não só promessa"
                    onChange={e => setForm(f => ({ ...f, automacao_titulo: e.target.value }))} />
                </div>
                <div>
                  <Label>Subtítulo</Label>
                  <Input maxLength={200} value={form.automacao_subtitulo} placeholder="O sistema trabalha sozinho nos detalhes que tomam seu tempo."
                    onChange={e => setForm(f => ({ ...f, automacao_subtitulo: e.target.value }))} />
                </div>
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarAutomacao} disabled={form.automacao.length >= 3}>
                    <Plus className="size-3.5" /> Adicionar bloco
                  </Button>
                </div>
                {form.automacao.map((a, i) => {
                  const Icone = ICONES_LANDING[a.icone] || Zap;
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={a.icone} onChange={e => upAutomacao(i, 'icone', e.target.value)}
                          className="h-10 px-2 rounded-lg border border-input bg-background text-sm shrink-0">
                          {ICONES_DISPONIVEIS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <Icone className="size-4 text-primary shrink-0" />
                        <Input value={a.titulo} maxLength={60} placeholder="Título" onChange={e => upAutomacao(i, 'titulo', e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removerAutomacao(i)}><Trash2 className="size-4 text-destructive" /></Button>
                      </div>
                      <Input value={a.desc} maxLength={160} placeholder="Descrição curta" onChange={e => upAutomacao(i, 'desc', e.target.value)} />
                      <ListaTextoEditavel titulo="Sub-itens (com check)" max={5} placeholder="Ex.: Confirmação automática via Mercado Pago"
                        itens={a.itens} onChange={v => upAutomacaoItens(i, v)} />
                    </div>
                  );
                })}
                {form.automacao.length === 0 && <p className="text-xs text-muted-foreground">Nenhum bloco — usando os padrões embutidos.</p>}
              </div>
            )}

            {aba === 'fiscal' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="Seção Nota fiscal (NFC-e)" desc="Textos, selo de conformidade, mini-cards e o cupom de exemplo." />
                <div>
                  <Label>Selo (texto pequeno acima do título)</Label>
                  <Input maxLength={60} value={form.fiscal_eyebrow} placeholder="Emissão fiscal"
                    onChange={e => setForm(f => ({ ...f, fiscal_eyebrow: e.target.value }))} />
                </div>
                <div>
                  <Label>Título</Label>
                  <Input maxLength={100} value={form.fiscal_titulo} placeholder="Cupom fiscal (NFC-e) *na hora da venda*"
                    onChange={e => setForm(f => ({ ...f, fiscal_titulo: e.target.value }))} />
                </div>
                <div>
                  <Label>Texto</Label>
                  <textarea maxLength={300} rows={2} value={form.fiscal_texto} placeholder="A nota sai com itens, total, chave de acesso e QR Code…"
                    onChange={e => setForm(f => ({ ...f, fiscal_texto: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Selo — título</Label>
                    <Input maxLength={100} value={form.fiscal_selo_titulo} placeholder="100% em conformidade com a SEFAZ"
                      onChange={e => setForm(f => ({ ...f, fiscal_selo_titulo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Selo — descrição</Label>
                    <Input maxLength={160} value={form.fiscal_selo_desc} placeholder="Emissão segura, autorizada e sem complicação."
                      onChange={e => setForm(f => ({ ...f, fiscal_selo_desc: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="mb-1 block">Mini-cards (4)</Label>
                  <ListaIconeTituloDescEditavel itens={form.fiscal_mini} onUp={upFiscalMini} onAdd={adicionarFiscalMini} onRemove={removerFiscalMini} max={4} descMax={120} />
                </div>
                <div className="border-t border-border pt-4">
                  <Label className="mb-1 block">Cupom de exemplo (itens mostrados no recibo)</Label>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={adicionarCupomItem} disabled={form.cupom_itens.length >= 6}>
                      <Plus className="size-3.5" /> Adicionar item
                    </Button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {form.cupom_itens.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input value={String(c.q)} type="number" min={1} max={99} className="w-16 shrink-0" onChange={e => upCupomItem(i, 'q', e.target.value)} />
                        <Input value={c.nome} maxLength={60} placeholder="Nome do item" onChange={e => upCupomItem(i, 'nome', e.target.value)} />
                        <Input value={c.v} maxLength={10} placeholder="Valor" className="w-24 shrink-0" onChange={e => upCupomItem(i, 'v', e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removerCupomItem(i)}><Trash2 className="size-4 text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <Label>Valor total do cupom</Label>
                    <Input maxLength={20} value={form.cupom_total} placeholder="56,00" className="w-32"
                      onChange={e => setForm(f => ({ ...f, cupom_total: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {aba === 'celular' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Blocos grandes com imagem, tipo "vitrine" de uma funcionalidade. Máx. 4.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarDestaque} disabled={form.destaques.length >= 4}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.destaques.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <ImageUpload label="Imagem" value={d.imagem_url}
                        onChange={v => upDestaque(i, 'imagem_url', v)} aspectRatio="wide" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerDestaque(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs">Moldura da imagem</Label>
                      <select value={d.formato || 'navegador'} onChange={e => upDestaque(i, 'formato', e.target.value)}
                        className="w-full h-10 px-2 rounded-lg border border-input bg-background text-sm">
                        <option value="navegador">Navegador (desktop)</option>
                        <option value="celular">Celular (mobile)</option>
                        <option value="livre">Sem moldura (imagem solta)</option>
                      </select>
                    </div>
                    <Input value={d.titulo} maxLength={80} placeholder="Título"
                      onChange={e => upDestaque(i, 'titulo', e.target.value)} />
                    <textarea value={d.desc} maxLength={240} rows={2} placeholder="Descrição"
                      onChange={e => upDestaque(i, 'desc', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                ))}
                {form.destaques.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum destaque ainda.</p>
                )}
              </div>
            )}

            {aba === 'final' && (
              <div className="space-y-4">
                <SecaoTituloEditor titulo="CTA final, títulos de seção e rodapé" desc="Textos avulsos que aparecem espalhados pela página." />
                <div>
                  <Label>Título da seção de recursos</Label>
                  <Input maxLength={100} value={form.recursos_titulo} placeholder="Tudo que uma operação de delivery *precisa*"
                    onChange={e => setForm(f => ({ ...f, recursos_titulo: e.target.value }))} />
                </div>
                <div>
                  <Label>Título "Atendimento caótico"</Label>
                  <Input maxLength={100} value={form.atendimento_titulo} placeholder="Diga adeus ao atendimento *caótico*"
                    onChange={e => setForm(f => ({ ...f, atendimento_titulo: e.target.value }))} />
                </div>
                <div>
                  <Label>Subtítulo "Atendimento caótico"</Label>
                  <Input maxLength={200} value={form.atendimento_subtitulo} placeholder="O futuro é integrado, rápido e automatizado."
                    onChange={e => setForm(f => ({ ...f, atendimento_subtitulo: e.target.value }))} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Título dos planos</Label>
                    <Input maxLength={100} value={form.planos_titulo} placeholder="Planos sem *pegadinha*"
                      onChange={e => setForm(f => ({ ...f, planos_titulo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Subtítulo dos planos</Label>
                    <Input maxLength={200} value={form.planos_subtitulo} placeholder="Sem taxa por pedido, sem fidelidade."
                      onChange={e => setForm(f => ({ ...f, planos_subtitulo: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Título das dúvidas</Label>
                  <Input maxLength={100} value={form.duvidas_titulo} placeholder="Dúvidas *frequentes*"
                    onChange={e => setForm(f => ({ ...f, duvidas_titulo: e.target.value }))} />
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                  <div>
                    <Label>CTA final — título</Label>
                    <Input maxLength={100} value={form.cta_titulo} placeholder="Quer ver funcionando na prática?"
                      onChange={e => setForm(f => ({ ...f, cta_titulo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>CTA final — subtítulo</Label>
                    <Input maxLength={240} value={form.cta_subtitulo} placeholder="Explore uma loja de demonstração completa…"
                      onChange={e => setForm(f => ({ ...f, cta_subtitulo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>CTA final — texto do botão de demo</Label>
                    <Input maxLength={40} value={form.cta_botao_demo_texto} placeholder="Abrir loja demo"
                      onChange={e => setForm(f => ({ ...f, cta_botao_demo_texto: e.target.value }))} />
                  </div>
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                  <SecaoTituloEditor titulo="Mensagens do WhatsApp" desc="Texto que já vem preenchido quando o cliente clica pra falar com você." />
                  <div>
                    <Label>Mensagem — botão do topo</Label>
                    <Input maxLength={200} value={form.whatsapp_msg_hero} placeholder="Olá! Quero saber mais sobre o sistema de delivery."
                      onChange={e => setForm(f => ({ ...f, whatsapp_msg_hero: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Mensagem — CTA final</Label>
                    <Input maxLength={200} value={form.whatsapp_msg_cta} placeholder="Olá! Quero falar sobre o sistema de delivery."
                      onChange={e => setForm(f => ({ ...f, whatsapp_msg_cta: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Mensagem — botão flutuante</Label>
                    <Input maxLength={200} value={form.whatsapp_msg_flutuante} placeholder="Olá! Quero saber mais sobre o sistema."
                      onChange={e => setForm(f => ({ ...f, whatsapp_msg_flutuante: e.target.value }))} />
                  </div>
                </div>
                <div className="border-t border-border pt-4 grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Rodapé — título da coluna de links</Label>
                    <Input maxLength={40} value={form.footer_coluna_sistema} placeholder="O sistema"
                      onChange={e => setForm(f => ({ ...f, footer_coluna_sistema: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Rodapé — título da coluna de contato</Label>
                    <Input maxLength={40} value={form.footer_coluna_contato} placeholder="Contato"
                      onChange={e => setForm(f => ({ ...f, footer_coluna_contato: e.target.value }))} />
                  </div>
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                  <SecaoTituloEditor titulo="Rodapé — endereço e redes sociais" desc="E-mail e telefone vêm de Marca → Configurações gerais (suporte). Aqui você adiciona o endereço e os links das redes (vazio = o ícone não aparece)." />
                  <div>
                    <Label>Endereço</Label>
                    <Input maxLength={200} value={form.endereco} placeholder="Rua Exemplo, 123 — Centro, Cidade/UF"
                      onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>Instagram (link)</Label>
                      <Input maxLength={300} value={form.social_instagram} placeholder="https://instagram.com/sua_loja"
                        onChange={e => setForm(f => ({ ...f, social_instagram: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Facebook (link)</Label>
                      <Input maxLength={300} value={form.social_facebook} placeholder="https://facebook.com/sua_loja"
                        onChange={e => setForm(f => ({ ...f, social_facebook: e.target.value }))} />
                    </div>
                    <div>
                      <Label>TikTok (link)</Label>
                      <Input maxLength={300} value={form.social_tiktok} placeholder="https://tiktok.com/@sua_loja"
                        onChange={e => setForm(f => ({ ...f, social_tiktok: e.target.value }))} />
                    </div>
                    <div>
                      <Label>YouTube (link)</Label>
                      <Input maxLength={300} value={form.social_youtube} placeholder="https://youtube.com/@sua_loja"
                        onChange={e => setForm(f => ({ ...f, social_youtube: e.target.value }))} />
                    </div>
                    <div>
                      <Label>X / Twitter (link)</Label>
                      <Input maxLength={300} value={form.social_x} placeholder="https://x.com/sua_loja"
                        onChange={e => setForm(f => ({ ...f, social_x: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {aba === 'recursos' && (
              <div className="space-y-3">
                <SecaoTituloEditor titulo="Recursos (lista numerada)" desc="A lista 01-09 de recursos. O título da seção fica na aba 'CTA & rodapé'." />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Cards da grade "Tudo que uma operação de delivery precisa". Máx. 9.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarRecurso} disabled={form.recursos.length >= 9}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.recursos.map((r, i) => {
                  const Icone = ICONES_LANDING[r.icone] || Store;
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={r.icone} onChange={e => upRecurso(i, 'icone', e.target.value)}
                          className="h-10 px-2 rounded-lg border border-input bg-background text-sm shrink-0">
                          {ICONES_DISPONIVEIS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <Icone className="size-4 text-primary shrink-0" />
                        <Input value={r.titulo} maxLength={60} placeholder="Título"
                          onChange={e => upRecurso(i, 'titulo', e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removerRecurso(i)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                      <Input value={r.desc} maxLength={160} placeholder="Descrição curta"
                        onChange={e => upRecurso(i, 'desc', e.target.value)} />
                    </div>
                  );
                })}
                {form.recursos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum recurso — usando os padrões embutidos.</p>
                )}
              </div>
            )}

            {aba === 'comparativo' && (
              <div className="space-y-5">
                <ListaTextoEditavel titulo="Sem a plataforma (lado esquerdo)" max={6} placeholder="Ex.: Erros nos pedidos"
                  itens={form.comparativo_sem} onChange={v => setForm(f => ({ ...f, comparativo_sem: v }))} />
                <ListaTextoEditavel titulo="Com a plataforma (lado direito)" max={6} placeholder="Ex.: Agilidade e organização"
                  itens={form.comparativo_com} onChange={v => setForm(f => ({ ...f, comparativo_com: v }))} />
              </div>
            )}

            {aba === 'segmentos' && (
              <ListaTextoEditavel titulo="Tipos de negócio" max={16} placeholder="Ex.: Pizzaria"
                itens={form.segmentos} onChange={v => setForm(f => ({ ...f, segmentos: v }))} />
            )}

            {aba === 'planos' && (
              <div className="space-y-3">
                <SecaoTituloEditor titulo="Planos" desc="Cards de preços. Os botões levam pro WhatsApp. Vazio = usa os planos padrão embutidos. Máx. 6." />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarPlano} disabled={form.planos.length >= 6}>
                    <Plus className="size-3.5" /> Adicionar plano
                  </Button>
                </div>
                {form.planos.map((p, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={p.nome} maxLength={40} placeholder="Nome (ex.: Profissional)" onChange={e => upPlano(i, 'nome', e.target.value)} />
                      <Input value={p.preco} maxLength={40} placeholder="Preço (ex.: R$ 197/mês)" onChange={e => upPlano(i, 'preco', e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerPlano(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-3">
                      <Input value={p.cta} maxLength={40} placeholder="Texto do botão" onChange={e => upPlano(i, 'cta', e.target.value)} />
                      <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                        <input type="checkbox" checked={!!p.destaque} onChange={e => upPlano(i, 'destaque', e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
                        Destaque
                      </label>
                    </div>
                    <ListaTextoEditavel titulo="Itens do plano" max={12} placeholder="Ex.: NFC-e integrada"
                      itens={p.recursos} onChange={v => upPlano(i, 'recursos', v)} />
                  </div>
                ))}
                {form.planos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum plano — usando os padrões embutidos.</p>}
              </div>
            )}

            {aba === 'faq' && (
              <div className="space-y-3">
                <SecaoTituloEditor titulo="Dúvidas frequentes" desc="Acordeão de perguntas e respostas. Vazio = usa as dúvidas padrão. Máx. 15." />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={adicionarFaq} disabled={form.faq.length >= 15}>
                    <Plus className="size-3.5" /> Adicionar dúvida
                  </Button>
                </div>
                {form.faq.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={d.pergunta} maxLength={160} placeholder="Pergunta" onChange={e => upFaq(i, 'pergunta', e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerFaq(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <textarea value={d.resposta} maxLength={600} rows={2} placeholder="Resposta"
                      onChange={e => upFaq(i, 'resposta', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                ))}
                {form.faq.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma dúvida — usando as padrão.</p>}
              </div>
            )}

            {aba === 'depoimentos' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Vazio = a seção some da landing. Máx. 12.</p>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarDepoimento} disabled={form.depoimentos.length >= 12}>
                    <Plus className="size-3.5" /> Adicionar
                  </Button>
                </div>
                {form.depoimentos.map((d, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <textarea value={d.texto} maxLength={300} rows={2} placeholder="Depoimento"
                        onChange={e => upDepoimento(i, 'texto', e.target.value)}
                        className="flex-1 px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removerDepoimento(i)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input value={d.nome} maxLength={60} placeholder="Nome" onChange={e => upDepoimento(i, 'nome', e.target.value)} />
                      <Input value={d.negocio} maxLength={60} placeholder="Negócio (opcional)" onChange={e => upDepoimento(i, 'negocio', e.target.value)} />
                    </div>
                  </div>
                ))}
                {form.depoimentos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum depoimento ainda.</p>
                )}
              </div>
            )}

          </CardContent>
        </Card>

        <Button type="submit" disabled={enviando}>
          <Save className="size-4" />
          {enviando ? 'Salvando…' : 'Salvar landing page'}
        </Button>
      </div>

      <div className="order-1 lg:order-2">
        <div className="lg:sticky lg:top-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Eye className="size-3.5" /> Pré-visualização ao vivo
          </div>
          <PreviewLanding form={form} />
        </div>
      </div>
    </form>
  );
}
/**
 * Landing page — editor da página pública do produto.
 *
 * Saiu de dentro da tela de Marca, onde vivia embaixo do editor de identidade.
 * São dois assuntos com endpoints próprios: mexer nas cores do app não tem
 * relação com escrever o texto da página de vendas, e ter os dois na mesma
 * tela fazia cada Salvar parecer que salvava o outro.
 *
 * MANTIVE AS ABAS, não virei acordeão: o editor já mostra UMA seção por vez,
 * com contador de itens em cada aba. Trocar por acordeão seria movimento
 * lateral — mesma quantidade de cliques, e perdendo o contador.
 *
 * `previsualizar()` do tema NÃO é usado aqui, de propósito: a landing tem
 * preview próprio, e aplicar o tema global a partir desta tela mudaria a cor
 * do painel inteiro enquanto se edita texto.
 */
export function TelaLanding() {
  return (
    <AdminLayout titulo="Landing page">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Landing page</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A página que aparece no domínio principal quando o modo de exibição está em "Landing".
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" /> Ver landing ao vivo
            </a>
          </Button>
        </div>
        <EditorLanding />
      </div>
    </AdminLayout>
  );
}
