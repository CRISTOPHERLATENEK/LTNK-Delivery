import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A COR DO PREÇO NO CARDÁPIO.
 *
 * O DEFEITO, num print do lojista: no modo escuro o preço SUMIA. O card ficava
 * branco e o valor invisível, com o nome do produto legível logo acima.
 *
 * A causa é uma mistura de dois sistemas de cor:
 *
 *   o CARD usa `cor_cards` — cor FIXA, escolhida no Visual (branca por padrão)
 *   o PREÇO usava `text-foreground` — token do TEMA, que inverte no escuro
 *
 * No modo escuro o token vira quase branco e o card continua branco, porque
 * hex não sabe de tema. O nome do produto escapava por não cravar cor nenhuma:
 * ele herda a `cor_texto` que o container aplica.
 *
 * A correção é o preço seguir o mesmo caminho do nome — e, já que o lojista
 * pediu, com uma `cor_preco` própria por cima quando ele escolher uma.
 */

const LOJA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'cliente', 'loja.tsx'), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const CODIGO = semComentarios(LOJA);

describe('o preço não usa a cor do tema', () => {
  /*
   * ASSERÇÃO NEGATIVA E PRECISA SER: o defeito não era uma linha faltando, era
   * `text-foreground` presente. Procurar "usa cor_preco" passaria verde com o
   * `text-foreground` intacto ao lado, e o preço continuaria sumindo.
   */
  it('nenhum preço do cardápio carrega text-foreground', () => {
    /*
     * O ELEMENTO INTEIRO, e não linha a linha: a primeira versão deste teste
     * filtrava linhas que tivessem `text-foreground` E `preco_destacado`
     * juntas, e uma sabotagem mostrou que as duas moram em LINHAS DIFERENTES do
     * mesmo `<span>` — o defeito voltava inteiro e o teste passava.
     *
     * Aqui a janela vai de cada `<span` de preço até o `brl(` que ele imprime.
     */
    const suspeitas: string[] = [];
    for (const m of CODIGO.matchAll(/brl\((precoExibido|preco)\)/g)) {
      const inicio = CODIGO.lastIndexOf('<span', m.index);
      const elemento = CODIGO.slice(inicio, m.index);
      if (elemento.includes('text-foreground')) suspeitas.push(elemento.slice(0, 140));
    }
    expect(suspeitas).toEqual([]);
  });

  /* Os dois cards (lista e grade) têm que ter recebido a mesma correção: um só
     deixaria o preço sumindo em metade dos layouts. */
  it('os dois cards aplicam a cor da loja', () => {
    const usos = [...CODIGO.matchAll(/style=\{\{ color: visual\.cores\.cor_preco \|\| undefined \}\}/g)];
    expect(usos.length).toBe(2);
  });

  /*
   * SEM `cor_preco`, O PREÇO HERDA — e herdar é o certo: é assim que o nome do
   * produto sempre funcionou, e é o que faz a `cor_texto` do Visual valer.
   * `|| undefined` em vez de `|| '#algo'` é o que permite a herança.
   */
  it('vazio deixa herdar em vez de cravar um padrão', () => {
    expect(CODIGO).not.toMatch(/cor_preco \|\| '#/);
  });

  /*
   * A COR ESCOLHIDA GANHA DA COR DE PROMOÇÃO. O preço promocional era sempre
   * `text-primary`; se ele continuasse por cima, o lojista escolheria uma cor
   * e metade dos produtos ignoraria.
   */
  it('a cor escolhida vence a de promoção', () => {
    const usos = [...CODIGO.matchAll(/!visual\.cores\.cor_preco && temPromo && 'text-primary'/g)];
    expect(usos.length).toBe(2);
  });
});

describe('a cor do preço é editável no Visual', () => {
  it('tem campo na aba de cores', () => {
    const tab = fs.readFileSync(path.join(
      __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'visual', 'abas', 'CoresTab.tsx'), 'utf8');
    expect(tab).toContain('Cor do preço');
    expect(tab).toContain("atualizar('cores.cor_preco'");
  });

  /*
   * E O SERVIDOR GRAVA. Campo que a tela manda e a rota descarta é o pior dos
   * mundos: o lojista escolhe a cor, vê o preview mudar, salva, recarrega e
   * encontra tudo como estava — sem nenhum erro para explicar.
   */
  it('o servidor aceita e grava a cor', () => {
    const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
    expect(rotas).toContain('cor_preco: cor(coresNovo.cor_preco');
  });

  it('entra nos padrões, senão o campo nasce indefinido', () => {
    const visual = fs.readFileSync(path.join(
      __dirname, '..', '..', 'frontend', 'src', 'lib', 'visual.ts'), 'utf8');
    expect(visual).toContain("cor_preco: ''");
  });
});
