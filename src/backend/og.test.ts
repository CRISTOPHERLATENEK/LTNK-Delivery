import { describe, it, expect } from 'vitest';
import { injetarMeta, type MetaOg } from './og';

/**
 * `metaDaRota` depende de banco (roda dentro do contexto de tenant), então quem
 * é testado aqui é `injetarMeta` — a parte que monta o HTML servido e, por isso,
 * a parte onde um erro vira XSS ou cartão de link quebrado sem ninguém notar.
 */
const HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="texto da plataforma" />
    <meta name="theme-color" content="#dc2640" />
    <title>Delivery Já</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const meta = (over: Partial<MetaOg> = {}): MetaOg => ({
  titulo: 'Pizzaria do Zé',
  tituloBusca: '',
  descricao: 'A melhor pizza da cidade',
  imagem: '/uploads/capa.jpg',
  tipo: 'website',
  cor: '#ffa200',
  ...over,
});

describe('injetarMeta', () => {
  it('troca o título da plataforma pelo da loja', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/pedido/32');
    expect(html).toContain('<title>Pizzaria do Zé</title>');
    expect(html).not.toContain('<title>Delivery Já</title>');
  });

  it('não deixa dois <title> nem duas descriptions', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/');
    expect(html.match(/<title>/g)).toHaveLength(1);
    // Uma name="description" (a nossa) — o texto da plataforma tem que sair.
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).not.toContain('texto da plataforma');
  });

  it('torna og:image absoluta — relativa é ignorada pelo WhatsApp', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/');
    expect(html).toContain('<meta property="og:image" content="https://loja.com/uploads/capa.jpg" />');
  });

  it('preserva URL de imagem que já é absoluta', () => {
    const html = injetarMeta(HTML, meta({ imagem: 'https://cdn.x.com/a.png' }), 'https://loja.com', 'https://loja.com/');
    expect(html).toContain('content="https://cdn.x.com/a.png"');
  });

  it('sem imagem usa card "summary" — large_image vazio vira cartão em branco', () => {
    const html = injetarMeta(HTML, meta({ imagem: '' }), 'https://loja.com', 'https://loja.com/');
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).not.toContain('summary_large_image');
    expect(html).not.toContain('og:image');
  });

  it('ESCAPA aspas e markup: nome vem do lojista e fecharia o atributo', () => {
    const html = injetarMeta(
      HTML,
      meta({ titulo: 'Zé "O Bom" <script>alert(1)</script>', descricao: "aspa ' e & comercial" }),
      'https://loja.com',
      'https://loja.com/',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;O Bom&quot;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&amp;');
  });

  it('registra a URL canônica da própria rota', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/pedido/32');
    expect(html).toContain('<meta property="og:url" content="https://loja.com/pedido/32" />');
  });

  it('tipo article no pedido, website na vitrine', () => {
    expect(injetarMeta(HTML, meta({ tipo: 'article' }), 'https://l.com', 'https://l.com/pedido/1'))
      .toContain('og:type" content="article"');
    expect(injetarMeta(HTML, meta(), 'https://l.com', 'https://l.com/'))
      .toContain('og:type" content="website"');
  });
});

describe('injetarMeta — nome do app instalado', () => {
  it('troca apple-mobile-web-app-title, senão o ícone no iPhone fica com a marca da plataforma', () => {
    const html = `<head><meta name="description" content="x" /><meta name="apple-mobile-web-app-title" content="Delivery Já" /><title>Delivery Já</title></head>`;
    const r = injetarMeta(html, meta(), 'https://l.com', 'https://l.com/');
    expect(r).toContain('name="apple-mobile-web-app-title" content="Pizzaria do Zé"');
    expect(r).not.toContain('content="Delivery Já"');
  });
});

import { normalizarHost } from './dominios';

/**
 * `normalizarHost` é o que faz o white-label funcionar em QUALQUER domínio, hoje
 * e nos futuros: o Host do request tem que virar exatamente o formato em que o
 * domínio é gravado (sem protocolo, sem www, minúsculo, sem porta). Errar aqui
 * faz `www.loja.com` não casar com `loja.com` e o cartão sair genérico no site
 * do lojista — falha silenciosa, sem erro em log nenhum.
 */
