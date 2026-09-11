/**
 * FOTO DE PRODUTO PELO CÓDIGO DE BARRAS — duas fontes, e fundo branco exigido.
 *
 * A BUSCA É PELO CÓDIGO, nunca por nome: o código identifica o produto exato,
 * então a foto que volta é daquele item e não de um homônimo. Por nome, "BRAHMA
 * CAIXA" e "BRAHMA LATA" trariam a mesma imagem com a mesma confiança.
 *
 * POR QUE DUAS FONTES, E NESTA ORDEM. Começou só com a Open Food Facts, e o
 * lojista reclamou do resultado: as fotos dela são de CELULAR NA PRATELEIRA.
 * Medi as duas fontes nos mesmos produtos da Galderio, em 10/09/2026:
 *
 *                          Cosmos (Bluesoft)      Open Food Facts
 *   tem imagem .........   49 de 60  (82%)        24 de 60  (40%)
 *   fundo branco .......   46 de 49  (94%)         0 de  5   (0%)
 *   tamanho típico .....   1200x1200 PNG          2178x4080 foto de celular
 *   claro na borda .....   79% a 100%             0% a 3%
 *
 * O Cosmos entrega packshot de fabricante; a Open Food Facts entrega o que um
 * voluntário fotografou no mercado. Por isso o Cosmos vem primeiro, e a Open
 * Food Facts continua como segunda tentativa — ela pega itens que o Cosmos não
 * tem, e quando a foto dela por acaso for de estúdio, ela passa no mesmo teste.
 *
 * O FUNDO É EXIGIDO, não sugerido: `analisarFundo` decide, e foto de prateleira
 * é recusada com motivo próprio para a tela poder explicar. Numa vitrine em que
 * todo cartão tem fundo branco, foto de gôndola parece erro de cadastro.
 *
 * SOBRE O TOKEN DO COSMOS. A imagem sai do CDN por endereço previsível
 * (`/products/<gtin>`) e mede-se que ele responde sem token. O CADASTRO
 * (descrição e marca), que é o que deixa a pessoa conferir que o código está
 * certo, exige token pago em `X-Cosmos-Token` — configure `COSMOS_TOKEN` no
 * `.env` e ele passa a vir. Sem token a integração funciona e a conferência
 * fica sendo a própria imagem na tela.
 *
 * A PRIMEIRA MEDIÇÃO DA OPEN FOOD FACTS DEU 14% E ESTAVA ERRADA: eu tratava
 * resposta barrada por limite de requisição como "produto não existe". Daí o
 * `LIMITE_ENTRE_CHAMADAS` e as tentativas com espera crescente aqui embaixo.
 */
import { paraWeb, miniatura, type ImagemConvertida } from './imagem-web';
import { analisarFundo, type Fundo } from './fundo-branco';

const API_OFF = 'https://world.openfoodfacts.org/api/v2/product';

/** O CDN de imagens do Cosmos. Endereço previsível pelo GTIN, sem token. */
const CDN_COSMOS = 'https://cdn-cosmos.bluesoft.com.br/products';

/** O cadastro do Cosmos — só com token, e é o que traz nome e marca. */
const API_COSMOS = 'https://api.cosmos.bluesoft.com.br/gtins';

const UA = 'MaxxDelivery/1.0 (adm@maxxpedidos.com.br)';

/**
 * QUANTO TEMPO EU ESPERO CADA FONTE, e sem isto o `fetch` do Node espera 300
 * SEGUNDOS: e o padrao do undici para cabecalho e para corpo.
 *
 * Uma chamada da lupa encadeia ate seis requisicoes (cadastro do Cosmos,
 * imagem do Cosmos, consulta da Open Food Facts com duas retentativas, imagem
 * da Open Food Facts). Com a fonte LENTA — nao fora do ar, mas aceitando a
 * conexao e nao respondendo, que foi o comportamento medido no dia do 429 — um
 * unico clique de lojista prendia o processo por minutos. Alguns cliques em
 * paralelo e o app para de aceitar requisicao nova, por causa de um servico de
 * terceiro que nao nos deve nada.
 *
 * 8 segundos para consulta e 20 para download: a imagem do Cosmos chega a 1,4
 * MB, e o medido no servidor foi 0,3 a 1,2 segundo por foto.
 */
