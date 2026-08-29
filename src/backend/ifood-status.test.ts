import { describe, it, expect } from 'vitest';
import {
  acaoParaStatus, caminhoDaAcao, statusParaEvento, vaiAdiantarTentarDeNovo,
  segundosParaConfirmar, MINUTOS_PARA_CONFIRMAR,
  escolherMotivoCancelamento, ehFalhaDeCancelamento, motivoDaRecusaDeCancelamento,
} from './ifood-status';

describe('acaoParaStatus — o que avisar ao iFood', () => {
  it('aceitar confirma, e é o aviso com prazo', () => {
    expect(acaoParaStatus('aceito', 'entrega')).toBe('confirm');
    expect(acaoParaStatus('aceito', 'retirada')).toBe('confirm');
  });

  it('iniciar preparo avisa o preparo', () => {
    expect(acaoParaStatus('preparando', 'entrega')).toBe('startPreparation');
  });

  it('PRONTO depende do tipo de entrega — e trocar não dá erro', () => {
    /*
     * O erro que fica invisível: `readyToPickup` e `dispatch` devolvem 202 os
     * dois. Chamar o errado não falha — o pedido só trava na tela do cliente,
     * e ninguém liga uma coisa à outra.
     */
    expect(acaoParaStatus('pronto', 'retirada')).toBe('readyToPickup');
    /* Em entrega própria, "pronto" ainda não saiu: quem avisa é o despacho. */
    expect(acaoParaStatus('pronto', 'entrega')).toBeNull();
  });

  it('despachar só existe em entrega', () => {
    /* Mandar dispatch num pedido de retirada é dizer que saiu para entrega
       algo que ninguém levou. */
    expect(acaoParaStatus('em_entrega', 'entrega')).toBe('dispatch');
    expect(acaoParaStatus('em_entrega', 'retirada')).toBeNull();
  });

  it('cancelar e recusar pedem cancelamento', () => {
    expect(acaoParaStatus('cancelado', 'entrega')).toBe('requestCancellation');
    expect(acaoParaStatus('recusado', 'entrega')).toBe('requestCancellation');
  });

  it('pendente e entregue não avisam nada', () => {
    /* 'pendente' é como ele nasce; 'entregue' o iFood conclui sozinho depois de
       4h. Inventar chamada para cada status seria pedir 404 e encher o log. */
    expect(acaoParaStatus('pendente', 'entrega')).toBeNull();
    expect(acaoParaStatus('entregue', 'entrega')).toBeNull();
  });
});

describe('caminhoDaAcao', () => {
  it('monta o endpoint documentado', () => {
    expect(caminhoDaAcao('ord_1', 'confirm')).toBe('/order/v1.0/orders/ord_1/confirm');
    expect(caminhoDaAcao('ord_1', 'startPreparation')).toBe('/order/v1.0/orders/ord_1/startPreparation');
  });

  it('escapa o id', () => {
    expect(caminhoDaAcao('a/b', 'confirm')).toContain('a%2Fb');
  });
});

describe('statusParaEvento — o que o iFood nos conta', () => {
  it('cancelamento vindo do cliente PARA a produção', () => {
    /* Sem isto a cozinha continua montando e o entregador sai com um pedido
       que não existe mais. */
    expect(statusParaEvento('CAN')).toBe('cancelado');
    expect(statusParaEvento('', 'CANCELLED')).toBe('cancelado');
  });

  it('CONCLUDED encerra o pedido', () => {
    /* É a única forma de o pedido sair da tela sem alguém marcar: o iFood
       conclui sozinho depois de 4h em entrega própria. */
    expect(statusParaEvento('CON')).toBe('entregue');
  });

  it('CONFIRMED NÃO volta status — é eco do nosso próprio comando', () => {
    /*
     * Aplicar de volta o eco é como o pedido volta para um estado que já
     * passou: nós confirmamos, mudamos para 'preparando', e o CONFIRMED
     * atrasado chegaria mandando voltar para 'aceito'.
     */
    expect(statusParaEvento('CFM')).toBeNull();
    expect(statusParaEvento('', 'CONFIRMED')).toBeNull();
  });

  it('evento desconhecido não muda nada', () => {
    for (const c of ['XPTO', '', 'PLC', 'DSP']) expect(statusParaEvento(c)).toBeNull();
  });

  it('não depende de caixa nem espaço', () => {
    expect(statusParaEvento(' can ')).toBe('cancelado');
  });
});

describe('vaiAdiantarTentarDeNovo', () => {
  it('rede, limite, erro deles e token vencido: vale repetir', () => {
    /* Desistir por oscilação de rede com os 8 minutos correndo é perder o
       pedido por nada. */
    for (const c of [0, 429, 500, 502, 503, 401]) expect(vaiAdiantarTentarDeNovo(c)).toBe(true);
  });

  it('409 NÃO vale repetir — o pedido já passou desse estado', () => {
    /* Insistir num pedido que o iFood já cancelou é caminho para bloqueio. */
    expect(vaiAdiantarTentarDeNovo(409)).toBe(false);
  });

  it('400 e 404 também não', () => {
    expect(vaiAdiantarTentarDeNovo(400)).toBe(false);
    expect(vaiAdiantarTentarDeNovo(404)).toBe(false);
  });
});

