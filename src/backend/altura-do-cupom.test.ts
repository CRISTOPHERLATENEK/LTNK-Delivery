import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { regraDePagina } from '../../frontend/src/lib/impressao';

/*
 * O CUPOM SAÍA NUMA FOLHA INTEIRA.
 *
 * "porque sai esse tamanho gigante na impressão? o tamanho tem que ser de
 *  acordo com as informações que existe no pedido."
 *
 * Os cupons declaravam `@page { size: 80mm auto }` desde sempre, e `auto` NÃO
 * FUNCIONA: o CSS aceita `auto` SOZINHO ou DUAS medidas — misturar uma medida
 * com a palavra `auto` é sintaxe inválida. O navegador descarta a declaração
 * inteira e cai no papel do sistema. No diálogo do lojista: um cupom de 7 cm no
 * meio de uma folha, e "1 folha de papel".
 *
 * Numa bobina térmica isso não é só feio: a impressora avança a folha inteira
 * antes de cortar, e cada pedido gasta 20 cm de bobina para imprimir 7.
 *
 * A altura só se sabe DEPOIS de montar a página — depende de quantos itens o
 * pedido tem, de quantos complementos cada item tem e de quantas linhas o
 * endereço ocupa. Por isso é medida no documento pronto; a CONTA, que é o que
 * erra, mora numa função pura e é verificada aqui sem navegador nenhum.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const IMPRESSAO = semComentarios(ler('frontend', 'src', 'lib', 'impressao.ts'));

const CUPOM = '<style>@page { size: 80mm auto; margin: 2mm; }</style>';

/** Só a linha do `@page`, que é onde mora o tamanho. */
const pagina = (regra: { pagina: string } | null) => regra?.pagina ?? '';

describe('a altura vem do conteúdo', () => {
  /* 96px = 1in = 25.4mm é a régua do CSS, não uma aproximação. 300px = 79,375mm
     → 80 arredondando para cima, + 2mm de margem em cima, + 2mm embaixo, + 1 de
     folga = 85. */
  it('converte px em mm pela régua do CSS', () => {
    expect(pagina(regraDePagina(CUPOM, 300))).toBe('@page { size: 80mm 85mm; margin: 0; }');
  });

  /*
   * A MARGEM ENTRA DUAS VEZES: o conteúdo cabe na área ENTRE as margens.
   * Somando uma só, a última linha do cupom cai para uma segunda folha — o
   * defeito oposto, e mais irritante, porque só aparece no pedido comprido.
   */
  it('soma a margem de cima e a de baixo', () => {
    const semMargem = '<style>@page { size: 80mm auto; margin: 0 }</style>';
    /* Mesmos 300px: 80 + 0 + 1 contra 80 + 4 + 1. A diferença é exatamente as
       duas margens. */
    expect(pagina(regraDePagina(semMargem, 300))).toBe('@page { size: 80mm 81mm; margin: 0; }');
  });

  /* Arredonda para CIMA. Um milímetro de papel a mais é barato; uma segunda
     folha com uma linha é um corte a mais na bobina e um cupom no lixo. */
  it('nunca corta o último milímetro', () => {
    /* 301px = 79,64mm → 80, não 79. */
    expect(pagina(regraDePagina(CUPOM, 301))).toBe('@page { size: 80mm 85mm; margin: 0; }');
    expect(pagina(regraDePagina(CUPOM, 380))).toBe('@page { size: 80mm 106mm; margin: 0; }');
  });

  /* Pedido comprido cresce a folha, que é o ponto: "de acordo com as
     informações que existe no pedido". */
  it('pedido maior, papel maior', () => {
    const curto = pagina(regraDePagina(CUPOM, 200));
    const longo = pagina(regraDePagina(CUPOM, 900));
    expect(Number(/(\d+)mm; margin/.exec(curto)![1])).toBeLessThan(Number(/(\d+)mm; margin/.exec(longo)![1]));
  });

  /* A largura NÃO é inventada: vem do `@page` que o próprio cupom declarou. É
     o que faz valer para 58mm sem passar parâmetro novo. */
  it('respeita a largura declarada pelo cupom', () => {
    const bobina58 = '<style>@page { size: 58mm auto; margin: 2mm; }</style>';
    const r = regraDePagina(bobina58, 300)!;
    expect(r.pagina).toContain('size: 58mm');
    expect(r.corpo).toContain('width: 58mm');
  });
});

