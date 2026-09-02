import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chamarMaxxGestao, consultarEmpresa, formatarCnpj, mensagemPorStatus,
  BASE_MAXXGESTAO, LIMITE_POR_MINUTO, ErroMaxxGestao,
  limparLimitesMaxxGestao, reporFichas, baldeNovo, esperaEmMs,
} from './maxxgestao-cliente';

/** Um `fetch` que grava o que recebeu e devolve o que mandarem. */
function espiao(status: number, corpo: unknown) {
  const visto: { url?: string; headers?: Record<string, string> } = {};
  const buscar = (async (url: string, init: RequestInit) => {
    visto.url = String(url);
    visto.headers = init.headers as Record<string, string>;
    return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status });
  }) as unknown as typeof fetch;
  return { buscar, visto };
}

const EMPRESA = {
  razaoSocial: 'UNIMAXX SOLUCOES EM TECNOLOGIA LTDA',
  fantasia: 'UNIMAXX SISTEMAS',
  cnpjCpf: '48935328000126',
  uf: 'SC', municipio: 'JOINVILLE',
  crt: 1, crtDescricao: 'Simples Nacional',
};

describe('o header de autenticação', () => {
  it('usa o prefixo Authentication, NÃO Bearer', async () => {
    /*
     * A doc deles manda `Authorization: Authentication {token}`. Com `Bearer` a
     * resposta é 401 e a mensagem não diz o motivo — o tipo de erro em que se
     * perde uma tarde conferindo se o token está certo.
     */
    const { buscar, visto } = espiao(200, EMPRESA);
    await chamarMaxxGestao('abc123', '/api/empresa/v1', { buscar });
    expect(visto.headers?.Authorization).toBe('Authentication abc123');
    expect(visto.headers?.Authorization).not.toMatch(/Bearer/);
  });

  it('apara espaço em volta do token', () => {
    /* Token colado de painel vem com espaço ou quebra de linha atrás. */
    const { buscar, visto } = espiao(200, EMPRESA);
    return chamarMaxxGestao('  abc123\n', '/api/empresa/v1', { buscar }).then(() => {
      expect(visto.headers?.Authorization).toBe('Authentication abc123');
    });
  });

  it('token vazio nem sai de casa', async () => {
    /* Chamar sem token gastaria uma das 20 requisições do minuto para receber
       401 — e o erro certo ("não configurado") é diferente de "recusado". */
    await expect(chamarMaxxGestao('   ', '/api/empresa/v1', { buscar: espiao(200, EMPRESA).buscar }))
      .rejects.toThrow(/não configurado/i);
  });

  it('monta a URL no servidor único da API', async () => {
    const { buscar, visto } = espiao(200, EMPRESA);
    await chamarMaxxGestao('t', '/api/empresa/v1', { buscar });
    expect(visto.url).toBe(BASE_MAXXGESTAO + '/api/empresa/v1');
    /* Um servidor só: homologação x produção é escolha do ERP, não do host. */
    expect(BASE_MAXXGESTAO).toBe('https://api.meuerponline.com.br/publica');
  });
});

