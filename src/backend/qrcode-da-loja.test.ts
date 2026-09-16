import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O QR CODE DA LOJA, PARA IMPRIMIR.
 *
 * Pedido do lojista do Galdério: um código para colar, que ao ser apontado com
 * a câmera abre a loja.
 *
 * ──────────────── POR QUE SÓ O DA LOJA, E NÃO UM POR PRODUTO ────────────────
 *
 * O sistema JÁ sabe abrir um produto por link (`/?produto=123`, em
 * `cliente/loja.tsx`), então o QR por produto é possível. Ficou de fora de
 * propósito: QR IMPRESSO NÃO SE ATUALIZA, e num cardápio de 1.211 itens que
 * pausam, esgotam e mudam de nome, o adesivo da prateleira vira uma decepção
 * que fica lá por meses. O da loja nunca desatualiza.
 *
 * ────────────────────── O QUE ESTE ARQUIVO PROTEGE ──────────────────────────
 *
 * Sobretudo uma coisa: a rota é pública, e só pode codificar o endereço da
 * PRÓPRIA loja. Um gerador que aceitasse `?url=` viraria fábrica de QR de
 * phishing hospedada no domínio do lojista — e o domínio é dele, não nosso.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const PUBLICO = semComentarios(ler('src', 'backend', 'rotas', 'publico.ts'));
const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'qrcode.tsx'));
const CSS = ler('frontend', 'src', 'index.css');

const ROTA = (() => {
  const i = PUBLICO.indexOf("router.get('/qr-da-loja.svg'");
  expect(i).toBeGreaterThan(0);
  return PUBLICO.slice(i, PUBLICO.indexOf("router.get('/lojas/:id'", i));
})();

describe('o código só pode apontar para a própria loja', () => {
  /*
   * O ENDEREÇO VEM DO HOST DA REQUISIÇÃO. É a única fonte que não pode ser
   * escolhida por quem chama — e é o que torna seguro deixar a rota aberta.
   */
  it('a URL é deduzida do Host, nunca recebida', () => {
    expect(PUBLICO).toContain('function urlDaLoja(req: Request)');
    expect(PUBLICO).toContain('${proto}://${req.headers.host}/');
    expect(ROTA).not.toContain('req.query.url');
    expect(ROTA).not.toContain('req.body');
  });

  /* A rota é aberta porque `<a download href>` não manda cabeçalho de
     autenticação — protegê-la obrigaria a baixar por fetch e remontar o arquivo
     em memória para não ganhar nada. */
  it('mora nas rotas públicas', () => {
    expect(PUBLICO).toContain("router.get('/qr-da-loja.svg'");
    expect(PUBLICO).toContain("router.get('/qr-da-loja.png'");
  });
});

describe('as escolhas que decidem se o adesivo lê', () => {
  /*
   * CORREÇÃO ALTA (H) e não média: o código vai para porta de geladeira,
   * sacola e balcão, onde risca, molha e dobra. H recupera até ~30% do código
   * danificado.
   */
  it('correção de erro alta', () => {
    expect(PUBLICO).toContain("errorCorrectionLevel: 'H' as const");
  });

  /*
   * ZONA QUIETA. Sem margem, o código colado junto de uma borda escura não lê
   * em parte dos celulares — e isso se descobre com mil adesivos impressos.
   */
  it('margem em volta', () => {
    expect(PUBLICO).toMatch(/margin: [1-9]/);
  });

  /* O QR é geometria, não foto: acima de 2048 o arquivo cresce sem ganhar
     nitidez, e seria um jeito barato de gastar CPU do servidor. */
  it('o tamanho do PNG tem teto e piso', () => {
    expect(ROTA).toContain('Math.min(2048, Math.max(128,');
  });

  it('SVG e PNG saem com o tipo certo', () => {
    expect(ROTA).toContain("res.type('image/svg+xml')");
    expect(ROTA).toContain("res.type('image/png')");
  });
});

