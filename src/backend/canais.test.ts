/**
 * CANAIS DE LIBERAÇÃO.
 *
 * A decisão é pura de propósito, então estes testes são de comportamento. Os
 * dois de fonte, no fim, existem para uma coisa que comportamento não pega: o
 * canal ser usado onde nunca deveria.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  CANAIS, canalValido, funcionalidadeLiberada, funcionalidadesDoCanal, FUNCIONALIDADES,
  diasNoCanal,
} from './canais';

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('o canal decide o que a loja enxerga', () => {
  it('teste contém beta, que contém estável', () => {
    /*
     * Não são três conjuntos separados: são três profundidades do mesmo. Se
     * fossem separados, a loja em teste deixaria de ver o que já é estável — e
     * o lojista que topou testar seria punido perdendo funcionalidade que todo
     * mundo tem.
     */
    const estavel = funcionalidadesDoCanal('estavel');
    const beta = funcionalidadesDoCanal('beta');
    const teste = funcionalidadesDoCanal('teste');
    for (const f of estavel) expect(beta).toContain(f);
    for (const f of beta) expect(teste).toContain(f);
    expect(teste.length).toBeGreaterThanOrEqual(beta.length);
    expect(beta.length).toBeGreaterThanOrEqual(estavel.length);
  });

  it('estável NÃO vê o que está em beta', () => {
    expect(funcionalidadeLiberada('erp-auto-emitir', 'estavel')).toBe(false);
    expect(funcionalidadeLiberada('erp-auto-emitir', 'beta')).toBe(true);
    expect(funcionalidadeLiberada('erp-auto-emitir', 'teste')).toBe(true);
  });

  it('canal ausente ou estranho vale ESTÁVEL', () => {
    /*
     * O padrão seguro aqui é ver MENOS, não mais: coluna com lixo (migração
     * torta, edição no MySQL) não pode abrir para a base inteira um recurso
     * que ainda está sendo descoberto.
     */
    for (const v of [null, undefined, '', 'producao', 'ESTAVEL ', 'canal-novo']) {
      expect(funcionalidadesDoCanal(v)).toEqual(funcionalidadesDoCanal('estavel'));
    }
    expect(canalValido('BETA')).toBe('beta');
    expect(canalValido(' teste ')).toBe('teste');
    expect(canalValido('outro')).toBe('estavel');
  });

  it('chave desconhecida devolve FALSE, nunca true', () => {
    /*
     * Um erro de digitação numa chave não pode LIGAR o recurso para todo mundo
     * — que é o que aconteceria se o padrão fosse permitir.
     */
    for (const canal of CANAIS) {
      expect(funcionalidadeLiberada('nao-existe', canal)).toBe(false);
      expect(funcionalidadeLiberada('', canal)).toBe(false);
    }
  });

  it('toda funcionalidade do catálogo tem canal válido e título', () => {
    /* Entrada sem título aparece vazia na tela do admin, que é onde alguém
       decide entregar aquilo a um cliente. */
    for (const [chave, f] of Object.entries(FUNCIONALIDADES)) {
      expect(CANAIS as readonly string[], chave).toContain(f.canal);
      expect(f.titulo.length, chave).toBeGreaterThan(10);
    }
  });
});

describe('o canal NUNCA governa segurança', () => {
  /*
   * A REGRA QUE JUSTIFICA O DESENHO INTEIRO.
   *
   * Um binário só serve todos os clientes justamente para que correção de
   * segurança chegue a todos no mesmo deploy. Com três versões do código
   * rodando, a falha precisaria ser corrigida, construída e publicada três
   * vezes — e o canal mais lento seria a janela do atacante.
   *
   * Estes testes são de fonte porque o risco não é um comportamento errado: é
   * alguém, daqui a meses, achar que `funcionalidadeLiberada` é um jeito
   * prático de ligar uma checagem "só para alguns".
   */
  const arquivos = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return arquivos(p);
      return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
    });

  const usam = arquivos(__dirname)
    .filter(f => semComentarios(fs.readFileSync(f, 'utf8')).includes('funcionalidadeLiberada'))
    .map(f => path.relative(__dirname, f).replace(/\\/g, '/'));

  it('não é usado em nenhum arquivo de autenticação ou proteção', () => {
    const proibidos = /auth|senha|token|cripto|sessao|permiss|limite|rate|cors|csrf|sanit/i;
    const infratores = usam.filter(f => proibidos.test(f) && f !== 'canais.ts');
    expect(infratores).toEqual([]);
  });

  it('o catálogo não tem funcionalidade que soe como proteção', () => {
    /*
     * Uma entrada chamada "validar-cpf" ou "limite-de-tentativas" seria uma
     * proteção ligada por canal — ou seja, desligada para a maioria.
     */
    const suspeito = /senha|token|auth|permiss|limite|bloque|valida|sanit|cript/i;
    const nomes = Object.keys(FUNCIONALIDADES).filter(k => suspeito.test(k));
    expect(nomes).toEqual([]);
  });

  it('o arquivo diz, por escrito, que segurança não passa por canal', () => {
    /* O comentário É a defesa aqui: quem for adicionar a próxima chave lê o
       cabeçalho antes de escrever a linha. */
    const fonte = fs.readFileSync(path.join(__dirname, 'canais.ts'), 'utf8');
    expect(fonte).toMatch(/O CANAL NÃO GOVERNA SEGURANÇA/);
    expect(fonte).toMatch(/mesmo deploy/);
  });
});