describe('prazo de confirmação', () => {
  it('são 8 minutos, e o número é da documentação', () => {
    expect(MINUTOS_PARA_CONFIRMAR).toBe(8);
  });

  it('conta o tempo restante', () => {
    const criado = '2026-08-29T12:00:00.000Z';
    const agora = new Date('2026-08-29T12:03:00.000Z');
    expect(segundosParaConfirmar(criado, agora)).toBe(300);
  });

  it('fica NEGATIVO depois do prazo', () => {
    /* Precisa ser negativo e não zero: quem chama tem que conseguir distinguir
       "acabou agora" de "passou faz tempo" para decidir se ainda tenta. */
    const criado = '2026-08-29T12:00:00.000Z';
    const agora = new Date('2026-08-29T12:10:00.000Z');
    expect(segundosParaConfirmar(criado, agora)).toBe(-120);
  });

  it('data ilegível vira zero, não NaN', () => {
    expect(segundosParaConfirmar('ontem', new Date())).toBe(0);
  });
});

describe('escolherMotivoCancelamento', () => {
  const LISTA = [
    { code: '501', description: 'PROBLEMAS DE SISTEMA' },
    { code: '503', description: 'ITEM INDISPONÍVEL' },
    { code: '508', description: 'FORA DO HORÁRIO DO DELIVERY' },
  ];

  it('usa o texto do lojista como dica', () => {
    expect(escolherMotivoCancelamento(LISTA, 'acabou o queijo')).toBe('503');
    expect(escolherMotivoCancelamento(LISTA, 'já fechamos')).toBe('508');
    expect(escolherMotivoCancelamento(LISTA, 'o sistema travou')).toBe('501');
  });

  it('funciona com e sem acento', () => {
    /* As descrições vêm em caixa alta e com acento; o lojista escreve de
       qualquer jeito. Normalizar os dois lados é o que faz a dica servir. */
    expect(escolherMotivoCancelamento(LISTA, 'ITEM INDISPONIVEL')).toBe('503');
    expect(escolherMotivoCancelamento(LISTA, 'produto esgotado')).toBe('503');
  });

  it('sem correspondência, usa o PRIMEIRO da lista', () => {
    /* Cancelar com motivo genérico é melhor que não cancelar — o cliente
       precisa saber que não vem comida. */
    expect(escolherMotivoCancelamento(LISTA, 'sei lá')).toBe('501');
    expect(escolherMotivoCancelamento(LISTA, '')).toBe('501');
  });

  it('NUNCA inventa código fora da lista do pedido', () => {
    /*
     * A regra central: a lista varia POR PEDIDO — depende do momento e da
     * política da loja. Um código válido em geral, mas ausente da lista
     * daquele pedido, é recusado. A doc manda usar só o que ela devolveu.
     */
    const so503 = [{ code: '503', description: 'ITEM INDISPONÍVEL' }];
    expect(escolherMotivoCancelamento(so503, 'o sistema caiu')).toBe('503');
    expect(escolherMotivoCancelamento(so503, 'já fechamos')).toBe('503');
  });

  it('lista vazia é null — o pedido não pode ser cancelado agora', () => {
    /* 204 do /cancellationReasons = "nenhuma política encontrada". Não é erro,
       é "não dá". */
    expect(escolherMotivoCancelamento([], 'qualquer coisa')).toBeNull();
  });
});

describe('ehFalhaDeCancelamento', () => {
  it('reconhece a recusa', () => {
    expect(ehFalhaDeCancelamento('CARF')).toBe(true);
    expect(ehFalhaDeCancelamento('', 'CANCELLATION_REQUEST_FAILED')).toBe(true);
  });

  it('CANCELLED não é falha — é o sucesso', () => {
    /* Confundir os dois é o pior erro possível aqui: trataria o cancelamento
       bem-sucedido como problema, ou pior, o contrário. */
    expect(ehFalhaDeCancelamento('CAN')).toBe(false);
    expect(ehFalhaDeCancelamento('', 'CANCELLED')).toBe(false);
  });
});

describe('motivoDaRecusaDeCancelamento', () => {
  it('cada código vira uma AÇÃO diferente', () => {
    /* O lojista está com o cliente esperando. "Deu erro" não ajuda: prazo
       vencido manda falar com o suporte, cancelamento em andamento manda
       esperar. */
    expect(motivoDaRecusaDeCancelamento('OrderExceededCancellationDeadline', '')).toContain('prazo');
    expect(motivoDaRecusaDeCancelamento('OrderHasACancellationInProgress', '')).toContain('andamento');
    expect(motivoDaRecusaDeCancelamento('OrderNotFound', '')).toContain('não encontrou');
  });

  it('código desconhecido cai na mensagem da API', () => {
    expect(motivoDaRecusaDeCancelamento('XPTO', 'Algo específico')).toBe('Algo específico');
  });

  it('nunca devolve vazio', () => {
    expect(motivoDaRecusaDeCancelamento('', '').length).toBeGreaterThan(10);
  });
});
