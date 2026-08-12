import { describe, it, expect } from 'vitest';
import { contaDoMes } from './conta-revendedor';

const ativo = (...modulos: number[]) => ({ ativo: true, modulos });
const suspenso = (...modulos: number[]) => ({ ativo: false, modulos });

describe('contaDoMes', () => {
  it('soma mensalidade por cliente ativo', () => {
    expect(contaDoMes(4990, [ativo(), ativo(), ativo()])).toEqual({
      clientes_ativos: 3,
      mensalidades_centavos: 14970,
      modulos_centavos: 0,
      total_centavos: 14970,
    });
  });

  it('soma os módulos por cima da mensalidade', () => {
    const c = contaDoMes(4990, [ativo(3000), ativo(3000, 1500)]);
    expect(c.mensalidades_centavos).toBe(9980);
    expect(c.modulos_centavos).toBe(7500);
    expect(c.total_centavos).toBe(17480);
  });

  it('CLIENTE SUSPENSO não paga nada — nem mensalidade, nem módulo', () => {
    // O módulo é um extra sobre um serviço que, suspenso, não está sendo
    // prestado. Cobrar módulo de loja fora do ar é linha que ninguém justifica.
    const c = contaDoMes(4990, [ativo(3000), suspenso(3000, 9900)]);
    expect(c.clientes_ativos).toBe(1);
    expect(c.mensalidades_centavos).toBe(4990);
    expect(c.modulos_centavos).toBe(3000);
    expect(c.total_centavos).toBe(7990);
  });

  it('revendedor sem cliente ativo deve zero, não a mensalidade solta', () => {
    expect(contaDoMes(4990, [suspenso(), suspenso()]).total_centavos).toBe(0);
    expect(contaDoMes(4990, []).total_centavos).toBe(0);
  });

  it('mensalidade zerada ainda cobra os módulos', () => {
    // Revenda com mensalidade cortesia e só os extras cobrados.
    expect(contaDoMes(0, [ativo(3000)])).toMatchObject({
      mensalidades_centavos: 0,
      modulos_centavos: 3000,
      total_centavos: 3000,
    });
  });

  it('custo negativo não vira desconto', () => {
    // Um valor negativo digitado por engano não pode abater a conta dos outros
    // clientes — isso transformaria erro de cadastro em crédito silencioso.
    expect(contaDoMes(-5000, [ativo(3000)]).total_centavos).toBe(3000);
  });

  it('preço de módulo inválido conta como zero, não quebra a soma', () => {
    // O valor vem do banco; um NULL virando NaN contaminaria o total inteiro e
    // a conta apareceria como "R$ NaN" na tela do revendedor.
    expect(contaDoMes(1000, [{ ativo: true, modulos: [NaN as unknown as number, 500] }]).total_centavos)
      .toBe(1500);
  });
});
