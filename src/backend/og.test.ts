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
    <title>Delivery Já</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const meta = (over: Partial<MetaOg> = {}): MetaOg => ({
  titulo: 'Pizzaria do Zé',
  descricao: 'A melhor pizza da cidade',
  imagem: '/uploads/capa.jpg',
  tipo: 'website',
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
