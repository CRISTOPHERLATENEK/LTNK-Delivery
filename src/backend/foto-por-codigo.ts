/**
 * FOTO DE PRODUTO PELO CÓDIGO DE BARRAS — Open Food Facts.
 *
 * POR QUE ESTA FONTE E NÃO "A INTERNET". Base colaborativa de dados abertos,
 * com licença declarada (CC-BY-SA) e API pública sem cadastro. A busca é pelo
 * CÓDIGO DE BARRAS, não por nome: o código identifica o produto exato, então a
 * foto que volta é daquele item e não de um homônimo. Buscar por nome traria a
 * garrafa errada com a mesma confiança.
 *
 * COBERTURA MEDIDA em 10/09/2026, nos 48 itens à venda sem foto da Galderio:
 *
 *   com foto ............. 19  (40%)
 *   existe, sem foto ...... 5  (10%)
 *   não existe ........... 24  (50%)
 *
 * Pega bem cerveja de marca grande (Original, Petra, Skol, Sol, Spaten) e os
 * energéticos Baly. Não pega vinho nacional, espumante nem tabacaria — esses
 * ficam para a foto do celular na prateleira.
 *
 * A PRIMEIRA MEDIÇÃO DEU 14% E ESTAVA ERRADA: eu tratava resposta barrada por
 * limite de requisição como "produto não existe". Daí o `LIMITE_ENTRE_CHAMADAS`
 * e as tentativas com espera crescente aqui embaixo — sem isso, a integração
 * relataria "não achei" para metade dos produtos que a base tem.
 */
import { paraWeb, type ImagemConvertida } from './imagem-web';

const API = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * DE ONDE ACEITO BAIXAR — lista fechada, e é a peça de segurança do arquivo.
 *
 * A URL da imagem vem de dentro de um registro que QUALQUER PESSOA edita: a
 * base é colaborativa. Sem esta lista, um registro alterado apontaria o meu
 * download para um endereço interno (`169.254.169.254`, `127.0.0.1:3306`, um
 * serviço na rede do VPS) e o servidor buscaria obedientemente — é SSRF, e o
 * pedido partiria de dentro, atrás do firewall.
 *
 * Todas as imagens da Open Food Facts saem de um host só, conferido: as quatro
 * consultas de amostra devolveram `images.openfoodfacts.org`.
 */
const HOSTS_PERMITIDOS = new Set(['images.openfoodfacts.org']);

/** Teto do arquivo baixado. Foto `full` da base fica em torno de 1 MB. */
const TAMANHO_MAX = 8 * 1024 * 1024;

/*
 * PISO DE TAMANHO — e ele veio de um defeito real, achado na prova de ponta a
 * ponta e nao num teste que eu imaginei.
 *
 * Consultando o codigo inexistente 9999999999999, a base devolveu um REGISTRO
 * DE TESTE ("Salatgurke", marca "MarcaTest") com imagem de 1x1 PIXEL. Sem piso,
 * isso entrava como foto do produto: a vitrine mostraria um ponto branco, e o
 * lojista veria "tem foto" na planilha.
 *
 * Duas medidas porque uma sozinha erra: o lado maior pega o 1x1, e a area pega
 * a tira fina. A foto legitima mais estreita que eu medi (Baly Melancia 2L) tem
 * 183x579 — lado maior 579 e area 106 mil, passa folgado.
 */
const LADO_MAIOR_MIN = 200;
const AREA_MIN = 20_000;

/** A base pede educação; medido, abaixo disto ela barra. */
export const LIMITE_ENTRE_CHAMADAS = 1200;

/** O crédito que a licença CC-BY-SA exige, gravado junto da foto. */
export const CREDITO = 'Open Food Facts (CC-BY-SA)';

