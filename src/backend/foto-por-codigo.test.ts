import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  buscarFotoPorCodigo, baixarEConverter, origemPermitida, versaoGrande,
  CREDITO, LIMITE_ENTRE_CHAMADAS,
} from './foto-por-codigo';

/*
 * FOTO DE PRODUTO PELO CÓDIGO DE BARRAS — Open Food Facts.
 *
 * A REDE É SIMULADA AQUI, de propósito. Teste que fala com a Open Food Facts de
 * verdade quebra quando ela sai do ar ou barra por limite — e aí a suíte falha
 * por algo que não é nosso, e alguém desativa o teste. A conversa com a base
 * real foi feita à mão, uma vez, e o que ela ensinou está nos casos abaixo.
 *
 * O QUE A BASE REAL ENSINOU, e que eu não teria imaginado:
 *   1. o código inexistente `9999999999999` devolve um REGISTRO DE TESTE
 *      ("Salatgurke", marca "MarcaTest") com imagem de 1x1 PIXEL;
 *   2. a API devolve o endereço em 400 px, e a versão `full` do mesmo caminho
 *      traz o original (21 KB contra 1.180 KB);
 *   3. `429` aparece rápido: a primeira medição de cobertura deu 14% porque eu
 *      contava resposta barrada como "produto não existe". A real é 40%.
 */

/** Uma imagem de verdade, do tamanho pedido, para o `sharp` decodificar. */
async function imagemDe(largura: number, altura: number): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 3;
      const g = 150 + Math.sin(x / 40) * Math.cos(y / 50) * 60;
      px[i] = g + 20; px[i + 1] = g; px[i + 2] = g - 25;
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 3 } }).jpeg().toBuffer();
}

/** Uma resposta de rede de mentira. */
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

const IMG = 'https://images.openfoodfacts.org/images/products/789/199/101/5493/front_pt.3.400.jpg';

/** Espera que nao espera: a retentativa e exercitada sem parar a suite. */
const semEsperar = async () => {};

const achou = (extra: Record<string, unknown> = {}) => resposta({
  status: 1,
  product: { product_name: 'Cerveja Teste', brands: 'MarcaBoa', image_front_url: IMG, ...extra },
});

describe('a origem do download é uma lista fechada', () => {
  /*
   * ESTA É A PEÇA DE SEGURANÇA DO ARQUIVO. A URL vem de dentro de um registro
   * que QUALQUER PESSOA edita — a base é colaborativa. Sem a lista, um registro
   * alterado aponta o download para um endereço interno e o servidor busca
   * obedientemente, de dentro do firewall. É SSRF.
   */
  it('aceita só o host de imagens da Open Food Facts, e só https', () => {
    expect(origemPermitida(IMG)).toBe(true);
    expect(origemPermitida('http://images.openfoodfacts.org/x.jpg')).toBe(false);
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'metadados da nuvem'],
    ['http://127.0.0.1:3306/', 'banco na própria máquina'],
    ['https://images.openfoodfacts.org.evil.com/x.jpg', 'domínio que começa igual'],
    ['https://evil.com/images.openfoodfacts.org/x.jpg', 'host no caminho'],
    ['file:///etc/passwd', 'arquivo local'],
    ['https://world.openfoodfacts.org/x.jpg', 'outro host da mesma organização'],
    ['nao e url', 'lixo'],
  ])('recusa %s (%s)', (url) => {
    expect(origemPermitida(url)).toBe(false);
  });

  it('a validação também acontece no download, não só na busca', async () => {
    /* A função é exportada: quem a chamar amanhã com URL de outro lugar não
       pode furar a lista por eu ter confiado no chamador. */
    const r = await baixarEConverter('https://evil.com/x.jpg', async () => {
      throw new Error('nao deveria nem tentar buscar');
    });
    expect(r).toBeNull();
  });
});

