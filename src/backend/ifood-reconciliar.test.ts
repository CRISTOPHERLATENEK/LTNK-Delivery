import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ehPedidoCanceladoLa, pedidosParaConferir, STATUS_ATIVOS,
  MINUTOS_MINIMOS, HORAS_MAXIMAS, type PedidoParaConferir,
} from './ifood-reconciliar';

const AGORA = Date.parse('2026-08-29T15:00:00.000Z');
const minutosAtras = (m: number) => new Date(AGORA - m * 60_000).toISOString();

const pedido = (over: Partial<PedidoParaConferir> = {}): PedidoParaConferir => ({
  id: 85, status: 'preparando', orderId: 'abc-123', criadoEm: minutosAtras(30), ...over,
});

describe('ehPedidoCanceladoLa', () => {
  it('reconhece a resposta REAL do iFood', () => {
    /* Texto copiado da chamada de verdade contra o pedido #85. */
    expect(ehPedidoCanceladoLa({
      httpStatus: 400,
      message: 'Order 98f42f66-6478-41fd-8a52-3f58a46048cb is already cancelled',
    })).toBe(true);
  });

  it('outro 400 NÃO é cancelamento', () => {
    /*
     * A alternativa preguiçosa seria tratar todo 400 como cancelado — e aí um
     * erro de validação cancelaria um pedido que a cozinha está produzindo.
     * Entre deixar de consertar e cancelar o que está certo, a escolha não é
     * difícil.
     */
    expect(ehPedidoCanceladoLa({ httpStatus: 400, message: 'Invalid order id' })).toBe(false);
    expect(ehPedidoCanceladoLa({ httpStatus: 400, message: '' })).toBe(false);
  });

  it('404 e 500 não são cancelamento', () => {
    expect(ehPedidoCanceladoLa({ httpStatus: 404, message: 'is already cancelled' })).toBe(false);
    expect(ehPedidoCanceladoLa({ httpStatus: 500, message: 'boom' })).toBe(false);
  });

  it('aceita as duas grafias de "cancelled"', () => {
    /* A API mistura inglês britânico e americano em mensagens diferentes. */
    expect(ehPedidoCanceladoLa({ httpStatus: 400, message: 'Order X is already canceled' })).toBe(true);
  });
});

describe('pedidosParaConferir', () => {
  it('pega o pedido ativo com idade no meio da janela', () => {
    expect(pedidosParaConferir([pedido()], AGORA)).toHaveLength(1);
  });

  it('ignora pedido em status terminal', () => {
    for (const s of ['entregue', 'cancelado', 'recusado']) {
      expect(pedidosParaConferir([pedido({ status: s })], AGORA)).toEqual([]);
    }
  });

  it('confere TODOS os status ativos', () => {
    /* Um cancelamento pode chegar em qualquer ponto antes da entrega; deixar um
       estado de fora é deixar um buraco exatamente onde ninguém procura. */
    for (const s of STATUS_ATIVOS) {
      expect(pedidosParaConferir([pedido({ status: s })], AGORA), s).toHaveLength(1);
    }
  });

  it('não confere pedido recém-criado', () => {
    /* Ainda está sendo confirmado; perguntar a cada ciclo só gasta chamada. */
    expect(pedidosParaConferir([pedido({ criadoEm: minutosAtras(MINUTOS_MINIMOS - 1) })], AGORA)).toEqual([]);
  });

  it('não confere pedido velho demais', () => {
    /* Pedido antigo e ainda ativo é problema de operação, não de evento
       perdido — e varrer o histórico inteiro cresce sem limite. */
    expect(pedidosParaConferir([pedido({ criadoEm: minutosAtras(HORAS_MAXIMAS * 60 + 1) })], AGORA)).toEqual([]);
  });

  it('pedido sem orderId do iFood fica de fora', () => {
    expect(pedidosParaConferir([pedido({ orderId: '  ' })], AGORA)).toEqual([]);
  });

  it('data ilegível NÃO faz pular a conferência', () => {
    /*
     * Um pedido preso com data estranha é exatamente o que ninguém vai notar.
     * Pular por não conseguir ler a data seria esconder o caso mais provável de
     * dar errado.
     */
    expect(pedidosParaConferir([pedido({ criadoEm: 'data-torta' })], AGORA)).toHaveLength(1);
  });
});

