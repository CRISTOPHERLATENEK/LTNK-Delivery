import { describe, it } from 'vitest';
import fsx from 'fs';
import sharp from 'sharp';
import { analisarFundo } from './fundo-branco';
import { ajustarSePreciso } from './ajustar-fotos';

const SAIDA = 'C:/Users/User/AppData/Local/Temp/claude/probe3.txt';
const LOG = (...a: unknown[]) => fsx.appendFileSync(SAIDA, a.map(String).join(' ') + String.fromCharCode(10));

describe('probe3', () => {
  it('CMYK chega em quantos canais?', async () => {
    const cmyk = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } })
      .toColourspace('cmyk').jpeg().toBuffer();
    const m = await sharp(cmyk).metadata();
    const raw = await sharp(cmyk).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    LOG('CMYK meta:', m.format, 'channels', m.channels, 'space', m.space, '-> raw channels', raw.info.channels,
      'primeiros bytes', Array.from(raw.data.subarray(0, 8)).join(','));
    const f = await analisarFundo(cmyk);
    LOG('CMYK branco ->', JSON.stringify(f));

    const cmykCiano = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#00ffff' } })
      .toColourspace('cmyk').jpeg().toBuffer();
    LOG('CMYK ciano ->', JSON.stringify(await analisarFundo(cmykCiano)));
  });

  it('perfil ICC sobrevive ao ajustar-fotos?', async () => {
    const base = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#c83232' } })
      .withIccProfile('p3').jpeg().toBuffer();
    const m = await sharp(base).metadata();
    LOG('original: icc?', !!m.icc, 'space', m.space);
    const px0 = await sharp(base).raw().toBuffer();
    const aj = await ajustarSePreciso(base);
    if (!aj) { LOG('nao ajustou'); return; }
    const m2 = await sharp(aj.buffer).metadata();
    const px1 = await sharp(aj.buffer).raw().toBuffer();
    LOG('depois: icc?', !!m2.icc, 'pixel antes', Array.from(px0.subarray(0, 3)).join(','),
      'pixel depois', Array.from(px1.subarray(0, 3)).join(','));
  });
});
