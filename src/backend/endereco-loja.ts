/**
 * ENDEREÇO DA LOJA — as partes, e o texto que sai delas.
 *
 * O endereço da loja vive em DOIS lugares, e por motivos diferentes:
 *
 *  - `lojas.endereco`, texto livre: é o que vai pro geocoder e pro cálculo de
 *    distância de entrega.
 *  - `lojas.nfce_logradouro/numero/bairro/cep/municipio/cmun/uf`, estruturado:
 *    é o que a SEFAZ exige na nota. Campo separado, sem exceção.
 *
 * Antes, o cadastro de cliente pedia UM campo de texto livre no passo
 * "Endereço" e, dois passos depois, pedia o endereço INTEIRO outra vez em
 * pedaços no passo "Fiscal". Duas digitações do mesmo dado, e nada garantindo
 * que combinassem — o endereço do mapa podia divergir do endereço da nota, o
 * que só aparece quando a nota é recusada ou a entrega vai pro lugar errado.
 *
 * Agora as partes são coletadas uma vez, e daqui saem os dois formatos.
 */

/** As partes que o cadastro coleta. Tudo opcional: dá pra completar depois. */
export interface PartesEndereco {
  cep?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  /** Código IBGE do município (cMun da NFC-e). O ViaCEP devolve em `ibge`. */
  cmun?: string;
}

const limpo = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/** Só os dígitos do CEP. */
export function cepDigitos(cep: unknown): string {
  return typeof cep === 'string' ? cep.replace(/\D/g, '').slice(0, 8) : '';
}

/** Lê as partes do corpo da requisição, sem confiar em nada. */
export function lerPartes(corpo: Record<string, unknown>): PartesEndereco {
  return {
    cep: cepDigitos(corpo.cep),
    rua: limpo(corpo.rua, 120),
    numero: limpo(corpo.numero, 20),
    complemento: limpo(corpo.complemento, 60),
    bairro: limpo(corpo.bairro, 80),
    cidade: limpo(corpo.cidade, 80),
    uf: limpo(corpo.uf, 2).toUpperCase(),
    /* Tira a pontuação ANTES de cortar em 7: cortando primeiro, '42-09.102'
       virava '42091' — um cMun de cinco dígitos, que rejeita a nota. */
    cmun: (typeof corpo.cmun === 'string' ? corpo.cmun : '').replace(/\D/g, '').slice(0, 7),
  };
}

/**
 * Monta o texto do endereço a partir das partes.
 *
 * O FORMATO IMPORTA porque o destino é um geocoder: "Rua X, 123 - Bairro,
 * Cidade - UF" é a forma que o Nominatim entende melhor em endereço
 * brasileiro. E cada pedaço ausente tem que desaparecer junto com sua
 * pontuação — "Rua X, - , Cidade - " é pior que uma string curta, porque o
 * geocoder tenta casar a vírgula solta e devolve coordenada errada em vez de
 * nenhuma.
 *
 * O COMPLEMENTO FICA FORA. Ele não ajuda o geocoder a achar a rua ("Apto 42"
 * não é lugar no mapa) e atrapalha: entra como termo de busca e piora o
 * casamento. Ele é guardado nas partes e usado onde serve — na nota e na tela.
 */
export function montarEnderecoTexto(p: PartesEndereco): string {
  const rua = (p.rua || '').trim();
  const numero = (p.numero || '').trim();
  const bairro = (p.bairro || '').trim();
  const cidade = (p.cidade || '').trim();
  const uf = (p.uf || '').trim().toUpperCase();

  const logradouro = [rua, numero].filter(Boolean).join(', ');
  const local = [bairro, cidade].filter(Boolean).join(', ');
  const comUf = [local, uf].filter(Boolean).join(' - ');

  return [logradouro, comUf].filter(Boolean).join(' - ');
}

/** Há alguma parte preenchida? Vazio significa "deixa pra depois". */
export function temAlgumaParte(p: PartesEndereco): boolean {
  return !!(p.cep || p.rua || p.numero || p.bairro || p.cidade || p.uf);
}

/**
 * O que semear nos campos FISCAIS a partir das partes.
 *
 * SÓ PREENCHE O QUE ESTÁ VAZIO. O endereço fiscal, quando existe, veio do
 * CNPJ na Receita Federal — que é a fonte oficial e pode divergir do endereço
 * de entrega de propósito (matriz cadastrada num lugar, operação em outro).
 * Sobrescrever com o que foi digitado no passo de entrega trocaria o dado
 * oficial pelo aproximado, e o erro apareceria numa nota recusada.
 *
 * Devolve pares coluna→valor prontos para o UPDATE, já sem os vazios.
 */
export function semearFiscal(
  p: PartesEndereco,
  atual: Record<string, string | null>,
): Record<string, string> {
  const de: Array<[string, string]> = [
    ['nfce_cep', p.cep || ''],
    ['nfce_logradouro', p.rua || ''],
    ['nfce_numero', p.numero || ''],
    ['nfce_bairro', p.bairro || ''],
    ['nfce_municipio', p.cidade || ''],
    ['nfce_uf', p.uf || ''],
    ['nfce_cmun', p.cmun || ''],
  ];

  const semear: Record<string, string> = {};
  for (const [coluna, valor] of de) {
    if (!valor) continue;                              // nada a semear
    if ((atual[coluna] || '').trim()) continue;        // já preenchido: não toca

    semear[coluna] = valor;
  }
  return semear;
}
