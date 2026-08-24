import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { detalheItem, linhasDoItem } from './detalhe-item';

describe('detalheItem', () => {
  it('põe a observação ANTES dos complementos', () => {
    // A ordem é a regra: numa comanda lida de relance, "sem cebola" depois de
    // quatro adicionais passa batido.
    expect(detalheItem({ opcoes_texto: 'Ponto: mal passado', observacao: 'sem cebola' }))
      .toBe('Obs.: sem cebola · Ponto: mal passado');
  });

  it('sozinhos, cada um aparece sem separador solto', () => {
    expect(detalheItem({ observacao: 'sem cebola' })).toBe('Obs.: sem cebola');
    expect(detalheItem({ opcoes_texto: 'Ponto: ao ponto' })).toBe('Ponto: ao ponto');
  });

  it('sem nada, devolve vazio — e não " · "', () => {
    // O chamador testa `if (detalhe)` pra decidir se mostra a linha; uma string
    // com só o separador ligaria o `if` e imprimiria um ponto solto no cupom.
    expect(detalheItem({})).toBe('');
    expect(detalheItem({ opcoes_texto: '', observacao: '' })).toBe('');
    expect(detalheItem({ opcoes_texto: null, observacao: null })).toBe('');
  });

  it('ignora campo que só tem espaço', () => {
    expect(detalheItem({ observacao: '   ', opcoes_texto: '  ' })).toBe('');
    expect(detalheItem({ observacao: '  sem sal  ' })).toBe('Obs.: sem sal');
  });
});

/**
 * O CUPOM DE PAPEL, que é onde o texto de um item realmente aperta.
 *
 * Numa bobina de 58mm cabem 32 colunas. `detalheItem` junta tudo numa linha só
 * com ` · `, e isso funciona na TELA — no papel, uma pizza de dois sabores saiu
 * assim numa impressão real:
 *
 *     Sabores: Mussarela ? Sabores: Frango com Catup
 *     iry
 *
 * Três defeitos: nome do grupo repetido a cada sabor, o separador virando `?`
 * (faltava no mapa CP850 do agente) e quebra no meio da palavra.
 */
describe('linhasDoItem', () => {
  it('agrupa pelo nome do grupo em vez de repetir', () => {
    expect(linhasDoItem({ opcoes_texto: 'Sabores: Mussarela · Sabores: Frango com Catupiry' }))
      .toEqual(['Sabores:', '  Mussarela', '  Frango com Catupiry']);
  });

  /* Duas linhas de papel pra uma palavra é o oposto de legível. */
  it('grupo de uma opção só fica na mesma linha', () => {
    expect(linhasDoItem({ opcoes_texto: 'Tamanho: Gigante' })).toEqual(['Tamanho: Gigante']);
  });

  it('vários grupos, na ordem em que vieram', () => {
    expect(linhasDoItem({ opcoes_texto: 'Tamanho: Gigante · Sabores: Calabresa · Sabores: Bacon · Borda: Catupiry' }))
      .toEqual(['Tamanho: Gigante', 'Sabores:', '  Calabresa', '  Bacon', 'Borda: Catupiry']);
  });

  /* A observação muda o PREPARO — numa comanda lida de relance ela não pode
     ficar depois da lista de adicionais. Mesma regra do `detalheItem`. */
  it('a observação vem primeiro', () => {
    expect(linhasDoItem({ opcoes_texto: 'Borda: Catupiry', observacao: 'sem cebola' }))
      .toEqual(['Obs.: sem cebola', 'Borda: Catupiry']);
  });

  it('item sem nada não gera linha nenhuma', () => {
    expect(linhasDoItem({})).toEqual([]);
    expect(linhasDoItem({ opcoes_texto: '', observacao: '  ' })).toEqual([]);
  });

  /*
   * PEDIDO ANTIGO TEM QUE IMPRIMIR. `opcoes_texto` é texto congelado no pedido:
   * os que já estão no banco foram gravados em formatos anteriores, e o cupom
   * precisa sair mesmo assim. Texto sem "Grupo: " na frente entra como está, em
   * vez de virar um grupo sem nome.
   */
  it('texto solto, sem nome de grupo, passa direto', () => {
    expect(linhasDoItem({ opcoes_texto: 'Bacon · Queijo extra' })).toEqual(['Bacon', 'Queijo extra']);
  });

  it('mistura de solto e agrupado não embaralha', () => {
    expect(linhasDoItem({ opcoes_texto: 'Bacon · Sabores: Calabresa · Sabores: Bacon' }))
      .toEqual(['Bacon', 'Sabores:', '  Calabresa', '  Bacon']);
  });

  /* Fração é o que a cozinha precisa ler: "2/4 Calabresa" não pode virar
     "Calabresa" no papel. */
  it('preserva a fração do sabor', () => {
    expect(linhasDoItem({ opcoes_texto: 'Sabores: 2/4 Calabresa · Sabores: 1/4 Bacon · Sabores: 1/4 Frango' }))
      .toEqual(['Sabores:', '  2/4 Calabresa', '  1/4 Bacon', '  1/4 Frango']);
  });
});

/**
 * OS DOIS GÊMEOS TÊM QUE DIZER A MESMA COISA.
 *
 * `src/backend/detalhe-item.ts` e `frontend/src/lib/item-pedido.ts` são cópias
 * deliberadas — os dois lados não compartilham build, e importar o backend
 * arrastaria ele pro bundle do navegador. O preço da cópia é este teste.
 *
 * O que a divergência causa não é erro: é o cozinheiro lendo no papel uma coisa
 * e o atendente vendo outra na tela, com o cliente ao telefone entre os dois. E
 * como só um dos lados costuma ser editado, a divergência nasce silenciosa.
 *
 * Compara só o CORPO das funções: o cabeçalho de cada arquivo fala do seu lado
 * e é diferente de propósito.
 */
describe('detalhe-item e item-pedido não podem divergir', () => {
  const corpo = (texto: string, nome: string) => {
    const i = texto.indexOf(`export function ${nome}`);
    if (i < 0) return null;
    // Até a linha que fecha a função na coluna zero.
    const fim = texto.indexOf('\n}', i);
    return texto.slice(i, fim + 2)
      .split('\n')
      .filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l))   // tira comentário
      .map(l => l.trimEnd())
      .join('\n');
  };
  const backend = fs.readFileSync(path.resolve(__dirname, 'detalhe-item.ts'), 'utf8');
  const front = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'item-pedido.ts'), 'utf8');

  for (const fn of ['detalheItem', 'linhasDoItem']) {
    it(`${fn} é idêntica nos dois lados`, () => {
      const a = corpo(backend, fn);
      const b = corpo(front, fn);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(b).toBe(a);
    });
  }
});
