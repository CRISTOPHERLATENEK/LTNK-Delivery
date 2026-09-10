import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { paraWeb, LARGURA_MAX, QUALIDADE } from './imagem-web';

/*
 * TODA IMAGEM QUE SOBE VIRA WEBP REDIMENSIONADO.
 *
 * O upload gravava o arquivo exatamente como veio. Medido em 10/09/2026 nos 88
 * arquivos em produção: 29 MB no total, 329 KB de média, 9 acima de 1 MB, o
 * maior com 1.776 KB, e 28 dos 88 em PNG.
 *
 * Na mesma noite o JavaScript do app foi de 953 KB para 134 KB e isso derrubou
 * o carregamento em ~40 segundos. UM PNG de 1.776 KB é treze vezes o bundle
 * comprimido — numa vitrine com vinte produtos, a foto É o carregamento.
 *
 * ESTES TESTES GERAM IMAGEM DE VERDADE e conferem os bytes que saem. Asserção
 * de texto no código provaria que eu escrevi `.webp(...)`; não provaria que o
 * arquivo encolhe, que a orientação é aplicada, nem que o GPS foi descartado —
 * que é o que importa.
 */

/**
 * Uma imagem PARECIDA COM FOTO: gradiente suave com grão por cima.
 *
 * MINHA PRIMEIRA VERSÃO ERA RUÍDO PSEUDO-ALEATÓRIO, e o teste do encolhimento
 * caiu — corretamente. Ruído de alta frequência é o MELHOR caso para o PNG (os
 * filtros dele acham o padrão) e o PIOR para o WebP, que gasta bits tentando
 * preservar grão que ninguém olha. Medido: 112 KB em PNG contra 952 KB em WebP,
 * ou seja o inverso do mundo real.
 *
 * Foto de produto é o oposto: superfície lisa, gradiente, sombra suave, um
 * pouco de grão de sensor. Com este gerador, medido: 317 KB em PNG contra 63 KB
 * em WebP — que é a ordem de grandeza das imagens reais da loja (1.776 KB
 * viraram 103 KB).
 */
async function fotoFalsa(largura: number, altura: number, formato: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const pixels = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 3;
      const gradiente = 150 + Math.sin(x / 180) * Math.cos(y / 220) * 70;
      const grao = ((x * 13 + y * 7) % 11) - 5;
      const limite = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
      pixels[i] = limite(gradiente + grao + 20);
      pixels[i + 1] = limite(gradiente + grao);
      pixels[i + 2] = limite(gradiente + grao - 25);
    }
  }
  const s = sharp(pixels, { raw: { width: largura, height: altura, channels: 3 } });
  return formato === 'png' ? s.png().toBuffer() : s.jpeg().toBuffer();
}

