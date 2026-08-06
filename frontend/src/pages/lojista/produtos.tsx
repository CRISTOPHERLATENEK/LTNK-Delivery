/**
 * Gestão de produtos do lojista — CRUD com upload de imagem, subcategoria e grupos de opções.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box, Plus, Pencil, Trash2, X, Star, ChevronDown, ChevronUp,
  ToggleLeft, ToggleRight, Tag, SlidersHorizontal, Check, Layers,
  Copy, CheckSquare, Square, FileText, Rows3, Rows4, UtensilsCrossed,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import {
  Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageUpload } from '@/components/ui/image-upload';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { gtinValido } from '@/lib/gtin';
import type { Produto } from '@/types';

/* ─────────────────────── tipos ──────────────────────── */
const FORM_VAZIO = {
  nome: '', descricao: '', categoria: '', subcategoria: '',
  preco: '', preco_promocional: '', foto_url: '',
  disponivel: true, destaque: false, serve_pessoas: '',
  vendido_por: 'un' as 'un' | 'kg', codigo_barras: '',
  controla_estoque: false, estoque: '',
  // Dados fiscais (NFC-e) — mesmos valores padrão usados pelo backend ao
  // criar um produto (garantirColuna em db.ts), pra não sobrescrever com
  // vazio quando o lojista não mexe nessa seção.
  ncm: '21069090', cfop: '5102', csosn: '102', origem: '0', unidade_comercial: 'UN', cest: '',
};
type FormProduto = typeof FORM_VAZIO;

const CHAVE_DENSIDADE = 'lojista:produtos:densidade';
type Densidade = 'confortavel' | 'compacta';

interface OpcaoItem {
  id: number;
  grupo_id: number;
  nome: string;
  preco_adicional_centavos: number;
  disponivel: number;
  ordem: number;
}

interface GrupoOpcoes {
  id: number;
  produto_id: number;
  nome: string;
  tipo: 'unico' | 'multiplo';
  obrigatorio: number;
  max_escolhas: number;
  ordem: number;
  opcoes: OpcaoItem[];
}

/* Sugestões de opções por tipo de grupo */
const SUGESTOES: Record<string, string[]> = {
  'Adicionais':     ['Bacon', 'Queijo extra', 'Ovo', 'Molho especial', 'Cebola caramelizada', 'Pão extra'],
  'Tamanho':        ['Pequeno', 'Médio', 'Grande', 'GG', 'Família'],
  'Borda':          ['Sem borda', 'Catupiry', 'Cheddar', 'Chocolate', 'Cream cheese'],
  'Ponto da carne': ['Mal passado', 'Ao ponto', 'Bem passado'],
  'Sabores':        ['Chocolate', 'Morango', 'Creme', 'Napolitano', 'Maracujá', 'Misto'],
  'Bebida':         ['Coca-Cola', 'Coca Zero', 'Guaraná', 'Suco de laranja', 'Água', 'Suco de uva'],
};

/* Templates prontos para criação rápida de grupos */
const TEMPLATES: {
  nome: string; dica: string;
  tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: number;
}[] = [
  { nome: 'Adicionais', dica: 'Bacon, queijo extra, molhos…', tipo: 'multiplo', obrigatorio: false, max_escolhas: 0 },
  { nome: 'Tamanho', dica: 'P, M, G, GG, Família…', tipo: 'unico', obrigatorio: true, max_escolhas: 1 },
  { nome: 'Borda', dica: 'Catupiry, cheddar, sem borda…', tipo: 'unico', obrigatorio: false, max_escolhas: 1 },
  { nome: 'Ponto da carne', dica: 'Mal passado, ao ponto…', tipo: 'unico', obrigatorio: true, max_escolhas: 1 },
  { nome: 'Sabores', dica: 'Chocolate, morango, creme…', tipo: 'unico', obrigatorio: true, max_escolhas: 1 },
  { nome: 'Bebida', dica: 'Coca, Suco, Água…', tipo: 'unico', obrigatorio: false, max_escolhas: 1 },
];

