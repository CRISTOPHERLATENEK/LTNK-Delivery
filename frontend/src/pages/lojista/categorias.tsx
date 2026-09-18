/**
 * Gestão de categorias do cardápio: criar, apagar, renomear, ordenar, escolher
 * ícone e foto, agrupar em setores de impressão e ajustar como a faixa de
 * categorias aparece na vitrine do cliente.
 *
 * ───────────────────────── POR QUE A TELA FOI REORGANIZADA ─────────────────
 *
 * A ORDEM ERA AO CONTRÁRIO DO USO. A página começava em "Setores de impressão"
 * — assunto de quem está configurando impressora, uma vez na vida — e a LISTA
 * de categorias, que é o motivo de abrir esta tela, ficava por último. Com 22
 * categorias, cada uma carregando uma área de "arraste ou clique" aberta, a
 * primeira categoria aparecia a três rolares de distância. Agora: prévia,
 * lista, e só depois aparência e setores, que abrem quando são o assunto.
 *
 * O SELETOR DE FOTO SAIU DE DENTRO DE CADA LINHA. Vinte e duas caixas
 * tracejadas empilhadas viravam uma coluna onde não dava para ler nome nenhum.
 * Cada linha agora tem um botão de foto — miniatura quando já existe uma — que
 * abre o seletor só daquela categoria.
 *
 * A PRÉVIA SUBIU E PASSOU A VALER PARA OS DOIS ESTILOS. Ela estava dentro da
 * seção de aparência e só existia em "cards": justamente quem escolhia "chips"
 * não via o que estava escolhendo. Continua usando as classes da vitrine
 * (`lib/categoria-visual` e as mesmas do `ChipCategoria` da loja), então o que
 * aparece aqui é o que o cliente vê — inclusive o "Todos" já ativo, que é como
 * a faixa nasce na loja.
 *
 * BUSCA E FILTRO POR SETOR. Achar "SOBREMESAS" no meio de 22 nomes era
 * varredura visual; agora são três letras. Com filtro ligado o reordenar fica
 * desligado de propósito: arrastar a terceira linha VISÍVEL para cima não diz
 * nada sobre a posição dela na fileira real.
 *
 * APAGAR CATEGORIA EXISTIA NO SERVIDOR E NÃO EXISTIA AQUI. Passou a existir,
 * com a mesma regra do resto do sistema: com produtos dentro, o apagar exige
 * para onde eles vão. Ele GRAVA NA HORA — o resto da tela é "salvar no fim" —,
 * então salva o que estiver pendente antes, senão os renomes ainda não gravados
 * iriam embora no recarregamento que vem depois.
 *
 * A BARRA DE SALVAR GRUDA NO RODAPÉ e diz se há alteração pendente. Antes o
 * botão ficava no fim da página: dava para renomear seis categorias, sair e
 * perder tudo sem aviso nenhum.
 */
import { createElement, useEffect, useMemo, useState } from 'react';
import {
  Tag, Save, ChevronUp, ChevronDown, LayoutGrid, Type, Printer, Plus, X, Pencil,
  Search, GripVertical, Trash2, Camera, Check, SlidersHorizontal, Eye, AlertTriangle,
} from 'lucide-react';
import { Ajuda } from '@/components/ui/ajuda';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ImageUpload } from '@/components/ui/image-upload';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ICONES_CATEGORIA, iconeCategoria } from '@/lib/icones-categoria';
import { useRascunho, useAvisoNaoSalvo } from '@/lib/nao-salvo';
import {
  FORMATOS, TAMANHOS, classesCategoria, normalizarFormato, normalizarTamanho,
  type FormatoCategoria, type TamanhoCategoria,
} from '@/lib/categoria-visual';

interface Cat {
  nome: string; icone: string; imagem: string; nomeEdit: string; setorId: number | null;
  /** Foto que ela herdaria de um produto — só pra prévia não mentir. */
  imagemAuto: string;
  /** Quantos produtos usam. Vem do servidor; é o que permite perguntar antes de apagar. */
  produtos: number;
}
interface Setor { id: number; nome: string; categorias: number }

/** Sentinela do "Sem setor" nos `select` — `""` já é o placeholder desabilitado. */
const SEM_SETOR = '__sem';

/** O nome que vai para o servidor: o editado, se houver, senão o atual. */
function nomeFinal(c: Cat) { return c.nomeEdit.trim() || c.nome; }

function plural(n: number, um: string, muitos: string) { return `${n} ${n === 1 ? um : muitos}`; }