const ESPERA_CONSULTA = 8_000;
const ESPERA_DOWNLOAD = 20_000;

/**
 * DE ONDE ACEITO BAIXAR — lista fechada, e é a peça de segurança do arquivo.
 *
 * A URL da imagem da Open Food Facts vem de dentro de um registro que QUALQUER
 * PESSOA edita: a base é colaborativa. Sem esta lista, um registro alterado
 * apontaria o meu download para um endereço interno (`169.254.169.254`,
 * `127.0.0.1:3306`, um serviço na rede do VPS) e o servidor buscaria
 * obedientemente — é SSRF, e o pedido partiria de dentro, atrás do firewall.
 *
 * O endereço do Cosmos eu monto aqui, então ele não corre esse risco; entra na
 * lista porque a validação acontece no download e não confia em quem chamou.
 */
const HOSTS_PERMITIDOS = new Set([
  'images.openfoodfacts.org',
  'cdn-cosmos.bluesoft.com.br',
]);

/** Teto do arquivo baixado. Packshot do Cosmos chega a 1,4 MB. */
const TAMANHO_MAX = 8 * 1024 * 1024;

/*
 * PISO DE TAMANHO — e ele veio de um defeito real, achado na prova de ponta a
 * ponta e nao num teste que eu imaginei.
 *
 * Consultando o codigo inexistente 9999999999999, a Open Food Facts devolveu um
 * REGISTRO DE TESTE ("Salatgurke", marca "MarcaTest") com imagem de 1x1 PIXEL.
 * Sem piso, isso entrava como foto do produto: a vitrine mostraria um ponto
 * branco, e o lojista veria "tem foto" na planilha.
 *
 * Duas medidas porque uma sozinha erra: o lado maior pega o 1x1, e a area pega
 * a tira fina. A foto legitima mais estreita que eu medi (Baly Melancia 2L) tem
 * 183x579 — lado maior 579 e area 106 mil, passa folgado.
 */
const LADO_MAIOR_MIN = 200;
const AREA_MIN = 20_000;

/** A Open Food Facts pede educação; medido, abaixo disto ela barra. */
export const LIMITE_ENTRE_CHAMADAS = 1200;

/** O crédito que a licença CC-BY-SA da Open Food Facts exige. */
export const CREDITO = 'Open Food Facts (CC-BY-SA)';

/** A atribuição da imagem do Cosmos, gravada junto da foto pelo mesmo motivo. */
export const CREDITO_COSMOS = 'Cosmos / Bluesoft';

export type NomeFonte = 'cosmos' | 'openfoodfacts';

