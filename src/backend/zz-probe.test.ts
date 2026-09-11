import { describe, it } from 'vitest';
import fsx from 'fs';
const SAIDA = 'C:/Users/User/AppData/Local/Temp/claude/probe.txt';
const LOG = (...a: unknown[]) => fsx.appendFileSync(SAIDA, a.map(String).join(' ') + String.fromCharCode(10));
import sharp from 'sharp';
import { analisarFundo } from './fundo-branco';
import { paraWeb, miniatura } from './imagem-web';

/** Cria uma imagem RGB crua com um retangulo de cor no meio. */
async function cena(op: {
  L: number; A: number; fundo: [number, number, number];
  prod?: { x: number; y: number; w: number; h: number; cor: [number, number, number] };
  formato?: 'png' | 'jpeg' | 'webp';
}): Promise<Buffer> {
  const { L, A, fundo } = op;
  const px = Buffer.alloc(L * A * 3);
  for (let i = 0; i < L * A; i++) {
    px[i * 3] = fundo[0]; px[i * 3 + 1] = fundo[1]; px[i * 3 + 2] = fundo[2];
  }
  if (op.prod) {
    const { x, y, w, h, cor } = op.prod;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * L + xx) * 3;
        px[i] = cor[0]; px[i + 1] = cor[1]; px[i + 2] = cor[2];
      }
    }
  }
  const s = sharp(px, { raw: { width: L, height: A, channels: 3 } });
  return op.formato === 'jpeg' ? s.jpeg().toBuffer()
    : op.formato === 'webp' ? s.webp().toBuffer() : s.png().toBuffer();
}

