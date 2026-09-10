import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { analisarFundo, CLARO_MIN, CANTO_MIN, GLOBAL_MIN } from './fundo-branco';
import {
  acharFotoDeFundoBranco, urlDoCosmos, CREDITO, CREDITO_COSMOS,
  candidatoCosmos, candidatoOpenFoodFacts, FONTES, type Fonte,
} from './foto-por-codigo';

/*
 * FUNDO BRANCO — a exigência que o lojista fez depois de ver a primeira versão
 * da busca por código de barras funcionando.
 *
 * A REDE É SIMULADA. Teste que fala com o Cosmos ou com a Open Food Facts de
 * verdade quebra quando uma delas sai do ar, e aí a suíte falha por algo que
 * não é nosso e alguém desativa o teste. A conversa real foi feita à mão, e o
 * que ela mediu está aqui embaixo, nos números e nos casos.
 *
 * O QUE A MEDIÇÃO DE 10/09/2026 ENSINOU, nos produtos da Galderio:
 *
 *                          Cosmos            Open Food Facts
 *   tem imagem .......     49 de 60          24 de 60
 *   fundo branco .....     46 de 49           0 de  5
 *   claro na borda ...     79% a 100%         0% a 3%
 *
 * E ensinou duas coisas que eu não teria imaginado:
 *   1. o CANTO decide melhor que a borda inteira — a lata da Itaipava enche o
 *      quadro e toca a borda de cima e de baixo, e o anel dela deu 79%;
 *   2. existe packshot com TARJA COLORIDA de lado (o "COCA-COLA 250ml" do
 *      código 78912908): canto vermelho, e 57% de claro na imagem toda. Por
 *      isso a regra tem duas medidas, e não uma.
 */

/** Uma imagem com fundo claro e um objeto escuro no meio: o packshot. */
async function packshot(largura = 400, altura = 400, fundo = 250): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 3, fundo);
  const x0 = Math.round(largura * 0.3), x1 = Math.round(largura * 0.7);
  const y0 = Math.round(altura * 0.15), y1 = Math.round(altura * 0.85);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * largura + x) * 3;
      px[i] = 30; px[i + 1] = 90; px[i + 2] = 160;
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 3 } }).jpeg().toBuffer();
}

/** Uma foto de prateleira: escura e ocupada de ponta a ponta. */
async function prateleira(largura = 400, altura = 400): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 3;
      const t = 60 + Math.sin(x / 12) * 30 + Math.cos(y / 9) * 25;
      px[i] = t; px[i + 1] = t * 0.8; px[i + 2] = t * 0.6;
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 3 } }).jpeg().toBuffer();
}

/** O packshot em PNG com fundo TRANSPARENTE — como o Cosmos entrega. */
async function transparente(largura = 400, altura = 400): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 4, 0);
  const x0 = Math.round(largura * 0.3), x1 = Math.round(largura * 0.7);
  for (let y = Math.round(altura * 0.2); y < altura * 0.8; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * largura + x) * 4;
      px[i] = 20; px[i + 1] = 20; px[i + 2] = 20; px[i + 3] = 255;
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 4 } }).png().toBuffer();
}

/** Packshot com tarja colorida de lado: canto sujo, imagem clara no total. */
async function comTarja(largura = 400, altura = 400): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 3, 252);
  const tarja = Math.round(largura * 0.28);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < tarja; x++) {
      const i = (y * largura + x) * 3;
      px[i] = 200; px[i + 1] = 20; px[i + 2] = 20;
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 3 } }).jpeg().toBuffer();
}

