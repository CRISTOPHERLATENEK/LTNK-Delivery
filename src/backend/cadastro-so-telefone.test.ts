import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { telefoneValido } from './util';

/*
 * DO CLIENTE, SÓ O TELEFONE É OBRIGATÓRIO.
 *
 * Antes o CPF era exigido, com a justificativa de ser "dado fiscal, usado na
 * NFC-e". Não era verdade no sentido que importa: sem CPF a venda sai como
 * CONSUMIDOR FINAL, que é legal e é como sai a maioria das vendas de balcão. O
 * que o CPF obrigatório fazia de fato era pedir documento de identidade a quem
 * só quer pedir uma pizza — atrito antes da primeira compra, quando a pessoa
 * ainda não tem motivo nenhum para confiar na loja.
 *
 * O telefone tomou o lugar dele na lista de obrigatórios, e não por simetria: é
 * o que a loja usa para falar com quem pediu, e é por ele que a pessoa entra na
 * conta depois (o login já aceitava telefone). Ele deixou de ser um "seria bom
 * ter" e virou IDENTIDADE — por isso passou a ser validado de verdade.
 *
 * E a regra vale nos DOIS cadastros: o público e o que a nossa equipe usa. Eles
 * criam a mesma coisa, e o comentário da rota do admin promete "mesma
 * validação" — mudar só um lado faria a promessa mentir e deixaria a equipe
 * exigindo por telefone um documento que o site não pede.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const autenticacao = fs.readFileSync(path.join(BACKEND, 'rotas', 'autenticacao.ts'), 'utf8');
const admin = fs.readFileSync(path.join(BACKEND, 'rotas', 'admin.ts'), 'utf8');
const conta = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'cliente', 'conta.tsx'), 'utf8');
const telFront = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'lib', 'telefone.ts'), 'utf8');
const admLojistas = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'lojistas.tsx'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('telefoneValido', () => {
  it('aceita celular com o nono dígito e fixo de oito', () => {
    expect(telefoneValido('47 9651-9854')).toBe(true);      // 10, fixo
    expect(telefoneValido('(11) 99999-9999')).toBe(true);   // 11, celular
  });

  it('recusa tamanho que não existe no Brasil', () => {
    expect(telefoneValido('')).toBe(false);
    expect(telefoneValido('999999999')).toBe(false);        // 9 dígitos
  });

  /*
   * DÍGITO A MAIS É ERRO, NÃO CORTE — e este teste é o que descobriu o defeito.
   *
   * A primeira versão validava sobre `telefoneDigitos`, que corta em 11. Doze
   * dígitos passavam: o corte jogava o último fora e sobrava um número válido.
   * Num campo com máscara isso é conveniência; na IDENTIDADE da conta é grave —
   * a pessoa digita doze e a conta nasce com onze, num número que ela não
   * digitou e não vai reconhecer quando precisar entrar.
   */
  it('recusa dígito a mais em vez de cortar', () => {
    expect(telefoneValido('119999999999')).toBe(false);     // 12
    expect(telefoneValido('1199999999999')).toBe(false);    // 13
    /* E o de 11 legítimo continua passando: a asserção que prova que o conserto
       não foi "recusar tudo que é longo". */
    expect(telefoneValido('11999999999')).toBe(true);
  });

  /* Nenhum DDD começa com zero — quem digita 0 está pondo o prefixo de
     operadora, e o número entraria torto. */
  it('recusa DDD começando em zero', () => {
    expect(telefoneValido('01199999999')).toBe(false);
    expect(telefoneValido('0119999999')).toBe(false);
  });

  /* Celular no Brasil tem o nono dígito desde 2016: 11 dígitos sem ele é
     dígito digitado a mais num fixo. */
  it('recusa 11 dígitos sem o 9 na frente do número', () => {
    expect(telefoneValido('11899999999')).toBe(false);
    expect(telefoneValido('11999999999')).toBe(true);
  });

  /*
   * O DÍGITO REPETIDO É O CASO QUE MOTIVA A FUNÇÃO. É o que se digita para
   * atravessar um campo obrigatório sem informar nada — e agora esse campo é a
   * única forma de recuperar a conta.
   */
  it('recusa um dígito repetido do começo ao fim', () => {
    expect(telefoneValido('11111111111')).toBe(false);
    expect(telefoneValido('9999999999')).toBe(false);
    /* E não recusa número legítimo com repetição PARCIAL — a asserção que pega
       um regex sem retrovisor (`/^(\d)+$/` casaria tudo). */
    expect(telefoneValido('11999999999')).toBe(true);
    expect(telefoneValido('47988888888')).toBe(true);
  });

  it('ignora máscara', () => {
    expect(telefoneValido('(11) 99999-9999')).toBe(telefoneValido('11999999999'));
  });
});

