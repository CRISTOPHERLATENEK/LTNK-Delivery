import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * COLUNA NOVA PRECISA DE ALTER, NÃO SÓ DE CREATE.
 *
 * O schema é declarado com `CREATE TABLE IF NOT EXISTS`. Acrescentar uma coluna
 * ali cria a coluna em banco NOVO e não faz nada em banco que já existe — e
 * produção é sempre banco que já existe. Para os que existem há o laço de
 * `garantirColuna`, com um `ALTER TABLE ... ADD COLUMN` por coluna.
 *
 * ISTO ACONTECEU. As colunas do aceite dos termos entraram no CREATE, o INSERT
 * do cadastro passou a nomeá-las, e o deploy subiu com o cadastro de cliente
 * quebrado: coluna inexistente em `delivery` e em `tenant_unimaxx`. Nem o
 * typecheck nem a suíte viram, e não é falha deles — os testes rodam contra
 * schema recém-criado, onde o CREATE já trouxe tudo.
 *
 * Então a regra que este arquivo guarda: toda coluna que o código de cadastro
 * ESCREVE tem que existir no laço de migração, ou estar na lista das que
 * nasceram com a tabela.
 */

const BACKEND = __dirname;
const schema = fs.readFileSync(path.join(BACKEND, 'schema-mysql.ts'), 'utf8');
const autenticacao = fs.readFileSync(path.join(BACKEND, 'rotas', 'autenticacao.ts'), 'utf8');

/**
 * Colunas de `usuarios` que existem desde sempre e por isso não precisam de
 * ALTER. Lista explícita e curta de propósito: se alguém acrescentar um nome
 * aqui para calar o teste, fica registrado no diff que foi uma decisão.
 */
const NASCERAM_COM_A_TABELA = new Set([
  'id', 'nome', 'email', 'senha_hash', 'perfil', 'telefone',
  'loja_id', 'cpf', 'criado_em',
]);

/** As colunas que aparecem no laço `garantirColuna` para uma tabela. */
function colunasMigradas(tabela: string): Set<string> {
  const achadas = new Set<string>();
  const re = new RegExp(`\\['${tabela}',\\s*'([\\w]+)'`, 'g');
  for (const m of schema.matchAll(re)) achadas.add(m[1]);
  return achadas;
}

/** As colunas nomeadas em cada `INSERT INTO <tabela> (...)` de um arquivo. */
function colunasInseridas(fonte: string, tabela: string): Set<string> {
  const achadas = new Set<string>();
  const re = new RegExp(`INSERT INTO ${tabela}\\s*\\(([^)]*)\\)`, 'g');
  for (const m of fonte.matchAll(re)) {
    for (const bruto of m[1].split(',')) {
      const nome = bruto.trim().replace(/\s+/g, ' ').split(' ').pop() || '';
      if (/^[a-z_][a-z0-9_]*$/.test(nome)) achadas.add(nome);
    }
  }
  return achadas;
}

describe('coluna escrita no cadastro tem migração', () => {
  const migradas = colunasMigradas('usuarios');
  const inseridas = colunasInseridas(autenticacao, 'usuarios');

  it('o teste está lendo os dois lados de verdade', () => {
    /*
     * Sem isto, uma regex que deixou de casar faria o teste passar comparando
     * dois conjuntos vazios — o modo mais silencioso de um teste morrer.
     */
    expect(inseridas.size).toBeGreaterThanOrEqual(8);
    expect(inseridas.has('senha_hash')).toBe(true);
    expect(migradas.size).toBeGreaterThanOrEqual(3);
    expect(migradas.has('ultimo_acesso')).toBe(true);
  });

  it('toda coluna inserida existe no ALTER ou nasceu com a tabela', () => {
    const semMigracao = [...inseridas]
      .filter(c => !NASCERAM_COM_A_TABELA.has(c) && !migradas.has(c))
      .sort();
    expect(semMigracao).toEqual([]);
  });

  /*
   * As duas do incidente, por nome. O teste acima é a regra; este é a memória
   * — se alguém remover as linhas do ALTER achando que o CREATE basta, esta
   * linha diz o que aconteceu na última vez.
   */
  it('as colunas do aceite dos termos estão no ALTER', () => {
    expect(migradas.has('termos_aceitos_em')).toBe(true);
    expect(migradas.has('termos_versao')).toBe(true);
  });

  /*
   * E SEM DEFAULT. Conta que já existia se cadastrou antes de haver qualquer
   * termo; um DEFAULT com data preencheria um aceite que nunca aconteceu, e o
   * registro passaria a afirmar algo falso sobre pessoas reais.
   */
  it('o aceite não ganha valor padrão para quem já existia', () => {
    const ddl = schema.slice(schema.indexOf("['usuarios', 'termos_aceitos_em'"));
    const linha = ddl.slice(0, ddl.indexOf('\n'));
    expect(linha).not.toMatch(/DEFAULT/i);
    expect(linha).toMatch(/NULL/);
  });
});
