/**
 * TODA IMAGEM QUE SOBE VIRA WEBP REDIMENSIONADO.
 *
 * O QUE ERA. O upload gravava o arquivo exatamente como veio — nenhuma
 * conversão, nenhum redimensionamento, nenhuma compressão. Aceitava até 8 MB e
 * servia isso ao cliente. Medido em 10/09/2026, nos 88 arquivos em produção:
 *
 *   29 MB no total, 329 KB de média
 *   9 arquivos acima de 1 MB, o maior com 1.776 KB
 *   52 JPG, 28 PNG, 8 WebP
 *
 * Para comparar: na mesma noite o JavaScript do app foi de 953 KB para 134 KB,
 * e isso derrubou o carregamento em ~40 segundos. UM PNG de 1.776 KB é treze
 * vezes o bundle inteiro comprimido. Numa vitrine com vinte produtos na tela,
 * as fotos SÃO o carregamento e todo o resto é detalhe.
 *
 * PNG É O PIOR CASO PARA FOTO, e é 28 dos 88 arquivos. Ele foi feito para
 * imagem de poucas cores e áreas planas — logo, ícone, captura de tela. Em
 * fotografia ele guarda cada grão de ruído como informação. Medido nas imagens
 * reais da loja: 1.776 KB viraram 63 KB em WebP 800px, sem diferença visível.
 *
 * NÃO É "OTIMIZAÇÃO", É CORREÇÃO. A foto de celular de um lojista sai com 3 a 6
 * MB e 4.000 px de largura; o cartão do produto mostra ela em ~300 px. Guardar
 * o original é jogar 99% dos bytes na rede de quem está no 4G para desenhar os
 * mesmos pixels.
 */
import sharp from 'sharp';

/**
 * O LADO MAIOR MÁXIMO GUARDADO: 800 px.
 *
 * O TETO VALE PARA O LADO MAIOR (`fit: 'inside'`), não para a largura, e a
 * proporção é mantida: 2400x1200 vira 800x400, e 1200x2124 vira 451x800. Era só
 * a largura antes, e uma foto em pé passava enorme — a imagem da Original que
 * veio da Open Food Facts saiu 1200x2124 e 169 KB porque a altura não tinha
 * teto. Foto de garrafa é sempre em pé, então esse era o caso comum.
 *
 * POR QUE 800 E NÃO 1200. Era 1200, dimensionado para um zoom que não existe.
 * O maior uso real é o cartão do produto, que a tela desenha em torno de 300 px,
 * e a foto de destaque, em torno de 400 px: 800 px continua entregando o dobro,
 * que é o que a tela retina usa.
 *
 * MEDIDO em quatro packshots reais do Cosmos acima do teto: 168 KB no total com
 * 1200, 97 KB com 800 — 42% menos, sem diferença visível no tamanho em que a
 * foto é desenhada. E o cliente da loja abre o cardápio inteiro de uma vez, no
 * 4G. As fotos que já vêm abaixo do teto passam intactas: nelas o corte não
 * economiza nada, e economizar nelas exigiria reduzir de tamanho de verdade.
 *
 * `withoutEnlargement` porque ampliar uma foto pequena não cria detalhe: só
 * gera bytes. Imagem menor que o limite passa sem ser tocada no tamanho.
 */
export const LARGURA_MAX = 800;

/**
 * QUALIDADE 82.
 *
 * Abaixo de 75 aparece sujeira em área de cor lisa — que é justamente o fundo
 * branco de foto de produto, onde o defeito fica mais visível. Acima de 90 o
 * arquivo cresce sem ganho que o olho perceba. 82 é o meio usado para
 * fotografia de catálogo, e foi conferido nas imagens reais desta loja.
 */
export const QUALIDADE = 82;

/** O que o WebP não cobre bem e continua passando direto. */
const SEM_CONVERTER = new Set(['image/gif']);

export interface ImagemConvertida {
  buffer: Buffer;
  /** A extensão que o arquivo deve ter no disco. */
  extensao: string;
  mime: string;
  largura: number;
  altura: number;
}

/**
 * Converte para WebP redimensionado. Devolve `null` quando não deve converter.
 *
 * GIF FICA DE FORA de propósito: WebP suporta animação, mas o `sharp` só
 * converte o primeiro quadro sem `{ animated: true }`, e uma animação virando
 * imagem estática é perda de conteúdo, não de bytes. GIF é raro em foto de
 * produto e passa como está.
 */
export interface OpcoesWeb {
  /*
   * ACHATA A TRANSPARENCIA EM BRANCO.
   *
   * Nao vale para o upload do lojista, e por isso e opcional: logo em PNG
   * transparente enviado por ele deve continuar transparente. Vale para a foto
   * que vem por codigo de barras — as imagens do Cosmos sao PNG com alfa, e o
   * que o lojista pediu foi FOTO COM FUNDO BRANCO. Sem achatar, o "fundo
   * branco" seria fundo nenhum: o produto flutuaria sobre o cartao, e sobre o
   * cartao escuro no modo noturno o contorno preto do rotulo desaparece.
   */
  achatarEmBranco?: boolean;
}

export async function paraWeb(
  entrada: Buffer,
  mimeOriginal: string,
  opcoes: OpcoesWeb = {},
): Promise<ImagemConvertida | null> {
  if (SEM_CONVERTER.has(mimeOriginal)) return null;

  /*
   * `failOn: 'none'` porque arquivo de celular vem com metadado torto com
   * frequência, e recusar a foto por causa de um EXIF quebrado seria transformar
   * um aviso em erro na cara do lojista.
   *
   * `rotate()` SEM ARGUMENTO aplica a orientação do EXIF. Sem isto, foto tirada
   * com o celular de lado chega girada 90 graus na vitrine — e o lojista jura
   * que subiu certa, porque na galeria dele aparece certa.
   */
  const imagem = sharp(entrada, { failOn: 'none' }).rotate();
  if (opcoes.achatarEmBranco) imagem.flatten({ background: '#ffffff' });

  const buffer = await imagem
    .resize({ width: LARGURA_MAX, height: LARGURA_MAX, fit: 'inside', withoutEnlargement: true })
    /*
     * O METADADO NÃO VAI. Foto de celular carrega GPS: a coordenada de onde ela
     * foi tirada, que numa loja é o endereço dela e na casa de alguém é a casa
     * de alguém. Servir isso publicamente é vazamento, e o `sharp` descarta o
     * metadado por padrão — esta linha não existe, e é de propósito que ela não
     * existe. Não acrescente `.withMetadata()` aqui.
     */
    .webp({ quality: QUALIDADE })
    .toBuffer();

  const meta = await sharp(buffer).metadata();
  return {
    buffer,
    extensao: '.webp',
    mime: 'image/webp',
    largura: meta.width ?? 0,
    altura: meta.height ?? 0,
  };
}


/** O lado da miniatura de conferencia. 320 px cobre o quadro de 80 px em retina. */
export const LADO_MINIATURA = 320;

/**
 * UMA MINIATURA, para conferir sem gravar nada.
 *
 * A busca por codigo de barras mostra a foto ANTES de aceitar, e mandar o
 * arquivo cheio para a tela so para isso seria caro: o packshot do Cosmos tem
 * 1200x1200, e medido ele sai em torno de 60 KB depois da conversao — 80 KB em
 * base64. A miniatura fica em poucos KB, e como nada e gravado em disco antes
 * do lojista aceitar, ela precisa viajar embutida na resposta.
 */
export async function miniatura(entrada: Buffer, lado = LADO_MINIATURA): Promise<Buffer> {
  return sharp(entrada, { failOn: 'none' })
    .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}