describe('normalizarHost', () => {
  it('casa com o formato salvo no banco', () => {
    expect(normalizarHost('loja.com.br')).toBe('loja.com.br');
    expect(normalizarHost('www.loja.com.br')).toBe('loja.com.br');
    expect(normalizarHost('LOJA.com.br')).toBe('loja.com.br');
    expect(normalizarHost('loja.com.br:443')).toBe('loja.com.br');
    expect(normalizarHost('www.LOJA.com.br:3000')).toBe('loja.com.br');
  });

  it('subdomínio NÃO é confundido com o domínio raiz', () => {
    // pizzaria.plataforma.com e plataforma.com são domínios diferentes: casar um
    // com o outro faria uma loja aparecer no lugar de outra.
    expect(normalizarHost('pizzaria.plataforma.com')).toBe('pizzaria.plataforma.com');
    expect(normalizarHost('www.pizzaria.plataforma.com')).toBe('pizzaria.plataforma.com');
  });

  it('host ausente ou vazio não quebra', () => {
    expect(normalizarHost(undefined)).toBe('');
    expect(normalizarHost('')).toBe('');
  });

  it('só o www DO INÍCIO sai — "www" no meio é parte do nome', () => {
    expect(normalizarHost('loja.www.com.br')).toBe('loja.www.com.br');
  });
});

import { paginaSuspensa } from './og';

/**
 * O teste de corte de assinatura em produção revelou isto: com o tenant
 * desativado, `resolverPorHost` não achava nada e o domínio do cliente caía no
 * tenant padrão — passava a entregar A PLATAFORMA. A landing de vendas, com preço
 * e "fale com a gente", no endereço do lojista inadimplente.
 */
describe('paginaSuspensa', () => {
  it('mostra o nome da LOJA, nunca a marca da plataforma', () => {
    const h = paginaSuspensa('Pizzaria do Zé');
    expect(h).toContain('Pizzaria do Zé');
    expect(h).not.toMatch(/Delivery Já|Maxx Delivery|fale com a gente/i);
  });

  it('escapa o nome (vem do cadastro do lojista)', () => {
    const h = paginaSuspensa('Zé <script>alert(1)</script> & Cia');
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&amp;');
  });

  it('noindex: mensalidade atrasada não pode desindexar a loja do Google', () => {
    expect(paginaSuspensa('X')).toContain('name="robots" content="noindex"');
  });

  it('nome vazio não deixa a página sem título', () => {
    expect(paginaSuspensa('')).toContain('Esta loja');
  });
});

describe('paginaSuspensa — contato do suporte', () => {
  it('mostra botão de WhatsApp com o telefone configurado', () => {
    const h = paginaSuspensa('Loja X', { email: '', telefone: '(47) 99417-3970' });
    expect(h).toContain('https://wa.me/5547994173970');
    expect(h).toContain('Falar no WhatsApp');
  });

  it('não duplica o 55 quando o telefone já tem o país', () => {
    const h = paginaSuspensa('Loja X', { email: '', telefone: '5547994173970' });
    expect(h).toContain('https://wa.me/5547994173970');
    expect(h).not.toContain('5555');
  });

  it('telefone curto/inválido não gera link quebrado', () => {
    const h = paginaSuspensa('Loja X', { email: '', telefone: '1234' });
    expect(h).not.toContain('wa.me');
  });

  it('mostra e-mail quando houver', () => {
    expect(paginaSuspensa('Loja X', { email: 'ajuda@x.com', telefone: '' }))
      .toContain('mailto:ajuda@x.com');
  });

  it('sem contato configurado, cai no texto genérico em vez de botão vazio', () => {
    const h = paginaSuspensa('Loja X', { email: '', telefone: '' });
    expect(h).toContain('Entre em contato com o suporte');
    expect(h).not.toContain('wa.me');
    expect(h).not.toContain('mailto:');
  });

  it('escapa o contato também (vem de campo editável)', () => {
    const h = paginaSuspensa('Loja X', { email: 'a"><script>x</script>@b.com', telefone: '' });
    expect(h).not.toContain('<script>x</script>');
  });
});

/**
 * A COR DA BARRA DO NAVEGADOR.
 *
 * Regressão de um defeito medido em produção (maxxpedidos.com.br, 18/09/2026):
 * `theme-color` saía `#dc2640`, o vermelho do padrão antigo, cravado no
 * `index.html` — enquanto a cor escolhida no painel era `#ffa200`. O laranja
 * pintava o site inteiro e parava na borda da página: a barra do Chrome no
 * celular e o splash do app instalado continuavam vermelhos.
 *
 * E não era de um cliente só: a cor é configurável por tenant, e a tag ignorava
 * a escolha de todos.
 */
