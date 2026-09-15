/**
 * UMA PASSADA DE SINCRONIZAÇÃO DO CARDÁPIO COM O MAXX GESTÃO.
 *
 * O lojista mexe no cadastro LÁ — muda preço, corrige nome, desativa o que não
 * vende mais — e espera que o delivery acompanhe sozinho. Este arquivo é o que
 * faz a pergunta periodicamente; a decisão do que fazer com a resposta já
 * morava em `maxxgestao-importar.ts` e não mudou.
 *
 * ───────────────────── POR QUE É VARREDURA, E NÃO AVISO ─────────────────────
 *
 * Medido contra a conta real em 14/09/2026, não suposto:
 *
 *   webhook / assinatura de evento .... NÃO EXISTE (todos os caminhos: 404)
 *   filtro "mudou depois de tal data" . NÃO EXISTE — o parâmetro é ACEITO e
 *                                       IGNORADO. Com `dataAlteracao=2099-01-01`
 *                                       a busca devolve os mesmos 1.076 itens.
 *                                       Ignorado em silêncio é pior que
 *                                       recusado: parece que funcionou.
 *
 * Então não há como o ERP nos avisar, nem como pedir "só o que mudou". Sobra
 * perguntar tudo de tempos em tempos e comparar aqui. O `dataAlteracao` de cada
 * produto vem na resposta e serve para EXPLICAR o que mudou — não para evitar
 * a leitura.
 *
 * ───────────────────────────── E O ESTOQUE, SIM ─────────────────────────────
 *
 * EU DISSE QUE O SALDO NÃO EXISTIA NA API DELES, E ESTAVA ERRADO. Em 14/09 eu
 * havia sondado 25 caminhos prováveis (`/api/estoque/v1`,
 * `/api/mercadoria/v1/{id}/estoque/v1`, `/api/saldo/v1`…), todos 404, e conclui
 * que não havia. A forma real é
 * `/api/local-estoque/{id}/estoques/v1` — e ela só apareceu quando o lojista
 * abriu o swagger deles, que exige login. Adivinhar URL é um jeito ruim de
 * concluir que algo não existe.
 *
 * O saldo entra na mesma passada, e custa 11 a 13 chamadas (listagem por local,
 * de 100 em 100) — não uma por produto, que seria quase uma hora.
 *
 * O QUE ELE NÃO FAZ: tirar produto do ar. Medido no cadastro do Galderio,
 * ligar "sem saldo = fora do ar" apagaria 210 dos 644 produtos à venda (33%),
 * Coca-Cola Zero 2L e Pepsi 2L incluídas, com saldo zero — e 175 itens estão
 * com saldo NEGATIVO lá. O estoque do ERP não é mantido item a item, e isso é
 * o normal do comércio. A passada grava o número; quem liga o bloqueio é o
 * lojista, pelo `controla_estoque` que já existe. Ver `maxxgestao-estoque.ts`.
 *
 * ─────────────────────── O LIMITE É O QUE MANDA NO RITMO ────────────────────
 *
 * 20 chamadas por minuto, por token. Uma passada custa cerca de 37:
 *
 *   12  os códigos da seção          (`idsDaSecao`)
 *   14  categorias, configuração, preços, catálogo
 *   11  a varredura por letras       (`LETRAS_VARREDURA`)
 *
 * Ou seja, perto de dois minutos de orçamento. É por isso que o intervalo é de
 * hora em hora e não de minuto em minuto: a MESMA cota paga a emissão da NFC-e
 * de cada pedido, e um ciclo apertado transformaria "preço desatualizado por
 * uma hora" em "nota que não sai na hora do almoço".
 *
 * Este módulo não conhece tenant nem `setInterval` — quem chama já resolveu em
 * que banco está. Assim a passada pode ser provada isolada, e o comando manual
 * e o laço automático passam pelo MESMO caminho (com dois, o "sincronizar
 * agora" provaria uma coisa e o automático faria outra, e a diferença só
 * apareceria na loja de alguém).
 */
import {
  LETRAS_VARREDURA, buscarMercadorias, idsDaSecao, idsDoCatalogo,
  mapaDeCategorias, precosDaTabela,
} from './maxxgestao-catalogo';
import { chamarMaxxGestao, type OpcoesMaxxGestao } from './maxxgestao-cliente';
import {
  PLANO_VAZIO, peneirarPorCatalogo, planejarImportacao, planoVazio, resumoDoPlano,
  type ItemDoCatalogo, type PlanoImportacao,
} from './maxxgestao-importar';
import { aplicarPlano, produtosDaLoja, type ResultadoGravacao } from './maxxgestao-importar-deps';
import { aplicarEstoque, produtosComEstoque } from './maxxgestao-importar-deps';
import { planejarEstoque, planoEstoqueVazio } from './maxxgestao-estoque';
import { saldosDoLocal } from './maxxgestao-catalogo';

