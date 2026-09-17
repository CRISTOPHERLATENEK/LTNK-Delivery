import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * TEXTO PEQUENO DEMAIS NAS TELAS OPERACIONAIS.
 *
 * Os painéis de cozinha, lojista e entregador tinham textos de 10 e 11px
 * carregando informação que decide ação: a origem do pedido na cozinha (mandar
 * a moto para uma mesa é o erro), o motivo da rejeição da nota, a pílula que
 * ocupa o lugar do botão de emitir, e a explicação de expor o número pessoal do
 * entregador. São telas lidas de pé, de longe, no meio do movimento.
 *
 * O teste mede o TAMANHO nos trechos exatos — não a existência de um comentário.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const COZINHA = semComentarios(ler('frontend', 'src', 'pages', 'cozinha', 'painel.tsx'));
const LOJISTA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'painel.tsx'));
const ENTREGADOR = semComentarios(ler('frontend', 'src', 'pages', 'entregador', 'index.tsx'));

/** Todo `text-[Npx]` do arquivo, como número. */
function tamanhos(fonte: string): number[] {
  return [...fonte.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1]));
}

describe('nada abaixo de 12px nas telas operacionais', () => {
  /*
   * 12px é o piso: abaixo disso o texto deixa de ser lido e passa a ser
   * "aquela linha cinza". O rótulo de seção do menu lateral do lojista é a
   * única exceção viva — é enfeite de agrupamento, não dado.
   */
  it('a cozinha não tem texto abaixo de 12px', () => {
    expect(tamanhos(COZINHA).filter(n => n < 12)).toEqual([]);
  });

  it('o painel do lojista só mantém 11px no rótulo de seção do menu', () => {
    const abaixo = tamanhos(LOJISTA).filter(n => n < 12);
    expect(abaixo).toEqual([11]);
    expect(LOJISTA).toContain('text-[11px] font-bold uppercase tracking-wider text-muted-foreground');
  });

  it('o painel do entregador não tem texto abaixo de 12px', () => {
    expect(tamanhos(ENTREGADOR).filter(n => n < 12)).toEqual([]);
  });
});

describe('os trechos que decidem ação', () => {
  it('a origem do pedido na cozinha cresceu', () => {
    expect(COZINHA).toContain('<div className="text-[12.5px] uppercase tracking-wide text-muted-foreground mb-2">');
  });

  it('o motivo da rejeição da nota cresceu', () => {
    expect(LOJISTA).toContain('className="mt-0.5 line-clamp-2 text-[13px] text-red-600"');
  });

  it('a pílula que substitui o botão de emitir cresceu', () => {
    expect(LOJISTA).toContain('px-2.5 py-1 text-[12.5px] font-medium text-muted-foreground');
  });
});

describe('contador que muda sozinho avisa quem não vê a tela', () => {
  /*
   * A cozinha refaz a busca a cada 4s. Para quem vê, o número trocar já é o
   * aviso; para leitor de tela, nada acontecia. `polite` fala no intervalo
   * entre frases, sem cortar a leitura do ticket.
   */
  it('a fila da cozinha tem aria-live', () => {
    expect(COZINHA).toContain('<span aria-live="polite" className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">');
  });

  /* "3" sozinho não diz 3 de quê — o rótulo da coluna vai junto. */
  it('cada coluna anuncia o número COM o nome da coluna', () => {
    expect(COZINHA).toContain('aria-label={`${raia.itens.length} em ${raia.titulo}`}');
    const trecho = COZINHA.slice(COZINHA.indexOf('aria-label={`${raia.itens.length}') - 120);
    expect(trecho.slice(0, 200)).toContain('aria-live="polite"');
  });
});