/* ─────────────────────── componente principal ──────────────────────── */
export function ProdutosLoja() {
  const [editando, setEditando] = useState<number | 'novo' | null>(null);
  const [form, setForm] = useState<FormProduto>(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState('');
  const [gerindoGrupos, setGerindoGrupos] = useState<Produto | null>(null);
  const [mostrarFiscal, setMostrarFiscal] = useState(false);
  /** Qual dos dois botões de submit foi clicado (ver `salvar`). */
  const criarOutroRef = useRef(false);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [densidade, setDensidade] = useState<Densidade>(
    () => (localStorage.getItem(CHAVE_DENSIDADE) as Densidade) || 'confortavel',
  );
  function alternarDensidade() {
    setDensidade(d => {
      const novo = d === 'confortavel' ? 'compacta' : 'confortavel';
      localStorage.setItem(CHAVE_DENSIDADE, novo);
      return novo;
    });
  }
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [aplicandoAcao, setAplicandoAcao] = useState(false);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: ['lojista-produtos'],
    queryFn: () => api<{ produtos: Produto[] }>('GET', '/api/lojista/produtos').then(r => r.produtos),
  });

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setEditando('novo');
    setTimeout(() => document.getElementById('campo-nome')?.focus(), 50);
  }

  function abrirEdicao(p: Produto) {
    setForm({
      nome: p.nome,
      descricao: p.descricao || '',
      categoria: p.categoria || '',
      subcategoria: p.subcategoria || '',
      preco: String((p.preco_centavos / 100).toFixed(2)),
      preco_promocional: p.preco_promocional_centavos
        ? String((p.preco_promocional_centavos / 100).toFixed(2)) : '',
      foto_url: p.foto_url || '',
      disponivel: !!p.disponivel,
      destaque: !!p.destaque,
      serve_pessoas: p.serve_pessoas ? String(p.serve_pessoas) : '',
      vendido_por: p.vendido_por === 'kg' ? 'kg' : 'un',
      codigo_barras: p.codigo_barras || '',
      controla_estoque: !!p.controla_estoque,
      estoque: p.controla_estoque ? String(p.estoque ?? 0) : '',
      ncm: p.ncm || '21069090',
      cfop: p.cfop || '5102',
      csosn: p.csosn || '102',
      origem: p.origem || '0',
      unidade_comercial: p.unidade_comercial || 'UN',
      cest: p.cest || '',
    });
    setEditando(p.id);
    setTimeout(() => document.getElementById('campo-nome')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function set<K extends keyof FormProduto>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const corpo = {
      nome: form.nome,
      descricao: form.descricao,
      categoria: form.categoria || 'Geral',
      subcategoria: form.subcategoria,
      // Input type="number" produz ponto decimal ("39.90"); enviar como número
      // evita que o backend interprete o ponto como separador de milhar.
      preco: form.preco === '' ? 0 : Number(form.preco),
      preco_promocional: form.preco_promocional ? Number(form.preco_promocional) : undefined,
      foto_url: form.foto_url,
      disponivel: form.disponivel,
      destaque: form.destaque,
      serve_pessoas: form.serve_pessoas ? Number(form.serve_pessoas) : undefined,
      vendido_por: form.vendido_por,
      codigo_barras: form.codigo_barras,
      controla_estoque: form.controla_estoque,
      estoque: form.controla_estoque ? (form.estoque === '' ? 0 : Number(form.estoque)) : 0,
    };
    const corpoFiscal = {
      ncm: form.ncm, cfop: form.cfop, csosn: form.csosn,
      origem: form.origem, unidade_comercial: form.unidade_comercial, cest: form.cest,
    };
    try {
      let produtoId: number;
      if (editando === 'novo') {
        const r = await api<{ produto_id: number }>('POST', '/api/lojista/produtos', corpo);
        produtoId = r.produto_id;
        mostrar({ tipo: 'sucesso', titulo: 'Produto criado!' });
      } else {
        produtoId = editando!;
        await api('PUT', `/api/lojista/produtos/${editando}`, corpo);
        mostrar({ tipo: 'sucesso', titulo: 'Produto atualizado!' });
      }
      // Dados fiscais salvos junto — endpoint próprio (compartilhado com a
      // tela Fiscal), mas agora o lojista não precisa sair do cadastro do
      // produto pra preencher isso.
      await api('PUT', `/api/lojista/fiscal/produtos/${produtoId}`, corpoFiscal).catch(() => {});
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
      /*
       * "Salvar e criar outro" reabre o formulário LIMPO em vez de fechar.
       *
       * `ref` e não estado: o clique no botão precisa registrar a intenção ANTES do
       * submit disparar, e um `setState` só valeria no render seguinte — o `salvar`
       * leria o valor velho e fecharia o drawer. Cadastro de cardápio é trabalho em
       * lote (30 itens numa sentada), e reabrir o drawer a cada um dobra os cliques.
       *
       * A CATEGORIA É PRESERVADA de propósito: quem cadastra em lote está numa
       * categoria só ("Bebidas" inteira de uma vez), e zerá-la obrigaria a reescolher
       * a cada item.
       */
      if (criarOutroRef.current) {
        criarOutroRef.current = false;
        setForm({ ...FORM_VAZIO, categoria: form.categoria, subcategoria: form.subcategoria });
        setEditando('novo');
        setMostrarFiscal(false);
        setTimeout(() => document.getElementById('campo-nome')?.focus(), 50);
      } else {
        setEditando(null);
      }
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function duplicar(p: Produto) {
    try {
      await api('POST', `/api/lojista/produtos/${p.id}/duplicar`);
      mostrar({ tipo: 'sucesso', titulo: `"${p.nome}" duplicado!`, descricao: 'A cópia nasce indisponível — revise e ative quando estiver pronta.' });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(id: number, nome: string) {
    if (!(await confirmar({ titulo: `Remover "${nome}"?`, confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/produtos/${id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Produto removido.' });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function alternarDisponivel(p: Produto) {
    try {
      await api('PUT', `/api/lojista/produtos/${p.id}`, { disponivel: !p.disponivel });
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function alternarSelecao(id: number) {
    setSelecionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function sairDaSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
  }

  async function aplicarAcaoEmMassa(acao: 'ativar' | 'desativar' | 'excluir') {
    if (selecionados.size === 0) return;
    if (acao === 'excluir') {
      const ok = await confirmar({
        titulo: `Excluir ${selecionados.size} produto(s)?`,
        descricao: 'Esta ação não pode ser desfeita.',
        confirmar: 'Excluir', destrutivo: true,
      });
      if (!ok) return;
    }
    setAplicandoAcao(true);
    try {
      const r = await api<{ afetados: number }>('POST', '/api/lojista/produtos/bulk', { ids: [...selecionados], acao });
      mostrar({
        tipo: 'sucesso',
        titulo: acao === 'ativar' ? `${r.afetados} produto(s) ativado(s).`
          : acao === 'desativar' ? `${r.afetados} produto(s) desativado(s).`
          : `${r.afetados} produto(s) excluído(s).`,
      });
      sairDaSelecao();
      qc.invalidateQueries({ queryKey: ['lojista-produtos'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setAplicandoAcao(false);
    }
  }

  const todos = consulta.data ?? [];
  const filtrados = busca
    ? todos.filter(p =>
        p.nome.toLowerCase().includes(busca.toLowerCase()) ||
        (p.categoria || '').toLowerCase().includes(busca.toLowerCase())
      )
    : todos;

  const porCategoria = filtrados.reduce<Record<string, Record<string, Produto[]>>>((acc, p) => {
    const cat = p.categoria || 'Geral';
    const sub = p.subcategoria || '';
    if (!acc[cat]) acc[cat] = {};
    if (!acc[cat][sub]) acc[cat][sub] = [];
    acc[cat][sub].push(p);
    return acc;
  }, {});

  const disponiveis = todos.filter(p => p.disponivel).length;
  const indisponiveis = todos.filter(p => !p.disponivel).length;

  const categoriasExistentes = [...new Set(todos.map(p => p.categoria).filter(Boolean))].sort() as string[];
  const subcategoriasDaCategoria = [...new Set(
    todos
      .filter(p => !form.categoria || p.categoria === form.categoria)
      .map(p => p.subcategoria)
      .filter(Boolean)
  )].sort() as string[];

  return (
    <div className="space-y-4">
      {/* Modal de grupos de opções — sobrepõe tudo */}
      {gerindoGrupos && (
        <GruposModal produto={gerindoGrupos} onFechar={() => setGerindoGrupos(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Box className="size-5 text-primary" /> Produtos ({todos.length})
          </h2>
          {todos.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {disponiveis} disponíveis · {indisponiveis} indisponíveis
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {todos.length > 3 && (
            <Button
              size="sm" variant="outline"
              onClick={alternarDensidade}
              title={densidade === 'confortavel' ? 'Ver mais compacto' : 'Ver mais espaçado'}
            >
              {densidade === 'confortavel' ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
            </Button>
          )}
          {todos.length > 0 && (
            modoSelecao ? (
              <Button size="sm" variant="outline" onClick={sairDaSelecao}>
                <X className="size-4" /> Cancelar
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setModoSelecao(true)} disabled={editando !== null}>
                <CheckSquare className="size-4" /> Selecionar
              </Button>
            )
          )}
          <Button size="sm" onClick={abrirNovo} disabled={editando !== null || modoSelecao}>
            <Plus className="size-4" /> Novo produto
          </Button>
        </div>
      </div>

      {/* Barra flutuante de ações em massa */}
      {modoSelecao && selecionados.size > 0 && (
        <div className="sticky top-2 z-20 flex items-center gap-2 rounded-2xl border border-primary/30 bg-card px-4 py-2.5 shadow-lg">
          <span className="text-sm font-bold shrink-0">{selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
            <Button size="sm" variant="outline" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('ativar')}>
              <ToggleRight className="size-4" /> Ativar
            </Button>
            <Button size="sm" variant="outline" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('desativar')}>
              <ToggleLeft className="size-4" /> Desativar
            </Button>
            <Button size="sm" variant="destructive" disabled={aplicandoAcao} onClick={() => aplicarAcaoEmMassa('excluir')}>
              <Trash2 className="size-4" /> Excluir
            </Button>
          </div>
        </div>
      )}

      {/* Busca */}
      {todos.length > 3 && (
        <Input
          placeholder="Buscar por nome ou categoria…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
      )}

      {/* ── Formulário ── */}
      {/*
        CADASTRO EM DRAWER LATERAL, não em card expandido no meio da lista.
        Duas coisas concretas melhoram: a lista continua visível atrás (dá pra ver o
        que já existe enquanto se cadastra), e o botão de salvar fica FIXO no rodapé —
        no card inline ele descia com o formulário e, num cadastro longo, sumia da
        tela justo quando se ia usar.

        Usa o `Sheet` do projeto (Radix Dialog): foco preso dentro do drawer, Esc pra
        fechar e clique no overlay vêm de graça e corretos. Reimplementar isso à mão
        é onde acessibilidade costuma quebrar.
      */}
      <Sheet open={editando !== null} onOpenChange={aberto => { if (!aberto) setEditando(null); }}>
        <SheetContent
          side="right"
          hideClose
          className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]"
          // O formulário é longo e tem campo numérico: fechar sem querer ao clicar
          // fora perderia o preenchimento. Esc e o X continuam fechando.
          onInteractOutside={e => e.preventDefault()}
        >
          {/* ─── Header fixo ─── */}
          <SheetHeader className="flex-row items-start justify-between gap-3 border-b p-6 pb-5">
            <div className="min-w-0">
              <SheetTitle className="text-[19px] font-extrabold leading-tight">
                {editando === 'novo' ? 'Novo produto' : 'Editar produto'}
              </SheetTitle>
              <SheetDescription className="mt-0.5 truncate text-[13px]">
                {editando === 'novo'
                  ? 'Preencha os dados e salve para publicar no cardápio.'
                  : [form.nome, form.categoria].filter(Boolean).join(' · ') || 'Produto'}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Estado À VENDA / PAUSADO no header: é a informação que decide se o
                  cliente vê o produto, e ela some se ficar só no meio do formulário. */}
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold',
                form.disponivel ? 'bg-emerald-500/12 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                {form.disponivel ? 'À venda' : 'Pausado'}
              </span>
              <button
                type="button"
                onClick={() => setEditando(null)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </SheetHeader>

          <form onSubmit={salvar} className="flex min-h-0 flex-1 flex-col">
            {/* ─── Corpo com rolagem ─── */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {/* FOTO — quadrada 1:1 e não banner esticado: o cardápio e o PDV
                  mostram o produto em quadrado, então recorte largo aqui engana
                  quem cadastra sobre o que vai aparecer depois. */}
              <SecaoDrawer titulo="Foto">
                <ImageUpload
                  value={form.foto_url}
                  onChange={url => setForm(f => ({ ...f, foto_url: url }))}
                  aspectRatio="square"
                />
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Quadrada (1:1), mínimo 500×500. É assim que ela aparece no cardápio e no PDV.
                </p>
              </SecaoDrawer>

              <SecaoDrawer titulo="Produto">
                <div>
                  <Label htmlFor="campo-nome">Nome *</Label>
                  <Input
                    id="campo-nome"
                    required
                    value={form.nome}
                    onChange={set('nome')}
                    placeholder="Ex.: X-Burguer Especial"
                    className={CAMPO_DRAWER}
                  />
                </div>

                <div className="mt-4">
                  <Label>
                    Descrição
                    <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <textarea
                    value={form.descricao}
                    onChange={set('descricao')}
                    rows={2}
                    placeholder="Ingredientes, tamanho, detalhes que ajudam o cliente a escolher…"
                    className="mt-1.5 w-full resize-none rounded-[10px] border border-input bg-background px-3 py-2.5 text-[15px] transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15"
                  />
                </div>

                <div className="mt-4 space-y-4">
                  <SeletorChips
                    label="Categoria"
                    obrigatorio
                    valor={form.categoria}
                    opcoes={categoriasExistentes}
                    onChange={v => setForm(f => ({ ...f, categoria: v }))}
                    placeholderNovo="Ex.: Lanches, Bebidas, Sobremesas…"
                    rotuloNovo="Nova categoria"
                  />
                  <SeletorChips
                    label="Subcategoria"
                    valor={form.subcategoria}
                    opcoes={subcategoriasDaCategoria}
                    onChange={v => setForm(f => ({ ...f, subcategoria: v }))}
                    placeholderNovo="Ex.: Especiais, Veganos…"
                    rotuloNovo="Nova subcategoria"
                    dica={form.categoria ? undefined : 'Escolha uma categoria primeiro'}
                  />
                </div>
              </SecaoDrawer>

              <SecaoDrawer titulo="Preço e venda">
                {/* SEGMENTED CONTROL em vez de dois botões grandes com borda: são duas
                    opções mutuamente exclusivas de um mesmo atributo, e o formato
                    "trilho com a ativa em branco" diz isso sem precisar de rótulo. */}
                <div>
                  <Label>Como é vendido?</Label>
                  <div className="mt-1.5 flex rounded-[11px] bg-muted p-1">
                    {([['un', 'Por unidade'], ['kg', 'Por peso (kg)']] as const).map(([v, txt]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, vendido_por: v }))}
                        className={cn(
                          'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all',
                          form.vendido_por === v
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {txt}
                      </button>
                    ))}
                  </div>
                  {form.vendido_por === 'kg' && (
                    <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                      No PDV o operador informa o peso (ou lê a etiqueta da balança) e o preço é calculado por kg.
                    </p>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    {/* O rótulo muda com a unidade: "Preço" num produto por peso é
                        ambíguo entre preço do quilo e preço da peça. */}
                    <Label>{form.vendido_por === 'kg' ? 'Preço por kg (R$) *' : 'Preço (R$) *'}</Label>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                      <Input
                        required type="number" step="0.01" min="0.01"
                        value={form.preco} onChange={set('preco')} placeholder="0,00"
                        className={cn(CAMPO_DRAWER, 'mt-0 pl-9')}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>
                      Preço promocional
                      <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                    </Label>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={form.preco_promocional} onChange={set('preco_promocional')} placeholder="—"
                        className={cn(CAMPO_DRAWER, 'mt-0 pl-9')}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
                  <div>
                    <Label>
                      Código de barras
                      <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
                    </Label>
                    <Input
                      value={form.codigo_barras}
                      onChange={e => setForm(f => ({ ...f, codigo_barras: e.target.value.replace(/\D/g, '') }))}
                      inputMode="numeric"
                      placeholder="7891234567890"
                      className={cn(CAMPO_DRAWER, 'font-mono')}
                      maxLength={20}
                    />
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      Permite bipar no PDV. Por peso, use o PLU da balança.
                    </p>
                    {/*
                      Diz na hora do cadastro se o código vai ou não pra nota fiscal.
                      Sem isso o lojista digita um EAN com um dígito errado, acha que
                      cadastrou, e só descobre — se descobrir — que a NFC-e saiu como
                      "SEM GTIN". Não bloqueia: PLU de balança é código interno
                      legítimo e não é um GTIN.
                    */}
                    {form.codigo_barras.trim() !== '' && (
                      <p className={cn('mt-1 text-[12.5px]',
                        gtinValido(form.codigo_barras) ? 'text-emerald-600' : 'text-amber-600')}>
                        {gtinValido(form.codigo_barras)
                          ? '✓ EAN válido — vai na nota fiscal como código do produto.'
                          : 'Não é um EAN válido (dígito verificador não fecha). Serve pra bipar no PDV, '
                            + 'mas a nota sai como “SEM GTIN”.'}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>
                      Serve pessoas
                      <span className="ml-1 text-xs font-normal text-muted-foreground">(opc.)</span>
                    </Label>
                    <Input
                      type="number" min="1" max="20"
                      value={form.serve_pessoas} onChange={set('serve_pessoas')} placeholder="Ex.: 2"
                      className={CAMPO_DRAWER}
                    />
                  </div>
                </div>
              </SecaoDrawer>

              {/*
                DISPONIBILIDADE COMO LINHAS COM INTERRUPTOR, não chips.
                Chip comunica "filtro/opção selecionável"; interruptor comunica
                "ligado/desligado". Eram três controles de estado com três aparências
                diferentes (dois ícones de toggle e uma estrela solta num card cinza),
                e cada um exigia decifrar o que estava ativo.
              */}
              <SecaoDrawer titulo="Disponibilidade">
                <div className="divide-y divide-border/70 rounded-xl border border-border">
                  <LinhaInterruptor
                    titulo="Disponível para venda"
                    descricao="Aparece no cardápio e no PDV"
                    ativo={form.disponivel}
                    onAlternar={() => setForm(f => ({ ...f, disponivel: !f.disponivel }))}
                  />
                  <LinhaInterruptor
                    titulo="Destaque"
                    descricao="Aparece no topo do cardápio"
                    ativo={form.destaque}
                    onAlternar={() => setForm(f => ({ ...f, destaque: !f.destaque }))}
                  />
                  <LinhaInterruptor
                    titulo="Controlar estoque"
                    descricao="Esgota sozinho quando a quantidade zera"
                    ativo={form.controla_estoque}
                    onAlternar={() => setForm(f => ({ ...f, controla_estoque: !f.controla_estoque }))}
                  >
                    {form.controla_estoque && (
                      <div className="mt-3 w-44">
                        <Label>Quantidade disponível</Label>
                        <Input
                          type="number" min="0" step="1"
                          value={form.estoque} onChange={set('estoque')} placeholder="Ex.: 20"
                          className={CAMPO_DRAWER}
                        />
                        <p className="mt-1 text-[12.5px] text-muted-foreground">
                          Baixa automática a cada pedido. Em 0, aparece como “Esgotado”.
                        </p>
                      </div>
                    )}
                  </LinhaInterruptor>
                </div>
              </SecaoDrawer>

              {/* Dados fiscais colapsados: já vêm com padrão seguro, e quem não
                  emite nota não deve tropeçar em NCM/CFOP pra cadastrar um lanche. */}
              <div className="rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setMostrarFiscal(v => !v)}
                  className="flex w-full items-center gap-2.5 p-4 text-left"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm font-semibold">Dados fiscais (NFC-e)</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Opcional
                  </span>
                  <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', mostrarFiscal && 'rotate-180')} />
                </button>
                {mostrarFiscal && (
                  <div className="grid grid-cols-2 gap-3 border-t border-border px-4 pb-4 pt-4 sm:grid-cols-3">
                    {([
                      ['NCM', form.ncm, (v: string) => setForm(f => ({ ...f, ncm: v.replace(/\D/g, '').slice(0, 8) })), 8, '21069090'],
                      ['CFOP', form.cfop, (v: string) => setForm(f => ({ ...f, cfop: v.replace(/\D/g, '').slice(0, 4) })), 4, '5102'],
                      ['CSOSN', form.csosn, (v: string) => setForm(f => ({ ...f, csosn: v.replace(/\D/g, '').slice(0, 3) })), 3, '102'],
                      ['Origem', form.origem, (v: string) => setForm(f => ({ ...f, origem: v.replace(/\D/g, '').slice(0, 1) })), 1, '0'],
                      ['Unidade', form.unidade_comercial, (v: string) => setForm(f => ({ ...f, unidade_comercial: v.toUpperCase().slice(0, 6) })), 6, 'UN'],
                      ['CEST', form.cest, (v: string) => setForm(f => ({ ...f, cest: v.replace(/\D/g, '').slice(0, 7) })), 7, '—'],
                    ] as Array<[string, string, (v: string) => void, number, string]>).map(([rotulo, valor, aoMudar, max, dica]) => (
                      <div key={rotulo}>
                        <Label>{rotulo}</Label>
                        <Input
                          value={valor}
                          onChange={e => aoMudar(e.target.value)}
                          maxLength={max}
                          placeholder={dica}
                          className={cn(CAMPO_DRAWER, 'font-mono')}
                        />
                      </div>
                    ))}
                    <p className="col-span-2 text-[12.5px] text-muted-foreground sm:col-span-3">
                      Já vem com valores padrão genéricos. Se seu contador pedir códigos específicos, ajuste aqui.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/*
              ─── Footer FIXO ───
              É a diferença prática do drawer: no card inline o botão de salvar
              descia junto com o formulário e, num cadastro longo, saía da tela
              justo na hora de usar.
            */}
            <SheetFooter className="flex flex-row items-center justify-between gap-3 border-t p-4">
              <Button type="button" variant="ghost" onClick={() => setEditando(null)} disabled={enviando}>
                Cancelar
              </Button>
              <div className="flex items-center gap-2">
                {/* "Salvar e criar outro" existe porque cadastro de cardápio é
                    trabalho em lote: são 30 itens numa sentada, e reabrir o drawer
                    a cada um dobra o número de cliques. */}
                <Button
                  type="submit"
                  variant="outline"
                  className="h-[46px] rounded-[10px]"
                  disabled={enviando}
                  onClick={() => { criarOutroRef.current = true; }}
                >
                  Salvar e criar outro
                </Button>
                <Button
                  type="submit"
                  className="h-[46px] rounded-[10px]"
                  loading={enviando}
                  loadingText="Salvando…"
                  onClick={() => { criarOutroRef.current = false; }}
                >
                  {editando === 'novo' ? 'Criar produto' : 'Salvar alterações'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>


      {/* ── Loading ── */}
      {consulta.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {/* ── Falha ── vem antes do vazio: sem isto, consulta que falhou mostrava
           "Nenhum produto ainda", ou seja, dizia que o cardápio está vazio
           quando na verdade não deu pra buscar. ── */}
      {consulta.isError && (
        <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />
      )}

      {/* ── Vazio ── */}
      {!consulta.isLoading && todos.length === 0 && !consulta.isError && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <UtensilsCrossed className="mx-auto size-12 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="font-semibold text-muted-foreground">Nenhum produto ainda</p>
            <p className="text-sm text-muted-foreground">
              Clique em "Novo produto" para montar seu cardápio.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Lista agrupada por categoria ── */}
      {Object.entries(porCategoria).map(([cat, subs]) => (
        <CategoriaSection
          key={cat}
          categoria={cat}
          subs={subs}
          onEditar={abrirEdicao}
          onExcluir={excluir}
          onAlternarDisponivel={alternarDisponivel}
          onVerOpcoes={p => setGerindoGrupos(p)}
          onDuplicar={duplicar}
          modoSelecao={modoSelecao}
          selecionados={selecionados}
          onToggleSelecao={alternarSelecao}
          densidade={densidade}
        />
      ))}
    </div>
  );
}

/* ─────────────────────── seletor de chips (categoria/subcategoria) ──────────────────────── */
/**
 * Altura e canto dos campos do drawer, num lugar só.
 *
 * O foco sobrescreve o padrão do `Input` (anel de 2px na cor `ring`, com offset) por
 * borda na cor da marca + anel de 3px translúcido sem offset: offset abre um vão
 * branco entre borda e anel, que num formulário com muitos campos lado a lado fica
 * visível como falha de alinhamento.
 */
const CAMPO_DRAWER = 'mt-1.5 h-[46px] rounded-[10px] text-[15px] shadow-none '
  + 'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:ring-offset-0';

/** Seção do drawer: rótulo em caixa alta pequena + divisor acima (menos na primeira). */
function SecaoDrawer({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-7 border-t border-border pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{titulo}</h4>
      {children}
    </section>
  );
}

/**
 * Linha com interruptor — título, descrição do efeito e o controle à direita.
 *
 * A DESCRIÇÃO NÃO É ENFEITE: "Destaque" sozinho não diz onde o produto aparece, e
 * "Controlar estoque" não diz que o item some do cardápio ao zerar. Sem a segunda
 * linha, o lojista liga e desliga pra descobrir o que faz.
 */
function LinhaInterruptor({ titulo, descricao, ativo, onAlternar, children }: {
  titulo: string; descricao: string; ativo: boolean; onAlternar: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{titulo}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{descricao}</div>
        </div>
        {/* `role="switch"` + `aria-checked`: é um botão, mas leitor de tela precisa
            anunciar o ESTADO, não só o rótulo. */}
        <button
          type="button"
          role="switch"
          aria-checked={ativo}
          aria-label={titulo}
          onClick={onAlternar}
          className={cn(
            'relative h-[26px] w-11 shrink-0 rounded-full transition-colors',
            ativo ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span className={cn(
            'absolute top-[3px] size-5 rounded-full bg-white shadow-sm transition-all',
            ativo ? 'left-[21px]' : 'left-[3px]',
          )} />
        </button>
      </div>
      {children}
    </div>
  );
}

function SeletorChips({
  label, valor, opcoes, onChange, placeholderNovo, rotuloNovo, obrigatorio = false, dica,
}: {
  label: string;
  valor: string;
  opcoes: string[];
  onChange: (v: string) => void;
  placeholderNovo: string;
  rotuloNovo: string;
  obrigatorio?: boolean;
  dica?: string;
}) {
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState('');

  const valorForaDaLista = valor && !opcoes.includes(valor);

  function confirmarNovo() {
    const v = novo.trim();
    if (!v) return;
    onChange(v);
    setNovo('');
    setCriando(false);
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <Label className="mb-0">{label}{obrigatorio && ' *'}</Label>
        {!obrigatorio && <span className="text-xs text-muted-foreground">(opcional)</span>}
        {valor && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {dica && <p className="text-xs text-muted-foreground mb-2">{dica}</p>}

      <div className="flex flex-wrap gap-2">
        {opcoes.map(op => {
          const ativo = valor === op;
          return (
            <button
              key={op}
              type="button"
              onClick={() => onChange(ativo ? '' : op)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                ativo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
              )}
            >
              {ativo && <Check className="size-3.5" strokeWidth={3} />}
              {op}
            </button>
          );
        })}

        {valorForaDaLista && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            <Check className="size-3.5" strokeWidth={3} />
            {valor}
            <span className="text-[10px] opacity-80">(nova)</span>
          </span>
        )}

        {criando ? (
          <div className="inline-flex items-center gap-1">
            <Input
              autoFocus
              value={novo}
              onChange={e => setNovo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); confirmarNovo(); }
                if (e.key === 'Escape') { setCriando(false); setNovo(''); }
              }}
              placeholder={placeholderNovo}
              className="h-9 w-52 text-sm rounded-full"
            />
            <button
              type="button"
              onClick={confirmarNovo}
              disabled={!novo.trim()}
              className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => { setCriando(false); setNovo(''); }}
              className="flex size-9 items-center justify-center rounded-full border border-input text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-input px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="size-3.5" /> {rotuloNovo}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── seção de categoria ──────────────────────── */
function CategoriaSection({
  categoria, subs, onEditar, onExcluir, onAlternarDisponivel, onVerOpcoes, onDuplicar,
  modoSelecao, selecionados, onToggleSelecao, densidade,
}: {
  categoria: string;
  subs: Record<string, Produto[]>;
  onEditar: (p: Produto) => void;
  onExcluir: (id: number, nome: string) => void;
  onAlternarDisponivel: (p: Produto) => void;
  onVerOpcoes: (p: Produto) => void;
  onDuplicar: (p: Produto) => void;
  modoSelecao: boolean;
  selecionados: Set<number>;
  onToggleSelecao: (id: number) => void;
  densidade: Densidade;
}) {
  const [aberta, setAberta] = useState(true);
  const total = Object.values(subs).flat().length;

  return (
    <div>
      <button
        className="flex w-full items-center justify-between gap-2 py-2 px-1"
        onClick={() => setAberta(a => !a)}
      >
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-primary" />
          <span className="font-bold text-sm uppercase tracking-wide">{categoria}</span>
          <span className="text-xs text-muted-foreground">({total})</span>
        </div>
        {aberta ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {aberta && (
        <div className="space-y-4">
          {Object.entries(subs).map(([sub, itens]) => (
            <div key={sub}>
              {sub && (
                <p className="text-xs font-semibold text-muted-foreground italic px-1 mb-1.5">
                  └ {sub}
                </p>
              )}
              <div className="space-y-2">
                {itens.map(p => (
                  <CardProduto
                    key={p.id}
                    produto={p}
                    onEditar={() => onEditar(p)}
                    onExcluir={() => onExcluir(p.id, p.nome)}
                    onAlternarDisponivel={() => onAlternarDisponivel(p)}
                    onVerOpcoes={() => onVerOpcoes(p)}
                    onDuplicar={() => onDuplicar(p)}
                    modoSelecao={modoSelecao}
                    selecionado={selecionados.has(p.id)}
                    onToggleSelecao={() => onToggleSelecao(p.id)}
                    densidade={densidade}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── card do produto ──────────────────────── */
function CardProduto({
  produto: p, onEditar, onExcluir, onAlternarDisponivel, onVerOpcoes, onDuplicar,
  modoSelecao, selecionado, onToggleSelecao, densidade,
}: {
  produto: Produto;
  onEditar: () => void;
  onExcluir: () => void;
  onAlternarDisponivel: () => void;
  onVerOpcoes: () => void;
  onDuplicar: () => void;
  modoSelecao: boolean;
  selecionado: boolean;
  onToggleSelecao: () => void;
  densidade: Densidade;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grupos = (p as any).grupos as GrupoOpcoes[] | undefined;
  const totalOpcoes = grupos?.reduce((s, g) => s + g.opcoes.length, 0) ?? 0;
  const totalGrupos = grupos?.length ?? 0;
  const compacta = densidade === 'compacta';

  return (
    <Card className={cn('transition-opacity', !p.disponivel && 'opacity-55', selecionado && 'ring-2 ring-primary')}>
      <CardContent className="p-0">
        <div
          className={cn('flex items-center gap-3', compacta ? 'p-1.5' : 'p-3', modoSelecao && 'cursor-pointer')}
          onClick={modoSelecao ? onToggleSelecao : undefined}
        >
          {/* Checkbox de seleção */}
          {modoSelecao && (
            <button type="button" onClick={e => { e.stopPropagation(); onToggleSelecao(); }} className="shrink-0 text-primary">
              {selecionado ? <CheckSquare className="size-5" /> : <Square className="size-5 text-muted-foreground" />}
            </button>
          )}
          {/* Foto */}
          {p.foto_url
            ? <img src={p.foto_url} alt={p.nome} className={cn('rounded-xl object-cover border border-border shrink-0 bg-muted', compacta ? 'size-9' : 'size-16')} />
            : <div className={cn('flex items-center justify-center rounded-xl bg-accent text-muted-foreground shrink-0', compacta ? 'size-9' : 'size-16')}>
                <UtensilsCrossed className={compacta ? 'size-4' : 'size-6'} strokeWidth={1.5} />
              </div>
          }

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm leading-tight truncate max-w-[180px]">{p.nome}</span>
              {p.destaque ? <Star className="size-3.5 text-amber-400 fill-amber-400 shrink-0" /> : null}
              {!p.disponivel && <Badge variant="secondary" className="text-[10px] px-1.5">Indisponível</Badge>}
              {p.controla_estoque ? (
                (p.estoque ?? 0) <= 0
                  ? <Badge variant="danger" className="text-[10px] px-1.5">Esgotado</Badge>
                  : <Badge variant={(p.estoque ?? 0) <= 5 ? 'secondary' : 'outline'} className="text-[10px] px-1.5">
                      {p.estoque} em estoque
                    </Badge>
              ) : null}
            </div>
            {!compacta && p.descricao && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.descricao}</p>
            )}
            <div className={cn('flex items-center gap-2', compacta ? 'mt-0.5' : 'mt-1')}>
              <span className="text-sm font-bold">{brl(p.preco_centavos)}</span>
              {p.preco_promocional_centavos ? (
                <Badge variant="success" className="text-[10px] px-1.5">
                  {brl(p.preco_promocional_centavos)}
                </Badge>
              ) : null}
            </div>
          </div>

          {/* Ações */}
          {!modoSelecao && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <button
                onClick={onAlternarDisponivel}
                className="text-muted-foreground hover:text-primary transition-colors"
                title={p.disponivel ? 'Tornar indisponível' : 'Tornar disponível'}
              >
                {p.disponivel
                  ? <ToggleRight className="size-6 text-primary" />
                  : <ToggleLeft className="size-6" />}
              </button>
              <div className="flex gap-0.5">
                <button
                  onClick={onEditar}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={onDuplicar}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="Duplicar"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  onClick={onExcluir}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-destructive"
                  title="Excluir"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Barra de adicionais — destaque visual (some na densidade compacta, o
            duplo-clique no card ou o botão editar continuam abrindo o produto) */}
        {!compacta && (
          <button
            onClick={onVerOpcoes}
            className={cn(
              'flex w-full items-center gap-2 border-t px-3 py-2 text-xs font-semibold transition-colors',
              totalGrupos > 0
                ? 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <SlidersHorizontal className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">
              {totalGrupos > 0
                ? `${totalGrupos} grupo${totalGrupos > 1 ? 's' : ''} · ${totalOpcoes} opç${totalOpcoes !== 1 ? 'ões' : 'ão'}`
                : 'Adicionar tamanhos, bordas e adicionais…'}
            </span>
            <Layers className="size-3.5 shrink-0 opacity-60" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── modal de grupos de opções ──────────────────────── */
function GruposModal({ produto, onFechar }: { produto: Produto; onFechar: () => void }) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const queryKey = ['lojista-grupos', produto.id];
  const [grupoFocoId, setGrupoFocoId] = useState<number | null>(null);
  const [criandoManual, setCriandoManual] = useState(false);
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  const focoRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api<{ grupos: GrupoOpcoes[] }>('GET', `/api/lojista/produtos/${produto.id}/grupos`)
        .then(r => r.grupos),
  });

  const grupos = data ?? [];

  // Auto-focus no input da opção após criar grupo — aguarda o render do novo card
  useEffect(() => {
    if (grupoFocoId === null || grupos.length === 0) return;
    const tentar = () => {
      const input = document.getElementById(`opcao-nome-${grupoFocoId}`) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setGrupoFocoId(null);
      }
    };
    // Tenta imediatamente e depois com micro-delay para garantir que o DOM atualizou
    tentar();
    const t = setTimeout(tentar, 80);
    return () => clearTimeout(t);
  }, [grupos, grupoFocoId]);

  type FormGrupo = { nome: string; tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: string };
  const [novoGrupo, setNovoGrupo] = useState<FormGrupo | null>(null);
  const [novasOpcoes, setNovasOpcoes] = useState<Record<number, { nome: string; preco: string }>>({});
  const [editandoGrupoId, setEditandoGrupoId] = useState<number | null>(null);
  const [editandoGrupoForm, setEditandoGrupoForm] = useState<FormGrupo | null>(null);
  const [editandoOpcaoId, setEditandoOpcaoId] = useState<number | null>(null);
  const [editandoOpcaoNome, setEditandoOpcaoNome] = useState('');
  const [editandoOpcaoPreco, setEditandoOpcaoPreco] = useState('');

  function opcaoForm(grupoId: number) {
    return novasOpcoes[grupoId] ?? { nome: '', preco: '' };
  }
  function setOpcaoForm(grupoId: number, campo: 'nome' | 'preco', valor: string) {
    setNovasOpcoes(prev => ({ ...prev, [grupoId]: { ...opcaoForm(grupoId), [campo]: valor } }));
  }

  function abrirEdicaoGrupo(grupo: GrupoOpcoes) {
    setEditandoGrupoId(grupo.id);
    setEditandoGrupoForm({
      nome: grupo.nome,
      tipo: grupo.tipo,
      obrigatorio: !!grupo.obrigatorio,
      max_escolhas: grupo.max_escolhas > 0 ? String(grupo.max_escolhas) : '',
    });
  }

  async function salvarEdicaoGrupo() {
    if (!editandoGrupoForm || !editandoGrupoId) return;
    if (!editandoGrupoForm.nome.trim()) {
      mostrar({ tipo: 'erro', titulo: 'O nome do grupo não pode ser vazio.' });
      return;
    }
    try {
      await api('PUT', `/api/lojista/grupos/${editandoGrupoId}`, {
        nome: editandoGrupoForm.nome.trim(),
        tipo: editandoGrupoForm.tipo,
        obrigatorio: editandoGrupoForm.obrigatorio,
        max_escolhas: editandoGrupoForm.tipo === 'multiplo'
          ? (Number(editandoGrupoForm.max_escolhas) || 0)
          : 1,
      });
      await qc.refetchQueries({ queryKey });
      setEditandoGrupoId(null);
      setEditandoGrupoForm(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar grupo.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function criarGrupoComDados(dados: { nome: string; tipo: 'unico' | 'multiplo'; obrigatorio: boolean; max_escolhas: number }) {
    setSalvandoGrupo(true);
    try {
      const res = await api<{ grupo_id: number }>('POST', `/api/lojista/produtos/${produto.id}/grupos`, dados);
      // refetchQueries aguarda o refetch completar, garantindo que 'grupos' estará populado
      await qc.refetchQueries({ queryKey });
      setGrupoFocoId(res.grupo_id);
      setCriandoManual(false);
      setNovoGrupo(null);
      mostrar({ tipo: 'sucesso', titulo: `Grupo "${dados.nome}" criado! Adicione as opções abaixo.` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao criar grupo. Tente novamente.';
      mostrar({ tipo: 'erro', titulo: msg });
    } finally {
      setSalvandoGrupo(false);
    }
  }

  async function adicionarSugestao(grupoId: number, nome: string) {
    try {
      await api('POST', `/api/lojista/grupos/${grupoId}/opcoes`, { nome, preco_adicional: '0' });
      await qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao adicionar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function atualizarOpcao(opcaoId: number) {
    if (!editandoOpcaoNome.trim()) return;
    try {
      await api('PUT', `/api/lojista/opcoes/${opcaoId}`, {
        nome: editandoOpcaoNome.trim(),
        preco_adicional: editandoOpcaoPreco || '0',
      });
      await qc.refetchQueries({ queryKey });
      setEditandoOpcaoId(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function criarGrupoManual() {
    if (!novoGrupo || !novoGrupo.nome.trim()) return;
    await criarGrupoComDados({
      nome: novoGrupo.nome.trim(),
      tipo: novoGrupo.tipo,
      obrigatorio: novoGrupo.obrigatorio,
      max_escolhas: novoGrupo.tipo === 'multiplo' ? (Number(novoGrupo.max_escolhas) || 0) : 1,
    });
  }

  async function excluirGrupo(grupoId: number) {
    if (!(await confirmar({ titulo: 'Remover este grupo?', descricao: 'Todas as opções dele serão removidas também.', confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/grupos/${grupoId}`);
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function criarOpcao(grupoId: number) {
    const f = opcaoForm(grupoId);
    if (!f.nome.trim()) return;
    try {
      await api('POST', `/api/lojista/grupos/${grupoId}/opcoes`, {
        nome: f.nome.trim(),
        preco_adicional: f.preco || '0',
      });
      await qc.refetchQueries({ queryKey });
      setNovasOpcoes(prev => ({ ...prev, [grupoId]: { nome: '', preco: '' } }));
      setTimeout(() => document.getElementById(`opcao-nome-${grupoId}`)?.focus(), 50);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao adicionar opção. Tente novamente.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function excluirOpcao(opcaoId: number) {
    try {
      await api('DELETE', `/api/lojista/opcoes/${opcaoId}`);
      qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao excluir opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  async function toggleDisponivel(opcao: OpcaoItem) {
    try {
      await api('PUT', `/api/lojista/opcoes/${opcao.id}`, { disponivel: !opcao.disponivel });
      qc.refetchQueries({ queryKey });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao atualizar opção.';
      mostrar({ tipo: 'erro', titulo: msg });
    }
  }

  const totalOpcoes = grupos.reduce((s, g) => s + g.opcoes.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3.5">
          <button
            onClick={onFechar}
            className="flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors"
            title="Voltar aos produtos"
          >
            <X className="size-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="flex items-center gap-2 font-bold text-base leading-tight truncate">
              <SlidersHorizontal className="size-4 text-primary shrink-0" />
              <span className="truncate">{produto.nome}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {grupos.length === 0
                ? 'Monte tamanhos, bordas e adicionais'
                : `${grupos.length} grupo${grupos.length > 1 ? 's' : ''} · ${totalOpcoes} opç${totalOpcoes !== 1 ? 'ões' : 'ão'}`}
            </p>
          </div>
          <Button size="sm" onClick={onFechar} className="shrink-0">
            <Check className="size-4" /> Concluir
          </Button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-4 space-y-3">
        {(isLoading || salvandoGrupo) && <Skeleton className="h-24 animate-pulse" />}

        {/* ── Estado vazio com templates ── */}
        {grupos.length === 0 && !isLoading && !criandoManual && (
          <div className="space-y-4 py-4">
            <div className="text-center max-w-md mx-auto">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 mb-3">
                <Layers className="size-6 text-primary" />
              </div>
              <p className="font-bold text-base">Quais opções este produto tem?</p>
              <p className="text-sm text-muted-foreground mt-1">
                Escolha um modelo abaixo — já vem com as configurações certas.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.nome}
                  type="button"
                  disabled={salvandoGrupo}
                  onClick={() => criarGrupoComDados({ nome: t.nome, tipo: t.tipo, obrigatorio: t.obrigatorio, max_escolhas: t.max_escolhas })}
                  className="group flex flex-col items-start gap-1 rounded-2xl border bg-card p-3.5 text-left shadow-sm hover:border-primary hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-bold text-sm">{t.nome}</span>
                    <Plus className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-xs text-muted-foreground leading-snug">{t.dica}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={salvandoGrupo}
              onClick={() => { setCriandoManual(true); setNovoGrupo({ nome: '', tipo: 'unico', obrigatorio: false, max_escolhas: '' }); }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="size-4" /> Criar grupo personalizado
            </button>
          </div>
        )}

        {/* ── Grupos existentes ── */}
        {grupos.map(grupo => (
          <Card key={grupo.id} className="overflow-hidden">
            {/* Cabeçalho do grupo */}
            {editandoGrupoId === grupo.id && editandoGrupoForm ? (
              <div className="px-3 py-3 bg-accent/40 border-b space-y-2">
                <Input
                  autoFocus
                  value={editandoGrupoForm.nome}
                  onChange={e => setEditandoGrupoForm(f => f && ({ ...f, nome: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvarEdicaoGrupo(); } if (e.key === 'Escape') { setEditandoGrupoId(null); } }}
                  className="h-8 text-sm font-bold"
                  placeholder="Nome do grupo"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {/* Tipo */}
                  <div className="flex rounded-lg overflow-hidden border border-border text-xs font-semibold">
                    <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, tipo: 'unico' }))}
                      className={cn('px-2.5 py-1 transition-colors', editandoGrupoForm.tipo === 'unico' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent')}>
                      Única escolha
                    </button>
                    <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, tipo: 'multiplo' }))}
                      className={cn('px-2.5 py-1 transition-colors border-l border-border', editandoGrupoForm.tipo === 'multiplo' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent')}>
                      Múltipla
                    </button>
                  </div>
                  {/* Obrigatório */}
                  <button type="button" onClick={() => setEditandoGrupoForm(f => f && ({ ...f, obrigatorio: !f.obrigatorio }))}
                    className={cn('flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors', editandoGrupoForm.obrigatorio ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-accent')}>
                    <Check className={cn('size-3', editandoGrupoForm.obrigatorio ? 'opacity-100' : 'opacity-0')} />
                    Obrigatório
                  </button>
                  {/* Máx escolhas (só se múltiplo) */}
                  {editandoGrupoForm.tipo === 'multiplo' && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Máx.</span>
                      <Input
                        type="number" min="0" placeholder="∞"
                        value={editandoGrupoForm.max_escolhas}
                        onChange={e => setEditandoGrupoForm(f => f && ({ ...f, max_escolhas: e.target.value }))}
                        className="h-7 w-14 text-xs text-center px-1"
                      />
                    </div>
                  )}
                  {/* Ações */}
                  <div className="flex gap-1 ml-auto">
                    <button type="button" onClick={salvarEdicaoGrupo}
                      className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-2.5 py-1 text-xs font-bold hover:bg-primary/90 transition-colors">
                      <Check className="size-3" /> Salvar
                    </button>
                    <button type="button" onClick={() => setEditandoGrupoId(null)}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent transition-colors">
                      <X className="size-3" /> Cancelar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-accent/40 border-b">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{grupo.nome}</span>
                    {grupo.obrigatorio ? (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">Obrigatório</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Opcional</Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {grupo.tipo === 'unico' ? 'Cliente escolhe 1' : 'Cliente escolhe vários'}
                    {grupo.tipo === 'multiplo' && grupo.max_escolhas > 0 && ` · até ${grupo.max_escolhas}`}
                    {' · '}{grupo.opcoes.length} opç{grupo.opcoes.length !== 1 ? 'ões' : 'ão'}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => abrirEdicaoGrupo(grupo)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Editar grupo"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => excluirGrupo(grupo.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remover grupo"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            )}

            <CardContent className="p-0">
              {/* ── Chips de sugestão (só quando vazio e tem sugestões) ── */}
              {grupo.opcoes.length === 0 && SUGESTOES[grupo.nome] && (
                <div className="px-4 pt-4 pb-2">
                  <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wide">Sugestões — clique para adicionar:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGESTOES[grupo.nome].map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => adicionarSugestao(grupo.id, s)}
                        className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors active:scale-95"
                      >
                        <Plus className="size-3" />{s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Lista de opções existentes ── */}
              <div className={cn('px-3 space-y-1', grupo.opcoes.length > 0 ? 'py-2' : 'pt-2')}>
                {grupo.opcoes.map(o => (
                  editandoOpcaoId === o.id ? (
                    /* modo edição inline */
                    <div key={o.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-accent/60">
                      <Input
                        autoFocus
                        value={editandoOpcaoNome}
                        onChange={e => setEditandoOpcaoNome(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } if (e.key === 'Escape') setEditandoOpcaoId(null); }}
                        className="h-8 text-sm flex-1"
                        placeholder="Nome da opção"
                      />
                      <div className="relative w-20 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">+R$</span>
                        <Input
                          type="number" step="0.01" min="0" placeholder="0,00"
                          value={editandoOpcaoPreco}
                          onChange={e => setEditandoOpcaoPreco(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); atualizarOpcao(o.id); } }}
                          className="h-8 text-xs pl-6"
                        />
                      </div>
                      <button onClick={() => atualizarOpcao(o.id)} className="shrink-0 p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                        <Check className="size-3.5" />
                      </button>
                      <button onClick={() => setEditandoOpcaoId(null)} className="shrink-0 p-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    /* modo normal */
                    <div
                      key={o.id}
                      className={cn('group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-accent/40 transition-colors', !o.disponivel && 'opacity-45')}
                    >
                      <button
                        className="flex-1 text-left text-sm font-medium truncate"
                        onClick={() => { setEditandoOpcaoId(o.id); setEditandoOpcaoNome(o.nome); setEditandoOpcaoPreco(o.preco_adicional_centavos > 0 ? String(o.preco_adicional_centavos / 100) : ''); }}
                      >
                        {o.nome}
                      </button>
                      {o.preco_adicional_centavos > 0 && (
                        <span className="text-xs font-bold text-primary shrink-0">+ {brl(o.preco_adicional_centavos)}</span>
                      )}
                      <Pencil
                        className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 cursor-pointer transition-opacity"
                        onClick={() => { setEditandoOpcaoId(o.id); setEditandoOpcaoNome(o.nome); setEditandoOpcaoPreco(o.preco_adicional_centavos > 0 ? String(o.preco_adicional_centavos / 100) : ''); }}
                      />
                      <button onClick={() => toggleDisponivel(o)} title={o.disponivel ? 'Desativar' : 'Ativar'} className="shrink-0">
                        {o.disponivel ? <ToggleRight className="size-5 text-primary" /> : <ToggleLeft className="size-5 text-muted-foreground" />}
                      </button>
                      <button onClick={() => excluirOpcao(o.id)} className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )
                ))}

                {grupo.opcoes.length === 0 && !SUGESTOES[grupo.nome] && (
                  <p className="text-xs text-muted-foreground text-center py-3 italic">
                    Nenhuma opção ainda — use o campo abaixo para adicionar
                  </p>
                )}
              </div>

              {/* ── Form de adicionar nova opção ── */}
              <div className="border-t border-border/60 px-3 py-3">
                <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wide">
                  {grupo.opcoes.length === 0 ? 'Adicione a primeira opção:' : 'Nova opção:'}
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    id={`opcao-nome-${grupo.id}`}
                    ref={grupoFocoId === grupo.id ? focoRef : undefined}
                    placeholder={SUGESTOES[grupo.nome]?.[0] ? `Ex.: ${SUGESTOES[grupo.nome][0]}…` : 'Nome da opção…'}
                    value={opcaoForm(grupo.id).nome}
                    onChange={e => setOpcaoForm(grupo.id, 'nome', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                    className="h-10 text-sm flex-1"
                  />
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">+R$</span>
                    <Input
                      type="number" step="0.01" min="0" placeholder="0,00"
                      value={opcaoForm(grupo.id).preco}
                      onChange={e => setOpcaoForm(grupo.id, 'preco', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarOpcao(grupo.id))}
                      className="h-10 text-sm pl-7"
                    />
                  </div>
                  <Button
                    type="button"
                    className="h-10 px-4 shrink-0"
                    onClick={() => criarOpcao(grupo.id)}
                    disabled={!opcaoForm(grupo.id).nome.trim()}
                  >
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Botão para adicionar mais grupos após ter ao menos 1 */}
        {grupos.length > 0 && !criandoManual && novoGrupo === null && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {TEMPLATES.filter(t => !grupos.some(g => g.nome === t.nome)).slice(0, 4).map(t => (
              <button
                key={t.nome}
                type="button"
                onClick={() => criarGrupoComDados({ nome: t.nome, tipo: t.tipo, obrigatorio: t.obrigatorio, max_escolhas: t.max_escolhas })}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border hover:border-primary hover:bg-primary/5 px-3 py-2 text-left text-sm transition-all"
              >
                <Plus className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium text-xs">{t.nome}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setCriandoManual(true); setNovoGrupo({ nome: '', tipo: 'multiplo', obrigatorio: false, max_escolhas: '' }); }}
              className="flex items-center gap-2 rounded-xl border border-dashed border-border hover:border-primary hover:bg-primary/5 px-3 py-2 text-left text-sm transition-all col-span-2"
            >
              <Plus className="size-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Grupo personalizado…</span>
            </button>
          </div>
        )}

        {/* Formulário de novo grupo manual */}
        {(criandoManual || novoGrupo !== null) && novoGrupo !== null && (
          <Card className="border-primary/40">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">Novo grupo personalizado</span>
                <button
                  onClick={() => { setCriandoManual(false); setNovoGrupo(null); }}
                  className="p-1 hover:bg-accent rounded-lg"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div>
                <Label>Nome do grupo *</Label>
                <Input
                  autoFocus
                  placeholder="Ex.: Tamanho, Borda, Adicionais, Ponto da carne…"
                  value={novoGrupo.nome}
                  onChange={e => setNovoGrupo(g => g && ({ ...g, nome: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), criarGrupoManual())}
                />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex gap-3">
                  {(['unico', 'multiplo'] as const).map(t => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name={`tipo-grupo-${produto.id}`}
                        checked={novoGrupo.tipo === t}
                        onChange={() => setNovoGrupo(g => g && ({ ...g, tipo: t }))}
                        className="accent-primary"
                      />
                      <span className="text-sm">{t === 'unico' ? 'Escolha única' : 'Múltipla escolha'}</span>
                    </label>
                  ))}
                </div>
                {novoGrupo.tipo === 'multiplo' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Máx.:</span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0 = sem limite"
                      value={novoGrupo.max_escolhas}
                      onChange={e => setNovoGrupo(g => g && ({ ...g, max_escolhas: e.target.value }))}
                      className="w-28 h-8 text-sm"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={novoGrupo.obrigatorio}
                  onChange={e => setNovoGrupo(g => g && ({ ...g, obrigatorio: e.target.checked }))}
                  className="accent-primary size-4 rounded"
                />
                <span className="text-sm">Obrigatório</span>
                <span className="text-muted-foreground text-xs">(cliente deve selecionar antes de adicionar ao carrinho)</span>
              </label>

              <div className="flex gap-2 pt-1">
                <Button onClick={criarGrupoManual} disabled={!novoGrupo.nome.trim()} className="flex-1">
                  <Plus className="size-4" /> Criar grupo
                </Button>
                <Button variant="outline" onClick={() => { setCriandoManual(false); setNovoGrupo(null); }}>
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
