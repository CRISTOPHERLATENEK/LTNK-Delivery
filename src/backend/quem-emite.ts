/**
 * QUEM EMITE A NOTA DE CADA CLIENTE — a pergunta que nenhuma tela respondia.
 *
 * O estado perigoso desta plataforma não é "nota errada": é **cliente ativo
 * vendendo e nota nenhuma saindo**. Ele não dá erro em lugar nenhum. O pedido
 * fecha, o dinheiro entra, o painel do lojista fica verde, e a descoberta vem
 * pelo contador dele perguntando meses depois.
 *
 * Três ajustes independentes decidem isso — `nfce_emissor`, `fiscal_liberado` e
 * `nfce_ativo`, mais a credencial do emissor externo — e nenhum deles é visível
 * de fora da loja. A decisão mora aqui, pura, porque é ela que precisa de teste;
 * a rota só a chama por linha.
 */

/** O que o painel admin precisa saber sobre a nota de uma loja. */
export interface Situacao {
  /** Chave curta para a tela escolher a cor. */
  estado: 'erp' | 'maquininha' | 'proprio' | 'nenhum' | 'sem_credencial';
  /** O rótulo do selo, em português e curto. */
  rotulo: string;
  /** Uma frase dizendo o que está acontecendo. */
  detalhe: string;
  /**
   * Pede atenção? Reservado para o que TERMINA em venda sem nota — não para
   * "está diferente do padrão". Selo amarelo em situação normal treina a pessoa
   * a ignorar amarelo.
   */
  alerta: boolean;
}

export interface LojaFiscal {
  nfce_emissor?: string | null;
  fiscal_liberado?: number | null;
  nfce_ativo?: number | null;
  /** Só se TEM, nunca o valor. */
  tem_token_erp?: boolean;
  /** A maquininha exige as duas credenciais para lançar a preconta. */
  smarttef_configurado?: boolean;
}

export function quemEmite(loja: LojaFiscal): Situacao {
  const emissor = String(loja.nfce_emissor ?? 'sistema');

  if (emissor === 'erp') {
    if (!loja.tem_token_erp) {
      return {
        estado: 'sem_credencial',
        rotulo: 'ERP sem token',
        detalhe: 'O emissor é o Maxx Gestão, mas não há token salvo — o pedido não chega lá e a nota não sai.',
        alerta: true,
      };
    }
    return {
      estado: 'erp',
      rotulo: 'Maxx Gestão',
      detalhe: 'O pedido sobe como documento e a nota sai no ERP, com o certificado e a numeração deles.',
      alerta: false,
    };
  }

  if (emissor === 'maquininha') {
    if (!loja.smarttef_configurado) {
      return {
        estado: 'sem_credencial',
        rotulo: 'Maquininha sem credencial',
        detalhe: 'O emissor é a maquininha, mas falta credencial — a preconta não é lançada e a nota não sai.',
        alerta: true,
      };
    }
    return {
      estado: 'maquininha',
      rotulo: 'Maquininha',
      detalhe: 'O pedido vira preconta no aparelho e a nota sai quando alguém finaliza lá.',
      alerta: false,
    };
  }

  /*
   * EMISSOR PRÓPRIO É ALERTA MESMO FUNCIONANDO.
   *
   * O emissor construído aqui dentro está incompleto e não é para ser usado —
   * hoje a nota sai pelo Maxx Gestão ou por outra API. Uma loja apontada para
   * cá é configuração a corrigir, não um estado de repouso, então ela aparece
   * marcada mesmo com tudo "ligado".
   */
  const emitindoAqui = !!loja.fiscal_liberado && !!loja.nfce_ativo;
  if (emitindoAqui) {
    return {
      estado: 'proprio',
      rotulo: 'Emissor próprio',
      detalhe: 'Está apontada para a emissão deste sistema, que é incompleta. Aponte para o Maxx Gestão.',
      alerta: true,
    };
  }

  /*
   * NINGUÉM EMITE. O caso que esta coluna existe para mostrar.
   *
   * O detalhe diz QUAL das duas chaves está faltando, porque são telas
   * diferentes: `fiscal_liberado` é aqui no admin, `nfce_ativo` é no painel do
   * lojista. "Não emite" sem isso manda a pessoa procurar nas duas.
   */
  return {
    estado: 'nenhum',
    rotulo: 'Nenhum',
    detalhe: !loja.fiscal_liberado
      ? 'Nenhuma nota sai: o módulo fiscal não está liberado e o emissor aponta para este sistema.'
      : 'Nenhuma nota sai: o módulo está liberado, mas a emissão está desligada no painel do lojista.',
    alerta: true,
  };
}