export interface FotoSugerida {
  /** A imagem grande, para converter. */
  url: string;
  /** A pequena, quando a fonte tem uma — só a Open Food Facts tem. */
  urlPrevia: string;
  /** O nome do produto NA FONTE — serve para a pessoa conferir que é o item. */
  nomeNaBase: string;
  marca: string;
  credito: string;
  fonte: NomeFonte;
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** As dependências de rede e de tempo, injetáveis para o teste não sair daqui. */
export interface Deps {
  buscar?: typeof fetch;
  /*
   * A ESPERA E INJETAVEL, e nao e capricho: a retentativa aguarda 2s e depois
   * 4s, e o teste que exercitava isso estourou o limite de 5s do vitest.
   * Dormir de verdade num teste tambem e desperdicio — seis segundos de suite
   * parada para provar logica que roda em microssegundos.
   */
  esperar?: (ms: number) => Promise<unknown>;
  /** O token do Cosmos. Padrão: o do ambiente. Nunca é registrado em log. */
  tokenCosmos?: string;
  /** A ordem das fontes. Trocar aqui é como o teste isola uma delas. */
  fontes?: Fonte[];
}

export type Fonte = (
  codigo: string,
  buscar: typeof fetch,
  esperar: (ms: number) => Promise<unknown>,
  token: string,
) => Promise<FotoSugerida | null>;

/**
 * A versão grande da mesma imagem da Open Food Facts.
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

/** O endereço da imagem do Cosmos para um GTIN. Montado, não recebido. */
export function urlDoCosmos(codigo: string): string {
  return `${CDN_COSMOS}/${encodeURIComponent(codigo)}`;
}

/**
 * O CANDIDATO DO COSMOS — e ele não custa requisição nenhuma.
 *
 * O endereço da imagem é previsível pelo GTIN, então não há consulta para
 * "existe?": a resposta vem no próprio download (404 = não tem, e aí a próxima
 * fonte é tentada). Com token, uma segunda chamada traz descrição e marca para
 * a pessoa conferir; sem token, a conferência é a imagem que ela vê na tela.
 */
export const candidatoCosmos: Fonte = async (codigo, buscar, _esperar, token) => {
  const url = urlDoCosmos(codigo);
  let nomeNaBase = '';
  let marca = '';

  if (token) {
    try {
      const r = await buscar(`${API_COSMOS}/${codigo}.json`, {
        headers: {
          'X-Cosmos-Token': token,
          'User-Agent': UA,
          'Content-Type': 'application/json',
        },
        /*
         * NAO SEGUE REDIRECIONAMENTO, e aqui o motivo e o segredo: esta e a
         * unica requisicao do modulo que carrega credencial. O `fetch` do Node
         * so tira o cabecalho `Authorization` ao mudar de origem — um cabecalho
         * proprio como `X-Cosmos-Token` e reenviado ao destino. Um 302 (por
         * erro de configuracao deles ou por comprometimento) entregaria o token
         * pago a quem estivesse do outro lado.
         */
        redirect: 'error',
        signal: AbortSignal.timeout(ESPERA_CONSULTA),
      });
      if (r.ok) {
        const d = await r.json() as { description?: string; brand?: { name?: string } };
        nomeNaBase = String(d?.description || '').trim();
        marca = String(d?.brand?.name || '').trim();
      }
      /*
       * FALHA NO CADASTRO NÃO CANCELA A FOTO. Token vencido, cota estourada ou
       * API fora do ar deixam a integração sem o nome — e ficar sem o nome é
       * pior que ficar sem a foto, mas não é motivo para não ter nenhum dos
       * dois. O que não pode é o erro aparecer como "produto não existe".
       */
    } catch {
      /* segue sem nome */
    }
  }

  return { url, urlPrevia: '', nomeNaBase, marca, credito: CREDITO_COSMOS, fonte: 'cosmos' };
};

/**
 * O candidato da Open Food Facts. `null` quando a base não tem o produto.
 *
 * NUNCA LANÇA por causa da rede: quem chama está no meio de um cadastro de
 * produto, e a base de terceiro fora do ar não pode derrubar a tela do lojista.
 */
export const candidatoOpenFoodFacts: Fonte = async (codigo, buscar, esperar) => {
  const cod = String(codigo || '').replace(/\D/g, '');
  if (cod.length < 8) return null;

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await buscar(
        `${API_OFF}/${cod}.json?fields=product_name,brands,image_front_url,image_url,image_front_small_url`,
        {
          headers: { 'User-Agent': UA },
          /* Resposta de terceiro nao escolhe para onde eu vou depois. */
          redirect: 'error',
          signal: AbortSignal.timeout(ESPERA_CONSULTA),
        },
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
        fonte: 'openfoodfacts',
      };
    } catch {
      await esperar(2000 * tentativa);
    }
  }
  return null;
};

/** A ordem que a medição justifica: packshot antes de foto de prateleira. */
export const FONTES: Fonte[] = [candidatoCosmos, candidatoOpenFoodFacts];

/**
 * Compatibilidade: a busca só na Open Food Facts, como era antes das duas
 * fontes. Continua exportada porque é ela que a suíte da Open Food Facts
 * exercita — as regras de 429, de `full` e de host não mudaram.
 */
export async function buscarFotoPorCodigo(
  codigo: string,
  buscar: typeof fetch = fetch,
  esperar: (ms: number) => Promise<unknown> = dormir,
): Promise<FotoSugerida | null> {
  return candidatoOpenFoodFacts(codigo, buscar, esperar, '');
}

/**
 * Baixa a imagem e converte para WebP com fundo achatado em branco. `null`
 * quando não dá.
 *
 * A validação de origem acontece AQUI TAMBÉM, e não só na busca: esta função é
 * exportada, e quem a chamar amanhã com uma URL vinda de outro lugar não pode
 * furar a lista de hosts por eu ter confiado no chamador.
 */
