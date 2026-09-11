import { describe, it } from 'vitest';
import fsx from 'fs';
import sharp from 'sharp';
import { ajustarSePreciso } from './ajustar-fotos';
import { analisarFundo, CLARO_MIN, CANTO_MIN, GLOBAL_MIN } from './fundo-branco';
import { paraWeb } from './imagem-web';

const SAIDA = 'C:/Users/User/AppData/Local/Temp/claude/probe2.txt';
const LOG = (...a: unknown[]) => fsx.appendFileSync(SAIDA, a.map(String).join(' ') + String.fromCharCode(10));

describe('probe2', () => {
  it('webp animado de verdade pelo ajustar-fotos', async () => {
    const quadro = (cor: string) => sharp({ create: { width: 1000, height: 400, channels: 3, background: cor } }).png().toBuffer();
    const q = [await quadro('#ff0000'), await quadro('#00ff00'), await quadro('#0000ff')];
    let anim: Buffer;
    try {
      anim = await sharp(q, { join: { animated: true } }).webp({ loop: 0, delay: [200, 200, 200] }).toBuffer();
    } catch (e) {
      LOG('nao consegui montar webp animado:', (e as Error).message.slice(0, 120));
      return;
    }
    const m = await sharp(anim).metadata();
    LOG('ANIMADO webp: ', m.width + 'x' + m.height, 'pages=', m.pages, 'pageHeight=', m.pageHeight, 'bytes=', anim.length);
    const aj = await ajustarSePreciso(anim);
    if (!aj) { LOG('ajustarSePreciso -> null (nao mexeu)'); return; }
    const depois = await sharp(aj.buffer).metadata();
    LOG('ajustado ->', aj.largura + 'x' + aj.altura, 'pages depois=', depois.pages, 'bytes=', aj.buffer.length,
      '| menor que o original?', aj.buffer.length < anim.length);
  });

  it('apng pelo ajustar-fotos', async () => {
    const quadro = (cor: string) => sharp({ create: { width: 1000, height: 400, channels: 4, background: cor } }).png().toBuffer();
    const q = [await quadro('#ff0000'), await quadro('#00ff00')];
    let anim: Buffer;
    try {
      anim = await sharp(q, { join: { animated: true } }).png().toBuffer();
    } catch (e) { LOG('apng nao montado:', (e as Error).message.slice(0, 100)); return; }
    const m = await sharp(anim).metadata();
    LOG('APNG:', m.format, m.width + 'x' + m.height, 'pages=', m.pages);
    const aj = await ajustarSePreciso(anim);
    LOG('apng ajustado ->', aj ? `${aj.largura}x${aj.altura} pages=${(await sharp(aj.buffer).metadata()).pages} menor=${aj.buffer.length < anim.length}` : 'null');
  });

  it('limiares: fundo escuro + produto claro, varrendo a fracao', async () => {
    LOG('CLARO_MIN', CLARO_MIN, 'CANTO_MIN', CANTO_MIN, 'GLOBAL_MIN', GLOBAL_MIN);
    for (const frac of [0.30, 0.34, 0.36, 0.45]) {
      const L = 600, A = 600;
      const lado = Math.round(600 * Math.sqrt(frac));
      const px = Buffer.alloc(L * A * 3);
      for (let i = 0; i < L * A; i++) { px[i * 3] = 40; px[i * 3 + 1] = 38; px[i * 3 + 2] = 35; }
      const x0 = Math.round((L - lado) / 2), y0 = Math.round((A - lado) / 2);
      for (let y = y0; y < y0 + lado; y++) for (let x = x0; x < x0 + lado; x++) {
        const i = (y * L + x) * 3; px[i] = 253; px[i + 1] = 252; px[i + 2] = 250;
      }
      const jpg = await sharp(px, { raw: { width: L, height: A, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
      const conv = await paraWeb(jpg, 'image/jpeg', { achatarEmBranco: true });
      const f = await analisarFundo(conv!.buffer);
      LOG(`  fracao ${frac} -> cantos ${f!.cantos.map(c => c.toFixed(2)).join('/')} global ${f!.global.toFixed(3)} BRANCO=${f!.branco}`);
    }
  });

  it('tamanho da pasta uploads local', async () => {
    const dir = 'dados/uploads';
    const arqs = fsx.readdirSync(dir).filter(f => !f.startsWith('.'));
    let animados = 0;
    for (const a of arqs.slice(0, 400)) {
      try {
        const m = await sharp(fsx.readFileSync(dir + '/' + a)).metadata();
        if ((m.pages ?? 1) > 1) { animados++; LOG('  animado:', a, m.format, m.width + 'x' + m.height, 'pages', m.pages); }
      } catch { /* ignora */ }
    }
    LOG('arquivos', arqs.length, 'animados', animados);
  });
});