/** O que uma passada devolve. */
export interface ResultadoSincronizacaoErp extends ResultadoGravacao {
  /** Quantos produtos o ERP entregou nesta passada. */
  lidos: number;
  /** Já iguais — contados para a passada poder dizer "nada mudou". */
  semMudanca: number;
  /** Frase curta para o log; vazia quando não houve gravação. */
  resumo: string;
  /** Quantos produtos tiveram o saldo atualizado nesta passada. */
  estoqueAjustado: number;
}

export const SEM_MUDANCA: ResultadoSincronizacaoErp = Object.freeze({
  criados: 0, atualizados: 0, pausados: 0, religados: 0, falhas: [],
  lidos: 0, semMudanca: 0, resumo: '', estoqueAjustado: 0,
});

/**
 * A COBERTURA MÍNIMA PARA PODER PAUSAR — e esta é a trava mais importante aqui.
 *
 * `pausar` significa tirar produto do ar. Uma varredura que trouxe metade do
 * cadastro (porque o ERP tropeçou no meio) faz a outra metade parecer
 * "sumiu do ERP" — e a passada seguinte pausaria metade do cardápio sozinha,
 * de madrugada, sem ninguém para ver. Um cardápio pela metade é pior que um
 * cardápio desatualizado, porque não se sabe qual metade.
 *
 * 90% é a linha: a varredura por vogais cobre ~96% do cadastro conferido
 * (1.034 de 1.108), e o que sobra são nomes sem `a`, `e` nem `o`. Abaixo disso
 * não foi "o cadastro encolheu", foi leitura incompleta.
 */
export const COBERTURA_MINIMA_PARA_PAUSAR = 0.9;

export interface LeituraDoErp {
  itens: ItemDoCatalogo[];
  /** Quantos produtos o ERP diz ter — a régua da cobertura. */
  esperados: number;
  /** A varredura terminou todas as letras sem tropeçar? */
  completa: boolean;
}

/**
 * PODE PAUSAR O QUE NÃO APARECEU?
 *
 * Separada da leitura para poder ser provada sem rede: é a decisão que tira
 * produto do ar, e ela merece teste próprio.
 */
export function podePausarAusentes(leitura: LeituraDoErp): boolean {
  if (!leitura.completa) return false;
  if (leitura.esperados <= 0) return false;
  return leitura.itens.length / leitura.esperados >= COBERTURA_MINIMA_PARA_PAUSAR;
}

/** Lê o cardápio inteiro do ERP. Só rede — nada de banco. */
export async function lerCardapioDoErp(
  token: string,
  catalogo: number,
  op: OpcoesMaxxGestao = {},
): Promise<LeituraDoErp> {
  const existentes = await idsDaSecao(token, 1, op);
  const mapas = await mapaDeCategorias(token, op);

  const cfg = await chamarMaxxGestao(token, '/api/empresa/configuracoes/v1', op) as Record<string, unknown> | null;
  const idTabela = Number(cfg?.idTabelaPrecoPadrao ?? 0);
  const precos = idTabela > 0 ? await precosDaTabela(token, idTabela, op) : new Map<number, number>();
  const doCatalogo = catalogo > 0 ? await idsDoCatalogo(token, catalogo, op) : new Set<number>();

  /* Dedup por variação: a mesma mercadoria aparece em várias letras, e contá-la
     duas vezes inflaria a cobertura e criaria produto duplicado. */
  const porVariacao = new Map<number, ItemDoCatalogo>();
  let completa = true;
  for (const letra of LETRAS_VARREDURA) {
    try {
      for (const item of await buscarMercadorias(token, letra, mapas, op)) {
        if (porVariacao.has(item.produto.variacao)) continue;
        porVariacao.set(item.produto.variacao, {
          ...item,
          precoCentavos: precos.get(item.produto.variacao),
        });
      }
    } catch (e) {
      /*
       * UMA LETRA QUE FALHOU MARCA A PASSADA COMO INCOMPLETA e a passada
       * continua. O que já veio serve para CRIAR e ATUALIZAR — informação a
       * mais nunca tira produto do ar. O que ela não pode é autorizar `pausar`,
       * e é exatamente isso que `completa: false` impede.
       */
      completa = false;
      const erro = e as { message?: string };
      console.log(`[erp-sinc] letra "${letra}" falhou: ${erro.message ?? e}`);
    }
  }

  /* Com catálogo escolhido, a régua é o catálogo — não a empresa: esperar
     1.118 numa loja que publica 39 daria cobertura de 3% para sempre. */
  const esperados = catalogo > 0 ? doCatalogo.size : existentes.size;
  return {
    itens: peneirarPorCatalogo([...porVariacao.values()], doCatalogo),
    esperados,
    completa,
  };
}

