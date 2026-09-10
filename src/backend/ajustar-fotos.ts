/**
 * AJUSTA AS FOTOS JÁ GRAVADAS ao teto de tamanho — as antigas, que entraram
 * antes de o teto existir ou com um teto maior.
 *
 * POR QUE ISSO EXISTE. Toda foto que SOBE hoje já é reduzida na hora, em
 * `imagem-web.ts`: o upload do lojista e a busca por código de barras passam
 * pelo mesmo `paraWeb`, e nenhuma foto nova nasce acima do teto. O que ninguém
 * ajusta são as que já estão no disco — medido em 10/09/2026, 47 dos 144
 * arquivos estavam acima de 800 px e sozinhos custavam 21 MB dos 30 MB da
 * pasta. Um deles tinha 6003x2001.
 *
 * O QUE ELE NÃO FAZ, e é de propósito:
 *
 *   1. NÃO TROCA O FORMATO. Converter um `.jpg` para WebP mudaria o nome do
 *      arquivo, e o nome está gravado no banco — em `produtos.foto_url`, em
 *      `lojas.logo_url` e `capa_url`, na foto do sabor, na tabela de banners e
 *      em três chaves de `configuracoes`, DE CADA LOJA. Renomear sem acertar
 *      todas essas pontas deixa a vitrine com foto quebrada, e o ganho de
 *      bytes não paga esse risco. JPEG continua JPEG, PNG continua PNG.
 *
 *   2. NÃO AMPLIA. Foto abaixo do teto não é tocada: ampliar não cria detalhe,
 *      só bytes, e ainda embaça — pareceria defeito de quem subiu.
 *
 *   3. NÃO APAGA NADA. O original de cada arquivo mexido é copiado antes, e a
 *      pasta de cópia é dita no relatório. Reverter é copiar de volta.
 *
 * ELE NÃO RODA SOZINHO: por padrão só mede e diz o que faria. Escrever exige
 * `--fazer`. Foto de cliente não é lugar para descobrir intenção pelo silêncio.
 *
 *   node dist/backend/ajustar-fotos.js              (só mede)
 *   node dist/backend/ajustar-fotos.js --fazer      (ajusta de verdade)
 */
import fs from 'fs';
import path from 'path';
import sharp, { type Sharp } from 'sharp';
import { LARGURA_MAX, QUALIDADE } from './imagem-web';

/** O mesmo teto do upload: uma regra só, para as duas pontas não divergirem. */
export const TETO = LARGURA_MAX;

/** Formatos que eu sei reescrever sem mudar a extensão do arquivo. */
const REESCREVE: Record<string, (i: Sharp) => Sharp> = {
  jpeg: i => i.jpeg({ quality: QUALIDADE, mozjpeg: true }),
  png: i => i.png({ compressionLevel: 9 }),
  webp: i => i.webp({ quality: QUALIDADE }),
};

export interface Ajuste {
  buffer: Buffer;
  formato: string;
  largura: number;
  altura: number;
}

/**
 * Devolve a versão ajustada, ou `null` quando não há nada a fazer — foto dentro
 * do teto, formato que eu não reescrevo, arquivo que não decodifica.
 *
 * NUNCA LANÇA: um arquivo estranho no meio da pasta não pode interromper a
 * varredura e deixar metade das fotos ajustadas e metade não.
 */
export async function ajustarSePreciso(entrada: Buffer): Promise<Ajuste | null> {
  try {
    const meta = await sharp(entrada).metadata();
    const formato = String(meta.format || '');
    const largura = meta.width || 0;
    const altura = meta.height || 0;
    if (!largura || !altura) return null;
    if (Math.max(largura, altura) <= TETO) return null;
    const codificar = REESCREVE[formato];
    if (!codificar) return null;

    /*
     * `rotate()` SEM ARGUMENTO aplica a orientação do EXIF, igual ao upload.
     * Aqui isso importa por um motivo extra: ao reescrever o arquivo o metadado
     * é descartado, então uma foto que dependia do EXIF para aparecer em pé
     * ficaria deitada para sempre se a rotação não fosse aplicada agora.
     */
    const imagem = sharp(entrada, { failOn: 'none' }).rotate()
      .resize({ width: TETO, height: TETO, fit: 'inside', withoutEnlargement: true });

    const buffer = await codificar(imagem).toBuffer();
    const nova = await sharp(buffer).metadata();
    return { buffer, formato, largura: nova.width || 0, altura: nova.height || 0 };
  } catch {
    return null;
  }
}