describe('os erros que a tela vai mostrar', () => {
  it('401 fala de token, não de número', () => {
    expect(mensagemPorStatus(401)).toMatch(/token/i);
    expect(mensagemPorStatus(403)).toMatch(/token/i);
  });

  it('429 diz para esperar, e cita o limite', () => {
    /*
     * O 429 é o único que passa sozinho. Chamá-lo de "erro no ERP" faria
     * alguém sair conferindo token quando bastava esperar um minuto.
     */
    expect(mensagemPorStatus(429)).toContain(String(LIMITE_POR_MINUTO));
    expect(mensagemPorStatus(429)).toMatch(/minuto/i);
  });

  it('5xx aponta para o lado deles', () => {
    expect(mensagemPorStatus(500)).toMatch(/servidor/i);
  });

  it('a mensagem do corpo tem prioridade sobre a genérica', async () => {
    /* Quando o ERP explica o problema, repetir "respondeu 400" seria jogar a
       explicação no lixo. */
    const { buscar } = espiao(400, { mensagem: 'Natureza de operação inválida' });
    await expect(chamarMaxxGestao('t', '/x', { buscar })).rejects.toThrow('Natureza de operação inválida');
  });

  it('rede caída vira httpStatus 0, que é INDEFINIDO', async () => {
    /*
     * Zero não é "falhou": é "não sei". Para leitura dá para repetir; para
     * criar documento, quem chama tem que consultar antes de repetir, senão
     * cria dois documentos fiscais para o mesmo pedido.
     */
    const buscar = (async () => { throw new Error('sem rede'); }) as unknown as typeof fetch;
    await chamarMaxxGestao('t', '/x', { buscar }).then(
      () => { throw new Error('devia ter falhado'); },
      (e: ErroMaxxGestao) => expect(e.httpStatus).toBe(0),
    );
  });

  it('o status vem no erro para quem chama decidir', async () => {
    const { buscar } = espiao(429, {});
    await chamarMaxxGestao('t', '/x', { buscar }).then(
      () => { throw new Error('devia ter falhado'); },
      (e: ErroMaxxGestao) => expect(e.httpStatus).toBe(429),
    );
  });
});

describe('o teste de conexão', () => {
  it('devolve a empresa, que é o que a pessoa reconhece', async () => {
    /*
     * Um "ok" verde não prova nada. Ver o CNPJ da própria empresa prova que o
     * token é da conta certa — e token da conta errada é o erro que só
     * apareceria na primeira nota emitida no CNPJ de outro.
     */
    const { buscar, visto } = espiao(200, EMPRESA);
    const e = await consultarEmpresa('t', { buscar });
    expect(visto.url).toContain('/api/empresa/v1');
    expect(e.razaoSocial).toBe('UNIMAXX SOLUCOES EM TECNOLOGIA LTDA');
    expect(e.cnpjCpf).toBe('48935328000126');
    expect(e.crt).toBe(1);
    expect(e.crtDescricao).toBe('Simples Nacional');
  });

  it('resposta sem corpo não passa por conexão boa', async () => {
    /* 200 com corpo vazio existe em gateway mal configurado, e tratar isso como
       sucesso mostraria "conectado" para um token que não vale. */
    const { buscar } = espiao(200, undefined);
    await expect(consultarEmpresa('t', { buscar })).rejects.toThrow(/sem os dados/i);
  });
});

describe('CNPJ na tela', () => {
  it('sai formatado', () => {
    /* Sem isso a pessoa confere 14 dígitos na mão. */
    expect(formatarCnpj('48935328000126')).toBe('48.935.328/0001-26');
  });

  it('o que não é CNPJ volta como veio', () => {
    /* Inventar máscara em cima de dado estranho esconde o dado estranho. */
    expect(formatarCnpj('123')).toBe('123');
    expect(formatarCnpj('')).toBe('');
  });
});

