/**
 * AS PEÇAS DO PAINEL ADMIN.
 *
 * Existem porque as dez telas de lista têm a MESMA anatomia — toolbar, cabeçalho
 * de colunas, linhas em grid, rodapé com contagem. Cada uma reimplementando isso
 * é como a densidade foi ficando diferente de tela pra tela: nove padding
 * verticais distintos, cinco jeitos de mostrar status.
 *
 * Nada aqui usa `--primary`: a cor da marca é do cliente e muda por tenant. O
 * admin é ferramenta nossa, com uma cor de ação só (`#1C1917`). Os tokens moram
 * em `index.css` sob `.adm`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ── Números ─────────────────────────────────────────────────────────── */

/** Valor, contagem, data, id, slug: mono, tabular, alinhado à direita. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('adm-num', className)}>{children}</span>;
}

/* ── Status ──────────────────────────────────────────────────────────── */

export type Tom = 'ok' | 'atencao' | 'erro' | 'inativo' | 'neutro';

const COR_DO_TOM: Record<Tom, string> = {
  ok: 'var(--adm-ok)',
  atencao: 'var(--adm-atencao)',
  erro: 'var(--adm-erro)',
  inativo: 'var(--adm-inativo)',
  neutro: 'var(--adm-dado)',
};

/**
 * STATUS É DOT + PALAVRA, nunca badge preenchido.
 *
 * Badge colorido compete com o conteúdo: numa lista de 40 linhas, quarenta
 * retângulos verdes e âmbares viram o que a pessoa vê primeiro, e o nome da
 * loja — que é o que ela procura — vira fundo. O dot dá a semântica em 5px e
 * devolve a atenção ao texto.
 */
export function Status({ tom, children }: { tom: Tom; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>
      <span
        className="size-[5px] shrink-0 rounded-full"
        style={{ background: COR_DO_TOM[tom] }}
        aria-hidden
      />
      {children}
    </span>
  );
}

/* ── Botões ──────────────────────────────────────────────────────────── */

type PropsBotao = {
  children: ReactNode;
  onClick?: () => void;
  variante?: 'primario' | 'outline' | 'perigo';
  tipo?: 'button' | 'submit';
  desabilitado?: boolean;
  altura?: 30 | 34;
  className?: string;
};