describe('a medida do fundo', () => {
  it('packshot em fundo branco passa', async () => {
    const f = await analisarFundo(await packshot());
    expect(f).not.toBeNull();
    expect(f!.branco).toBe(true);
    expect(f!.piorCanto).toBeGreaterThan(0.9);
  });

  /* O CASO QUE ORIGINOU TUDO: a foto de celular na gôndola. Medida na base
     real, ela dá de 0% a 3% de claro na borda. */
  it('foto de prateleira é recusada', async () => {
    const f = await analisarFundo(await prateleira());
    expect(f!.branco).toBe(false);
    expect(f!.global).toBeLessThan(0.1);
  });

  /*
   * TRANSPARENTE CONTA COMO BRANCO porque o arquivo gravado é achatado em
   * branco. Se contasse como escuro, TODA imagem do Cosmos seria recusada — e
   * são elas as que o lojista quer.
   */
  it('fundo transparente conta como branco', async () => {
    const f = await analisarFundo(await transparente());
    expect(f!.branco).toBe(true);
  });

  /* A segunda medida existe por causa deste caso, encontrado na base real. */
  it('packshot com tarja colorida passa pela medida global', async () => {
    const f = await analisarFundo(await comTarja());
    expect(f!.piorCanto).toBeLessThan(CANTO_MIN);      /* o canto reprova */
    expect(f!.global).toBeGreaterThan(GLOBAL_MIN);      /* e o total aprova */
    expect(f!.branco).toBe(true);
  });

  /*
   * FUNDO CINZA DE ESTÚDIO É RECUSADO, e é de propósito: a exigência foi fundo
   * BRANCO. Cinza médio numa vitrine de cartões brancos aparece como uma
   * moldura cinza em volta do produto.
   */
  it('fundo cinza médio é recusado', async () => {
    const f = await analisarFundo(await packshot(400, 400, 150));
    expect(f!.branco).toBe(false);
  });

  /* O branco de JPEG é sujo: a compressão devolve 238, 242, 247 onde o arquivo
     original tinha 255. Daí o limite ser 235 e não 250. */
  it('o limite de claro tolera a sujeira do JPEG', () => {
    expect(CLARO_MIN).toBeLessThanOrEqual(240);
    expect(CLARO_MIN).toBeGreaterThan(200);
  });

  it('imagem que não decodifica devolve nulo, não exceção', async () => {
    expect(await analisarFundo(Buffer.from('isto nao e imagem'))).toBeNull();
  });
});

/* ────────────────────── a busca nas duas fontes ────────────────────── */

const IMG_OFF = 'https://images.openfoodfacts.org/images/products/789/199/101/5493/front_pt.3.400.jpg';
const CODIGO = '7891991015493';
const semEsperar = async () => {};

function resposta(corpo: unknown, opcoes: { status?: number; tipo?: string } = {}) {
  const status = opcoes.status ?? 200;
  const bytes = Buffer.isBuffer(corpo) ? corpo : Buffer.from(JSON.stringify(corpo));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (opcoes.tipo ?? 'application/json') : null) },
    json: async () => JSON.parse(bytes.toString()),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

/**
 * Uma rede de mentira que sabe responder pelas duas fontes.
 * `cosmos` e `off` dizem o que cada uma devolve; `chamadas` registra tudo.
 */
