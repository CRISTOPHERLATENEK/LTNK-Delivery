import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { leituraDoErpFalhouDeVez } from './rotas/lojista';

/*
 * TROPEÇO DO ERP NÃO PODE MATAR A IMPORTAÇÃO — NEM VIRAR TELA MUDA.
 *
 * Medido em produção no dia 09/09, na loja Galderio Bebidas: o Maxx Gestão
 * passou por volta de três minutos sem responder. O que apareceu:
 *
 *   GET  /api/lojista/erp/catalogos -> 500 (Internal Server Error)
 *   POST /api/lojista/erp/importar  -> 400 (Bad Request)
 *
 * e o painel com "Lendo o cadastro do Maxx Gestão…" parado na tela, ao lado de
 * um botão de novo escrito "Trazer". Três defeitos empilhados:
 *
 *  1. `listarCatalogos` sem try — erro do ERP subia como 500 sem texto;
 *  2. leitura que falhou por causa DELES devolvia 400 (culpa do cliente) e a
 *     tela desistia de uma importação que voltaria a andar sozinha;
 *  3. o texto de andamento nunca era apagado no erro, e falha que não fosse
 *     `ApiError` não mostrava mensagem nenhuma.
 *
 * Conferido depois, com o token real: o ERP responde em ~100ms, tem 1.234
 * mercadorias e 1.234 preços. Não era o token nem o cadastro — era um tropeço
 * de minutos que o nosso lado transformou em desistência definitiva.
 */

const BACKEND = __dirname;
const rotas = fs.readFileSync(path.join(BACKEND, 'rotas', 'lojista.ts'), 'utf8');
const painel = fs.readFileSync(path.join(
  BACKEND, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel-maxxgestao.tsx'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('o que é tropeço e o que é recusa', () => {
  /*
   * `httpStatus` 0 quer dizer INDEFINIDO: a chamada não chegou a ter resposta.
   * Para LEITURA isso é repetível à vontade — é o próprio cliente que diz.
   */
  it('sem resposta é tropeço', () => {
    expect(leituraDoErpFalhouDeVez(0)).toBe(false);
    expect(leituraDoErpFalhouDeVez(undefined)).toBe(false);
  });

  it('problema no servidor deles é tropeço', () => {
    expect(leituraDoErpFalhouDeVez(500)).toBe(false);
    expect(leituraDoErpFalhouDeVez(502)).toBe(false);
    expect(leituraDoErpFalhouDeVez(503)).toBe(false);
  });

  /*
   * E O QUE NÃO MELHORA COM ESPERA CONTINUA DEFINITIVO. Insistir com token
   * errado gastaria a janela de 20 chamadas por minuto do cliente sem nunca
   * dar em nada — e esconderia do lojista a única coisa que ele podia resolver.
   */
  it('token recusado é definitivo', () => {
    expect(leituraDoErpFalhouDeVez(401)).toBe(true);
    expect(leituraDoErpFalhouDeVez(403)).toBe(true);
  });

  it('pedido malformado é definitivo', () => {
    expect(leituraDoErpFalhouDeVez(400)).toBe(true);
    expect(leituraDoErpFalhouDeVez(404)).toBe(true);
  });

  /* 429 tem caminho próprio (LimiteMaxxGestao, com a espera que eles pedem) e
     nunca chega aqui — mas se chegar, esperar é a resposta certa. */
  it('excesso de chamadas não é definitivo', () => {
    expect(leituraDoErpFalhouDeVez(429)).toBe(false);
  });
});

