import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { canonical, sitemap, horarioSchema, dadosEstruturados, type LojaParaSeo } from './seo';
import { blocoDeConteudo, injetarConteudo, LIMITE_CONTEUDO_BYTES, type ItemParaSeo } from './seo-conteudo';

/*
 * ETAPA 2 DA INDEXAÇÃO — três defeitos medidos em produção.
 *
 *  1. CONTEÚDO DUPLICADO. `/` e `/galderiobebidas` são a MESMA página (a raiz
 *     do tenant mostra o cardápio direto), estavam as duas no sitemap e cada
 *     uma se declarava oficial:
 *       /                → canonical /
 *       /galderiobebidas → canonical /galderiobebidas
 *     O cabeçalho do `sitemap` já dizia, por escrito, "canonical apontando
 *     para a raiz". A regra estava escrita e quebrada na linha seguinte.
 *
 *  2. HORÁRIO INVÁLIDO NO DADO ESTRUTURADO. Ia o texto cru do lojista
 *     ("Segunda a Domingo 11h às 01:00") num campo que tem formato. Valor fora
 *     do formato não é ignorado: derruba a validação do bloco inteiro, e junto
 *     vão o endereço e a imagem.
 *
 *  3. CORPO VAZIO. Medido no HTML cru: `texto visível no <body>: 0 caracteres`.
 *     O `<head>` impecável, e o que a loja vende só existindo depois de baixar
 *     e executar 400 KB de JavaScript.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVER = semComentarios(ler('src', 'backend', 'server.ts'));

const LOJA: LojaParaSeo = {
  id: 1, nome: 'GALDERIO BEBIDAS', slug: 'galderiobebidas',
  descricao: 'Galderio bebidas o delivery que você precisa.',
  endereco: 'Rua Dilson Funaro, Joinville - SC',
  horario_funcionamento: 'Segunda a Domingo 11h às 01:00',
  logo_url: null, capa_url: null, dominio_personalizado: null,
  lat: -26.3175592, lon: -48.789412,
};
const BASE = 'https://galderio-bebidas.maxxpedidos.com.br';

describe('um endereço só para uma página só', () => {
  /*
   * A raiz vence porque é o endereço que o lojista divulga, o que está no QR
   * code e o que o cliente digita.
   */
  it('/slug aponta para a raiz', () => {
    expect(canonical(`${BASE}/galderiobebidas`, LOJA)).toBe(`${BASE}/`);
  });

  it('a raiz continua apontando para si', () => {
    expect(canonical(`${BASE}/`, LOJA)).toBe(`${BASE}/`);
  });

  /* Maiúsculas e o slug escapado na URL são o mesmo endereço — e quem digita
     errado não deveria criar uma terceira página aos olhos do buscador. */
  it('reconhece o slug com maiúscula e escapado', () => {
    expect(canonical(`${BASE}/GalderioBebidas`, LOJA)).toBe(`${BASE}/`);
    expect(canonical(`${BASE}/${encodeURIComponent('galderiobebidas')}`, LOJA)).toBe(`${BASE}/`);
  });

  /* Outra rota é outra página de verdade: /termos não vira a raiz. */
  it('não mexe nas outras rotas', () => {
    expect(canonical(`${BASE}/termos`, LOJA)).toBe(`${BASE}/termos`);
  });

  /* Sem loja não há slug para comparar — e a auto-referência de antes vale. */
  it('sem loja, segue como veio', () => {
    expect(canonical(`${BASE}/qualquer`, null)).toBe(`${BASE}/qualquer`);
  });

  /*
   * O DOMÍNIO PRÓPRIO CONTINUA GANHANDO, e agora recebe a raiz já resolvida:
   * apontar para `proprio.com.br/galderiobebidas` seria trocar um endereço
   * duplicado por outro, em outro host.
   */
  it('com domínio próprio, aponta para a raiz DELE', () => {
    const comDominio = { ...LOJA, dominio_personalizado: 'galderiobebidas.com.br' };
    expect(canonical(`${BASE}/galderiobebidas`, comDominio)).toBe('https://galderiobebidas.com.br/');
  });

  it('o /slug saiu do sitemap', () => {
    const xml = sitemap(BASE, LOJA);
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).not.toContain('/galderiobebidas<');
    /* O resto continua: tirar o duplicado não pode ter levado junto o que vale. */
    expect(xml).toContain(`<loc>${BASE}/termos</loc>`);
    expect(xml).toContain(`<loc>${BASE}/privacidade</loc>`);
  });
});