describe('o que não dá para calcular fica como estava', () => {
  /*
   * SEM `@page` NÃO É CUPOM DE BOBINA. Forçar tamanho num documento comum
   * quebraria a impressão dele — e há chamadas que passam HTML sem regra
   * nenhuma.
   */
  it('HTML sem @page não é tocado', () => {
    expect(regraDePagina('<p>oi</p>', 300)).toBeNull();
  });

  it('@page sem medida de largura não é tocado', () => {
    expect(regraDePagina('<style>@page { margin: 2mm }</style>', 300)).toBeNull();
  });

  /* Altura zero, negativa ou não numérica é medição que falhou — e papel de
     zero milímetro não imprime nada. */
  it('medição inválida devolve null', () => {
    expect(regraDePagina(CUPOM, 0)).toBeNull();
    expect(regraDePagina(CUPOM, -5)).toBeNull();
    expect(regraDePagina(CUPOM, NaN)).toBeNull();
    expect(regraDePagina(CUPOM, Infinity)).toBeNull();
  });
});

describe('como a regra é aplicada', () => {
  /*
   * ANTES DO `print()`: o diálogo lê o `@page` no momento em que abre, e
   * injetar depois não muda mais nada — o preview já estaria montado.
   */
  it('entra antes de mandar imprimir', () => {
    const iAjuste = IMPRESSAO.indexOf('ajustarAlturaDaPagina(doc, html);');
    const iPrint = IMPRESSAO.indexOf('w.print();');
    expect(iAjuste).toBeGreaterThan(0);
    expect(iAjuste).toBeLessThan(iPrint);
  });

  /*
   * ─────── MARGEM ZERO NO PAPEL, RECUO NO CONTEÚDO ───────
   *
   * "tem que sair como cupom fiscal" — cupom de pedido, formato de bobina.
   *
   * O que estragava não era o tamanho: era o CABEÇALHO E O RODAPÉ DO NAVEGADOR.
   * No cupom do pedido #151 saíram a data, o título "Pedido #151", o endereço
   * `https://demo.maxxpedidos.com.br/lojista/produtos` e um "1/1" — quatro
   * linhas que não são do cupom, numa via que o cliente leva.
   *
   * O Chrome imprime esse cabeçalho DENTRO da margem da página. Sem margem não
   * há onde ele caber. Daí `margin: 0` — e a margem volta como PADDING, para o
   * texto não colar na borda do papel.
   */
  it('zera a margem do papel para o navegador não escrever nela', () => {
    expect(pagina(regraDePagina(CUPOM, 300))).toContain('margin: 0;');
  });

  /*
   * A LARGURA DO CORPO VAI JUNTO. Os cupons declaram `body { width: 76mm }` (a
   * folha menos as duas margens) com `box-sizing: border-box`. Só acrescentar
   * `padding` comeria esses 76 por dentro: o texto encolheria para 72mm e
   * sobrariam 4mm de papel em branco na direita.
   *
   * Medido no navegador depois da regra: folha 302px (80mm), texto 287px
   * (76mm) — exatamente a largura de antes.
   */
  it('devolve a margem como recuo, sem estreitar o texto', () => {
    expect(regraDePagina(CUPOM, 300)!.corpo).toBe('body { width: 80mm; padding: 2mm; }');
  });

  /* Cupom sem margem nenhuma não ganha recuo inventado. */
  it('margem zero continua zero', () => {
    const semMargem = '<style>@page { size: 58mm auto; margin: 0 }</style>';
    expect(regraDePagina(semMargem, 300)!.corpo).toBe('body { width: 58mm; padding: 0mm; }');
  });

  /*
   * MEDIÇÃO É MELHORIA, NÃO REQUISITO. Falhar aqui não pode impedir o cupom de
   * sair: sem ela, volta a sair na folha do sistema, como saía antes.
   */
  it('falha em silêncio', () => {
    const i = IMPRESSAO.indexOf('function ajustarAlturaDaPagina(');
    const corpo = IMPRESSAO.slice(i, IMPRESSAO.indexOf('export function abrirEImprimir', i));
    expect(corpo).toContain('try {');
    expect(corpo).toContain('} catch {');
    expect(corpo).not.toContain('throw');
  });

  /*
   * ─────── MEDE O `body`, E NÃO O `documentElement` ───────
   *
   * A primeira versão pegava `Math.max(body, documentElement)`, que parecia a
   * escolha cuidadosa. Medido no navegador, com o cupom real do pedido #4:
   *
   *   body.scrollHeight ............. 241px  (63,8mm — o cupom)
   *   documentElement.scrollHeight ... 800px  (a altura do IFRAME)
   *
   * `documentElement.scrollHeight` nunca é menor que o viewport, e o viewport
   * aqui é o iframe de 800px onde a impressão acontece. O `Math.max` escolhia
   * sempre os 800 e produzia uma folha de 217mm — praticamente a A4 que se veio
   * consertar. E o teste unitário passava, porque a CONTA estava certa: o
   * número que entrava nela é que não era o do cupom.
   */
  it('mede o body, e não o viewport do iframe', () => {
    expect(IMPRESSAO).toContain('regraDePagina(html, doc.body?.scrollHeight ?? 0)');
    const i = IMPRESSAO.indexOf('function ajustarAlturaDaPagina(');
    const corpo = IMPRESSAO.slice(i, IMPRESSAO.indexOf('export function abrirEImprimir', i));
    expect(corpo).not.toContain('documentElement');
    expect(corpo).not.toContain('Math.max(');
  });

  /*
   * O CUPOM MEDIDO NO NAVEGADOR: 241px de conteúdo com 2mm de margem viram uma
   * folha de 69mm. O número está aqui para não voltar a ser 217 sem ninguém
   * perceber.
   */
  it('o cupom do pedido #4 dá 69mm, não 217', () => {
    expect(pagina(regraDePagina(CUPOM, 241))).toBe('@page { size: 80mm 69mm; margin: 0; }');
  });
});