describe('a rota de importação', () => {
  it('o teste está lendo o arquivo certo', () => {
    expect(rotas).toContain("router.post('/erp/importar'");
    expect(rotas).toContain('leituraDoErpFalhouDeVez');
  });

  /*
   * AS TRÊS FALHAS DE LEITURA passam pela mesma decisão. Eram três `return
   * res.status(400)` idênticos, e três é onde se conserta um e esquece dois.
   */
  it('toda desistência com 400 é precedida da checagem de tropeço', () => {
    const inicio = rotas.indexOf("router.post('/erp/importar'");
    const fim = rotas.indexOf('\nrouter.', inicio + 10);
    const trecho = exec(rotas.slice(inicio, fim > inicio ? fim : undefined));
    const desistencias = trecho.match(/return res\.status\(400\)\.json\(\{ erro: erro\.message/g) ?? [];
    const checagens = trecho.match(/if \(!leituraDoErpFalhouDeVez\(erro\.httpStatus\)\)/g) ?? [];
    expect(desistencias.length).toBeGreaterThanOrEqual(3);
    expect(checagens.length).toBe(desistencias.length);
  });

  /*
   * A LETRA QUE FALHOU VOLTA PARA A PRÓXIMA RODADA, e o que já foi lido é
   * gravado — igual ao caminho do limite, que já funcionava. Devolver erro ali
   * jogava fora as letras anteriores DESTA MESMA requisição: trabalho feito,
   * perdido por causa de uma chamada.
   */
  it('a varredura interrompida guarda o que leu e pede o resto', () => {
    const laco = exec(rotas).slice(exec(rotas).indexOf('falha ao ler o cardapio'));
    const ate = laco.slice(0, laco.indexOf('const terminou'));
    expect(ate).toContain('esperar = 5_000');
    expect(ate).toContain('restantes.push(...pedidas.slice(k))');
  });
});

describe('a rota de catálogos', () => {
  const rota = (() => {
    const i = rotas.indexOf("router.get('/erp/catalogos'");
    return rotas.slice(i, rotas.indexOf("router.post('/erp/importar'"));
  })();

  it('o teste está lendo a rota certa', () => {
    expect(rota).toContain('listarCatalogos');
    expect(rota.length).toBeGreaterThan(400);
  });

  /*
   * ERRO DO ERP NÃO SUBE COMO 500. O 500 cai no tratador genérico, chega ao
   * navegador sem texto, e a tela não tem o que mostrar.
   */
  it('a falha do ERP vira mensagem, não erro interno', () => {
    const codigo = exec(rota);
    const iChamada = codigo.indexOf('await listarCatalogos(token)');
    /*
     * O `catch` TEM QUE ESTAR ENTRE a chamada e o uso do resultado.
     *
     * A primeira versão deste teste procurava o `try {` mais próximo ANTES da
     * chamada — e encontrava o `try` que abre a rota inteira, então passava
     * mesmo com a chamada solta. Armadilha de asserção que olha para trás: o
     * envoltório de tudo satisfaz qualquer coisa.
     */
    const iCatch = codigo.indexOf('} catch (e) {', iChamada);
    const iUso = codigo.indexOf('const fora', iChamada);
    expect(iChamada).toBeGreaterThan(0);
    expect(iCatch).toBeGreaterThan(iChamada);
    expect(iCatch).toBeLessThan(iUso);
    expect(codigo).toContain("erro.message || 'Não consegui ler os catálogos do Maxx Gestão.'");
  });
});

describe('o painel na tela', () => {
  it('o teste está lendo o painel certo', () => {
    expect(painel).toContain('/api/lojista/erp/catalogos');
    expect(painel).toContain('async function importar()');
  });

  /*
   * O ANDAMENTO NÃO SOBREVIVE À FALHA. Texto dizendo "Lendo o cadastro…" ao
   * lado de um botão pronto para clicar é a tela afirmando duas coisas opostas.
   */
  it('toda saída sem sucesso apaga o andamento', () => {
    const fn = painel.slice(painel.indexOf('async function importar()'));
    const corpo = fn.slice(0, fn.indexOf('\n  }\n'));
    /* As três saídas que não são `terminou`: parou de avançar, teto de voltas,
       e a exceção. A de sucesso não precisa — ali o texto é o resultado. */
    const semSucesso = corpo.split('if (r.terminou)')[1] ?? '';
    expect((semSucesso.match(/setAndamento\(''\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  /*
   * E FALHA QUE NÃO É `ApiError` TAMBÉM APARECE. Internet caindo no meio da
   * importação não é resposta do servidor, e o `if (err instanceof ApiError)`
   * sozinho engolia isso sem uma palavra na tela.
   */
  it('erro de rede também mostra mensagem', () => {
    const fn = painel.slice(painel.indexOf('async function importar()'));
    const captura = fn.slice(fn.indexOf('} catch (err) {'), fn.indexOf('} finally {'));
    expect(captura).toContain('err instanceof ApiError');
    expect(captura).toContain('Não consegui falar com o servidor');
    /* O `mostrar` é chamado SEM condicional: era `if (err instanceof ApiError)
       mostrar(...)`, e o `else` era o silêncio. */
    expect(exec(captura)).not.toMatch(/if \(err instanceof ApiError\) mostrar/);
  });

  /*
   * FALHA AO LER OS CATÁLOGOS NÃO VIRA "NENHUM CATÁLOGO". Lista vazia esconde o
   * seletor, e a tela fica idêntica à de uma empresa que não tem catálogo — quem
   * lê conclui que não há o que escolher e importa a empresa inteira, que pausa
   * o que não estiver lá.
   */
  it('a falha da lista de catálogos aparece na tela', () => {
    expect(painel).toContain('erroCatalogos');
    const captura = exec(painel.slice(
      painel.indexOf('.catch(err => {', painel.indexOf('/erp/catalogos'))));
    /* CHAMADA DE VERDADE, não expressão morta: `void 0 && setErroCatalogos(…)`
       contém o nome e não faz nada. A chamada tem que abrir a instrução. */
    expect(captura.slice(0, 400)).toMatch(/\n\s*setErroCatalogos\(/);
    expect(painel).toContain('Sem a lista, o que vier é a empresa inteira.');
  });
});
