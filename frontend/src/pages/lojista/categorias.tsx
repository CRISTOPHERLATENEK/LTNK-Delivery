/**
 * Gestão de categorias do cardápio: ícone (emoji), ordem, renomear, e o
 * estilo de exibição na vitrine do cliente (cards com ícone ou chips de texto).
 */
import { useEffect, useState } from 'react';
import { Tag, Save, ChevronUp, ChevronDown, LayoutGrid, Type } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Cat { nome: string; icone: string; nomeEdit: string }

const EMOJIS = ['🍕','🍔','🍟','🌭','🥤','🍰','🍦','🍣','🥗','🍜','🍗','🍖','☕','🍺','🧃','🥪','🌮','🍝','🥩','🍩','🍱','🧁'];

export function CategoriasLoja() {
  const { mostrar } = useToast();
  const [cats, setCats] = useState<Cat[]>([]);
  const [estilo, setEstilo] = useState<'cards' | 'chips'>('cards');
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pickerAberto, setPickerAberto] = useState<number | null>(null);

  function carregar() {
    api<{ categorias: { nome: string; icone: string }[]; estilo: 'cards' | 'chips' }>('GET', '/api/lojista/categorias')
      .then(r => {
        setCats(r.categorias.map(c => ({ nome: c.nome, icone: c.icone, nomeEdit: c.nome })));
        setEstilo(r.estilo === 'chips' ? 'chips' : 'cards');
        setCarregado(true);
      })
      .catch(() => mostrar({ tipo: 'erro', titulo: 'Não foi possível carregar as categorias.' }));
  }
  useEffect(() => { carregar(); }, []);

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    setCats(c => { const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }
  function setCampo(i: number, patch: Partial<Cat>) {
    setCats(c => c.map((x, k) => k === i ? { ...x, ...patch } : x));
  }

  async function salvar() {
    setEnviando(true);
    try {
      await api('PUT', '/api/lojista/categorias', {
        estilo,
        itens: cats.map((c, i) => ({
          nome: c.nome, icone: c.icone, ordem: i,
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

      {/* Lista */}
      {cats.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          Nenhuma categoria ainda. Crie produtos com categorias na aba Produtos.
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
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-2xl"
                    title="Escolher ícone"
                  >
                    {c.icone || '🍴'}
                  </button>
                  {/* Nome (editável = renomear) */}
                  <Input
                    value={c.nomeEdit}
                    onChange={e => setCampo(i, { nomeEdit: e.target.value })}
                    className="flex-1"
                  />
                </div>
                {/* Picker de emoji */}
                {pickerAberto === i && (
                  <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg bg-muted/50 p-2">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => { setCampo(i, { icone: e }); setPickerAberto(null); }}
                        className="size-9 rounded-lg text-xl hover:bg-background transition-colors">{e}</button>
                    ))}
                    <button onClick={() => { setCampo(i, { icone: '' }); setPickerAberto(null); }}
                      className="size-9 rounded-lg text-xs text-muted-foreground hover:bg-background">limpar</button>
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
