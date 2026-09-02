import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  montarDocumento, valorDoErp, diferencaDoTotal,
  type DadosDoPedido, type ConfigDocumento,
} from './maxxgestao-documento';
import { acharPagamento, idDoDocumento, agoraBrasiliaIso } from './maxxgestao-emitir';

const config: ConfigDocumento = {
  idNaturezaOperacao: 1,
  idPessoa: 5,
  idUsuario: 5470,
  idPagamento: 3,
  dataHora: '2026-09-02T13:00:00',
};

const pedido = (extra: Partial<DadosDoPedido> = {}): DadosDoPedido => ({
  id: 101,
  totalCentavos: 3000,
  formaPagamento: 'pix',
  tipoEntrega: 'entrega',
  itens: [{ nome: 'X-Bacon', quantidade: 2, precoUnitarioCentavos: 1500, variacaoErp: 77 }],
  ...extra,
});

describe('o corpo do documento', () => {
  it('monta com modelo PV, natureza, pessoa padrão e o id do pedido', () => {
    const { corpo, impedimentos } = montarDocumento(pedido(), config);
    expect(impedimentos).toEqual([]);
    expect(corpo?.documento).toEqual({
      idNaturezaOperacao: 1,
      idUsuario: 5470,
      /* `modelo` só aceita PA, PV, OC ou CN — modelo fiscal é o que o
         `transformar` faz depois, não o que se pede na criação. */
      modelo: 'PV',
      dataHora: '2026-09-02T13:00:00',
      idExterno: '101',
    });
    expect(corpo?.pessoa).toEqual({ idPessoa: 5 });
  });

  it('o idExterno é o id do nosso pedido, nos dois lugares', () => {
    /*
     * É A IDEMPOTÊNCIA. Sem ele não há como perguntar "já mandei este pedido?"
     * antes de mandar de novo, e uma retentativa gera dois documentos fiscais
     * para a mesma venda — cada um consumindo um número da sequência.
     */
    const { corpo } = montarDocumento(pedido({ id: 4321 }), config);
    expect((corpo?.documento as Record<string, unknown>).idExterno).toBe('4321');
    expect((corpo?.pedido as Record<string, unknown>).idExterno).toBe('4321');
  });

  it('cada item leva o vínculo da mercadoria e os valores em reais', () => {
    const { corpo } = montarDocumento(pedido(), config);
    expect(corpo?.mercadoriaLista).toEqual([{
      idMercadoriaVariacao: 77,
      qtd: 2,
      valUnitarioBruto: 15,
      valUnitarioLiquido: 15,
      valTotalBruto: 30,
      valTotalLiquido: 30,
      observacao: '',
    }]);
  });

  it('o pagamento leva a soma dos ITENS, não o total do pedido', () => {
    /*
     * O total inclui a taxa de entrega, e taxa não é mercadoria. Se ela entrar
     * no pagamento sem estar em item nenhum, o documento não fecha — pagamento
     * maior que a soma das mercadorias.
     */
    const { corpo } = montarDocumento(pedido({ totalCentavos: 3800 }), config);
    expect(corpo?.pagamentoLista).toEqual([{ idPagamento: 3, valor: 30, valAcrescimo: 0, valDesconto: 0 }]);
  });

  it('retirada e entrega viram B e D — não R e E', () => {
    /*
     * O ERP recusa com "tipoEntrega invalido. Valores aceitos: D ou B". R e E
     * era suposição minha, e ela custou uma recusa: D de delivery, B de balcão.
     */
    expect((montarDocumento(pedido({ tipoEntrega: 'retirada' }), config).corpo?.pedido as Record<string, unknown>).tipoEntrega).toBe('B');
    expect((montarDocumento(pedido(), config).corpo?.pedido as Record<string, unknown>).tipoEntrega).toBe('D');
  });

  it('sem o usuário do ERP, não monta', () => {
    /*
     * O ERP recusa com "idUsuario deve ser maior que zero", e não dá para
     * perguntar ao lojista: a lista de usuários da API não devolve o id (só
     * e-mail e código externo). O valor é descoberto lendo um documento que já
     * existe lá.
     */
    const m = montarDocumento(pedido(), { ...config, idUsuario: 0 });
    expect(m.corpo).toBeNull();
    expect(m.impedimentos.join(' ')).toMatch(/usuário do ERP/i);
  });
});

