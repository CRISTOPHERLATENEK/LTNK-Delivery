import { describe, it, expect } from 'vitest';
import { competenciaDe, mesAnterior, faturaDetalhada } from './fatura-revendedor';
import { contaDoMes } from './conta-revendedor';

const mod = (nome: string, preco: number) => ({ nome, preco_centavos: preco });

describe('competência', () => {
  it('extrai YYYY-MM da data ISO', () => {
    expect(competenciaDe('2026-08-12T03:14:00.000Z')).toBe('2026-08');
  });

  it('mês anterior vira o ano em janeiro', () => {
    // O caso que quebra quando alguém faz `mes - 1` e formata direto: em
    // janeiro a fatura anterior é de dezembro do ano passado, não '2026-00'.
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(mesAnterior('2026-08')).toBe('2026-07');
    expect(mesAnterior('2026-10')).toBe('2026-09');
  });

  it('mês anterior mantém dois dígitos', () => {
    // '2026-9' entraria no banco e nunca casaria com o '2026-09' gravado pelo
    // resto do código — a fatura sumiria do histórico sem erro nenhum.
    expect(mesAnterior('2026-10')).toBe('2026-09');
    expect(mesAnterior('2026-02')).toBe('2026-01');
  });
});

describe('faturaDetalhada', () => {
  it('uma linha por cliente, com mensalidade e módulos separados', () => {
    const f = faturaDetalhada(4990, [
      { id: 1, nome: 'Padaria', ativo: true, modulos: [mod('NFC-e', 3000)] },
      { id: 2, nome: 'Pizzaria', ativo: true, modulos: [] },
    ]);
    expect(f.linhas[0]).toMatchObject({
      tenant_id: 1, mensalidade_centavos: 4990, modulos_centavos: 3000, total_centavos: 7990,
    });
    expect(f.linhas[1].total_centavos).toBe(4990);
    expect(f.total_centavos).toBe(12980);
  });

  it('SUSPENSO continua listado, zerado, com os módulos à vista', () => {
    // Some da lista e o revendedor não descobre por que a conta caiu.
    const f = faturaDetalhada(4990, [
      { id: 7, nome: 'Fechada', ativo: false, modulos: [mod('NFC-e', 3000)] },
    ]);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({ ativo: false, mensalidade_centavos: 0, modulos_centavos: 0, total_centavos: 0 });
    expect(f.linhas[0].modulos).toEqual([mod('NFC-e', 3000)]);
    expect(f.total_centavos).toBe(0);
  });

  it('o total bate com contaDoMes — as duas somas não podem divergir', () => {
    const clientes = [
      { id: 1, nome: 'A', ativo: true, modulos: [mod('x', 3000), mod('y', 1500)] },
      { id: 2, nome: 'B', ativo: false, modulos: [mod('x', 3000)] },
      { id: 3, nome: 'C', ativo: true, modulos: [] },
    ];
    const f = faturaDetalhada(4990, clientes);
    const c = contaDoMes(4990, clientes.map(x => ({ ativo: x.ativo, modulos: x.modulos.map(m => m.preco_centavos) })));
    expect(f.total_centavos).toBe(c.total_centavos);
    expect(f.linhas.reduce((s, l) => s + l.total_centavos, 0)).toBe(c.total_centavos);
  });

  it('preço de módulo inválido conta como zero na linha', () => {
    // Vem do banco; um NULL virando NaN deixaria a linha inteira como "R$ NaN".
    const f = faturaDetalhada(1000, [
      { id: 1, nome: 'A', ativo: true, modulos: [mod('quebrado', NaN as unknown as number), mod('ok', 500)] },
    ]);
    expect(f.linhas[0].total_centavos).toBe(1500);
  });

  it('custo negativo não vira desconto na linha', () => {
    expect(faturaDetalhada(-5000, [{ id: 1, nome: 'A', ativo: true, modulos: [mod('x', 3000)] }]).linhas[0].total_centavos)
      .toBe(3000);
  });

  it('sem cliente, fatura vazia e zerada', () => {
    expect(faturaDetalhada(4990, [])).toMatchObject({ linhas: [], total_centavos: 0, clientes_ativos: 0 });
  });
});