describe('injetarMeta · theme-color', () => {
  it('troca a cor fixa do arquivo pela cor da marca', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/');
    expect(html).toContain('<meta name="theme-color" content="#ffa200" />');
    expect(html).not.toContain('#dc2640');
  });

  it('não deixa duas theme-color', () => {
    const html = injetarMeta(HTML, meta(), 'https://loja.com', 'https://loja.com/');
    expect(html.match(/name="theme-color"/g)).toHaveLength(1);
  });

  /* Sem cor para dizer (banco fora, loja sem cor própria), a do arquivo fica:
     manter a cor velha é melhor que servir uma tag sem valor. */
  it('cor vazia mantém a do arquivo', () => {
    const html = injetarMeta(HTML, meta({ cor: '' }), 'https://loja.com', 'https://loja.com/');
    expect(html).toContain('<meta name="theme-color" content="#dc2640" />');
  });

  /*
   * SÓ HEXADECIMAL ENTRA. O valor vem de campo editável, e uma tag inválida é
   * pior que a cor velha — além de ser por onde entraria HTML na `<head>`.
   */
  it('valor torto não vira tag', () => {
    for (const ruim of ['vermelho', '"><script>x</script>', '#zz', 'rgb(1,2,3)']) {
      const html = injetarMeta(HTML, meta({ cor: ruim }), 'https://loja.com', 'https://loja.com/');
      expect(html).toContain('content="#dc2640"');
      expect(html).not.toContain('<script>x</script>');
    }
  });

  it('aceita as formas válidas de hex', () => {
    for (const bom of ['#fff', '#FFA200', '#ffa200cc']) {
      const html = injetarMeta(HTML, meta({ cor: bom }), 'https://loja.com', 'https://loja.com/');
      expect(html).toContain(`content="${bom}"`);
    }
  });
});

/**
 * O TÍTULO DE BUSCA É OUTRO CAMPO, E NÃO PODE VAZAR PARA ONDE VAI O NOME.
 *
 * Pedido de fora, e a sugestão era trocar o título por "MAXX pedidos | Sistema
 * para delivery, PDV e NFC-e". A ideia está certa — quem ainda não conhece a
 * marca não procura pelo nome dela —, mas trocar o `marca_nome` derramaria essa
 * frase no cabeçalho do painel, no rodapé e no `alt` da logo.
 *
 * Então são dois campos, e cada tag recebe o que faz sentido nela:
 *
 *   título da PÁGINA .. <title>, og:title, twitter:title
 *   NOME da marca ..... og:site_name, apple-mobile-web-app-title
 *
 * O segundo é o que o iPhone escreve embaixo do ícone na tela de início: frase
 * de 60 caracteres ali não cabe.
 */
describe('injetarMeta · título de busca', () => {
  const comBusca = meta({ tituloBusca: 'Maxx Pedidos | Sistema para delivery, PDV e NFC-e' });

  it('o <title> e o cartão recebem o título de busca', () => {
    const html = injetarMeta(HTML, comBusca, 'https://l.com', 'https://l.com/');
    expect(html).toContain('<title>Maxx Pedidos | Sistema para delivery, PDV e NFC-e</title>');
    expect(html).toContain('og:title" content="Maxx Pedidos | Sistema para delivery, PDV e NFC-e"');
    expect(html).toContain('twitter:title" content="Maxx Pedidos | Sistema para delivery, PDV e NFC-e"');
  });

  /* A asserção que protege o painel: o nome curto continua onde é nome. */
  it('o nome da marca fica no site_name e no ícone do iPhone', () => {
    const html = `<head><meta name="description" content="x" /><meta name="apple-mobile-web-app-title" content="antigo" /><title>antigo</title></head>`;
    const r = injetarMeta(html, comBusca, 'https://l.com', 'https://l.com/');
    expect(r).toContain('og:site_name" content="Pizzaria do Zé"');
    expect(r).toContain('apple-mobile-web-app-title" content="Pizzaria do Zé"');
    expect(r).not.toContain('apple-mobile-web-app-title" content="Maxx Pedidos |');
  });

  /* Vazio é o estado de quem nunca preencheu: tudo segue como antes. */
  it('sem título de busca, tudo volta a ser o nome', () => {
    const html = injetarMeta(HTML, meta(), 'https://l.com', 'https://l.com/');
    expect(html).toContain('<title>Pizzaria do Zé</title>');
    expect(html).toContain('og:title" content="Pizzaria do Zé"');
  });

  /* Só espaço em branco também é "não preenchido" — senão o <title> sairia vazio. */
  it('espaço em branco conta como vazio', () => {
    const html = injetarMeta(HTML, meta({ tituloBusca: '   ' }), 'https://l.com', 'https://l.com/');
    expect(html).toContain('<title>Pizzaria do Zé</title>');
  });

  it('escapa o título de busca, que é campo livre do admin', () => {
    const html = injetarMeta(HTML, meta({ tituloBusca: '<script>x</script> & cia' }), 'https://l.com', 'https://l.com/');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
