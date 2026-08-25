/**
 * REDUZ A IMAGEM NO NAVEGADOR, ANTES DE SUBIR.
 *
 * POR QUE ISTO EXISTE. Nada no caminho reduzia imagem: o `multer` grava o
 * arquivo como veio (`rotas/upload.ts`, sem sharp nem resize) e o
 * `express.static` serve exatamente aquele byte pra todo cliente que abre o
 * cardápio. Foto de celular tem 3–4 MB e 4000px de largura; ela é renderizada
 * em miniatura de 44px na lista de sabores e em 190px na foto do produto.
 *
 * Numa pizzaria com dezesseis sabores fotografados, isso é ~50 MB de imagem num
 * cardápio que precisa abrir em segundos no 4G do cliente. O limite de 8 MB do
 * servidor não protege disso — ele impede o arquivo gigante, não o cardápio
 * pesado.
 *
 * FAZER NO NAVEGADOR E NÃO NO SERVIDOR foi escolha: resolve na origem (o byte
 * grande nem sobe, então economiza a subida do lojista também, que é quem está
 * no 4G da loja), não pede dependência nova (`canvas` é do navegador) e não
 * ocupa CPU de um processo que atende pedido de cliente.
 *
 * O QUE NÃO SE PERDE: a imagem só encolhe se estiver ACIMA do limite. Foto já
 * pequena passa intacta — reprocessar cortaria qualidade de graça.
 */

/** Teto de lado maior. 1280 cobre a foto do produto em tela retina sem exagero. */
const LADO_MAX = 1280;
/** Acima disto vale reprocessar mesmo se as dimensões couberem (PNG de tela). */
const BYTES_MAX = 600 * 1024;
const QUALIDADE = 0.82;

/**
 * GIF NÃO PASSA POR AQUI. Desenhar num canvas achata a animação no primeiro
 * quadro — o lojista subiria um GIF animado e receberia uma imagem parada, sem
 * aviso. Melhor subir cru: é raro, e perder a animação em silêncio é pior que
 * um arquivo maior.
 *
 * SVG também fica fora: é vetor, já é pequeno, e rasterizar destrói a razão de
 * ele existir.
 */
const NAO_REDUZ = ['image/gif', 'image/svg+xml'];

export interface ResultadoReducao {
  arquivo: File;
  /** `true` quando o arquivo devolvido é o original, sem reprocessar. */
  intacto: boolean;
}

/**
 * Calcula as dimensões de saída mantendo a proporção.
 *
 * Exportada porque é a parte testável: o resto depende de `canvas` e de
 * `createImageBitmap`, que não existem fora do navegador.
 */
export function dimensoesReduzidas(
  largura: number, altura: number, ladoMax = LADO_MAX,
): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= ladoMax) return { largura, altura };
  const fator = ladoMax / maior;
  /* `round` e mínimo de 1: uma imagem de 4000×3 encolheria pra altura 0 e o
     canvas recusaria desenhar. */
  return {
    largura: Math.max(1, Math.round(largura * fator)),
    altura: Math.max(1, Math.round(altura * fator)),
  };
}

/** Vale reprocessar? Só se estourar dimensão OU peso. */
export function precisaReduzir(
  tipo: string, bytes: number, largura: number, altura: number,
  ladoMax = LADO_MAX, bytesMax = BYTES_MAX,
): boolean {
  if (NAO_REDUZ.includes(tipo)) return false;
  return Math.max(largura, altura) > ladoMax || bytes > bytesMax;
}

/**
 * Devolve um arquivo pronto pra subir.
 *
 * NUNCA LANÇA: qualquer falha (formato que o navegador não decodifica, canvas
 * bloqueado, memória) devolve o arquivo original. Upload que funcionava antes
 * não pode parar de funcionar por causa de uma otimização.
 */
export async function reduzirImagem(file: File): Promise<ResultadoReducao> {
  if (NAO_REDUZ.includes(file.type)) return { arquivo: file, intacto: true };
  try {
    const bitmap = await createImageBitmap(file);
    if (!precisaReduzir(file.type, file.size, bitmap.width, bitmap.height)) {
      bitmap.close();
      return { arquivo: file, intacto: true };
    }
    const { largura, altura } = dimensoesReduzidas(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return { arquivo: file, intacto: true }; }
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();

    /*
     * SAI SEMPRE COMO JPEG, inclusive PNG de entrada.
     *
     * PNG de foto é o pior caso do cardápio: um print de 1 MB que o JPEG resolve
     * em 80 KB. E transparência não serve pra foto de produto — o card tem fundo
     * branco. Logo e favicon usam este mesmo componente, mas raramente estouram
     * o limite, então continuam passando intactos.
     */
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', QUALIDADE));
    if (!blob || blob.size >= file.size) return { arquivo: file, intacto: true };

    const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return {
      arquivo: new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() }),
      intacto: false,
    };
  } catch {
    return { arquivo: file, intacto: true };
  }
}