describe('na dúvida, NÃO emite', () => {
  it('item sem vínculo com o ERP impede, e diz QUAIS', () => {
    /*
     * Nomear em vez de contar. "3 itens sem vínculo" manda a pessoa procurar
     * quais; com os nomes ela já sabe onde mexer. E o corpo vem nulo: emitir
     * sem o `idMercadoriaVariacao` não é possível, e inventar um seria pôr
     * mercadoria alheia na nota de alguém.
     */
    const m = montarDocumento(pedido({
      itens: [
        { nome: 'X-Bacon', quantidade: 1, precoUnitarioCentavos: 1500, variacaoErp: 77 },
        { nome: 'Combo da casa', quantidade: 1, precoUnitarioCentavos: 2000, variacaoErp: 0 },
      ],
    }), config);
    expect(m.corpo).toBeNull();
    expect(m.impedimentos.join(' ')).toContain('Combo da casa');
    expect(m.impedimentos.join(' ')).not.toContain('X-Bacon');
  });

  it('forma de pagamento sem correspondente NÃO impede — vai sem', () => {
    /*
     * MUDOU DE LADO, e por um motivo. Enquanto nós emitíamos a nota, forma
     * errada seria `tPag` errado e a ausência tinha que bloquear. Agora quem
     * emite é o ERP: forma de pagamento é cadastro dele, e bloquear o envio por
     * causa disso deixava o pedido não chegar — o oposto do que se quer.
     */
    const m = montarDocumento(pedido(), { ...config, idPagamento: 0 });
    expect(m.impedimentos).toEqual([]);
    expect(m.corpo).not.toBeNull();
    /* Sem forma resolvida, o bloco não vai: `idPagamento: 0` seria inventar um
       cadastro que não existe. */
    expect(m.corpo).not.toHaveProperty('pagamentoLista');
  });

  it('com forma resolvida, o pagamento vai completo', () => {
    const m = montarDocumento(pedido(), config);
    expect(m.corpo?.pagamentoLista).toEqual([{ idPagamento: 3, valor: 30, valAcrescimo: 0, valDesconto: 0 }]);
  });

  it('pedido sem itens impede', () => {
    const m = montarDocumento(pedido({ itens: [] }), config);
    expect(m.corpo).toBeNull();
    expect(m.impedimentos.join(' ')).toMatch(/não tem itens/);
  });

  it('natureza e pessoa padrão faltando impedem', () => {
    expect(montarDocumento(pedido(), { ...config, idNaturezaOperacao: 0 }).corpo).toBeNull();
    expect(montarDocumento(pedido(), { ...config, idPessoa: 0 }).corpo).toBeNull();
  });

  it('reporta TODOS os impedimentos de uma vez', () => {
    /*
     * Lançar no primeiro problema faria a pessoa consertar um item, tentar de
     * novo, descobrir o segundo, e assim por diante — em cardápio grande, uma
     * tarde.
     */
    const m = montarDocumento(
      pedido({ itens: [{ nome: 'Sem vínculo', quantidade: 1, precoUnitarioCentavos: 100, variacaoErp: 0 }] }),
      { ...config, idNaturezaOperacao: 0, idPessoa: 0 },
    );
    expect(m.impedimentos.length).toBeGreaterThanOrEqual(3);
  });
});

