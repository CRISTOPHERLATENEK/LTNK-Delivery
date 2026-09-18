import { describe, it, expect } from 'vitest';
import { blocoDaLanding, injetarConteudo, LIMITE_CONTEUDO_BYTES, type LandingParaConteudo } from './seo-conteudo';

/*
 * A LANDING DA PLATAFORMA TAMBÉM PRECISA DE TEXTO.
 *
 * A etapa 2 deu corpo às páginas de LOJA. A home que vende a plataforma ficou
 * de fora sem ninguém notar, porque `blocoSeoDoTenant` exige loja e devolve
 * vazio sem ela. Medido no HTML público de maxxpedidos.com.br em 18/09/2026:
 *
 *   <h1> ................................ nenhum
 *   <h2> ................................ nenhum
 *   texto fora de script/style .......... 310 caracteres, e eram COMENTÁRIOS
 *
 * Para o Google, uma folha em branco. "O site não aparece em buscas" era
 * consequência disso, não um problema separado.
 *
 * NADA AQUI É TEXTO NOVO: são os campos `landing_*` que o admin já preencheu no
 * editor (24 deles, no banco de produção) e que o visitante já lê na tela. Pelo
 * mesmo motivo do bloco da loja, não é cloaking — mesmo conteúdo, dentro do
 * `#root`, substituído quando o React monta.
 */

