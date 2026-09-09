/**
 * MONTAR O CARDÁPIO A PARTIR DE UMA DESCRIÇÃO EM TEXTO.
 *
 * O lojista escreve como fala — "vendo pizza grande de calabresa a 65, média a
 * 45, refri 2 litros 12, borda de catupiry mais 8" — e isto devolve uma
 * PROPOSTA de categorias, produtos, complementos e preços para ele revisar.
 *
 * Por que existe: hoje o único jeito rápido de povoar um cardápio é importar do
 * iFood, o que só serve para quem JÁ está no iFood. Quem está começando digita
 * item por item, e é aí que desiste do cadastro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DUAS REGRAS QUE NÃO SE NEGOCIAM
 *
 * 1. ISTO NÃO ESCREVE NADA. Devolve proposta; quem grava é o lojista, depois de
 *    ver. Cardápio é preço, e preço é dinheiro — um modelo criando produto
 *    direto no ar é um jeito de vender comida pelo valor errado.
 *
 * 2. PREÇO NUNCA É INVENTADO. Se a descrição não disse quanto custa, o produto
 *    volta com preço NULO e marcado, e a tela exige preencher antes de criar.
 *    Um preço plausível chutado pelo modelo é pior que preço nenhum: passa
 *    despercebido e vira venda no prejuízo. Preço nenhum grita.
 * ─────────────────────────────────────────────────────────────────────────
 */
import Anthropic from '@anthropic-ai/sdk';

const MODELO = process.env.CARDAPIO_MODELO || process.env.SUPORTE_MODELO || 'claude-opus-5';

/* Cardápio grande é normal (pizzaria tem 40 sabores), mas há um limite além do
   qual a resposta deixou de ser cardápio e virou alucinação em série. */
const MAX_TOKENS = 8000;
const MAX_PRODUTOS = 120;
const MAX_GRUPOS_POR_PRODUTO = 8;
const MAX_OPCOES_POR_GRUPO = 60;

export class SemChaveIA extends Error {}

export interface OpcaoProposta {
  nome: string;
  /** Acréscimo em centavos. Zero é legítimo (sabor que não muda o preço). */
  precoCentavos: number;
}

export interface GrupoProposto {
  nome: string;
  obrigatorio: boolean;
  min: number;
  max: number;
  opcoes: OpcaoProposta[];
}

export interface ProdutoProposto {
  nome: string;
  descricao: string;
  categoria: string;
  /** NULO quando a descrição não disse o preço. Nunca chutado. */
  precoCentavos: number | null;
  grupos: GrupoProposto[];
}

export interface PropostaCardapio {
  produtos: ProdutoProposto[];
  /** Categorias na ordem em que devem aparecer. */
  categorias: string[];
  /** Nomes dos produtos que voltaram sem preço — a tela precisa cobrar. */
  semPreco: string[];
  /** O que foi descartado na validação, para a tela poder dizer. */
  descartados: string[];
}

const INSTRUCOES = `Você monta cardápio de restaurante a partir da descrição do próprio dono.

DEVOLVA SOMENTE JSON, sem texto antes ou depois, neste formato:

{
  "categorias": ["Pizzas", "Bebidas"],
  "produtos": [
    {
      "nome": "Pizza Calabresa Grande",
      "descricao": "Molho, mussarela, calabresa e cebola",
      "categoria": "Pizzas",
      "precoCentavos": 6500,
      "grupos": [
        {
          "nome": "Borda recheada",
          "obrigatorio": false,
          "min": 0,
          "max": 1,
          "opcoes": [{ "nome": "Catupiry", "precoCentavos": 800 }]
        }
      ]
    }
  ]
}

REGRAS:

1. PREÇO SÓ SE A PESSOA DISSE. Se a descrição não traz o preço de um item, use
   "precoCentavos": null. NUNCA estime, nunca use preço de mercado, nunca copie
   o preço de um item parecido. Preço errado que parece certo causa prejuízo
   silencioso; preço nulo é corrigido em dois segundos.

2. Preço em CENTAVOS, inteiro. "45" e "45,00" e "R$ 45" são 4500.

3. Não invente item que a pessoa não mencionou, mesmo que seja óbvio para o
   segmento. Cardápio é decisão do dono.

4. Descrição só se der para deduzir do que foi dito, ou os ingredientes usuais
   do prato citado. Nunca prometa origem, selo ou qualidade ("artesanal",
   "importado", "orgânico") que a pessoa não afirmou.

5. Complemento (grupo) só quando a pessoa mencionar escolha ou acréscimo. Marque
   "obrigatorio": true apenas quando a escolha for necessária para o item existir
   (o sabor de uma pizza de 2 sabores), não quando for só comum.

6. Agrupe em categorias curtas e reconhecíveis. Se a pessoa citou categorias,
   use as dela, com as palavras dela.

7. Se a descrição estiver vaga demais para virar cardápio, devolva
   {"categorias":[],"produtos":[]} em vez de preencher com suposição.`;

