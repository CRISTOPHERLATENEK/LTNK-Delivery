/**
 * SINCRONIZAÇÃO CONTÍNUA: IFOOD → AQUI.
 *
 * A importação é um evento; isto é um regime. O lojista que liga a
 * sincronização está dizendo "o cardápio de verdade é o do iFood" — e a partir
 * daí o que ele mudar aqui será desfeito. Por isso a direção é uma escolha por
 * loja, e uma só de cada vez: com os dois lados podendo alterar, um preço
 * mudado aqui seria sobrescrito minutos depois, o lojista mudaria de novo, e
 * ninguém entenderia quem está ganhando.
 *
 * TRÊS COISAS ESTA SINCRONIZAÇÃO NÃO FAZ, e nenhuma é esquecimento:
 *
 * 1. NÃO MEXE EM PREÇO. Nem do produto, nem do complemento. O preço do iFood
 *    embute a comissão que no link próprio do lojista não existe; trazê-lo
 *    faria quem compra direto pagar por algo que ali não tem. Foi por isso que
 *    a importação já nasce sem preço, e num regime contínuo não dá para
 *    resolver com "o lojista corrige depois" — a cada ciclo voltaria.
 *
 * 2. NÃO APAGA NADA. Produto que sumiu de lá, grupo removido, opção excluída:
 *    tudo vira relatório, não DELETE. Sincronização roda sozinha, e apagar
 *    sozinho o cardápio de uma loja por causa de uma resposta estranha da API é
 *    um estrago que ninguém desfaz no domingo à noite.
 *
 * 3. NÃO COLOCA PRODUTO À VENDA SEM PREÇO. Produto importado nasce a 1 centavo
 *    (o CHECK da coluna não aceita zero). Se a sincronização copiasse o
 *    "disponível" do iFood, ela publicaria um lanche a R$ 0,01 no primeiro
 *    ciclo. Pausar ela pode — pausar é reversível e é o sinal de "acabou o
 *    estoque", que é justamente o que vale a pena sincronizar.
 */
import type { ProdutoImportado, GrupoImportado } from './ifood-importar';

/** O produto como ele existe AQUI, no formato mínimo que o plano precisa. */
export interface ProdutoNosso {
  id: number;
  nome: string;
  descricao: string;
  codigoBarras: string;
  precoCentavos: number;
  disponivel: boolean;
  grupos: Array<{ id: number; nome: string; opcoes: Array<{ id: number; nome: string }> }>;
}

/**
 * Abaixo ou igual a isto, o produto nunca teve preço de verdade.
 *
 * A importação grava 1 centavo porque o CHECK da coluna exige > 0. É o valor
 * que grita "me preencha" — e é o que distingue "o lojista ainda não precificou"
 * de "o lojista decidiu que custa isso".
 */
export const PRECO_NAO_DEFINIDO_CENTAVOS = 1;

export interface AlteracaoProduto {
  id: number;
  nome: string;
  campos: { nome?: string; descricao?: string; disponivel?: boolean };
}

export interface PlanoSincronizacao {
  /** Existem no iFood e não aqui: entram como a importação faria. */
  criar: ProdutoImportado[];
  atualizar: AlteracaoProduto[];
  /** Grupos que existem lá e não aqui, por produto nosso. */
  gruposNovos: Array<{ produtoId: number; produtoNome: string; grupo: GrupoImportado }>;
  /** Opções novas dentro de grupos que já existem. */
  opcoesNovas: Array<{ grupoId: number; produtoNome: string; grupoNome: string; opcao: GrupoImportado['opcoes'][number] }>;
  /** Sumiram de lá. Só relatório — ver decisão 2. */
  sumiramDoIfood: string[];
  /** Estão à venda no iFood mas continuam pausados aqui por falta de preço. */
  travadosSemPreco: string[];
  /** Não têm código no iFood: não dá para saber se são o mesmo produto. */
  semCodigo: number;
}

const limpo = (s: string) => s.trim();

