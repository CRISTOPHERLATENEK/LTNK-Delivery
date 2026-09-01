import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  deveLancarNaMaquininha, statusDeLancamento, idCobrancaDoPedido, descricaoDaCobranca,
  ehPagoOnline, ehJaPago, idPagamentoDoPedido, type ContextoLancamento,
} from './pdvmobi-quando';

const base: ContextoLancamento = {
  formaPagamento: 'cartao_entrega',
  novoStatus: 'em_entrega',
  tefConfigurado: true,
  jaLancado: false,
  tipoEntrega: 'entrega',
  emissorNfce: 'sistema',
  pagamentoAprovado: true,
};

/** A mesma loja, com a maquininha como emissora da NFC-e. */
const fiscal: ContextoLancamento = { ...base, emissorNfce: 'maquininha' };

describe('só cartão na entrega vai para a maquininha', () => {
  it('cartão na entrega, saindo para entrega: lança', () => {
    expect(deveLancarNaMaquininha(base)).toBe(true);
  });

  it('Pix, cartão online e dinheiro NÃO lançam', () => {
    /*
     * A consequência de lançar um pedido já pago não é chamada desperdiçada: o
     * entregador vê a cobrança na maquininha, passa o cartão do cliente, e ele
     * paga duas vezes. As duas cobranças "dão certo" e o sistema não percebe.
     */
    for (const forma of ['pix', 'cartao_online', 'dinheiro']) {
      expect(deveLancarNaMaquininha({ ...base, formaPagamento: forma }), forma).toBe(false);
    }
  });

  it('forma desconhecida não lança', () => {
    /* Forma nova no futuro entra sem cobrança na maquininha até alguém decidir
       que ela deve entrar. O padrão seguro é não cobrar. */
    expect(deveLancarNaMaquininha({ ...base, formaPagamento: 'vale_refeicao' })).toBe(false);
  });
});

describe('o momento', () => {
  it('em entrega, lança na SAÍDA — não no aceite', () => {
    /*
     * Lançar no aceite encheria a lista de precontas com pedidos que ainda estão
     * na cozinha, e o entregador teria que achar o dele no meio.
     */
    expect(statusDeLancamento('entrega')).toBe('em_entrega');
    for (const s of ['aceito', 'preparando', 'pronto'] as const) {
      expect(deveLancarNaMaquininha({ ...base, novoStatus: s }), s).toBe(false);
    }
  });

  it('em retirada, lança quando fica PRONTO', () => {
    /* Em retirada não existe "saiu para entrega": o cliente vem buscar, e o
       pagamento acontece no balcão. */
    expect(statusDeLancamento('retirada')).toBe('pronto');
    expect(deveLancarNaMaquininha({ ...base, tipoEntrega: 'retirada', novoStatus: 'pronto' })).toBe(true);
    expect(deveLancarNaMaquininha({ ...base, tipoEntrega: 'retirada', novoStatus: 'em_entrega' })).toBe(false);
  });

  it('status terminal não lança', () => {
    for (const s of ['entregue', 'cancelado', 'recusado'] as const) {
      expect(deveLancarNaMaquininha({ ...base, novoStatus: s }), s).toBe(false);
    }
  });
});

describe('nunca duas vezes', () => {
  it('pedido já lançado não lança de novo', () => {
    /*
     * A guarda mais importante do arquivo. O `newItem` do PDV MOBI NÃO é
     * idempotente — chamei duas vezes com o mesmo IDCobranca e recebi dois itens
     * na mesma preconta. Sem esta trava, uma reentrada de status dobraria o
     * valor a cobrar do cliente.
     */
    expect(deveLancarNaMaquininha({ ...base, jaLancado: true })).toBe(false);
  });

  it('e a trava vem antes de qualquer outra checagem', () => {
    /* Mesmo com tudo certo, já lançado é não. */
    expect(deveLancarNaMaquininha({
      ...base, jaLancado: true, tefConfigurado: true, formaPagamento: 'cartao_entrega',
    })).toBe(false);
  });
});

describe('maquininha não configurada', () => {
  it('não lança, e não é erro', () => {
    /* Loja sem maquininha é a maioria. O pedido segue normal e o entregador
       cobra como sempre cobrou. */
    expect(deveLancarNaMaquininha({ ...base, tefConfigurado: false })).toBe(false);
  });
});