describe('o cadastro público', () => {
  const rota = (() => {
    const i = autenticacao.indexOf("router.post('/registrar'");
    return exec(autenticacao.slice(i, autenticacao.indexOf('\nrouter.', i + 10)));
  })();

  it('o teste está lendo a rota certa', () => {
    expect(rota).toContain('PERFIS_PUBLICOS');
    expect(rota.length).toBeGreaterThan(500);
  });

  it('exige telefone válido', () => {
    expect(rota).toContain('if (!telefoneValido(telefone))');
    expect(rota).toContain('Informe um telefone válido com DDD.');
  });

  /*
   * E NÃO EXIGE MAIS O CPF. A asserção é sobre a ausência do `!cpfValido` sem
   * guarda — a forma antiga, que barrava quem deixou em branco.
   */
  it('não exige CPF', () => {
    expect(rota).not.toContain('if (!cpfValido(cpf))');
    expect(rota).not.toContain("Informe um CPF válido.'");
  });

  /* Mas CPF ERRADO continua barrado: ele iria para a nota fiscal de alguém. */
  it('CPF preenchido é validado; em branco passa', () => {
    expect(rota).toContain('if (cpf && !cpfValido(cpf))');
    expect(rota).toContain('Informe um CPF válido ou deixe em branco.');
  });

  /*
   * O TELEFONE É CONFERIDO SEMPRE, não "se informado". Ele é a identidade: dois
   * cadastros com o mesmo telefone seriam duas contas que disputam o mesmo
   * login.
   */
  it('a unicidade do telefone é conferida sem condicional', () => {
    expect(rota).toMatch(/const telExiste = await db\.prepare\('SELECT id FROM usuarios WHERE telefone = \?'\)/);
    const iTel = rota.indexOf('const telExiste');
    const iCond = rota.indexOf('if (telefone) {');
    expect(iTel).toBeGreaterThan(0);
    expect(iCond).toBe(-1);
  });

  /*
   * O E-MAIL SINTÉTICO PASSOU A SAIR DO TELEFONE, e é obrigatório que saia: a
   * coluna é NOT NULL UNIQUE e o CPF agora pode não existir. O telefone também
   * é único por índice (`telefone_unico`), então o sintético herda a unicidade
   * em vez de depender de um campo opcional.
   */
  it('o e-mail sintético vem do telefone, não do CPF', () => {
    expect(rota).toContain('`${telefone}@cliente.local`');
    expect(rota).not.toContain('`${cpf}@cliente.local`');
  });

  /* CPF vazio grava NULL, não string vazia. */
  it('CPF em branco vira nulo', () => {
    expect(rota).toContain('ehCliente && cpf ? cpf : null');
  });

  /* O que já valia e não pode regredir: lojista não se autocadastra. */
  it('lojista continua sem autocadastro', () => {
    expect(rota).toContain('Cadastro de lojista é feito pela nossa equipe');
  });

  /* E a mensagem de conflito segue genérica, para não permitir descobrir quem
     tem conta só tentando cadastrar. */
  it('a mensagem de conflito continua genérica', () => {
    expect(rota).toContain('const CONFLITO =');
    expect((rota.match(/throw erroHttp\(409, CONFLITO\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('o cadastro feito pela equipe segue a mesma regra', () => {
  const rota = (() => {
    const i = admin.indexOf("router.post('/usuarios'");
    return exec(admin.slice(i, admin.indexOf('\nrouter.', i + 10)));
  })();

  it('o teste está lendo a rota certa', () => {
    expect(rota).toContain('exigirSuperAdmin');
    expect(rota).toContain('Informe o nome do cliente.');
  });

  it('exige telefone e não exige CPF', () => {
    expect(rota).toContain('if (!telefoneValido(telefone))');
    expect(rota).not.toContain('if (!cpfValido(cpf))');
    expect(rota).toContain('if (cpf && !cpfValido(cpf))');
  });

  it('e o e-mail sintético também vem do telefone', () => {
    expect(rota).toContain('`${telefone}@cliente.local`');
    expect(rota).not.toContain('`${cpf}@cliente.local`');
  });

  /*
   * A DOCUMENTAÇÃO DA ROTA PROMETE "mesma validação" — e a promessa tem que
   * estar verdadeira, senão ela é pior que comentário nenhum.
   */
  it('o comentário da rota descreve a regra nova', () => {
    const cabecalho = admin.slice(admin.lastIndexOf('/**', admin.indexOf("router.post('/usuarios'")),
      admin.indexOf("router.post('/usuarios'"));
    expect(cabecalho).toContain('TELEFONE obrigatório');
    expect(cabecalho).not.toContain('CPF obrigatório');
  });
});

describe('as telas', () => {
  /* A regra do servidor é espelhada no front para a pessoa saber ANTES de
     enviar. Quem manda é o servidor. */
  it('o front tem a mesma validação de telefone', () => {
    expect(telFront).toContain('export function telefoneValido');
    for (const linha of [
      "if (d.length !== 10 && d.length !== 11) return false;",
      "if (d[0] === '0') return false;",
      "if (d.length === 11 && d[2] !== '9') return false;",
    ]) expect(telFront).toContain(linha);
  });

  it('o cadastro do cliente exige telefone e não exige CPF', () => {
    const form = conta.slice(conta.indexOf('function FormCadastro'));
    expect(form).toContain('telefoneValidoNaTela(telefone)');
    expect(form).toContain('id="cad-tel"');
    /* O `required` está no telefone e NÃO no CPF. */
    const campoTel = form.slice(form.indexOf('id="cad-tel"'), form.indexOf('id="cad-tel"') + 260);
    const campoCpf = form.slice(form.indexOf('id="cad-cpf"'), form.indexOf('id="cad-cpf"') + 260);
    expect(campoTel).toContain('required');
    expect(campoCpf).not.toContain('required');
  });

  /*
   * O CPF DIZ PARA QUE SERVE. "Opcional" sozinho deixa a dúvida, e na dúvida a
   * pessoa preenche — que é justamente o atrito que se quis tirar.
   */
  it('o CPF explica que serve para a nota', () => {
    expect(conta).toContain('Só se você quiser seu CPF na nota fiscal.');
    expect(conta).toMatch(/CPF <span[^>]*>\(opcional\)/);
  });

  /* O obrigatório vem ANTES do opcional: ordem ensina o que preencher. */
  it('o telefone vem antes do CPF na tela', () => {
    const form = conta.slice(conta.indexOf('function FormCadastro'));
    expect(form.indexOf('id="cad-tel"')).toBeLessThan(form.indexOf('id="cad-cpf"'));
  });

  it('a tela da equipe também', () => {
    expect(admLojistas).toContain('Telefone com DDD *');
    expect(admLojistas).toContain('CPF (opcional)');
    expect(admLojistas.indexOf('Telefone com DDD *')).toBeLessThan(admLojistas.indexOf('CPF (opcional)'));
  });

  /* O login já aceitava telefone — é o que torna o cadastro só com telefone
     uma conta recuperável. Registrado aqui para não regredir junto. */
  it('o login continua aceitando telefone', () => {
    expect(conta).toContain('E-mail ou telefone');
  });
});
