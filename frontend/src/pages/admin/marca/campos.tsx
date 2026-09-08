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
    <Linha
      rotulo={titulo}
      /* A CONTAGEM NO RÓTULO. Sem ela, "Adicionar" desabilitado parece defeito
         — a pessoa clica duas vezes antes de desconfiar que chegou ao limite. */
      apoio={`${itens.length} de ${max}`}
      empilhado
    >
      <div className="space-y-2">
        <div className="flex justify-end">
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
        {itens.length === 0 && (
          <p className="text-[11.5px]" style={{ color: 'var(--adm-rotulo, #78716C)' }}>
            Nenhum item — usando os padrões embutidos.
          </p>
        )}
      </div>
    </Linha>
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

/**
 * A SEÇÃO DAS TRÊS TELAS DE FORMULÁRIO (Marca, Landing, Configurações).
 *
 * Rótulo em caps sobre um bloco de hairline, sem card e sem sombra — as três
 * telas mudam de cara juntas porque compartilham este componente. O ícone virou
 * opcional e não é mais desenhado: numa página com sete seções, sete ícones
 * coloridos disputam a atenção com os campos, que é o que a pessoa veio editar.
 * A assinatura mantém `icone` para não ter que tocar em cada chamada — e para o
 * dia em que alguém quiser voltar atrás.
 */
export function Secao({ titulo, children }: {
  icone?: unknown; titulo: string; children: React.ReactNode;
}) {
  return (
    <section className="pb-5">
      <div
        className="pb-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--adm-rotulo, #78716C)' }}
      >
        {titulo}
      </div>
      <Quadro>{children}</Quadro>
    </section>
  );
}

/**
 * A MOLDURA das linhas rotuladas, sem título.
 *
 * Para as telas que já trazem o próprio cabeçalho (a Landing tem
 * `SecaoTituloEditor` com título e descrição em cada aba): repetir o rótulo da
 * `Secao` ali daria dois títulos para o mesmo grupo.
 *
 * SEM `space-y` e SEM padding próprio — as linhas trazem o próprio espaçamento
 * e a própria hairline. Somar o gap da moldura criava um respiro duplo entre
 * uns campos e não entre outros, dependendo de quem estava dentro.
 */
export function Quadro({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-quadro" style={{ border: '1px solid var(--adm-linha, #ECEAE6)', borderRadius: 6 }}>
      {children}
    </div>
  );
}

/**
 * LINHA ROTULADA: rótulo de 150px à esquerda, controle à direita.
 *
 * Vive aqui e não em `../ui` porque os três editores (Marca, Landing,
 * Configurações) já importam este arquivo, e `../ui` é o kit das telas de
 * lista. Mesma medida e mesma aparência da `LinhaRotulada` de lá, com UMA
 * diferença: aqui a divisória é desenhada pela moldura (`Quadro`), não pela
 * linha — a de `../ui` continua com o prop `primeira` porque vive dentro de
 * `PainelLateral`, que não é `Quadro`. Se um dia as duas ficarem iguais nesse
 * ponto, é sinal de que devem virar uma só.
 */
export function Linha({ rotulo, apoio, children, empilhado }: {
  rotulo: string;
  apoio?: string;
  children: React.ReactNode;
  /**
   * Controle que NÃO cabe ao lado do rótulo: upload com prévia, editor de
   * lista, grade de ícones. Em 150px + resto, uma prévia de imagem fica do
   * tamanho de um selo — aí o rótulo vai por cima e o controle usa a largura
   * toda.
   */
  empilhado?: boolean;
}) {
  // A divisória entre linhas é da moldura (`.adm-quadro > *` em index.css).
  return (
    <div className={empilhado ? 'px-3 py-3' : 'flex flex-wrap items-center gap-3 px-3 py-2.5'}>
      <div className={empilhado ? 'pb-2' : 'w-[150px] shrink-0'}>
        <div className="text-[13px] font-medium">{rotulo}</div>
        {apoio && (
          <div className="text-[11.5px] leading-snug" style={{ color: 'var(--adm-rotulo, #78716C)' }}>
            {apoio}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function CampoCor({ label, valor, onChange, permiteVazio }: {
  label: string; valor: string; onChange: (v: string) => void; permiteVazio?: boolean;
}) {
  return (
    <Linha rotulo={label} apoio={permiteVazio ? 'Vazio = derivada da primária' : undefined}>
      <div className="flex items-center gap-2">
        {/*
          O seletor de cor do sistema fica QUADRADO e menor: em 44px de altura
          ele competia com o campo do hex, e o que se digita mais é o hex —
          copiado da identidade da marca, não escolhido no olho.
        */}
        <input
          type="color"
          value={valor || '#000000'}
          onChange={e => onChange(e.target.value)}
          aria-label={`${label}: escolher no seletor`}
          className="size-[34px] shrink-0 cursor-pointer"
          style={{ border: '1px solid var(--adm-linha, #ECEAE6)', borderRadius: 4, padding: 2 }}
        />
        <input
          value={valor}
          onChange={e => onChange(e.target.value)}
          maxLength={7}
          placeholder={permiteVazio ? '—' : '#dc2640'}
          aria-label={label}
          className="adm-num h-[34px] w-[110px] px-2 text-[13px] uppercase outline-none"
          style={{ border: '1px solid var(--adm-linha, #ECEAE6)', borderRadius: 4, boxSizing: 'border-box' }}
        />
        {permiteVazio && valor && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="h-[34px] px-2 text-[12.5px]"
            style={{ color: 'var(--adm-rotulo, #78716C)' }}
          >
            limpar
          </button>
        )}
      </div>
    </Linha>
  );
}
