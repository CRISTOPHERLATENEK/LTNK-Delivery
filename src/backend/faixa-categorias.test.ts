import { describe, it, expect } from 'vitest';
import { classesCategoria, TAMANHOS } from '../../frontend/src/lib/categoria-visual';

/*
 * O TAMANHO DA FAIXA DE CATEGORIAS.
 *
 * MEDIDO NA LOJA DE DEMONSTRAÇÃO, com a faixa ocupando 702px no desktop:
 *
 *   médio  → bolha de 56px, rótulo de 11px  → 8% da faixa por categoria
 *   grande → bolha de 80px, rótulo de 12px
 *
 * Eram três medidas FIXAS, iguais num telefone de 375px e num monitor de
 * 1500px. Um rótulo de 11px a meio metro do monitor tem a mesma altura aparente
 * de 6px no celular a 30cm — o lojista olhou a própria loja no computador e
 * disse "acredito que a visualização esteja pequena".
 *
 * E COM FOTO FICA PIOR: ele pôs foto de produto nas categorias, e uma garrafa
 * dentro de um círculo de 56px não dá para reconhecer. A bolha deixou de ser
 * enfeite no dia em que virou vitrine.
 */

describe('a escolha do lojista é a base, e o desktop sobe um degrau', () => {
  /*
   * MEXER SÓ NO DESKTOP é o que permite corrigir sem estragar o celular — que
   * é onde a maioria dos pedidos entra, e onde as medidas atuais já estavam
   * boas. Por isso a classe SEM prefixo (a do telefone) não pode mudar.
   */
  it('o tamanho do celular continua o mesmo de antes', () => {
    const base = (t: string) => classesCategoria('circulo', t).bolha.split(' ')[0];
    expect(base('pequeno')).toBe('size-11');
    expect(base('medio')).toBe('size-14');
    expect(base('grande')).toBe('size-20');
  });

  it('todo tamanho cresce em tela grande', () => {
    for (const { valor } of TAMANHOS) {
      const m = classesCategoria('circulo', valor);
      expect(m.bolha, valor).toMatch(/sm:size-/);
      expect(m.texto, valor).toMatch(/sm:text-/);
      /* O BOTÃO ACOMPANHA A BOLHA: sem isso a bolha cresce e transborda a
         largura do botão, e os rótulos desalinham a faixa inteira. */
      expect(m.botao, valor).toMatch(/sm:w-\[/);
      expect(m.icone, valor).toMatch(/sm:size-/);
    }
  });

  /*
   * O RÓTULO É O QUE PRECISA SER LIDO. A bolha já era legível a 56px; o nome da
   * categoria a 11px, não. Ler "Vinhos e espumantes" é o que a faixa existe
   * para permitir — a bolha é enfeite com ícone (ou foto) dentro.
   */
  it('o rótulo do médio chega a 13px no desktop', () => {
    expect(classesCategoria('circulo', 'medio').texto).toContain('lg:text-[13px]');
  });

  it('o maior chega a 96px de bolha', () => {
    /* size-24 = 6rem = 96px: o tamanho em que uma foto de garrafa vira
       reconhecível, que é o caso que originou isto. */
    expect(classesCategoria('circulo', 'grande').bolha).toContain('sm:size-24');
  });

  /* Valor estranho no banco continua caindo no médio, e não num vazio que
     colapsaria a faixa. */
  it('tamanho inválido continua virando médio', () => {
    expect(classesCategoria('circulo', 'gigante').bolha)
      .toBe(classesCategoria('circulo', 'medio').bolha);
    expect(classesCategoria('circulo', null).bolha)
      .toBe(classesCategoria('circulo', 'medio').bolha);
  });

  it('o formato continua independente do tamanho', () => {
    expect(classesCategoria('quadrado', 'grande').raio).toBe('rounded-md');
    expect(classesCategoria('circulo', 'pequeno').raio).toBe('rounded-full');
  });
});
