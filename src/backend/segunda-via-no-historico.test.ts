import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A SEGUNDA VIA DEPOIS QUE O PEDIDO FECHA.
 *
 * "depois que finalizar o pedido, no histórico tem que ter o botão de imprimir
 *  outra via."
 *
 * O ícone de impressora só existia no cartão dos pedidos ATIVOS. E segunda via
 * é exatamente o que se pede DEPOIS: o cliente ligou, o cupom rasgou, o
 * entregador perdeu. Quando o pedido saía da fila, a reimpressão virava caminho
 * sem saída — e o único outro caminho era o PDF da NFC-e, que é nota fiscal e
 * não a comanda.
 *
 * NO CAMINHO, UM SEGUNDO DEFEITO. O botão manual chamava
 * `imprimirPedidoPainel(pedido)` sem configuração: a impressão AUTOMÁTICA saía
 * em 58mm com o nome da loja, e a segunda via do mesmo pedido saía em 80mm e
 * sem nome. Numa bobina de 58mm o cupom de 80 sai cortado nas laterais — e quem
 * imprime a segunda via está resolvendo um problema, não criando outro.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const PAINEL = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'painel.tsx'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));

/** Só o componente do histórico, para não medir o cartão dos ativos por engano. */
const HISTORICO = (() => {
  const i = PAINEL.indexOf('function CardHistoricoPedido(');
  const j = PAINEL.indexOf('function CardPedidoLojista(', i);
  expect(i).toBeGreaterThan(0);
  expect(j).toBeGreaterThan(i);
  return PAINEL.slice(i, j);
})();

describe('o botão no histórico', () => {
  it('existe, e imprime o pedido daquele cartão', () => {
    expect(HISTORICO).toContain('imprimirPedidoPainel(pedido, impressao)');
    expect(HISTORICO).toContain('<Printer className="size-5" />');
  });

  /* `aria-label` porque o botão é só um ícone: sem ele, quem usa leitor de tela
     ouve "botão" e nada mais — e são dois botões na mesma linha. */
  it('diz o que faz para quem não vê o ícone', () => {
    expect(HISTORICO).toContain('aria-label={`Imprimir outra via do pedido #${pedido.id}`}');
    expect(HISTORICO).toContain('title="Imprimir outra via"');
  });

  /*
   * FORA DO BOTÃO QUE EXPANDE. Botão dentro de botão é HTML inválido: o
   * navegador desmonta a marcação e o clique passa a acertar os dois — abriria
   * o pedido E mandaria imprimir.
   */
  it('não fica aninhado no botão que expande', () => {
    const iLinha = HISTORICO.indexOf('<div className="flex items-center gap-1">');
    const iToggle = HISTORICO.indexOf('onClick={() => setExpandido(e => !e)}');
    const iPrint = HISTORICO.indexOf('imprimirPedidoPainel(pedido, impressao)');
    expect(iLinha).toBeGreaterThan(0);
    expect(iLinha).toBeLessThan(iToggle);
    /* O botão de expandir fecha ANTES de o de imprimir começar. */
    const fechaToggle = HISTORICO.indexOf('</button>', iToggle);
    expect(fechaToggle).toBeLessThan(iPrint);
  });

  /* 44×44 é alvo de dedo no celular do balcão, não ícone de mesa — o mesmo
     tamanho que o cartão dos ativos já usa. */
  it('é tocável no celular', () => {
    expect(HISTORICO).toContain('size-11 shrink-0 items-center justify-center');
  });
});

describe('a segunda via sai igual à primeira', () => {
  /*
   * O DEFEITO QUE APARECEU NO CAMINHO: automática com configuração, manual sem.
   * Numa loja de 58mm a segunda via saía em 80 e cortada.
   */
  it('nenhuma impressão manual continua sem configuração', () => {
    expect(PAINEL).not.toContain('imprimirPedidoPainel(pedido)');
  });

  it('os dois cartões leem a mesma fonte', () => {
    expect(PAINEL).toContain('function useConfigImpressao()');
    expect((PAINEL.match(/useConfigImpressao\(\)/g) || []).length).toBe(3);
    expect(PAINEL).toContain("String(loja?.impressora_largura ?? '80') === '58' ? '58' : '80'");
    expect(PAINEL).toContain("loja_nome: String(loja?.nome ?? '')");
  });

  /*
   * A MESMA CHAVE da consulta que o painel já faz, e é isso que dispensa rede:
   * o react-query serve do cache. Chave diferente seria uma segunda ida ao
   * servidor para o mesmo dado, em toda abertura da tela — e contar ocorrências
   * no arquivo não mediria isso, porque a chave já é usada em outros pontos.
   */
  it('o hook usa a chave que o painel já consulta', () => {
    const i = PAINEL.indexOf('function useConfigImpressao()');
    const corpo = PAINEL.slice(i, i + 500);
    expect(corpo).toContain("queryKey: ['minha-loja-cfg']");
    expect(corpo).toContain("'GET', '/api/lojista/loja'");
    expect(corpo).toContain('staleTime: 60000');
  });
});

describe('o histórico entrega o que o cupom precisa', () => {
  /*
   * Sem os ITENS o cupom sairia com cabeçalho e total e nenhuma linha de
   * produto — que é pior que não imprimir, porque parece que imprimiu.
   */
  it('a rota do histórico manda os itens junto', () => {
    const i = LOJISTA.indexOf("'/pedidos-historico'");
    expect(i).toBeGreaterThan(0);
    const corpo = LOJISTA.slice(i, i + 2500);
    expect(corpo).toContain('FROM itens_pedido ip');
    expect(corpo).toContain('WHERE ip.pedido_id IN (${marcas})');
  });

  /* Cancelado e recusado também entram no histórico — e também imprimem, que é
     o que se leva ao cliente que contesta. */
  it('o histórico cobre entregue, cancelado e recusado', () => {
    expect(LOJISTA).toContain("p.status IN ('entregue', 'cancelado', 'recusado')");
  });
});
