import { describe, it, expect } from 'vitest';
import { mensagemDeDuplicidade } from './util';

/**
 * Erro real de produção: cadastrar entregador com telefone já usado por outro
 * usuário devolvia 500 "Erro interno do servidor". O lojista clicou três vezes
 * sem entender nada — não havia como saber que o problema era o telefone, nem
 * que telefone precisa ser único entre TODAS as contas.
 */
const dup = (sqlMessage: string) => ({ code: 'ER_DUP_ENTRY', sqlMessage });

describe('mensagemDeDuplicidade', () => {
  it('telefone: cita o campo, porque a mensagem do MySQL fala da coluna GERADA', () => {
    // A coluna real é `telefone`; o índice é sobre `telefone_unico` (NULLIF).
    const m = mensagemDeDuplicidade(dup("Duplicate entry '47984173970' for key 'idx_usuarios_telefone_unico'"));
    expect(m).toMatch(/telefone/i);
    expect(m).toMatch(/outro número/i);
  });

  it('cpf', () => {
    expect(mensagemDeDuplicidade(dup("Duplicate entry '123' for key 'idx_usuarios_cpf'"))).toMatch(/CPF/);
  });

  it('email', () => {
    expect(mensagemDeDuplicidade(dup("Duplicate entry 'a@b.com' for key 'usuarios.email'"))).toMatch(/e-mail/i);
  });

  it('slug e dominio da loja', () => {
    expect(mensagemDeDuplicidade(dup("Duplicate entry 'x' for key 'lojas.slug'"))).toMatch(/slug/i);
    expect(mensagemDeDuplicidade(dup("Duplicate entry 'x' for key 'dominio_personalizado'"))).toMatch(/domínio/i);
  });

  it('índice não mapeado ainda cai num 409 útil, não em 500', () => {
    const m = mensagemDeDuplicidade(dup("Duplicate entry 'x' for key 'algum_indice_novo'"));
    expect(m).toBe('Já existe um registro com esses dados.');
  });

  it('erro que NÃO é duplicidade devolve null — segue sendo 500 de verdade', () => {
    expect(mensagemDeDuplicidade({ code: 'ER_NO_SUCH_TABLE', sqlMessage: 'x' })).toBeNull();
    expect(mensagemDeDuplicidade(new Error('boom'))).toBeNull();
    expect(mensagemDeDuplicidade(null)).toBeNull();
    expect(mensagemDeDuplicidade(undefined)).toBeNull();
  });
});
