import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { ajustarSePreciso, ajustarPasta, TETO } from './ajustar-fotos';
import { LARGURA_MAX } from './imagem-web';

/*
 * AJUSTE DAS FOTOS ANTIGAS.
 *
 * ESTE TESTE MEXE EM ARQUIVO DE VERDADE, numa pasta temporária: a ferramenta
 * reescreve e renomeia arquivo, e testar isso com `fs` de mentira provaria só
 * que eu chamei as funções que eu mesmo escolhi chamar. O que precisa ser
 * provado é que o arquivo continua com o mesmo nome, que o original fica numa
 * cópia e que a medição não escreve nada.
 *
 * O QUE ESTÁ EM JOGO: são as fotos das lojas de verdade. Medido em 10/09/2026,
 * 47 dos 144 arquivos estavam acima do teto e custavam 21 dos 30 MB da pasta —
 * um deles com 6003x2001.
 */

/** Uma foto sintética com detalhe suficiente para não comprimir a zero. */
async function foto(largura: number, altura: number, formato: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const px = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 3;
      const base = 120 + Math.sin(x / 30) * 50 + Math.cos(y / 40) * 40;
      const grao = ((x * 7 + y * 13) % 17) - 8;
      px[i] = base + grao; px[i + 1] = base * 0.85 + grao; px[i + 2] = base * 0.7 + grao;
    }
  }
  const s = sharp(px, { raw: { width: largura, height: altura, channels: 3 } });
  if (formato === 'jpeg') return s.jpeg({ quality: 95 }).toBuffer();
  if (formato === 'png') return s.png().toBuffer();
  return s.webp({ quality: 95 }).toBuffer();
}

describe('a decisão de ajustar', () => {
  it('o teto é o mesmo do upload, não um segundo número', () => {
    /* Duas constantes iguais por coincidência divergem na primeira vez que
       alguém muda uma. O upload e o ajuste têm que reduzir para o mesmo lugar. */
    expect(TETO).toBe(LARGURA_MAX);
  });

  it('foto grande é reduzida pelo lado maior, mantendo a proporção', async () => {
    const original = await foto(1600, 1200, 'jpeg');
    const r = await ajustarSePreciso(original);
    expect(r).not.toBeNull();
    expect(r!.largura).toBe(TETO);
    expect(r!.altura).toBe(TETO * 0.75);
    expect(r!.buffer.length).toBeLessThan(original.length);
  });

  it('foto em pé também', async () => {
    const r = await ajustarSePreciso(await foto(600, 1600, 'jpeg'));
    expect(r!.altura).toBe(TETO);
    expect(r!.largura).toBe(Math.round(TETO * 600 / 1600));
  });

  /* NÃO AMPLIA E NÃO TOCA: foto dentro do teto sai de cena sem ser reescrita —
     reescrever de graça só perderia qualidade a cada passada da ferramenta. */
  it('foto dentro do teto não é tocada', async () => {
    expect(await ajustarSePreciso(await foto(500, 500, 'jpeg'))).toBeNull();
    expect(await ajustarSePreciso(await foto(TETO, TETO, 'webp'))).toBeNull();
  });

  /*
   * O FORMATO NÃO MUDA, e esta é a regra que protege a vitrine: o nome do
   * arquivo está gravado em `produtos.foto_url`, em `lojas.logo_url` e `capa_url`,
   * na foto do sabor, na tabela de banners e em chaves de `configuracoes` — de
   * cada loja. Trocar `.jpg` por `.webp` sem acertar todas essas pontas deixa
   * foto quebrada no cardápio.
   */
  it.each([['jpeg'], ['png'], ['webp']] as const)('%s continua %s', async (formato) => {
    const r = await ajustarSePreciso(await foto(1400, 1400, formato));
    expect(r).not.toBeNull();
    expect(r!.formato).toBe(formato);
    const conferido = await sharp(r!.buffer).metadata();
    expect(conferido.format).toBe(formato);
  });

  it('arquivo que não é imagem devolve nulo, não exceção', async () => {
    expect(await ajustarSePreciso(Buffer.from('isto nao e imagem'))).toBeNull();
    expect(await ajustarSePreciso(Buffer.alloc(0))).toBeNull();
  });
});