describe('os quatro geradores de cupom passam por aqui', () => {
  /*
   * Todos chamam `abrirEImprimir`, então nenhum precisou mudar. O `auto` segue
   * escrito neles de propósito: é o valor que vale enquanto a medição não
   * aconteceu (e quando ela não acontece).
   */
  it('a correção é num lugar só', () => {
    expect((IMPRESSAO.match(/ajustarAlturaDaPagina\(/g) || []).length).toBe(2);
    const PAINEL = ler('frontend', 'src', 'pages', 'lojista', 'painel.tsx');
    expect(PAINEL).toContain('despacharImpressao(html, larguraMm, blocos)');
  });
});

describe('a folha e o corpo vão para documentos diferentes', () => {
  /*
   * ─────── A DESCOBERTA QUE FEZ TUDO FUNCIONAR ───────
   *
   * "a pré-visualização tem que sair como se fosse cupom 80mm ou 58mm" — e não
   * saía, com nenhuma das tentativas anteriores.
   *
   * `abrirEImprimir` ERA UM POPUP e virou um IFRAME oculto — está no comentário
   * dele: o popup travava o painel, porque `print()` é modal e o popup dividia o
   * event loop com a aba. A troca resolveu o travamento e trouxe um efeito que
   * ninguém viu: o Chrome tira o TAMANHO DO PAPEL do documento de TOPO, não do
   * iframe que está sendo impresso.
   *
   * O `@page` dos cupons parou de valer no dia dessa troca, e a impressão passou
   * a cair no papel do sistema. Foi por isso que nem o `size` nem o `margin: 0`
   * mudaram nada nos testes do lojista: a regra nunca chegou a ser lida.
   *
   * Medido no navegador com a regra no lugar certo: a folha virou 219px — 58mm
   * exatos — e o `@page` apareceu como CSSPageRule de verdade no topo.
   */
  it('a regra da folha é separada da do corpo', () => {
    const r = regraDePagina(CUPOM, 300)!;
    expect(r.pagina.startsWith('@page')).toBe(true);
    expect(r.corpo.startsWith('body')).toBe(true);
    /* Nenhuma das duas carrega a outra: elas vão para documentos diferentes. */
    expect(r.pagina).not.toContain('body');
    expect(r.corpo).not.toContain('@page');
  });

  it('a folha vai para o documento de cima, o corpo para o iframe', () => {
    expect(IMPRESSAO).toContain('noCupom.textContent = regra.corpo;');
    expect(IMPRESSAO).toContain('doc.head?.appendChild(noCupom);');
    /* `document`, sem o `doc.` — é o painel, não o cupom. */
    expect(IMPRESSAO).toContain('noPainel.textContent = regra.pagina;');
    expect(IMPRESSAO).toContain('document.head.appendChild(noPainel);');
  });

  /* `media="print"` para a regra não interferir na tela do painel enquanto
     está lá. */
  it('a regra do painel só vale na impressão', () => {
    expect(IMPRESSAO).toContain("noPainel.media = 'print';");
  });

  /*
   * E SAI DEPOIS. Um `@page` de 58mm esquecido no painel faria a PRÓXIMA
   * impressão de qualquer outra coisa — um relatório, a lista de produtos —
   * sair no tamanho de um cupom, e ninguém ligaria uma coisa à outra.
   */
  it('a regra é removida quando a impressão acaba', () => {
    expect(IMPRESSAO).toContain('return () => { noPainel.remove(); };');
    expect(IMPRESSAO).toContain('limparRegraDaPagina = ajustarAlturaDaPagina(doc, html);');
    const i = IMPRESSAO.indexOf('const limpar = () => {');
    expect(IMPRESSAO.slice(i, i + 200)).toContain('limparRegraDaPagina();');
  });

  /* Falha na medição não pode deixar o painel sem função de limpeza — um
     `undefined()` ali derrubaria a limpeza do iframe junto. */
  it('sempre devolve uma função, mesmo falhando', () => {
    const i = IMPRESSAO.indexOf('function ajustarAlturaDaPagina(');
    const corpo = IMPRESSAO.slice(i, IMPRESSAO.indexOf('export function abrirEImprimir', i));
    expect((corpo.match(/return \(\) => \{\};/g) || []).length).toBe(2);
  });
});

describe('a CSP não pode desfazer a permissão do agente local', () => {
  /*
   * ─────── O MOTIVO DE O CUPOM SAIR EM FOLHA ───────
   *
   * `upgrade-insecure-requests` reescreve TODO sub-recurso `http://` para
   * `https://`. E o `connect-src` libera `http://localhost:9110` de propósito —
   * é como o painel fala com o agente de impressão, que roda no PC do caixa em
   * HTTP simples. A diretiva desfazia essa permissão.
   *
   * Medido no PC do lojista, com o agente RODANDO:
   *
   *   curl http://localhost:9110/status ... 200, e lista a Elgin i7 Plus
   *   barra de endereço do Chrome ......... 200 (navegação não é sub-recurso)
   *   o `fetch` do painel ................. falha
   *
   * O painel lia a falha como "agente não está rodando" e caía no diálogo do
   * navegador — daí o cupom em folha, sem corte: o caminho ESC/POS, que escolhe
   * a bobina e corta, nunca era tentado.
   */
  /*
   * O TEXTO CRU, e não o "sem comentários" que o resto deste arquivo usa.
   *
   * `semComentarios` casa `/*` DENTRO de `https://*.google-analytics.com` — o
   * `//*` da URL abre um comentário aos olhos da expressão — e engole a lista
   * inteira da política até o próximo `*​/`. A asserção passava sem medir nada:
   * conferi devolvendo a diretiva ao código e o teste continuou verde.
   *
   * Aqui a diferença entre código e comentário são as ASPAS: na lista a
   * diretiva aparece como `'upgrade-insecure-requests'`, e nos comentários que
   * explicam a remoção ela aparece entre crases.
   */
  const SERVER = ler('src', 'backend', 'server.ts');

  it('a diretiva que promove http para https não está na política', () => {
    expect(SERVER).not.toContain("'upgrade-insecure-requests'");
  });

  /*
   * E A PERMISSÃO CONTINUA LÁ. Tirar a promoção sem manter o `connect-src` seria
   * trocar um bloqueio por outro — e o sintoma seria idêntico.
   */
  it('o agente local continua liberado nas duas formas', () => {
    expect(SERVER).toContain("'http://localhost:9110'");
    expect(SERVER).toContain("'http://127.0.0.1:9110'");
  });

  /*
   * O RESTO DA POLÍTICA FICA. A remoção é cirúrgica: `object-src 'none'`,
   * `base-uri` e `form-action` são o que essa política entrega de verdade
   * contra XSS, e nada disso tem a ver com o agente.
   */
  it('as defesas que importam continuam', () => {
    expect(SERVER).toContain("object-src 'none'");
    expect(SERVER).toContain("base-uri 'self'");
    expect(SERVER).toContain("form-action 'self'");
  });
});
