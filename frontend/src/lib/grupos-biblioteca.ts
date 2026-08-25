/**
 * COMPARAR DOIS GRUPOS DE COMPLEMENTO — o núcleo da limpeza da biblioteca.
 *
 * Depois do reaproveitamento, uma loja acumula grupos de mesmo nome: no
 * mostruário são CINCO "Tamanho", dois "Adicionais", dois "Borda". Eles nasceram
 * assim porque, antes, cada produto precisava do seu.
 *
 * A pergunta que a tela precisa responder não é "qual o nome?" — é "esses dois
 * são a MESMA coisa, ou são diferentes e eu preciso escolher?". E a resposta tem
 * que ser exata, porque juntar dois grupos que só PARECEM iguais muda preço de
 * cardápio, e preço mudado por engano não tem desfazer.
 *
 * Por isso o módulo faz duas coisas separadas:
 *
 *   - `saoIdenticos` — o teste rígido que libera a mesclagem automática. Só
 *     passa quando juntar não muda nada pra ninguém.
 *   - `diferencasEntre` — quando NÃO são idênticos, diz exatamente o que muda.
 *     É o que transforma "não posso mesclar" em "eis a diferença, decida".
 */

export interface OpcaoComparavel {
  nome: string;
  preco_adicional_centavos: number;
  secao?: string | null;
  sabores?: number | null;
  descricao?: string | null;
  imagem?: string | null;
}

export interface GrupoComparavel {
  id: number;
  nome: string;
  tipo?: string | null;
  papel?: string | null;
  modo_preco?: string | null;
  opcoes: OpcaoComparavel[];
  /** Em quantos produtos VIVOS o grupo está. 0 = pode ser apagado sem afetar ninguém. */
  usos?: number;
}

