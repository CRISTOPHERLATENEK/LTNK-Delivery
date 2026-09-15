import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  COBERTURA_MINIMA_PARA_PAUSAR, podePausarAusentes, passadaMudouAlgo, SEM_MUDANCA,
  type LeituraDoErp,
} from './maxxgestao-sincronizar-ciclo';
import type { ItemDoCatalogo } from './maxxgestao-importar';

/*
 * O CARDÁPIO ACOMPANHA O MAXX GESTÃO SOZINHO.
 *
 * O lojista mexe no cadastro LÁ e espera que o delivery acompanhe. Isto é o que
 * pergunta de hora em hora.
 *
 * POR QUE VARREDURA E NÃO AVISO — medido contra a conta real em 14/09/2026,
 * não suposto:
 *
 *   webhook / assinatura de evento .... não existe (todos os caminhos: 404)
 *   filtro "mudou depois de tal data" . não existe — e o pior: o parâmetro é
 *                                       ACEITO E IGNORADO. Com
 *                                       `dataAlteracao=2099-01-01` a busca
 *                                       devolve os mesmos 1.076 itens.
 *
 * O SALDO DE ESTOQUE, ESSE EXISTE — e eu tinha escrito aqui que não. Em 14/09
 * sondei 25 caminhos prováveis, todos 404, e conclui que não havia; a forma
 * real é `/api/local-estoque/{id}/estoques/v1`, e só apareceu quando o lojista
 * abriu o swagger deles (que exige login). Ele entra na mesma passada — ver
 * `maxxgestao-estoque.test.ts`, que é onde a decisão dele é provada.
 *
 * A trava que estes testes mais protegem é `podePausarAusentes`: ela é a única
 * coisa entre uma leitura incompleta e metade do cardápio fora do ar.
 */

const item = (variacao: number): ItemDoCatalogo => ({
  produto: {
    variacao, mercadoria: variacao, descricao: `Produto ${variacao}`,
    descricaoAdicional: '', codigoBarras: '', ncm: '', cest: '',
    ativo: true, referencia: '',
  },
  categoria: 'Geral',
});

const leitura = (itens: number, esperados: number, completa = true): LeituraDoErp => ({
  itens: Array.from({ length: itens }, (_, i) => item(i + 1)),
  esperados,
  completa,
});

describe('quando é seguro PAUSAR o que não apareceu', () => {
  /*
   * ESTA É A DECISÃO QUE TIRA PRODUTO DO AR, e a passada roda de madrugada sem
   * ninguém olhando. Uma varredura que trouxe metade do cadastro (porque o ERP
   * tropeçou no meio) faz a outra metade parecer "sumiu do ERP". Cardápio pela
   * metade é pior que cardápio desatualizado: ninguém sabe qual metade.
   */
  it('varredura completa e cobrindo o cadastro: pode', () => {
    expect(podePausarAusentes(leitura(1000, 1000))).toBe(true);
    expect(podePausarAusentes(leitura(950, 1000))).toBe(true);
  });

  it('varredura INCOMPLETA nunca pausa, por melhor que seja a cobertura', () => {
    /* Cobertura cheia e ainda assim não: uma letra que falhou pode ser
       justamente a dos produtos que "sumiram". */
    expect(podePausarAusentes(leitura(1000, 1000, false))).toBe(false);
    expect(podePausarAusentes(leitura(1200, 1000, false))).toBe(false);
  });

  it('cobertura abaixo da linha não pausa', () => {
    /* 89% não é "o cadastro encolheu", é leitura incompleta disfarçada. */
    expect(podePausarAusentes(leitura(890, 1000))).toBe(false);
    expect(podePausarAusentes(leitura(500, 1000))).toBe(false);
    expect(podePausarAusentes(leitura(1, 1000))).toBe(false);
  });

  it('a linha é 90%, e é ela que decide — não um número solto no teste', () => {
    const n = 1000;
    const naLinha = Math.ceil(n * COBERTURA_MINIMA_PARA_PAUSAR);
    expect(podePausarAusentes(leitura(naLinha, n))).toBe(true);
    expect(podePausarAusentes(leitura(naLinha - 1, n))).toBe(false);
  });

  /*
   * ZERO ESPERADOS É O CASO TRAIÇOEIRO: `0/0` em ponto flutuante é `NaN`, e
   * `NaN >= 0.9` é falso — ou seja, acertaria por acidente. A guarda explícita
   * existe para o acerto não depender disso, e este teste prende o
   * comportamento, não o caminho.
   */
  it('sem saber quantos são esperados, não pausa', () => {
    expect(podePausarAusentes(leitura(0, 0))).toBe(false);
    expect(podePausarAusentes(leitura(50, 0))).toBe(false);
    expect(podePausarAusentes({ itens: [], esperados: -1, completa: true })).toBe(false);
  });
});

