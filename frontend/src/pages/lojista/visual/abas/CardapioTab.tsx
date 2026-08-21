import { RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
  restaurarPadrao: () => void;
}

function Toggle({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40">
      {ativo ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
      {label}
    </button>
  );
}

const LAYOUTS: Array<{ id: EstadoVisual['cardapio']['layout']; label: string }> = [
  { id: 'lista', label: 'Lista' }, { id: 'grid', label: 'Grid' },
  { id: 'compacto', label: 'Compacto' }, { id: 'premium', label: 'Premium' },
];

const TOGGLES: Array<{ campo: keyof EstadoVisual['cardapio']; label: string }> = [
  { campo: 'mostrar_foto', label: 'Foto' },
  { campo: 'mostrar_descricao', label: 'Descrição' },
  { campo: 'mostrar_categoria', label: 'Categoria' },
  { campo: 'mostrar_avaliacao', label: 'Avaliação' },
  { campo: 'mostrar_tempo', label: 'Tempo' },
  { campo: 'preco_destacado', label: 'Preço destacado' },
  { campo: 'badge_promocao', label: 'Badge de promoção' },
  { campo: 'badge_destaque', label: 'Badge de destaque' },
  { campo: 'botao_comprar', label: 'Botão comprar' },
];

/**
 * Escolha entre poucas opções, em botões — não em <select>.
 * O lojista mexe nisso olhando o preview ao lado; ver as alternativas todas de
 * uma vez faz ele comparar num toque, em vez de abrir uma lista e adivinhar.
 */
function Escolha<T extends string | number>({ label, dica, valor, opcoes, onEscolher }: {
  label: string;
  dica?: string;
  valor: T;
  opcoes: Array<{ id: T; label: string }>;
  onEscolher: (v: T) => void;
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <div className={cn('grid gap-2', opcoes.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {opcoes.map(o => (
          <button key={String(o.id)} type="button" onClick={() => onEscolher(o.id)}
            className={cn('rounded-lg border-2 py-2 text-[11px] font-semibold transition-colors',
              valor === o.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
            {o.label}
          </button>
        ))}
      </div>
      {dica && <p className="mt-1.5 text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}

export function CardapioTab({ estado, atualizar, restaurarPadrao }: Props) {
  const c = estado.cardapio;
  // Grid e Premium são os layouts com foto grande em colunas; as opções abaixo
  // só fazem efeito neles, então some pra não oferecer controle que não faz nada.
  const ehGrade = c.layout === 'grid' || c.layout === 'premium';
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cardápio</p>
          <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>

        <div>
          <Label className="mb-2 block">Layout</Label>
          <div className="grid grid-cols-4 gap-2">
            {LAYOUTS.map(l => (
              <button key={l.id} type="button" onClick={() => atualizar('cardapio.layout', l.id)}
                className={cn('rounded-lg border-2 py-2 text-[11px] font-semibold transition-colors',
                  estado.cardapio.layout === l.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Mostrar no card</Label>
          <div className="flex flex-wrap gap-2">
            {TOGGLES.map(t => (
              <Toggle key={t.campo} label={t.label} ativo={!!estado.cardapio[t.campo]}
                onClick={() => atualizar(`cardapio.${t.campo}`, !estado.cardapio[t.campo])} />
            ))}
          </div>
        </div>

        <Escolha
          label="Botão de adicionar"
          dica="“Adicionar” escrito costuma render mais com público que não usa app com frequência."
          valor={c.estilo_botao}
          opcoes={[{ id: 'icone' as const, label: '+ redondo' }, { id: 'texto' as const, label: '“Adicionar”' }]}
          onEscolher={v => atualizar('cardapio.estilo_botao', v)}
        />

        {ehGrade && (
          <>
            <Escolha
              label="Formato da foto"
              valor={c.formato_foto}
              opcoes={[
                { id: 'quadrada' as const, label: 'Quadrada' },
                { id: 'retrato' as const, label: 'Retrato' },
                { id: 'paisagem' as const, label: 'Paisagem' },
              ]}
              onEscolher={v => atualizar('cardapio.formato_foto', v)}
            />
            <Escolha
              label="Produtos por linha no celular"
              dica="1 coluna deixa a foto grande — bom pra cardápio curto e foto de qualidade."
              valor={c.colunas_mobile}
              opcoes={[{ id: 1 as const, label: '1 por linha' }, { id: 2 as const, label: '2 por linha' }]}
              onEscolher={v => atualizar('cardapio.colunas_mobile', v)}
            />
            <Escolha
              label="Nome do produto"
              dica="Em 1 linha todos os cards ficam da mesma altura, e os preços alinham entre si."
              valor={c.linhas_nome}
              opcoes={[{ id: 1 as const, label: '1 linha' }, { id: 2 as const, label: 'Até 2 linhas' }]}
              onEscolher={v => atualizar('cardapio.linhas_nome', v)}
            />
          </>
        )}

        <Escolha
          label="Sombra do card"
          valor={c.sombra}
          opcoes={[
            { id: 'nenhuma' as const, label: 'Sem sombra' },
            { id: 'suave' as const, label: 'Suave' },
            { id: 'forte' as const, label: 'Forte' },
          ]}
          onEscolher={v => atualizar('cardapio.sombra', v)}
        />

        <div>
          <Label>Espaçamento entre produtos ({estado.cardapio.espacamento}px)</Label>
          <input type="range" min={4} max={24} value={estado.cardapio.espacamento}
            onChange={e => atualizar('cardapio.espacamento', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Raio das bordas ({estado.cardapio.raio_bordas}px)</Label>
          <input type="range" min={0} max={32} value={estado.cardapio.raio_bordas}
            onChange={e => atualizar('cardapio.raio_bordas', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Altura dos cards ({estado.cardapio.altura_cards}px)</Label>
          <input type="range" min={140} max={320} value={estado.cardapio.altura_cards}
            onChange={e => atualizar('cardapio.altura_cards', Number(e.target.value))} className="mt-2 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