const LANDING: LandingParaConteudo = {
  logo: '/uploads/logo.webp',
  titulo: 'Maxx Pedidos',
  subtitulo: 'Conheça o melhor APP de Delivery da Região.',
  recursos: [
    { titulo: 'Lojista', desc: 'Cada lojista com seu próprio painel.' },
    { titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda.' },
  ],
  comoFunciona: [{ titulo: 'Monte seu cardápio', desc: 'Cadastre produtos e preços.' }],
  planos: [
    { nome: 'Iniciante', preco: 'R$ 97/mês', recursos: ['1 loja com domínio próprio', 'Cardápio ilimitado'] },
    { nome: 'Sob medida', preco: '' },
  ],
  faq: [
    { pergunta: 'Preciso de CNPJ pra usar?', resposta: 'Pra emitir NFC-e, sim.' },
    { pergunta: 'Vocês cobram taxa por pedido?', resposta: 'Não. Só a mensalidade do plano.' },
  ],
  segmentos: ['Pizzaria', 'Hamburgueria'],
};

describe('bloco da landing', () => {
  /* Um `<h1>` só, e é a chamada da página: é o sinal mais forte que ela tem, e
     antes o título vivia apenas dentro de `<title>`. */
  it('dá à página o h1 que ela não tinha', () => {
    const b = blocoDaLanding(LANDING);
    expect((b.match(/<h1/g) || []).length).toBe(1);
    expect(b).toContain('Maxx Pedidos');
    expect(b).toContain('Conheça o melhor APP de Delivery da Região.');
  });

  it('leva recursos, como funciona, planos e segmentos', () => {
    const b = blocoDaLanding(LANDING);
    expect(b).toContain('NFC-e integrada');
    expect(b).toContain('Monte seu cardápio');
    expect(b).toContain('Iniciante');
    expect(b).toContain('R$ 97/mês');
    expect(b).toContain('1 loja com domínio próprio');
    expect(b).toContain('Pizzaria');
  });

  /*
   * A FAQ INTEIRA — pergunta E resposta. É o texto mais valioso da página para
   * busca: são as frases que as pessoas digitam ("precisa de CNPJ", "tem taxa
   * por pedido"), com a resposta ao lado.
   */
  it('leva a FAQ com pergunta e resposta', () => {
    const b = blocoDaLanding(LANDING);
    expect(b).toContain('Preciso de CNPJ pra usar?');
    expect(b).toContain('Pra emitir NFC-e, sim.');
    expect(b).toContain('Vocês cobram taxa por pedido?');
    expect(b).toContain('Só a mensalidade do plano.');
  });

  /* Mesma lição do bloco da loja: aberto, o muro de texto pisca na tela antes
     do app montar e parece defeito. Dentro de `<details>` o robô lê igual. */
  it('o detalhamento fica atrás de um details, e a chamada fica visível', () => {
    const b = blocoDaLanding(LANDING);
    expect(b).toContain('<details>');
    const antesDoDetails = b.slice(0, b.indexOf('<details>'));
    expect(antesDoDetails).toContain('<h1>Maxx Pedidos</h1>');
  });

  it('escapa o que vem do editor — é campo livre do admin', () => {
    const b = blocoDaLanding({
      ...LANDING,
      titulo: 'Maxx <script>alert(1)</script>',
      faq: [{ pergunta: 'E & isso?', resposta: '"aspas" e <b>tags</b>' }],
    });
    expect(b).not.toContain('<script>alert(1)</script>');
    expect(b).toContain('&lt;script&gt;');
    expect(b).toContain('&amp;');
    expect(b).not.toContain('<b>tags</b>');
  });

  /* Lista que nunca foi salva não vira seção vazia: o bloco sai menor, nunca
     com um título sem nada embaixo. */
  it('seção sem itens não aparece', () => {
    const b = blocoDaLanding({ ...LANDING, planos: [], faq: [], segmentos: [] });
    expect(b).not.toContain('Planos');
    expect(b).not.toContain('Dúvidas frequentes');
    expect(b).toContain('NFC-e integrada');
  });

  /* Sem título não há bloco: é o estado de um tenant que nunca preencheu nada,
     e meia página em branco é pior que a página de hoje. */
  it('sem título, não há bloco', () => {
    expect(blocoDaLanding(null)).toBe('');
    expect(blocoDaLanding({ ...LANDING, titulo: '' })).toBe('');
  });

  /*
   * O TETO DE BYTES VALE AQUI TAMBÉM. O HTML é `no-store` e baixa inteiro em
   * toda visita: uma FAQ gigante engordaria a home no 3G de todo visitante para
   * agradar o buscador.
   */
  it('respeita o teto de bytes', () => {
    const faq = Array.from({ length: 4000 }, (_, i) => ({
      pergunta: `Pergunta número ${i} sobre o sistema de delivery`,
      resposta: 'Resposta bem comprida '.repeat(20),
    }));
    const b = blocoDaLanding({ ...LANDING, faq });
    expect(Buffer.byteLength(b, 'utf8')).toBeLessThan(LIMITE_CONTEUDO_BYTES * 1.2);
  });

  /* O bloco vive dentro do `#root` — é o que faz o React substituí-lo ao montar,
     e é o que garante que ninguém vê uma coisa e o robô outra. */
  it('entra dentro do #root', () => {
    const html = '<body><div id="root"></div></body>';
    const r = injetarConteudo(html, blocoDaLanding(LANDING));
    expect(r).toContain('<div id="root"><style>');
    expect(r).toContain('Maxx Pedidos');
  });
});

/*
 * O INSTANTE ANTES DO APP MONTAR TEM QUE PARECER CARREGAMENTO.
 *
 * "isso aqui me irrita, tem como isso não aparecer quando carrega?" — sobre o
 * bloco piscando na tela antes do React montar.
 *
 * Não pode sumir: é o texto que o buscador lê, e escondê-lo por CSS seria
 * exatamente o padrão que o Google pune (invisível para pessoa, visível para
 * robô). O que muda é a aparência — centralizado, com a logo em cima e o resto
 * discreto, o mesmo conteúdo lê como "carregando" em vez de página quebrada.
 *
 * O QUE ESTE TESTE GUARDA é que a mudança foi só de aparência: todo o texto
 * continua no HTML. É a regressão fácil de cometer aqui — mexer no visual e
 * levar junto o conteúdo que motivou o bloco.
 */
describe('bloco da landing · tela de carregamento', () => {
  it('se apresenta como carregamento, não como página', () => {
    const b = blocoDaLanding(LANDING);
    expect(b).toContain('id="seo-inicial" class="carregando"');
    expect(b).toContain('class="giro"');
  });

  it('a logo abre o bloco quando existe', () => {
    const b = blocoDaLanding(LANDING);
    expect(b).toContain('<img class="logo" src="/uploads/logo.webp"');
    /* `alt` vazio: o nome vem no h1 logo abaixo, e repetir faria o leitor de
       tela anunciar a marca duas vezes seguidas. */
    expect(b).toContain('alt=""');
  });

  it('sem logo, o bloco continua de pé', () => {
    const b = blocoDaLanding({ ...LANDING, logo: '' });
    expect(b).not.toContain('<img');
    expect(b).toContain('Maxx Pedidos');
  });

  /* A asserção que importa: o visual mudou, o conteúdo não. */
  it('o texto todo continua no HTML depois do restyle', () => {
    const b = blocoDaLanding(LANDING);
    for (const trecho of [
      'Maxx Pedidos', 'Conheça o melhor APP de Delivery da Região.',
      'NFC-e integrada', 'Monte seu cardápio', 'Iniciante', 'R$ 97/mês',
      'Pizzaria', 'Preciso de CNPJ pra usar?', 'Só a mensalidade do plano.',
    ]) {
      expect(b, `sumiu do bloco: ${trecho}`).toContain(trecho);
    }
  });

  /* A logo vem de campo do admin e entra num atributo — aspas fecham o src. */
  it('escapa a URL da logo', () => {
    const b = blocoDaLanding({ ...LANDING, logo: '/x.webp" onerror="alert(1)' });
    expect(b).not.toContain('onerror="alert(1)"');
    expect(b).toContain('&quot;');
  });
});
