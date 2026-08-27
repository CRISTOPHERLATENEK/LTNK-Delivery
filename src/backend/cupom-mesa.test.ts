import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { montarBlocosCupom } from '../../frontend/src/lib/impressao';
import { linhasDoItem } from '../../frontend/src/lib/item-pedido';

/**
 * O CUPOM DA MESA — o papel que o cliente lê pra conferir a conta.
 *
 * A fase 4 levou a composição ao KDS (a TELA da cozinha). Este é outro caminho:
 * mesa imprime direto de `mesas.tsx`, e saía "1x Pizza Artesanal R$ 77,00" e
 * nada mais. O cliente lia um valor que NÃO FECHA com o preço do cardápio
 * (R$ 45) e não tinha como conferir de onde vieram os R$ 32.
 */
const CONFIG = { largura: '80' as const, auto: true, loja_nome: 'Unimaxx', rodape: '' };

/*
 * O FORMATO REAL, copiado do produtor (`opcoes-item.ts`): UMA PARTE POR OPÇÃO,
 * repetindo o nome do grupo — `Sabores: Camarão · Sabores: Calabresa`.
 *
 * Eu escrevi este teste primeiro com `Sabores: Camarão, Calabresa` numa parte
 * só, e ele reprovou a implementação que estava certa. Texto de teste inventado
 * testa a invenção: o formato tem que vir de quem grava.
 */
const TEXTO_PIZZA = 'Tamanho: Grande · Sabores: Camarão · Sabores: Calabresa · Borda: Catupiry';

const linhaDaPizza = () => ({
  qtd: '1',
  nome: 'Pizza Artesanal',
  valor: 'R$ 77,00',
  detalhes: linhasDoItem({ opcoes_texto: TEXTO_PIZZA }),
});

const textos = (blocos: ReturnType<typeof montarBlocosCupom>) =>
  blocos.filter(b => b.t === 'texto').map(b => (b as { txt: string }).txt);

describe('cupom da mesa', () => {
  it('o item sai com valor e com a composição embaixo', () => {
    const b = montarBlocosCupom({
      titulo: 'MESA 3 · COMANDA #12',
      linhas: [linhaDaPizza()],
      totais: [{ rotulo: 'TOTAL', valor: 'R$ 77,00', forte: true }],
    } as never, CONFIG);

    const lr = b.filter(x => x.t === 'lr').map(x => (x as { l: string; r: string }));
    expect(lr[0]).toMatchObject({ l: '1 Pizza Artesanal', r: 'R$ 77,00' });

    /* Uma linha por escolha, recuada — é o que torna a conta verificável. */
    expect(textos(b)).toEqual([
      '  Tamanho: Grande',
      '  Sabores:',
      '    Camarão',
      '    Calabresa',
      '  Borda: Catupiry',
    ]);
  });

  /*
   * GRUPO DE ESCOLHA ÚNICA FICA NA MESMA LINHA ("Tamanho: Grande"), e só o de
   * várias abre em lista. Gastar duas linhas de papel pra uma palavra é o
   * oposto de legível numa bobina de 80mm.
   */
  it('escolha única não gasta duas linhas', () => {
    const b = montarBlocosCupom({
      titulo: 'x',
      linhas: [{ qtd: '1', nome: 'Refri', valor: 'R$ 8,00', detalhes: linhasDoItem({ opcoes_texto: 'Bebida: Coca-Cola 2L' }) }],
      totais: [],
    } as never, CONFIG);
    expect(textos(b)).toEqual(['  Bebida: Coca-Cola 2L']);
  });

  /*
   * COMBO: a composição sai DIVIDIDA POR PIZZA. Sem isso, quem confere a conta
   * (e quem produz) recebe cinco sabores em fila, sem saber quais são de qual
   * pizza — o defeito que as quatro fases do combo existiram pra resolver.
   */
  it('combo sai dividido por item', () => {
    const texto = 'Refrigerante 2L: Coca-Cola 2L'
      + ' · Pizza Gigante 45cm | Sabores: Camarão'
      + ' · Pizza Gigante 45cm | Sabores: Calabresa'
      + ' · Broto 25cm | Sabores: Portuguesa';
    const b = montarBlocosCupom({
      titulo: 'x',
      linhas: [{ qtd: '1', nome: 'Combo Duas Pizzas', valor: 'R$ 191,90', detalhes: linhasDoItem({ opcoes_texto: texto }) }],
      totais: [],
    } as never, CONFIG);
    expect(textos(b)).toEqual([
      '  Refrigerante 2L: Coca-Cola 2L',
      '  Pizza Gigante 45cm:',
      '    Sabores:',
      '      Camarão',
      '      Calabresa',
      '  Broto 25cm:',
      '    Sabores: Portuguesa',
    ]);
  });

  /* Item sem opção nenhuma sai EXATAMENTE como antes: uma linha, sem sobra. É a
     promessa de que isto não mexeu no cupom de quem não usa complemento. */
  it('item sem opção sai idêntico ao que sempre foi', () => {
    const b = montarBlocosCupom({
      titulo: 'x',
      linhas: [{ qtd: '2', nome: 'Coca lata', valor: 'R$ 13,80', detalhes: linhasDoItem({ opcoes_texto: '' }) }],
      totais: [],
    } as never, CONFIG);
    expect(textos(b)).toEqual([]);
  });
});

describe('a tela de mesas manda a composição pros dois papéis', () => {
  const mesas = fs.readFileSync(path.resolve(
    __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'mesas.tsx'), 'utf8');
  const codigo = mesas.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Dois papéis diferentes: a CONTA do cliente e a COMANDA de produção. São
     chamadas separadas, e corrigir uma só deixaria a cozinha cega. */
  it('cupom e comanda de produção usam linhasDoItem', () => {
    const usos = codigo.match(/detalhes: linhasDoItem\(\{ opcoes_texto: i\.opcoes_texto \}\)/g) || [];
    expect(usos.length).toBe(2);
  });
});