describe('identificação', () => {
  it('o IDCobranca é o id do pedido', () => {
    /* Um contador próprio seria um segundo número para conciliar — e no dia de
       investigar uma cobrança errada, ninguém quer traduzir "preconta 990020"
       para "pedido 85". */
    expect(idCobrancaDoPedido(85)).toBe(85);
  });

  it('a descrição leva o nome do cliente', () => {
    /* Quem olha a tela do aparelho na porta da casa está conferindo com a
       pessoa à frente, não com o nosso banco. */
    expect(descricaoDaCobranca('Maria Silva', 85)).toBe('Maria Silva');
  });

  it('sem nome, cai no número do pedido', () => {
    expect(descricaoDaCobranca('   ', 85)).toBe('Pedido 85');
  });
});

describe('o encanamento no fluxo do pedido', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'fluxoPedido.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('marca ANTES de chamar, com condição no WHERE', () => {
    /*
     * Marcar depois deixaria a janela entre a chamada e a marca aberta para uma
     * segunda transição lançar de novo. E a condição `tef_lancado_em = ''` é o
     * que segura duas transições simultâneas — duas abas, dois cliques.
     */
    const i = fonte.indexOf("UPDATE pedidos SET tef_lancado_em = ? WHERE id = ? AND tef_lancado_em = ''");
    const j = fonte.indexOf('enviarCobrancaPos(');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it('desiste quando o UPDATE não pegou nenhuma linha', () => {
    /* Outra transição chegou primeiro. Seguir mesmo assim seria a cobrança
       dobrada que a marca existe para impedir. */
    expect(fonte).toContain('if (marcou.changes === 0) return;');
  });

  it('não bloqueia a transição', () => {
    /* Maquininha fora do ar não pode impedir o entregador de sair. */
    const i = fonte.indexOf('lancarPedidoNaMaquininha(pedidoId)');
    expect(i).toBeGreaterThan(0);
    expect(fonte.slice(i, i + 260)).toContain('.catch(');
  });

  it('só desfaz a marca em falha CONHECIDA', () => {
    /*
     * Em queda de rede o lançamento pode ter chegado. Desmarcar aí é o caminho
     * para a cobrança dobrada — por isso a condição de httpStatus > 0.
     */
    expect(fonte).toContain("erro.httpStatus === 'number' && erro.httpStatus > 0");
  });
});

describe('todo caminho que grava em_entrega lança na maquininha', () => {
  const semComentarios = (a: string) => fs.readFileSync(path.join(__dirname, a), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a rota do entregador chama o lançamento', () => {
    /*
     * ESTE É O TESTE QUE FALTAVA. `rotas/entregador.ts` grava `em_entrega` com
     * UPDATE próprio — precisa da transação com trava no entregador para
     * garantir "um entregador, uma corrida" — então não passa por
     * `transicionarStatus`. O comentário de lá afirmava ser "o ponto único por
     * onde TODO status passa", e essa afirmação falsa fez o pedido 88 sair para
     * entrega sem cobrança nenhuma chegar no aparelho.
     */
    expect(semComentarios('rotas/entregador.ts')).toContain('lancarPedidoNaMaquininha(');
  });

  it('nenhum outro arquivo grava em_entrega sem lançar', () => {
    /* Se aparecer um terceiro caminho, este teste falha e obriga a decidir. */
    const dir = path.join(__dirname, 'rotas');
    const culpados: string[] = [];
    for (const arq of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.includes('.test.'))) {
      const fonte = semComentarios(path.join('rotas', arq));
      const grava = /UPDATE pedidos[\s\S]{0,120}status\s*=\s*'em_entrega'/.test(fonte);
      if (grava && !fonte.includes('lancarPedidoNaMaquininha(')) culpados.push(arq);
    }
    expect(culpados).toEqual([]);
  });

  it('a função é exportada para poder ser chamada de fora', () => {
    expect(semComentarios('fluxoPedido.ts')).toContain('export async function lancarPedidoNaMaquininha');
  });

  it('avisa quando era cartão na entrega e a maquininha não está configurada', () => {
    /*
     * Silêncio só quando não era o caso. Foi a ausência de log que fez o
     * diagnóstico do pedido 88 levar meia hora.
     */
    expect(semComentarios('fluxoPedido.ts')).toContain('não está configurada');
  });
});

