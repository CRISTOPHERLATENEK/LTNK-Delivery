import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A LUPA NO CADASTRO DE PRODUTO — o caminho inteiro, das duas rotas até a tela.
 *
 * Este arquivo guarda as DECISÕES, não o desenho. O que ele trava é o que já
 * quebrou ou quase quebrou de verdade:
 *
 *   1. a ordem das rotas (`foto-por-codigo` antes de `:id`);
 *   2. o servidor buscar de novo pelo código em vez de aceitar URL do cliente;
 *   3. a tela mostrar o nome que está NA BASE antes de deixar gravar;
 *   4. o crédito andar junto com a foto, e sumir quando a foto é do lojista.
 *
 * A verificação é no texto do fonte porque o valor está em relações entre
 * arquivos (rota × ordem × formulário), e isso nenhum teste de unidade vê.
 */

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ler = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const ROTAS = ler('rotas/lojista.ts');
const ROTAS_LIMPAS = semComentarios(ROTAS);
const FORM = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/pages/lojista/produtos.tsx'), 'utf8');
const FORM_LIMPO = semComentarios(FORM);

describe('as rotas da lupa', () => {
  /*
   * ESTA É A ARMADILHA DO EXPRESS. `/produtos/:id` casa com
   * `/produtos/foto-por-codigo` — declarada depois, a rota nova nunca é
   * alcançada e o servidor tenta abrir o produto de id "foto-por-codigo".
   * Não dá erro de compilação e não dá erro em teste de unidade: dá 404.
   */
  it('vêm antes de qualquer rota com :id de produto', () => {
    const lupa = ROTAS_LIMPAS.indexOf("'/produtos/foto-por-codigo'");
    const comId = ROTAS_LIMPAS.indexOf("'/produtos/:id'");
    expect(lupa).toBeGreaterThan(-1);
    expect(comId).toBeGreaterThan(-1);
    expect(lupa).toBeLessThan(comId);
  });

  it('são duas: uma que só olha e uma que grava', () => {
    expect(ROTAS_LIMPAS).toContain("router.get('/produtos/foto-por-codigo'");
    expect(ROTAS_LIMPAS).toContain("router.post('/produtos/foto-por-codigo'");
  });

  /*
   * O GET NÃO ESCREVE NADA. É o passo de conferência: se ele já baixasse, o
   * "É este produto mesmo?" da tela seria decorativo, e o disco encheria de
   * foto de produto que ninguém aceitou.
   */
  it('a prévia não baixa nem grava arquivo', () => {
    const inicio = ROTAS_LIMPAS.indexOf("router.get('/produtos/foto-por-codigo'");
    const fim = ROTAS_LIMPAS.indexOf("router.post('/produtos/foto-por-codigo'");
    const corpo = ROTAS_LIMPAS.slice(inicio, fim);
    expect(corpo).not.toContain('baixarEConverter');
    expect(corpo).not.toContain('writeFile');
  });

  /*
   * O SERVIDOR BUSCA DE NOVO PELO CÓDIGO, e é a peça de segurança da rota.
   *
   * Aceitar a URL que o navegador mandou deixaria qualquer lojista autenticado
   * apontar o download do servidor pra onde quisesse — a lista de hosts de
   * `foto-por-codigo.ts` protege contra a BASE envenenada, não contra quem
   * chama a nossa rota. O único dado que entra do corpo é o código, e só
   * dígitos.
   */
  it('o POST não aceita URL do corpo da requisição', () => {
    const inicio = ROTAS_LIMPAS.indexOf("router.post('/produtos/foto-por-codigo'");
    const corpo = ROTAS_LIMPAS.slice(inicio, inicio + 2200);
    expect(corpo).toContain('buscarFotoPorCodigo');
    expect(corpo).not.toMatch(/req\.body\??\.?\s*\.?(url|foto_url|previa)/);
    /* E reduz a entrada ao que um código de barras pode ser. */
    expect(corpo).toContain("replace(/\\D/g, '')");
  });

  it('as duas rotas exigem loja autenticada', () => {
    for (const verbo of ['get', 'post']) {
      const i = ROTAS_LIMPAS.indexOf(`router.${verbo}('/produtos/foto-por-codigo'`);
      expect(ROTAS_LIMPAS.slice(i, i + 400)).toContain('minhaLoja(req)');
    }
  });
});