describe('o servidor não emite junto com o ERP', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a emissão automática para com QUALQUER emissor que não seja o sistema', () => {
    /*
     * `!== 'sistema'` e não uma lista de exceções: emissor novo no futuro entra
     * desligando a emissão daqui, que é o lado seguro do erro. O contrário —
     * nosso servidor emitindo junto com um emissor que ninguém mapeou — só
     * apareceria na conversa com o contador.
     */
    expect(fonte).toContain("!== 'sistema') return null;");
    expect(fonte).not.toContain("=== 'maquininha') return null;");
  });

  it('ligar o ERP exige o token gravado', () => {
    /* Sem token nada chega no ERP, e isso não dá tela de erro: dá uma fila de
       vendas sem nota que ninguém percebe até o contador perguntar. */
    const i = fonte.indexOf("sets.push('nfce_emissor = ?')");
    expect(i).toBeGreaterThan(0);
    const antes = fonte.slice(0, i);
    expect(antes).toContain("quem === 'erp'");
    expect(antes).toContain('tokenMaxxGestaoDaLoja(loja.id)');
  });

  it('o token é gravado CIFRADO e sai mascarado', () => {
    /* Quem tem o token emite nota fiscal no CNPJ de alguém. */
    expect(fonte).toContain('maxxgestao_token = ?');
    expect(fonte).toContain('criptografar(v)');
    expect(fonte).toContain('mascarar(token)');
  });

  it('a máscara voltando da tela não apaga o token', () => {
    /*
     * O campo nasce preenchido com `****`; gravar isso zeraria a credencial de
     * quem só quis mexer em outra coisa.
     *
     * A JANELA É ESTREITA DE PROPÓSITO: a primeira versão deste teste procurava
     * `v.startsWith('****')` no arquivo inteiro, e passava mesmo com a guarda do
     * ERP removida — porque a do TEF, noutro bloco, satisfazia a busca. Teste
     * que não falha quando o código quebra não é teste.
     */
    const i = fonte.indexOf('maxxgestao_token = ?');
    expect(i).toBeGreaterThan(0);
    const trecho = fonte.slice(Math.max(0, i - 400), i);
    expect(trecho).toContain("!v.startsWith('****')");
  });
});

describe('o limite de 20 requisições por minuto', () => {
  /*
   * O limite é POR TOKEN. Emitir uma nota por pedido cabe folgado nos 20;
   * espelhar catálogo, não. Sem limitador a primeira sincronização manda tudo
   * de uma vez, toma 429 no meio, e sobra catálogo pela metade no ERP — pior
   * que nenhum, porque ninguém sabe qual metade existe.
   */
  function relogio(inicio = 1_000_000) {
    let t = inicio;
    const dormidas: number[] = [];
    return {
      dormidas,
      deps: {
        agora: () => t,
        /* Não espera de verdade: anota quanto teria esperado e adianta o
           relógio. Teste que dorme 3 segundos por chamada ninguém roda. */
        dormir: async (ms: number) => { dormidas.push(ms); t += ms; },
      },
    };
  }

  beforeEach(() => limparLimitesMaxxGestao());

  it('as primeiras 20 saem sem esperar', async () => {
    /* O teste de conexão do lojista não pode levar 3 segundos para dizer
       "conectado" — daí balde de fichas, e não intervalo fixo. */
    const r = relogio();
    const { buscar } = espiao(200, EMPRESA);
    for (let i = 0; i < LIMITE_POR_MINUTO; i++) {
      await chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps });
    }
    expect(r.dormidas).toEqual([]);
  });

  it('a 21ª espera os 3 segundos da próxima ficha', async () => {
    const r = relogio();
    const { buscar } = espiao(200, EMPRESA);
    for (let i = 0; i < LIMITE_POR_MINUTO + 1; i++) {
      await chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps });
    }
    expect(r.dormidas).toHaveLength(1);
    /* 20 fichas por minuto = uma a cada 3000ms. */
    expect(r.dormidas[0]).toBe(3000);
  });

  it('chamadas simultâneas NÃO furam a conta', async () => {
    /*
     * A serialização é o que faz o limitador valer. Sem a fila, 25 chamadas
     * disparadas juntas leem o balde no mesmo instante, todas veem 20 fichas e
     * todas passam — o limitador existiria só no papel.
     */
    const r = relogio();
    const { buscar } = espiao(200, EMPRESA);
    await Promise.all(
      Array.from({ length: 25 }, () => chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps })),
    );
    expect(r.dormidas).toHaveLength(5);
  });

  it('esperar repõe fichas, e a rajada seguinte passa direto', async () => {
    const r = relogio();
    const { buscar } = espiao(200, EMPRESA);
    for (let i = 0; i < LIMITE_POR_MINUTO; i++) {
      await chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps });
    }
    /* Um minuto parado devolve o balde cheio. */
    r.deps.agora = (() => { const t = 1_000_000 + 60_000; return () => t; })();
    r.dormidas.length = 0;
    for (let i = 0; i < LIMITE_POR_MINUTO; i++) {
      await chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps });
    }
    expect(r.dormidas).toEqual([]);
  });

  it('a conta é por TOKEN, não global', async () => {
    /* Uma loja sincronizando catálogo não pode atrasar a nota de outra. */
    const r = relogio();
    const { buscar } = espiao(200, EMPRESA);
    for (let i = 0; i < LIMITE_POR_MINUTO; i++) {
      await chamarMaxxGestao('loja-a', '/x', { buscar, limite: r.deps });
    }
    r.dormidas.length = 0;
    await chamarMaxxGestao('loja-b', '/x', { buscar, limite: r.deps });
    expect(r.dormidas).toEqual([]);
  });

  it('uma falha não trava a fila das seguintes', async () => {
    /* Erro de uma chamada é problema de quem a chamou. Deixar a exceção
       derrubar a corrente pararia o token até o processo reiniciar. */
    const r = relogio();
    const quebrado = (async () => { throw new Error('caiu'); }) as unknown as typeof fetch;
    await expect(chamarMaxxGestao('tok', '/x', { buscar: quebrado, limite: r.deps })).rejects.toThrow();
    const { buscar } = espiao(200, EMPRESA);
    await expect(chamarMaxxGestao('tok', '/x', { buscar, limite: r.deps })).resolves.toBeTruthy();
  });

  it('o balde nunca passa da capacidade', () => {
    /* Ficar parado uma hora não dá direito a 1200 chamadas de uma vez — isso
       tomaria 429 na cara, que é justamente o que o limitador evita. */
    const cheio = reporFichas(baldeNovo(0), 3_600_000);
    expect(cheio.fichas).toBe(LIMITE_POR_MINUTO);
    expect(esperaEmMs(cheio)).toBe(0);
  });
});