describe('os valores', () => {
  it('centavos viram reais com duas casas de verdade', () => {
    expect(valorDoErp(1500)).toBe(15);
    expect(valorDoErp(1)).toBe(0.01);
    expect(valorDoErp(999)).toBe(9.99);
  });

  it('quantidade zero ou fracionária não quebra o item', () => {
    /* Quantidade zero num item existe em pedido estragado, e "0 vezes" não
       existe em nota: vira 1, e o valor total acompanha. */
    const { corpo } = montarDocumento(pedido({
      itens: [{ nome: 'X', quantidade: 0, precoUnitarioCentavos: 1000, variacaoErp: 5 }],
    }), config);
    const item = (corpo?.mercadoriaLista as Array<Record<string, unknown>>)[0];
    expect(item.qtd).toBe(1);
    expect(item.valTotalBruto).toBe(10);
  });

  it('a diferença do total é medida, não bloqueia', () => {
    /*
     * A diferença normal é a taxa de entrega. Bloquear por causa dela deixaria
     * toda venda com frete sem nota — mas ela tem que APARECER no log: no dia
     * em que for outra coisa (desconto não registrado, item somado errado), é
     * por aqui que se descobre.
     */
    expect(diferencaDoTotal(pedido({ totalCentavos: 3800 }))).toBe(800);
    expect(diferencaDoTotal(pedido())).toBe(0);
    expect(montarDocumento(pedido({ totalCentavos: 3800 }), config).corpo).not.toBeNull();
  });
});

describe('a forma de pagamento do ERP', () => {
  const formas = [
    { id: 1, nome: 'DINHEIRO' },
    { id: 2, nome: 'CARTAO' },
    { id: 3, nome: 'PIX' },
    { id: 4, nome: 'CARTAO DEBITO' },
  ];

  it('acha por nome, sem ligar para acento nem caixa', () => {
    /* Por NOME e não por número fixo: o "3" da Unimaxx não é o "3" de outra
       loja, e número errado aqui é nota com forma de pagamento errada. */
    expect(acharPagamento(formas, 'pix')).toBe(3);
    expect(acharPagamento(formas, 'dinheiro')).toBe(1);
    expect(acharPagamento(formas, 'cartao_online')).toBe(2);
  });

  it('igualdade exata ganha de "contém"', () => {
    /* Sem isso, "CARTAO DEBITO" poderia ganhar de "CARTAO" numa loja que tem os
       dois — e a nota sairia declarando débito numa venda de crédito. */
    expect(acharPagamento([{ id: 9, nome: 'CARTAO DEBITO' }, { id: 2, nome: 'CARTAO' }], 'cartao_online')).toBe(2);
  });

  it('não achou devolve ZERO, não um chute', () => {
    /*
     * Devolver a primeira da lista "para não falhar" é o caminho para a nota
     * sair com a forma errada — que a SEFAZ autoriza, porque o código é válido,
     * e que só aparece numa fiscalização. Zero vira impedimento.
     */
    expect(acharPagamento(formas, 'vale_refeicao')).toBe(0);
    expect(acharPagamento([], 'pix')).toBe(0);
  });
});

describe('o id do documento criado', () => {
  it('aceita id, codigo ou idDocumento, na raiz ou dentro de documento', () => {
    /* A resposta da criação não está documentada; o primeiro nome que vier com
       número positivo vale. */
    expect(idDoDocumento({ id: 7 })).toBe(7);
    expect(idDoDocumento({ codigo: 8 })).toBe(8);
    expect(idDoDocumento({ idDocumento: 9 })).toBe(9);
    expect(idDoDocumento({ documento: { id: 10 } })).toBe(10);
  });

  it('sem id devolve zero, e quem chama não segue', () => {
    /*
     * Seguir para `transformar` com id zero chamaria `/documento/0/transformar`
     * — que no melhor caso dá 404 e no pior mexe noutro documento.
     */
    expect(idDoDocumento({})).toBe(0);
    expect(idDoDocumento(null)).toBe(0);
    expect(idDoDocumento({ id: 0 })).toBe(0);
    expect(idDoDocumento({ id: 'abc' })).toBe(0);
  });
});