/**
 * UMA PASSADA COMPLETA de uma loja: lê o ERP, planeja e grava.
 *
 * Devolve `SEM_MUDANCA` quando não há o que gravar. Passada silenciosa é o
 * caso normal — com um log por hora por loja dizendo "nada mudou", o dia em
 * que algo mudar vira invisível no meio do ruído.
 */
export async function sincronizarLojaErp(
  token: string,
  lojaId: number,
  catalogo: number,
  /** O local de estoque do ERP. 0 = não sincronizar saldo. */
  localEstoque = 0,
  op: OpcoesMaxxGestao = {},
): Promise<ResultadoSincronizacaoErp> {
  const leitura = await lerCardapioDoErp(token, catalogo, op);
  if (!leitura.itens.length) return SEM_MUDANCA;

  const nossos = await produtosDaLoja(lojaId);
  const plano: PlanoImportacao = planejarImportacao(leitura.itens, nossos, {
    pausarAusentes: podePausarAusentes(leitura),
  });

  const gravado = planoVazio(plano)
    ? { criados: 0, atualizados: 0, pausados: 0, religados: 0, falhas: [] as string[] }
    : await aplicarPlano(lojaId, plano);

  /*
   * O SALDO VEM DEPOIS DO CADASTRO, e a ordem importa: um produto criado ou
   * religado nesta mesma passada só tem `maxxgestao_variacao_id` DEPOIS da
   * gravação acima. Lendo o estoque antes, ele ficaria de fora e só receberia
   * saldo na hora seguinte.
   */
  const estoque = await sincronizarEstoqueDaLoja(token, lojaId, localEstoque, op);

  const resumo = [
    planoVazio(plano) ? '' : resumoDoPlano(plano),
    estoque.ajustados ? `${estoque.ajustados} com saldo novo.` : '',
  ].filter(Boolean).join(' ');

  return {
    ...gravado,
    falhas: [...gravado.falhas, ...estoque.falhas],
    lidos: leitura.itens.length,
    semMudanca: plano.semMudanca,
    estoqueAjustado: estoque.ajustados,
    resumo,
  };
}

/**
 * O SALDO DO LOCAL ESCOLHIDO, gravado na coluna `estoque`.
 *
 * Sem local escolhido não faz nada — e isso é o padrão. Só o lojista sabe qual
 * dos locais do ERP é a prateleira da loja; o Mostruário tem três ("Local de
 * estoque padrão", "Estoque I", "Estoque II"), e escolher por ele traria o
 * saldo do depósito errado como se fosse o que está à venda.
 *
 * NUNCA LIGA O BLOQUEIO DE VENDA: só escreve o número. Ver o cabeçalho de
 * `maxxgestao-estoque.ts` para o que isso evita (33% do cardápio do Galderio
 * fora do ar no primeiro minuto).
 */
export async function sincronizarEstoqueDaLoja(
  token: string,
  lojaId: number,
  localEstoque: number,
  op: OpcoesMaxxGestao = {},
): Promise<{ ajustados: number; semLinha: number; falhas: string[] }> {
  if (!localEstoque || localEstoque <= 0) return { ajustados: 0, semLinha: 0, falhas: [] };
  try {
    const saldos = await saldosDoLocal(token, localEstoque, op);
    /* Lista vazia é tratada como "não consegui ler", e não como "tudo zerado":
       a diferença entre as duas, aplicada, é o cardápio inteiro sem estoque. */
    if (!saldos.size) return { ajustados: 0, semLinha: 0, falhas: [] };

    const nossos = await produtosComEstoque(lojaId);
    const plano = planejarEstoque(saldos, nossos);
    if (planoEstoqueVazio(plano)) return { ajustados: 0, semLinha: plano.semLinha, falhas: [] };

    const r = await aplicarEstoque(lojaId, plano.ajustar);
    return { ajustados: r.ajustados, semLinha: plano.semLinha, falhas: r.falhas };
  } catch (e) {
    /* Falha ao ler o saldo NÃO derruba a passada do cadastro, que já gravou. */
    return { ajustados: 0, semLinha: 0, falhas: [`estoque: ${(e as Error).message}`] };
  }
}

/** Só para o chamador não precisar repetir a comparação. */
export function passadaMudouAlgo(r: ResultadoSincronizacaoErp): boolean {
  if (r.estoqueAjustado > 0) return true;
  /* `religados` conta: é o vínculo com o ERP sendo acertado, e é a linha de log
     que explica por que um cardápio que parecia ter produtos novos não tinha. */
  return r.criados > 0 || r.atualizados > 0 || r.pausados > 0 || r.religados > 0;
}

export { PLANO_VAZIO };
