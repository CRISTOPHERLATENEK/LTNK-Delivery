/**
 * As peças de montar do relatório — o que se repete nas seis abas.
 *
 * Ficam num arquivo próprio porque a tela já é grande e porque a regra visual
 * que elas carregam é uma só, dita uma vez: TODO NÚMERO EM MONO, com
 * `tabular-nums`, alinhado à direita. Número em fonte proporcional não alinha
 * coluna — e relatório que não alinha coluna não se confere, que é a única
 * coisa que se faz com relatório.
 */
import { cn } from '@/lib/utils';

/** A classe de todo número desta tela. Uma definição, e não trinta. */
export const NUM = 'font-mono tabular-nums';

/**
 * A variação contra o período anterior.
 *
 * `null` = o período anterior não teve venda. A tela diz isso em texto em vez
 * de mostrar "+100%" para a primeira venda da loja, que é um número tecnicamente
 * correto e completamente inútil.
 *
 * `bomSubir` existe por causa do cancelamento: lá, subir é ruim, e pintar de
 * verde o aumento de cancelamento é o relatório mentindo com cor.
 */
export function Variacao({ percent, bomSubir = true, sufixo = '' }: {
  percent: number | null; bomSubir?: boolean; sufixo?: string;
}) {
  if (percent === null) {
    return <span className="text-[11.5px] text-muted-foreground">sem base de comparação</span>;
  }
  const subiu = percent > 0;
  const bom = subiu === bomSubir;
  return (
    <span className={cn('text-[11.5px] font-semibold', NUM,
      percent === 0 ? 'text-muted-foreground'
        : bom ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
      {percent > 0 ? '+' : ''}{percent}{sufixo || '%'}
    </span>
  );
}

/** Um cartão de número: rótulo em cima, valor em mono grande, apoio embaixo. */
export function Cartao({ rotulo, valor, apoio, ativo, cor, onClick }: {
  rotulo: string; valor: React.ReactNode; apoio?: React.ReactNode;
  /** Quando clicável, o cartão vira filtro — e a borda inferior diz qual está valendo. */
  ativo?: boolean; cor?: string; onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('min-w-0 border-b-2 px-4 py-3 text-left transition-colors',
        onClick && 'hover:bg-accent/50',
        ativo ? (cor || 'border-primary') : 'border-transparent')}
    >
      <p className="truncate text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </p>
      {/*
        ENCOLHE NO CELULAR. Em 375 px a grade de dois cartões dá 166 px por
        cartão, e "R$ 12.345,67" em 22 px pede 176: o valor passava por cima da
        borda — justamente o dado que a tela existe para mostrar.
      */}
      <p className={cn('mt-1 text-[18px] font-bold leading-none sm:text-[22px]', NUM)}>{valor}</p>
      {apoio !== undefined && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{apoio}</p>}
    </Tag>
  );
}

/** Título de bloco. Caixa alta pequena, como todo rótulo desta tela. */
export function Titulo({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {children}
      </h2>
      {acao}
    </div>
  );
}

/** Uma linha chave → valor, com o valor em mono à direita. */
export function Linha({ rotulo, apoio, valor, forte, cor }: {
  rotulo: React.ReactNode; apoio?: React.ReactNode; valor: React.ReactNode;
  forte?: boolean; cor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px]', forte && 'font-semibold')}>{rotulo}</span>
        {apoio !== undefined && <span className="block truncate text-[11.5px] text-muted-foreground">{apoio}</span>}
      </span>
      <span className={cn('shrink-0 text-[13px]', NUM, forte && 'font-bold', cor)}>{valor}</span>
    </div>
  );
}

/** Uma barra proporcional — a forma do período, não só o total dele. */
export function Barra({ valor, maximo, destaque }: { valor: number; maximo: number; destaque?: boolean }) {
  const altura = maximo > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 2;
  return (
    <span
      className={cn('block w-full rounded-t', destaque ? 'bg-primary' : 'bg-muted-foreground/25')}
      style={{ height: `${altura}%` }}
    />
  );
}

/** O bloco vazio, dito em uma linha — e sempre com o motivo, nunca só "vazio". */
export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[12.5px] text-muted-foreground">{children}</p>;
}

/** Cartão branco: a moldura de todo bloco desta tela. */
export function Bloco({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {children}
    </section>
  );
}

/** "há 3 dias", "hoje" — data curta para coluna estreita. */
export function desdeQuando(iso: string | null | undefined): string {
  if (!iso) return 'nunca vendeu';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (!Number.isFinite(dias)) return '—';
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}

/** Segundos em "4 min" / "1 h 12 min" — tempo de operação não se lê em segundos. */
export function duracao(segundos: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