export interface Resumo {
  arquivos: number;
  ajustados: number;
  intocados: number;
  bytesAntes: number;
  bytesDepois: number;
  pastaCopia: string;
}

/**
 * Percorre a pasta. Com `fazer: false` (o padrão) mede e não escreve nada.
 *
 * A ESCRITA É EM DOIS PASSOS: grava um `.tmp` ao lado e depois renomeia. O
 * rename dentro da mesma pasta é atômico, então o servidor nunca serve um
 * arquivo pela metade para um cliente que está com o cardápio aberto.
 */
export async function ajustarPasta(dir: string, opcoes: {
  fazer?: boolean;
  copia?: string;
  log?: (linha: string) => void;
} = {}): Promise<Resumo> {
  const fazer = opcoes.fazer ?? false;
  const log = opcoes.log ?? (() => {});
  const pastaCopia = opcoes.copia
    ?? path.join(path.dirname(dir), `uploads-antes-${TETO}-${new Date().toISOString().slice(0, 10)}`);

  const arquivos = fs.readdirSync(dir).filter(f => !f.startsWith('.')
    && fs.statSync(path.join(dir, f)).isFile() && !f.endsWith('.tmp'));

  const resumo: Resumo = {
    arquivos: arquivos.length, ajustados: 0, intocados: 0,
    bytesAntes: 0, bytesDepois: 0, pastaCopia,
  };

  for (const nome of arquivos) {
    const alvo = path.join(dir, nome);
    const antes = fs.readFileSync(alvo);
    const ajuste = await ajustarSePreciso(antes);
    if (!ajuste) { resumo.intocados++; continue; }

    /*
     * ARQUIVO QUE CRESCERIA FICA COMO ESTÁ. Acontece de verdade: um PNG grande
     * com pouca cor pode ficar maior ao ser reescrito com outra biblioteca, e
     * trocar por uma versão pior E menor de resolução seria perda dupla.
     */
    if (ajuste.buffer.length >= antes.length) {
      log(`  = ${nome}: ficaria maior (${Math.round(antes.length / 1024)} KB ->`
        + ` ${Math.round(ajuste.buffer.length / 1024)} KB), deixei como está`);
      resumo.intocados++;
      continue;
    }

    resumo.ajustados++;
    resumo.bytesAntes += antes.length;
    resumo.bytesDepois += ajuste.buffer.length;
    log(`  ${fazer ? '*' : '-'} ${nome}: ${ajuste.formato} ${Math.round(antes.length / 1024)} KB`
      + ` -> ${ajuste.largura}x${ajuste.altura} ${Math.round(ajuste.buffer.length / 1024)} KB`);

    if (!fazer) continue;

    fs.mkdirSync(pastaCopia, { recursive: true });
    fs.writeFileSync(path.join(pastaCopia, nome), antes);
    const temporario = alvo + '.tmp';
    fs.writeFileSync(temporario, ajuste.buffer);
    fs.renameSync(temporario, alvo);
  }

  return resumo;
}

/* A execução direta. Não roda quando o módulo é importado — o teste importa. */
if (require.main === module) {
  const fazer = process.argv.includes('--fazer');
  const dir = path.resolve('./dados/uploads');
  console.log(`${fazer ? 'AJUSTANDO' : 'MEDINDO (nada será escrito)'} — teto de ${TETO} px em ${dir}\n`);
  ajustarPasta(dir, { fazer, log: l => console.log(l) }).then(r => {
    const kb = (n: number) => Math.round(n / 1024) + ' KB';
    console.log(`\narquivos ......... ${r.arquivos}`);
    console.log(`ajustados ........ ${r.ajustados}  (${kb(r.bytesAntes)} -> ${kb(r.bytesDepois)}`
      + `, ${r.bytesAntes ? Math.round((1 - r.bytesDepois / r.bytesAntes) * 100) : 0}% menos)`);
    console.log(`intocados ........ ${r.intocados}`);
    if (fazer) console.log(`cópia do original em ${r.pastaCopia}`);
    else console.log('\nnada foi escrito. Para valer: node dist/backend/ajustar-fotos.js --fazer');
  }).catch(e => {
    console.error('falhou:', e);
    process.exit(1);
  });
}