describe('as rotas em liberação exigem o canal', () => {
  const rotas = semComentarios(
    fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8'));

  it('os ajustes do ERP em beta são barrados no servidor', () => {
    /*
     * Esconder o controle na tela não basta: a rota responde a quem chamar
     * direto, e quem está em estável não deveria conseguir ligar um ajuste que
     * ainda está sendo descoberto.
     */
    for (const [rota, chave] of [
      ["router.put('/erp/auto-emitir'", 'erp-auto-emitir'],
      ["router.put('/erp/modelo'", 'erp-modelo-documento'],
      ["router.put('/erp/caixa'", 'erp-caixa'],
      /* O status ganhou CHAVE PROPRIA, e nao ficou junto do modelo: escolher a
         letra nao e experimental (o comportamento esta em producao desde o
         inicio), e junto do modelo o seletor ficaria invisivel para toda loja
         em estavel. Em beta por ora, para provar no Mostruario primeiro. */
      ["router.put('/erp/status'", 'erp-status-documento'],
    ]) {
      const i = rotas.indexOf(rota);
      expect(i, rota).toBeGreaterThan(0);
      expect(rotas.slice(i, i + 400), rota).toContain(`exigirFuncionalidade(loja, '${chave}')`);
    }
  });

  it('a guarda recusa com 403, e não em silêncio', () => {
    /*
     * Devolver 200 sem fazer nada faria o lojista clicar de novo achando que
     * não pegou.
     *
     * A asserção olha o CORPO DA FUNÇÃO, não uma janela em volta: testado com
     * `slice(i, i + 500)`, ele passava mesmo com o `throw` trocado por
     * `return` — o `erroHttp(403` da guarda vizinha caía na janela.
     */
    const i = rotas.indexOf('function exigirFuncionalidade');
    expect(i).toBeGreaterThan(0);
    const corpo = rotas.slice(i, rotas.indexOf('\n}', i));
    expect(corpo).toContain('erroHttp(403');
    expect(corpo).toContain('throw');
  });

  it('a tela recebe a lista pronta do servidor', () => {
    /* Repetir a regra do canal no navegador garantiria que as duas versões
       discordassem na primeira funcionalidade promovida. */
    expect(rotas).toContain('funcionalidades: funcionalidadesDoCanal(');
    const painel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel-maxxgestao.tsx'), 'utf8');
    expect(painel).toContain("estado?.funcionalidades?.includes(chave)");
    for (const c of ['erp-auto-emitir', 'erp-caixa', 'erp-modelo-documento',
      'erp-status-documento']) {
      expect(painel, c).toContain(`liberada('${c}')`);
    }
  });
});

describe('só a plataforma troca o canal', () => {
  const admin = fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8');

  it('a rota exige super admin', () => {
    /* Olha a LINHA DE REGISTRO: numa janela em volta, o `exigirSuperAdmin` da
       rota seguinte satisfaz a busca mesmo com a guarda removida. */
    const linha = admin.split('\n').find(l => l.includes("router.put('/lojas/:id/canal'"));
    expect(linha).toBeDefined();
    expect(linha).toContain('exigirSuperAdmin');
  });

  it('canal inválido é RECUSADO, não corrigido em silêncio', () => {
    /*
     * Aqui é escolha explícita de gente: gravar `estavel` quando pediram outra
     * coisa faria o admin concluir que a tela não funciona. No BANCO é o
     * contrário — lá o padrão protege quem lê.
     */
    const i = admin.indexOf("router.put('/lojas/:id/canal'");
    const t = admin.slice(i, i + 900);
    expect(t).toContain('CANAIS');
    expect(t).toMatch(/erroHttp\(400/);
  });

  it('a troca fica registrada na auditoria', () => {
    /* Mudar o canal muda o que o cliente vê. Sem registro, "desde quando essa
       loja está em beta?" não tem resposta. */
    const i = admin.indexOf("router.put('/lojas/:id/canal'");
    expect(admin.slice(i, i + 1200)).toContain("registrarAuditoria(req, 'loja.canal'");
  });
});

describe('a visibilidade do rollout', () => {
  const admin = fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8');
  const campos = fs.readFileSync(path.join(__dirname, 'quem-emite.ts'), 'utf8');

  it('o canal é COLUNA da lista de lojas, não detalhe', () => {
    /*
     * Sem ele na lista, descobrir quem está em beta exigia abrir uma loja por
     * vez — e "quantos já estão recebendo isso?" é a pergunta que decide
     * promover uma funcionalidade.
     */
    const i = campos.indexOf('CAMPOS_LOJA_LISTA');
    expect(campos.slice(i, campos.indexOf('] as const', i))).toContain("'canal_versao'");
    const tela = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');
    expect(tela).toContain('l.canal_versao');
  });

  it('a rota de canais conta as lojas de cada um', () => {
    const i = admin.indexOf("router.get('/canais'");
    expect(i).toBeGreaterThan(0);
    const t = admin.slice(i, i + 2200);
    expect(t).toContain('GROUP BY canal_versao');
    expect(t).toContain('lojas: lojasPorCanal[c]');
    /* E lista o que CADA canal entrega, com há quantos dias. */
    expect(t).toContain('dias: diasNoCanal(k)');
  });

  it('só o super admin lê e escreve os canais', () => {
    for (const rota of ["router.get('/canais'", "router.put('/canais/:canal/nota'"]) {
      const linha = admin.split('\n').find(l => l.includes(rota));
      expect(linha, rota).toBeDefined();
      expect(linha, rota).toContain('exigirSuperAdmin');
    }
  });

  it('canal desconhecido não vira chave de configuração', () => {
    /* `req.params.canal` monta o nome da chave gravada. Sem a lista fechada,
       qualquer texto viraria uma linha nova em `configuracoes`. */
    const i = admin.indexOf("router.put('/canais/:canal/nota'");
    const t = admin.slice(i, i + 800);
    expect(t).toContain('CHAVE_NOTA[String(req.params.canal)]');
    expect(t).toMatch(/if \(!chave\) throw/);
  });

  it('a nota fica registrada na auditoria', () => {
    /* É texto que o lojista vê. Sem registro, "quem escreveu isso?" não tem
       resposta. */
    const i = admin.indexOf("router.put('/canais/:canal/nota'");
    expect(admin.slice(i, i + 900)).toContain("registrarAuditoria(req, 'canal.nota'");
  });
});

describe('o lojista sabe em que canal está', () => {
  const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const painel = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel.tsx'), 'utf8');

  it('o canal e a nota vão no GET /loja', () => {
    const i = rotas.indexOf("router.get('/loja'");
    const t = rotas.slice(i, i + 3000);
    expect(t).toContain('canal,');
    expect(t).toContain('canal_nota: notaCanal');
  });

  it('o canal vem da COLUNA daquela loja, não de uma constante', () => {
    /*
     * Testado antes só por "o campo aparece na resposta", e isso passava com o
     * valor cravado em `'beta'` — todo lojista veria o aviso, e o do canal
     * certo veria o texto errado. A asserção olha a derivação.
     */
    const i = rotas.indexOf("router.get('/loja'");
    const t = rotas.slice(i, i + 3000);
    expect(t).toContain('canalValido((loja as { canal_versao?: string }).canal_versao)');
  });

  it('quem está em ESTÁVEL não recebe nota nenhuma', () => {
    /*
     * Avisar "você está no normal" é ruído que gasta a atenção que os outros
     * dois canais precisam — e ainda faria uma consulta a mais por
     * carregamento de painel, para todo mundo.
     */
    const i = rotas.indexOf("router.get('/loja'");
    expect(rotas.slice(i, i + 3000)).toContain("canal === 'estavel' ? '' :");
  });

  it('a tela só mostra o aviso fora do recomendado', () => {
    expect(painel).toContain("{canal !== 'estavel' && (");
    expect(painel).toContain('canalRotulo');
  });
});

describe('o catálogo diz há quanto tempo cada coisa está parada', () => {
  it('toda funcionalidade tem data de entrada no canal', () => {
    /* Sem ela, canal vira gaveta: nada lembra de decidir, e a funcionalidade
       fica em beta para sempre. */
    for (const [chave, f] of Object.entries(FUNCIONALIDADES)) {
      expect((f as { desde?: string }).desde, chave).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('diasNoCanal conta a partir da data, e nunca devolve negativo', () => {
    const doisDias = Date.parse('2026-09-06T00:00:00Z');
    expect(diasNoCanal('erp-caixa', doisDias)).toBe(2);
    /* Data no futuro (relógio torto, digitação) não pode virar "-3 dias" na
       tela: zero é a leitura honesta de "acabou de entrar". */
    expect(diasNoCanal('erp-caixa', Date.parse('2026-09-01T00:00:00Z'))).toBe(0);
    expect(diasNoCanal('nao-existe', doisDias)).toBe(0);
  });
});