describe('o funil da nota', () => {
  const fonte = (a: string) => fs.readFileSync(path.join(__dirname, a), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a rota do entregador chama o FUNIL, não a emissão do servidor', () => {
    /*
     * Chamar `emitirNfcePedido` direto fazia cada emissor novo virar uma
     * alteração em todos os pontos de chamada — foi assim que o pedido 88 saiu
     * para entrega sem cobrança nenhuma.
     */
    const f = fonte('rotas/entregador.ts');
    expect(f).toContain('emitirNotaDoPedido(');
    expect(f).not.toContain('emitirNfcePedido(');
  });

  it('o funil trata os três emissores', () => {
    const f = fonte('rotas/lojista.ts');
    const i = f.indexOf('export async function emitirNotaDoPedido');
    expect(i).toBeGreaterThan(0);
    const corpo = f.slice(i, i + 1400);
    expect(corpo).toContain("emissor === 'erp'");
    expect(corpo).toContain("emissor === 'maquininha'");
    expect(corpo).toContain('emitirNfcePedido(pedidoId)');
  });

  it('a criação do documento só acontece com a coluna em zero', () => {
    /* `POST /documento` não é idempotente: duas chamadas = dois documentos, dois
       números da sequência fiscal queimados. */
    const f = fonte('maxxgestao-emitir.ts');
    const i = f.indexOf('maxxgestao_documento_id) > 0');
    const j = f.indexOf("'/api/documento/v1'");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it('o id do documento é gravado assim que ele existe', () => {
    /*
     * `POST /documento` não é idempotente: duas chamadas criam dois documentos
     * para a mesma venda. A marca é o que impede a segunda.
     */
    const f = fonte('maxxgestao-emitir.ts');
    const criacao = f.indexOf("'/api/documento/v1'");
    const marca = f.indexOf('UPDATE pedidos SET maxxgestao_documento_id = ?');
    expect(criacao).toBeGreaterThan(0);
    expect(marca).toBeGreaterThan(criacao);
  });

  it('NÃO transforma nem emite: isso é do ERP', () => {
    /*
     * Decisão do dono do projeto, e a certa: natureza de operação, forma de
     * pagamento e tributação são cadastro do ERP. Cada uma que tentássemos
     * resolver daqui seria palpite sobre dado que não é nosso — e foi
     * justamente a forma de pagamento que bloqueava o pedido de chegar lá.
     */
    const f = fonte('maxxgestao-emitir.ts');
    expect(f).not.toContain('/transformar/v1');
    expect(f).not.toContain('/emitir/v1');
  });
});

describe('a hora que vai no documento é de Brasília', () => {
  /*
   * Os documentos do ERP vêm SEM FUSO, em hora local
   * ("2026-09-02T11:12:22.521"). Mandar UTC coloca o pedido três horas no
   * futuro: um pedido das 18h aparece às 21h no Gestão e, depois das 21h, cai
   * no dia seguinte — o relatório do dia fecha errado.
   */
  it('desloca 3 horas e tira o Z', () => {
    /* 2026-09-02T18:35:00Z é 15:35 em Brasília. */
    expect(agoraBrasiliaIso(Date.parse('2026-09-02T18:35:00.000Z'))).toBe('2026-09-02T15:35:00.000');
  });

  it('vira o dia para trás quando é de madrugada em UTC', () => {
    /* 01:00Z do dia 3 é 22:00 do dia 2 no Brasil — e é justo esse caso que
       faria a venda cair no dia errado no relatório do ERP. */
    expect(agoraBrasiliaIso(Date.parse('2026-09-03T01:00:00.000Z'))).toBe('2026-09-02T22:00:00.000');
  });

  it('não sobra Z nenhum: Z num valor local é mentira de fuso', () => {
    expect(agoraBrasiliaIso(Date.now())).not.toContain('Z');
  });

  it('o envio usa a hora de Brasília, não agoraUTC', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'maxxgestao-emitir.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('dataHora: agoraBrasiliaIso()');
    expect(fonte).not.toContain('dataHora: agoraUTC()');
  });
});