describe('probe', () => {
  it('canais crus por formato', async () => {
    const cinza = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#808080' } })
      .toColourspace('b-w').jpeg().toBuffer();
    const m = await sharp(cinza).metadata();
    const raw = await sharp(cinza).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    LOG('CINZA meta:', m.format, m.channels, m.space, '-> raw channels', raw.info.channels);
  });

  it('produto CLARO em fundo ESCURO (falso aceite?)', async () => {
    for (const frac of [0.4, 0.5, 0.6]) {
      const lado = Math.round(600 * Math.sqrt(frac));
      const b = await cena({
        L: 600, A: 600, fundo: [60, 55, 50],
        prod: { x: Math.round((600 - lado) / 2), y: Math.round((600 - lado) / 2), w: lado, h: lado, cor: [252, 250, 248] },
        formato: 'jpeg',
      });
      const conv = await paraWeb(b, 'image/jpeg', { achatarEmBranco: true });
      const f = await analisarFundo(conv!.buffer);
      LOG(`produto claro ocupando ${Math.round(frac * 100)}% ->`,
        'piorCanto', f!.piorCanto.toFixed(3), 'global', f!.global.toFixed(3), 'BRANCO?', f!.branco);
    }
  });

  it('foto de prateleira sintetica (fundo escuro, produto colorido)', async () => {
    const b = await cena({
      L: 600, A: 600, fundo: [70, 60, 55],
      prod: { x: 150, y: 100, w: 300, h: 400, cor: [200, 30, 30] },
      formato: 'jpeg',
    });
    const conv = await paraWeb(b, 'image/jpeg', { achatarEmBranco: true });
    const f = await analisarFundo(conv!.buffer);
    LOG('prateleira ->', f!.cantos.map(c => c.toFixed(2)).join(' '), 'global', f!.global.toFixed(3), 'BRANCO?', f!.branco);
  });

  it('packshot normal', async () => {
    const b = await cena({
      L: 1200, A: 1200, fundo: [255, 255, 255],
      prod: { x: 400, y: 200, w: 400, h: 800, cor: [20, 40, 120] },
      formato: 'jpeg',
    });
    const conv = await paraWeb(b, 'image/jpeg', { achatarEmBranco: true });
    const f = await analisarFundo(conv!.buffer);
    LOG('packshot ->', conv!.largura + 'x' + conv!.altura, f!.cantos.map(c => c.toFixed(2)).join(' '), 'global', f!.global.toFixed(3), 'BRANCO?', f!.branco);
  });

  it('PNG transparente com produto escuro: achatado vira branco', async () => {
    const px = Buffer.alloc(600 * 600 * 4);
    for (let i = 0; i < 600 * 600; i++) { px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; px[i * 4 + 3] = 0; }
    for (let y = 100; y < 500; y++) for (let x = 100; x < 500; x++) {
      const i = (y * 600 + x) * 4; px[i] = 10; px[i + 1] = 10; px[i + 2] = 10; px[i + 3] = 255;
    }
    const png = await sharp(px, { raw: { width: 600, height: 600, channels: 4 } }).png().toBuffer();
    const conv = await paraWeb(png, 'image/png', { achatarEmBranco: true });
    const f = await analisarFundo(conv!.buffer);
    LOG('PNG alfa achatado ->', f!.cantos.map(c => c.toFixed(2)).join(' '), 'global', f!.global.toFixed(3), 'BRANCO?', f!.branco);
    const semAchatar = await paraWeb(png, 'image/png');
    const f2 = await analisarFundo(semAchatar!.buffer);
    LOG('PNG alfa SEM achatar ->', f2!.cantos.map(c => c.toFixed(2)).join(' '), 'global', f2!.global.toFixed(3), 'BRANCO?', f2!.branco);
  });

  it('cinza claro uniforme (placeholder) passa?', async () => {
    const b = await cena({ L: 600, A: 600, fundo: [238, 238, 238], formato: 'png' });
    const conv = await paraWeb(b, 'image/png', { achatarEmBranco: true });
    const f = await analisarFundo(conv!.buffer);
    LOG('cinza 238 ->', 'global', f!.global.toFixed(3), 'BRANCO?', f!.branco);
    const b2 = await cena({ L: 600, A: 600, fundo: [230, 230, 230], formato: 'png' });
    const c2 = await paraWeb(b2, 'image/png', { achatarEmBranco: true });
    const f2 = await analisarFundo(c2!.buffer);
    LOG('cinza 230 ->', 'global', f2!.global.toFixed(3), 'BRANCO?', f2!.branco);
  });

  it('imagem estreita: fora dos limites do buffer?', async () => {
    const b = await cena({ L: 2000, A: 20, fundo: [255, 255, 255], formato: 'png' });
    const f = await analisarFundo(b);
    LOG('2000x20 ->', JSON.stringify(f));
    const b2 = await cena({ L: 20, A: 2000, fundo: [255, 255, 255], formato: 'png' });
    const f2 = await analisarFundo(b2);
    LOG('20x2000 ->', JSON.stringify(f2));
    const b3 = await cena({ L: 1, A: 1, fundo: [255, 255, 255], formato: 'png' });
    const f3 = await analisarFundo(b3);
    LOG('1x1 ->', JSON.stringify(f3));
  });

  it('GIF e nao-imagem', async () => {
    LOG('gif paraWeb ->', await paraWeb(Buffer.from('GIF89a'), 'image/gif'));
    try {
      await miniatura(Buffer.from('<html>nao sou imagem</html>'));
      LOG('miniatura de nao-imagem NAO lancou');
    } catch (e) { LOG('miniatura de nao-imagem LANCOU:', (e as Error).message.slice(0, 80)); }
    try {
      const r = await paraWeb(Buffer.from('<html>nao sou imagem</html>'), '');
      LOG('paraWeb de nao-imagem ->', r);
    } catch (e) { LOG('paraWeb de nao-imagem LANCOU:', (e as Error).message.slice(0, 80)); }
  });

  it('orientacao EXIF na miniatura', async () => {
    const b = await cena({ L: 400, A: 300, fundo: [255, 255, 255], prod: { x: 0, y: 0, w: 400, h: 40, cor: [0, 0, 0] }, formato: 'jpeg' });
    const comExif = await sharp(b).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const conv = await paraWeb(comExif, 'image/jpeg');
    const mini = await sharp(await miniatura(comExif)).metadata();
    LOG('EXIF 6: paraWeb ->', conv!.largura + 'x' + conv!.altura, '| miniatura ->', mini.width + 'x' + mini.height);
  });

  it('webp animado passa pelo ajustar-fotos?', async () => {
    const quadros = Buffer.alloc(1000 * 1000 * 3 * 3);
    quadros.fill(200);
    const anim = await sharp(quadros, { raw: { width: 1000, height: 3000, channels: 3 }, pages: 3, pageHeight: 1000 })
      .webp({ quality: 60 }).toBuffer();
    const m = await sharp(anim).metadata();
    LOG('animado meta:', m.format, m.width + 'x' + m.height, 'pages', m.pages, 'pageHeight', m.pageHeight);
    const { ajustarSePreciso } = await import('./ajustar-fotos');
    const aj = await ajustarSePreciso(anim);
    if (aj) {
      const depois = await sharp(aj.buffer).metadata();
      LOG('ajustado ->', aj.largura + 'x' + aj.altura, 'pages depois', depois.pages);
    } else LOG('ajustarSePreciso devolveu null');
  });
});
