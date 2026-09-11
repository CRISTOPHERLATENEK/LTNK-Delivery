/**
 * O FUNDO DA FOTO É BRANCO?
 *
 * POR QUE ISSO EXISTE. A busca por código de barras começou só com a Open Food
 * Facts, e as fotos dela são de CELULAR NA PRATELEIRA. Medido em 10/09/2026,
 * nas cinco fotos que a base tinha dos produtos da Galderio, a proporção de
 * pixels claros na borda foi de 0% a 3% — fundo de gôndola, outras garrafas
 * atrás, mão de quem fotografou. Numa vitrine onde todo cartão tem fundo
 * branco, uma foto assim fica parecendo erro de cadastro.
 *
 * COMO EU DECIDO, e por que são duas medidas e não uma:
 *
 *   1. OS CANTOS. Em foto de estúdio o canto é fundo, sempre. Medido: as 10
 *      primeiras imagens do Cosmos deram 100% de canto claro nos quatro cantos,
 *      e as 5 da Open Food Facts deram 0%. Separação limpa, sem zona cinzenta.
 *
 *   2. A IMAGEM TODA, para o caso que os cantos erram: packshot com uma tarja
 *      colorida de lado (o "COCA-COLA 250ml" do código 78912908) tem canto
 *      vermelho e 57% de pixels claros no total. Foto de prateleira tem 1%.
 *
 * O QUE AINDA É RECUSADO, e eu decidi aceitar isso: o recorte justo, em que o
 * produto encosta nas quatro bordas e não sobra fundo nenhum (a lata da Petra
 * 297x864, 5% de claro; a fileira de seis latas, 7%). São fotos boas, mas não
 * têm como provar que o fundo é branco — não há fundo. São 2 de 49 na medição.
 *
 * TRANSPARENTE CONTA COMO BRANCO: as imagens do Cosmos vêm em PNG com alfa, e
 * elas são achatadas em branco na conversão. O fundo é branco por construção.
 */
import sharp from 'sharp';

/**
 * O quanto o canal mais escuro do pixel precisa subir para ele contar como
 * claro. 235 e não 250 porque JPEG suja o branco: a compressão espalha o
 * contorno do produto e o "branco" do arquivo vira 238, 242, 247.
 */
export const CLARO_MIN = 235;

/** Um canto quase todo claro. Não 100%: sombra do produto invade o canto. */
export const CANTO_MIN = 0.7;

/** Ou a imagem inteira majoritariamente clara — o packshot com tarja. */
export const GLOBAL_MIN = 0.35;

/**
 * QUANTO DA IMAGEM PRECISA SER PRODUTO. Este piso existe porque fundo branco
 * sozinho e um teste que o QUADRADO BRANCO PASSA COM NOTA MAXIMA: quatro cantos
 * em 100%, claro global em 100%, nada exigindo que haja produto na foto. E as
 * bases sao editaveis por qualquer pessoa — a Open Food Facts ja me devolveu um
 * registro de teste com imagem de 1x1 pixel; imagem branca de 1200x1200 passa
 * pelo piso de tamanho sem esforco.
 *
 * O NUMERO VEIO DE MEDICAO, nas 12 fotos reais gravadas hoje na Galderio:
 * a que tem menos produto ocupa 9,5% da imagem, a mediana 31%, a maior 57%.
 * Uma imagem toda branca da 0,0%; branca com um selo de 40x40 no meio da 0,2%.
 * 3% fica tres vezes abaixo do menor caso real e trinta vezes acima do lixo.
 */
export const CONTEUDO_MIN = 0.03;

/**
 * O lado do quadrado de canto, em fração do lado da imagem. 12% dá um quadrado
 * de 19 px na amostra de 160 — grande o bastante para não ser decidido por um
 * pixel sujo, pequeno o bastante para não alcançar o produto no meio.
 */
const CANTO_FRACAO = 0.12;

/** A análise roda numa cópia pequena: 160 px basta e é 600x mais barato. */
const AMOSTRA = 160;

/** Alfa abaixo disto é transparente, e transparente vai virar branco. */
const ALFA_MIN = 32;

export interface Fundo {
  /** A proporção de pixels claros em cada canto, na ordem ↖ ↗ ↙ ↘. */
  cantos: number[];
  /** O pior dos quatro — é ele que decide. */
  piorCanto: number;
  /** A proporção de pixels claros na imagem inteira. */
  global: number;
  /** O que sobra: a parte da imagem que NÃO é fundo, ou seja, o produto. */
  conteudo: number;
  /** Tem produto suficiente para ser foto de alguma coisa. */
  temProduto: boolean;
  /** Fundo branco E produto na frente. É este que decide se a foto entra. */
  branco: boolean;
}

/**
 * Mede o fundo. Nunca lança: imagem que o `sharp` não decodifica devolve
 * `null`, e quem chama trata como "não serve" em vez de quebrar a tela.
 */
export async function analisarFundo(entrada: Buffer): Promise<Fundo | null> {
  try {
    const { data, info } = await sharp(entrada, { failOn: 'none' })
      .resize({ width: AMOSTRA, height: AMOSTRA, fit: 'inside' })
      /* `ensureAlpha` para o laço ler sempre 4 canais, tenha a origem alfa ou
         não — sem isso o índice do pixel muda com o formato do arquivo. */
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width: L, height: A, channels: C } = info;
    if (!L || !A) return null;

    /** O canal mais escuro do pixel, com transparente valendo branco. */
    const claro = (x: number, y: number): number => {
      const i = (y * L + x) * C;
      const alfa = C > 3 ? data[i + 3] : 255;
      if (alfa < ALFA_MIN) return 255;
      return Math.min(data[i], data[i + 1], data[i + 2]);
    };

    const cx = Math.max(3, Math.round(L * CANTO_FRACAO));
    const cy = Math.max(3, Math.round(A * CANTO_FRACAO));
    const cantos: number[] = [];
    for (const [x0, y0] of [[0, 0], [L - cx, 0], [0, A - cy], [L - cx, A - cy]]) {
      let n = 0;
      let claros = 0;
      for (let y = y0; y < y0 + cy; y++) {
        for (let x = x0; x < x0 + cx; x++) {
          n++;
          if (claro(x, y) >= CLARO_MIN) claros++;
        }
      }
      cantos.push(n ? claros / n : 0);
    }

    let total = 0;
    let clarosTotal = 0;
    for (let y = 0; y < A; y++) {
      for (let x = 0; x < L; x++) {
        total++;
        if (claro(x, y) >= CLARO_MIN) clarosTotal++;
      }
    }

    const piorCanto = Math.min(...cantos);
    const global = total ? clarosTotal / total : 0;
    const conteudo = 1 - global;
    const temProduto = conteudo >= CONTEUDO_MIN;
    const fundoClaro = piorCanto >= CANTO_MIN || global >= GLOBAL_MIN;
    return {
      cantos,
      piorCanto,
      global,
      conteudo,
      temProduto,
      /*
       * AS DUAS CONDICOES JUNTAS, e a segunda nao e detalhe: sem ela o quadrado
       * branco e a melhor foto que existe pela regra do fundo — e entraria na
       * vitrine como "produto com foto", que e pior que produto sem foto
       * nenhuma, porque some da lista do que falta.
       */
      branco: fundoClaro && temProduto,
    };
  } catch {
    return null;
  }
}
