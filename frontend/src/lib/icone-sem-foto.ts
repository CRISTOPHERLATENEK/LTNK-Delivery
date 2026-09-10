/**
 * O QUE APARECE NO LUGAR DA FOTO QUE NÃO EXISTE.
 *
 * A vitrine mostrava um GARFO E FACA CRUZADOS para todo produto sem foto. Num
 * cardápio de restaurante passa; numa conveniência de bebidas, 51 dos 62 itens
 * à venda apareciam com cutelaria — cerveja, energético e vinho ilustrados com
 * talher. Fica pior que o vazio: parece cardápio de outra loja.
 *
 * NÃO SUBSTITUI A FOTO. Foto de produto vende, e nenhum ícone faz esse
 * trabalho. Isto existe para o intervalo entre "a loja abriu" e "o lojista
 * fotografou a prateleira" não ser feio — e para o item ao menos dizer o que é.
 *
 * A ESCOLHA VEM DA CATEGORIA, e cai para o NOME do produto quando a categoria
 * não decide. As duas coisas são texto livre que o lojista escreve, então a
 * comparação é por palavra contida, sem acento e sem caixa — a mesma regra que
 * `categoria-por-nome.ts` usa no servidor para classificar o cardápio
 * importado.
 *
 * A ORDEM DAS REGRAS IMPORTA e é do mais específico para o mais genérico:
 * "cerveja sem álcool" tem que dar cerveja, não bebida; "água tônica" tem que
 * dar água, não tônico. Regra nova entra no lugar certo, não no fim.
 */
import {
  Beer, Wine, Martini, CupSoda, Coffee, Milk, Cigarette, Popcorn, Candy,
  IceCream, Snowflake, GlassWater, Wheat, Package, Zap, type LucideIcon,
} from 'lucide-react';

/** Sem acento, sem caixa, com espaços nas pontas — para comparar por conteúdo. */
function normalizar(texto: string): string {
  return ' ' + texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

interface Regra { palavras: string[]; Icone: LucideIcon }

const REGRAS: Regra[] = [
  /* Bebida alcoólica — o que uma adega/conveniência mais vende. */
  { palavras: ['cerveja', 'chopp', 'chope', 'lager', 'ipa', 'pilsen', 'brahma', 'skol', 'antarctica', 'amstel', 'heineken', 'budweiser', 'stella', 'itaipava', 'burguesa', 'petra', 'original'], Icone: Beer },
  { palavras: ['vinho', 'espumante', 'prosecco', 'champanhe', 'champagne', 'frisante', 'sangria'], Icone: Wine },
  { palavras: ['whisky', 'whiskey', 'vodka', 'gin', 'cachaca', 'pinga', 'rum', 'tequila', 'conhaque', 'licor', 'aperitivo', 'destilado', 'catuaba', 'saque', 'absinto'], Icone: Martini },

  /* Sem álcool. Água vem ANTES de refrigerante porque "água tônica" tem as duas
     pistas, e a primeira regra que casa é a que vale. */
  { palavras: ['agua', 'mineral', 'gas'], Icone: GlassWater },
  /* Raio, e não lata: `Package` é o padrão de "não reconheci", então energético
     com `Package` ficaria indistinguível de item desconhecido. */
  { palavras: ['energetico', 'red bull', 'monster', 'baly', 'fusion', 'tnt'], Icone: Zap },
  { palavras: ['refrigerante', 'coca', 'guarana', 'pepsi', 'sprite', 'fanta', 'soda', 'tonica', 'refresco', 'suco', 'nectar', 'isotonico', 'gatorade'], Icone: CupSoda },
  { palavras: ['cafe', 'cappuccino', 'expresso'], Icone: Coffee },
  { palavras: ['leite', 'iogurte', 'achocolatado', 'lacteo'], Icone: Milk },

  /* Tabacaria — a Galderio é conveniência com tabacaria. */
  { palavras: ['cigarro', 'tabaco', 'fumo', 'seda', 'isqueiro', 'narguile', 'essencia', 'carvao'], Icone: Cigarette },

  /* Mercearia e conveniência. */
  { palavras: ['gelo'], Icone: Snowflake },
  { palavras: ['salgadinho', 'batata', 'amendoim', 'pipoca', 'snack', 'petisco', 'castanha'], Icone: Popcorn },
  { palavras: ['chocolate', 'bala', 'doce', 'chiclete', 'pirulito', 'bombom'], Icone: Candy },
  { palavras: ['sorvete', 'acai', 'picole', 'gelato'], Icone: IceCream },
  { palavras: ['pao', 'biscoito', 'bolacha', 'torrada', 'cereal'], Icone: Wheat },
];

/*
 * O PADRÃO É UMA CAIXA, e não talher.
 *
 * `Package` descreve honestamente o que o sistema sabe: um item à venda cuja
 * natureza ele não reconheceu. Talher AFIRMA que é comida — e afirmar errado é
 * pior que não afirmar.
 */
const PADRAO: LucideIcon = Package;

/**
 * O ícone para um produto sem foto.
 *
 * A categoria decide primeiro porque é a informação mais confiável: ela foi
 * escolhida (ou classificada) para agrupar, enquanto o nome pode conter
 * qualquer coisa — "Kit Presente Cerveja + Taça" tem duas pistas em conflito.
 */
export function iconeSemFoto(categoria?: string | null, nomeProduto?: string | null): LucideIcon {
  for (const fonte of [categoria, nomeProduto]) {
    if (!fonte) continue;
    const t = normalizar(String(fonte));
    for (const r of REGRAS) {
      if (r.palavras.some(p => t.includes(' ' + p) || t.includes(p + ' '))) return r.Icone;
    }
  }
  return PADRAO;
}