describe('quando a maquininha é a emissora da NFC-e', () => {
  /*
   * Aqui a maquininha deixa de ser só a cobradora e vira o EMISSOR FISCAL: o
   * servidor não emite mais, o pedido sobe como preconta e o operador conclui
   * no aparelho, que gera a NFC-e. O suporte da POS Controle confirmou por
   * escrito o XML da forma "Faturado": <tPag>99</tPag>.
   *
   * A INVERSÃO QUE ESTE BLOCO PROTEGE: um pedido que não sobe deixa de ser uma
   * cobrança perdida e passa a ser uma VENDA SEM NOTA FISCAL.
   */

  it('todo pedido sobe — inclusive os já pagos no app', () => {
    expect(deveLancarNaMaquininha({ ...fiscal, formaPagamento: 'pix', novoStatus: 'pronto' })).toBe(true);
    expect(deveLancarNaMaquininha({ ...fiscal, formaPagamento: 'cartao_online', novoStatus: 'pronto' })).toBe(true);
    expect(deveLancarNaMaquininha({ ...fiscal, formaPagamento: 'dinheiro' })).toBe(true);
    expect(deveLancarNaMaquininha(fiscal)).toBe(true);
  });

  it('pedido já pago sobe no PRONTO, não na saída', () => {
    /* A nota tem que ir dentro da sacola. Esperar o "saiu para entrega" seria
       pedir ao operador que emitisse o cupom de um pedido já na rua. */
    expect(statusDeLancamento('entrega', true)).toBe('pronto');
    expect(deveLancarNaMaquininha({ ...fiscal, formaPagamento: 'pix', novoStatus: 'em_entrega' })).toBe(false);
  });

  it('cartão na entrega continua subindo na SAÍDA', () => {
    /* Esse ainda vai ser cobrado na porta: o motivo original de esperar a saída
       — não encher a lista com pedidos que ainda estão na cozinha — não mudou. */
    expect(deveLancarNaMaquininha({ ...fiscal, novoStatus: 'pronto' })).toBe(false);
    expect(deveLancarNaMaquininha({ ...fiscal, novoStatus: 'em_entrega' })).toBe(true);
  });

  it('e as travas de sempre continuam valendo', () => {
    /* Emitir nota lá não afrouxa nada: já lançado continua sendo não, e sem
       credencial continua sendo não. */
    expect(deveLancarNaMaquininha({ ...fiscal, jaLancado: true })).toBe(false);
    expect(deveLancarNaMaquininha({ ...fiscal, tefConfigurado: false })).toBe(false);
  });

  it('sem a chave ligada, um pedido já pago NÃO vira cobrança', () => {
    /*
     * A regressão mais cara possível: se o modo fiscal vazasse para as lojas
     * normais, um pedido pago no Pix apareceria como cobrança na mão do
     * entregador e o cliente pagaria duas vezes.
     */
    for (const forma of ['pix', 'cartao_online', 'dinheiro']) {
      expect(deveLancarNaMaquininha({ ...base, formaPagamento: forma, novoStatus: 'pronto' }), forma).toBe(false);
      expect(deveLancarNaMaquininha({ ...base, formaPagamento: forma }), forma).toBe(false);
    }
  });
});

describe('a marca PAGO na tela do aparelho', () => {
  it('pedido já pago chega marcado', () => {
    /*
     * NÃO É ENFEITE. No aparelho, uma preconta já paga fica idêntica a uma
     * cobrança de verdade. Quem está na frente da tela precisa ver, ANTES de
     * escolher a forma, que este é Faturado e não crédito — senão o erro de um
     * toque é o cliente pagando duas vezes pelo mesmo pedido.
     */
    expect(descricaoDaCobranca('Maria Silva', 85, true)).toBe('Maria Silva · PAGO');
    expect(descricaoDaCobranca('   ', 85, true)).toBe('Pedido 85 · PAGO');
  });

  it('pedido a receber na porta NÃO é marcado', () => {
    /* Esse vai ser cobrado mesmo. Marcar tudo faria a marca virar paisagem. */
    expect(descricaoDaCobranca('Maria Silva', 85, false)).toBe('Maria Silva');
  });

  it('pago online é Pix e cartão online, e só', () => {
    expect(ehPagoOnline('pix')).toBe(true);
    expect(ehPagoOnline('cartao_online')).toBe(true);
    /* Estes dois são recebidos na porta: marcá-los como PAGO faria o entregador
       entregar sem cobrar. */
    expect(ehPagoOnline('dinheiro')).toBe(false);
    expect(ehPagoOnline('cartao_entrega')).toBe(false);
  });
});

