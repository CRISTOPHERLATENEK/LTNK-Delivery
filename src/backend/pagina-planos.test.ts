import { describe, it, expect } from 'vitest';
import { blocoDosPlanos, injetarConteudo } from './seo-conteudo';
import { sitemap } from './seo';
import { SLUGS_RESERVADOS, slugReservado } from './slug-reservado';

/*
 * `/planos` — A PRIMEIRA PÁGINA DE CONTEÚDO COM ENDEREÇO PRÓPRIO.
 *
 * "quero fazer aparecer" (no Google). O site tinha UMA página, e o Google só
 * classifica endereço que existe: "quanto custa", "tem fidelidade", "tem taxa
 * por pedido" — perguntas que alguém digita ANTES de contratar — não tinham
 * onde ser respondidas. Tudo vivia dentro da home, competindo por um endereço.
 *
 * Conferido antes de começar: zero páginas indexadas, e o Googlebot já havia
 * passado (log do nginx, 16:29 de 18/09/2026) — ou seja, faltava o que indexar,
 * não o robô.
 *
 * NADA DE TEXTO NOVO: a página mostra o `landing_planos` que o admin já
 * preencheu, pelo MESMO componente da landing. Preço divergindo entre duas
 * páginas do site é reclamação de cliente, não detalhe de código.
 */

const PLANOS = [
  { nome: 'Iniciante', preco: 'R$ 97/mês', recursos: ['1 loja com domínio próprio', 'Cardápio ilimitado'] },
  { nome: 'Profissional', preco: 'R$ 197/mês', recursos: ['Tudo do Iniciante', 'NFC-e integrada'] },
];

const BASE = { logo: '/uploads/logo.webp', titulo: 'Planos e preços', subtitulo: 'Sem taxa por pedido.' };

describe('o texto que o buscador lê em /planos', () => {
  it('leva nome, preço e o que vem em cada plano', () => {
    const b = blocoDosPlanos({ ...BASE, planos: PLANOS });
    expect(b).toContain('Planos e preços');
    expect(b).toContain('Iniciante');
    expect(b).toContain('R$ 97/mês');
    expect(b).toContain('1 loja com domínio próprio');
    expect(b).toContain('NFC-e integrada');
  });

  /*
   * ABERTO, sem `<details>` — ao contrário do bloco da home.
   *
   * Na home o detalhamento é secundário: quem chega está decidindo se fica. Numa
   * página chamada "planos", a lista É a página — escondê-la atrás de um clique
   * entregaria, a quem veio do buscador, uma página que não responde o que
   * trouxe a pessoa até ela.
   */
  it('não esconde a lista atrás de um clique', () => {
    const b = blocoDosPlanos({ ...BASE, planos: PLANOS });
    expect(b).not.toContain('<details>');
    expect(b).toContain('<h2>');
  });

  /* Um h1 só, e é do que a página trata. */
  it('tem um h1 só', () => {
    const b = blocoDosPlanos({ ...BASE, planos: PLANOS });
    expect((b.match(/<h1/g) || []).length).toBe(1);
  });

  /* Sem planos cadastrados não há página: título com nada embaixo é pior, pra
     quem lê e pra quem indexa, do que esperar o app montar. */
  it('sem planos, não há bloco', () => {
    expect(blocoDosPlanos({ ...BASE, planos: [] })).toBe('');
    expect(blocoDosPlanos(null)).toBe('');
  });

  it('escapa o que vem do editor', () => {
    const b = blocoDosPlanos({
      ...BASE,
      planos: [{ nome: '<script>x</script>', preco: 'R$ 1 & 2', recursos: ['<b>oi</b>'] }],
    });
    expect(b).not.toContain('<script>x</script>');
    expect(b).not.toContain('<b>oi</b>');
    expect(b).toContain('&amp;');
  });

  it('entra dentro do #root, como os outros blocos', () => {
    const r = injetarConteudo('<body><div id="root"></div></body>', blocoDosPlanos({ ...BASE, planos: PLANOS }));
    expect(r).toContain('<div id="root"><style>');
    expect(r).toContain('Iniciante');
  });
});

describe('/planos no sitemap', () => {
  /*
   * SÓ ONDE NÃO HÁ LOJA. No domínio de um cliente, `/planos` não é a nossa
   * página: é o endereço da loja dele. Declará-lo ali mandaria o Google a uma
   * página que não é a que estamos oferecendo.
   */
  it('entra no sitemap da plataforma', () => {
    const xml = sitemap('https://maxxpedidos.com.br', null);
    expect(xml).toContain('<loc>https://maxxpedidos.com.br/planos</loc>');
  });

  it('NÃO entra no sitemap de um cliente', () => {
    const xml = sitemap('https://galderio-bebidas.maxxpedidos.com.br', {
      nome: 'Galderio', slug: 'galderio-bebidas',
    } as never);
    expect(xml).not.toContain('/planos');
  });
});

describe('o slug /planos é da plataforma', () => {
  /*
   * Sem reservar, uma loja com slug `planos` responderia no endereço da página
   * de planos — e a rota `/:id` do app trata um segmento como slug de loja.
   * É a mesma razão pela qual `termos` e `privacidade` já estavam na lista.
   */
  it('nenhuma loja pode tomá-lo', () => {
    expect(slugReservado('planos')).toBe(true);
    expect(slugReservado('PLANOS')).toBe(true);
    expect(SLUGS_RESERVADOS).toContain('planos');
  });

  /* Os outros três já ficam reservados agora: o custo é zero e o de descobrir
     depois, quando a página nascer e a loja já existir, não é. */
  it('os próximos endereços também estão guardados', () => {
    for (const s of ['recursos', 'nota-fiscal', 'duvidas']) {
      expect(slugReservado(s), `faltou reservar ${s}`).toBe(true);
    }
  });
});