/** Grade de ícones reaproveitada no picker de cada categoria e no de "nova categoria". */
function GradeIcones({ selecionado, onEscolher }: { selecionado: string; onEscolher: (chave: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl bg-muted/50 p-2">
      {ICONES_CATEGORIA.map(({ chave, label, Icone }) => (
        <button
          key={chave}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={selecionado === chave}
          onClick={() => onEscolher(chave)}
          className={cn(
            'flex size-9 items-center justify-center rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selecionado === chave
              ? 'bg-primary/20 text-primary ring-1 ring-primary/50'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )}
        >
          <Icone className="size-[18px]" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

/**
 * Botão de escolha única (estilo, formato, tamanho).
 *
 * `basis-[calc(50%-0.25rem)]` + quebra no pai: os três de "Formato" pedem 360px
 * de conteúdo e a coluna tem 309 no celular. Sem isso eles não encolhiam abaixo
 * do texto e empurravam a TELA INTEIRA para 409px.
 */
function Segmento({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors sm:basis-auto',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        ativo
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Cartão que abre e fecha — o que não é o assunto de agora fica de fora do caminho. */
function Secao({ titulo, resumo, icone, aberta, onAlternar, children }: {
  titulo: string; resumo: string; icone: React.ReactNode;
  aberta: boolean; onAlternar: () => void; children: React.ReactNode;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberta}
        className="flex w-full items-center gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="shrink-0 text-primary">{icone}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{titulo}</span>
          <span className="block truncate text-xs text-muted-foreground">{resumo}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberta && 'rotate-180')} />
      </button>
      {aberta && <CardContent className="space-y-4 p-4 pt-0">{children}</CardContent>}
    </Card>
  );
}

export function CategoriasLoja() {
  const { mostrar } = useToast();

  // — o que é salvo —
  const [cats, setCats] = useState<Cat[]>([]);
  const [estilo, setEstilo] = useState<'cards' | 'chips'>('cards');
  const [formato, setFormato] = useState<FormatoCategoria>('circulo');
  const [tamanho, setTamanho] = useState<TamanhoCategoria>('medio');
  const [todosImagem, setTodosImagem] = useState('');
  const [fotoAuto, setFotoAuto] = useState(true);

  // — o que vem pronto do servidor —
  const [setores, setSetores] = useState<Setor[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [versao, setVersao] = useState(0);
  const [enviando, setEnviando] = useState(false);

  // — só interface —
  const [busca, setBusca] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('todos');
  const [painel, setPainel] = useState<{ nome: string; qual: 'icone' | 'foto' } | null>(null);
  const [apagando, setApagando] = useState('');
  const [erroApagar, setErroApagar] = useState('');
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [aparenciaAberta, setAparenciaAberta] = useState(false);
  const [setoresAberto, setSetoresAberto] = useState(false);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvoArrasto, setAlvoArrasto] = useState<number | null>(null);
  const [novaCatNome, setNovaCatNome] = useState('');
  const [novaCatIcone, setNovaCatIcone] = useState('geral');
  const [novaCatPicker, setNovaCatPicker] = useState(false);
  const [novoSetor, setNovoSetor] = useState('');
  const [renomeandoSetor, setRenomeandoSetor] = useState<number | null>(null);
  const [nomeSetorEdit, setNomeSetorEdit] = useState('');
  const [setorApagando, setSetorApagando] = useState<number | null>(null);

  /*
   * O PONTO DE COMPARAÇÃO É MARCADO NUM EFEITO, não dentro do `.then` do
   * carregamento: ali o estado novo ainda não passou por um render, e
   * `marcarSalvo()` fixaria o conteúdo ANTIGO — a tela nasceria suja.
   */
  const rascunho = useMemo(() => ({
    estilo, formato, tamanho, todosImagem, fotoAuto,
    itens: cats.map(c => ({ de: c.nome, para: nomeFinal(c), icone: c.icone, imagem: c.imagem, setor: c.setorId })),
  }), [estilo, formato, tamanho, todosImagem, fotoAuto, cats]);
  const { sujo, marcarSalvo } = useRascunho(rascunho);
  useAvisoNaoSalvo(sujo, 'Você tem alterações não salvas nas categorias. Sair e perder?');
  useEffect(() => { if (versao > 0) marcarSalvo(); }, [versao, marcarSalvo]);

  function carregar() {
    return api<{
      categorias: { nome: string; icone: string; imagem: string; imagem_auto: string; setor_id: number | null; produtos?: number }[];
      estilo: 'cards' | 'chips'; formato: string; tamanho: string; todos_imagem: string; foto_auto: number;
    }>('GET', '/api/lojista/categorias')
      .then(r => {
        setCats(r.categorias.map(c => ({
          nome: c.nome, icone: c.icone, imagem: c.imagem || '', imagemAuto: c.imagem_auto || '',
          nomeEdit: c.nome, setorId: c.setor_id, produtos: Number(c.produtos ?? 0),
        })));
        setEstilo(r.estilo === 'chips' ? 'chips' : 'cards');
        setFormato(normalizarFormato(r.formato));
        setTamanho(normalizarTamanho(r.tamanho));
        setTodosImagem(r.todos_imagem || '');
        setFotoAuto(r.foto_auto !== 0);
        setCarregado(true);
        setVersao(v => v + 1);
      })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as categorias.' }));
  }

  function carregarSetores() {
    return api<{ setores: Setor[] }>('GET', '/api/lojista/setores')
      .then(r => setSetores(r.setores))
      .catch(() => {});
  }

  useEffect(() => { carregar(); carregarSetores(); }, []);

  // ───────────────────────────── setores ─────────────────────────────

  async function criarSetor() {
    const nome = novoSetor.trim();
    if (!nome) return;
    try {
      await api('POST', '/api/lojista/setores', { nome });
      setNovoSetor('');
      carregarSetores();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function renomearSetor(id: number) {
    const nome = nomeSetorEdit.trim();
    if (!nome) return;
    try {
      await api('PUT', `/api/lojista/setores/${id}`, { nome });
      setRenomeandoSetor(null);
      carregarSetores();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluirSetor(id: number) {
    try {
      await api('DELETE', `/api/lojista/setores/${id}`);
      setSetorApagando(null);
      setFiltroSetor(f => (f === String(id) ? 'todos' : f));
      carregarSetores();
      // O servidor já zerou o vínculo; a tela acompanha sem recarregar (o que
      // jogaria fora renomes ainda não salvos).
      setCats(c => c.map(x => (x.setorId === id ? { ...x, setorId: null } : x)));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  // ─────────────────────────── lista e ordem ──────────────────────────

  function setCampo(i: number, patch: Partial<Cat>) {
    setCats(c => c.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    setCats(c => { const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }

  function reordenar(de: number, para: number) {
    if (de === para) return;
    setCats(c => { const n = [...c]; const [item] = n.splice(de, 1); n.splice(para, 0, item); return n; });
  }

  function criarCategoria() {
    const nome = novaCatNome.trim();
    if (!nome) return;
    if (cats.some(c => nomeFinal(c).toLowerCase() === nome.toLowerCase())) {
      mostrar({ tipo: 'erro', titulo: 'Já existe uma categoria com esse nome.' });
      return;
    }
    setCats(c => [...c, { nome, icone: novaCatIcone, imagem: '', imagemAuto: '', nomeEdit: nome, setorId: null, produtos: 0 }]);
    setNovaCatNome('');
    setNovaCatIcone('geral');
    setNovaCatPicker(false);
    // Filtro ligado esconderia a categoria recém-criada — e ela é o que a
    // pessoa quer ver agora.
    setBusca('');
    setFiltroSetor('todos');
  }

  function alternarSelecao(nome: string) {
    setSelecionadas(s => (s.includes(nome) ? s.filter(x => x !== nome) : [...s, nome]));
  }

  function aplicarSetorEmLote(valor: string) {
    if (!valor) return;
    const setorId = valor === SEM_SETOR ? null : Number(valor);
    setCats(c => c.map(x => (selecionadas.includes(x.nome) ? { ...x, setorId } : x)));
  }

  // ───────────────────────────── gravação ─────────────────────────────

  async function salvar(silencioso = false): Promise<boolean> {
    if (cats.some(c => !c.nomeEdit.trim())) {
      mostrar({ tipo: 'erro', titulo: 'Tem categoria sem nome.' });
      return false;
    }
    const nomes = cats.map(c => nomeFinal(c).toLowerCase());
    const repetido = nomes.findIndex((n, i) => nomes.indexOf(n) !== i);
    if (repetido >= 0) {
      mostrar({ tipo: 'erro', titulo: `Duas categorias com o nome “${nomeFinal(cats[repetido])}”.` });
      return false;
    }
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/categorias', {
        estilo,
        formato,
        tamanho,
        todos_imagem: todosImagem,
        foto_auto: fotoAuto,
        itens: cats.map((c, i) => ({
          nome: c.nome, icone: c.icone, imagem: c.imagem, ordem: i, setor_id: c.setorId,
          renomear_para: nomeFinal(c) !== c.nome ? nomeFinal(c) : undefined,
        })),
      });
      if (!silencioso) mostrar({ tipo: 'sucesso', titulo: 'Categorias salvas!' });
      await Promise.all([carregar(), carregarSetores()]);
      return true;
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
      return false;
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Apagar grava na hora, então o que estiver pendente vai junto antes —
   * senão o recarregamento que vem depois levaria os renomes embora.
   */
  async function apagarCategoria(alvo: string, destino: string) {
    setOcupadoApagar(true);
    setErroApagar('');
    try {
      if (sujo) {
        const ok = await salvar(true);
        if (!ok) { setErroApagar('Não deu pra salvar as alterações pendentes. Corrija e tente de novo.'); return; }
      }
      const r = await api<{ movidos: number; destino: string }>(
        'DELETE', `/api/lojista/categorias/${encodeURIComponent(alvo)}`, destino ? { destino } : {},
      );
      mostrar({
        tipo: 'sucesso',
        titulo: r.movidos
          ? `“${alvo}” apagada — ${plural(r.movidos, 'produto foi', 'produtos foram')} para “${r.destino}”.`
          : `“${alvo}” apagada.`,
      });
      setApagando('');
      setSelecionadas(s => s.filter(x => x !== alvo));
      await Promise.all([carregar(), carregarSetores()]);
    } catch (err) {
      setErroApagar(err instanceof ApiError ? err.message : 'Não deu pra apagar.');
    } finally {
      setOcupadoApagar(false);
    }
  }

  // ─────────────────────────────── vista ──────────────────────────────

  const filtrando = busca.trim() !== '' || filtroSetor !== 'todos';
  const podeOrdenar = !filtrando && !modoSelecao;

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return cats
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (t && !nomeFinal(c).toLowerCase().includes(t)) return false;
        if (filtroSetor === 'sem') return c.setorId === null;
        if (filtroSetor !== 'todos') return String(c.setorId) === filtroSetor;
        return true;
      });
  }, [cats, busca, filtroSetor]);

  const resumoAparencia = estilo === 'chips'
    ? 'Chips de texto'
    : `Cards com ícone · ${FORMATOS.find(f => f.valor === formato)?.rotulo} · ${TAMANHOS.find(t => t.valor === tamanho)?.rotulo}`;

  const resumoSetores = setores.length
    ? setores.map(s => `${s.nome} (${cats.filter(c => c.setorId === s.id).length})`).join(' · ')
    : 'Nenhum setor — tudo sai na mesma impressora';

  if (!carregado) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2">
          <Tag className="size-5 text-primary" />
          <span className="inline-flex items-baseline gap-1.5">
            <h1 className="text-lg font-extrabold">Categorias</h1>
            <Ajuda chave="categorias" />
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {plural(cats.length, 'categoria', 'categorias')}
          {' · '}
          {plural(cats.reduce((t, c) => t + c.produtos, 0), 'produto', 'produtos')}
        </span>
      </div>

      {/* ───── Prévia: o que o cliente vê, com as classes da própria vitrine ── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Label className="flex items-center gap-1.5"><Eye className="size-3.5" /> Prévia da vitrine</Label>
            <span className="text-xs text-muted-foreground">{resumoAparencia}</span>
          </div>
          {cats.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
              Crie uma categoria abaixo pra ver como a faixa fica na loja.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl bg-muted/40 p-3">
              {estilo === 'cards' ? (
                <div className="flex gap-2.5">
                  {/* O "Todos" também aceita foto escolhida, e na loja ele nasce ativo. */}
                  <BolhaPrevia nome="Todos" icone="geral" foto={todosImagem} ativo formato={formato} tamanho={tamanho} />
                  {cats.map(c => (
                    <BolhaPrevia
                      key={c.nome}
                      nome={nomeFinal(c)}
                      icone={c.icone}
                      /* Mesma precedência da vitrine: escolhida > herdada (se ligada) > ícone. */
                      foto={c.imagem || (fotoAuto ? c.imagemAuto : '')}
                      ativo={false}
                      formato={formato}
                      tamanho={tamanho}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <ChipPrevia label="Todos" ativo />
                  {cats.map(c => <ChipPrevia key={c.nome} label={nomeFinal(c)} ativo={false} />)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ───── A lista: o motivo de abrir esta tela ───────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar categoria…"
                aria-label="Buscar categoria"
                className="h-10 pl-9 pr-9 text-sm"
              />
              {!!busca && (
                <button
                  type="button"
                  onClick={() => setBusca('')}
                  aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {setores.length > 0 && (
              <select
                value={filtroSetor}
                onChange={e => setFiltroSetor(e.target.value)}
                aria-label="Filtrar por setor de impressão"
                className="h-10 shrink-0 rounded-xl border border-input bg-background px-2.5 text-xs font-semibold"
              >
                <option value="todos">Todos os setores</option>
                <option value="sem">Sem setor</option>
                {setores.map(s => <option key={s.id} value={String(s.id)}>{s.nome}</option>)}
              </select>
            )}
            {cats.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant={modoSelecao ? 'secondary' : 'outline'}
                onClick={() => { setModoSelecao(v => !v); setSelecionadas([]); }}
                className="shrink-0"
              >
                {modoSelecao ? 'Concluir' : 'Selecionar'}
              </Button>
            )}
          </div>

          {/* Nova categoria — linha tracejada, no topo da lista onde é vista. */}
          <div className="rounded-xl border border-dashed border-border p-2.5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNovaCatPicker(a => !a)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Escolher ícone da nova categoria"
                aria-label="Escolher ícone da nova categoria"
                aria-expanded={novaCatPicker}
              >
                {(() => {
                  const Icone = iconeCategoria(novaCatIcone);
                  return Icone ? <Icone className="size-5" strokeWidth={1.75} /> : null;
                })()}
              </button>
              <Input
                value={novaCatNome}
                onChange={e => setNovaCatNome(e.target.value)}
                placeholder="Nome da nova categoria (ex.: Pizzas)"
                aria-label="Nome da nova categoria"
                className="h-10 min-w-[160px] flex-1 text-sm"
                onKeyDown={e => e.key === 'Enter' && criarCategoria()}
              />
              <Button type="button" variant="outline" size="sm" onClick={criarCategoria} disabled={!novaCatNome.trim()} className="h-10 shrink-0">
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {novaCatPicker && (
              <div className="mt-2">
                <GradeIcones selecionado={novaCatIcone} onEscolher={chave => { setNovaCatIcone(chave); setNovaCatPicker(false); }} />
              </div>
            )}
          </div>

          {modoSelecao && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/40 bg-primary/5 p-2.5">
              <span className="text-xs font-bold">{plural(selecionadas.length, 'selecionada', 'selecionadas')}</span>
              <button
                type="button"
                onClick={() => setSelecionadas(visiveis.map(({ c }) => c.nome))}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Marcar {filtrando ? 'as filtradas' : 'todas'}
              </button>
              {selecionadas.length > 0 && (
                <button type="button" onClick={() => setSelecionadas([])} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Limpar
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {setores.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Crie um setor abaixo pra agrupar.</span>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">Setor:</span>
                    <select
                      value=""
                      disabled={selecionadas.length === 0}
                      onChange={e => { aplicarSetorEmLote(e.target.value); e.currentTarget.value = ''; }}
                      aria-label="Definir o setor das categorias selecionadas"
                      className="h-9 rounded-lg border border-input bg-background px-2 text-xs font-semibold disabled:opacity-50"
                    >
                      <option value="" disabled>Definir…</option>
                      <option value={SEM_SETOR}>Sem setor</option>
                      {setores.map(s => <option key={s.id} value={String(s.id)}>{s.nome}</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
          )}

          {filtrando && cats.length > 1 && (
            <p className="px-0.5 text-xs text-muted-foreground">
              Mostrando {visiveis.length} de {cats.length}. Reordenar fica desligado com filtro — a posição
              aqui não seria a da fileira real.
            </p>
          )}

          {cats.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              Nenhuma categoria ainda. Crie uma acima, ou adicione produtos com categoria na aba Produtos.
            </p>
          ) : visiveis.length === 0 ? (
            <div className="rounded-xl bg-muted/40 p-6 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma categoria com esse filtro.</p>
              <button
                type="button"
                onClick={() => { setBusca(''); setFiltroSetor('todos'); }}
                className="mt-1.5 text-xs font-semibold text-primary hover:underline"
              >
                Limpar busca e filtro
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {visiveis.map(({ c, i }) => {
                const marcada = selecionadas.includes(c.nome);
                const painelAberto = painel?.nome === c.nome ? painel.qual : null;
                const outras = cats.filter(o => o.nome !== c.nome);
                return (
                  <div
                    key={c.nome}
                    onDragOver={e => { if (!podeOrdenar || arrastando === null) return; e.preventDefault(); setAlvoArrasto(i); }}
                    onDrop={e => {
                      if (!podeOrdenar || arrastando === null) return;
                      e.preventDefault();
                      reordenar(arrastando, i);
                      setArrastando(null);
                      setAlvoArrasto(null);
                    }}
                    className={cn(
                      'rounded-xl border p-2 transition-colors',
                      arrastando === i && 'opacity-40',
                      alvoArrasto === i && arrastando !== null && arrastando !== i
                        ? 'border-primary bg-primary/5'
                        : marcada ? 'border-primary/50 bg-primary/5' : 'border-border/60',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {modoSelecao ? (
                        <button
                          type="button"
                          onClick={() => alternarSelecao(c.nome)}
                          role="checkbox"
                          aria-checked={marcada}
                          aria-label={`Selecionar ${nomeFinal(c)}`}
                          className={cn(
                            'grid size-10 shrink-0 place-items-center rounded-xl border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            marcada ? 'border-primary bg-primary/15 text-primary' : 'border-border text-transparent hover:bg-accent',
                          )}
                        >
                          <Check className="size-4" strokeWidth={3} />
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center">
                          {/*
                            O PUNHO ARRASTA E AS SETAS CONTINUAM. Arrastar é o que
                            resolve mover a 22ª para o topo; as setas são o que
                            funciona no dedo e no teclado, onde arrasto HTML5 não
                            existe. Tirar uma das duas deixa alguém sem saída.
                          */}
                          <span
                            draggable={podeOrdenar}
                            onDragStart={e => {
                              if (!podeOrdenar) return;
                              setArrastando(i);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', String(i));
                            }}
                            onDragEnd={() => { setArrastando(null); setAlvoArrasto(null); }}
                            title={podeOrdenar ? 'Arraste para reordenar' : 'Limpe o filtro para reordenar'}
                            className={cn(
                              'hidden px-0.5 text-muted-foreground/60 sm:block',
                              podeOrdenar ? 'cursor-grab active:cursor-grabbing hover:text-foreground' : 'opacity-30',
                            )}
                          >
                            <GripVertical className="size-4" />
                          </span>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => mover(i, -1)}
                              disabled={!podeOrdenar || i === 0}
                              aria-label={`Subir ${nomeFinal(c)}`}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                              <ChevronUp className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => mover(i, 1)}
                              disabled={!podeOrdenar || i === cats.length - 1}
                              aria-label={`Descer ${nomeFinal(c)}`}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                              <ChevronDown className="size-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setPainel(p => (p?.nome === c.nome && p.qual === 'icone' ? null : { nome: c.nome, qual: 'icone' }))}
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Escolher ícone"
                        aria-label={`Escolher ícone de ${nomeFinal(c)}`}
                        aria-expanded={painelAberto === 'icone'}
                      >
                        {(() => {
                          const Icone = iconeCategoria(c.icone);
                          return Icone ? <Icone className="size-5" strokeWidth={1.75} /> : <span className="text-xl">{c.icone || '🍴'}</span>;
                        })()}
                      </button>

                      <Input
                        value={c.nomeEdit}
                        onChange={e => setCampo(i, { nomeEdit: e.target.value })}
                        aria-label={`Nome da categoria ${c.nome}`}
                        className={cn('h-10 min-w-[120px] flex-1 text-sm', !c.nomeEdit.trim() && 'border-destructive')}
                      />

                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {c.produtos === 0 ? 'vazia' : plural(c.produtos, 'produto', 'produtos')}
                        </span>

                        {setores.length > 0 && (
                          <select
                            value={c.setorId ?? ''}
                            onChange={e => setCampo(i, { setorId: e.target.value ? Number(e.target.value) : null })}
                            aria-label={`Setor de impressão de ${nomeFinal(c)}`}
                            title="Setor de impressão"
                            className="h-10 max-w-[120px] rounded-xl border border-input bg-background px-2 text-xs"
                          >
                            <option value="">Sem setor</option>
                            {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                          </select>
                        )}

                        {estilo === 'cards' && (
                          <button
                            type="button"
                            onClick={() => setPainel(p => (p?.nome === c.nome && p.qual === 'foto' ? null : { nome: c.nome, qual: 'foto' }))}
                            title={c.imagem ? 'Trocar a foto' : 'Escolher uma foto'}
                            aria-label={`Foto de ${nomeFinal(c)}`}
                            aria-expanded={painelAberto === 'foto'}
                            className={cn(
                              'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              c.imagem ? 'border-primary/60' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                            )}
                          >
                            {c.imagem
                              ? <img src={c.imagem} alt="" className="size-full object-cover" />
                              : <Camera className="size-4" />}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => { setApagando(apagando === c.nome ? '' : c.nome); setErroApagar(''); }}
                          title="Apagar categoria"
                          aria-label={`Apagar ${nomeFinal(c)}`}
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    {painelAberto === 'icone' && (
                      <div className="mt-2">
                        <GradeIcones selecionado={c.icone} onEscolher={chave => { setCampo(i, { icone: chave }); setPainel(null); }} />
                      </div>
                    )}

                    {painelAberto === 'foto' && (
                      <div className="mt-2 rounded-xl bg-muted/40 p-2.5">
                        <ImageUpload
                          value={c.imagem}
                          onChange={url => setCampo(i, { imagem: url })}
                          label="Foto da categoria (opcional)"
                          aspectRatio="square"
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {fotoAuto
                            ? 'Sem foto escolhida, ela usa a do primeiro produto da categoria.'
                            : 'Sem foto escolhida, aparece o ícone.'}
                        </p>
                      </div>
                    )}

                    {apagando === c.nome && (
                      <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-bold">
                          <AlertTriangle className="size-4 shrink-0 text-destructive" /> Apagar “{nomeFinal(c)}”?
                        </p>
                        {c.produtos > 0 ? (
                          <>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {plural(c.produtos, 'produto está', 'produtos estão')} nela. Escolha para onde
                              {c.produtos > 1 ? ' eles vão' : ' ele vai'} — a subcategoria deles é limpa na mudança.
                            </p>
                            <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-background">
                              {outras.length === 0 ? (
                                <p className="p-2.5 text-xs text-muted-foreground">
                                  Não há outra categoria para receber os produtos. Crie uma antes.
                                </p>
                              ) : outras.map(o => (
                                <button
                                  key={o.nome}
                                  type="button"
                                  disabled={ocupadoApagar}
                                  onClick={() => apagarCategoria(nomeFinal(c), nomeFinal(o))}
                                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                                >
                                  <span className="min-w-0 flex-1 truncate">{nomeFinal(o)}</span>
                                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.produtos}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Nenhum produto usa esta categoria.</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="ml-auto"
                              disabled={ocupadoApagar}
                              onClick={() => apagarCategoria(nomeFinal(c), '')}
                            >
                              Apagar
                            </Button>
                          </div>
                        )}
                        {sujo && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Apagar grava na hora — suas alterações pendentes são salvas junto.
                          </p>
                        )}
                        {erroApagar && <p className="mt-2 text-xs font-semibold text-destructive">{erroApagar}</p>}
                        <button
                          type="button"
                          onClick={() => { setApagando(''); setErroApagar(''); }}
                          className="mt-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
            Renomear aqui atualiza todos os produtos da categoria. A ordem desta lista é a da fileira na vitrine.
          </p>
        </CardContent>
      </Card>

      {/* ───── Aparência na vitrine ───────────────────────────────────────── */}
      <Secao
        titulo="Aparência na vitrine"
        resumo={resumoAparencia}
        icone={<SlidersHorizontal className="size-4" />}
        aberta={aparenciaAberta}
        onAlternar={() => setAparenciaAberta(a => !a)}
      >
        <div>
          <Label className="mb-2 block">Como aparecem pro cliente</Label>
          <div className="flex flex-wrap gap-2">
            <Segmento ativo={estilo === 'cards'} onClick={() => setEstilo('cards')}>
              <LayoutGrid className="size-4" /> Cards com ícone
            </Segmento>
            <Segmento ativo={estilo === 'chips'} onClick={() => setEstilo('chips')}>
              <Type className="size-4" /> Chips de texto
            </Segmento>
          </div>
        </div>

        {/*
          Formato, tamanho e fotos só existem no estilo "cards" — em chips não há
          bolha nenhuma pra arredondar. Mostrar controle que não faz nada é pior
          do que escondê-lo.
        */}
        {estilo === 'cards' && (
          <>
            <div>
              <Label className="mb-2 block">Formato</Label>
              <div className="flex flex-wrap gap-2">
                {FORMATOS.map(f => (
                  <Segmento key={f.valor} ativo={formato === f.valor} onClick={() => setFormato(f.valor)}>
                    <span className={cn('size-4 shrink-0 border-2 border-current',
                      f.valor === 'circulo' ? 'rounded-full' : f.valor === 'arredondado' ? 'rounded-md' : 'rounded-[2px]')} />
                    {f.rotulo}
                  </Segmento>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Tamanho</Label>
              <div className="flex flex-wrap gap-2">
                {TAMANHOS.map(t => (
                  <Segmento key={t.valor} ativo={tamanho === t.valor} onClick={() => setTamanho(t.valor)}>
                    {t.rotulo}
                  </Segmento>
                ))}
              </div>
            </div>

            {/*
              O "TODOS" É O PRIMEIRO DA FILEIRA e era o único que nunca tinha
              foto — bastava uma categoria ter foto pra ele destoar dos vizinhos.
            */}
            <ImageUpload
              value={todosImagem}
              onChange={setTodosImagem}
              label='Foto do botão "Todos" (opcional)'
              aspectRatio="square"
            />

            {/*
              A foto automática é o que mistura ícone com foto sem ninguém pedir:
              a categoria herda a foto de um produto, o "Todos" não herda nada.
              Desligar aqui deixa a fileira consistente sem exigir imagem pra tudo.
            */}
            <button
              type="button"
              onClick={() => setFotoAuto(v => !v)}
              role="switch"
              aria-checked={fotoAuto}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
                fotoAuto ? 'bg-primary' : 'bg-muted-foreground/30')}>
                <span className={cn('absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all',
                  fotoAuto ? 'left-[19px]' : 'left-[3px]')} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Usar foto de produto quando eu não escolher</span>
                <span className="block text-xs text-muted-foreground">
                  {fotoAuto
                    ? 'Categoria sem foto própria mostra a foto do primeiro produto dela.'
                    : 'Só as fotos que você escolher. Nas outras aparece o ícone.'}
                </span>
              </span>
            </button>
          </>
        )}
      </Secao>

      {/* ───── Setores de impressão ───────────────────────────────────────── */}
      <Secao
        titulo="Setores de impressão"
        resumo={resumoSetores}
        icone={<Printer className="size-4" />}
        aberta={setoresAberto}
        onAlternar={() => setSetoresAberto(a => !a)}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Agrupe categorias em setores (ex.: Cozinha, Bar) pra imprimir cada um numa impressora diferente.
          A impressora de cada setor é configurada na aba Impressão, deste computador.
        </p>

        {setores.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {setores.map(s => {
              const quantas = cats.filter(c => c.setorId === s.id).length;
              if (renomeandoSetor === s.id) {
                return (
                  <div key={s.id} className="flex items-center gap-1.5 rounded-xl border border-primary/50 bg-muted/50 px-2.5 py-1.5">
                    <Input
                      autoFocus
                      value={nomeSetorEdit}
                      onChange={e => setNomeSetorEdit(e.target.value)}
                      aria-label={`Novo nome do setor ${s.nome}`}
                      className="h-8 w-32 text-xs"
                      onKeyDown={e => e.key === 'Enter' && renomearSetor(s.id)}
                    />
                    <button type="button" onClick={() => renomearSetor(s.id)} className="text-xs font-bold text-primary">ok</button>
                    <button type="button" onClick={() => setRenomeandoSetor(null)} aria-label="Cancelar" className="text-muted-foreground hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              }
              if (setorApagando === s.id) {
                return (
                  <div key={s.id} className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 px-2.5 py-1.5">
                    <span className="text-xs">
                      Apagar “{s.nome}”?{quantas > 0 && ` ${plural(quantas, 'categoria fica', 'categorias ficam')} sem setor.`}
                    </span>
                    <button type="button" onClick={() => excluirSetor(s.id)} className="text-xs font-bold text-destructive">Sim</button>
                    <button type="button" onClick={() => setSetorApagando(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Não</button>
                  </div>
                );
              }
              const filtrado = filtroSetor === String(s.id);
              return (
                <div
                  key={s.id}
                  className={cn('flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 transition-colors',
                    filtrado ? 'border-primary bg-primary/10' : 'border-border bg-muted/50')}
                >
                  <button
                    type="button"
                    onClick={() => setFiltroSetor(filtrado ? 'todos' : String(s.id))}
                    title={filtrado ? 'Mostrar todas as categorias' : `Ver as categorias de ${s.nome}`}
                    className="text-sm font-semibold transition-colors hover:text-primary"
                  >
                    {s.nome} <span className="text-[11px] font-normal text-muted-foreground">({quantas})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRenomeandoSetor(s.id); setNomeSetorEdit(s.nome); }}
                    aria-label={`Renomear setor ${s.nome}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetorApagando(s.id)}
                    aria-label={`Apagar setor ${s.nome}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            value={novoSetor}
            onChange={e => setNovoSetor(e.target.value)}
            placeholder="Nome do setor (ex.: Cozinha)"
            aria-label="Nome do novo setor"
            className="h-10 min-w-[160px] flex-1 text-sm"
            onKeyDown={e => e.key === 'Enter' && criarSetor()}
          />
          <Button type="button" variant="outline" size="sm" onClick={criarSetor} disabled={!novoSetor.trim()} className="h-10 shrink-0">
            <Plus className="size-4" /> Novo setor
          </Button>
        </div>
      </Secao>

      {/*
        A BARRA DE SALVAR GRUDA NO RODAPÉ. O `pb-32` do layout já reserva a
        altura dela, então ela flutua sobre o conteúdo sem esconder a última
        linha — e num cardápio de 22 categorias o botão deixa de estar a um
        rolar de distância de onde a edição acontece.
      */}
      <div className="sticky bottom-4 z-20 flex items-center gap-3 rounded-2xl border border-border bg-card/95 p-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <span className="min-w-0 flex-1 pl-1 text-xs leading-snug">
          {sujo ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
              <span className="size-2 shrink-0 rounded-full bg-primary" /> Alterações não salvas
            </span>
          ) : (
            <span className="text-muted-foreground">Tudo salvo.</span>
          )}
        </span>
        <Button
          size="lg"
          className="shrink-0"
          onClick={() => salvar()}
          loading={enviando}
          loadingText="Salvando…"
          disabled={!sujo}
        >
          <Save className="size-4" /> Salvar
        </Button>
      </div>
    </div>
  );
}

/** Uma bolha da prévia — mesmas classes do `CardCategoria` da vitrine. */
function BolhaPrevia({ nome, icone, foto, ativo, formato, tamanho }: {
  nome: string; icone: string; foto: string; ativo: boolean;
  formato: FormatoCategoria; tamanho: TamanhoCategoria;
}) {
  const cl = classesCategoria(formato, tamanho);
  const Icone = iconeCategoria(icone);
  return (
    <div className={cn('flex shrink-0 flex-col items-center gap-1.5', cl.botao)}>
      <span className={cn('flex items-center justify-center overflow-hidden border-2', cl.bolha, cl.raio,
        ativo ? 'border-primary bg-primary/10' : 'border-border bg-muted/40')}>
        {foto
          ? <img src={foto} alt="" className="size-full object-cover" />
          : Icone
            /* createElement em vez de <Icone/>: o ícone vem de um mapa, mas
               atribuí-lo a uma variável Maiúscula aqui faz o lint ler como
               "componente criado durante o render". */
            ? createElement(Icone, {
                className: cn(cl.icone, ativo ? 'text-primary' : 'text-muted-foreground'),
                strokeWidth: 1.75,
              })
            : <span className="text-2xl">{icone || '🍴'}</span>}
      </span>
      <span className={cn('line-clamp-2 text-center font-semibold leading-tight', cl.texto,
        ativo ? 'text-primary' : 'text-muted-foreground')}>
        {nome}
      </span>
    </div>
  );
}

/** Um chip da prévia — mesmas classes do `ChipCategoria` da vitrine. */
function ChipPrevia({ label, ativo }: { label: string; ativo: boolean }) {
  return (
    <span className={cn(
      'shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold',
      ativo ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30' : 'bg-muted text-muted-foreground',
    )}>
      {label}
    </span>
  );
}