function rede(opcoes: {
  cosmos?: Buffer | number;              /* imagem, ou status de erro */
  cadastro?: unknown | number | 'explode';
  off?: Buffer | number;
  offJson?: unknown;
}) {
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    chamadas.push(u);
    if (u.startsWith('https://cdn-cosmos.bluesoft.com.br/')) {
      if (typeof opcoes.cosmos === 'number') return resposta({}, { status: opcoes.cosmos });
      if (!opcoes.cosmos) return resposta({}, { status: 404 });
      return resposta(opcoes.cosmos, { tipo: 'image/png' });
    }
    if (u.startsWith('https://api.cosmos.bluesoft.com.br/')) {
      chamadas.push('token:' + String((init?.headers as Record<string, string>)?.['X-Cosmos-Token'] ?? ''));
      /* 'explode' simula a rede caindo no meio da chamada, que e diferente de
         resposta de erro: ela LANCA, e o caminho do codigo e outro. */
      if (opcoes.cadastro === 'explode') throw new Error('sem rede');
      if (typeof opcoes.cadastro === 'number') return resposta({}, { status: opcoes.cadastro });
      return resposta(opcoes.cadastro ?? {});
    }
    if (u.startsWith('https://world.openfoodfacts.org/')) {
      if (opcoes.offJson === undefined) return resposta({}, { status: 404 });
      return resposta(opcoes.offJson);
    }
    if (u.startsWith('https://images.openfoodfacts.org/')) {
      if (typeof opcoes.off === 'number') return resposta({}, { status: opcoes.off });
      if (!opcoes.off) return resposta({}, { status: 404 });
      return resposta(opcoes.off, { tipo: 'image/jpeg' });
    }
    throw new Error('host nao esperado no teste: ' + u);
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const jsonOff = (extra: Record<string, unknown> = {}) => ({
  status: 1,
  product: { product_name: 'Cerveja Teste', brands: 'MarcaBoa', image_front_url: IMG_OFF, ...extra },
});

describe('a busca prefere o Cosmos', () => {
  it('a ordem das fontes é Cosmos e depois Open Food Facts', () => {
    expect(FONTES[0]).toBe(candidatoCosmos);
    expect(FONTES[1]).toBe(candidatoOpenFoodFacts);
  });

  it('achando no Cosmos, não chega a consultar a outra base', async () => {
    const { buscar, chamadas } = rede({ cosmos: await transparente() });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.achado.fonte).toBe('cosmos');
    expect(r.achado.credito).toBe(CREDITO_COSMOS);
    expect(chamadas.some(c => c.includes('openfoodfacts'))).toBe(false);
  });

  /* A prévia é o arquivo convertido, embutido: nada vai ao disco antes de
     alguém aceitar, e o que a pessoa confere é o que vai ser gravado. */
  it('a prévia volta embutida e em WebP', async () => {
    const { buscar } = rede({ cosmos: await transparente() });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    if (!r.ok) throw new Error('devia ter achado');
    expect(r.achado.previa.startsWith('data:image/webp;base64,')).toBe(true);
    expect(r.achado.previa.length).toBeGreaterThan(100);
    expect(r.achado.imagem.mime).toBe('image/webp');
  });

  /*
   * O ARQUIVO GRAVADO NÃO TEM TRANSPARÊNCIA — é isto que "fundo branco"
   * significa no disco. As imagens do Cosmos são PNG com alfa; sem achatar,
   * "fundo branco" viraria "fundo nenhum" e o produto flutuaria sobre o cartão
   * (e sobre o cartão escuro do modo noturno, o contorno preto do rótulo
   * desapareceria).
   */
  it('a foto gravada sai sem transparência, com branco de verdade', async () => {
    const { buscar } = rede({ cosmos: await transparente() });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    if (!r.ok) throw new Error('devia ter achado');
    const meta = await sharp(r.achado.imagem.buffer).metadata();
    expect(meta.hasAlpha).toBe(false);
    /* E o canto é branco no arquivo final, não só na conta. */
    const canto = await sharp(r.achado.imagem.buffer)
      .extract({ left: 0, top: 0, width: 8, height: 8 }).raw().toBuffer();
    expect(Math.min(...canto)).toBeGreaterThanOrEqual(250);
  });

  it('o endereço da imagem do Cosmos é montado pelo código', () => {
    expect(urlDoCosmos('7891991015493')).toBe('https://cdn-cosmos.bluesoft.com.br/products/7891991015493');
  });

  /* Sem imagem no Cosmos, a Open Food Facts é a segunda chance — e ela pega
     itens que o Cosmos não tem. */
  it('sem imagem no Cosmos, tenta a Open Food Facts', async () => {
    const { buscar } = rede({ cosmos: 404, offJson: jsonOff(), off: await packshot() });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.achado.fonte).toBe('openfoodfacts');
    expect(r.achado.credito).toBe(CREDITO);
    expect(r.achado.nomeNaBase).toBe('Cerveja Teste');
  });
});

