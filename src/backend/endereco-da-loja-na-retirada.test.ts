import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { enderecoDoPedido, observacaoDoDocumento } from './endereco-do-pedido';
import { montarDocumento, type DadosDoPedido, type ConfigDocumento } from './maxxgestao-documento';

/*
 * O ENDEREÇO DA LOJA QUANDO O CLIENTE NÃO TEM UM.
 *
 * "exemplo, retirar no local, se o cliente não ter endereço: coloca o endereço
 *  da loja no pedido" — no cupom, no documento do Maxx Gestão e na nota, tanto
 *  em Pedido de Venda quanto em Pré-Venda.
 *
 * Num pedido de RETIRADA não existe endereço de entrega, e o campo ficava em
 * branco. Branco não é "não se aplica": é buraco. O cupom imprimia sem linha de
 * endereço, o documento subia sem nenhuma, e quem atendia o telefone não sabia
 * dizer para onde mandar o cliente.
 *
 * A regra mora num módulo só porque a mesma decisão é tomada em TRÊS caminhos
 * que não se conhecem — o pedido do app, o do iFood e o documento do ERP.
 * Escrita três vezes, um deles ficaria para trás, e isso não se descobre
 * olhando a tela: descobre-se quando o cupom sai sem endereço.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLIENTE = semComentarios(ler('src', 'backend', 'rotas', 'cliente.ts'));
const IFOOD = semComentarios(ler('src', 'backend', 'ifood-gravar.ts'));
const SERVER = semComentarios(ler('src', 'backend', 'server.ts'));
const EMITIR = semComentarios(ler('src', 'backend', 'maxxgestao-emitir.ts'));

const LOJA = { nome: 'GALDERIO BEBIDAS', endereco: 'Rua Dilson Funaro, Joinville - SC' };

describe('qual endereço vale', () => {
  it('o do cliente ganha, quando existe', () => {
    expect(enderecoDoPedido('Rua A, 100', 'entrega', LOJA)).toBe('Rua A, 100');
  });

  /*
   * O BANCO GUARDA STRING, e `'   '` não é endereço de ninguém. Sem o `trim`,
   * três espaços passariam como endereço válido e o cupom sairia com uma linha
   * em branco — que é pior que sem linha, porque parece defeito de impressora.
   */
  it('vazio, nulo e só espaços contam como ausente', () => {
    expect(enderecoDoPedido('', 'retirada', LOJA)).toContain('Rua Dilson Funaro');
    expect(enderecoDoPedido(null, 'retirada', LOJA)).toContain('Rua Dilson Funaro');
    expect(enderecoDoPedido('   ', 'retirada', LOJA)).toContain('Rua Dilson Funaro');
  });

  /*
   * O PREFIXO EXISTE PARA NÃO MENTIR. Sem ele, o cupom mostraria o endereço da
   * loja no mesmo lugar em que mostra o do cliente, e o entregador leria como
   * "entregar aqui" — a loja de onde ele acabou de sair.
   */
  it('na retirada, diz que é retirada', () => {
    expect(enderecoDoPedido('', 'retirada', LOJA))
      .toBe('Retirada no local — Rua Dilson Funaro, Joinville - SC');
  });

  /* Entrega sem endereço é caso estranho (iFood já mandou assim), e aí o
     endereço da loja vale sem o prefixo: não é retirada, não se pode afirmar
     que é. */
  it('entrega sem endereço leva o da loja, sem prefixo de retirada', () => {
    expect(enderecoDoPedido('', 'entrega', LOJA)).toBe('Rua Dilson Funaro, Joinville - SC');
  });

  /*
   * LOJA SEM ENDEREÇO CADASTRADO cai no NOME dela. É pior que o endereço e
   * muito melhor que o branco — diz onde buscar para quem conhece a loja.
   */
  it('loja sem endereço cai no nome', () => {
    expect(enderecoDoPedido('', 'retirada', { nome: 'GALDERIO', endereco: '' }))
      .toBe('Retirada no local — GALDERIO');
    expect(enderecoDoPedido('', 'retirada', { nome: 'GALDERIO', endereco: null }))
      .toBe('Retirada no local — GALDERIO');
  });

  /* Sem nome e sem endereço não há o que inventar — e inventar seria pior. */
  it('loja sem nada devolve vazio', () => {
    expect(enderecoDoPedido('', 'retirada', { nome: '', endereco: '' })).toBe('');
  });
});