describe('o ciclo da reconciliação', () => {
  const fonte = () => fs.readFileSync(path.join(__dirname, 'ifood-reconciliar-ciclo.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('corrige marcando como vindo do iFood', () => {
    /*
     * Sem isso a correção seria recusada pela máquina de estados (só se cancela
     * de 'pendente') e ainda pediria ao iFood o cancelamento de um pedido que
     * ELE já cancelou.
     */
    expect(fonte()).toContain('{ vindoDoIfood: true }');
  });

  it('só mexe no pedido quando a resposta é de cancelamento', () => {
    /* Qualquer outro erro — 500, timeout, validação — não pode cancelar um
       pedido que a cozinha está produzindo. */
    /* A asserção é sobre a REGRA, não sobre a sintaxe: o corpo do guarda mudou
       quando ele passou a registrar o erro em vez de engolir. */
    const s = fonte();
    expect(s).toContain('if (!ehPedidoCanceladoLa(erro))');
    const i = s.indexOf('if (!ehPedidoCanceladoLa(erro))');
    expect(s.slice(i, i + 200)).toContain('continue;');
  });

  it('não roda no ritmo do polling', () => {
    /* Uma chamada por pedido ativo a cada 30s competiria com o polling — que é
       o que mantém a loja online no iFood. */
    const s = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
    const i = s.indexOf('    reconciliarPedidosIfood()');
    expect(i).toBeGreaterThan(0);
    /* Até o fecho do setInterval, seja qual for o tamanho do callback: a
       asserção é sobre o INTERVALO, e não pode quebrar quando o corpo cresce. */
    const bloco = s.slice(i, s.indexOf('}, ', i) + 30);
    expect(bloco).toContain('10 * 60_000');
    expect(bloco).not.toContain('30_000');
  });
});

describe('um ciclo só', () => {
  const semComentarios = (a: string) => fs.readFileSync(path.join(__dirname, a), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('o servidor e o comando chamam a MESMA função', () => {
    /* Duas orquestrações fariam o "reconcilia agora" do suporte provar uma
       coisa e o automático fazer outra. */
    for (const a of ['server.ts', 'ifood-reconciliar-cli.ts']) {
      expect(semComentarios(a)).toContain('reconciliarPedidosIfood');
    }
  });

  it('nenhum dos dois consulta o iFood por conta própria', () => {
    for (const a of ['ifood-reconciliar-cli.ts']) {
      expect(semComentarios(a)).not.toContain('motivosDeCancelamento');
    }
  });
});

describe('a rede não pode mentir sobre ter passado', () => {
  const fonte = (a: string) => fs.readFileSync(path.join(__dirname, a), 'utf8');

  it('erro que NÃO é cancelamento vira log, não silêncio', () => {
    /*
     * Este catch recebe duas coisas muito diferentes: "o pedido está cancelado
     * lá" e "não consegui perguntar". Tratar as duas como `continue` mudo fez o
     * comando responder "reconciliação concluída" sem ter conferido nada —
     * durante um bloqueio da Cloudflare, com o pedido #85 preso do outro lado.
     * Uma rede de segurança que mente sobre ter passado é pior que não ter
     * rede: dá a certeza sem o fato.
     */
    const s = fonte('ifood-reconciliar-ciclo.ts');
    expect(s).toContain('naoConsegui++');
    expect(s).toContain('não consegui conferir');
  });

  it('o comando devolve o resumo, não um "concluída"', () => {
    const s = fonte('ifood-reconciliar-cli.ts');
    expect(s).toContain('r.conferidos');
    expect(s).toContain('r.naoConsegui');
    expect(s).not.toContain("'reconciliação concluída.'");
  });

  it('o laço do servidor grita quando não conseguiu conferir', () => {
    expect(fonte('server.ts')).toContain('não consegui conferir ${r.naoConsegui} pedido(s)');
  });
});