/** Nome comparável: sem caixa, sem espaço sobrando, sem acento. */
export function chaveDeNome(nome: string): string {
  return (nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * O que faz duas opções serem A MESMA opção.
 *
 * Nome, preço, seção e `sabores` — as quatro coisas que mudam o que o cliente vê
 * e o que ele paga. Ficam de fora, DE PROPÓSITO:
 *
 *   - `descricao` e `imagem`: são enriquecimento. Dois "Catupiry" a R$ 5, um com
 *     foto e outro sem, são o mesmo item — e barrar a mesclagem por causa disso
 *     faria a ferramenta nunca servir pra nada. Quem tem mais foto sobrevive
 *     (ver `melhorSobrevivente`).
 *   - `disponivel`: um sabor pausado hoje é o mesmo sabor amanhã.
 */
function assinaturaDaOpcao(o: OpcaoComparavel): string {
  return [
    chaveDeNome(o.nome),
    o.preco_adicional_centavos || 0,
    chaveDeNome(o.secao || ''),
    o.sabores || 0,
  ].join('|');
}

/**
 * A assinatura do grupo: o que precisa bater pra juntar sem mudar nada.
 *
 * As opções entram ORDENADAS. A ordem em que o cliente vê os sabores é escolha
 * do lojista, mas dois grupos com os mesmos sabores em ordens diferentes são o
 * mesmo grupo — recusar a mesclagem por causa disso seria recusar pelo motivo
 * errado. Quem mescla escolhe uma das ordens, e é a do sobrevivente.
 *
 * `obrigatorio`, `max_escolhas` e `ordem` NÃO entram: desde a fase 2 eles moram
 * na ligação produto↔grupo, não no grupo. Dois grupos idênticos podem estar
 * ligados com regras diferentes em produtos diferentes, e isso continua valendo
 * depois de juntar.
 */
export function assinaturaDoGrupo(g: GrupoComparavel): string {
  const cabeca = [
    chaveDeNome(g.nome),
    g.tipo || 'unico',
    g.papel || '',
    g.modo_preco || 'somar',
  ].join('|');
  const itens = g.opcoes.map(assinaturaDaOpcao).sort().join('#');
  return `${cabeca}::${itens}`;
}

export function saoIdenticos(a: GrupoComparavel, b: GrupoComparavel): boolean {
  return assinaturaDoGrupo(a) === assinaturaDoGrupo(b);
}

/**
 * Qual dos dois deve SOBREVIVER à mesclagem.
 *
 * O mais RICO: o que tem mais itens com foto e ingredientes. São idênticos no
 * que importa pro preço, então o desempate é por quanto conteúdo se perde — e
 * perder foto de sabor é perder trabalho que alguém fez.
 *
 * Empate vai pro id menor (o mais antigo), que é o que tem mais chance de estar
 * referenciado em pedido antigo.
 */
export function melhorSobrevivente(grupos: GrupoComparavel[]): GrupoComparavel {
  const riqueza = (g: GrupoComparavel) =>
    g.opcoes.filter(o => (o.imagem || '').trim()).length * 2
    + g.opcoes.filter(o => (o.descricao || '').trim()).length;
  return [...grupos].sort((a, b) => riqueza(b) - riqueza(a) || a.id - b.id)[0];
}

/**
 * O que difere entre dois grupos, em português.
 *
 * Existe pro caso que a mesclagem RECUSA — que, numa loja real, é a maioria. Sem
 * isto a tela diria só "não são iguais", e o lojista teria que abrir os dois e
 * comparar item a item na mão. Com isto ele lê a diferença e decide qual manter.
 */
export function diferencasEntre(a: GrupoComparavel, b: GrupoComparavel): string[] {
  const dif: string[] = [];
  if ((a.papel || '') !== (b.papel || '')) {
    dif.push(`papel diferente: ${a.papel || 'nenhum'} × ${b.papel || 'nenhum'}`);
  }
  if ((a.modo_preco || 'somar') !== (b.modo_preco || 'somar')) {
    dif.push(`cobrança diferente: ${a.modo_preco || 'somar'} × ${b.modo_preco || 'somar'}`);
  }
  if ((a.tipo || 'unico') !== (b.tipo || 'unico')) {
    dif.push(`tipo diferente: ${a.tipo || 'unico'} × ${b.tipo || 'unico'}`);
  }

  const porNome = (g: GrupoComparavel) => new Map(g.opcoes.map(o => [chaveDeNome(o.nome), o]));
  const ma = porNome(a);
  const mb = porNome(b);

  const soEmA = a.opcoes.filter(o => !mb.has(chaveDeNome(o.nome))).map(o => o.nome);
  const soEmB = b.opcoes.filter(o => !ma.has(chaveDeNome(o.nome))).map(o => o.nome);
  if (soEmA.length) dif.push(`só no primeiro: ${soEmA.join(', ')}`);
  if (soEmB.length) dif.push(`só no segundo: ${soEmB.join(', ')}`);

  /* Preço divergente é a diferença que MAIS importa: é a que muda o que o
     cliente paga, e a que ninguém percebe olhando a lista de nomes. */
  for (const [chave, oa] of ma) {
    const ob = mb.get(chave);
    if (!ob) continue;
    if ((oa.preco_adicional_centavos || 0) !== (ob.preco_adicional_centavos || 0)) {
      dif.push(`${oa.nome}: preço ${(oa.preco_adicional_centavos / 100).toFixed(2)} × ${(ob.preco_adicional_centavos / 100).toFixed(2)}`);
    } else if (chaveDeNome(oa.secao || '') !== chaveDeNome(ob.secao || '')) {
      dif.push(`${oa.nome}: seção "${oa.secao || '—'}" × "${ob.secao || '—'}"`);
    } else if ((oa.sabores || 0) !== (ob.sabores || 0)) {
      dif.push(`${oa.nome}: sabores ${oa.sabores || 0} × ${ob.sabores || 0}`);
    }
  }
  return dif;
}

export interface Familia {
  nome: string;
  grupos: GrupoComparavel[];
  /** Os que dá pra juntar sem mudar nada — 2 ou mais com a mesma assinatura. */
  identicos: GrupoComparavel[][];
}

/**
 * Junta os grupos por NOME e, dentro de cada nome, separa os idênticos.
 *
 * Nome é o que faz o lojista suspeitar que há duplicata; assinatura é o que
 * decide se dá pra juntar. Os dois níveis existem porque a tela precisa mostrar
 * "estes cinco se chamam Tamanho" mesmo quando nenhum par é mesclável — é essa
 * lista que ele vai usar pra escolher qual manter.
 *
 * Só devolve nome com MAIS DE UM grupo: nome único não é candidato a nada.
 */
export function familiasDuplicadas(grupos: GrupoComparavel[]): Familia[] {
  const porNome = new Map<string, GrupoComparavel[]>();
  for (const g of grupos) {
    const k = chaveDeNome(g.nome);
    if (!porNome.has(k)) porNome.set(k, []);
    porNome.get(k)!.push(g);
  }

  const familias: Familia[] = [];
  for (const lista of porNome.values()) {
    if (lista.length < 2) continue;
    const porAssinatura = new Map<string, GrupoComparavel[]>();
    for (const g of lista) {
      const a = assinaturaDoGrupo(g);
      if (!porAssinatura.has(a)) porAssinatura.set(a, []);
      porAssinatura.get(a)!.push(g);
    }
    familias.push({
      nome: lista[0].nome,
      grupos: lista,
      identicos: [...porAssinatura.values()].filter(x => x.length > 1),
    });
  }
  return familias.sort((a, b) => b.grupos.length - a.grupos.length);
}