describe('o horário no formato que o schema.org entende', () => {
  it('traduz o padrão do Galderio', () => {
    expect(horarioSchema('Segunda a Domingo 11h às 01:00')).toBe('Mo-Su 11:00-01:00');
  });

  it('aguenta abreviação, acento, vírgula e "das"', () => {
    expect(horarioSchema('Seg a Sáb, das 9h às 18h')).toBe('Mo-Sa 09:00-18:00');
    expect(horarioSchema('Ter a Dom 18:00 às 23:30')).toBe('Tu-Su 18:00-23:30');
    expect(horarioSchema('Segunda a Sexta 8h30 às 18h')).toBe('Mo-Fr 08:30-18:00');
    expect(horarioSchema('Seg-Sex 08:00-18:00')).toBe('Mo-Fr 08:00-18:00');
  });

  /*
   * O QUE NÃO DÁ PARA TRADUZIR NÃO SAI. Chutar aqui faria o Google mostrar ao
   * lado do link um horário que a loja não pratica, e o cliente chegaria na
   * porta fechada — erro que não volta como reclamação, volta como cliente que
   * não volta.
   */
  it('devolve null no que não reconhece', () => {
    expect(horarioSchema('Todos os dias')).toBeNull();
    expect(horarioSchema('abrimos quando dá')).toBeNull();
    expect(horarioSchema('Seg a Dom 25h às 30h')).toBeNull();
    expect(horarioSchema('')).toBeNull();
    expect(horarioSchema(null)).toBeNull();
  });

  it('o cartão usa o traduzido, e não o texto cru', () => {
    const json = dadosEstruturados(LOJA, BASE);
    expect(json).toContain('"openingHours":"Mo-Su 11:00-01:00"');
    expect(json).not.toContain('Segunda a Domingo');
  });

  /* Horário intraduzível some sozinho, e o resto do cartão fica de pé — que é
     o oposto do que um valor inválido fazia. */
  it('horário intraduzível não derruba o resto do cartão', () => {
    const json = dadosEstruturados({ ...LOJA, horario_funcionamento: 'quando der' }, BASE);
    expect(json).not.toContain('openingHours');
    expect(json).toContain('"address"');
    expect(json).toContain('GALDERIO BEBIDAS');
  });
});

describe('a coordenada que já existia no banco', () => {
  it('vira geo no cartão', () => {
    const json = dadosEstruturados(LOJA, BASE);
    expect(json).toContain('"geo":{"@type":"GeoCoordinates","latitude":-26.3175592,"longitude":-48.789412}');
  });

  /* Loja sem endereço geocodificado não inventa coordenada — `geo` no meio do
     Atlântico é pior que `geo` nenhum. */
  it('sem coordenada, não sai', () => {
    expect(dadosEstruturados({ ...LOJA, lat: null, lon: null }, BASE)).not.toContain('geo');
    expect(dadosEstruturados({ ...LOJA, lat: undefined, lon: undefined }, BASE)).not.toContain('geo');
  });

  /*
   * `NaN` É O CASO QUE PASSA PELO `typeof`. A coluna vem do banco e atravessa
   * um `Number()` na geocodificação; endereço que não geocodificou já gravou
   * coisa estranha antes. `JSON.stringify` transforma `NaN` em `null`, e
   * `"latitude":null` não é campo ausente — é campo inválido, que derruba o
   * bloco inteiro, exatamente como o horário cru derrubava.
   */
  it('NaN não vira coordenada', () => {
    expect(dadosEstruturados({ ...LOJA, lat: NaN, lon: NaN }, BASE)).not.toContain('geo');
    expect(dadosEstruturados({ ...LOJA, lat: -26.3, lon: NaN }, BASE)).not.toContain('geo');
  });
});

const ITENS: ItemParaSeo[] = [
  { nome: 'Balde Jack\'s de sabores', categoria: 'Baldes', descricao: 'Com gelo', preco_centavos: 7000 },
  { nome: 'Balde White Horse', categoria: 'Baldes', descricao: null, preco_centavos: 5500 },
  { nome: 'Baly Melancia', categoria: 'Energéticos', descricao: null, preco_centavos: 900 },
];

