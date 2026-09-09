import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  VERSAO_DOCUMENTOS, CAMINHO_TERMOS, CAMINHO_POLITICA, enderecoDoDocumento,
} from './documentos-legais';
import { SLUGS_RESERVADOS } from './slug-reservado';

/*
 * TERMOS E POLÍTICA PUBLICADOS PELO PRÓPRIO APP.
 *
 * Antes disto, `termos_url` e `politica_url` eram campos vazios no admin, e
 * vazio significava LINK NENHUM: a tela de cadastro escondia a frase de aceite
 * de propósito, porque prometer "você aceita os termos" sem ter termos para ler
 * é pior que silêncio. A plataforma operava sem cumprir o dever de informar do
 * art. 9º da LGPD, e o aceite gravado apontava para a versão "" — data de
 * aceite sem documento, que não prova o que a pessoa concordou.
 *
 * O QUE ESTE ARQUIVO PROTEGE são as três coisas que quebrariam CALADAS:
 *   1. a rota `/termos` depois de `/:id` — que casa qualquer segmento e é a URL
 *      da loja. O documento viraria "loja de slug termos" e cairia no 404.
 *   2. o slug livre no servidor — um lojista registrando `privacidade` passaria
 *      a responder no lugar da política da plataforma.
 *   3. a versão do aceite voltando a ser vazia.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');

const publico = ler(BACKEND, 'rotas', 'publico.ts');
const admin = ler(BACKEND, 'rotas', 'admin.ts');
const autenticacao = ler(BACKEND, 'rotas', 'autenticacao.ts');
const lojista = ler(BACKEND, 'rotas', 'lojista.ts');
const slugLoja = ler(BACKEND, 'slug-loja.ts');
const schema = ler(BACKEND, 'schema-mysql.ts');
const app = ler(RAIZ, 'frontend', 'src', 'App.tsx');
const legal = ler(RAIZ, 'frontend', 'src', 'pages', 'legal.tsx');
const conta = ler(RAIZ, 'frontend', 'src', 'pages', 'cliente', 'conta.tsx');
const configAdmin = ler(RAIZ, 'frontend', 'src', 'pages', 'admin', 'configuracoes.tsx');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('o endereço do documento', () => {
  /* O campo do admin GANHA: quem hospeda o documento no site institucional põe
     a URL lá, e a interna sai de cena. */
  it('o configurado vence o interno', () => {
    expect(enderecoDoDocumento('https://exemplo.com/politica', CAMINHO_POLITICA))
      .toBe('https://exemplo.com/politica');
  });

  /* E vazio cai no interno, que é a mudança inteira: o padrão deixou de ser
     "nada" e passou a ser "o documento que a gente publica". */
  it('vazio, nulo e só espaço caem no interno', () => {
    expect(enderecoDoDocumento('', CAMINHO_TERMOS)).toBe('/termos');
    expect(enderecoDoDocumento(null, CAMINHO_TERMOS)).toBe('/termos');
    expect(enderecoDoDocumento(undefined, CAMINHO_TERMOS)).toBe('/termos');
    expect(enderecoDoDocumento('   ', CAMINHO_TERMOS)).toBe('/termos');
  });

  /* Um segmento só, porque é o formato que a rota `/:id` da loja casa — e é por
     isso que os dois nomes precisam ser reservados. */
  it('os caminhos internos têm um segmento', () => {
    for (const c of [CAMINHO_TERMOS, CAMINHO_POLITICA]) {
      expect(c.startsWith('/')).toBe(true);
      expect(c.slice(1)).not.toContain('/');
    }
  });

  it('a versão é uma data ISO curta', () => {
    expect(VERSAO_DOCUMENTOS).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('a rota vem ANTES da loja', () => {
  /*
   * `/:id` casa qualquer segmento e é a URL pública da loja. Declarar `/termos`
   * depois dele faria o React Router escolher a loja: o documento legal viraria
   * uma busca por loja de slug "termos" e cairia no 404 da vitrine. Sem erro
   * nenhum aparecer — o link existe, a página só não é a certa.
   */
  it('/termos e /privacidade são declarados antes de /:id', () => {
    const codigo = exec(app);
    const iTermos = codigo.indexOf('path="/termos"');
    const iPolitica = codigo.indexOf('path="/privacidade"');
    const iLoja = codigo.indexOf('path="/:id"');
    expect(iTermos).toBeGreaterThan(-1);
    expect(iPolitica).toBeGreaterThan(-1);
    expect(iLoja).toBeGreaterThan(-1);
    expect(iTermos).toBeLessThan(iLoja);
    expect(iPolitica).toBeLessThan(iLoja);
  });

  it('as duas páginas existem e são carregadas', () => {
    const codigo = exec(app);
    expect(codigo).toContain("import('@/pages/legal')");
    expect(codigo).toContain('m.Termos');
    expect(codigo).toContain('m.Privacidade');
  });
});

describe('o slug não pode ser sequestrado', () => {
  /*
   * A URL da loja é a raiz do domínio. Sem reservar, um lojista registra o slug
   * `privacidade` e a loja dele passa a responder no endereço da política de
   * privacidade da plataforma — e o link do rodapé leva ao cardápio dele.
   */
  it('termos e privacidade estão reservados', () => {
    /* A lista CANONICA, importada — e não uma busca de texto: é ela que o teste
       de `slug-reservado` compara com as rotas do App.tsx. */
    expect(SLUGS_RESERVADOS).toContain('termos');
    expect(SLUGS_RESERVADOS).toContain('privacidade');
  });

  /*
   * E OS ESPELHOS TAMBÉM. A lista existe em quatro lugares neste projeto (a
   * canônica, o Set da rota do lojista, o da geração automática de slug, e o de
   * subdomínio de tenant, que é outro assunto). Reservar só na canônica deixaria
   * a validação da rota aceitando o slug — e o teste da canônica passaria.
   */
  it('os espelhos que valem para slug de loja acompanham', () => {
    for (const fonte of [lojista, slugLoja]) {
      const codigo = exec(fonte);
      const i = codigo.indexOf('SLUGS_RESERVADOS');
      const bloco = codigo.slice(i, i + 600);
      expect(bloco).toContain("'termos'");
      expect(bloco).toContain("'privacidade'");
    }
  });
});

describe('o aceite aponta para um documento real', () => {
  /*
   * `termos_versao` nasce vazio e nenhuma instalação tinha preenchido, então
   * todo aceite era gravado como aceite da versão "": data sem documento, que
   * não prova o que a pessoa concordou. O padrão agora é a versão que viaja com
   * o código.
   */
  it('versaoDosTermos cai na versão publicada, não em vazio', () => {
    const codigo = exec(autenticacao);
    const i = codigo.indexOf('async function versaoDosTermos');
    const corpo = codigo.slice(i, i + 700);
    expect(corpo).toContain('return row?.valor || VERSAO_DOCUMENTOS;');
    /* Inclusive no catch: banco fora do ar não é motivo pra gravar aceite vazio. */
    expect(corpo).toContain('return VERSAO_DOCUMENTOS;');
    expect(corpo).not.toMatch(/return '';/);
  });
});

describe('a rota pública publica os dois documentos', () => {
  it('o padrão deixou de ser vazio', () => {
    const codigo = exec(publico);
    expect(codigo).toContain("enderecoDoDocumento(await valor('termos_url'), CAMINHO_TERMOS)");
    expect(codigo).toContain("enderecoDoDocumento(await valor('politica_url'), CAMINHO_POLITICA)");
    /* A prova negativa: nenhuma das duas linhas devolve a configuração crua. */
    expect(codigo).not.toMatch(/termos_url:\s*await valor\('termos_url'\),/);
    expect(codigo).not.toMatch(/politica_url:\s*await valor\('politica_url'\),/);
  });

  /* A versão vem do servidor e NÃO está duplicada na tela: é a mesma que vai
     gravada no aceite, e duas fontes divergiriam sem ninguém notar. */
  it('a versão e o encarregado chegam na tela', () => {
    const codigo = exec(publico);
    expect(codigo).toContain("termos_versao:     await valor('termos_versao') || VERSAO_DOCUMENTOS");
    expect(codigo).toContain("encarregado_nome:     await valor('encarregado_nome')");
    expect(codigo).toContain("encarregado_email:    await valor('encarregado_email')");
  });
});

describe('o encarregado (LGPD art. 41)', () => {
  /* As chaves precisam existir no banco: `configuracoes` é chave/valor, e o GET
     do admin leria vazio pra sempre se o provisionamento não as criasse. */
  it('as três chaves nascem no schema', () => {
    for (const k of ['encarregado_nome', 'encarregado_email', 'encarregado_telefone']) {
      expect(schema).toContain(`['${k}', '']`);
    }
  });

  it('o admin lê e grava as três', () => {
    const codigo = exec(admin);
    expect(codigo).toContain("encarregado_nome:     await valor('encarregado_nome')");
    expect(codigo).toContain("await upsert('encarregado_nome'");
    expect(codigo).toContain("await upsert('encarregado_email'");
    expect(codigo).toContain("await upsert('encarregado_telefone'");
  });

  /* E-mail inválido é recusado: o canal do titular tem que funcionar, e um
     endereço com erro de digitação é o mesmo que não ter canal. */
  it('o e-mail do encarregado é validado', () => {
    const codigo = exec(admin);
    const i = codigo.indexOf("req.body.encarregado_email !== undefined");
    const bloco = codigo.slice(i, i + 300);
    expect(bloco).toContain('!emailValido(v)');
    expect(bloco).toContain('E-mail do encarregado inválido.');
  });

  /*
   * VAZIO NÃO INVENTA CANAL. Mostrar "entre em contato" sem endereço seria
   * repetir o defeito que estas páginas vieram consertar: prometer um caminho
   * que não existe. Sem nome e sem e-mail, o bloco não aparece.
   */
  it('a política esconde o bloco quando não há ninguém nomeado', () => {
    const codigo = exec(legal);
    expect(codigo).toContain('if (!nome && !email) return null;');
  });

  /* Nome sem canal é uma pessoa apontada publicamente sem como ser procurada —
     o pior dos dois estados, então a tela do admin avisa. */
  it('o admin avisa sobre nome sem e-mail', () => {
    const codigo = exec(configAdmin);
    expect(codigo).toContain("form.encarregado_nome.trim() && !form.encarregado_email.trim()");
  });
});

describe('as páginas dizem a verdade sobre o sistema', () => {
  /*
   * O VALOR DESTES DOCUMENTOS ESTÁ EM DESCREVEREM O SISTEMA REAL. Política que
   * promete menos do que o sistema faz é declaração falsa; que promete mais é a
   * mesma coisa ao contrário. Estas asserções travam os pontos em que o texto
   * afirma algo verificável no código — se o comportamento mudar e o texto
   * ficar, o teste cai.
   */
  it('lista os terceiros que de fato recebem dado pessoal', () => {
    const codigo = exec(legal);
    for (const t of ['Mercado Pago', 'Maxx Gestão', 'Google', 'WhatsApp', 'Cloudflare', 'Hostinger']) {
      expect(codigo).toContain(t);
    }
  });

  /* O sistema NÃO guarda IP de cliente (só de ação de admin, na auditoria), e a
     política afirma isso. Se alguém passar a guardar, o texto vira mentira. */
  it('afirma que não guarda IP de cliente, e o servidor não guarda', () => {
    expect(exec(legal)).toContain('endereço IP');
    /* A única gravação de IP é a da trilha de auditoria do admin. */
    const gravaIp = exec(admin).includes('String(req.ip');
    expect(gravaIp).toBe(true);
    const rotasCliente = ler(BACKEND, 'rotas', 'cliente.ts');
    expect(exec(rotasCliente)).not.toContain('req.ip');
  });

  /* A exclusão diz o que NÃO faz. Prometer "apagamos tudo" seria mentira: a
     nota emitida não pode ser desfeita, e o valor fica na contabilidade. */
  it('a política explica o limite da exclusão', () => {
    const codigo = exec(legal);
    expect(codigo).toContain('sem identificar você');
    expect(codigo).toContain('art. 16');
  });

  /* Os caminhos que o texto manda a pessoa clicar têm que ser os que existem. */
  it('aponta para os botões que existem de verdade', () => {
    const codigo = exec(legal);
    expect(codigo).toContain('Baixar meus dados');
    expect(codigo).toContain('Excluir minha conta');
    expect(exec(conta)).toContain('Baixar meus dados');
    expect(exec(conta)).toContain('Excluir minha conta');
  });

  /* Os dois documentos se referenciam: quem abre um precisa achar o outro. */
  it('termos e política se apontam', () => {
    const codigo = exec(legal);
    expect(codigo).toContain('to="/privacidade"');
    expect(codigo).toContain('to="/termos"');
  });

  /*
   * A FAIXA DE MINUTA. O documento não passou por advogado, e publicar como
   * definitivo o que não foi revisado é pior que publicar com a ressalva. Fica
   * no TOPO porque ressalva escondida embaixo de dez seções não é ressalva.
   */
  it('a faixa de minuta aparece nos dois, antes do texto', () => {
    const codigo = exec(legal);
    expect(codigo).toContain('Minuta em revisão jurídica');
    for (const doc of ['export function Privacidade', 'export function Termos']) {
      const i = codigo.indexOf(doc);
      const corpo = codigo.slice(i, i + 900);
      expect(corpo).toContain('<AvisoMinuta />');
    }
  });
});