describe('uma passada que não mexeu em nada é silenciosa', () => {
  it('SEM_MUDANCA não conta como mudança', () => {
    expect(passadaMudouAlgo(SEM_MUDANCA)).toBe(false);
  });

  /* Saldo novo TAMBÉM é mudança: é a razão de existir da sincronização de
     estoque, e uma passada que só ajustou saldo não pode sair calada. */
  it('saldo ajustado conta como mudança', () => {
    expect(passadaMudouAlgo({ ...SEM_MUDANCA, estoqueAjustado: 3 })).toBe(true);
  });

  it('qualquer gravação conta', () => {
    for (const campo of ['criados', 'atualizados', 'pausados'] as const) {
      expect(passadaMudouAlgo({ ...SEM_MUDANCA, [campo]: 1 }), campo).toBe(true);
    }
  });

  /* Ler 1.076 produtos e não mudar nada é o caso NORMAL — e não pode virar
     linha de log, senão o dia em que algo mudar some no ruído. */
  it('ler muito e não mudar nada continua sendo silêncio', () => {
    expect(passadaMudouAlgo({ ...SEM_MUDANCA, lidos: 1076, semMudanca: 1076 })).toBe(false);
  });
});

describe('o laço do servidor', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const semComentarios = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const CODIGO = semComentarios(SERVER);

  /*
   * O PM2 SOBE TRÊS INSTÂNCIAS. Três passadas simultâneas gastariam três vezes
   * o orçamento do ERP (20 chamadas por minuto, o MESMO que emite a NFC-e de
   * cada pedido) e gravariam uma por cima da outra.
   */
  it('a passada roda dentro do bloco de tarefas da instância 0', () => {
    const iGuarda = CODIGO.indexOf('if (rodarTarefas) {');
    const iChamada = CODIGO.indexOf('sincronizarCardapiosErp().catch');
    expect(iGuarda).toBeGreaterThan(0);
    expect(iChamada).toBeGreaterThan(iGuarda);
  });

  /*
   * NÃO RODA NO BOOT, ao contrário das reconciliações de pagamento. Esta
   * escreve no cardápio: um servidor que reinicia várias vezes (deploy, queda,
   * `pm2 reload`) rodaria uma gravação a cada reinício, gastando o orçamento do
   * ERP justamente quando ele precisa estar livre para emitir nota.
   *
   * A ASSERÇÃO É NEGATIVA E PRECISA SER: o defeito seria uma linha A MAIS.
   */
  it('não dispara uma passada no boot', () => {
    /* CHAMADAS, e nao a DECLARACAO: `async function sincronizarCardapiosErp()`
       tambem tem o nome seguido de parenteses, e contava como chamada. */
    const chamadas = [...CODIGO.matchAll(/sincronizarCardapiosErp\(\)/g)]
      .filter(m => !CODIGO.slice(Math.max(0, m.index - 30), m.index).includes('function'));
    expect(chamadas.length).toBe(1);
    /* E ELA ESTA DENTRO DE UM `setInterval` — a chamada fica na linha SEGUINTE
       ao `setInterval(`, entao a conferencia olha o que vem ANTES dela, e nao a
       propria linha (foi assim que este teste reprovou a versao correta). */
    const antes = CODIGO.slice(Math.max(0, chamadas[0].index - 120), chamadas[0].index);
    expect(antes).toContain('setInterval');
  });

  it('o intervalo é de hora em hora', () => {
    const i = CODIGO.indexOf('sincronizarCardapiosErp().catch');
    /* O `60 * 60_000` fica DEPOIS da chamada, no fecho do setInterval. */
    expect(CODIGO.slice(i, i + 160)).toContain('60 * 60_000');
  });

  it('só alcança loja que LIGOU e tem token', () => {
    const i = CODIGO.indexOf('async function sincronizarCardapiosErp');
    const corpo = CODIGO.slice(i, i + 2500);
    expect(corpo).toContain('maxxgestao_sinc_auto = 1');
    expect(corpo).toContain('maxxgestao_token IS NOT NULL');
  });

  /* Uma loja com token vencido não pode parar o cardápio das outras: são
     tenants diferentes. */
  it('falha de uma loja não derruba as outras', () => {
    const i = CODIGO.indexOf('async function sincronizarCardapiosErp');
    const corpo = CODIGO.slice(i, i + 2500);
    expect(corpo).toContain('catch');
    expect(corpo).toContain('[erp-sinc]');
  });

  /* Passada travada não pode ganhar companhia na volta seguinte. */
  it('não deixa duas passadas se sobreporem', () => {
    const i = CODIGO.indexOf('async function sincronizarCardapiosErp');
    const corpo = CODIGO.slice(i, i + 900);
    expect(corpo).toContain('sincErpEmCurso');
    expect(CODIGO).toContain('finally');
  });
});