describe('o servidor para de emitir quando a maquininha emite', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a emissão automática desiste ANTES de reservar número', () => {
    /*
     * Emitir nos dois lugares produziria DUAS notas para a mesma venda, cada
     * uma com seu número — e desfazer isso depois custa cancelamento. A ordem
     * importa: a desistência tem que vir antes de `reservarNumero`, senão o
     * número da sequência é consumido à toa a cada pedido.
     */
    const i = fonte.indexOf("=== 'maquininha') return null;");
    expect(i).toBeGreaterThan(0);
    expect(fonte.indexOf('reservarNumero(loja.id)', i)).toBeGreaterThan(i);
  });

  it('a emissão MANUAL do lojista continua de pé', () => {
    /* É a saída para o dia em que o aparelho estiver fora do ar e a venda
       precisar de nota. Se ela parasse junto, não haveria como emitir. */
    expect(fonte).toContain("router.post('/nfce/emitir/:pedidoId'");
  });

  it('não se entrega a emissão a um aparelho inalcançável', () => {
    /*
     * Ligar o modo fiscal sem credencial completa não dá tela de erro: dá uma
     * sequência de vendas sem nota que ninguém percebe até o contador perguntar.
     */
    const i = fonte.indexOf("sets.push('nfce_emissor = ?')");
    expect(i).toBeGreaterThan(0);
    expect(fonte.slice(0, i)).toContain('!tefConfigurado(depois)');
  });
});

describe('o encanamento do emissor no fluxo', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'fluxoPedido.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('lê o emissor da loja e cai em sistema no que for estranho', () => {
    /* Padrão seguro: nota a mais se corrige, nota a menos é multa. */
    expect(fonte).toContain('nfce_emissor');
    expect(fonte).toContain("=== 'maquininha' ? 'maquininha' : 'sistema'");
  });

  it('a descrição que vai para o aparelho leva a marca de pago', () => {
    expect(fonte).toContain('pedidoId, pago)');
  });
});

describe('PAGO é o dinheiro que entrou, não a forma escolhida', () => {
  /*
   * O PEDIDO 95 É O CASO REAL. Pix com `pagamento_status = 'recusado'`, dinheiro
   * nenhum na conta, e a preconta subiu para o aparelho marcada `· PAGO` — ou
   * seja, instruindo o operador a fechar como Faturado. Venda entregue de graça
   * e com nota emitida. A forma diz por onde o dinheiro DEVERIA entrar; só o
   * status diz se entrou.
   */

  it('Pix não aprovado NÃO é pago', () => {
    expect(ehJaPago('pix', false)).toBe(false);
    expect(ehJaPago('cartao_online', false)).toBe(false);
  });

  it('Pix aprovado é pago', () => {
    expect(ehJaPago('pix', true)).toBe(true);
    expect(ehJaPago('cartao_online', true)).toBe(true);
  });

  it('aprovado não transforma dinheiro em pago', () => {
    /* `pagamento_status` aprovado num pedido de dinheiro/cartão na entrega não
       quer dizer nada: esses são recebidos na porta. */
    expect(ehJaPago('dinheiro', true)).toBe(false);
    expect(ehJaPago('cartao_entrega', true)).toBe(false);
  });

  it('a preconta de um Pix recusado NÃO chega marcada como paga', () => {
    const naoPago = { ...fiscal, formaPagamento: 'pix', pagamentoAprovado: false };
    /* Sem aprovação ele deixa de ser "já pago": não sobe no pronto, sobe na
       saída — e vai SEM a marca, para o operador cobrar de verdade. */
    expect(deveLancarNaMaquininha({ ...naoPago, novoStatus: 'pronto' })).toBe(false);
    expect(deveLancarNaMaquininha({ ...naoPago, novoStatus: 'em_entrega' })).toBe(true);
    expect(descricaoDaCobranca('GamerExtreme', 95, ehJaPago('pix', false))).toBe('GamerExtreme');
  });

  it('o fluxo lê o status do pedido, não só a forma', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'fluxoPedido.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain("pagamento_status ?? '') === 'aprovado'");
  });
});

describe('a forma que vai na preconta (IDPagamento)', () => {
  /*
   * ERA ISTO QUE FALTAVA NO PEDIDO 95 E NO CARTÃO APROVADO DEPOIS DELE: a
   * preconta subia com `IDPagamento: '1'`, e a maquininha abria pedindo cartão
   * na frente de um cliente que já tinha pago. 99 é o Faturado, que conclui a
   * venda de imediato e imprime a nota com <tPag>99</tPag>.
   */
  it('pedido já pago vai como Faturado (99)', () => {
    expect(idPagamentoDoPedido(true)).toBe('99');
  });

  it('pedido a receber na porta continua em 1, que abre cobrando', () => {
    /* Aqui a cobrança É o objetivo: trocar por 99 faria o entregador entregar
       sem receber. */
    expect(idPagamentoDoPedido(false)).toBe('1');
  });

  it('o fluxo manda a forma junto com a cobrança', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'fluxoPedido.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('idPagamento: idPagamentoDoPedido(pago)');
  });
});
