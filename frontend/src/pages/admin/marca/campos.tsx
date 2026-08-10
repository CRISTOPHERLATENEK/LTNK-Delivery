/**
 * Campos e blocos reaproveitados pelas telas de Marca, Landing e Configurações.
 *
 * Vieram do antigo `marca.tsx` de 1.781 linhas SEM NENHUMA alteração — só
 * mudaram de arquivo. Ficam juntos aqui porque os três editores usam os mesmos
 * blocos, e duplicá-los faria as telas divergirem em detalhe visual com o tempo.
 */
import { Plus, Trash2, Store, Palette } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ICONES_LANDING } from '@/pages/cliente/landing';
import type { LandingIcone, LandingIconeTituloDesc } from '@/types';
export const ICONES_DISPONIVEIS = Object.keys(ICONES_LANDING) as LandingIcone[];

/** Cabeçalho de uma aba do editor: título + explicação curta do que ela controla. */
export function SecaoTituloEditor({ titulo, desc }: { titulo: string; desc: string }) {
  return (
    <div className="-mt-1">
      <h3 className="text-sm font-bold">{titulo}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

/** Editor genérico de uma lista de textos curtos (benefícios, comparativo, segmentos). */
export function ListaTextoEditavel({ titulo, itens, onChange, max, placeholder }: {
  titulo: string; itens: string[]; onChange: (itens: string[]) => void; max: number; placeholder?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="mb-0">{titulo}</Label>
        <Button type="button" variant="outline" size="sm"
          onClick={() => itens.length < max && onChange([...itens, ''])} disabled={itens.length >= max}>
          <Plus className="size-3.5" /> Adicionar
        </Button>
      </div>
      {itens.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={v} maxLength={80} placeholder={placeholder}
            onChange={e => onChange(itens.map((x, idx) => idx === i ? e.target.value : x))} />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(itens.filter((_, idx) => idx !== i))}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
      {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item — usando os padrões embutidos.</p>}
    </div>
  );
}

/** Editor de uma lista de itens ícone + título + descrição (Como funciona, mini-cards fiscais). */
export function ListaIconeTituloDescEditavel({ itens, onUp, onAdd, onRemove, max, descMax }: {
  itens: LandingIconeTituloDesc[];
  onUp: (i: number, campo: keyof LandingIconeTituloDesc, valor: string) => void;
  onAdd: () => void; onRemove: (i: number) => void; max: number; descMax: number;
}) {
  const iconesDisp = Object.keys(ICONES_LANDING) as LandingIcone[];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={itens.length >= max}>
          <Plus className="size-3.5" /> Adicionar
        </Button>
      </div>
      {itens.map((r, i) => {
        const Icone = ICONES_LANDING[r.icone] || Store;
        return (
          <div key={i} className="rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <select value={r.icone} onChange={e => onUp(i, 'icone', e.target.value)}
                className="h-10 px-2 rounded-lg border border-input bg-background text-sm shrink-0">
                {iconesDisp.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <Icone className="size-4 text-primary shrink-0" />
              <Input value={r.titulo} maxLength={60} placeholder="Título" onChange={e => onUp(i, 'titulo', e.target.value)} />
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(i)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <Input value={r.desc} maxLength={descMax} placeholder="Descrição curta" onChange={e => onUp(i, 'desc', e.target.value)} />
          </div>
        );
      })}
      {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item — usando os padrões embutidos.</p>}
    </div>
  );
}

export function Secao({ icone: Icone, titulo, children }: {
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

export function CampoCor({ label, valor, onChange, permiteVazio }: {
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