export async function baixarEConverter(
  url: string,
  buscar: typeof fetch = fetch,
): Promise<ImagemConvertida | null> {
  const r = await baixarComMotivo(url, buscar);
  return r.ok ? r.imagem : null;
}

/**
 * O MESMO DOWNLOAD, DIZENDO POR QUE NAO DEU — e a diferenca importa.
 *
 * "O CDN nao tem imagem para este codigo" e "a imagem que ele tem nao serve"
 * mandam a pessoa para lugares diferentes, e o endereco do Cosmos e montado
 * pelo codigo: nao existe consulta previa de "existe?", a resposta vem no
 * proprio download. Sem separar os dois, um 404 do CDN aparecia na tela como
 * "imagem imprestavel" — foi um teste que pegou isso, nao a leitura do codigo.
 */
export type MotivoDownload = 'nao-tem' | 'imprestavel';

export async function baixarComMotivo(
  url: string,
  buscar: typeof fetch = fetch,
): Promise<{ ok: true; imagem: ImagemConvertida } | { ok: false; motivo: MotivoDownload }> {
  if (!origemPermitida(url)) return { ok: false, motivo: 'imprestavel' };

  const r = await buscar(url, {
    headers: { 'User-Agent': UA },
    redirect: 'error',        /* redirecionamento sairia da lista de hosts */
    signal: AbortSignal.timeout(ESPERA_DOWNLOAD),
  });
  /* 404 e 410 sao resposta: a fonte nao tem esta imagem. */
  if (r.status === 404 || r.status === 410) return { ok: false, motivo: 'nao-tem' };
  if (!r.ok) return { ok: false, motivo: 'imprestavel' };

  /*
   * CABECALHO AUSENTE NAO E RECUSA — e isto derrubou a integracao inteira na
   * prova de ponta a ponta: MEDIDO no servidor, o CDN do Cosmos serve a imagem
   * com 200 e 1,4 MB e NENHUM `content-type`. Exigindo `image/`, todas as 49
   * fotos que ele tem viravam "imagem imprestavel", e a busca caia na Open Food
   * Facts — a fonte de foto de prateleira, exatamente o que era pra evitar.
   *
   * O que continua sendo recusado e o tipo DECLARADO e diferente de imagem
   * (`text/html`, `application/json`): ai o servidor disse o que mandou. Quando
   * ele nao diz nada, quem decide e o `sharp` na conversao — que decodifica de
   * verdade e lanca se nao for imagem. O cabecalho nunca foi a prova.
   */
  const tipo = String(r.headers.get('content-type') || '');
  if (tipo && !tipo.startsWith('image/')) return { ok: false, motivo: 'imprestavel' };

  /*
   * O TETO E CONFERIDO ANTES DE TRAZER O CORPO, quando o outro lado declara o
   * tamanho. Conferir so depois do `arrayBuffer()` e conferir com o arquivo JA
   * inteiro na memoria do processo — que e exatamente o que o teto existe para
   * evitar. O `content-length` e declaracao de terceiro e pode mentir, entao a
   * conferencia depois continua aqui embaixo: uma barra o caso honesto sem
   * custo, a outra barra a mentira.
   */
  const declarado = Number(r.headers.get('content-length') || 0);
  if (declarado > TAMANHO_MAX) return { ok: false, motivo: 'imprestavel' };

  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length || bytes.length > TAMANHO_MAX) return { ok: false, motivo: 'imprestavel' };

  /*
   * `image/...` no cabeçalho é o que o servidor DIZ. A conversão é que prova:
   * o `sharp` decodifica de verdade e lança se não for imagem. Confiar no
   * cabeçalho seria gravar no disco público o que o outro lado quiser chamar
   * de imagem.
   */
  const convertida = await paraWeb(bytes, tipo, { achatarEmBranco: true });
  if (!convertida) return { ok: false, motivo: 'imprestavel' };

  /* O 1x1 do registro de teste morre aqui. */
  const ladoMaior = Math.max(convertida.largura, convertida.altura);
  const area = convertida.largura * convertida.altura;
  if (ladoMaior < LADO_MAIOR_MIN || area < AREA_MIN) return { ok: false, motivo: 'imprestavel' };

  return { ok: true, imagem: convertida };
}

