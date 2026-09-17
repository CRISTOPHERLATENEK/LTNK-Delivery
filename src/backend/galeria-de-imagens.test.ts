import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * REUSAR A IMAGEM QUE A LOJA JÁ TEM.
 *
 * Pedido do lojista, cadastrando foto num item de complemento: "o ideal era ter
 * opção de carregar as imagens que já estão salvas no sistema".
 *
 * O caso dele é o mais claro possível: o item "MONSTER ULTRA FIESTA" aponta
 * para o produto MONSTER ULTRA FIESTA, que JÁ tem foto — e ele ia procurar o
 * arquivo no computador para subir a mesma imagem de novo. Dezesseis
 * energéticos, dezesseis uploads do que já estava lá (e dezesseis arquivos
 * iguais ocupando disco).
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const UPLOAD = semComentarios(ler('frontend', 'src', 'components', 'ui', 'image-upload.tsx'));
const PRODUTOS = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));

const ROTA = (() => {
  const i = LOJISTA.indexOf("router.get('/imagens'");
  expect(i).toBeGreaterThan(0);
  return LOJISTA.slice(i, LOJISTA.indexOf("router.get('/produtos-vinculaveis'", i));
})();

describe('a rota das imagens da loja', () => {
  /* Produto e complemento usam a mesma pasta de uploads; para quem escolhe é
     uma biblioteca só. */
  it('junta as fotos de produto e as de complemento', () => {
    expect(ROTA).toContain('FROM produtos p');
    expect(ROTA).toContain('FROM opcoes_itens o');
    expect(ROTA).toContain('UNION ALL');
  });

  /*
   * SÓ AS DESTA LOJA. É o mesmo recorte de todo o resto do painel — sem ele, a
   * galeria mostraria a foto do cardápio de outra empresa.
   */
  it('não mistura loja', () => {
    expect(ROTA).toMatch(/p\.loja_id = \?/);
    expect(ROTA).toMatch(/g\.loja_id = \?/);
  });

  /* A mesma imagem em dois produtos é UMA opção na grade. */
  it('não repete a mesma imagem', () => {
    expect(ROTA).toContain('GROUP BY imagem');
  });

  /* Vazio não é imagem: entraria como um quadrado cinza clicável. */
  it('ignora quem não tem foto', () => {
    expect(ROTA).toMatch(/p\.foto_url <> ''/);
    expect(ROTA).toMatch(/o\.imagem <> ''/);
  });

  /* O que foi mexido por último é o que se está procurando. */
  it('as mais recentes primeiro, com teto', () => {
    expect(ROTA).toContain('ORDER BY recente DESC');
    expect(ROTA).toContain('LIMIT 400');
  });
});

describe('a galeria no componente de imagem', () => {
  /*
   * OPCIONAL DE PROPÓSITO. A rota é do painel do LOJISTA: no painel admin
   * (marca, landing) ela devolveria 403, e um botão que só sabe dar erro é pior
   * que botão nenhum.
   */
  it('é uma opção, não um padrão', () => {
    expect(UPLOAD).toContain('galeria?: boolean;');
    expect(UPLOAD).toContain('{galeria && (');
  });

  /* Só pede a lista quando o painel abre: são até 400 linhas, e quase nenhum
     cadastro de foto abre a galeria. */
  it('a lista é pedida sob demanda', () => {
    const i = UPLOAD.indexOf('async function abrirGaleria');
    expect(i).toBeGreaterThan(0);
    const corpo = UPLOAD.slice(i, UPLOAD.indexOf('\n  }', i));
    expect(corpo).toContain('if (doSistema !== null) return;');
    expect(corpo).toContain("'/api/lojista/imagens'");
  });

  /*
   * FALHA EM SILÊNCIO COM LISTA VAZIA. Sem galeria, subir arquivo e colar URL
   * continuam funcionando — um erro aqui não pode travar o cadastro da foto.
   */
  it('erro não trava o resto', () => {
    const i = UPLOAD.indexOf('async function abrirGaleria');
    const corpo = UPLOAD.slice(i, UPLOAD.indexOf('\n  }', i));
    expect(corpo).toContain('catch { setDoSistema([]); }');
  });

  /* Quem procura foto reconhece a FOTO: grade de miniaturas, não lista de
     nomes. O nome fica embaixo, para desempatar duas parecidas. */
  it('mostra miniatura com o nome embaixo', () => {
    expect(UPLOAD).toContain('aspect-square w-full bg-muted object-cover');
    expect(UPLOAD).toContain('{x.nome}');
  });

  /* Imagem pesa: 400 miniaturas de uma vez travariam a rolagem no celular. */
  it('tem busca e teto', () => {
    expect(UPLOAD).toContain('value={buscaGaleria}');
    expect(UPLOAD).toContain('.slice(0, 60)');
  });

  it('escolher grava a imagem e fecha', () => {
    expect(UPLOAD).toContain("onClick={() => { onChange(x.imagem); setGaleriaAberta(false); }}");
  });
});

describe('onde a galeria está ligada', () => {
  /* Os dois lugares onde a loja cadastra foto: o produto e o item do
     complemento — que é onde o pedido nasceu. */
  it('na foto do produto e na do complemento', () => {
    expect(PRODUTOS).toContain('label={`Foto de ${o.nome} (opcional)`}');
    const i = PRODUTOS.indexOf('label={`Foto de ${o.nome} (opcional)`}');
    expect(PRODUTOS.slice(i, i + 120)).toContain('galeria');
    const j = PRODUTOS.indexOf('aspectRatio="square-lg"');
    expect(PRODUTOS.slice(j, j + 120)).toContain('galeria');
  });
});