describe('o timeout mede a chamada, não a fila', () => {
  /*
   * O BUG QUE ISTO IMPEDE, e ele aconteceu em produção: o cronômetro começava
   * ANTES da vez na fila do limitador, então a espera do NOSSO balde contava
   * como demora do servidor deles. Numa varredura de catálogo, a segunda letra
   * morria com "O Maxx Gestão não respondeu" enquanto o ERP estava perfeito.
   *
   * A ESPERA AQUI É REAL, de propósito. A primeira versão deste teste usava
   * relógio falso — e passava com o bug reintroduzido, porque um `dormir` que
   * só adianta um contador não deixa o `setTimeout` de verdade disparar. Para
   * medir cronômetro é preciso deixar o tempo passar.
   */
  beforeEach(() => limparLimitesMaxxGestao());

  it('com o balde vazio, a chamada seguinte AINDA funciona', async () => {
    const deps = {
      /* Relógio real; só a duração da espera é encurtada, para o teste não
         levar três segundos. */
      dormir: () => new Promise<void>(r => { setTimeout(r, 40); }),
    };
    /*
     * O FAKE RESPEITA O `signal`, como o `fetch` de verdade. Sem isso o teste
     * não mede nada: um fake que ignora o aborto resolve com sucesso mesmo
     * depois de o cronômetro ter disparado — foi assim que a segunda versão
     * deste teste passou com o bug reintroduzido.
     */
    const buscar = (async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new Error('abortado');
      return new Response(JSON.stringify(EMPRESA), { status: 200 });
    }) as unknown as typeof fetch;

    for (let i = 0; i < LIMITE_POR_MINUTO; i++) {
      await chamarMaxxGestao('tok', '/x', { buscar, limite: deps });
    }

    /* A 21ª espera na fila. Com `timeoutMs` de 10ms, a versão antiga abortava
       durante a espera; agora o cronômetro só começa quando a vez chega. */
    await expect(
      chamarMaxxGestao('tok', '/x', { buscar, limite: deps, timeoutMs: 10 }),
    ).resolves.toBeTruthy();
  });
});