let cliente: Anthropic | null = null;
function obterCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SemChaveIA(
      'O montador de cardápio por IA não está configurado: falta ANTHROPIC_API_KEY no .env do servidor.');
  }
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/**
 * Centavos a partir do que o modelo mandou.
 *
 * Devolve `null` para qualquer coisa que não seja um inteiro positivo — e é de
 * propósito que `0`, `"45"`, `45.5` e `"quarenta"` todos caiam em null: preço
 * que não é número exato em centavos é preço que ninguém conferiu, e o certo é
 * cobrar do humano em vez de arredondar por conta própria.
 */
export function centavosOuNulo(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
  if (v > 100_000_00) return null;   // R$ 100 mil num item é erro, não preço
  return v;
}

/** Acréscimo de opção: zero É válido aqui (sabor que não muda o preço). */
export function acrescimoCentavos(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return 0;
  return Math.min(v, 100_000_00);
}

function lerGrupo(bruto: unknown): GrupoProposto | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const g = bruto as Record<string, unknown>;
  const nome = texto(g.nome, 80);
  if (!nome) return null;

  const opcoesBrutas = Array.isArray(g.opcoes) ? g.opcoes.slice(0, MAX_OPCOES_POR_GRUPO) : [];
  const opcoes: OpcaoProposta[] = [];
  for (const o of opcoesBrutas) {
    if (!o || typeof o !== 'object') continue;
    const oo = o as Record<string, unknown>;
    const nomeOpcao = texto(oo.nome, 80);
    if (!nomeOpcao) continue;
    opcoes.push({ nome: nomeOpcao, precoCentavos: acrescimoCentavos(oo.precoCentavos) });
  }
  /* Grupo sem opção não é escolha, é enfeite — e na tela viraria um bloco vazio
     que o lojista não sabe se deve preencher ou apagar. */
  if (opcoes.length === 0) return null;

  const obrigatorio = g.obrigatorio === true;
  /*
   * MIN E MAX SÃO CORRIGIDOS, não confiados. Modelo devolve `min: 2, max: 1`
   * com naturalidade, e isso na tela do cliente é um grupo impossível de
   * satisfazer: ele nunca consegue fechar o pedido.
   */
  let min = Number.isInteger(g.min) ? Math.max(0, g.min as number) : (obrigatorio ? 1 : 0);
  let max = Number.isInteger(g.max) ? Math.max(1, g.max as number) : 1;
  min = Math.min(min, opcoes.length);
  max = Math.min(Math.max(max, min || 1), opcoes.length);
  if (obrigatorio && min === 0) min = 1;

  return { nome, obrigatorio, min, max, opcoes };
}

/**
 * Transforma a resposta do modelo em proposta, descartando o que não serve.
 *
 * Nada aqui confia no formato: modelo devolve campo faltando, tipo trocado,
 * texto onde era número e JSON embrulhado em explicação. Validar é o trabalho.
 */