describe('o corpo deixa de estar vazio', () => {
  it('o nome da loja vira o único h1 da página', () => {
    const b = blocoDeConteudo(LOJA, ITENS);
    expect(b).toContain('<h1');
    expect((b.match(/<h1/g) || []).length).toBe(1);
    expect(b).toContain('GALDERIO BEBIDAS');
  });

  /* Endereço e horário em TEXTO, além do JSON-LD: o dado estruturado alimenta
     o cartão, o texto é o que ranqueia a busca por bairro. */
  it('endereço e horário aparecem como texto', () => {
    const b = blocoDeConteudo(LOJA, ITENS);
    expect(b).toContain('Rua Dilson Funaro');
    expect(b).toContain('Segunda a Domingo 11h às 01:00');
  });

  it('os produtos entram com nome, preço e categoria', () => {
    const b = blocoDeConteudo(LOJA, ITENS);
    expect(b).toContain('Baldes');
    expect(b).toContain('Energéticos');
    expect(b).toContain('Baly Melancia');
    expect(b).toMatch(/R\$\s?70,00/);
  });

  /* O apóstrofo de "Jack's" e um "&" no nome quebrariam o HTML se saíssem
     crus — e nome de produto vem do lojista, que escreve o que quiser. */
  it('escapa o que o lojista digitou', () => {
    const b = blocoDeConteudo(LOJA, [
      { nome: '<script>alert(1)</script> & Cia', categoria: 'X', descricao: null, preco_centavos: 100 },
    ]);
    expect(b).not.toContain('<script>alert(1)</script>');
    expect(b).toContain('&lt;script&gt;');
    expect(b).toContain('&amp; Cia');
  });

  /* A ordem das categorias é a do cardápio, escolhida pelo lojista — não uma
     alfabética que ninguém pediu. */
  it('mantém a ordem em que as categorias chegaram', () => {
    const b = blocoDeConteudo(LOJA, ITENS);
    expect(b.indexOf('Baldes')).toBeLessThan(b.indexOf('Energéticos'));
  });

  /*
   * TETO DE BYTES, cortando por CATEGORIA INTEIRA. O HTML é `no-store`: baixa
   * inteiro em toda visita. Meia lista de energéticos seria pior que nenhuma —
   * parece cardápio incompleto para quem lê e para quem indexa.
   */
  it('respeita o teto e não corta categoria pela metade', () => {
    const muitos: ItemParaSeo[] = [];
    for (let c = 0; c < 60; c++) {
      for (let i = 0; i < 40; i++) {
        muitos.push({
          nome: `Produto ${c}-${i} com nome razoavelmente comprido`,
          categoria: `Categoria ${c}`,
          descricao: 'Uma descrição de tamanho comum para um item de bebida.',
          preco_centavos: 1000 + i,
        });
      }
    }
    const b = blocoDeConteudo(LOJA, muitos);
    expect(Buffer.byteLength(b, 'utf8')).toBeLessThanOrEqual(LIMITE_CONTEUDO_BYTES + 2048);
    /* Toda categoria que entrou entrou com os 40 itens. */
    for (let c = 0; c < 60; c++) {
      if (!b.includes(`Categoria ${c}<`)) continue;
      expect(b).toContain(`Produto ${c}-39 `);
    }
  });

  it('sem loja não escreve nada', () => {
    expect(blocoDeConteudo(null, ITENS)).toBe('');
  });
});

describe('o bloco vive dentro do #root', () => {
  /*
   * DENTRO, e não antes: quem limpa é o próprio React, sem uma linha de
   * JavaScript escrita para isso — `createRoot(...).render()` esvazia o
   * contêiner antes de desenhar.
   */
  it('entra dentro da div do app', () => {
    expect(injetarConteudo('<body><div id="root"></div></body>', '<h1>Oi</h1>'))
      .toBe('<body><div id="root"><h1>Oi</h1></div></body>');
  });

  it('HTML sem #root sai como veio', () => {
    expect(injetarConteudo('<body></body>', '<h1>Oi</h1>')).toBe('<body></body>');
  });

  it('bloco vazio não mexe no HTML', () => {
    const html = '<body><div id="root"></div></body>';
    expect(injetarConteudo(html, '')).toBe(html);
  });
});

describe('o servidor só escreve o cardápio onde a loja aparece', () => {
  /* Pôr o cardápio no /termos seria oferecer a mesma lista em endereços
     diferentes — o duplicado que este trabalho acabou de tirar do sitemap. */
  it('a raiz e o /slug, e mais nada', () => {
    expect(SERVER).toContain("const mostraLoja = caminho === '/'");
    expect(SERVER).toContain('=== loja.slug.toLowerCase())');
    expect(SERVER).toContain('mostraLoja ? injetarConteudo(html, await blocoSeoDoTenant(loja)) : html');
  });

  /*
   * O BLOCO É CACHEADO POR TENANT. Sem isso seria uma varredura do catálogo no
   * caminho mais quente do app, em toda navegação, para produzir um texto que
   * só muda quando o lojista mexe no cardápio.
   */
  it('cacheia por tenant e por loja', () => {
    expect(SERVER).toContain('const chave = `${bancoTenantAtual() || \'padrao\'}:${loja.id}`;');
    expect(SERVER).toContain('agora - guardado.em < VALIDADE_CONTEUDO_MS');
  });

  /* Só o que o cliente veria: indisponível, excluído ou componente de combo
     não está no cardápio, e oferecê-lo ao buscador seria anunciar o que a loja
     não vende. */
  it('lista só o que está à venda', () => {
    const i = SERVER.indexOf('FROM produtos');
    expect(i).toBeGreaterThan(0);
    const q = SERVER.slice(i - 200, i + 200);
    expect(q).toContain('excluido = 0');
    expect(q).toContain('disponivel = 1');
    expect(q).toContain('vendido_sozinho = 1');
  });

  /* Indexação é acessório: uma consulta que falhou não pode tirar do ar a
     página que o cliente está tentando abrir para comprar. */
  it('falha em silêncio', () => {
    const i = SERVER.indexOf('async function blocoSeoDoTenant');
    const corpo = SERVER.slice(i, SERVER.indexOf('let htmlBase', i));
    expect(corpo).toContain('catch {');
    expect(corpo).toContain("return '';");
  });
});