export interface FotoSugerida {
  /** A imagem grande, para converter. */
  url: string;
  /** A pequena, para a tela mostrar antes de gravar. */
  urlPrevia: string;
  /** O nome do produto NA BASE — serve para a pessoa conferir que é o item. */
  nomeNaBase: string;
  marca: string;
  credito: string;
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * A versão grande da mesma imagem.
 *
 * A API devolve o endereço em 400 px, que é pouco para tela retina — o cartão
 * do produto desenha em ~300 px e dobra em retina. O mesmo caminho com `full`
 * traz o original (medido: 21 KB em 400 px contra 1.180 KB em `full`), e a
 * conversão para WebP derruba isso para dezenas de KB.
 */
export function versaoGrande(url: string): string {
  return url.replace(/\.(\d+)\.jpg$/i, '.full.jpg');
}

/** O host é um dos que eu aceito? Recusa qualquer outra coisa. */
export function origemPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS_PERMITIDOS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Procura a foto de um código de barras. `null` quando a base não tem.
 *
 * NUNCA LANÇA por causa da rede: quem chama está no meio de um cadastro de
 * produto, e a base de terceiro fora do ar não pode derrubar a tela do lojista.
 */
export async function buscarFotoPorCodigo(
  codigo: string,
  buscar: typeof fetch = fetch,
  /*
   * A ESPERA E INJETAVEL, e nao e capricho: a retentativa aguarda 2s e depois
   * 4s, e o teste que exercitava isso estourou o limite de 5s do vitest.
   * Dormir de verdade num teste tambem e desperdicio — seis segundos de suite
   * parada para provar logica que roda em microssegundos.
   */
  esperar: (ms: number) => Promise<unknown> = dormir,
): Promise<FotoSugerida | null> {
  const cod = String(codigo || '').replace(/\D/g, '');
  if (cod.length < 8) return null;

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await buscar(
        `${API}/${cod}.json?fields=product_name,brands,image_front_url,image_url,image_front_small_url`,
        { headers: { 'User-Agent': 'MaxxDelivery/1.0 (adm@maxxpedidos.com.br)' } },
      );
      /*
       * 429 E 5xx NÃO SÃO "NÃO EXISTE". Confundir os dois foi o erro que fez a
       * primeira medição dizer 14% quando a cobertura real é 40%.
       */
      if (r.status === 429 || r.status >= 500) {
        await esperar(2000 * tentativa);
        continue;
      }
      if (!r.ok) return null;
      const d = await r.json() as {
        status?: number;
        product?: { product_name?: string; brands?: string; image_front_url?: string; image_url?: string; image_front_small_url?: string };
      };
      if (!d || d.status !== 1 || !d.product) return null;

      const previa = d.product.image_front_small_url || d.product.image_front_url || d.product.image_url || '';
      const cheia = d.product.image_front_url || d.product.image_url || '';
      if (!cheia || !origemPermitida(cheia)) return null;

      return {
        url: versaoGrande(cheia),
        urlPrevia: previa,
        nomeNaBase: String(d.product.product_name || '').trim(),
        marca: String(d.product.brands || '').trim(),
        credito: CREDITO,
      };
    } catch {
      await esperar(2000 * tentativa);
    }
  }
  return null;
}

/**
 * Baixa a imagem e converte para WebP. `null` quando não dá.
 *
 * A validação de origem acontece AQUI TAMBÉM, e não só na busca: esta função é
 * exportada, e quem a chamar amanhã com uma URL vinda de outro lugar não pode
 * furar a lista de hosts por eu ter confiado no chamador.
 */
export async function baixarEConverter(
  url: string,
  buscar: typeof fetch = fetch,
): Promise<ImagemConvertida | null> {
  if (!origemPermitida(url)) return null;

  const r = await buscar(url, {
    headers: { 'User-Agent': 'MaxxDelivery/1.0 (adm@maxxpedidos.com.br)' },
    redirect: 'error',        /* redirecionamento sairia da lista de hosts */
  });
  if (!r.ok) return null;

  const tipo = String(r.headers.get('content-type') || '');
  if (!tipo.startsWith('image/')) return null;

  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length || bytes.length > TAMANHO_MAX) return null;

  /*
   * `image/...` no cabeçalho é o que o servidor DIZ. A conversão é que prova:
   * o `sharp` decodifica de verdade e lança se não for imagem. Confiar no
   * cabeçalho seria gravar no disco público o que o outro lado quiser chamar
   * de imagem.
   */
  const convertida = await paraWeb(bytes, tipo);
  if (!convertida) return null;

  /* O 1x1 do registro de teste morre aqui. */
  const ladoMaior = Math.max(convertida.largura, convertida.altura);
  const area = convertida.largura * convertida.altura;
  if (ladoMaior < LADO_MAIOR_MIN || area < AREA_MIN) return null;

  return convertida;
}
