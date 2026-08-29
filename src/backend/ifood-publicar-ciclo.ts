/**
 * UM CICLO DE PUBLICAÇÃO DE UMA LOJA: daqui → iFood.
 *
 * Tem MODO DE ENSAIO, e é o padrão. A sincronização podia ser testada rodando —
 * o pior caso era um nome errado no nosso banco, que o ciclo seguinte
 * consertava. Aqui o pior caso é o cardápio da loja no iFood, com o cliente
 * comprando do outro lado, e não existe ciclo seguinte que conserte: o `PUT`
 * substitui o item, e o que ele omitiu já foi.
 *
 * Por isso `publicar: false` é o padrão da assinatura. Quem for escrever de
 * verdade precisa dizer isso em voz alta, no código, e não por esquecimento.
 *
 * O ensaio não é um caminho paralelo: ele passa pelas MESMAS funções, monta os
 * MESMOS payloads, e só não faz a última chamada. Um ensaio que percorre outro
 * caminho não prova nada sobre o que a publicação de verdade faria.
 */
import type { CredenciaisIfood } from './ifood-cliente';
import {
  listarCatalogos, catalogoDeEntrega, mapaDeItensPorCodigo, buscarItemCompleto, listarCategorias,
} from './ifood-catalogo';
import { montarPayloadItem, planejarPublicacao, type ProdutoDaqui } from './ifood-publicar';
import { publicarItem } from './ifood-publicar-cliente';
import { lerProdutosParaPublicar } from './ifood-importar-deps';

export interface ResultadoPublicacao {
  /** `false` quando foi ensaio: nada foi enviado. */
  publicou: boolean;
  criados: number;
  atualizados: number;
  falhas: string[];
  semCodigo: string[];
  /** Sem preço de verdade: ficaram de fora para não virar R$ 0,01 lá. */
  semPreco: string[];
  soExistemNoIfood: string[];
  /** No ensaio, o que SERIA enviado — para conferir antes de mandar. */
  previa: Array<{ nome: string; codigo: string; acao: 'criar' | 'atualizar'; complementos: number }>;
}

export async function publicarCardapioIfood(
  cred: CredenciaisIfood,
  merchantId: string,
  lojaId: number,
  opcoes: { publicar?: boolean } = {},
): Promise<ResultadoPublicacao> {
  const publicar = opcoes.publicar === true;
  const r: ResultadoPublicacao = {
    publicou: publicar, criados: 0, atualizados: 0,
    falhas: [], semCodigo: [], semPreco: [], soExistemNoIfood: [], previa: [],
  };

  const catalogo = catalogoDeEntrega(await listarCatalogos(cred, merchantId));
  if (!catalogo) { r.falhas.push('a loja não tem catálogo no iFood'); return r; }

  const nossos = await lerProdutosParaPublicar(lojaId);
  const laPorCodigo = await mapaDeItensPorCodigo(cred, merchantId, catalogo.catalogId);
  const plano = planejarPublicacao(nossos, laPorCodigo);

  r.semCodigo = plano.semCodigo;
  r.semPreco = plano.semPreco;
  r.soExistemNoIfood = plano.soExistemNoIfood;

  const categoryId = await primeiraCategoria(cred, merchantId, catalogo.catalogId);

  const tarefas: Array<{ produto: ProdutoDaqui; itemId: string | null; acao: 'criar' | 'atualizar' }> = [
    ...plano.atualizar.map(a => ({ produto: a.produto, itemId: a.itemId, acao: 'atualizar' as const })),
    ...plano.criar.map(p => ({ produto: p, itemId: null, acao: 'criar' as const })),
  ];

  for (const t of tarefas) {
    try {
      /*
       * LER ANTES DE ESCREVER, item por item. É o que preserva
       * `contextModifiers` e tudo que a API tiver e nós não modelamos — e é
       * uma chamada a mais por item, de propósito. A alternativa barata é
       * montar o payload do nosso banco, que funciona no teste e apaga o preço
       * do Cardápio Digital em produção.
       */
      const atual = t.itemId ? await buscarItemCompleto(cred, merchantId, t.itemId) : null;
      const payload = montarPayloadItem(t.produto, categoryId, atual);

      r.previa.push({
        nome: t.produto.nome,
        codigo: t.produto.codigoBarras,
        acao: t.acao,
        complementos: t.produto.grupos.length,
      });

      if (!publicar) continue;

      await publicarItem(cred, merchantId, payload);
      if (t.acao === 'criar') r.criados++; else r.atualizados++;
    } catch (e) {
      /* Um item que falha não impede os outros: o cardápio publicado pela
         metade é ruim, mas o cardápio parado no primeiro erro é pior. */
      r.falhas.push(`${t.produto.nome}: ${(e as Error).message}`);
    }
  }

  return r;
}

/**
 * A categoria onde um item NOVO vai nascer.
 *
 * Usa a primeira que existir lá em vez de criar uma: criar categoria é mais uma
 * escrita, e a publicação já tem escrita demais para o primeiro corte. Sem
 * nenhuma categoria, o item novo falha com mensagem clara em vez de a API
 * responder algo que ninguém entende.
 */
async function primeiraCategoria(
  cred: CredenciaisIfood,
  merchantId: string,
  catalogId: string,
): Promise<string> {
  const cats = await listarCategorias(cred, merchantId, catalogId);
  return cats[0]?.id ?? '';
}

/** Uma linha só, para log e para o comando. */
export function resumoDaPublicacao(r: ResultadoPublicacao): string {
  const acao = r.publicou ? 'publicado' : 'ENSAIO (nada enviado)';
  return `${acao}: ${r.previa.filter(p => p.acao === 'criar').length} para criar, ` +
         `${r.previa.filter(p => p.acao === 'atualizar').length} para atualizar, ` +
         `${r.falhas.length} falha(s)`;
}
