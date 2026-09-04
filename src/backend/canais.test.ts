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

  it('os três ajustes do ERP em beta são barrados no servidor', () => {
    /*
     * Esconder o controle na tela não basta: a rota responde a quem chamar
     * direto, e quem está em estável não deveria conseguir ligar um ajuste que
     * ainda está sendo descoberto.
     */
    for (const [rota, chave] of [
      ["router.put('/erp/auto-emitir'", 'erp-auto-emitir'],
      ["router.put('/erp/modelo'", 'erp-modelo-documento'],
      ["router.put('/erp/caixa'", 'erp-caixa'],
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
    for (const c of ['erp-auto-emitir', 'erp-caixa', 'erp-modelo-documento']) {
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