export function interpretar(respostaBruta: string): PropostaCardapio {
  const vazia: PropostaCardapio = { produtos: [], categorias: [], semPreco: [], descartados: [] };

  /*
   * O JSON pode vir cercado de texto ou em bloco de código, mesmo pedindo que
   * não venha. Pega do primeiro `{` ao último `}` em vez de exigir pureza.
   */
  const i = respostaBruta.indexOf('{');
  const f = respostaBruta.lastIndexOf('}');
  if (i === -1 || f <= i) return vazia;

  let cru: unknown;
  try { cru = JSON.parse(respostaBruta.slice(i, f + 1)); } catch { return vazia; }
  if (!cru || typeof cru !== 'object') return vazia;

  const raiz = cru as Record<string, unknown>;
  const produtosBrutos = Array.isArray(raiz.produtos) ? raiz.produtos : [];

  const produtos: ProdutoProposto[] = [];
  const semPreco: string[] = [];
  const descartados: string[] = [];
  const vistos = new Set<string>();

  for (const bruto of produtosBrutos.slice(0, MAX_PRODUTOS)) {
    if (!bruto || typeof bruto !== 'object') { descartados.push('item sem formato'); continue; }
    const p = bruto as Record<string, unknown>;

    const nome = texto(p.nome, 120);
    if (!nome) { descartados.push('produto sem nome'); continue; }

    /* Nome repetido viraria dois produtos iguais no cardápio, e o cliente não
       saberia qual escolher. O primeiro fica. */
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) { descartados.push(`${nome} (repetido)`); continue; }
    vistos.add(chave);

    const precoCentavos = centavosOuNulo(p.precoCentavos);


    if (precoCentavos === null) semPreco.push(nome);

    const gruposBrutos = Array.isArray(p.grupos) ? p.grupos.slice(0, MAX_GRUPOS_POR_PRODUTO) : [];
    const grupos: GrupoProposto[] = [];
    for (const g of gruposBrutos) {
      const grupo = lerGrupo(g);
      if (grupo) grupos.push(grupo);
    }

    produtos.push({
      nome,
      descricao: texto(p.descricao, 400),
      categoria: texto(p.categoria, 120) || 'Geral',
      precoCentavos,
      grupos,
    });
  }

  /*
   * CATEGORIAS SAEM DOS PRODUTOS, não da lista que o modelo mandou.
   *
   * Ele lista categorias que depois não usa, e usa categorias que não listou.
   * A lista dele serve só para ORDENAR: o que existe é o que tem produto.
   */
  const usadas = [...new Set(produtos.map(p => p.categoria))];
  const ordemSugerida = (Array.isArray(raiz.categorias) ? raiz.categorias : [])
    .map(c => texto(c, 120))
    .filter(Boolean);
  const categorias = [
    ...ordemSugerida.filter(c => usadas.includes(c)),
    ...usadas.filter(c => !ordemSugerida.includes(c)),
  ];

  return { produtos, categorias, semPreco, descartados };
}

/** Pede a proposta ao modelo. Não escreve nada no banco. */
export async function sugerirCardapio(
  descricao: string,
  categoriasExistentes: readonly string[] = [],
): Promise<PropostaCardapio & { modelo: string }> {
  const pedido = descricao.trim();
  if (pedido.length < 10) {
    throw new Error('Descreva o que a loja vende com um pouco mais de detalhe.');
  }

  const cli = obterCliente();
  const r = await cli.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    /* Adaptativo: "pizza e refri" é trivial, e um cardápio de trinta itens com
       tamanhos e bordas exige separar produto de complemento com cuidado. */
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      {
        /* Idêntico em toda chamada — cacheado. */
        type: 'text', text: INSTRUCOES, cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: categoriasExistentes.length
          /* As categorias que já existem vão no pedido para o modelo REUSAR os
             nomes do lojista em vez de criar "Bebidas" ao lado de "Beb." */
          ? `CATEGORIAS QUE JÁ EXISTEM NESTA LOJA (reuse quando couber): ${categoriasExistentes.join(', ')}\n\n---\n\nO QUE A LOJA VENDE:\n${pedido}`
          : `O QUE A LOJA VENDE:\n${pedido}`,
      },
    ],
  });

  const bruto = r.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  return { ...interpretar(bruto), modelo: MODELO };
}
