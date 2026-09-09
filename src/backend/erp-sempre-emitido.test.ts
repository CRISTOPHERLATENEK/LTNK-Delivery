import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * TODO PEDIDO QUE VAI PARA O MAXX GESTÃO TEM QUE IR EMITIDO.
 *
 * Regra do negócio, e o código fazia o contrário: a emissão era opt-in e
 * DESLIGADA por padrão. O documento subia como rascunho e ficava lá.
 *
 * O estado que isso produziu em produção, medido: 8 pedidos com documento no
 * ERP e NENHUM com chave — zero notas emitidas. E três coisas conspirando para
 * ninguém notar:
 *
 *  1. a coluna `maxxgestao_emitido_em` era gravada quando o documento era
 *     CRIADO, então o banco afirmava 8 emissões que não existiram;
 *  2. o retorno de `emitirDocumentoNoErp` era IGNORADO — transformar podia
 *     falhar, a SEFAZ podia recusar, e o motivo ia para um console.log;
 *  3. a guarda de emissão manual bloqueava com "a nota dela sai de lá",
 *     que soa como "está resolvido".
 *
 * Venda sem documento fiscal, dois caminhos fechados, e nada dizendo.
 */

const BACKEND = __dirname;
const emitir = fs.readFileSync(path.join(BACKEND, 'maxxgestao-emitir.ts'), 'utf8');
const rotas = fs.readFileSync(path.join(BACKEND, 'rotas', 'lojista.ts'), 'utf8');
const schema = fs.readFileSync(path.join(BACKEND, 'schema-mysql.ts'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('emitir passou a ser o padrão', () => {
  it('o teste está lendo o arquivo certo', () => {
    expect(emitir).toContain('emitirDocumentoNoErp');
  });

  /*
   * "EMITIDO" É O STATUS DO PEDIDO DE VENDA, NÃO UMA NFC-e.
   *
   * ERRO MEU, corrigido no mesmo dia. Eu li "todo pedido tem que ir com status
   * de emitido" como "emitir a nota fiscal", e liguei `transformar` + `emitir`
   * por padrão. Aquilo CONVERTE o Pedido de Venda em NFC-e (modelo 65), consome
   * numeração fiscal e vai à SEFAZ — que recusa por `infIntermed`. Não era o
   * pedido: o documento continua `PA`, muda só o status de R para E.
   *
   * O que o status E resolve: rascunho no ERP é documento que ninguém fatura e
   * que não aparece nos relatórios de venda de lá. Era o estado dos 8 que
   * subiram.
   */
  it('marca o status E no envio, e isso não é opcional', () => {
    expect(exec(emitir)).toMatch(/const marcou = await fecharDocumentoNoErp\(pedidoId, opcoes\)/);
    /*
     * ORDEM, não janela de caracteres. Minha primeira versão olhava os 300
     * caracteres seguintes e pegava o bloco OPCIONAL da NFC-e que vem depois —
     * armadilha de janela, a mesma que eu já consertei em outro teste hoje.
     *
     * O que se afirma é: o status E acontece ANTES e FORA de qualquer
     * condicional da chave de auto-emissão.
     */
    const codigo = exec(emitir);
    const iStatus = codigo.indexOf('const marcou = await fecharDocumentoNoErp');
    const iOpcional = codigo.indexOf('maxxgestao_auto_emitir ?? 0');
    expect(iStatus).toBeGreaterThan(0);
    expect(iOpcional).toBeGreaterThan(iStatus);
  });

  it('o status E é POST de status, não transformar nem emitir', () => {
    const fn = emitir.slice(emitir.indexOf('export async function fecharDocumentoNoErp'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('/status/v1');
    expect(corpo).toContain("status: 'E'");
    expect(corpo).not.toContain('transformar');
    expect(corpo).not.toContain('/emitir');
  });

  /*
   * E A NFC-e PELO ERP VOLTOU A SER OPT-IN DESLIGADA. Emitir não tem volta, e
   * hoje a SEFAZ recusa por falta de `infIntermed` — dado montado do lado do
   * ERP. Ligar por padrão era converter todo pedido em nota recusada.
   */
  it('emitir NFC-e pelo ERP segue desligado por padrão', () => {
    expect(exec(emitir)).toContain('maxxgestao_auto_emitir ?? 0');
    expect(exec(emitir)).not.toContain('maxxgestao_auto_emitir ?? 1');
  });

  /*
   * O RESULTADO É GRAVADO. Sem isto, "não marcou" continua sendo uma linha de
   * log — e log é onde a informação vai morar quando não há ninguém lendo.
   */
  it('o resultado da marcação é gravado no pedido', () => {
    expect(exec(emitir)).toMatch(/registrarResultado\(pedidoId, marcou/);
  });

  it('o motivo da recusa é gravado no pedido', () => {
    expect(exec(emitir)).toMatch(/maxxgestao_motivo = \?/);
  });

  /*
   * ENVIADO ≠ EMITIDO, e a coluna tem que dizer a verdade. `emitido_em` só é
   * preenchida quando a nota volta autorizada; a criação do documento vai para
   * `enviado_em`.
   */
  it('o envio do documento grava enviado_em, não emitido_em', () => {
    const trecho = exec(emitir).slice(exec(emitir).indexOf('maxxgestao_documento_id = ?'));
    expect(trecho.slice(0, 200)).toContain('maxxgestao_enviado_em = ?');
  });

  it('emitido_em só é preenchida quando emitiu', () => {
    expect(exec(emitir)).toMatch(/emitiu \? agoraUTC\(\) : ''/);
  });

  /* Registrar a falha não pode derrubar o pedido: a venda já aconteceu e o
     cliente está esperando. */
  it('registrar o resultado nunca lança', () => {
    const fn = emitir.slice(emitir.indexOf('async function registrarResultado'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('catch');
  });
});

describe('as colunas novas têm migração', () => {
  /*
   * O CREATE é IF NOT EXISTS e não alcança banco que já existe. Foi a lição de
   * um cadastro quebrado em produção hoje — e aqui a repetição seria pior: sem
   * a coluna, o UPDATE falha e o pedido fica sem registro nenhum do resultado.
   */
  it('enviado_em e motivo estão no laço de ALTER', () => {
    expect(schema).toMatch(/\['pedidos', 'maxxgestao_enviado_em'/);
    expect(schema).toMatch(/\['pedidos', 'maxxgestao_motivo'/);
  });
});

describe('a guarda de emissão manual', () => {
  const guarda = (() => {
    const i = rotas.indexOf("if (emissor === 'erp' && pedido.maxxgestao_documento_id)");
    return rotas.slice(i, i + 2200);
  })();

  it('o teste está lendo a guarda certa', () => {
    expect(guarda).toContain('maxxgestao_documento_id');
    expect(guarda).toContain('409');
  });

  /*
   * CONTINUA FECHADA, e isso é deliberado. Emitir daqui com o pedido aberto no
   * ERP gera DUAS notas para a mesma venda, e desfazer custa cancelamento — já
   * aconteceu com os pedidos 107, 108 e 109. A saída não é liberar.
   */
  it('não libera a emissão local quando existe documento no ERP', () => {
    expect(guarda).toMatch(/throw erroHttp\(409/);
  });

  /*
   * MAS A MENSAGEM PAROU DE AFIRMAR QUE A NOTA SAIU. É a diferença entre "está
   * resolvido" e "resolva no ERP", e era ela que fazia a venda ficar sem
   * documento sem ninguém procurar.
   */
  it('a mensagem depende de a nota ter saído de verdade', () => {
    expect(guarda).toContain('maxxgestao_emitido_em');
    expect(guarda).toContain('AINDA NÃO FOI EMITIDA');
  });

  it('quando não saiu, diz o motivo e onde resolver', () => {
    expect(guarda).toContain('maxxgestao_motivo');
    expect(guarda).toContain('resolva no Maxx Gestão');
  });

  /* E quando saiu de verdade, a frase antiga vale — é o único caso em que ela
     era correta. */
  it('quando saiu, diz que já foi emitida lá', () => {
    expect(guarda).toContain('já foi emitida lá');
  });
});
