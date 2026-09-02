import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chamarMaxxGestao, consultarEmpresa, formatarCnpj, mensagemPorStatus,
  BASE_MAXXGESTAO, LIMITE_POR_MINUTO, ErroMaxxGestao,
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