describe('a tela da lupa', () => {
  it('existe e recebe o código do formulário', () => {
    expect(FORM_LIMPO).toContain('function BuscaFotoPorCodigo');
    expect(FORM_LIMPO).toContain('codigo={form.codigo_barras}');
  });

  /*
   * O NOME DA BASE APARECE ANTES DO BOTÃO DE USAR. Medido: o código
   * inexistente 9999999999999 devolve um registro de teste chamado
   * "Salatgurke" com imagem de 1x1. Sem o nome na tela, o lojista aceitaria a
   * foto de outro produto — pior do que ficar sem foto, porque parece pronto.
   */
  it('mostra o nome que está na base antes de deixar gravar', () => {
    const usar = FORM_LIMPO.indexOf('É esta, usar');
    const nome = FORM_LIMPO.indexOf('achado.nome_na_base');
    expect(nome).toBeGreaterThan(-1);
    expect(usar).toBeGreaterThan(-1);
    expect(nome).toBeLessThan(usar);
  });

  /*
   * A RECUSA TEM BOTÃO. Sem ela a única saída seria buscar de novo ou fechar o
   * cadastro — e a pessoa acaba clicando em "usar" só pra a tela parar de
   * oferecer, que é exatamente como a foto errada entra.
   */
  it('dá saída pra quem viu que não é o produto', () => {
    const usar = FORM_LIMPO.indexOf('É esta, usar');
    const depois = FORM_LIMPO.slice(usar, usar + 400);
    expect(depois).toContain('Não é');
    expect(depois).toContain('setAchado(null)');
  });

  /*
   * TROCAR O CÓDIGO INVALIDA A PRÉVIA. Sem isto a pessoa buscaria a Brahma,
   * corrigiria o código pra Skol e gravaria a foto da Brahma — o POST usa o
   * código atual, e a tela mostraria outra coisa.
   */
  it('a prévia não sobrevive à troca do código', () => {
    const i = FORM_LIMPO.indexOf('function BuscaFotoPorCodigo');
    const corpo = FORM_LIMPO.slice(i, i + 2500);
    expect(corpo).toContain('codigoDoAchado');
    /* O CORPO DO EFEITO, delimitado — sem isso a asserção casava com o
       `setAchado(null)` do início da busca, algumas linhas abaixo, e o teste
       passava mesmo com o efeito vazio (verificado sabotando). */
    const efeito = corpo.slice(corpo.indexOf('useEffect('), corpo.indexOf('}, [limpo])'));
    expect(efeito).toContain('setAchado(null)');
    expect(efeito).toContain('setSemResultado(false)');
  });

  it('não busca com código curto demais pra ser código de barras', () => {
    const i = FORM_LIMPO.indexOf('function BuscaFotoPorCodigo');
    expect(FORM_LIMPO.slice(i, i + 900)).toContain('limpo.length < 8');
  });
});

describe('o crédito anda junto com a foto', () => {
  /*
   * A LICENÇA EXIGE ATRIBUIÇÃO (CC-BY-SA). Sem gravar a origem POR FOTO, a
   * vitrine não sabe quando precisa creditar — e creditar em loja que só tem
   * foto própria seria mentira.
   */
  it('o formulário manda o crédito ao salvar', () => {
    expect(FORM_LIMPO).toContain('foto_credito: form.foto_credito');
  });

  it('o backend grava a coluna no INSERT e no UPDATE', () => {
    expect(ROTAS_LIMPAS).toContain('foto_url, foto_credito');
    expect(ROTAS_LIMPAS).toContain('foto_credito = ?');
  });

  it('a coluna entra no laço de migração, não só no CREATE', () => {
    /* CREATE TABLE IF NOT EXISTS não alcança banco que já existe: sem entrar
       no garantirColuna, a coluna nasce só em loja nova. */
    expect(ler('schema-mysql.ts')).toContain("['produtos', 'foto_credito'");
  });

  /*
   * FOTO QUE O LOJISTA SUBIU NÃO TEM CRÉDITO A DAR. Deixar o crédito antigo
   * grudado creditaria a base pública por uma foto que não é dela — atribuição
   * errada é pior que atribuição faltando.
   */
  it('o upload manual limpa o crédito', () => {
    const ocorrencias = FORM_LIMPO.match(/onChange=\{url => setForm\([^)]*foto_url: url[^}]*\}/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
    for (const o of ocorrencias) expect(o).toContain("foto_credito: ''");
  });
});
