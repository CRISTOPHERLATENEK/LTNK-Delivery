/**
 * APLICAR O PLANO DE SINCRONIZAÇÃO.
 *
 * Reaproveita as dependências da importação de propósito: criar produto aqui e
 * criar produto na importação têm que ser a MESMA coisa, incluindo o preço que
 * nasce a 1 centavo e o produto que nasce pausado. Um segundo `INSERT` para
 * produto criado pela sincronização seria um segundo lugar para o CHECK de
 * `preco_centavos > 0` morder — e só num dos caminhos.
 *
 * Nenhuma falha individual interrompe o ciclo. Sincronização roda sozinha e sem
 * ninguém olhando: parar tudo porque um produto deu erro deixaria o resto do
 * cardápio desatualizado sem aviso, e o lojista só descobriria pelo cliente.
 */
import { importarCardapio, type DepsImportar, type ResultadoImportacao } from './ifood-importar-gravar';
import type { PlanoSincronizacao } from './ifood-sincronizar';

export interface DepsSincronizar extends DepsImportar {
  /**
   * Só nome, descrição e disponibilidade. O tipo é a guarda: não existe campo
   * de preço para passar aqui, então nenhuma versão futura pode "só incluir o
   * preço também" sem mexer nesta assinatura e ler o porquê.
   */
  atualizarProduto: (
    produtoId: number,
    campos: { nome?: string; descricao?: string; disponivel?: boolean },
  ) => Promise<void>;
}

export interface ResultadoSincronizacao {
  criados: number;
  atualizados: number;
  gruposNovos: number;
  opcoesNovas: number;
  falhas: string[];
  /** Só relatório: sumiram do iFood e continuam aqui, intactos. */
  sumiramDoIfood: string[];
  /** À venda lá, pausados aqui por não terem preço. */
  travadosSemPreco: string[];
}

export async function aplicarSincronizacao(
  lojaId: number,
  plano: PlanoSincronizacao,
  categoriaPadrao: string,
  deps: DepsSincronizar,
): Promise<ResultadoSincronizacao> {
  const r: ResultadoSincronizacao = {
    criados: 0, atualizados: 0, gruposNovos: 0, opcoesNovas: 0,
    falhas: [], sumiramDoIfood: plano.sumiramDoIfood, travadosSemPreco: plano.travadosSemPreco,
  };

  if (plano.criar.length > 0) {
    const imp: ResultadoImportacao = await importarCardapio(lojaId, plano.criar, categoriaPadrao, deps);
    r.criados = imp.criados;
    r.falhas.push(...imp.falhas);
  }

  for (const a of plano.atualizar) {
    try {
      await deps.atualizarProduto(a.id, a.campos);
      r.atualizados++;
    } catch (e) {
      r.falhas.push(`produto ${a.nome}: ${(e as Error).message}`);
    }
  }

  for (const g of plano.gruposNovos) {
    try {
      const grupoId = await deps.criarGrupo(g.produtoId, g.grupo, 0);
      r.gruposNovos++;
      let ordem = 0;
      for (const o of g.grupo.opcoes) {
        try { await deps.criarOpcao(grupoId, o, ordem++); r.opcoesNovas++; }
        catch (e) { r.falhas.push(`opção ${o.nome} de ${g.produtoNome}: ${(e as Error).message}`); }
      }
    } catch (e) {
      r.falhas.push(`grupo ${g.grupo.nome} de ${g.produtoNome}: ${(e as Error).message}`);
    }
  }

  for (const o of plano.opcoesNovas) {
    try { await deps.criarOpcao(o.grupoId, o.opcao, 0); r.opcoesNovas++; }
    catch (e) { r.falhas.push(`opção ${o.opcao.nome} de ${o.produtoNome}: ${(e as Error).message}`); }
  }

  return r;
}
