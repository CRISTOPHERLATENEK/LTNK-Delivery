import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  paraScript, slugDaRota, injetarDados, LIMITE_CARDAPIO_BYTES,
} from './dados-iniciais';

/*
 * OS DADOS DO BOOT DENTRO DO HTML.
 *
 * Medido no navegador do dono da plataforma, na vitrine da Galderio:
 *
 *   0 ─── 187 ms   HTML
 *   189 ─ 305 ms   todo o JS
 *   305 ─ 593 ms   ~290 ms de React acordando
 *   593 ─ 720 ms   /api/lojas/1 e /api/tema
 *
 * As duas chamadas eram a última coisa antes de aparecer produto — e o servidor
 * já sabia as respostas aos 187 ms. Agora vão dentro do HTML.
 *
 * O QUE PODE DAR MUITO ERRADO AQUI, e por isso cada teste existe:
 *   1. escapar mal o JSON = injeção de script a partir do nome de um produto;
 *   2. errar o slug = cardápio de uma loja aparecendo na página de outra;
 *   3. injetar depois do bundle = não adianta nada, as consultas já saíram.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');
const server = ler(BACKEND, 'server.ts');
const publico = ler(BACKEND, 'rotas', 'publico.ts');
const tema = ler(RAIZ, 'frontend', 'src', 'lib', 'tema.ts');
const loja = ler(RAIZ, 'frontend', 'src', 'pages', 'cliente', 'loja.tsx');
const libDados = ler(RAIZ, 'frontend', 'src', 'lib', 'dados-iniciais.ts');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('serializar para dentro de <script>', () => {
  /*
   * O CASO QUE IMPORTA: um produto chamado `</script><img onerror=...>`.
   * `JSON.stringify` sozinho devolve isso literalmente, a tag fecha, e o resto
   * vira HTML executável. É injeção de script pelo nome de um produto — que
   * qualquer lojista digita no painel dele.
   */
  it('nome de produto com </script> não fecha a tag', () => {
    const saida = paraScript({ nome: '</script><img src=x onerror=alert(1)>' });
    expect(saida).not.toContain('</script>');
    expect(saida).not.toContain('<img');
    expect(saida).toContain('\\u003c');
    /* E continua sendo o mesmo dado depois de lido de volta. */
    expect(JSON.parse(saida).nome).toBe('</script><img src=x onerror=alert(1)>');
  });

  /*
   * `>` TAMBEM, por defesa em profundidade. Escapar `<` sozinho ja impede
   * `</script>` e `<!--`; escapar `>` fecha a porta do `-->` e de qualquer
   * variacao que dependa do sinal de maior. Custa nada e o teste existe pra
   * ninguem tirar achando que e sobra.
   */
  it('o sinal de maior também é escapado', () => {
    const saida = paraScript({ n: '--> fim' });
    expect(saida).not.toContain('>');
    expect(saida).toContain('\\u003e');
    expect(JSON.parse(saida).n).toBe('--> fim');
  });

  /* `<!--` abre comentário HTML e engole o resto da página. */
  it('abertura de comentário HTML é neutralizada', () => {
    const saida = paraScript({ n: '<!--' });
    expect(saida).not.toContain('<!--');
    expect(JSON.parse(saida).n).toBe('<!--');
  });

  /*
   * U+2028 e U+2029 são quebras de linha válidas em JavaScript e NÃO em JSON:
   * sem escapar, um deles no meio de uma string parte o script em duas linhas.
   */
  it('separadores de linha invisíveis são escapados', () => {
    const saida = paraScript({ n: 'a b c' });
    expect(saida).not.toContain(' ');
    expect(saida).not.toContain(' ');
    expect(JSON.parse(saida).n).toBe('a b c');
  });

  /* Acento e emoji passam intactos — o escape é só do que quebra o contexto. */
  it('não estraga texto normal', () => {
    const v = { n: 'Pizza Calabresa · R$ 42,00 🍕' };
    expect(JSON.parse(paraScript(v))).toEqual(v);
  });
});

