import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { robots, sitemap, canonical, dadosEstruturados, type LojaParaSeo } from './seo';

/*
 * A LOJA APARECENDO NO GOOGLE.
 *
 * ────────────────────────── O ESTADO MEDIDO ─────────────────────────────────
 *
 * Em 16/09/2026, pedindo a vitrine do Galdério como Googlebot:
 *
 *   <title> .................. GALDERIO BEBIDAS      ✔
 *   Open Graph ............... completo              ✔
 *   <meta description> ....... VAZIA                 ✘
 *   robots.txt ............... 404                   ✘
 *   sitemap.xml .............. 404                   ✘
 *   canonical ................ não existia           ✘
 *   dados estruturados ....... não existiam          ✘
 *
 * E a busca por "galderio bebidas delivery" devolvia a BEBIDA "Trago do
 * Galdério" em marketplaces, não a conveniência.
 *
 * O que este arquivo prende é sobretudo o que NÃO pode acontecer: canonical
 * apontando para domínio que a loja não tem (tira a loja do índice), painel
 * liberado para rastreio, e endereço declarado no sitemap que não existe.
 */

const loja = (extra: Partial<LojaParaSeo> = {}): LojaParaSeo => ({
  id: 1, nome: 'GALDERIO BEBIDAS', slug: 'galderiobebidas',
  descricao: null, endereco: null, horario_funcionamento: null,
  logo_url: null, capa_url: null, dominio_personalizado: null, ...extra,
});

describe('robots.txt', () => {
  /*
   * PAINEL NÃO SE RASTREIA. Não é sobre segurança (o acesso já exige sessão) —
   * é sobre o Google gastar a cota de rastreio da loja em telas que devolvem a
   * casca do app, e sobre link de painel aparecendo em resultado de busca.
   */
  it('fecha os painéis e os caminhos de sessão', () => {
    const t = robots('https://galderio-bebidas.maxxpedidos.com.br', true);
    for (const p of ['/api/', '/lojista', '/entregador', '/cozinha', '/painel-admin',
      '/conta', '/carrinho', '/pedido/']) {
      expect(t).toContain(`Disallow: ${p}`);
    }
  });

  /* As fotos dos produtos ficam LIBERADAS: é por elas que a loja aparece na
     busca por imagens, que para comida e bebida é metade da descoberta. */
  it('não bloqueia as fotos', () => {
    expect(robots('https://x.com.br', true)).not.toContain('Disallow: /uploads');
  });

  it('aponta o sitemap quando há loja', () => {
    expect(robots('https://x.com.br', true)).toContain('Sitemap: https://x.com.br/sitemap.xml');
  });

  /* Sem loja no host (a plataforma, ou tenant sem loja aprovada) o arquivo
     continua saindo — o que some é a linha do sitemap, que apontaria para um
     arquivo sem endereço nenhum. */
  it('sem loja, não promete sitemap', () => {
    expect(robots('https://x.com.br', false)).not.toContain('Sitemap:');
    expect(robots('https://x.com.br', false)).toContain('User-agent: *');
  });
});

