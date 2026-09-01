import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  deveLancarNaMaquininha, statusDeLancamento, idCobrancaDoPedido, descricaoDaCobranca,
  type ContextoLancamento,
} from './pdvmobi-quando';

const base: ContextoLancamento = {
  formaPagamento: 'cartao_entrega',
  novoStatus: 'em_entrega',
  tefConfigurado: true,
  jaLancado: false,
  tipoEntrega: 'entrega',
};

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