export function Botao({
  children, onClick, variante = 'outline', tipo = 'button',
  desabilitado, altura = 34, className,
}: PropsBotao) {
  const estilo =
    variante === 'primario'
      ? { background: 'var(--adm-fg)', color: '#fff', border: '1px solid var(--adm-fg)' }
      : variante === 'perigo'
        ? { background: '#fff', color: 'var(--adm-erro)', border: '1px solid var(--adm-linha)' }
        : { background: '#fff', color: 'var(--adm-fg)', border: '1px solid var(--adm-linha)' };
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={desabilitado}
      style={{ ...estilo, height: altura, borderRadius: 4 }}
      className={cn(
        'adm-btn inline-flex items-center justify-center gap-1.5 px-3 text-[12.5px] font-medium',
        'disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Cabeçalho de conteúdo ───────────────────────────────────────────── */

/**
 * Título + subtítulo COM NÚMERO REAL, e no máximo duas ações.
 *
 * O subtítulo carrega o número porque é a primeira pergunta de quem abre a
 * tela ("quantas são? tem pendência?") e respondê-la ali evita a viagem até o
 * rodapé.
 */
export function Cabecalho({
  titulo, subtitulo, acoes,
}: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap pb-4">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold leading-tight">{titulo}</h1>
        {subtitulo && (
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--adm-rotulo)' }}>{subtitulo}</p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </div>
  );
}

/* ── Toolbar: busca + filtros ────────────────────────────────────────── */

export function Busca({
  valor, aoMudar, placeholder = 'Buscar…',
}: { valor: string; aoMudar: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={valor}
      onChange={e => aoMudar(e.target.value)}
      placeholder={placeholder}
      className="h-[34px] w-full px-2.5 text-[13px] outline-none"
      style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, background: '#fff' }}
    />
  );
}

/**
 * SEGMENTED: um bloco com bordas compartilhadas, não chips soltos.
 *
 * Chips soltos leem como tags do registro; um bloco único lê como "escolha uma
 * destas". É a diferença entre a pessoa achar que está marcando algo e saber
 * que está filtrando.
 */
export function Segmented<T extends string>({
  valor, opcoes, aoMudar,
}: {
  valor: T;
  opcoes: { v: T; label: string; contagem?: number }[];
  aoMudar: (v: T) => void;
}) {
  return (
    <div className="flex shrink-0" style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }}>
      {opcoes.map((o, i) => {
        const ativo = o.v === valor;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => aoMudar(o.v)}
            aria-pressed={ativo}
            style={{
              /* Sem transition no `background`: é a propriedade que recebe o
                 valor dinâmico, e a transition congelava o repaint no estado
                 anterior. */
              background: ativo ? 'var(--adm-seg)' : '#fff',
              fontWeight: ativo ? 600 : 400,
              borderLeft: i === 0 ? 'none' : '1px solid var(--adm-linha)',
              borderRadius: i === 0 ? '3px 0 0 3px' : i === opcoes.length - 1 ? '0 3px 3px 0' : 0,
            }}
            className="h-[34px] px-3 text-[12.5px]"
          >
            {o.label}
            {o.contagem !== undefined && (
              <span className="adm-num ml-1.5" style={{ color: 'var(--adm-dado)' }}>{o.contagem}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pb-3">{children}</div>;
}

/* ── Tabela ──────────────────────────────────────────────────────────── */

/**
 * Tabela em GRID, não `<table>`: as colunas precisam de larguras diferentes por
 * tela e a linha inteira precisa ser clicável. O `grid` da CSS resolve os dois
 * sem `colspan` nem `<a>` dentro de `<td>`.
 *
 * `colunas` é um `grid-template-columns` cru — a tela sabe suas larguras.
 */
export function Tabela({ colunas, children }: { colunas: string; children: ReactNode }) {
  return (
    <div className="adm-tabela-rolagem" style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
      <div style={{ ['--adm-cols' as string]: colunas }}>{children}</div>
    </div>
  );
}

export function TabelaCabecalho({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 text-[11px] font-medium"
      style={{
        gridTemplateColumns: 'var(--adm-cols)',
        color: 'var(--adm-dado)',
        borderBottom: '1px solid var(--adm-linha)',
        background: 'var(--adm-fundo2)',
      }}
    >
      {children}
    </div>
  );
}

export function TabelaLinha({
  children, aoClicar, primeira,
}: { children: ReactNode; aoClicar?: () => void; primeira?: boolean }) {
  const [sobre, setSobre] = useState(false);
  return (
    <div
      onClick={aoClicar}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      role={aoClicar ? 'button' : undefined}
      tabIndex={aoClicar ? 0 : undefined}
      onKeyDown={e => { if (aoClicar && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); aoClicar(); } }}
      className={cn('grid items-center gap-3 px-3 py-[11px] text-[13px]', aoClicar && 'cursor-pointer')}
      style={{
        gridTemplateColumns: 'var(--adm-cols)',
        borderTop: primeira ? 'none' : '1px solid var(--adm-linha3)',
        background: sobre && aoClicar ? 'var(--adm-fundo2)' : '#fff',
      }}
    >
      {children}
    </div>
  );
}

/** Primeira coluna: nome + sub-linha mono (slug, CNPJ, e-mail). */
export function CelulaNome({ nome, sub }: { nome: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13.5px] font-medium">{nome}</div>
      {sub !== undefined && sub !== '' && (
        <div className="adm-num truncate text-[11px]" style={{ color: 'var(--adm-dado)' }}>{sub}</div>
      )}
    </div>
  );
}

/** Texto ausente vira "—" no tom de dado secundário, nunca vazio. */
export function Vazio({ children = '—' }: { children?: ReactNode }) {
  return <span style={{ color: 'var(--adm-dado)' }}>{children}</span>;
}

/**
 * Rodapé: contagem à esquerda, exportação à direita.
 *
 * A contagem diz o FILTRO junto ("2 resultados em Aguardando") porque lista
 * curta sem explicação parece lista vazia — foi assim que o filtro do protótipo
 * passou por quebrado quando só estava filtrando.
 */
export function TabelaRodape({
  total, filtro, aoExportar,
}: { total: number; filtro?: string; aoExportar?: () => void }) {
  const texto = total === 0
    ? (filtro ? `Nenhum resultado em ${filtro}` : 'Nenhum resultado')
    : `${total} ${total === 1 ? 'resultado' : 'resultados'}${filtro ? ` em ${filtro}` : ''}`;
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2"
      style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
    >
      <span className="text-[12px]" style={{ color: 'var(--adm-dado)' }}>{texto}</span>
      {aoExportar && (
        <Botao altura={30} onClick={aoExportar}>Exportar CSV</Botao>
      )}
    </div>
  );
}

/* ── Painel lateral ──────────────────────────────────────────────────── */

/**
 * DETALHE EM PAINEL LATERAL, não expandindo a linha.
 *
 * Expandir inline empurra as lojas seguintes vários écrans pra baixo, e fechar
 * exige rolar de volta até achar o card. O painel cobre a lista, tem header
 * fixo e some sem mexer em nada.
 */
export function PainelLateral({
  aberto, titulo, subtitulo, aoFechar, rodape, children,
}: {
  aberto: boolean;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
}) {
  /* Esc fecha: é o reflexo de quem usa painel lateral o dia inteiro. */
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={aoFechar} />
      <aside
        className="adm relative flex h-full flex-col"
        style={{ width: 'min(640px, 100vw)', background: '#fff', borderLeft: '1px solid var(--adm-linha)' }}
      >
        <header
          className="flex shrink-0 items-start justify-between gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--adm-linha)' }}
        >
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{titulo}</div>
            {subtitulo && (
              <div className="mt-0.5 text-[12px]" style={{ color: 'var(--adm-rotulo)' }}>{subtitulo}</div>
            )}
          </div>
          <button
            onClick={aoFechar}
            aria-label="Fechar"
            className="shrink-0 px-2 text-[18px] leading-none"
            style={{ color: 'var(--adm-dado)' }}
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {rodape && (
          <footer
            className="flex shrink-0 items-center justify-end gap-2 px-4 py-3"
            style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
          >
            {rodape}
          </footer>
        )}
      </aside>
    </div>
  );
}