describe('a recusa diz o que aconteceu', () => {
  /*
   * ESTE É O CASO REAL DA OPEN FOOD FACTS: a foto existe e é de prateleira. O
   * motivo tem que ser o do fundo, e não "não está na base" — senão a pessoa
   * vai conferir um código de barras que está certo.
   */
  it('foto de prateleira nas duas fontes recusa por fundo', async () => {
    const foto = await prateleira();
    const { buscar } = rede({ cosmos: foto, offJson: jsonOff(), off: foto });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('fundo-nao-branco');
  });

  /*
   * E O MOTIVO É O MELHOR DOS TENTADOS, não o último: Cosmos com foto de
   * prateleira e Open Food Facts sem o produto tem que dizer "o fundo não é
   * branco", que é a informação que serve para alguma coisa.
   */
  it('o motivo mais informativo vence o mais raso', async () => {
    const { buscar } = rede({ cosmos: await prateleira() });   /* OFF: 404 */
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    if (r.ok) throw new Error('nao devia achar');
    expect(r.motivo).toBe('fundo-nao-branco');
    expect(r.fonteTentada).toBe('cosmos');
  });

  it('sem nada em nenhuma das duas, é ausência', async () => {
    const { buscar } = rede({ cosmos: 404 });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    if (r.ok) throw new Error('nao devia achar');
    expect(r.motivo).toBe('nao-esta-na-base');
  });

  /* O 1x1 do registro de teste "Salatgurke" cai aqui. */
  it('imagem minúscula é imprestável, não ausência', async () => {
    const um = await sharp(Buffer.alloc(3, 255), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const { buscar } = rede({ cosmos: um });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    if (r.ok) throw new Error('nao devia achar');
    expect(r.motivo).toBe('imagem-imprestavel');
  });

  it('código curto não vira consulta nenhuma', async () => {
    const { buscar, chamadas } = rede({ cosmos: await transparente() });
    for (const cod of ['', '123', 'abc']) {
      const r = await acharFotoDeFundoBranco(cod, { buscar, esperar: semEsperar });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe('codigo-curto');
    }
    expect(chamadas).toEqual([]);
  });

  /* Fonte que explode não pode derrubar a tela do lojista nem cancelar a outra
     fonte: quem chama está no meio de um cadastro de produto. */
  it('fonte que lança não derruba a busca', async () => {
    const explode: Fonte = async () => { throw new Error('fonte quebrada'); };
    const { buscar } = rede({ cosmos: 404, offJson: jsonOff(), off: await packshot() });
    const r = await acharFotoDeFundoBranco(CODIGO, {
      buscar, esperar: semEsperar, tokenCosmos: '',
      fontes: [explode, candidatoOpenFoodFacts],
    });
    expect(r.ok).toBe(true);
  });
});

describe('o token do Cosmos', () => {
  /* Sem token, nenhuma chamada ao cadastro pago — e a foto vem igual. */
  it('sem token, o cadastro não é consultado', async () => {
    const { buscar, chamadas } = rede({ cosmos: await transparente() });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: '' });
    expect(r.ok).toBe(true);
    expect(chamadas.some(c => c.startsWith('https://api.cosmos'))).toBe(false);
  });

  it('com token, o cadastro traz nome e marca', async () => {
    const { buscar, chamadas } = rede({
      cosmos: await transparente(),
      cadastro: { description: 'CERVEJA ORIGINAL LATA 350ML', brand: { name: 'Antarctica' } },
    });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: 'segredo' });
    if (!r.ok) throw new Error('devia ter achado');
    expect(r.achado.nomeNaBase).toBe('CERVEJA ORIGINAL LATA 350ML');
    expect(r.achado.marca).toBe('Antarctica');
    /* E ele viaja no cabeçalho que o Cosmos exige. */
    expect(chamadas).toContain('token:segredo');
  });

  /*
   * CADASTRO FORA DO AR NÃO CANCELA A FOTO. Token vencido ou cota estourada
   * deixam a integração sem o nome — e ficar sem o nome é pior que ficar sem a
   * foto, mas não é motivo para não ter nenhum dos dois.
   */
  it('cadastro barrado ainda entrega a foto', async () => {
    const { buscar } = rede({ cosmos: await transparente(), cadastro: 429 });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: 'segredo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.achado.nomeNaBase).toBe('');
  });

  /*
   * E CADASTRO QUE LANCA TAMBEM. Resposta 429 nao exercita o mesmo caminho que
   * a rede caindo: uma passa pelo `if (r.ok)`, a outra pelo `catch`. Sabotando
   * o `catch` a suite continuou verde com so o primeiro caso — foi assim que
   * este teste apareceu.
   */
  it('cadastro que derruba a conexão ainda entrega a foto', async () => {
    const { buscar } = rede({ cosmos: await transparente(), cadastro: 'explode' });
    const r = await acharFotoDeFundoBranco(CODIGO, { buscar, esperar: semEsperar, tokenCosmos: 'segredo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.achado.fonte).toBe('cosmos');
    expect(r.achado.nomeNaBase).toBe('');
  });
});