describe('a varredura da pasta', () => {
  let dir = '';
  let uploads = '';

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fotos-'));
    uploads = path.join(dir, 'uploads');
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, 'grande.jpg'), await foto(2000, 1500, 'jpeg'));
    fs.writeFileSync(path.join(uploads, 'pequena.jpg'), await foto(400, 400, 'jpeg'));
    fs.writeFileSync(path.join(uploads, 'lixo.txt'), 'nao sou imagem');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /*
   * MEDIR NÃO ESCREVE. A ferramenta roda em cima de foto de cliente, então o
   * padrão é não fazer nada: quem quer escrever passa `--fazer`. Descobrir
   * intenção pelo silêncio, aqui, é apagar trabalho de alguém.
   */
  it('sem --fazer, nenhum byte muda', async () => {
    const antes = fs.readFileSync(path.join(uploads, 'grande.jpg'));
    const r = await ajustarPasta(uploads);
    expect(r.ajustados).toBe(1);
    expect(r.bytesDepois).toBeLessThan(r.bytesAntes);
    /* o relatório diz o que faria, e o arquivo continua idêntico */
    expect(fs.readFileSync(path.join(uploads, 'grande.jpg')).equals(antes)).toBe(true);
    expect(fs.existsSync(r.pastaCopia)).toBe(false);
  });

  it('com --fazer, encolhe e mantém o mesmo nome', async () => {
    const antes = fs.statSync(path.join(uploads, 'grande.jpg')).size;
    const r = await ajustarPasta(uploads, { fazer: true });
    expect(r.ajustados).toBe(1);

    /* O NOME É O CONTRATO: é ele que está gravado no banco. */
    expect(fs.existsSync(path.join(uploads, 'grande.jpg'))).toBe(true);
    const depois = fs.statSync(path.join(uploads, 'grande.jpg')).size;
    expect(depois).toBeLessThan(antes);

    const meta = await sharp(path.join(uploads, 'grande.jpg')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(TETO);
    expect(meta.format).toBe('jpeg');
  });

  /* O ORIGINAL FICA GUARDADO. Reverter tem que ser copiar de volta, e não
     "baixar de novo de algum lugar" — metade dessas fotos o lojista tirou na
     loja e não existe em outro lugar nenhum. */
  it('o original mexido é copiado antes', async () => {
    const antes = fs.readFileSync(path.join(uploads, 'grande.jpg'));
    const r = await ajustarPasta(uploads, { fazer: true });
    const copia = path.join(r.pastaCopia, 'grande.jpg');
    expect(fs.existsSync(copia)).toBe(true);
    expect(fs.readFileSync(copia).equals(antes)).toBe(true);
    /* E só o que foi mexido: a pequena não vira cópia à toa. */
    expect(fs.existsSync(path.join(r.pastaCopia, 'pequena.jpg'))).toBe(false);
  });

  /*
   * ARQUIVO QUE CRESCERIA FICA COMO ESTA, e isso acontece de verdade: PNG de
   * poucas cores e gravado em PALETA, e reescrever em RGB engorda mesmo com
   * menos pixels. Medido com o gerador abaixo: 2.588 bytes em 1000x1000 viram
   * 6.453 em 800x800 — trocar por uma versao maior E de menor resolucao seria
   * perda dupla.
   */
  it('não troca por uma versão maior', async () => {
    const L = 1000;
    const px = Buffer.alloc(L * L * 3);
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const i = (y * L + x) * 3;
        const faixa = Math.floor(x / 250) % 2 ? 255 : 0;
        px[i] = faixa; px[i + 1] = faixa; px[i + 2] = faixa;
      }
    }
    const paleta = await sharp(px, { raw: { width: L, height: L, channels: 3 } })
      .png({ palette: true, colours: 4 }).toBuffer();
    fs.writeFileSync(path.join(uploads, 'paleta.png'), paleta);

    const r = await ajustarPasta(uploads, { fazer: true });
    /* a grande.jpg ainda e ajustada; a de paleta, nao */
    expect(r.ajustados).toBe(1);
    expect(fs.readFileSync(path.join(uploads, 'paleta.png')).equals(paleta)).toBe(true);
  });

  it('não deixa arquivo temporário para trás', async () => {
    await ajustarPasta(uploads, { fazer: true });
    expect(fs.readdirSync(uploads).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  /* Arquivo estranho no meio da pasta não pode interromper a varredura e
     deixar metade ajustada e metade não. */
  it('o que não é imagem é ignorado, e a varredura continua', async () => {
    const r = await ajustarPasta(uploads, { fazer: true });
    expect(fs.readFileSync(path.join(uploads, 'lixo.txt'), 'utf8')).toBe('nao sou imagem');
    expect(r.arquivos).toBe(3);
    expect(r.intocados).toBe(2);
  });

  /* RODAR DUAS VEZES NÃO PIORA NADA: na segunda passada tudo já está no teto,
     então nada é reescrito — reescrever JPEG repetidamente degrada a imagem. */
  it('rodar de novo não mexe em mais nada', async () => {
    await ajustarPasta(uploads, { fazer: true });
    const bytes = fs.readFileSync(path.join(uploads, 'grande.jpg'));
    const segunda = await ajustarPasta(uploads, { fazer: true });
    expect(segunda.ajustados).toBe(0);
    expect(fs.readFileSync(path.join(uploads, 'grande.jpg')).equals(bytes)).toBe(true);
  });
});
