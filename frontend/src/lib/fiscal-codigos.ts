/**
 * OS CÓDIGOS FISCAIS E O QUE CADA UM QUER DIZER, EM PORTUGUÊS.
 *
 * MORA AQUI porque são DUAS telas: a configuração fiscal da loja
 * (`fiscal.tsx`, onde se define o padrão) e o cadastro do produto
 * (`produtos.tsx`, onde se muda o caso específico). Enquanto as listas viviam
 * só na primeira, a segunda rotulava "CSOSN" para todo mundo — inclusive para
 * quem não é do Simples, onde o campo é CST. Mandar um CSOSN numa nota de
 * regime normal é rejeição na certa.
 *
 * As explicações existem pelo mesmo motivo que o resto: "5102" não diz nada a
 * quem cadastra um balde de whisky. "Venda de mercadoria dentro do estado" diz.
 */

/** CSOSN — situação tributária de quem é do Simples Nacional. */
export const CSOSNS = [
  { v: '102', l: '102 – Tributada sem permissão de crédito' },
  { v: '103', l: '103 – Isenção do ICMS no SN' },
  { v: '300', l: '300 – Imune' },
  { v: '400', l: '400 – Não tributada pelo SN' },
  { v: '500', l: '500 – ICMS cobrado anteriormente (ST/Monofásico)' },
  { v: '900', l: '900 – Outros' },
];

/**
 * CST do ICMS — o equivalente do CSOSN para quem NÃO é Simples Nacional.
 * O campo é o mesmo no banco; o que muda é o rótulo e a lista.
 */
export const CSTS = [
  { v: '00', l: '00 – Tributada integralmente' },
  { v: '20', l: '20 – Com redução de base de cálculo' },
  { v: '40', l: '40 – Isenta' },
  { v: '41', l: '41 – Não tributada' },
  { v: '60', l: '60 – ICMS cobrado anteriormente por ST' },
  { v: '90', l: '90 – Outras' },
];

/**
 * O REGIME VEM DO `crt` DA LOJA. 3 = regime normal; 1 e 2 são Simples.
 *
 * Uma função e não uma comparação solta em cada tela: escrever `crt !== 3` em
 * dois lugares é escrever a regra duas vezes, e duas escritas divergem.
 */
export function ehSimples(crt: number | null | undefined): boolean {
  return Number(crt) !== 3;
}

/** "CSOSN" ou "CST do ICMS", conforme o regime. */
export function rotuloSituacao(simples: boolean): string {
  return simples ? 'CSOSN' : 'CST do ICMS';
}

/** A lista de situações válidas para o regime. */
export function situacoesDoRegime(simples: boolean) {
  return simples ? CSOSNS : CSTS;
}

/**
 * A LINHA EM PORTUGUÊS DE CADA CAMPO.
 *
 * Alguns dependem do VALOR (5102 e 5405 são coisas diferentes), outros são
 * fixos. Valor que não está na tabela cai numa frase genérica em vez de sumir:
 * campo sem explicação nenhuma é o estado de hoje, e é o que se quer resolver.
 */
const CFOPS: Record<string, string> = {
  '5101': 'Venda de produção do estabelecimento, dentro do estado.',
  '5102': 'Venda de mercadoria dentro do estado.',
  '5405': 'Venda de mercadoria com ICMS já retido por substituição tributária.',
  '5933': 'Prestação de serviço sujeita ao ISS.',
  '6102': 'Venda de mercadoria para FORA do estado.',
};

const ORIGENS: Record<string, string> = {
  '0': '0 = nacional. Usado no grupo de ICMS da nota.',
  '1': '1 = estrangeira, importação direta.',
  '2': '2 = estrangeira, comprada no mercado interno.',
};

export function explicacaoFiscal(campo: string, valor: string, simples: boolean): string {
  const v = (valor || '').trim();
  switch (campo) {
    case 'NCM':
      return v
        ? 'Classificação da mercadoria na tabela NCM (8 dígitos).'
        : 'Em branco, vale o padrão da loja.';
    case 'CFOP':
      return CFOPS[v] || 'Natureza da operação. O padrão da loja cobre a venda comum.';
    case 'CSOSN': {
      const achado = situacoesDoRegime(simples).find(c => c.v === v);
      if (achado) return achado.l.split('– ')[1] || achado.l;
      return simples
        ? 'Situação tributária do Simples Nacional.'
        : 'Situação tributária do ICMS (regime normal).';
    }
    case 'Origem':
      return ORIGENS[v] || 'De onde vem a mercadoria. 0 = nacional.';
    case 'Unidade':
      return 'Até 6 caracteres. Vai como unidade comercial na nota.';
    case 'CEST':
      return 'Só para produto sujeito à substituição tributária.';
    default:
      return '';
  }
}
