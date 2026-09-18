import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O PAINEL ADMIN NO ESCURO — o teste que impede o branco-no-branco de voltar.
 *
 * O defeito chegou à produção e foi relatado assim: "esse preto não tem nada a
 * ver com a cor do site", "não dá pra ler o que eu escrevo", "as letras tem que
 * ser adaptativa a cor do site", "falta o modo dark no painel adm".
 *
 * O painel entrava em `.dark` SOZINHO — o script de tema do `index.html` cai no
 * `prefers-color-scheme` quando a área não tem preferência salva, e ninguém
 * nunca pôde salvar uma no admin. Mas a paleta `.adm` era fixa e só clara,
 * enquanto os componentes de dentro (`Card`, com `bg-card text-card-foreground`)
 * seguem os tokens do tema. Metade da tela escurecia, a outra metade não.
 *
 * O PIOR ERA O CAMPO DE TEXTO. Os `input` do painel só declaravam borda: sem
 * `background` e sem `color`. Herdavam o texto quase branco do `Card` e ficavam
 * com o fundo branco padrão do navegador. Medido no Chrome, montando a estrutura
 * real da tela (`.adm` > Card > input) e lendo o estilo computado:
 *
 *   antes ..... fundo rgb(255,255,255) + texto rgb(250,250,250) = 1,04:1
 *   depois .... fundo rgb(35,33,32)    + texto rgb(234,231,227) = 13,01:1
 *
 * POR QUE O TESTE LÊ O FONTE: cor resolvida só existe com navegador. O que
 * precisa ser protegido aqui é a REGRA — que a paleta escura exista, que o campo
 * declare as duas cores juntas, e que nenhuma tela do admin volte a cravar
 * branco. Faltando qualquer uma das três, o defeito volta inteiro.
 *
 * CONFERIDO QUE ELE MEDE: desfazendo o conserto de propósito (tirando o bloco
 * `.dark .adm`, as cores do campo e devolvendo um `'#fff'` ao layout), quatro
 * destes testes ficam vermelhos; restaurando, todos voltam ao verde.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const CSS = ler('frontend', 'src', 'index.css');

describe('paleta do painel admin', () => {
  /* Sem este bloco, o `.dark` do sistema operacional cai num painel que só sabe
     ser claro — que é exatamente como o defeito nasceu. */
  it('tem paleta escura própria', () => {
    expect(CSS).toContain('.dark .adm');
    expect(CSS).toMatch(/\.dark \.adm \{[^}]*--adm-fundo:/);
    expect(CSS).toMatch(/\.dark \.adm \{[^}]*--adm-campo:/);
  });

  /*
   * O `color-scheme` manda no que o NAVEGADOR desenha: barra de rolagem,
   * calendário do `date`, lista aberta do `select`, autofill. Sem ele, esses
   * pedaços saem brancos no meio da tela escura, e não há CSS nosso que os
   * pinte.
   */
  it('declara color-scheme nos dois modos', () => {
    expect(CSS).toMatch(/\.adm \{[^}]*color-scheme: light/);
    expect(CSS).toMatch(/\.dark \.adm \{[^}]*color-scheme: dark/);
  });

  /*
   * AS DUAS CORES JUNTAS, na mesma regra. Declarar só o fundo (ou só o texto) é
   * literalmente como o campo ficou ilegível: o fundo vinha do navegador, o
   * texto vinha herdado do Card escuro, e nenhum dos dois sabia do outro.
   */
  it('campo de texto declara fundo E cor', () => {
    /* A regra das CORES é a que exclui caixa de marcar e rádio no seletor — a
       outra, de `box-sizing`, também começa com `.adm input` e casaria aqui. */
    const regra = /\.adm input:not[^{]*\{([^}]*)\}/.exec(CSS);
    expect(regra).not.toBeNull();
    expect(regra![1]).toContain('background: var(--adm-campo)');
    expect(regra![1]).toContain('color: var(--adm-fg)');
  });

  /* Caixa de marcar e rádio ficam de fora: neles o "fundo" é o controle que o
     navegador desenha, e pintá-lo apagaria o próprio marcador. */
  it('não pinta caixa de marcar nem rádio', () => {
    expect(CSS).toContain(":not([type='checkbox'])");
    expect(CSS).toContain(":not([type='radio'])");
  });

  /* Ligado, a trilha do switch é `--adm-fg` — quase branca no escuro. Bolinha
     branca sobre ela desaparecia, e o switch perdia o estado que ele mostra. */
  it('bolinha do switch acompanha a página', () => {
    expect(CSS).toMatch(/\.adm-switch > span \{[^}]*background: var\(--adm-fundo\)/);
  });
});

/*
 * NENHUMA TELA DO ADMIN CRAVA BRANCO.
 *
 * São 14 telas e mais de cem campos: consertar um a um deixaria o próximo campo
 * escrito nascendo errado. O token existe para que escrever do jeito de sempre
 * já saia certo — e é esta asserção que mantém o caminho fácil sendo o certo.
 *
 * O QUE CONTINUA VALENDO, e não é exceção de conveniência:
 *
 *   `var(--adm-fundo, #fff)` ....... fallback de um token que sempre existe
 *   `value={cor || '#ffffff'}` ..... VALOR de um seletor de cor: é o dado que o
 *                                    admin escolhe, e não pinta tela nenhuma
 *
 * Por isso a busca é pelo branco em posição de VALOR DE PROPRIEDADE CSS
 * (`background: '#fff'`) e em borda (`solid #fff`) — onde ele vira cor de
 * interface e briga com o modo escuro.
 */
describe('telas do admin usam tokens, não cor fixa', () => {
  function arquivos(base: string): string[] {
    return fs.readdirSync(base, { withFileTypes: true }).flatMap((e: fs.Dirent) => {
      const caminho = path.join(base, e.name);
      if (e.isDirectory()) return arquivos(caminho);
      return e.name.endsWith('.tsx') ? [caminho] : [];
    });
  }

  const telas = arquivos(path.join(raiz, 'frontend', 'src', 'pages', 'admin'))
    .map(a => path.relative(raiz, a));

  /* Se a varredura não achar tela nenhuma, o `it.each` não roda NADA e a suíte
     fica verde sem ter medido — o jeito mais silencioso de um teste morrer. */
  it('encontra as telas do admin', () => {
    expect(telas.length).toBeGreaterThan(10);
  });

  it.each(telas)('%s não tem branco cravado no estilo', (tela) => {
    const fonte = ler(tela);
    const cravado = fonte.match(/:\s*'#(fff|ffffff)'|solid\s+#(fff|ffffff)\b/gi) ?? [];
    expect(cravado).toEqual([]);
  });
});
