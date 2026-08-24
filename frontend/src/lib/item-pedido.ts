/**
 * O que aparece embaixo do nome de um item do pedido.
 *
 * São DUAS coisas com origens diferentes: os complementos escolhidos
 * (`opcoes_texto`, montado pelo servidor) e a observação que o cliente
 * escreveu ("sem cebola"). A comanda da cozinha, o cupom e a tela do lojista
 * precisam mostrar as duas — e mostrar IGUAL, senão o que o cozinheiro lê no
 * papel não é o que o atendente vê na tela.
 *
 * A OBSERVAÇÃO VEM PRIMEIRO: é a instrução que muda o preparo, e numa comanda
 * lida de relance é ela que não pode ficar depois de uma lista de adicionais.
 *
 * Cópia de src/backend/detalhe-item.ts (onde estão os testes) — mesma decisão
 * que opcoes-preco.ts: os dois lados não compartilham build, e importar do
 * backend arrastaria ele pro bundle do navegador.
 */
export function detalheItem(item: { opcoes_texto?: string | null; observacao?: string | null }): string {
  const obs = (item.observacao || '').trim();
  const opc = (item.opcoes_texto || '').trim();
  return [obs && `Obs.: ${obs}`, opc].filter(Boolean).join(' · ');
}

/**
 * O MESMO ITEM, QUEBRADO EM LINHAS — pro cupom e pra comanda.
 *
 * `detalheItem` junta tudo numa linha só com ` · `, e isso funciona na TELA,
 * onde sobra largura. No papel de 58mm cabem 32 colunas, e uma pizza de dois
 * sabores virava isto:
 *
 *     Sabores: Mussarela ? Sabores: Frango com Catup
 *     iry
 *
 * Três defeitos numa linha: o nome do grupo repetido a cada sabor, o separador
 * virando `?` (ver o mapa CP850 no agente) e a quebra no meio da palavra.
 *
 * UMA LINHA POR GRUPO, e cada opção embaixo da outra quando há mais de uma.
 * Grupo de opção única fica na mesma linha ("Tamanho: Gigante") — gastar duas
 * linhas de papel pra uma palavra é o oposto de legível.
 *
 * `opcoes_texto` é TEXTO CONGELADO no pedido, então esta função também é o que
 * conserta os pedidos ANTIGOS: eles foram gravados com o formato velho e
 * passam a imprimir no novo, sem migração nenhuma.
 */
export function linhasDoItem(
  item: { opcoes_texto?: string | null; observacao?: string | null },
): string[] {
  const linhas: string[] = [];
  const obs = (item.observacao || '').trim();
  // A observação primeiro: é a instrução que muda o preparo.
  if (obs) linhas.push(`Obs.: ${obs}`);

  const partes = (item.opcoes_texto || '').split(' · ').map(s => s.trim()).filter(Boolean);
  const ordem: string[] = [];
  const porGrupo = new Map<string, string[]>();
  for (const parte of partes) {
    const corte = parte.indexOf(': ');
    /* Sem "Grupo: " na frente é texto solto (formato antigo, ou observação que
       veio junto) — entra como está, em vez de virar um grupo sem nome. */
    const grupo = corte > 0 ? parte.slice(0, corte) : '';
    const valor = corte > 0 ? parte.slice(corte + 2) : parte;
    if (!porGrupo.has(grupo)) { porGrupo.set(grupo, []); ordem.push(grupo); }
    porGrupo.get(grupo)!.push(valor);
  }

  for (const grupo of ordem) {
    const valores = porGrupo.get(grupo)!;
    if (!grupo) { linhas.push(...valores); continue; }
    if (valores.length === 1) { linhas.push(`${grupo}: ${valores[0]}`); continue; }
    linhas.push(`${grupo}:`);
    for (const v of valores) linhas.push(`  ${v}`);
  }
  return linhas;
}
