import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ehSimples, rotuloSituacao, situacoesDoRegime, explicacaoFiscal }
  from '../../frontend/src/lib/fiscal-codigos';

/*
 * A ABA FISCAL DO PRODUTO, DEPOIS DO DESENHO "MOBILE POLIDO".
 *
 * Três coisas estavam erradas na tela, e as três têm consequência fora dela:
 *
 *  1. O campo mostrava "21069090" e NADA dizia se aquilo era o padrão da loja
 *     ou um valor que alguém digitou. Quem não sabe o que está editando não
 *     edita — ou edita sem saber o que quebrou.
 *  2. O rótulo era sempre "CSOSN", inclusive em REGIME NORMAL, onde o campo é
 *     CST. CSOSN em nota de regime normal é rejeição na SEFAZ — o erro sai caro
 *     e só aparece na hora de emitir.
 *  3. Os códigos não tinham tradução. "5102" não diz nada a quem cadastra um
 *     balde de whisky.
 *
 * A configuração fiscal da loja JÁ devolvia tudo (`ncm_padrao`, `cfop_padrao`,
 * `csosn_padrao` e `crt` em `GET /api/lojista/nfce`); a tela do produto é que
 * não consultava.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));
const FISCAL = ler('frontend', 'src', 'pages', 'lojista', 'fiscal.tsx');
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));

describe('o regime decide o campo de situação tributária', () => {
  /* 3 = regime normal; 1 e 2 são Simples. A regra é a mesma de `fiscal.tsx`. */
  it('crt 3 é regime normal, o resto é Simples', () => {
    expect(ehSimples(3)).toBe(false);
    expect(ehSimples(1)).toBe(true);
    expect(ehSimples(2)).toBe(true);
  });

  /* Sem configuração fiscal nenhuma, assume Simples — é o caso da esmagadora
     maioria das lojas, e é o que o resto do sistema já assume por padrão. */
  it('sem crt, assume Simples', () => {
    expect(ehSimples(undefined)).toBe(true);
    expect(ehSimples(null)).toBe(true);
  });

  it('o rótulo e a lista trocam com o regime', () => {
    expect(rotuloSituacao(true)).toBe('CSOSN');
    expect(rotuloSituacao(false)).toBe('CST do ICMS');
    expect(situacoesDoRegime(true).map(c => c.v)).toContain('102');
    expect(situacoesDoRegime(false).map(c => c.v)).toContain('00');
    /* O contrário é o erro caro: CSOSN em regime normal, CST no Simples. */
    expect(situacoesDoRegime(false).map(c => c.v)).not.toContain('102');
    expect(situacoesDoRegime(true).map(c => c.v)).not.toContain('00');
  });
});

describe('a explicação em português', () => {
  it('traduz o CFOP pelo valor', () => {
    expect(explicacaoFiscal('CFOP', '5102', true)).toContain('dentro do estado');
    expect(explicacaoFiscal('CFOP', '6102', true)).toContain('FORA do estado');
  });

  it('traduz a situação tributária conforme o regime', () => {
    expect(explicacaoFiscal('CSOSN', '102', true)).toContain('sem permissão de crédito');
    expect(explicacaoFiscal('CSOSN', '00', false)).toContain('integralmente');
  });

  /* Valor desconhecido cai numa frase genérica em vez de sumir: campo sem
     explicação nenhuma é exatamente o estado que se veio corrigir. */
  it('valor fora da tabela ainda diz alguma coisa', () => {
    expect(explicacaoFiscal('CFOP', '9999', true).length).toBeGreaterThan(10);
    expect(explicacaoFiscal('Origem', '7', true).length).toBeGreaterThan(10);
  });

  it('os campos fixos têm a linha deles', () => {
    expect(explicacaoFiscal('CEST', '', true)).toContain('substituição tributária');
    expect(explicacaoFiscal('Unidade', 'UN', true)).toContain('unidade comercial');
  });
});

describe('a tela do produto', () => {
  /* O dado já existia no servidor; faltava a tela pedir. */
  it('lê a tributação padrão da loja', () => {
    expect(TELA).toContain("queryKey: ['lojista-nfce-padrao']");
    expect(TELA).toContain("'GET', '/api/lojista/nfce'");
    expect(LOJISTA).toContain('ncm_padrao: loja.nfce_ncm_padrao');
  });

  /*
   * O SELO SÓ APARECE QUANDO O VALOR É IGUAL AO PADRÃO. Valor diferente é
   * decisão do lojista, e chamar isso de herança seria mentira na tela.
   */
  it('marca o campo herdado, e só ele', () => {
    expect(TELA).toContain('const herdado = !!padrao && valor.trim() === padrao;');
    expect(TELA).toContain('padrão da loja');
  });

  it('oferece voltar ao padrão', () => {
    expect(TELA).toContain('Voltar tudo ao padrão da loja');
  });

  it('a faixa diz o regime e o padrão da loja', () => {
    expect(TELA).toContain('Regime da loja:');
    expect(TELA).toContain('O que você preencher aqui vale só para este produto.');
  });

  /* A situação tributária vira LISTA: digitar um CSOSN em regime normal é
     rejeição na SEFAZ, e campo livre convida exatamente a isso. */
  it('a situação tributária é escolhida numa lista do regime', () => {
    expect(TELA).toContain('situacoesDoRegime(simplesNacional).map(c => (');
  });

  /* Falha em silêncio: sem configuração fiscal, os campos continuam editáveis
     como antes, só sem os selos. */
  it('sem configuração fiscal, a aba continua funcionando', () => {
    expect(TELA).toContain('.catch((): PadraoFiscalLoja => ({}))');
    expect(TELA).toContain('{(padraoFiscal.NCM || padraoFiscal.CFOP || padraoFiscal.CSOSN) && (');
  });
});

describe('uma lista só de CSOSN e CST', () => {
  /*
   * A TELA DA LOJA E A DO PRODUTO PRECISAM CONCORDAR. Duas listas iguais em
   * dois arquivos divergem — e divergência aqui significa a loja configurar um
   * código que o produto não oferece.
   */
  it('a tela da loja usa a mesma fonte', () => {
    expect(FISCAL).toContain("from '@/lib/fiscal-codigos'");
    const semComentario = FISCAL.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(semComentario).not.toContain('const CSOSNS = [');
    expect(semComentario).not.toContain('const CSTS = [');
  });
});