/** Por que não deu — a tela diz uma frase diferente para cada um. */
export type Motivo = 'codigo-curto' | 'nao-esta-na-base' | 'fundo-nao-branco' | 'imagem-imprestavel';

export interface Achado {
  fonte: NomeFonte;
  nomeNaBase: string;
  marca: string;
  credito: string;
  imagem: ImagemConvertida;
  fundo: Fundo;
  /** A miniatura em `data:`, para a tela mostrar sem nada ir para o disco. */
  previa: string;
}

export type Resultado =
  | { ok: true; achado: Achado }
  | { ok: false; motivo: Motivo; fonteTentada?: NomeFonte };

/**
 * ACHA UMA FOTO DE FUNDO BRANCO para o código — a porta de entrada do módulo.
 *
 * Percorre as fontes na ordem e devolve a PRIMEIRA que passa em tudo: baixou,
 * converteu, tem tamanho e tem fundo branco. Nada é gravado em disco: a prévia
 * volta embutida, e quem quiser guardar chama de novo e escreve o `buffer`.
 *
 * O MOTIVO DA RECUSA É O MELHOR DOS TENTADOS, e não o último: se o Cosmos tinha
 * a foto mas o fundo era de prateleira e a Open Food Facts não tinha o produto,
 * a resposta é "o fundo não é branco" — que é a informação útil. Dizer "não
 * está na base" mandaria a pessoa procurar um código errado que está certo.
 */
export async function acharFotoDeFundoBranco(codigo: string, deps: Deps = {}): Promise<Resultado> {
  const cod = String(codigo || '').replace(/\D/g, '');
  if (cod.length < 8) return { ok: false, motivo: 'codigo-curto' };

  const buscar = deps.buscar ?? fetch;
  const esperar = deps.esperar ?? dormir;
  const token = deps.tokenCosmos ?? process.env.COSMOS_TOKEN ?? '';
  const fontes = deps.fontes ?? FONTES;

  let motivo: Motivo = 'nao-esta-na-base';
  let fonteTentada: NomeFonte | undefined;
  /* Quanto mais adiante o candidato chegou, mais informativo é o motivo. */
  const peso: Record<Motivo, number> = {
    'codigo-curto': 0, 'nao-esta-na-base': 1, 'imagem-imprestavel': 2, 'fundo-nao-branco': 3,
  };
  const registrar = (m: Motivo, f: NomeFonte) => {
    if (peso[m] >= peso[motivo]) { motivo = m; fonteTentada = f; }
  };

  for (const fonte of fontes) {
    let candidato: FotoSugerida | null = null;
    try {
      candidato = await fonte(cod, buscar, esperar, token);
    } catch {
      candidato = null;         /* fonte fora do ar não derruba as outras */
    }
    if (!candidato) continue;

    let baixada: Awaited<ReturnType<typeof baixarComMotivo>>;
    try {
      baixada = await baixarComMotivo(candidato.url, buscar);
    } catch {
      /* conteúdo que não é imagem faz o `sharp` lançar, e isso é imprestável */
      baixada = { ok: false, motivo: 'imprestavel' };
    }
    if (!baixada.ok) {
      registrar(baixada.motivo === 'nao-tem' ? 'nao-esta-na-base' : 'imagem-imprestavel', candidato.fonte);
      continue;
    }
    const imagem = baixada.imagem;

    const fundo = await analisarFundo(imagem.buffer);
    if (!fundo) { registrar('imagem-imprestavel', candidato.fonte); continue; }
    if (!fundo.branco) { registrar('fundo-nao-branco', candidato.fonte); continue; }

    const pequena = await miniatura(imagem.buffer);
    return {
      ok: true,
      achado: {
        fonte: candidato.fonte,
        nomeNaBase: candidato.nomeNaBase,
        marca: candidato.marca,
        credito: candidato.credito,
        imagem,
        fundo,
        previa: `data:image/webp;base64,${pequena.toString('base64')}`,
      },
    };
  }

  return { ok: false, motivo, fonteTentada };
}
