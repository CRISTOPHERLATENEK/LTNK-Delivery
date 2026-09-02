import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  montarDocumento, valorDoErp, diferencaDoTotal,
  type DadosDoPedido, type ConfigDocumento,
} from './maxxgestao-documento';
import { acharPagamento, idDoDocumento, chaveDoXml } from './maxxgestao-emitir';

const config: ConfigDocumento = {
  idNaturezaOperacao: 1,
  idPessoa: 5,
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

  it('retirada e entrega viram R e E', () => {
    expect((montarDocumento(pedido({ tipoEntrega: 'retirada' }), config).corpo?.pedido as Record<string, unknown>).tipoEntrega).toBe('R');
    expect((montarDocumento(pedido(), config).corpo?.pedido as Record<string, unknown>).tipoEntrega).toBe('E');
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

  it('forma de pagamento sem correspondente impede', () => {
    /*
     * É o `idPagamento` do ERP que carrega o `tPag` da nota. Mandar zero, ou o
     * primeiro da lista "para não falhar", daria uma nota com forma de pagamento
     * errada — que a SEFAZ autoriza, porque o código é válido, e que só aparece
     * numa fiscalização.
     */
    const m = montarDocumento(pedido(), { ...config, idPagamento: 0 });
    expect(m.corpo).toBeNull();
    expect(m.impedimentos.join(' ')).toContain('pix');
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
      { ...config, idPagamento: 0, idNaturezaOperacao: 0 },
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

  it('o id do documento é gravado ANTES de transformar e emitir', () => {
    /* Se transformar ou emitir falharem, a próxima tentativa tem que continuar
       deste documento — nunca criar outro. */
    const f = fonte('maxxgestao-emitir.ts');
    const marca = f.indexOf('UPDATE pedidos SET maxxgestao_documento_id = ?');
    const transformar = f.indexOf('/transformar/v1');
    expect(marca).toBeGreaterThan(0);
    expect(transformar).toBeGreaterThan(marca);
  });
});

describe('a chave da NFC-e no XML', () => {
  /*
   * Sem guardar a chave, o pedido fica com um "documento 312" que só existe
   * dentro do ERP: quem precisa achar a nota depois — o contador, o cliente que
   * pediu, a conferência do mês — não tem por onde começar.
   */
  const DA_NOTA = '4'.repeat(44);
  const DO_PROTOCOLO = '9'.repeat(44);

  it('acha no atributo Id da infNFe', () => {
    expect(chaveDoXml(`<infNFe Id="NFe${DA_NOTA}" versao="4.00">`)).toBe(DA_NOTA);
  });

  it('acha na tag chNFe do protocolo', () => {
    expect(chaveDoXml(`<protNFe><infProt><chNFe>${DO_PROTOCOLO}</chNFe></infProt></protNFe>`)).toBe(DO_PROTOCOLO);
  });

  it('a tag do protocolo tem prioridade', () => {
    /* Um XML com nota e protocolo juntos traz as duas; a do protocolo é a que
       voltou autorizada pela SEFAZ. */
    expect(chaveDoXml(`<infNFe Id="NFe${DA_NOTA}"><chNFe>${DO_PROTOCOLO}</chNFe>`)).toBe(DO_PROTOCOLO);
  });

  it('sem chave devolve vazio, não lixo', () => {
    /* Devolver pedaço de string faria o pedido guardar uma chave inválida — e
       chave inválida é pior que ausente, porque parece resposta. */
    expect(chaveDoXml('<xml>sem chave</xml>')).toBe('');
    expect(chaveDoXml('')).toBe('');
    /*
     * 43 dígitos não é chave, NOS DOIS CAMINHOS. A primeira versão deste teste
     * só cobria a tag; sabotei o atributo `Id` para aceitar `\d+` e ela
     * continuou passando, ou seja, um `Id="NFe123"` viraria chave de 3 dígitos
     * gravada no pedido.
     */
    expect(chaveDoXml(`<chNFe>${'1'.repeat(43)}</chNFe>`)).toBe('');
    expect(chaveDoXml(`<infNFe Id="NFe${'1'.repeat(43)}">`)).toBe('');
    expect(chaveDoXml('<infNFe Id="NFe123">')).toBe('');
  });
});
