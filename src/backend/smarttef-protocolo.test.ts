import { describe, it, expect } from 'vitest';
import {
  valorParaApi, situacaoDeStatus, situacaoFinal, lerTransacao, mensagemDeErro,
} from './smarttef-protocolo';

describe('valorParaApi', () => {
  it('converte centavos em decimal', () => {
    expect(valorParaApi(6990)).toBe(69.9);
    expect(valorParaApi(100)).toBe(1);
    expect(valorParaApi(1)).toBe(0.01);
  });

  it('não acumula erro binário em valores grandes', () => {
    /* O motivo do toFixed(2). Sem ele, divisões por 100 em valores altos
       chegariam com cauda binária, e a maquininha cobraria o que recebeu. */
    for (const c of [999999, 1234567, 8999999, 100000000]) {
      const v = valorParaApi(c);
      expect(Math.round(v * 100)).toBe(c);
      /* No máximo duas casas DEPOIS da vírgula. A regex antes olhava a string
         inteira e acusava R$ 1.000.000,00 ("1000000"), que é um inteiro
         legítimo — a cauda binária que interessa é 69.90000000000001. */
      const casas = String(v).split('.')[1] ?? '';
      expect(casas.length).toBeLessThanOrEqual(2);
    }
  });

  it('o valor sempre volta a ser o mesmo centavo', () => {
    /* Ida e volta em toda faixa que um pedido tem — de R$ 0,01 a R$ 100 mil. */
    for (let c = 1; c <= 10_000_000; c = Math.ceil(c * 1.37)) {
      expect(Math.round(valorParaApi(c) * 100)).toBe(c);
    }
  });

  it('recusa centavo fracionado', () => {
    /* Chega assim quando alguém divide um total (conta rachada, desconto
       proporcional) e não arredonda. A maquininha cobraria o arredondado
       enquanto o pedido guarda outro — some na conciliação. */
    expect(() => valorParaApi(1050.5)).toThrow();
  });

  it('recusa zero e negativo', () => {
    expect(() => valorParaApi(0)).toThrow();
    expect(() => valorParaApi(-100)).toThrow();
  });

  it('recusa NaN e Infinity', () => {
    /* `Number(undefined)` vira NaN silenciosamente lá em cima; aqui ele para. */
    expect(() => valorParaApi(NaN)).toThrow();
    expect(() => valorParaApi(Infinity)).toThrow();
  });
});

describe('situacaoDeStatus', () => {
  it('CNC é aprovado', () => {
    expect(situacaoDeStatus('CNC')).toBe('aprovado');
  });

  it('os pendentes continuam pendentes', () => {
    for (const s of ['PDT', 'PROC', 'PROC_PAG', 'SOL_EST', 'PROC_EST']) {
      expect(situacaoDeStatus(s)).toBe('pendente');
    }
  });

  it('REJ_EST é RECUSADO, não estornado', () => {
    /* Estorno recusado = o dinheiro continua com a loja. Mapear para
       'estornado' devolveria mercadoria e dinheiro. */
    expect(situacaoDeStatus('REJ_EST')).toBe('recusado');
    expect(situacaoDeStatus('EST')).toBe('estornado');
  });

  it('CAN_ERP é cancelado, e cancelado não é recusado', () => {
    /* Recusado = o cartão não passou. Cancelado = nós desistimos. O operador
       precisa saber qual dos dois pra saber se tenta de novo. */
    expect(situacaoDeStatus('CAN_ERP')).toBe('cancelado');
  });

  it('status desconhecido é PENDENTE, nunca aprovado', () => {
    /* A regra que mais importa: um código novo numa versão futura da API não
       pode fazer mercadoria sair pela porta. Pendente faz consultar de novo. */
    for (const s of ['XPTO', '', null, undefined, 42, {}, 'APROVADO', 'OK']) {
      expect(situacaoDeStatus(s)).toBe('pendente');
    }
  });

  it('não depende de caixa nem de espaço', () => {
    expect(situacaoDeStatus(' cnc ')).toBe('aprovado');
    expect(situacaoDeStatus('rej_pag')).toBe('recusado');
  });
});

