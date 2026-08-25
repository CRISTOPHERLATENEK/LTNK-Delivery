/**
 * A BIBLIOTECA CONTRA OS DADOS REAIS DA LOJA DE TESTE.
 *
 * Os testes vizinhos provam as regras com casos mínimos. Este prova que a
 * ferramenta SERVE: roda a lógica em cima do retrato do banco do mostruário —
 * quatro "Tamanho", três "Sabores", dois "Adicionais", dois "Borda" — e trava o
 * que a tela vai dizer.
 *
 * Existe porque a primeira versão da tela desenhava a diferença só quando a
 * família tinha exatamente DOIS grupos. As duas maiores famílias desta base têm
 * três e quatro: justamente as que mais precisam de ajuda ficavam sem nenhuma, e
 * nenhum teste de caso mínimo pegava isso.
 */
import { describe, it, expect } from 'vitest';
import {
  familiasDuplicadas, melhorSobrevivente, diferencasEntre, saoIdenticos,
  type GrupoComparavel,
} from './grupos-biblioteca';

/** Retrato de `tenant_unimaxx`, loja 1, em 25/08/2026. */
const BASE: GrupoComparavel[] = [
  { id: 3, nome: 'Adicionais', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 0, opcoes: [
    { nome: 'Bacon', preco_adicional_centavos: 0 },
    { nome: 'Calabresa', preco_adicional_centavos: 0 },
    { nome: 'Quejo', preco_adicional_centavos: 0 },
  ] },
  { id: 7, nome: 'Adicionais', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 1, opcoes: [
    { nome: 'Bacon', preco_adicional_centavos: 0 },
    { nome: 'Molho', preco_adicional_centavos: 500 },
    { nome: 'Queijo', preco_adicional_centavos: 300 },
  ] },
  { id: 5, nome: 'Borda', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 0, opcoes: [
    { nome: 'Sem borda', preco_adicional_centavos: 0 },
    { nome: 'Cheddar', preco_adicional_centavos: 0 },
    { nome: 'Requeijao', preco_adicional_centavos: 0 },
    { nome: 'Chocolate', preco_adicional_centavos: 0 },
  ] },
  { id: 11, nome: 'Borda', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 0, opcoes: [
    { nome: 'Sem borda', preco_adicional_centavos: 0 },
    { nome: 'Cheddar', preco_adicional_centavos: 0 },
    { nome: 'Catupiry', preco_adicional_centavos: 0 },
    { nome: 'Chocolate', preco_adicional_centavos: 0 },
    { nome: 'Cream cheese', preco_adicional_centavos: 0 },
  ] },
  { id: 2, nome: 'Sabores', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 1, opcoes: [
    { nome: 'Maracujá', preco_adicional_centavos: 0 },
  ] },
  { id: 17, nome: 'Sabores', tipo: 'multiplo', papel: 'sabores', modo_preco: 'somar', usos: 0, opcoes: [
    { nome: 'Maracujá', preco_adicional_centavos: 1000 },
    { nome: 'Morango', preco_adicional_centavos: 1000 },
    { nome: 'Creme', preco_adicional_centavos: 1000 },
    { nome: 'Chocolate', preco_adicional_centavos: 1000 },
  ] },
  { id: 19, nome: 'Sabores', tipo: 'multiplo', papel: 'sabores', modo_preco: 'maior', usos: 1, opcoes: [
    { nome: 'Calabresa', preco_adicional_centavos: 0, secao: 'Tradicional' },
    { nome: '4 Queijos', preco_adicional_centavos: 1000, secao: 'Especiais' },
  ] },
  { id: 6, nome: 'Tamanho', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 0, opcoes: [] },
  { id: 8, nome: 'Tamanho', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 1, opcoes: [] },
  { id: 10, nome: 'Tamanho', tipo: 'unico', papel: '', modo_preco: 'somar', usos: 1, opcoes: [] },
  { id: 18, nome: 'Tamanho', tipo: 'unico', papel: 'tamanho', modo_preco: 'somar', usos: 1, opcoes: [
    { nome: 'Gigante', preco_adicional_centavos: 0, sabores: 4 },
    { nome: 'Pequeno', preco_adicional_centavos: 0 },
    { nome: 'Grande', preco_adicional_centavos: 0 },
    { nome: 'GG', preco_adicional_centavos: 0 },
    { nome: 'Médio', preco_adicional_centavos: 0 },
    { nome: 'Família', preco_adicional_centavos: 0 },
  ] },
];

