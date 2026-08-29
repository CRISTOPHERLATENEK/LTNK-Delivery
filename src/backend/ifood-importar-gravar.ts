/**
 * GRAVA O CARDÁPIO IMPORTADO.
 *
 * A partir daqui o cardápio do lojista muda. As decisões que não são óbvias
 * estão escritas com o motivo, porque desfazer uma importação errada é trabalho
 * manual, produto por produto.
 */
import type { ProdutoImportado, GrupoImportado } from './ifood-importar';

export interface DepsImportar {
  /** Produtos que já existem, indexados pelo código de barras. */
  produtosPorCodigo: (lojaId: number) => Promise<Map<string, number>>;
  criarProduto: (lojaId: number, p: ProdutoParaGravar) => Promise<number>;
  criarGrupo: (produtoId: number, g: GrupoImportado, ordem: number) => Promise<number>;
  criarOpcao: (grupoId: number, o: GrupoImportado['opcoes'][number], ordem: number) => Promise<void>;
  registrar?: (nivel: 'info' | 'erro', mensagem: string) => void;
}

export interface ProdutoParaGravar {
  nome: string;
  descricao: string;
  categoria: string;
  codigoBarras: string;
  precoCentavos: number;
  disponivel: boolean;
}

export interface ResultadoImportacao {
  criados: number;
  pulados: number;
  falhas: string[];
  /** Produtos criados sem preço — o lojista precisa preencher antes de vender. */
  semPreco: string[];
}

/**
 * O PREÇO NASCE ZERADO, E O PRODUTO NASCE PAUSADO.
 *
 * As duas coisas juntas, e é deliberado: um produto com preço zero à venda no
 * cardápio é um produto que o cliente compra de graça. Zerar o preço sem pausar
 * seria trocar um problema (margem errada) por outro pior (prejuízo direto).
 *
 * O lojista define o preço e liga — e é exatamente esse gesto que faz ele olhar
 * o valor em vez de herdar o do iFood, que embute a comissão.
 */
export const PRECO_INICIAL_CENTAVOS = 0;

export async function importarCardapio(
  lojaId: number,
  produtos: readonly ProdutoImportado[],
  categoriaPadrao: string,
  deps: DepsImportar,
): Promise<ResultadoImportacao> {
  const log = deps.registrar ?? (() => {});
  const r: ResultadoImportacao = { criados: 0, pulados: 0, falhas: [], semPreco: [] };

  const existentes = await deps.produtosPorCodigo(lojaId);

  for (const p of produtos) {
    if (!p.nome) { r.pulados++; continue; }

    /*
     * A checagem é refeita AQUI, mesmo já tendo sido feita no plano.
     *
     * Entre a prévia e a confirmação o lojista pode ter cadastrado o produto na
     * mão, ou clicado duas vezes no botão. O plano serve para ele decidir; esta
     * checagem serve para não duplicar.
     */
    if (p.codigoExterno && existentes.has(p.codigoExterno)) {
      r.pulados++;
      continue;
    }

    try {
      const produtoId = await deps.criarProduto(lojaId, {
        nome: p.nome,
        descricao: p.descricao,
        categoria: categoriaPadrao,
        codigoBarras: p.codigoExterno,
        precoCentavos: PRECO_INICIAL_CENTAVOS,
        /*
         * Nasce PAUSADO mesmo que esteja à venda no iFood. Ver
         * PRECO_INICIAL_CENTAVOS: sem preço, publicar é dar comida de graça.
         */
        disponivel: false,
      });

      /* Registra o código já criado: dois itens do iFood com o mesmo código não
         podem virar dois produtos aqui. */
      if (p.codigoExterno) existentes.set(p.codigoExterno, produtoId);

      let ordem = 0;
      for (const g of p.grupos) {
        try {
          const grupoId = await deps.criarGrupo(produtoId, g, ordem++);
          let ordemOpcao = 0;
          for (const o of g.opcoes) await deps.criarOpcao(grupoId, o, ordemOpcao++);
        } catch (e) {
          /*
           * Grupo que falha NÃO desfaz o produto. O produto sem um complemento
           * é um produto incompleto que o lojista corrige em dois cliques;
           * desfazer tudo obrigaria a reimportar e correr o risco de duplicar.
           */
          r.falhas.push(`${p.nome} / grupo "${g.nome}": ${(e as Error).message}`);
        }
      }

      r.criados++;
      r.semPreco.push(p.nome);
    } catch (e) {
      r.falhas.push(`${p.nome}: ${(e as Error).message}`);
    }
  }

  if (r.falhas.length) log('erro', `[ifood] importação com ${r.falhas.length} falha(s)`);
  log('info', `[ifood] importados ${r.criados} produto(s), ${r.pulados} pulado(s)`);
  return r;
}

/**
 * O grupo do iFood traduzido para o nosso cadastro.
 *
 * `min > 0` vira obrigatório: lá o mínimo é um número, aqui é um interruptor.
 * Perder essa informação faria um grupo obrigatório entrar como opcional, e o
 * cliente fecharia o pedido sem escolher o que a loja exige.
 */
export function grupoParaNosso(g: GrupoImportado): {
  tipo: 'unico' | 'multiplo'; obrigatorio: boolean; maxEscolhas: number;
} {
  return {
    /* `max > 1` é múltipla escolha. Igualar tudo a 'unico' faria o cliente não
       conseguir pedir dois adicionais num grupo que aceita dois. */
    tipo: g.max > 1 ? 'multiplo' : 'unico',
    obrigatorio: g.min > 0,
    maxEscolhas: Math.max(1, g.max),
  };
}