describe('sitemap.xml', () => {
  it('declara a vitrine na raiz', () => {
    const x = sitemap('https://x.com.br', loja());
    expect(x).toContain('<loc>https://x.com.br/</loc>');
    expect(x).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  /*
   * SÓ ENDEREÇO QUE EXISTE. Produto não tem URL própria neste sistema —
   * declarar `/produto/123` daria 200 com a mesma vitrine, e um sitemap cheio de
   * endereços que devolvem a mesma página é o caminho mais rápido para o Google
   * classificar o site como conteúdo duplicado.
   */
  it('não inventa endereço de produto', () => {
    const x = sitemap('https://x.com.br', loja());
    expect(x).not.toContain('/produto');
    expect(x).not.toContain('/categoria');
  });

  /*
   * ESCAPE DO XML — e o que sobrou para escapar mudou de lugar.
   *
   * Era o SLUG da loja que ia no arquivo, e ele saiu: `/slug` devolve a mesma
   * página que a raiz, e declará-lo como segundo endereço era o conteúdo
   * duplicado que o próprio cabeçalho desta função avisa (ver `seo-etapa2`).
   *
   * Sobrou o que vem do HOST, que não é digitado por ninguém mas chega da
   * requisição — e um sitemap inválido não dá erro: é ignorado por completo,
   * sem aviso, e a loja simplesmente não é descoberta.
   */
  it('escapa o que vai dentro do XML', () => {
    const x = sitemap('https://x.com.br/?a=1&b=2', loja());
    expect(x).toContain('&amp;b=2');
    expect(x).not.toMatch(/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  /* E o slug não volta por acidente: é o defeito que se veio consertar. */
  it('o slug não entra mais', () => {
    expect(sitemap('https://x.com.br', loja({ slug: 'bar-grill' }))).not.toContain('bar-grill');
  });
});

describe('canonical — o que pode tirar a loja do índice', () => {
  /* Auto-referência é o padrão seguro: a página oficial é ela mesma. */
  it('sem domínio próprio, aponta para ela mesma', () => {
    expect(canonical('https://galderio.maxxpedidos.com.br/', loja()))
      .toBe('https://galderio.maxxpedidos.com.br/');
  });

  /*
   * NUNCA APONTA PARA UM DOMÍNIO QUE A LOJA NÃO TEM. Este é o defeito que
   * apagaria a loja da busca: canonical para um endereço que não responde faz o
   * Google descartar a página que responde.
   */
  it('não inventa domínio', () => {
    const r = canonical('https://galderio.maxxpedidos.com.br/', loja({ dominio_personalizado: null }));
    expect(r).toContain('maxxpedidos.com.br');
  });

  /* Com domínio próprio, o subdomínio da plataforma para de competir com ele
     pela mesma loja. */
  it('com domínio próprio, o oficial é o domínio da loja', () => {
    const r = canonical('https://galderio.maxxpedidos.com.br/carrinho',
      loja({ dominio_personalizado: 'galderiobebidas.com.br' }));
    expect(r).toBe('https://galderiobebidas.com.br/carrinho');
  });

  /* Já estando no domínio próprio, aponta para si — trocar por outra forma da
     mesma URL só criaria um redirecionamento a mais para o robô seguir. */
  it('no próprio domínio, aponta para si', () => {
    const r = canonical('https://galderiobebidas.com.br/', loja({ dominio_personalizado: 'galderiobebidas.com.br' }));
    expect(r).toBe('https://galderiobebidas.com.br/');
  });

  /* Query string não faz página nova: `?utm_source=whatsapp` viraria uma
     duplicata da vitrine para cada campanha. */
  it('corta a query', () => {
    expect(canonical('https://x.com.br/?utm_source=whatsapp', loja())).toBe('https://x.com.br/');
  });
});

describe('dados estruturados', () => {
  it('sem loja, não sai bloco nenhum', () => {
    expect(dadosEstruturados(null, 'https://x.com.br')).toBe('');
  });

  it('leva nome, endereço e horário quando existem', () => {
    const s = dadosEstruturados(loja({
      endereco: 'Rua Dilson Funaro, Joinville - SC',
      horario_funcionamento: 'Segunda a Domingo 11h às 01:00',
    }), 'https://x.com.br');
    expect(s).toContain('"@type":"Store"');
    expect(s).toContain('GALDERIO BEBIDAS');
    expect(s).toContain('PostalAddress');
    expect(s).toContain('openingHours');
  });

  /*
   * CAMPO VAZIO NÃO ENTRA. Dado estruturado com campo vazio é motivo de o
   * Google descartar o bloco INTEIRO — e aí nem o nome aparece.
   */
  it('o que a loja não preencheu não aparece', () => {
    const s = dadosEstruturados(loja(), 'https://x.com.br');
    expect(s).not.toContain('address');
    expect(s).not.toContain('openingHours');
    expect(s).not.toContain('description');
  });

  /* `</script>` dentro da descrição fecharia a tag e injetaria markup na
     página servida — o mesmo buraco que o `esc()` do og.ts tapa nos atributos. */
  it('não deixa fechar a tag por dentro', () => {
    const s = dadosEstruturados(loja({ descricao: 'olha </script><img src=x onerror=alert(1)>' }), 'https://x.com.br');
    expect(s).not.toContain('</script><img');
    expect(s).toContain('\\u003c');
  });

  /* Imagem relativa é ignorada pelo Google — vira URL absoluta. */
  it('a imagem sai absoluta', () => {
    const s = dadosEstruturados(loja({ logo_url: '/uploads/logo.webp' }), 'https://x.com.br');
    expect(s).toContain('https://x.com.br/uploads/logo.webp');
  });
});

/* ───────────────────── a ligação com o servidor ───────────────────── */

const SERVER = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const OG = fs.readFileSync(path.join(__dirname, 'og.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('servido de verdade', () => {
  /*
   * AS DUAS ROTAS TÊM QUE VIR ANTES DO ESTÁTICO. Os dois nomes têm ponto, e o
   * fallback do SPA devolve tudo que tem ponto para o `express.static` — que
   * responderia 404, que foi exatamente o que a medição encontrou.
   */
  it('robots e sitemap vêm antes do fallback do SPA', () => {
    const r = SERVER.indexOf("app.get('/robots.txt'");
    const s = SERVER.indexOf("app.get('/sitemap.xml'");
    const fallback = SERVER.indexOf('let htmlBase: string | null = null');
    expect(r).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(0);
    expect(r).toBeLessThan(fallback);
    expect(s).toBeLessThan(fallback);
  });

  /* Robô que leva 500 no robots.txt trata o site inteiro como proibido. */
  it('erro no banco não vira erro na resposta', () => {
    const i = SERVER.indexOf("app.get('/robots.txt'");
    const corpo = SERVER.slice(i, SERVER.indexOf("app.get('/sitemap.xml'"));
    expect(corpo).toContain('.catch(');
  });

  it('canonical e JSON-LD entram no HTML servido', () => {
    expect(SERVER).toContain('rel="canonical"');
    expect(SERVER).toContain('dadosEstruturados(loja, base)');
    expect(OG).toContain('extras: string[] = []');
  });

  /* A descrição vazia deixou de sair vazia — mas o texto do lojista continua
     mandando quando existe. */
  it('a descrição tem plano B, e ele não sobrescreve o lojista', () => {
    expect(OG).toContain('loja.descricao || `Peça online na ${loja.nome}');
  });
});

describe('a verificação do Search Console', () => {
  /*
   * O ARQUIVO DO GOOGLE É FRÁGIL POR NATUREZA: é um arquivo solto, sem nada no
   * código apontando para ele, e some numa limpeza de `public/` sem que nada
   * quebre. O efeito de perdê-lo não aparece na hora — a propriedade sai de
   * verificada semanas depois, e com ela o envio do sitemap e os relatórios de
   * indexação.
   *
   * Ele é servido pelo `express.static` em QUALQUER host da plataforma. Isso é
   * de propósito e é o que faz a verificação funcionar sem saber de antemão
   * qual domínio o lojista cadastrou no Search Console — mas vale saber: num
   * domínio próprio de cliente, este token continua sendo o da plataforma.
   */
  it('o arquivo de verificação continua no lugar', () => {
    const arquivo = path.join(__dirname, '..', '..', 'frontend', 'public',
      'googled7c37f86d0ad2e53.html');
    expect(fs.existsSync(arquivo)).toBe(true);
    expect(fs.readFileSync(arquivo, 'utf8').trim())
      .toBe('google-site-verification: googled7c37f86d0ad2e53.html');
  });

  /* O robots não pode bloquear a raiz, senão o Google não busca o arquivo. */
  it('o robots não atrapalha a verificação', () => {
    const t = robots('https://x.com.br', true);
    expect(t).not.toMatch(/^Disallow: \/$/m);
  });
});
