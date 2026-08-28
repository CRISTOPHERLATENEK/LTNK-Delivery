/**
 * O PROTOCOLO DO SMART TEF — tradução pura, sem rede.
 *
 * Fica separado do cliente HTTP porque é a parte que dá para provar. O cliente
 * só põe e tira coisas de um `fetch`; o que decide se a venda foi aprovada, por
 * quanto, e o que vai na nota fiscal está tudo aqui.
 *
 * Três traduções, e cada uma tem um jeito próprio de dar errado caro:
 *
 * - VALOR: o sistema inteiro é centavos inteiros; a API quer número decimal.
 *   Errar aqui cobra o valor errado do cliente.
 * - STATUS: nove códigos da API viram quatro situações nossas. Tratar um
 *   pendente como aprovado libera mercadoria sem pagamento.
 * - CAMPOS DA ADQUIRENTE: são o motivo do projeto — sem eles a NFC-e continua
 *   palpitando crédito.
 */

/** Situação da cobrança, na linguagem do nosso `pedidos.pagamento_status`. */
export type SituacaoTef = 'pendente' | 'aprovado' | 'recusado' | 'cancelado' | 'estornado';

/**
 * Centavos → o número decimal que a API espera.
 *
 * O sistema guarda dinheiro em centavos inteiros de propósito, e este é o único
 * ponto onde ele vira ponto flutuante. `6990 / 100` dá 69.9 e serializa como
 * `69.9`, que a API aceita; o perigo não é esse, é o acúmulo de erro binário em
 * valores maiores (`10 / 100` já é 0.1, que não existe exato em binário).
 *
 * `toFixed(2)` antes de voltar a número corta o problema na raiz: arredonda para
 * duas casas em decimal, que é a única precisão que dinheiro tem.
 */
export function valorParaApi(centavos: number): number {
  if (!Number.isFinite(centavos)) throw new Error('valor inválido para a maquininha');
  /*
   * Centavo fracionado não existe. Se chegar aqui, alguém dividiu um total (uma
   * conta rachada, um desconto proporcional) e não arredondou — e a maquininha
   * cobraria o valor arredondado enquanto o pedido guarda outro. Melhor
   * estourar aqui do que descobrir na conciliação.
   */
  if (!Number.isInteger(centavos)) throw new Error('valor em centavos precisa ser inteiro');
  if (centavos <= 0) throw new Error('valor precisa ser maior que zero');
  return Number((centavos / 100).toFixed(2));
}

/**
 * Status da API → situação nossa.
 *
 * O DESCONHECIDO É PENDENTE, nunca aprovado. A API pode ganhar um status novo
 * numa versão futura, e a única suposição segura sobre um código que não
 * conhecemos é que a venda ainda não terminou: pendente faz o sistema continuar
 * consultando, aprovado faz o produto sair pela porta.
 */
export function situacaoDeStatus(status: unknown): SituacaoTef {
  switch (String(status ?? '').trim().toUpperCase()) {
    case 'CNC':
    case 'IMP':
      return 'aprovado';

    case 'REJ_PAG':
    case 'REJ':
    case 'REJ_EST':
      /*
       * REJ_EST é ESTORNO recusado, e por isso cai em 'recusado' junto com os
       * outros: o dinheiro continua com a loja. Mapear para 'estornado' seria
       * devolver mercadoria e dinheiro.
       */
      return 'recusado';

    case 'CAN_ERP':
      return 'cancelado';

    case 'EST':
      return 'estornado';

    case 'PDT':
    case 'PROC':
    case 'PROC_PAG':
    case 'SOL_EST':
    case 'PROC_EST':
      return 'pendente';

    default:
      return 'pendente';
  }
}

/** A situação não muda mais? Só aí para de consultar. */
export function situacaoFinal(s: SituacaoTef): boolean {
  return s !== 'pendente';
}

/** O que a adquirente preencheu, pronto para gravar nas colunas `tef_*`. */
export interface DadosTransacao {
  situacao: SituacaoTef;
  nsu: string;
  autorizacao: string;
  bandeira: string;
  adquirente: string;
  adquirenteCnpj: string;
  tipo: string;
}

/**
 * Lê a resposta da API e devolve o que interessa.
 *
 * Tolerante de propósito. A documentação avisa que `autorization_code`,
 * `nsu_host`, `acquirer` e `card_brand` **podem vir `null` até o fim do
 * processamento** — então campo ausente é o caso normal de uma consulta feita
 * cedo demais, não erro. Vira string vazia, que é exatamente o default das
 * colunas `tef_*`.
 *
 * `autorization_code` está escrito assim mesmo na API, sem o segundo `h`. Não é
 * erro de digitação daqui: renomear na leitura seria procurar um campo que não
 * existe e gravar autorização vazia em toda venda.
 */
export function lerTransacao(corpo: unknown): DadosTransacao {
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  /* A API responde num envelope `{status, data}` em algumas rotas e o objeto
     cru em outras. Aceitar os dois evita que a leitura dependa de qual rota
     chamou. */
  const alvo = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;

  const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

  return {
    situacao: situacaoDeStatus(alvo.status),
    nsu: txt(alvo.nsu_host),
    autorizacao: txt(alvo.autorization_code),
    bandeira: txt(alvo.card_brand),
    adquirente: txt(alvo.acquirer),
    adquirenteCnpj: txt(alvo.acquirer_cnpj).replace(/\D/g, ''),
    tipo: txt(alvo.payment_type).toUpperCase(),
  };
}

/**
 * A mensagem de erro da API, em uma linha.
 *
 * `data.message` vem em três formatos conforme o erro: string, lista de
 * strings, ou lista de objetos com o campo inválido. Quem chama precisa de
 * texto para mostrar ao operador, e ele está com o cliente na frente — não é
 * hora de `[object Object]`.
 */
export function mensagemDeErro(corpo: unknown, httpStatus: number): string {
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const dados = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;
  const m = dados.message ?? dados.mensagem;

  const pedaco = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const texto = String(o.message ?? o.error ?? o.descricao ?? '').trim();
      const campo = String(o.field ?? o.campo ?? '').trim();
      return campo && texto ? `${campo}: ${texto}` : texto || campo;
    }
    return String(v);
  };

  const partes = (Array.isArray(m) ? m : [m]).map(pedaco).filter(Boolean);
  if (partes.length) return partes.join(' · ');

  /* Sem mensagem utilizável, o código HTTP vira a explicação — e ela é
     diferente por código, porque o que o operador deve FAZER é diferente. */
  switch (httpStatus) {
    case 401: return 'A maquininha recusou o acesso. Confira as credenciais em Pagamentos.';
    case 404: return 'A maquininha não encontrou essa cobrança.';
    case 409: return 'Essa cobrança já existe ou não pode mudar de estado agora.';
    case 400: return 'A maquininha recusou os dados da cobrança.';
    default: return 'A maquininha não respondeu como esperado.';
  }
}
