import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { preparaComida } from '../../frontend/src/lib/segmentos';

/*
 * OS MODELOS PRONTOS DE COMPLEMENTO SÓ APARECEM PARA QUEM COZINHA.
 *
 * O lojista do Galdério abriu um COPÃO e viu seis cartões oferecendo "Borda",
 * "Ponto da carne", "Sabores", "Adicionais": "pra que isso? na conveniência não
 * vou precisar disso".
 *
 * O filtro que existia era pela CATEGORIA DO PRODUTO — e ele não pegava este
 * caso justamente porque funciona: "COPÕES E BALDES" não casa com família
 * nenhuma, e a regra manda mostrar tudo quando não dá para afirmar nada. O
 * sinal que faltava é o SEGMENTO DA LOJA, que o cadastro já tem
 * (`lojas.categoria` = "Conveniência").
 */

const raiz = path.join(__dirname, '..', '..');
const TELA = fs.readFileSync(
  path.join(raiz, 'frontend', 'src', 'pages', 'lojista', 'produtos.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const SEGMENTOS = fs.readFileSync(
  path.join(raiz, 'frontend', 'src', 'lib', 'segmentos.ts'), 'utf8');

describe('quem prepara comida e quem revende', () => {
  it('revenda não prepara', () => {
    for (const s of ['Conveniência', 'conveniencia', 'Adega', 'Distribuidora de bebidas',
      'Mercado', 'Tabacaria', 'Bebidas geladas']) {
      expect(preparaComida(s), s).toBe(false);
    }
  });

  it('cozinha prepara', () => {
    for (const s of ['Pizzaria', 'Hamburgueria', 'Restaurante', 'Lanchonete',
      'Marmitaria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Doceria', 'Cafeteria']) {
      expect(preparaComida(s), s).toBe(true);
    }
  });

  /*
   * O SEGMENTO É TEXTO LIVRE, e a lista é de quem NÃO prepara justamente por
   * isso: "Pizzaria do Zé" e "Restaurante japonês" são nomes que ninguém
   * previu, e os dois cozinham. Errar do lado de mostrar é barato; esconder de
   * quem precisa some com o recurso.
   */
  it('segmento que ninguém previu é tratado como cozinha', () => {
    expect(preparaComida('Pizzaria do Zé')).toBe(true);
    expect(preparaComida('Comida japonesa')).toBe(true);
    expect(preparaComida('Food truck')).toBe(true);
  });

  /* Sem segmento cadastrado, mostra tudo — esconder por palpite é pior que
     mostrar demais. */
  it('sem segmento, mostra tudo', () => {
    expect(preparaComida('')).toBe(true);
    expect(preparaComida(null)).toBe(true);
    expect(preparaComida(undefined)).toBe(true);
  });

  /* A lista de revenda mora junto dos segmentos sugeridos: são os mesmos nomes,
     e separá-los faria um sair de sincronia com o outro. */
  it('a regra mora junto da lista de segmentos', () => {
    expect(SEGMENTOS).toContain('export function preparaComida');
    expect(SEGMENTOS).toContain("'Conveniência', 'Adega'");
  });
});

describe('a tela usa o segmento', () => {
  it('os modelos somem quando a loja não cozinha', () => {
    expect(TELA).toContain('if (!preparaComida(segmentoDaLoja)) return [];');
    expect(TELA).toContain('modelosDaCategoria(produto.categoria, loja?.categoria)');
  });

  /*
   * A CATEGORIA DO PRODUTO CONTINUA FILTRANDO DENTRO DE QUEM COZINHA: numa
   * pizzaria, "Ponto da carne" não faz sentido numa Coca-Cola.
   */
  it('o filtro por família continua valendo', () => {
    expect(TELA).toContain('const fam = familiaDaCategoria(categoria)');
    expect(TELA).toContain('t.familias.includes(fam)');
  });

  /* Sem os modelos, "Criar grupo do zero" continua — é o caminho de quem
     precisa de um complemento que a plataforma não previu. */
  it('criar do zero não depende do segmento', () => {
    expect(TELA).toContain('Criar grupo do zero');
    const i = TELA.indexOf('Criar grupo do zero');
    expect(TELA.slice(Math.max(0, i - 400), i)).not.toContain('preparaComida');
  });
});

describe('o editor de complementos some com o que não é da loja', () => {
  /*
   * "PRA MEXER NOS COMPLEMENTOS, NÃO ESTÁ MUITO DIFÍCIL NÃO?"
   *
   * Estava. Numa conveniência, cada item do grupo ocupava TRÊS linhas, e duas
   * delas não serviam para nada ali: a barra "PIZZA — Nenhum (grupo comum)" no
   * topo de todo grupo aberto, e o "+ ingredientes (separe por vírgula)" embaixo
   * de cada sabor de gelo. Com oito sabores, são dezesseis linhas de nada entre
   * o lojista e o que ele veio fazer.
   */
  it('a barra de pizza depende do segmento', () => {
    expect(TELA).toContain('{(preparaComida(loja?.categoria) || !!grupo.papel) && (');
  });

  it('os ingredientes dependem do segmento', () => {
    expect(TELA).toContain('{(preparaComida(loja?.categoria) || chips.length > 0) && (');
  });

  /*
   * O QUE JÁ ESTÁ EM USO NÃO SOME. Esconder um controle ligado deixaria um
   * ajuste ativo e sem como desligar — e, no caso dos ingredientes, apagaria da
   * vista um texto que o CLIENTE lê no cardápio.
   */
  it('o que já está em uso continua visível', () => {
    const i = TELA.indexOf('{(preparaComida(loja?.categoria) || !!grupo.papel) && (');
    expect(i).toBeGreaterThan(0);
    const j = TELA.indexOf('{(preparaComida(loja?.categoria) || chips.length > 0) && (');
    expect(j).toBeGreaterThan(0);
  });
});