describe('a busca pelo código', () => {
  it('devolve a foto, o nome na base e o crédito', async () => {
    const f = await buscarFotoPorCodigo('7891991015493', async () => achou());
    expect(f).not.toBeNull();
    expect(f!.nomeNaBase).toBe('Cerveja Teste');
    expect(f!.marca).toBe('MarcaBoa');
    /* O crédito acompanha a foto porque a licença CC-BY-SA exige atribuição. */
    expect(f!.credito).toBe(CREDITO);
    expect(f!.credito).toContain('CC-BY-SA');
  });

  /*
   * PEDE A VERSÃO GRANDE. A API entrega 400 px, que é pouco para tela retina —
   * o cartão desenha em ~300 px e dobra. Medido: 21 KB em 400 px contra
   * 1.180 KB em `full`, e a conversão derruba o `full` para 64 KB.
   */
  it('troca o endereço pela versão full', async () => {
    const f = await buscarFotoPorCodigo('7891991015493', async () => achou());
    expect(f!.url).toContain('.full.jpg');
    expect(f!.url).not.toContain('.400.jpg');
    /* E a prévia continua pequena: é ela que a tela mostra antes de gravar. */
    expect(versaoGrande(IMG)).toBe(IMG.replace('.400.jpg', '.full.jpg'));
  });

  /*
   * `429` NÃO É "NÃO EXISTE" — foi o erro que fez a primeira medição de
   * cobertura dizer 14% quando a real é 40%. Metade dos produtos que a base tem
   * seria relatada como "não achei".
   */
  it('tenta de novo quando é barrado, em vez de desistir', async () => {
    let chamadas = 0;
    const f = await buscarFotoPorCodigo('7891991015493', async () => {
      chamadas++;
      return chamadas < 3 ? resposta({}, { status: 429 }) : achou();
    }, semEsperar);
    expect(chamadas).toBe(3);
    expect(f).not.toBeNull();
  });

  it('e também quando a base está instável (5xx)', async () => {
    let chamadas = 0;
    const f = await buscarFotoPorCodigo('7891991015493', async () => {
      chamadas++;
      return chamadas < 2 ? resposta({}, { status: 503 }) : achou();
    }, semEsperar);
    expect(chamadas).toBe(2);
    expect(f).not.toBeNull();
  });

  /* Mas 404 é resposta: o produto não está lá, e insistir é gastar a cota. */
  it('não insiste em 404', async () => {
    let chamadas = 0;
    const f = await buscarFotoPorCodigo('7891991015493', async () => {
      chamadas++;
      return resposta({}, { status: 404 });
    });
    expect(chamadas).toBe(1);
    expect(f).toBeNull();
  });

  it('produto sem foto na base devolve nulo', async () => {
    const f = await buscarFotoPorCodigo('7891991015493', async () =>
      resposta({ status: 1, product: { product_name: 'Sem foto' } }));
    expect(f).toBeNull();
  });

  /*
   * NUNCA LANÇA POR CAUSA DA REDE. Quem chama está no meio de um cadastro de
   * produto, e base de terceiro fora do ar não pode derrubar a tela do lojista.
   */
  it('rede caída devolve nulo, não exceção', async () => {
    const f = await buscarFotoPorCodigo('7891991015493', async () => {
      throw new Error('sem rede');
    }, semEsperar);
    expect(f).toBeNull();
  });

  it('código curto ou vazio não vira consulta', async () => {
    for (const cod of ['', '123', 'abc']) {
      const f = await buscarFotoPorCodigo(cod, async () => {
        throw new Error('nao deveria consultar');
      });
      expect(f).toBeNull();
    }
  });

  /* A base pede educação, e medido ela barra abaixo disto. */
  it('o intervalo entre chamadas é generoso', () => {
    expect(LIMITE_ENTRE_CHAMADAS).toBeGreaterThanOrEqual(1000);
  });
});

describe('o download recusa o que não serve', () => {
  /*
   * O 1x1 DO REGISTRO DE TESTE. Consultando o código inexistente
   * `9999999999999`, a base devolve "Salatgurke" da marca "MarcaTest" com uma
   * imagem de UM PIXEL. Sem piso, isso entrava como foto do produto: ponto
   * branco na vitrine e "tem foto" na planilha.
   */
  it('imagem de 1x1 é recusada', async () => {
    const r = await baixarEConverter(IMG, async () =>
      resposta(await imagemDe(1, 1), { tipo: 'image/jpeg' }));
    expect(r).toBeNull();
  });

  it('imagem minúscula é recusada', async () => {
    const r = await baixarEConverter(IMG, async () =>
      resposta(await imagemDe(80, 80), { tipo: 'image/jpeg' }));
    expect(r).toBeNull();
  });

  /*
   * MAS A TIRA FINA LEGÍTIMA PASSA. A foto real mais estreita que eu medi é a
   * Baly Melancia 2L, 183x579 — garrafa alta em quadro justo. Um piso só de
   * largura a recusaria.
   */
  it('foto estreita e alta passa (é garrafa)', async () => {
    const r = await baixarEConverter(IMG, async () =>
      resposta(await imagemDe(183, 579), { tipo: 'image/jpeg' }));
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('image/webp');
  });

  /*
   * `image/...` É O QUE O SERVIDOR DIZ. A conversão é que prova — o `sharp`
   * decodifica de verdade e lança. Confiar no cabeçalho seria gravar no disco
   * público o que o outro lado quiser chamar de imagem.
   */
  it('conteúdo que não é imagem não passa', async () => {
    await expect(baixarEConverter(IMG, async () =>
      resposta(Buffer.from('<?php system($_GET[0]); ?>'), { tipo: 'image/jpeg' }))).rejects.toThrow();
  });

  it('tipo declarado que não é imagem é recusado sem baixar', async () => {
    const r = await baixarEConverter(IMG, async () =>
      resposta(Buffer.from('qualquer coisa'), { tipo: 'text/html' }));
    expect(r).toBeNull();
  });

  it('resposta de erro é recusada', async () => {
    const r = await baixarEConverter(IMG, async () => resposta({}, { status: 404 }));
    expect(r).toBeNull();
  });

  /* Redirecionamento sairia da lista de hosts — a proteção seria contornada
     por um `302` dentro do próprio host permitido. */
  it('não segue redirecionamento', async () => {
    let opcoes: RequestInit | undefined;
    await baixarEConverter(IMG, async (_u, o) => {
      opcoes = o as RequestInit;
      return resposta(await imagemDe(400, 400), { tipo: 'image/jpeg' });
    });
    expect(opcoes?.redirect).toBe('error');
  });

  /* E o que passa sai convertido, não como veio. */
  it('o que passa sai em WebP', async () => {
    const r = await baixarEConverter(IMG, async () =>
      resposta(await imagemDe(1400, 1400), { tipo: 'image/jpeg' }));
    expect(r!.mime).toBe('image/webp');
    expect(r!.extensao).toBe('.webp');
    /* E redimensionado pelo lado maior. */
    expect(Math.max(r!.largura, r!.altura)).toBeLessThanOrEqual(1200);
  });
});