describe('a conversão para web', () => {
  it('devolve WebP, e não o formato de entrada', async () => {
    const r = await paraWeb(await fotoFalsa(400, 300), 'image/png');
    expect(r).not.toBeNull();
    expect(r!.mime).toBe('image/webp');
    expect(r!.extensao).toBe('.webp');
    /* Os bytes: WebP começa com "RIFF....WEBP". Confirma o conteúdo, não o
       rótulo que eu mesmo escrevi no objeto. */
    expect(r!.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(r!.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  /*
   * O NÚMERO QUE JUSTIFICA TUDO. PNG de foto é o pior caso e é 28 dos 88
   * arquivos reais. Se a conversão não encolher, ela não serve para nada.
   */
  it('um PNG de foto encolhe muito', async () => {
    const original = await fotoFalsa(1200, 1200);
    const r = await paraWeb(original, 'image/png');
    expect(r).not.toBeNull();
    /* Medido com este gerador: 317 KB -> 63 KB, 80% menor. A margem do teste é
       50% para não quebrar com a próxima versão do codificador. */
    expect(r!.buffer.length).toBeLessThan(original.length / 2);
  });

  /*
   * REDIMENSIONA O QUE É GRANDE. Foto de celular sai com 4.000 px de largura e
   * o cartão do produto desenha em ~300 px: guardar o original é jogar bytes
   * na rede de quem está no 4G para pintar os mesmos pixels.
   */
  it('corta a largura no teto', async () => {
    const r = await paraWeb(await fotoFalsa(2400, 1200), 'image/jpeg');
    expect(r!.largura).toBe(LARGURA_MAX);
    /* E mantém a proporção: 2400x1200 é 2:1, então 1200 de largura pede 600. */
    expect(r!.altura).toBe(600);
  });

  /*
   * E NÃO AMPLIA O QUE É PEQUENO. Ampliar não cria detalhe, só bytes — e ainda
   * deixa a foto embaçada, que parece defeito de quem subiu.
   */
  it('imagem menor que o teto mantém o tamanho', async () => {
    const r = await paraWeb(await fotoFalsa(300, 200), 'image/jpeg');
    expect(r!.largura).toBe(300);
    expect(r!.altura).toBe(200);
  });

  /*
   * ORIENTAÇÃO DO EXIF APLICADA. Foto tirada com o celular de lado chega girada
   * 90 graus na vitrine — e o lojista jura que subiu certa, porque na galeria
   * dele o visualizador respeita o EXIF e mostra certa.
   */
  it('aplica a rotação do EXIF', async () => {
    /* 400x200 marcada como "girar 90": o resultado tem que sair 200x400. */
    const comExif = await sharp(await fotoFalsa(400, 200))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const r = await paraWeb(comExif, 'image/jpeg');
    expect(r!.largura).toBe(200);
    expect(r!.altura).toBe(400);
  });

  /*
   * O GPS NÃO VAI PARA A VITRINE. Foto de celular carrega a coordenada de onde
   * foi tirada. Numa loja isso é o endereço dela; na casa de alguém, é a casa
   * de alguém — e o arquivo é servido publicamente.
   */
  it('descarta o metadado, inclusive GPS', async () => {
    const comGps = await sharp(await fotoFalsa(300, 300))
      .withMetadata({ exif: { IFD0: { Copyright: 'ACME', Artist: 'quem tirou' } } })
      .jpeg()
      .toBuffer();
    /* Confirma que a entrada TEM metadado — senão o teste passaria por vazio. */
    expect((await sharp(comGps).metadata()).exif).toBeTruthy();

    const r = await paraWeb(comGps, 'image/jpeg');
    const saida = await sharp(r!.buffer).metadata();
    expect(saida.exif).toBeFalsy();
  });

  /*
   * GIF FICA DE FORA. O `sharp` converte só o primeiro quadro sem
   * `{ animated: true }`, e animação virando imagem estática é perda de
   * conteúdo, não de bytes.
   */
  it('GIF passa sem conversão', async () => {
    expect(await paraWeb(Buffer.from('GIF89a'), 'image/gif')).toBeNull();
  });

  /* Arquivo torto não pode derrubar o envio — quem chama grava o original. */
  it('entrada inválida lança, para quem chama tratar', async () => {
    await expect(paraWeb(Buffer.from('isto nao e imagem'), 'image/png')).rejects.toThrow();
  });

  it('a qualidade fica na faixa de foto de catálogo', () => {
    /* Abaixo de 75 suja o fundo branco de foto de produto; acima de 90 cresce
       sem ganho visível. */
    expect(QUALIDADE).toBeGreaterThanOrEqual(75);
    expect(QUALIDADE).toBeLessThanOrEqual(90);
  });
});

describe('a rota de upload usa a conversão', () => {
  const rota = fs.readFileSync(path.join(__dirname, 'rotas', 'upload.ts'), 'utf8');

  /* Só o que executa: comentário citando o erro evitado não conta como erro. */
  const exec = (f: string) => f.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

  /*
   * MEMÓRIA E NÃO DISCO. Com `diskStorage` o arquivo já estava gravado quando o
   * handler rodava, e não havia como converter sem ler de volta e reescrever.
   */
  it('recebe em memória, para converter antes de gravar', () => {
    const codigo = exec(rota);
    expect(codigo).toContain('multer.memoryStorage()');
    expect(codigo).not.toContain('multer.diskStorage');
  });

  it('converte e grava o resultado, não o original', () => {
    const codigo = exec(rota);
    expect(codigo).toContain('await paraWeb(req.file.buffer, req.file.mimetype)');
    expect(codigo).toContain('convertida ? convertida.buffer : req.file.buffer');
    expect(codigo).toContain('convertida ? convertida.extensao :');
  });

  /*
   * FALHA NA CONVERSÃO NÃO PERDE O ENVIO. Uma foto pesada é pior que uma foto
   * leve; nenhuma foto é pior que as duas.
   */
  it('sem conversão, grava o original com extensão do mimetype validado', () => {
    const codigo = exec(rota);
    expect(codigo).toContain('EXT_POR_MIME[req.file.mimetype]');
    /* E nunca do nome que o cliente mandou — isso é Stored XSS. */
    expect(codigo).not.toContain('originalname');
  });
});