/**
 * O que mudar para o nosso cardápio refletir o de lá.
 *
 * Função pura: recebe os dois lados e devolve o plano. A gravação é outra
 * história — e é assim de propósito, porque o que precisa ser provado aqui são
 * as REGRAS (não mexer em preço, não apagar, não publicar sem preço), e nenhuma
 * delas se prova esperando o banco colaborar.
 */
export function planejarSincronizacao(
  doIfood: readonly ProdutoImportado[],
  nossos: readonly ProdutoNosso[],
): PlanoSincronizacao {
  const plano: PlanoSincronizacao = {
    criar: [], atualizar: [], gruposNovos: [], opcoesNovas: [],
    sumiramDoIfood: [], travadosSemPreco: [], semCodigo: 0,
  };

  const nossosPorCodigo = new Map<string, ProdutoNosso>();
  for (const p of nossos) {
    const c = limpo(p.codigoBarras);
    if (c) nossosPorCodigo.set(c, p);
  }

  const vistos = new Set<string>();

  for (const item of doIfood) {
    const codigo = limpo(item.codigoExterno);
    if (!codigo) {
      /* Sem código não há como saber se é o mesmo produto: casar por nome
         renomearia o produto errado no primeiro nome parecido. */
      plano.semCodigo++;
      continue;
    }
    vistos.add(codigo);

    const nosso = nossosPorCodigo.get(codigo);
    if (!nosso) { plano.criar.push(item); continue; }

    const campos: AlteracaoProduto['campos'] = {};
    if (limpo(item.nome) && limpo(item.nome) !== limpo(nosso.nome)) campos.nome = limpo(item.nome);
    if (limpo(item.descricao) !== limpo(nosso.descricao)) campos.descricao = limpo(item.descricao);

    /*
     * DISPONIBILIDADE: pausar sempre pode; despausar só com preço de verdade.
     * Sem esta guarda, o produto recém-importado a R$ 0,01 iria para o ar no
     * primeiro ciclo — e ninguém percebe um preço errado tão rápido quanto o
     * cliente que aproveita.
     */
    if (!item.disponivel && nosso.disponivel) {
      campos.disponivel = false;
    } else if (item.disponivel && !nosso.disponivel) {
      if (nosso.precoCentavos > PRECO_NAO_DEFINIDO_CENTAVOS) campos.disponivel = true;
      else plano.travadosSemPreco.push(nosso.nome);
    }

    if (Object.keys(campos).length > 0) {
      plano.atualizar.push({ id: nosso.id, nome: nosso.nome, campos });
    }

    /* Complementos: só somam. Apagar uma opção que o cliente já tem no carrinho
       quebra o pedido dele no meio — e o lojista não pediu isso. */
    const gruposNossos = new Map(nosso.grupos.map(g => [limpo(g.nome).toLowerCase(), g]));
    for (const g of item.grupos) {
      const chave = limpo(g.nome).toLowerCase();
      const gNosso = chave ? gruposNossos.get(chave) : undefined;
      if (!gNosso) {
        plano.gruposNovos.push({ produtoId: nosso.id, produtoNome: nosso.nome, grupo: g });
        continue;
      }
      const opcoesNossas = new Set(gNosso.opcoes.map(o => limpo(o.nome).toLowerCase()));
      for (const o of g.opcoes) {
        if (!opcoesNossas.has(limpo(o.nome).toLowerCase())) {
          plano.opcoesNovas.push({ grupoId: gNosso.id, produtoNome: nosso.nome, grupoNome: gNosso.nome, opcao: o });
        }
      }
    }
  }

  for (const p of nossos) {
    const c = limpo(p.codigoBarras);
    if (c && !vistos.has(c)) plano.sumiramDoIfood.push(p.nome);
  }

  return plano;
}

/** O plano não faz nada? Serve para não gravar log de ciclo vazio. */
export function planoVazio(p: PlanoSincronizacao): boolean {
  return p.criar.length === 0 && p.atualizar.length === 0
    && p.gruposNovos.length === 0 && p.opcoesNovas.length === 0;
}