describe('descobrir se a rota é de uma loja', () => {
  it('um segmento é candidato a slug', () => {
    expect(slugDaRota('/galderiobebidas')).toBe('galderiobebidas');
    expect(slugDaRota('/galderiobebidas?utm=x')).toBe('galderiobebidas');
  });

  /*
   * NOMES RESERVADOS NÃO SÃO LOJA. Sem isto, abrir `/carrinho` mandaria o
   * servidor procurar uma loja de slug "carrinho" a cada carga — e, pior, se
   * alguém tivesse esse slug, o HTML do carrinho viria com o cardápio dela.
   */
  it('rota fixa do app não é loja', () => {
    for (const r of ['/carrinho', '/conta', '/pedidos', '/termos', '/privacidade', '/api']) {
      expect(slugDaRota(r)).toBeNull();
    }
  });

  it('raiz e caminhos de dois níveis não são loja', () => {
    expect(slugDaRota('/')).toBeNull();
    expect(slugDaRota('/pedido/32')).toBeNull();
    expect(slugDaRota('/lojista/painel')).toBeNull();
    /*
     * ESTE CASO E O QUE IMPORTA: dois segmentos cujo PRIMEIRO nao e reservado.
     * Sem ele, trocar a contagem de segmentos por qualquer coisa mais frouxa
     * passa despercebida — os outros exemplos sao barrados pela lista de nomes
     * reservados, nao pela contagem, e o teste continuaria verde.
     */
    expect(slugDaRota('/galderiobebidas/produto/9')).toBeNull();
    expect(slugDaRota('/galderiobebidas/x')).toBeNull();
  });

  /* Arquivo que escapou do middleware de estáticos não é loja. */
  it('nome com ponto não é loja', () => {
    expect(slugDaRota('/favicon.ico')).toBeNull();
    expect(slugDaRota('/sw.js')).toBeNull();
  });
});

describe('injetar no HTML', () => {
  const HTML = '<html><head>\n    <title>x</title>\n  </head><body><div id="root"></div></body></html>';

  /*
   * ANTES DO `</head>`, e o bundle está no `<body>`. Injetar depois do script
   * do app seria tarde: as consultas já teriam saído, que é justamente o que
   * este caminho existe para evitar.
   */
  it('o bloco entra no head, antes do body', () => {
    const saida = injetarDados(HTML, { rota: '/x', tema: { nome: 'A' } });
    expect(saida).toContain('window.__DADOS_INICIAIS__=');
    expect(saida.indexOf('__DADOS_INICIAIS__')).toBeLessThan(saida.indexOf('<body'));
    expect(saida.indexOf('__DADOS_INICIAIS__')).toBeLessThan(saida.indexOf('</head>'));
  });

  /* Sem dados, o HTML sai como estava: o app busca pela rota, como antes. */
  it('sem dados, não mexe no HTML', () => {
    expect(injetarDados(HTML, null)).toBe(HTML);
  });

  it('o conteúdo injetado é o que sai do escape', () => {
    const dados = { rota: '/x', tema: { nome: '</script>' } };
    const saida = injetarDados(HTML, dados);
    expect(saida).toContain(paraScript(dados));
    expect(saida).not.toContain('</script><');
  });
});

describe('o cardápio tem teto de tamanho', () => {
  /*
   * O HTML é `no-store`: tudo que entra aqui é baixado de novo em TODA visita,
   * sem cache. Trocar uma ida ao servidor (~70 ms) por bytes só compensa até
   * certo ponto — acima dele, a loja com mil produtos dobraria o HTML para
   * economizar 70 ms.
   */
  it('o teto existe e é generoso o bastante para um cardápio grande', () => {
    /* O maior cardápio real medido (Mostruário) tem ~70 KB. */
    expect(LIMITE_CARDAPIO_BYTES).toBeGreaterThan(70 * 1024);
    expect(LIMITE_CARDAPIO_BYTES).toBeLessThanOrEqual(256 * 1024);
  });

  it('o tamanho é medido em bytes, não em caracteres', () => {
    /* Acento ocupa 2 bytes em UTF-8: medir por `.length` subestimaria o
       cardápio em português inteiro. */
    expect(exec(ler(BACKEND, 'dados-iniciais.ts'))).toContain("Buffer.byteLength(JSON.stringify(cardapio), 'utf8')");
  });
});

