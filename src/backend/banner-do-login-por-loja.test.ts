import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O BANNER DA TELA DE LOGIN, POR LOJA.
 *
 * "esses banner tem que ser trocado no lojista não no superadmin."
 *
 * Existia só como configuração da PLATAFORMA (`marca_login_banner_url`),
 * editável no painel do super admin: uma imagem só para todos os clientes, num
 * produto que é white-label justamente para não parecer isso. No domínio da
 * loja, nome, logo, favicon e cores já eram dela — o banner era o último lugar
 * em que a plataforma aparecia, e logo na PRIMEIRA tela que o cliente vê.
 *
 * Agora são três degraus: banner da loja, banner da plataforma, ilustração
 * desenhada. Nenhum degrau deixa buraco.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));
const PUBLICO = semComentarios(ler('src', 'backend', 'rotas', 'publico.ts'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const CAPA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'visual', 'abas', 'CapaTab.tsx'));
const FORM = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'visual', 'useVisualForm.ts'));
const CONTA = semComentarios(ler('frontend', 'src', 'pages', 'cliente', 'conta.tsx'));

describe('a coluna nasce sem derrubar quem já roda', () => {
  /* Entra pela lista de colunas adicionadas sob demanda, que confere o
     INFORMATION_SCHEMA antes do ALTER — banco já migrado não é tocado. */
  it('é migração aditiva de `lojas`', () => {
    expect(SCHEMA).toContain("['login_banner_url', 'login_banner_url TEXT']");
    const i = SCHEMA.indexOf("['login_banner_url'");
    const fim = SCHEMA.indexOf('] as const) {', i);
    expect(fim).toBeGreaterThan(i);
    expect(SCHEMA.slice(fim, fim + 400)).toContain("TABLE_NAME = 'lojas'");
  });
});

describe('o /api/tema resolve qual banner vale', () => {
  /* A tela recebe um campo só, já resolvido: decidir no cliente obrigaria a
     tela de login a saber qual loja é, e a regra viveria em dois lugares. */
  it('devolve o resolvido, e não o da plataforma cru', () => {
    expect(PUBLICO).toContain('login_banner_url:  bannerLogin,');
    expect(PUBLICO).toContain("let bannerLogin = await valor('marca_login_banner_url');");
  });

  it('lê a coluna da loja', () => {
    expect(PUBLICO).toMatch(/SELECT nome, descricao, favicon_url, logo_url, cor_marca, cor_secundaria, login_banner_url FROM lojas/);
  });

  /*
   * O DA LOJA GANHA — mesma regra do favicon, e pelo mesmo motivo: no domínio
   * dela, a imagem da plataforma é a marca de outra empresa.
   */
  it('o da loja sobrescreve o da plataforma', () => {
    expect(PUBLICO).toContain('if (loja?.login_banner_url?.trim()) bannerLogin = loja.login_banner_url.trim();');
  });

  /*
   * E VAZIO NÃO APAGA. `.trim()` na condição é o que separa "a loja escolheu
   * nada" de "a loja escolheu apagar": coluna vazia (o default de toda loja
   * existente) cai no banner da plataforma em vez de deixar a tela sem nada.
   */
  it('coluna vazia mantém o degrau de baixo', () => {
    const i = PUBLICO.indexOf('if (loja?.login_banner_url');
    expect(PUBLICO.slice(i, i + 120)).toContain('?.trim())');
  });
});

describe('o lojista grava o próprio', () => {
  it('o PUT da loja persiste a coluna', () => {
    expect(LOJISTA).toContain('login_banner_url = ?');
    expect(LOJISTA).toContain("validarUrl('login_banner_url', lojaQualquer.login_banner_url || '')");
  });

  /* Passa pela MESMA validação de URL do logo e do favicon: campo de imagem
     que aceita qualquer texto é campo que aceita `javascript:`. */
  it('valida a URL como os outros campos de imagem', () => {
    const i = LOJISTA.indexOf("validarUrl('login_banner_url'");
    const trecho = LOJISTA.slice(i - 300, i);
    expect(trecho).toContain("validarUrl('favicon_url'");
  });

  it('o formulário carrega, edita e envia o campo', () => {
    expect(FORM).toContain("login_banner_url: loja.login_banner_url || '',");
    expect(FORM).toContain('favicon_url, login_banner_url, ...visual } = estado;');
    expect(FORM).toContain('favicon_url, login_banner_url,');
  });

  it('o campo aparece na aba Capa do lojista', () => {
    expect(CAPA).toContain('Banner da tela de entrar');
    expect(CAPA).toContain("atualizar('login_banner_url', url)");
  });

  /*
   * A PRÉVIA MOSTRA O DEGRADÊ E O NOME POR CIMA, e não a imagem crua: é
   * embaixo, onde o degradê escurece, que o nome da loja entra — e é ali que
   * uma foto clara engole o texto. A imagem limpa esconderia o único jeito de
   * errar.
   */
  it('a prévia repete o degradê e o nome da tela real', () => {
    const i = CAPA.indexOf('estado.login_banner_url && (');
    expect(i).toBeGreaterThan(0);
    const bloco = CAPA.slice(i, i + 900);
    expect(bloco).toContain('bg-gradient-to-t from-black/55');
    expect(bloco).toContain('{estado.nome ||');
    /* O mesmo degradê que a tela de login usa — não um parecido. */
    expect(CONTA).toContain('bg-gradient-to-t from-black/55 via-black/10 to-transparent');
  });
});

describe('a tela de login continua com os três degraus', () => {
  it('imagem quando há, ilustração quando não', () => {
    expect(CONTA).toContain('banner={marca.login_banner_url}');
    const i = CONTA.indexOf('function HeroAuth');
    const bloco = CONTA.slice(i, i + 400);
    expect(bloco).toContain('if (banner) {');
  });
});
