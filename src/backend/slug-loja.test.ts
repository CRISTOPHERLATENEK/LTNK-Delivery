import { describe, it, expect } from 'vitest';
import { slugDeNome, slugUnico } from './slug-loja';

describe('slugDeNome', () => {
  it('tira acento, baixa a caixa e junta com hífen', () => {
    expect(slugDeNome('Pizzaria da Paula')).toBe('pizzaria-da-paula');
    expect(slugDeNome('Açaí & Cia')).toBe('acai-cia');
  });

  it('não deixa hífen sobrando nas pontas', () => {
    // "!!! Bar do Zé !!!" viraria "---bar-do-ze---" e o painel do lojista
    // recusaria o slug que o próprio sistema gerou.
    expect(slugDeNome('!!! Bar do Zé !!!')).toBe('bar-do-ze');
    expect(slugDeNome('  Lanches  ')).toBe('lanches');
  });

  it('devolve vazio quando não sobra nada usável', () => {
    expect(slugDeNome('')).toBe('');
    expect(slugDeNome('!!!')).toBe('');
    // Menos de 3 caracteres não passa no formato aceito pelo painel.
    expect(slugDeNome('Zé')).toBe('');
  });
});

describe('slugUnico', () => {
  it('usa o nome quando está livre', () => {
    expect(slugUnico('Pizzaria da Paula', [], 7)).toBe('pizzaria-da-paula');
  });

  it('numera quando já existe', () => {
    expect(slugUnico('Lanches', ['lanches'], 7)).toBe('lanches-2');
    expect(slugUnico('Lanches', ['lanches', 'lanches-2'], 7)).toBe('lanches-3');
  });

  it('cai em loja-<id> quando o nome não gera slug válido', () => {
    // Sem isso a loja ficaria SEM endereço, que é o bug que este módulo existe
    // pra evitar — feio é melhor que inacessível.
    expect(slugUnico('Zé', [], 12)).toBe('loja-12');
    expect(slugUnico('!!!', [], 12)).toBe('loja-12');
  });

  it('não devolve nome reservado do app', () => {
    // Uma loja chamada "Pedidos" viraria /pedidos e engoliria a página de
    // pedidos do cliente.
    expect(slugUnico('Pedidos', [], 5)).toBe('loja-5');
    expect(slugUnico('Conta', [], 5)).toBe('loja-5');
  });

  it('numera o fallback quando até ele colide', () => {
    expect(slugUnico('Zé', ['loja-12'], 12)).toBe('loja-12-2');
  });
});