describe('a observação que vai para o ERP', () => {
  it('junta a observação do pedido com o endereço', () => {
    expect(observacaoDoDocumento('Retirada no local — Rua A', 'Sem cebola'))
      .toBe('Sem cebola · Retirada no local — Rua A');
  });

  it('sem observação do pedido, vai só o endereço', () => {
    expect(observacaoDoDocumento('Rua A', '')).toBe('Rua A');
    expect(observacaoDoDocumento('Rua A', null)).toBe('Rua A');
  });

  /* Sem nenhum dos dois não sobra separador solto: " · " sozinho na tela do
     ERP é ruído que alguém vai tentar entender. */
  it('sem nada, devolve vazio', () => {
    expect(observacaoDoDocumento('', '')).toBe('');
  });

  /* 200 é o teto que o resto do documento já usa. Cortar aqui evita a recusa
     por tamanho, que chega do ERP como erro genérico. */
  it('corta em 200 caracteres', () => {
    expect(observacaoDoDocumento('x'.repeat(500), '').length).toBe(200);
  });
});

const PEDIDO: DadosDoPedido = {
  id: 77, tipoEntrega: 'retirada', totalCentavos: 1000, formaPagamento: 'dinheiro',
  itens: [{ nome: 'ÁGUA', quantidade: 1, precoUnitarioCentavos: 1000, variacaoErp: 985 }],
};
const CONFIG: ConfigDocumento = {
  idNaturezaOperacao: 1, idPessoa: 1, idUsuario: 5470, idPagamento: 1,
  modelo: 'PA', idCaixa: 0, dataHora: '2026-09-17T16:29:06', serie: '1', numero: 14,
};

describe('o documento do ERP', () => {
  it('leva a observação com o endereço', () => {
    const { corpo } = montarDocumento(PEDIDO, { ...CONFIG, observacao: 'Retirada no local — Rua A' });
    const doc = (corpo as { documento: Record<string, unknown> }).documento;
    expect(doc.observacao).toBe('Retirada no local — Rua A');
  });

  /* Vazio não vai: campo em branco é ruído na tela de quem confere, e a API
     grava string vazia sem reclamar — o mesmo tipo de silêncio que deixou os
     documentos com número 0. */
  it('observação vazia não vira campo', () => {
    for (const obs of ['', '   ', undefined]) {
      const { corpo } = montarDocumento(PEDIDO, { ...CONFIG, observacao: obs });
      const doc = (corpo as { documento: Record<string, unknown> }).documento;
      expect(doc).not.toHaveProperty('observacao');
    }
  });

  /* PV é o MESMO documento com outro modelo — "tanto pedido quanto pré-venda". */
  it('vale igual em Pré-Venda', () => {
    const { corpo } = montarDocumento(PEDIDO, { ...CONFIG, modelo: 'PV', observacao: 'Retirada no local — Rua A' });
    const doc = (corpo as { documento: Record<string, unknown> }).documento;
    expect(doc.modelo).toBe('PV');
    expect(doc.observacao).toBe('Retirada no local — Rua A');
  });
});

describe('os três caminhos usam a mesma regra', () => {
  it('o pedido do app', () => {
    expect(CLIENTE).toContain("from '../endereco-do-pedido'");
    expect(CLIENTE).toContain('enderecoDoPedido(');
    /* A frase montada à mão saiu: era a quarta cópia da regra. */
    expect(CLIENTE).not.toContain('`Retirada no local — ${loja.endereco || loja.nome}`');
  });

  it('o pedido do iFood', () => {
    expect(IFOOD).toContain("from './endereco-do-pedido'");
    expect(IFOOD).toContain('enderecoDoPedido(p.endereco,');
    /* O servidor tem que passar a loja, senão a dependência opcional nunca é
       chamada e o iFood continua com a frase genérica — verde sem efeito. */
    expect(SERVER).toContain('dadosDaLoja: async lojaId =>');
    expect(SERVER).toContain('SELECT nome, endereco FROM lojas WHERE id = ?');
  });

  /*
   * LOJA QUE NÃO RESPONDEU não derruba o pedido do iFood: volta à frase de
   * antes. Perder a venda por causa de um campo de texto seria trocar um
   * incômodo por um prejuízo.
   */
  it('iFood sem dados da loja continua gravando', () => {
    expect(IFOOD).toContain("(p.endereco || 'Retirada no balcão')");
  });

  it('o documento do Maxx Gestão', () => {
    expect(EMITIR).toContain("from './endereco-do-pedido'");
    expect(EMITIR).toContain('observacao: observacaoDoDocumento(');
    expect(EMITIR).toContain('enderecoDoPedido(pedido.endereco_entrega, dados.tipoEntrega,');
    /* Precisa ler as duas colunas, senão passa `undefined` e o teste acima
       continuaria verde com o endereço sempre vazio. */
    expect(EMITIR).toContain('endereco_entrega, maxxgestao_documento_id');
    expect(EMITIR).toContain('maxxgestao_serie, nome, endereco');
  });
});