describe('o servidor injeta, e nunca quebra por isso', () => {
  it('o fallback da SPA injeta depois das meta tags', () => {
    const codigo = exec(server);
    const iMeta = codigo.indexOf('injetarMeta(lerHtmlBase()');
    const iDados = codigo.indexOf('injetarDados(html, dados)');
    expect(iMeta).toBeGreaterThan(-1);
    expect(iDados).toBeGreaterThan(iMeta);
  });

  /*
   * NUNCA LANÇA. Loja inexistente, banco lento ou tenant sem configuração não
   * podem virar 500 no HTML da SPA — é justamente a SPA que precisa carregar
   * para mostrar o "loja não encontrada" dela.
   */
  it('montarDadosIniciais engole qualquer erro', () => {
    const codigo = exec(ler(BACKEND, 'dados-iniciais.ts'));
    const i = codigo.indexOf('export async function montarDadosIniciais');
    const corpo = codigo.slice(i);
    expect(corpo).toContain('return null;');
    /* Dois `catch`: um para o cardápio (segue sem ele) e o de fora (sem bloco). */
    expect((corpo.match(/catch/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('as rotas continuam existindo', () => {
  /*
   * A injeção encurta o primeiro desenho; ela NÃO substitui as rotas. Quem
   * navega dentro do app sem recarregar, e o React Query revalidando, usam
   * `/api/tema` e `/api/lojas/:id` — se elas sumissem, a navegação interna
   * pararia de funcionar e só a primeira carga teria dados.
   */
  it('/api/tema e /api/lojas/:id seguem servindo o mesmo', () => {
    const codigo = exec(publico);
    expect(codigo).toContain('res.json(await montarTema(req.headers.host));');
    expect(codigo).toContain('res.json(await montarCardapio(req.params.id));');
  });

  /* Uma consulta no lugar de 21: a tabela `configuracoes` tem 26 linhas, e
     perguntar chave por chave custava 17 ms contra 4 ms de ler tudo. */
  it('a marca é montada com uma consulta só', () => {
    const codigo = exec(publico);
    const i = codigo.indexOf('export async function montarTema');
    const corpo = codigo.slice(i, codigo.indexOf('router.get(\'/tema\'', i));
    expect(corpo).toContain("SELECT chave, valor FROM configuracoes");
    expect(corpo).not.toContain("SELECT valor FROM configuracoes WHERE chave = ?");
  });
});

describe('a tela usa o que veio, e só quando é dela', () => {
  /*
   * O PIOR CASO É DADO CERTO NO LUGAR ERRADO. Navegar de uma loja para outra
   * dentro do app mostraria o cardápio da primeira na página da segunda —
   * parece que funcionou, e o cliente pede o produto errado.
   */
  it('o cardápio injetado é recusado se for de outra loja', () => {
    const codigo = exec(libDados);
    expect(codigo).toContain('if (decodeURIComponent(daRota[0]) !== idOuSlug) return null;');
  });

  /* Consumido UMA vez: o bloco é uma foto do instante da carga, e voltar ao
     início da navegação não pode ressuscitar dado velho. */
  it('o bloco é apagado depois de lido', () => {
    const codigo = exec(libDados);
    expect(codigo).toContain('delete window.__DADOS_INICIAIS__;');
    /* Lido no módulo, não por chamada: o `delete` só funciona uma vez e os dois
       consumidores precisam ver o mesmo bloco. */
    expect(codigo).toContain('const BLOCO = consumir();');
  });

  it('a marca nasce do HTML quando ele trouxe', () => {
    const codigo = exec(tema);
    expect(codigo).toContain('const doHtml = temaInicial<TemaMarca>();');
    expect(codigo).toContain('doHtml ? { ...PADRAO, ...doHtml }');
    /* `resolvido` nasce true: sem isso a raiz renderizaria a landing da
       plataforma por um instante antes de decidir que é loja. */
    expect(codigo).toContain('doHtml !== null || lerTemaCacheado() !== null');
  });

  /*
   * E NÃO REVALIDA NA HORA. O bloco foi montado pelo mesmo servidor, na mesma
   * requisição que entregou a página: buscar de novo seria a ida à rede que
   * este caminho existe para eliminar.
   */
  it('não busca /api/tema de novo quando o dado veio do HTML', () => {
    const codigo = exec(tema);
    const i = codigo.indexOf('useEffect(() => {');
    const corpo = codigo.slice(i, i + 400);
    expect(corpo).toContain('if (doHtml)');
    expect(corpo).toContain('return;');
    expect(corpo).toContain('recarregar();');
  });

  /*
   * `initialData` e não `placeholderData`: o dado é REAL. Com placeholder o
   * React Query dispararia a busca na hora, desfazendo o ganho inteiro.
   */
  it('a loja usa initialData', () => {
    const codigo = exec(loja);
    expect(codigo).toContain('const doHtml = cardapioInicial<RespostaCardapio>(id);');
    expect(codigo).toContain('...(doHtml ? { initialData: doHtml } : {}),');
    expect(codigo).not.toContain('placeholderData: doHtml');
  });
});