describe('a coluna nasce desligada', () => {
  /*
   * LIGADA POR PADRÃO SERIA TIRAR LOJA DO AR. Numa loja que nunca importou do
   * ERP, o cardápio inteiro é "não veio do ERP" — a primeira passada pausaria
   * tudo, de madrugada, sem ninguém para ver.
   */
  it('maxxgestao_sinc_auto entra com DEFAULT 0', () => {
    const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');
    const linha = schema.split('\n').find(l => l.includes("'maxxgestao_sinc_auto',"));
    expect(linha).toBeDefined();
    expect(linha).toContain('DEFAULT 0');
  });

  /* Sem o catálogo gravado, a passada sem tela peneiraria pela empresa inteira
     e despejaria 1.118 produtos num cardápio de 39. */
  it('o catálogo escolhido é gravado na importação', () => {
    const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
    expect(rotas).toContain('UPDATE lojas SET maxxgestao_catalogo = ?');
  });
});

describe('a tela não promete estoque', () => {
  /*
   * "SINCRONIZA COM O ERP" É LIDO COMO "O ESTOQUE VEM JUNTO" — é a primeira
   * coisa que qualquer lojista supõe, e foi literalmente o pedido que originou
   * esta função. A API do Maxx Gestão não informa saldo; descobrir isso depois
   * de confiar é pior que ler antes de ligar.
   */
  it('o texto do interruptor diz que saldo não entra', () => {
    const painel = fs.readFileSync(path.join(
      __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel-maxxgestao.tsx'), 'utf8');
    const i = painel.indexOf("liberada('erp-sincronizar-auto')");
    expect(i).toBeGreaterThan(0);
    const bloco = painel.slice(i, i + 2600);
    expect(bloco).toMatch(/Saldo de estoque não entra/);
    expect(bloco).toMatch(/não informa\s*\n?\s*quantidade/);
  });

  it('e o aviso de ligar avisa que produto sai do ar', () => {
    const painel = fs.readFileSync(path.join(
      __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel-maxxgestao.tsx'), 'utf8');
    const i = painel.indexOf('async function alternarSincAuto');
    expect(i).toBeGreaterThan(0);
    const corpo = painel.slice(i, i + 1400);
    expect(corpo).toContain('window.confirm');
    expect(corpo).toMatch(/PAUSADO aqui/);
    expect(corpo).toMatch(/Estoque NÃO entra/);
  });
});

describe('o estoque tem ritmo próprio, mais rápido que o cadastro', () => {
  /*
   * "A CADA 1H É DEMAIS NÉ" — e era. As duas coisas estavam presas na mesma
   * passada, e elas custam coisas muito diferentes (medido):
   *
   *   cadastro ... ~37 chamadas ao ERP, 122 a 181 segundos
   *   estoque .... 11 a 13 chamadas, 1 SEGUNDO
   *
   * O custo na loja de prender o estoque no ritmo do cadastro: um produto que
   * acaba no balcão continua vendendo no delivery por até uma hora, e o pedido
   * entra para algo que não existe. Nome e preço mudam algumas vezes por
   * semana; saldo muda a cada venda.
   */
  const SERVER = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const semComent = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const CODIGO = semComent(SERVER);

  it('são dois laços, e não um', () => {
    expect(CODIGO).toContain('async function sincronizarEstoquesErp');
    expect(CODIGO).toContain('async function sincronizarCardapiosErp');
  });

  /*
   * A CONTA QUE FIXA OS 2 MINUTOS:
   *   teto do ERP .......... 20 chamadas/minuto por token (1.200/hora)
   *   passada de estoque ... 11 a 13 chamadas
   *   a cada 2 min ......... ~390/hora = 33% do teto, e 7 chamadas livres no
   *                          minuto da rajada — o que cobre a nota de um pedido
   *
   * A cada minuto seria 65% do teto com rajada em TODO minuto, por 60 segundos
   * que nenhum cliente percebe.
   */
  it('o saldo é relido a cada 2 minutos', () => {
    expect(CODIGO).toContain('export const INTERVALO_ESTOQUE_MS = 2 * 60_000;');
    const i = CODIGO.indexOf('sincronizarEstoquesErp().catch');
    expect(i).toBeGreaterThan(0);
    expect(CODIGO.slice(i, i + 160)).toContain('INTERVALO_ESTOQUE_MS');
  });

  it('e o cadastro continua de hora em hora', () => {
    const i = CODIGO.indexOf('sincronizarCardapiosErp().catch');
    expect(CODIGO.slice(i, i + 160)).toContain('60 * 60_000');
  });

  /*
   * AS DUAS NÃO RODAM JUNTAS. Bebem do mesmo balde de 20/min: o estoque (13)
   * entrando no meio da varredura do cadastro (37) atrasaria as duas — e a nota
   * do pedido daquele minuto ficaria na fila do ERP esperando a janela virar.
   */
  it('uma não entra no meio da outra', () => {
    for (const fn of ['sincronizarEstoquesErp', 'sincronizarCardapiosErp']) {
      const i = CODIGO.indexOf(`async function ${fn}`);
      const corpo = CODIGO.slice(i, i + 700);
      expect(corpo, fn).toContain('if (sincErpEmCurso)');
      expect(corpo, fn).toContain('sincErpEmCurso = true');
    }
  });

  it('a passada de estoque só alcança loja com local escolhido', () => {
    const i = CODIGO.indexOf('async function sincronizarEstoquesErp');
    const corpo = CODIGO.slice(i, i + 2000);
    expect(corpo).toContain('maxxgestao_local_estoque > 0');
    expect(corpo).toContain('maxxgestao_sinc_auto = 1');
  });

  /* Doze passadas por hora dizendo "0 ajustados" enterrariam a linha do dia em
     que o estoque virar. */
  it('passada sem mudança não vira log', () => {
    const i = CODIGO.indexOf('async function sincronizarEstoquesErp');
    const corpo = CODIGO.slice(i, i + 2500);
    expect(corpo).toMatch(/if \(r\.ajustados \|\| r\.passaramAEsgotar \|\| r\.deixaramDeEsgotar\)/);
  });
});