describe('a biblioteca sobre a base real', () => {
  const familias = familiasDuplicadas(BASE);

  it('acha as quatro famílias, a maior primeiro', () => {
    expect(familias.map(f => `${f.nome}:${f.grupos.length}`))
      .toEqual(['Tamanho:4', 'Sabores:3', 'Adicionais:2', 'Borda:2']);
  });

  /*
   * Os três "Tamanho" VAZIOS são idênticos entre si — mesmo nome, mesmo tipo,
   * nenhum item. É o único caso desta base em que juntar não muda nada, e é
   * exatamente o que o botão "juntar em um" deve oferecer.
   */
  it('os três Tamanho vazios são o único par mesclável', () => {
    const tamanho = familias.find(f => f.nome === 'Tamanho')!;
    expect(tamanho.identicos).toHaveLength(1);
    expect(tamanho.identicos[0].map(g => g.id).sort((a, b) => a - b)).toEqual([6, 8, 10]);
  });

  /* O 18 fica de fora dos idênticos: tem `papel = tamanho` e seis itens. Juntar
     ele com os vazios apagaria a configuração da pizza. */
  it('o Tamanho 18 não entra na mesclagem', () => {
    const tamanho = familias.find(f => f.nome === 'Tamanho')!;
    expect(tamanho.identicos.flat().map(g => g.id)).not.toContain(18);
  });

  it('nenhuma outra família tem par idêntico', () => {
    for (const nome of ['Sabores', 'Adicionais', 'Borda']) {
      expect(familias.find(f => f.nome === nome)!.identicos).toEqual([]);
    }
  });

  /*
   * A REFERÊNCIA DE CADA FAMÍLIA é o `melhorSobrevivente` — o candidato natural
   * a ficar. Nesta base ninguém tem foto, então o desempate cai no id menor,
   * e é isso que o teste trava: sem foto, o mais antigo vence, mesmo sendo o
   * mais pobre. É o comportamento documentado (id antigo tem mais chance de
   * estar em pedido antigo), e a tela mostra a diferença justamente pro lojista
   * poder discordar.
   */
  it('a referência sai do desempate por id quando ninguém tem foto', () => {
    expect(melhorSobrevivente(familias.find(f => f.nome === 'Tamanho')!.grupos).id).toBe(6);
    expect(melhorSobrevivente(familias.find(f => f.nome === 'Borda')!.grupos).id).toBe(5);
  });

  /*
   * ESTE É O TESTE QUE FALTAVA. Família de TRÊS e de QUATRO tem que produzir
   * diferença legível — era o caso em que a tela não desenhava nada.
   */
  it('família de 3 e de 4 produz diferença pra cada membro', () => {
    for (const nome of ['Tamanho', 'Sabores']) {
      const fam = familias.find(f => f.nome === nome)!;
      const ref = melhorSobrevivente(fam.grupos);
      const outros = fam.grupos.filter(g => g.id !== ref.id && !saoIdenticos(g, ref));
      expect(outros.length).toBeGreaterThan(0);
      for (const o of outros) {
        expect(diferencasEntre(o, ref).length).toBeGreaterThan(0);
      }
    }
  });

  /* O caso que mais custa dinheiro: os dois "Adicionais" têm os mesmos três
     nomes-ish, mas um cobra e o outro não. A tela precisa dizer isso. */
  it('aponta que um Adicionais cobra e o outro não', () => {
    const a3 = BASE.find(g => g.id === 3)!;
    const a7 = BASE.find(g => g.id === 7)!;
    const dif = diferencasEntre(a7, a3).join(' | ');
    expect(dif).toContain('Molho');
    expect(dif).toContain('Queijo');
  });

  /* Borda 11 é superset de Borda 5: a diferença tem que nomear o que se perde
     ao escolher errado. */
  it('mostra que Borda 11 tem Catupiry e Cream cheese a mais', () => {
    const b5 = BASE.find(g => g.id === 5)!;
    const b11 = BASE.find(g => g.id === 11)!;
    const dif = diferencasEntre(b11, b5).join(' | ');
    expect(dif).toContain('Catupiry');
    expect(dif).toContain('Cream cheese');
    expect(dif).toContain('Requeijao');   // só no 5
  });

  /*
   * A limpeza sem risco: item nenhum E produto vivo nenhum. Nesta base é UM só
   * (o Tamanho 6) — os outros dois vazios estão em produtos vivos, e apagá-los
   * mexeria no cardápio deles.
   */
  it('só um grupo é descartável sem pensar', () => {
    const descartaveis = BASE.filter(g => g.opcoes.length === 0 && (g.usos ?? 0) === 0);
    expect(descartaveis.map(g => g.id)).toEqual([6]);
  });
});