describe('situacaoFinal', () => {
  it('só pendente não é final', () => {
    expect(situacaoFinal('pendente')).toBe(false);
    for (const s of ['aprovado', 'recusado', 'cancelado', 'estornado'] as const) {
      expect(situacaoFinal(s)).toBe(true);
    }
  });
});

describe('lerTransacao', () => {
  const COMPLETA = {
    status: 'CNC',
    nsu_host: '123456',
    autorization_code: 'A1B2C3',
    card_brand: 'VISA',
    acquirer: 'REDE',
    acquirer_cnpj: '01.425.787/0001-04',
    payment_type: 'debit',
  };

  it('lê a transação concluída', () => {
    expect(lerTransacao(COMPLETA)).toEqual({
      situacao: 'aprovado',
      nsu: '123456',
      autorizacao: 'A1B2C3',
      bandeira: 'VISA',
      adquirente: 'REDE',
      adquirenteCnpj: '01425787000104',
      tipo: 'DEBIT',
    });
  });

  it('lê dentro do envelope {status, data} também', () => {
    expect(lerTransacao({ status: 200, data: COMPLETA }).nsu).toBe('123456');
  });

  it('campo null vira vazio, que é o default da coluna', () => {
    /* A doc avisa: esses campos vêm null até o fim do processamento. Consulta
       cedo demais é o caso normal, não erro. */
    const cedo = lerTransacao({ status: 'PROC_PAG', nsu_host: null, acquirer: null, card_brand: null });
    expect(cedo.situacao).toBe('pendente');
    expect(cedo.nsu).toBe('');
    expect(cedo.bandeira).toBe('');
  });

  it('resposta vazia ou inválida não quebra', () => {
    for (const c of [null, undefined, 'texto', 42, []]) {
      expect(lerTransacao(c).situacao).toBe('pendente');
    }
  });

  it('lê "autorization_code" com a grafia da API', () => {
    /* Está sem o segundo "h" na API mesmo. "Corrigir" aqui seria procurar um
       campo que não existe e gravar autorização vazia em toda venda. */
    expect(lerTransacao({ autorization_code: 'Z9' }).autorizacao).toBe('Z9');
    expect(lerTransacao({ authorization_code: 'Z9' }).autorizacao).toBe('');
  });

  it('limpa a pontuação do CNPJ', () => {
    expect(lerTransacao({ acquirer_cnpj: '01.425.787/0001-04' }).adquirenteCnpj).toBe('01425787000104');
  });
});

describe('mensagemDeErro', () => {
  it('mensagem em string', () => {
    expect(mensagemDeErro({ data: { message: 'Valor inválido' } }, 400)).toBe('Valor inválido');
  });

  it('lista de strings vira uma linha', () => {
    expect(mensagemDeErro({ data: { message: ['Falta valor', 'Falta tipo'] } }, 400))
      .toBe('Falta valor · Falta tipo');
  });

  it('lista de objetos mostra o campo inválido', () => {
    /* Sem isto o operador veria "[object Object]" com o cliente na frente. */
    expect(mensagemDeErro({ data: { message: [{ field: 'value', message: 'obrigatório' }] } }, 400))
      .toBe('value: obrigatório');
  });

  it('sem mensagem, o código HTTP explica o que fazer', () => {
    /* Diferente por código, porque a AÇÃO é diferente: 401 manda conferir
       credencial, 409 diz que a cobrança já existe. */
    expect(mensagemDeErro({}, 401)).toContain('credenciais');
    expect(mensagemDeErro({}, 404)).toContain('não encontrou');
    expect(mensagemDeErro({}, 409)).toContain('já existe');
    expect(mensagemDeErro({}, 500)).toContain('não respondeu');
  });

  it('nunca devolve vazio', () => {
    /* Mensagem vazia vira um toast em branco, que é pior que uma frase genérica. */
    for (const c of [null, undefined, {}, { data: {} }, { data: { message: [] } }, { data: { message: null } }]) {
      expect(mensagemDeErro(c, 500).length).toBeGreaterThan(10);
    }
  });
});
