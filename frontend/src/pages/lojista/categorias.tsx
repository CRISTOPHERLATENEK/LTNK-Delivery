/**
 * Gestão de categorias do cardápio: criação, ícone (Lucide), ordem, renomear, e o
 * estilo de exibição na vitrine do cliente (cards com ícone ou chips de texto).
 */
import { useEffect, useState } from 'react';
import { Tag, Save, ChevronUp, ChevronDown, LayoutGrid, Type, Printer, Plus, X, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ICONES_CATEGORIA, iconeCategoria } from '@/lib/icones-categoria';

interface Cat { nome: string; icone: string; nomeEdit: string; setorId: number | null }
interface Setor { id: number; nome: string; categorias: number }

/** Grade de ícones reaproveitada tanto no picker de cada categoria quanto no de "nova categoria". */
function GradeIcones({ selecionado, onEscolher }: { selecionado: string; onEscolher: (chave: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg bg-muted/50 p-2">
      {ICONES_CATEGORIA.map(({ chave, label, Icone }) => (
        <button
          key={chave}
          type="button"
          title={label}
          onClick={() => onEscolher(chave)}
          className={cn(
            'flex size-9 items-center justify-center rounded-lg transition-colors',
            selecionado === chave ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-background',
          )}
        >
          <Icone className="size-[18px]" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

export function CategoriasLoja() {
  const { mostrar } = useToast();
  const [cats, setCats] = useState<Cat[]>([]);
  const [estilo, setEstilo] = useState<'cards' | 'chips'>('cards');
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pickerAberto, setPickerAberto] = useState<number | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [novoSetor, setNovoSetor] = useState('');
  const [renomeandoSetor, setRenomeandoSetor] = useState<number | null>(null);
  const [nomeSetorEdit, setNomeSetorEdit] = useState('');
  const [novaCatNome, setNovaCatNome] = useState('');
  const [novaCatIcone, setNovaCatIcone] = useState('geral');
  const [novaCatPickerAberto, setNovaCatPickerAberto] = useState(false);

  function carregar() {
    api<{ categorias: { nome: string; icone: string; setor_id: number | null }[]; estilo: 'cards' | 'chips' }>('GET', '/api/lojista/categorias')
      .then(r => {
        setCats(r.categorias.map(c => ({ nome: c.nome, icone: c.icone, nomeEdit: c.nome, setorId: c.setor_id })));
        setEstilo(r.estilo === 'chips' ? 'chips' : 'cards');
        setCarregado(true);
      })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as categorias.' }));
  }
  function carregarSetores() {
    api<{ setores: Setor[] }>('GET', '/api/lojista/setores')
      .then(r => setSetores(r.setores))
      .catch(() => {});
  }
  useEffect(() => { carregar(); carregarSetores(); }, []);

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
      carregarSetores();
      setCats(c => c.map(x => x.setorId === id ? { ...x, setorId: null } : x));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    setCats(c => { const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }
  function setCampo(i: number, patch: Partial<Cat>) {
    setCats(c => c.map((x, k) => k === i ? { ...x, ...patch } : x));
  }

  function criarCategoria() {
    const nome = novaCatNome.trim();
    if (!nome) return;
    if (cats.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
      mostrar({ tipo: 'erro', titulo: 'Já existe uma categoria com esse nome.' });
      return;
    }
    setCats(c => [...c, { nome, icone: novaCatIcone, nomeEdit: nome, setorId: null }]);
    setNovaCatNome('');
    setNovaCatIcone('geral');
    setNovaCatPickerAberto(false);
  }

  async function salvar() {
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/categorias', {
        estilo,
        itens: cats.map((c, i) => ({
          nome: c.nome, icone: c.icone, ordem: i, setor_id: c.setorId,
          renomear_para: c.nomeEdit.trim() && c.nomeEdit.trim() !== c.nome ? c.nomeEdit.trim() : undefined,
        })),
      });
      mostrar({ tipo: 'sucesso', titulo: 'Categorias salvas!' });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setEnviando(false); }
  }

  if (!carregado) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="size-5 text-primary" />
        <h1 className="text-lg font-extrabold">Categorias</h1>
      </div>

      {/* Setores de impressão */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="mb-0.5 flex items-center gap-1.5"><Printer className="size-3.5" /> Setores de impressão</Label>
            <p className="text-[11px] text-muted-foreground">
              Agrupe categorias em setores (ex.: Cozinha, Bar) pra imprimir cada um numa impressora diferente. A impressora de cada setor é configurada na aba Impressão, deste computador.
            </p>
          </div>
          {setores.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {setores.map(s => (
                <div key={s.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
                  {renomeandoSetor === s.id ? (
                    <>
                      <Input autoFocus value={nomeSetorEdit} onChange={e => setNomeSetorEdit(e.target.value)}
                        className="h-7 w-32 text-xs" onKeyDown={e => e.key === 'Enter' && renomearSetor(s.id)} />
                      <button onClick={() => renomearSetor(s.id)} className="text-primary text-xs font-semibold">ok</button>
                      <button onClick={() => setRenomeandoSetor(null)} className="text-muted-foreground"><X className="size-3.5" /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold">{s.nome}</span>
                      <span className="text-[10px] text-muted-foreground">({s.categorias})</span>
                      <button onClick={() => { setRenomeandoSetor(s.id); setNomeSetorEdit(s.nome); }} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button>
                      <button onClick={() => excluirSetor(s.id)} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input value={novoSetor} onChange={e => setNovoSetor(e.target.value)} placeholder="Nome do setor (ex.: Cozinha)"
              className="h-9 flex-1" onKeyDown={e => e.key === 'Enter' && criarSetor()} />
            <Button type="button" variant="outline" size="sm" onClick={criarSetor} disabled={!novoSetor.trim()}>
              <Plus className="size-4" /> Novo setor
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Estilo de exibição */}
      <Card>
        <CardContent className="p-4">
          <Label className="mb-2 block">Como aparecem pro cliente</Label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEstilo('cards')}
              className={cn('flex-1 flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                estilo === 'cards' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
              <LayoutGrid className="size-4" /> Cards com ícone
            </button>
            <button type="button" onClick={() => setEstilo('chips')}
              className={cn('flex-1 flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                estilo === 'chips' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
              <Type className="size-4" /> Chips de texto
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Nova categoria */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="mb-0.5 flex items-center gap-1.5"><Plus className="size-3.5" /> Nova categoria</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setNovaCatPickerAberto(a => !a)}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary"
              title="Escolher ícone"
            >
              {(() => {
                const Icone = iconeCategoria(novaCatIcone);
                return Icone ? <Icone className="size-5" strokeWidth={1.75} /> : null;
              })()}
            </button>
            <Input
              value={novaCatNome}
              onChange={e => setNovaCatNome(e.target.value)}
              placeholder="Nome da categoria (ex.: Pizzas)"
              className="flex-1"
              onKeyDown={e => e.key === 'Enter' && criarCategoria()}
            />
            <Button type="button" variant="outline" onClick={criarCategoria} disabled={!novaCatNome.trim()}>
              Adicionar
            </Button>
          </div>
          {novaCatPickerAberto && (
            <GradeIcones selecionado={novaCatIcone} onEscolher={chave => { setNovaCatIcone(chave); setNovaCatPickerAberto(false); }} />
          )}
        </CardContent>
      </Card>

      {/* Lista */}
      {cats.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          Nenhuma categoria ainda. Crie uma acima ou adicione produtos com categoria na aba Produtos.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-3 space-y-2">
            {cats.map((c, i) => (
              <div key={c.nome} className="rounded-xl border border-border/60 p-2.5">
                <div className="flex items-center gap-2">
                  {/* Reordenar */}
                  <div className="flex flex-col">
                    <button onClick={() => mover(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="size-4" /></button>
                    <button onClick={() => mover(i, 1)} disabled={i === cats.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="size-4" /></button>
                  </div>
                  {/* Ícone */}
                  <button
                    onClick={() => setPickerAberto(pickerAberto === i ? null : i)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary"
                    title="Escolher ícone"
                  >
                    {(() => {
                      const Icone = iconeCategoria(c.icone);
                      return Icone ? <Icone className="size-5" strokeWidth={1.75} /> : <span className="text-2xl">{c.icone || '🍴'}</span>;
                    })()}
                  </button>
                  {/* Nome (editável = renomear) */}
                  <Input
                    value={c.nomeEdit}
                    onChange={e => setCampo(i, { nomeEdit: e.target.value })}
                    className="flex-1"
                  />
                  {/* Setor de impressão */}
                  {setores.length > 0 && (
                    <select
                      value={c.setorId ?? ''}
                      onChange={e => setCampo(i, { setorId: e.target.value ? Number(e.target.value) : null })}
                      className="h-9 shrink-0 rounded-lg border border-input bg-background px-2 text-xs max-w-[110px]"
                      title="Setor de impressão"
                    >
                      <option value="">Sem setor</option>
                      {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  )}
                </div>
                {/* Picker de ícone */}
                {pickerAberto === i && (
                  <div className="mt-2">
                    <GradeIcones selecionado={c.icone} onEscolher={chave => { setCampo(i, { icone: chave }); setPickerAberto(null); }} />
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground px-1">
        Renomear aqui atualiza todos os produtos da categoria. A ordem definida aqui é a que aparece na vitrine.
      </p>

      <Button size="lg" className="w-full" onClick={salvar} disabled={enviando}>
        <Save className="size-4" /> {enviando ? 'Salvando…' : 'Salvar categorias'}
      </Button>
    </div>
  );
}
