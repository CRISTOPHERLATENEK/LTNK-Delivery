import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  montarDocumento, valorDoErp, diferencaDoTotal, modeloValido, MODELOS_DOCUMENTO,
  type DadosDoPedido, type ConfigDocumento,
} from './maxxgestao-documento';
import { acharPagamento, idDoDocumento, agoraBrasiliaIso, chaveDaResposta } from './maxxgestao-emitir';

const config: ConfigDocumento = {
  idNaturezaOperacao: 1,
  idPessoa: 5,
  idUsuario: 5470,
  idPagamento: 3,
  modelo: 'PA',
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
  it('monta como PEDIDO DE VENDA (PA), não pré-venda', () => {
    const { corpo, impedimentos } = montarDocumento(pedido(), config);
    expect(impedimentos).toEqual([]);
    expect(corpo?.documento).toEqual({
      idNaturezaOperacao: 1,
      idUsuario: 5470,
      /* `PA` = Pedido de Venda, lido do ERP: criei um documento de cada valor
         aceito (PA, PV, OC, CN) e conferi o `modeloDescricao` de volta. */
      modelo: 'PA',
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
    expect(corpo?.pagamentoLista).toEqual([
      { idSequencia: 1, idPagamento: 3, valor: 30, valAcrescimo: 0, valDesconto: 0 },
    ]);
    /* A parcela acompanha: pagamento e parcela em valores diferentes é
       documento que não fecha. */
    const parcela = (corpo?.parcelaLista as Array<Record<string, unknown>>)[0];
    expect(parcela.valParcela).toBe(30);
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

  it('com forma resolvida, vão as TRÊS listas do financeiro', () => {
    /*
     * O ERP recusa `pagamentoLista` sozinha: "Quando houver pagamento
     * informado, deve existir pelo menos uma parcela". Ele quer a parcela (o
     * que se deve) e o vínculo parcela ↔ pagamento (o que foi recebido) — sem a
     * parcela, o valor entraria como recebimento sem contrapartida.
     */
    const m = montarDocumento(pedido(), config);
    expect(m.corpo?.pagamentoLista).toEqual([
      { idSequencia: 1, idPagamento: 3, valor: 30, valAcrescimo: 0, valDesconto: 0 },
    ]);
    expect(m.corpo?.parcelaLista).toEqual([
      { idSequencia: 1, idParcela: 1, valBase: 30, valParcela: 30, dtVencimento: '2026-09-02', status: 'B' },
    ]);
    expect(m.corpo?.parcelaPagamentoLista).toEqual([
      { idSequencia: 1, idParcela: 1, idSequenciaPagamento: 1, idPagamento: 3, dtPagamento: '2026-09-02', valPagamento: 30 },
    ]);
  });

  it('a parcela vai BAIXADA, não pendente', () => {
    /*
     * O documento só é mandado quando o pedido fecha, então o dinheiro já
     * entrou. Pendente criaria uma conta a receber que ninguém vai receber —
     * porque já foi paga. (Valores aceitos: P, B ou C.)
     */
    const parcela = (montarDocumento(pedido(), config).corpo?.parcelaLista as Array<Record<string, unknown>>)[0];
    expect(parcela.status).toBe('B');
  });

  it('sem forma, nenhuma das três listas vai', () => {
    /* Parcela sem pagamento seria conta a receber inventada. */
    const m = montarDocumento(pedido(), { ...config, idPagamento: 0 });
    expect(m.corpo).not.toHaveProperty('pagamentoLista');
    expect(m.corpo).not.toHaveProperty('parcelaLista');
    expect(m.corpo).not.toHaveProperty('parcelaPagamentoLista');
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

  it('não transforma nem emite SEM a loja ter ligado', () => {
    /*
     * ESTE TESTE MUDOU DE LADO, e vale registrar por quê.
     *
     * Ele garantia que `transformar` e `emitir` NUNCA fossem chamados — era a
     * decisão de então: "a parte fiscal a gente resolve lá". Depois veio o
     * pedido oposto: emitir automático ao enviar. As duas coisas convivem
     * porque a emissão passou a ser OPCIONAL e nasce desligada.
     *
     * O que continua garantido é o essencial: nada é emitido sem alguém ter
     * ligado, e o padrão é o pedido chegar no ERP para ser faturado lá.
     */
    const f = fonte('maxxgestao-emitir.ts');
    const iCondicao = f.indexOf('Number(loja?.maxxgestao_auto_emitir ?? 0) === 1');
    const iChamada = f.indexOf('emitirDocumentoNoErp(token, documento, pedidoId');
    expect(iCondicao).toBeGreaterThan(0);
    expect(iChamada).toBeGreaterThan(iCondicao);
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

describe('o modelo do documento', () => {
  /*
   * O MODELO VIROU ESCOLHA DO LOJISTA, e três testes daqui mudaram de lado.
   *
   * Eles garantiam "é PA e NUNCA PV". Era a decisão certa naquele momento: o
   * envio estava indo como PV, os pedidos apareceram no Gestão como
   * "Pré-Venda", e isso era erro — o lojista pediu Pedido de Venda.
   *
   * O que mudou não foi a opinião: apareceu um segundo leitor do mesmo
   * documento. O PDV da própria Maxx Gestão (MeuChef) puxa uma fila só, e qual
   * modelo entra nela varia por instalação — nem a documentação nem a API
   * dizem. Travar `PA` no código obrigava um deploy por tentativa para
   * descobrir.
   *
   * O que continua garantido é o que importa: `PA` é o padrão, `OC` e `CN`
   * nunca são possíveis, e valor estranho no banco não vira documento estranho.
   *
   * Os quatro valores foram lidos do próprio ERP, criando um documento de cada
   * e conferindo o `modeloDescricao`: PA Pedido de Venda, PV Pré-Venda, OC
   * Orçamento, CN Condicional. A documentação só lista as siglas.
   */
  it('usa o modelo que a config manda', () => {
    const doc = (m: 'PA' | 'PV') =>
      (montarDocumento(pedido(), { ...config, modelo: m }).corpo?.documento as Record<string, unknown>).modelo;
    expect(doc('PA')).toBe('PA');
    expect(doc('PV')).toBe('PV');
  });

  it('PA é o padrão, e valor estranho NÃO vira documento estranho', () => {
    /*
     * `modeloValido` é a peneira entre o banco e o corpo do documento. Sem
     * ela, uma coluna com lixo (migração torta, edição no MySQL, valor de uma
     * versão futura) subiria como modelo inexistente — e o ERP recusaria o
     * pedido inteiro, sem ninguém entender por quê.
     */
    for (const lixo of [null, undefined, '', 'XX', 'OC', 'CN', 'pa ', 'oc']) {
      expect(['PA', 'PV']).toContain(modeloValido(lixo));
    }
    expect(modeloValido(null)).toBe('PA');
    expect(modeloValido('OC')).toBe('PA');
    expect(modeloValido('CN')).toBe('PA');
    /* Minúscula e espaço são digitação, não valor novo: aceita. */
    expect(modeloValido('pv')).toBe('PV');
    expect(modeloValido(' pa ')).toBe('PA');
  });

  it('só existem DOIS modelos, e nenhum deles é orçamento', () => {
    /*
     * A API aceita `OC` (Orçamento) e `CN` (Condicional). Ficaram fora porque
     * nenhum dos dois é venda fechada: orçamento é proposta, condicional é
     * mercadoria que pode voltar. Pedido pago no app entrando como um desses
     * viraria venda que o faturamento do lojista não reconhece — e ele
     * descobriria pelo caixa não fechando.
     */
    expect([...MODELOS_DOCUMENTO]).toEqual(['PA', 'PV']);
  });

  it('a rota recusa modelo inválido em vez de cair no padrão', () => {
    /*
     * Aqui é escolha explícita de gente. Gravar `PA` silenciosamente quando
     * pediram outra coisa faria o lojista concluir que o ajuste não funciona.
     * (No BANCO é o contrário: lá o padrão protege o envio.)
     */
    const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
    const i = rotas.indexOf("router.put('/erp/modelo'");
    expect(i).toBeGreaterThan(0);
    const t = rotas.slice(i, i + 1200);
    expect(t).toContain('MODELOS_DOCUMENTO');
    expect(t).toMatch(/status\(400\)/);
    expect(t).toContain('UPDATE lojas SET maxxgestao_modelo = ?');
  });

  it('o envio usa a coluna da loja, não uma constante', () => {
    const emitir = fs.readFileSync(path.join(__dirname, 'maxxgestao-emitir.ts'), 'utf8');
    expect(emitir).toContain('modelo: modeloValido(loja?.maxxgestao_modelo)');
    expect(emitir).toContain('maxxgestao_modelo');
  });
});

describe('a emissão automática no ERP', () => {
  /*
   * Dois passos: `transformar` (modelo 65 = NFC-e) e `emitir`. Medido na conta
   * real: o transformar devolve `numero: 0` e `chave: ""` — ele NÃO consome
   * número da sequência fiscal. O número e a chave nascem no emitir, e é só
   * esse passo que não tem volta.
   */
  const semComentarios = (arq: string) => fs.readFileSync(path.join(__dirname, arq), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const emitir = semComentarios('maxxgestao-emitir.ts');

  it('transforma para 65 (NFC-e), não 55', () => {
    /* 55 é NF-e, documento de outra operação. */
    expect(emitir).toContain("modelo: '65'");
    expect(emitir).not.toContain("modelo: '55'");
  });

  it('transforma ANTES de emitir', () => {
    const t = emitir.indexOf('/transformar/v1');
    const e = emitir.indexOf('/emitir/v1');
    expect(t).toBeGreaterThan(0);
    expect(e).toBeGreaterThan(t);
  });

  it('nasce DESLIGADA no banco', () => {
    /*
     * O único campo desta integração que precisa nascer desligado: ligado, o
     * gatilho da nota passa a ser o clique de "Já entreguei", sem revisão.
     */
    const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');
    expect(schema).toContain("maxxgestao_auto_emitir TINYINT NOT NULL DEFAULT 0");
  });

  it('só roda quando a loja ligou', () => {
    expect(emitir).toContain("Number(loja?.maxxgestao_auto_emitir ?? 0) === 1");
  });

  it('falha na emissão NÃO desfaz o envio do pedido', () => {
    /*
     * O documento já existe no ERP. Propagar o erro faria a próxima tentativa
     * querer CRIAR outro documento para a mesma venda.
     */
    const i = emitir.indexOf('emitirDocumentoNoErp(token, documento, pedidoId, opcoes)');
    expect(i).toBeGreaterThan(0);
    const depois = emitir.slice(i, i + 120);
    expect(depois).toContain('return { emitiu: true, documento }');
  });

  it('a chave só é aceita com 44 dígitos', () => {
    /* Chave curta gravada no pedido é pior que chave ausente: parece resposta. */
    expect(chaveDaResposta({ chave: '4'.repeat(44) })).toBe('4'.repeat(44));
    expect(chaveDaResposta({ chave: '' })).toBe('');
    expect(chaveDaResposta({ chave: '123' })).toBe('');
    expect(chaveDaResposta(null)).toBe('');
  });

  it('desligar o emissor desliga a auto-emissão', () => {
    /*
     * Deixá-la ligada num emissor que não é o ERP guardaria uma bomba: bastaria
     * religar o emissor meses depois e as notas sairiam sozinhas, sem ninguém
     * ter pedido isso naquele momento.
     */
    const rotas = semComentarios(path.join('rotas', 'lojista.ts'));
    expect(rotas).toContain("SET nfce_emissor = ?, maxxgestao_auto_emitir = 0");
  });

  it('não dá para ligar a auto-emissão sem o ERP como emissor', () => {
    const rotas = semComentarios(path.join('rotas', 'lojista.ts'));
    const i = rotas.indexOf("router.put('/erp/auto-emitir'");
    expect(i).toBeGreaterThan(0);
    expect(rotas.slice(i, i + 900)).toContain("!== 'erp'");
  });
});