/* ── Formulários ─────────────────────────────────────────────────────── */

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="pb-6">
      <div
        className="pb-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--adm-rotulo)' }}
      >
        {titulo}
      </div>
      <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>{children}</div>
    </section>
  );
}

/** Linha rotulada: rótulo de 150px à esquerda, controle à direita. */
export function LinhaRotulada({
  rotulo, apoio, children, primeira,
}: { rotulo: string; apoio?: string; children: ReactNode; primeira?: boolean }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 px-3 py-2.5"
      style={{ borderTop: primeira ? 'none' : '1px solid var(--adm-linha3)' }}
    >
      <div className="w-[150px] shrink-0">
        <div className="text-[13px] font-medium">{rotulo}</div>
        {apoio && (
          <div className="text-[11.5px] leading-snug" style={{ color: 'var(--adm-rotulo)' }}>{apoio}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Campo({
  valor, aoMudar, placeholder, tipo = 'text',
}: { valor: string; aoMudar: (v: string) => void; placeholder?: string; tipo?: string }) {
  return (
    <input
      type={tipo}
      value={valor}
      onChange={e => aoMudar(e.target.value)}
      placeholder={placeholder}
      className="h-[34px] w-full px-2.5 text-[13px] outline-none"
      style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, background: '#fff' }}
    />
  );
}

/**
 * Switch 38×21 chapado. SEM transition — ver o comentário do `.adm-switch` em
 * `index.css`: transition na propriedade que recebe o valor dinâmico congelava
 * o repaint e o controle mostrava o estado anterior.
 */
export function Switch({
  ligado, aoMudar, rotulo, desabilitado,
}: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => aoMudar(!ligado)}
      className="adm-switch disabled:opacity-45"
      style={{ background: ligado ? 'var(--adm-fg)' : '#D9D5D0' }}
    >
      <span style={{ left: ligado ? 20 : 3 }} />
    </button>
  );
}

/**
 * BARRA FIXA quando há alteração não salva.
 *
 * Substitui o botão "Salvar" solto no fim da página: em formulário longo, ele
 * ficava fora da tela justamente enquanto a pessoa editava, e o trabalho se
 * perdia ao navegar sem que nada avisasse.
 */
export function BarraSalvar({
  sujo, salvando, aoDescartar, aoSalvar,
}: { sujo: boolean; salvando?: boolean; aoDescartar: () => void; aoSalvar: () => void }) {
  if (!sujo) return null;
  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 px-4 py-2.5"
      style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
    >
      <span className="text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>Alterações não salvas</span>
      <div className="flex items-center gap-2">
        <Botao altura={30} onClick={aoDescartar} desabilitado={salvando}>Descartar</Botao>
        <Botao altura={30} variante="primario" onClick={aoSalvar} desabilitado={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </Botao>
      </div>
    </div>
  );
}

/* ── Exportação ──────────────────────────────────────────────────────── */

/**
 * CSV com BOM e ponto-e-vírgula.
 *
 * O Excel em português abre CSV separado por vírgula tudo numa coluna só, e
 * sem o BOM come os acentos. Quem exporta daqui abre no Excel.
 */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number)[][]) {
  const escapar = (v: string | number) => {
    const t = String(v ?? '');
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const corpo = [cabecalho, ...linhas].map(l => l.map(escapar).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
