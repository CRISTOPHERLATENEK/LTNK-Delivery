import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * DE ONDE VEM O FUNDO DOS MAPAS.
 *
 * EM 13/09/2026 O LOJISTA ABRIU AS ÁREAS DE ENTREGA e viu, no lugar do mapa:
 *
 *   Padrão (OpenStreetMap) → ladrilho preto e amarelo, "Access blocked: app is
 *                            not following the tile usage policy of
 *                            OpenStreetMap's volunteer-run servers"
 *   Claro  (CARTO)         → "API KEY REQUIRED · carto.com/basemaps/apikey"
 *
 * Não foi "a API caiu": as duas fontes gratuitas mudaram a regra debaixo do
 * app. A do OpenStreetMap é mantida por voluntários e barra consumo de produto;
 * a da CARTO passou a exigir chave.
 *
 * E O MESMO ENDEREÇO BLOQUEADO ESTAVA EM TRÊS TELAS — áreas de entrega,
 * rastreamento do pedido (que o CLIENTE abre) e rota do entregador. Ele só viu
 * numa; as outras duas estavam quebradas igual. Por isso a fonte agora mora num
 * arquivo só, e é isso que este teste protege.
 */

const RAIZ = path.join(__dirname, '../../frontend/src');
const ler = (p: string) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CAMADAS = semComentarios(ler('lib/mapa-camadas.ts'));
const MAPAS = ['components/mapa-areas.tsx', 'components/mapa-rota.tsx', 'components/mapa-rastreamento.tsx'];

describe('nenhum mapa usa fonte bloqueada', () => {
  /*
   * ESTES DOIS ENDEREÇOS SÃO PROIBIDOS AGORA, e a proibição vale para o projeto
   * inteiro: foi de lá que vieram o "Access blocked" e o "API KEY REQUIRED" na
   * tela do lojista.
   */
  it.each(MAPAS)('%s não aponta para OpenStreetMap nem CARTO', (arq) => {
    const fonte = semComentarios(ler(arq));
    expect(fonte).not.toContain('tile.openstreetmap.org');
    expect(fonte).not.toContain('cartocdn.com');
  });

  it('o módulo das camadas também não', () => {
    expect(CAMADAS).not.toContain('tile.openstreetmap.org');
    expect(CAMADAS).not.toContain('cartocdn.com');
  });

  /* A varredura do projeto inteiro: fonte bloqueada não pode voltar por uma
     tela nova que ninguém lembrou de conferir. */
  it('nenhum arquivo do frontend voltou a usar', () => {
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { varrer(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || e.name.endsWith('.test.ts')) continue;
        const t = semComentarios(fs.readFileSync(p, 'utf8'));
        if (t.includes('tile.openstreetmap.org') || t.includes('cartocdn.com')) {
          achados.push(path.relative(RAIZ, p).replace(/\\/g, '/'));
        }
      }
    };
    varrer(RAIZ);
    expect(achados).toEqual([]);
  });
});

describe('os três mapas bebem da mesma fonte', () => {
  it.each(MAPAS)('%s importa de lib/mapa-camadas', (arq) => {
    expect(ler(arq)).toContain("from '@/lib/mapa-camadas'");
  });

  /*
   * A ATRIBUIÇÃO É LICENÇA, NÃO ENFEITE. A Esri cede os mapas sem chave e sem
   * cadastro com essa condição; tirar a linha do canto economiza dez pixels e
   * quebra o acordo de uso.
   */
  it('toda camada credita a fonte', () => {
    /* A LINHA INTEIRA, e nao ate a primeira virgula: a atribuicao usa template
       com `${ESRI}` e virgulas dentro — cortar na virgula deixava so o comeco
       e o teste reprovava a versao correta. */
    /* So as linhas com VALOR: `atribuicao: (.+)` tambem casava com a
       declaracao do tipo (`atribuicao: string;`) e reprovava por causa dela. */
    const creditos = [...CAMADAS.matchAll(/atribuicao: ([`'"].+)/g)].map(m => m[1]);
    expect(creditos.length).toBeGreaterThanOrEqual(3);
    for (const c of creditos) expect(c).toMatch(/esri/i);
  });

  it('as camadas chegam ao zoom em que se desenha rua', () => {
    const zooms = (CAMADAS.match(/maxZoom: (\d+)/g) ?? []).map(z => Number(z.replace(/\D/g, '')));
    expect(zooms.length).toBeGreaterThanOrEqual(3);
    for (const z of zooms) expect(z).toBeGreaterThanOrEqual(18);
  });
});

describe('o fundo "Claro"', () => {
  /*
   * ELE NÃO É OUTRO PROVEDOR: é o mesmo mapa de ruas sem a cor, para o polígono
   * laranja saltar. O candidato natural (Light Gray da Esri) devolve 2.521
   * bytes em qualquer zoom acima de 16 — o cinza de "não tenho dado aqui",
   * inútil justamente onde se desenha área.
   */
  it('usa a mesma fonte do Padrão', () => {
    /* Pelas URLs na ordem em que aparecem (padrao, claro, satelite): tentar
       recortar o bloco de cada camada esbarrava no `}` do `${ESRI}` dentro do
       template, e o recorte saia vazio. */
    const urls = [...CAMADAS.matchAll(/url: '([^']+)'/g)].map(m => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(urls[1]).toBe(urls[0]);          /* Claro = Padrao, so sem cor */
    expect(urls[2]).not.toBe(urls[0]);      /* Satelite e outra imagem */
  });

  it('a cor sai por CSS, e a classe existe', () => {
    expect(CAMADAS).toContain("className: 'mapa-dessaturado'");
    const css = fs.readFileSync(path.join(RAIZ, 'index.css'), 'utf8');
    expect(css).toContain('.mapa-dessaturado');
    expect(css).toContain('grayscale');
  });

  /* Sem passar a classe ao Leaflet, o "Claro" viraria uma cópia idêntica do
     "Padrão" — dois botões para a mesma coisa. */
  it('o mapa das áreas repassa a classe para o Leaflet', () => {
    /* TODOS OS PONTOS QUE MONTAM A CAMADA, e nao "existe um": o arquivo cria a
       camada base em dois lugares (o mapa normal e o de tela cheia). Conferindo
       so um, o outro podia perder a classe e o "Claro" sairia colorido em
       metade dos caminhos — foi o que uma sabotagem mostrou. */
    const areas = semComentarios(ler('components/mapa-areas.tsx'));
    const chamadas = [...areas.matchAll(/tileLayer\(e\.url[^)]*\)/g)].map(m => m[0]);
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    for (const c of chamadas) expect(c).toContain('className: e.className');
  });
});