describe('a tela', () => {
  /*
   * O ENDEREÇO MOSTRADO É O DA ABA — o mesmo que o servidor usa para gerar o
   * código. Qualquer outra fonte poderia divergir, e QR que aponta para o lugar
   * errado só se descobre depois de impresso.
   */
  it('mostra o endereço que o código abre', () => {
    expect(TELA).toContain('window.location.host');
    expect(TELA).toContain('/api/qr-da-loja.svg');
  });

  it('baixa nos dois formatos', () => {
    expect(TELA).toContain("baixar('svg')");
    expect(TELA).toContain("baixar('png')");
    expect(TELA).toContain('a.download = `qrcode-loja.${formato}`');
  });

  /* O código sozinho é um quadrado preto: sem a frase e o nome da loja, quem
     passa na frente do balcão não aponta a câmera. */
  it('o cartaz tem nome, frase e endereço', () => {
    expect(TELA).toContain('loja?.nome');
    expect(TELA).toContain('{chamada}');
    expect(TELA).toContain('{enderecoCurto}');
  });

  /*
   * IMPRIMIR MANDA SÓ O CARTAZ. Sem a regra de impressão, `window.print()`
   * levaria para o papel o menu, os botões e o formulário em volta de um
   * quadrado de 4 cm.
   */
  it('a impressão isola o cartaz', () => {
    expect(TELA).toContain('id="qr-para-impressao"');
    expect(CSS).toContain('@media print');
    expect(CSS).toContain('#qr-para-impressao, #qr-para-impressao * { visibility: visible; }');
  });

  /* `visibility` e não `display`: escondendo por display, os ancestrais do
     cartaz sumiriam junto com ele. */
  it('esconde por visibilidade, não por display', () => {
    const i = CSS.indexOf('@media print');
    const bloco = CSS.slice(i, i + 700);
    expect(bloco).toContain('body * { visibility: hidden; }');
    expect(bloco).not.toContain('body * { display: none');
  });
});

describe('a folha com várias cópias', () => {
  /*
   * É O MESMO CÓDIGO, VÁRIAS VEZES. O lojista não quer doze códigos diferentes
   * — quer doze adesivos iguais para pôr em doze sacolas. Imprimir doze folhas
   * com um código cada era o trabalho que esta tela existe para tirar.
   */
  it('dá para escolher quantos saem por folha', () => {
    expect(TELA).toContain('const ARRANJOS');
    for (const n of ['copias: 1', 'copias: 4', 'copias: 8', 'copias: 12']) {
      expect(TELA).toContain(n);
    }
    expect(TELA).toContain('Array.from({ length: copias }');
  });

  /* Cada arranjo diz PARA QUE serve: "12 por folha" sozinho não ajuda a
     escolher; "12 por folha · cartão de mão" ajuda. */
  it('cada arranjo diz para que serve', () => {
    expect(TELA).toContain("para: 'porta e parede'");
    expect(TELA).toContain("para: 'sacola'");
  });

  /*
   * O CARTÃO NÃO PODE SER PARTIDO PELA QUEBRA DE PÁGINA: metade do código numa
   * folha e metade na outra é um QR que não lê.
   */
  it('o cartão não parte entre páginas', () => {
    expect(TELA).toContain("breakInside: 'avoid'");
  });

  /* A linha tracejada é onde recortar — e o navegador só a imprime se mandarem. */
  it('a folha sai com a linha de recorte', () => {
    expect(TELA).toContain('border-dashed');
    /* As DUAS linhas: o Chrome e o Safari ainda pedem a versão com prefixo, e
       procurar só `print-color-adjust` casa dentro de `-webkit-print-...` —
       o teste passava com a regra sem prefixo desfeita (sabotagem mostrou). */
    expect(CSS).toContain('-webkit-print-color-adjust: exact;');
    expect(CSS).toMatch(/\n\s*print-color-adjust: exact;/);
  });

  /* A margem padrão do navegador rouba quase um cartão de uma grade de 12. */
  it('a página imprime com margem curta', () => {
    expect(CSS).toMatch(/@page \{\s*margin: 8mm;/);
  });
});
