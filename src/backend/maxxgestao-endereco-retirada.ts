/**
 * O ENDEREÇO DA LOJA NO CAMPO DE ENDEREÇO DO DOCUMENTO.
 *
 * "não tem como sair com o endereço do lojista?"
 *
 * Tem — e o caminho não é óbvio. O `POST /api/documento/v1` NÃO aceita endereço
 * como texto: o bloco `pessoa` tem `idPessoa`, `idEndereco` e `observacao`, e
 * `idEndereco` é "o código do endereço DA PESSOA". Ou seja, para o endereço
 * aparecer no documento ele precisa estar cadastrado na ficha de alguém.
 *
 * Num pedido de retirada feito pelo app o cliente está logado, então a pessoa
 * do documento é ELE. O lojista escolheu, com o custo na mesa: o endereço da
 * loja entra na ficha do cliente como um endereço extra, chamado "Retirada na
 * loja", com `principal: 'N'`.
 *
 * ─────────────── A ARMADILHA DO PRIMEIRO ENDEREÇO ───────────────
 *
 * A documentação do campo diz: "quando for o primeiro endereço da pessoa, ele
 * será definido como principal automaticamente". E pessoa sem endereço EXISTE
 * de verdade aqui — `pessoaDoCliente` cria assim quando a cidade do cliente não
 * é a da empresa ("pessoa criada sem endereço", está no log).
 *
 * Nessa pessoa, criar o endereço da loja o tornaria PRINCIPAL. A partir daí,
 * toda ENTREGA para esse cliente que não informasse endereço sairia com o
 * endereço da loja — a mercadoria voltaria para o balcão de onde saiu.
 *
 * Então: pessoa sem nenhum endereço NÃO RECEBE. O documento dela continua com o
 * endereço na observação, que é o que já funciona. Um campo bonito não vale uma
 * entrega perdida.
 *
 * ─────────────── DE ONDE VEM O ENDEREÇO ───────────────
 *
 * De `GET /api/empresa/v1`, que devolve `logradouro`, `numero`, `bairro`,
 * `idIbgeMunicipio`, `cep` e `uf` já separados — o cadastro da própria loja no
 * ERP. A alternativa seria fatiar a nossa coluna `lojas.endereco`, que é um
 * texto só ("Rua Dilson Funaro, Ulysses Guimarães, Joinville - SC"), e errar o
 * município num endereço fiscal é rejeição de nota.
 */

/** A marca que identifica o endereço criado por nós, para não criar duas vezes. */
export const REFERENCIA_RETIRADA = 'delivery-retirada';

/** O rótulo que o lojista vê na ficha do cliente, no ERP. */
export const DESCRICAO_RETIRADA = 'Retirada na loja';

/** O endereço da empresa, como `GET /api/empresa/v1` devolve. */
export interface EnderecoDaEmpresa {
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  idIbgeMunicipio?: unknown;
  cep?: unknown;
  uf?: unknown;
}

/** Um endereço da ficha da pessoa, como a listagem devolve. */
export interface EnderecoDaPessoa {
  idEndereco?: unknown;
  referenciaIntegracao?: unknown;
  descricao?: unknown;
}

function inteiro(bruto: unknown): number {
  const n = Number(bruto ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function texto(bruto: unknown, limite: number): string {
  return String(bruto ?? '').trim().slice(0, limite);
}

/**
 * O endereço que já criamos nesta ficha, se houver.
 *
 * Procura pela MARCA (`referenciaIntegracao`), e não pela descrição: descrição
 * é texto que o lojista pode editar na tela do ERP, e um endereço renomeado
 * viraria um segundo endereço criado por nós na próxima retirada — e um
 * terceiro na seguinte.
 */
export function acharEnderecoNosso(lista: EnderecoDaPessoa[] | null | undefined): number {
  for (const e of lista ?? []) {
    if (String(e?.referenciaIntegracao ?? '').trim() === REFERENCIA_RETIRADA) {
      return inteiro(e?.idEndereco);
    }
  }
  return 0;
}

/**
 * O corpo do `POST /api/pessoa/{id}/enderecos/v1`, ou `null`.
 *
 * `null` quando a empresa não tem logradouro ou município: endereço fiscal pela
 * metade é pior que endereço nenhum — ele PARECE preenchido na tela e não serve
 * para nada, e ninguém vai conferir de novo um campo que já está escrito.
 */
export function corpoDoEndereco(empresa: EnderecoDaEmpresa | null): Record<string, unknown> | null {
  const logradouro = texto(empresa?.logradouro, 100);
  const municipio = inteiro(empresa?.idIbgeMunicipio);
  if (!logradouro || !municipio) return null;

  return {
    descricao: DESCRICAO_RETIRADA,
    logradouro,
    numero: texto(empresa?.numero, 10),
    complemento: texto(empresa?.complemento, 60),
    bairro: texto(empresa?.bairro, 60),
    idIbgeMunicipio: municipio,
    uf: texto(empresa?.uf, 2),
    /* `cep` é INTEIRO nesta API, e "informe 0 quando não houver valor" — o
       campo aceita número, então texto com hífen viraria recusa. */
    cep: inteiro(empresa?.cep),
    idRegiao: 0,
    /*
     * `N` EXPLÍCITO, e ainda assim não basta: a API promove o PRIMEIRO endereço
     * da pessoa a principal por conta própria. Quem garante é o chamador, que
     * só cria quando a ficha já tem endereço — ver `enderecoDeRetirada`.
     */
    principal: 'N',
    ativo: 'S',
    referenciaIntegracao: REFERENCIA_RETIRADA,
  };
}

/**
 * O `idEndereco` a mandar no documento, ou zero.
 *
 * ZERO É "não deu", e quem chama simplesmente não manda o campo — o documento
 * sai como saía, com o endereço na observação.
 *
 * As funções de ida e volta ao ERP entram por parâmetro para este módulo
 * continuar testável sem rede: a regra que importa aqui é QUANDO criar, e ela
 * não devia precisar de um servidor para ser verificada.
 */
export async function enderecoDeRetirada(
  listar: () => Promise<{ items?: EnderecoDaPessoa[] } | null>,
  criar: (corpo: Record<string, unknown>) => Promise<{ endereco?: { idEndereco?: unknown } } | null>,
  empresa: EnderecoDaEmpresa | null,
): Promise<number> {
  const lista = await listar();
  const items = lista?.items ?? [];

  const jaTem = acharEnderecoNosso(items);
  if (jaTem > 0) return jaTem;

  /*
   * FICHA SEM NENHUM ENDEREÇO NÃO RECEBE — é a armadilha do cabeçalho. O nosso
   * viraria o principal, e a próxima ENTREGA para este cliente sairia com o
   * endereço da loja.
   */
  if (!items.length) return 0;

  const corpo = corpoDoEndereco(empresa);
  if (!corpo) return 0;

  const criado = await criar(corpo);
  return inteiro(criado?.endereco?.idEndereco);
}
