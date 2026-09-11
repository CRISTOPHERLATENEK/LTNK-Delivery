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
   * O GET NÃO ESCREVE NO DISCO. Ele baixa e converte — precisa, porque a prévia
   * que a pessoa confere é o arquivo convertido —, mas nada fica gravado. Se
   * gravasse, o "É este produto mesmo?" da tela seria decorativo e o disco
   * encheria de foto que ninguém aceitou.
   */
  it('a prévia não grava arquivo', () => {
    const inicio = ROTAS_LIMPAS.indexOf("router.get('/produtos/foto-por-codigo'");
    const fim = ROTAS_LIMPAS.indexOf("router.post('/produtos/foto-por-codigo'");
    const corpo = ROTAS_LIMPAS.slice(inicio, fim);
    expect(corpo).not.toContain('writeFile');
    /* E a prévia sai embutida, não como endereço da fonte: o que a pessoa vê é
       o arquivo que vai ser gravado, mesma conversão e mesmo fundo. */
    expect(corpo).toContain('r.achado.previa');
  });

  /*
   * O POST RECUSA FUNDO NÃO-BRANCO COM CÓDIGO PRÓPRIO (422, e não 404).
   *
   * "Não achei" e "achei mas é foto de prateleira" mandam a pessoa para lugares
   * diferentes: conferir o código de barras, ou fotografar o produto na loja.
   * Um 404 para os dois casos faria ela procurar um código que está certo.
   */
  it('a recusa por fundo é distinguível da ausência', () => {
    const inicio = ROTAS_LIMPAS.indexOf("router.post('/produtos/foto-por-codigo'");
    const corpo = ROTAS_LIMPAS.slice(inicio, inicio + 2200);
    expect(corpo).toMatch(/fundo-nao-branco[\s\S]{0,160}422/);
    expect(corpo).toContain('404');
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
    expect(corpo).toContain('acharFotoDeFundoBranco');
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
    expect(efeito).toContain("setRecusa('')");
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


/*
 * O FUNDO BRANCO — a exigência que veio do lojista depois de ver o resultado da
 * primeira versão, e a razão de existir uma segunda fonte.
 */
describe('só entra foto de fundo branco', () => {
  const BUSCA = ler('foto-por-codigo.ts');
  const BUSCA_LIMPA = semComentarios(BUSCA);

  /*
   * A ORDEM DAS FONTES É A MEDIÇÃO, não preferência. Medido em 10/09/2026 nos
   * produtos da Galderio: Cosmos tem imagem para 49 de 60 e 46 delas em fundo
   * branco; Open Food Facts tem 24 de 60 e nenhuma das medidas com fundo
   * branco — são fotos de celular na prateleira.
   */
  it('o Cosmos vem antes da Open Food Facts', () => {
    const ordem = BUSCA_LIMPA.slice(BUSCA_LIMPA.indexOf('FONTES: Fonte[]'));
    const c = ordem.indexOf('candidatoCosmos');
    const o = ordem.indexOf('candidatoOpenFoodFacts');
    expect(c).toBeGreaterThan(-1);
    expect(o).toBeGreaterThan(-1);
    expect(c).toBeLessThan(o);
  });

  it('a decisão de fundo é obrigatória no caminho da gravação', () => {
    const i = BUSCA_LIMPA.indexOf('export async function acharFotoDeFundoBranco');
    const corpo = BUSCA_LIMPA.slice(i);
    expect(corpo).toContain('analisarFundo');
    expect(corpo).toContain("registrar('fundo-nao-branco'");
    /* A prova negativa: não existe caminho que devolva ok sem passar pelo
       teste de fundo. O único `ok: true` fica depois dele. */
    const decide = corpo.indexOf('if (!fundo.branco)');
    const aceita = corpo.indexOf('ok: true');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(aceita);
  });

  /* Transparente vira branco de verdade no arquivo — as imagens do Cosmos são
     PNG com alfa, e "fundo branco" não pode virar "fundo nenhum". */
  it('a foto é achatada em branco na conversão', () => {
    expect(BUSCA_LIMPA).toContain('achatarEmBranco: true');
    expect(semComentarios(ler('imagem-web.ts'))).toContain("flatten({ background: '#ffffff' })");
  });

  /* E o achatamento NÃO vale para o upload do lojista: logo transparente que
     ele sobe deve continuar transparente. */
  it('o upload manual não é achatado', () => {
    const upload = semComentarios(ler('rotas/upload.ts'));
    expect(upload).not.toContain('achatarEmBranco');
  });

  it('o token do Cosmos vem do ambiente e nunca é registrado', () => {
    expect(BUSCA_LIMPA).toContain('process.env.COSMOS_TOKEN');
    /* Segredo não vai para log nem para a resposta. A busca é por qualquer
       coisa que imprima o token. */
    expect(BUSCA_LIMPA).not.toMatch(/console\.[a-z]+\([^)]*token/i);
  });

  /* Sem token a integração continua funcionando: a imagem sai do CDN por
     endereço montado, e a conferência passa a ser a própria foto na tela. */
  it('sem token o Cosmos ainda entrega a imagem', () => {
    const i = BUSCA_LIMPA.indexOf('export const candidatoCosmos');
    const corpo = BUSCA_LIMPA.slice(i, i + 1400);
    expect(corpo).toContain('urlDoCosmos(codigo)');
    expect(corpo).toContain('if (token)');
  });

  it('o CDN do Cosmos entra na lista fechada de hosts', () => {
    const i = BUSCA_LIMPA.indexOf('HOSTS_PERMITIDOS');
    const corpo = BUSCA_LIMPA.slice(i, i + 300);
    expect(corpo).toContain('cdn-cosmos.bluesoft.com.br');
    expect(corpo).toContain('images.openfoodfacts.org');
  });
});

describe('a tela explica a recusa', () => {
  /*
   * TRÊS FRASES, TRÊS SAÍDAS. "Não está nas bases" pede conferir o código;
   * "não tem fundo branco" pede fotografar na loja; "imagem imprestável" avisa
   * que existe mas não serve. Uma frase só mandaria a pessoa procurar defeito
   * no lugar errado.
   */
  it('cada motivo tem a sua frase', () => {
    for (const motivo of ['nao-esta-na-base', 'fundo-nao-branco', 'imagem-imprestavel']) {
      expect(FORM_LIMPO).toContain(`'${motivo}':`);
    }
  });

  it('a frase do fundo manda fotografar na loja', () => {
    const i = FORM_LIMPO.indexOf("'fundo-nao-branco':");
    expect(FORM_LIMPO.slice(i, i + 260)).toContain('na loja');
  });

  /* O quadro da prévia tem fundo branco fixo: conferir fundo branco sobre
     cartão escuro no modo noturno não conferiria nada. */
  it('a prévia é conferida sobre branco', () => {
    const i = FORM_LIMPO.indexOf('achado.previa');
    expect(FORM_LIMPO.slice(i, i + 220)).toContain('bg-white');
  });

  it('diz de qual fonte a foto veio', () => {
    expect(FORM_LIMPO).toContain('NOME_DA_FONTE');
    expect(FORM_LIMPO).toContain("cosmos: 'Cosmos'");
  });
});


/*
 * O QUE A REVISAO ADVERSARIAL DE 11/09/2026 ACHOU, e que os testes anteriores
 * deixavam passar. Cada caso aqui embaixo e um defeito que existiu de verdade
 * no codigo publicado, nao um risco imaginado.
 */
describe('a conferencia de dois passos nao pode ser furada pela resposta atrasada', () => {
  /*
   * A BUSCA DEMORA SEGUNDOS (duas fontes, download, conversao) e da tempo de
   * corrigir o codigo enquanto ela esta no ar. Sem carimbar a resposta com o
   * codigo que a pediu, a previa da Brahma aparecia ao lado do codigo da Skol:
   * a pessoa conferia "BRAHMA", clicava em "E esta, usar", e o POST mandava o
   * codigo NOVO. Gravava a Skol depois de conferir a Brahma.
   */
  it('resposta de um codigo antigo e descartada', () => {
    const i = FORM_LIMPO.indexOf('async function buscar()');
    const corpo = FORM_LIMPO.slice(i, i + 1400);
    expect(corpo).toContain('const pedido = limpo;');
    expect(corpo).toContain('if (pedido !== limpoRef.current) return;');
  });

  /* E o que grava e o codigo CONFERIDO, nao o que estiver no campo na hora. */
  it('o botao usar grava o codigo do achado', () => {
    const i = FORM_LIMPO.indexOf('async function usar(');
    const corpo = FORM_LIMPO.slice(i, i + 900);
    expect(corpo).toContain('codigo: achado.codigo');
    expect(corpo).not.toMatch(/codigo:\s*limpo\b/);
  });
});

describe('a atribuicao chega a quem ve a foto', () => {
  /*
   * O CREDITO ERA GRAVADO POR TRES CAMINHOS E LIDO POR NENHUM: a lupa, o lote
   * e o formulario preenchiam `foto_credito`, nenhuma consulta publica
   * selecionava a coluna e nenhuma tela mostrava. A licenca (CC-BY-SA na Open
   * Food Facts) exige atribuicao a QUEM VE a imagem — e quem ve e o cliente no
   * cardapio. Gravar e nao mostrar era ter no banco a prova de que a gente
   * sabia da obrigacao.
   */
  it('a consulta publica do cardapio leva o credito', () => {
    const publico = semComentarios(ler('rotas/publico.ts'));
    expect(publico).toContain('p.foto_credito');
  });

  it('a tela do cliente mostra o credito quando ele existe', () => {
    const modal = semComentarios(fs.readFileSync(
      path.join(__dirname, '../../frontend/src/pages/cliente/modal-produto.tsx'), 'utf8'));
    expect(modal).toContain('produto.foto_credito');
    /* E so quando existe: credito vazio e foto do proprio lojista. */
    expect(modal).toContain('{!!produto.foto_credito && (');
  });

  /* Duplicar produto copiava a foto e deixava o credito para tras — a copia
     nascia dizendo "foto minha" com a imagem de terceiro. */
  it('duplicar leva o credito junto com a foto', () => {
    const i = ROTAS_LIMPAS.indexOf("router.post('/produtos/:id/duplicar'");
    const corpo = ROTAS_LIMPAS.slice(i, i + 1800);
    expect(corpo).toContain('foto_url, foto_credito');
    expect(corpo).toContain('original.foto_credito');
  });
});

describe('as rotas da lupa nao podem ser usadas como torneira', () => {
  /*
   * CADA POST GRAVA UM ARQUIVO que so vira foto se o formulario for salvo
   * depois. Sem limite, um laco enche o disco do VPS que hospeda TODOS os
   * clientes — e cada chamada ainda dispara ate cinco requisicoes as fontes a
   * partir do IP do servidor, o que faz elas barrarem a lupa de todo mundo.
   */
  it('as duas rotas tem limitador de taxa', () => {
    for (const verbo of ['get', 'post']) {
      const i = ROTAS_LIMPAS.indexOf(`router.${verbo}('/produtos/foto-por-codigo'`);
      expect(ROTAS_LIMPAS.slice(i, i + 120)).toContain('limiteLupa');
    }
  });

  it('o limitador conta por conta, nao so por IP', () => {
    const i = ROTAS_LIMPAS.indexOf('const limiteLupa');
    const corpo = ROTAS_LIMPAS.slice(i, i + 600);
    expect(corpo).toContain('req.usuario?.id');
    expect(corpo).toContain('ipKeyGenerator');
  });
});

describe('nenhuma fonte pode prender o servidor', () => {
  const BUSCA = semComentarios(ler('foto-por-codigo.ts'));

  /*
   * SEM TIMEOUT, O `fetch` DO NODE ESPERA 300 SEGUNDOS (padrao do undici, para
   * cabecalho e para corpo). Uma chamada da lupa encadeia ate seis requisicoes,
   * e a fonte LENTA — aceitando a conexao e nao respondendo — prendia o handler
   * por minutos. Alguns cliques em paralelo e o app para de aceitar requisicao.
   */
  it('toda requisicao de rede tem prazo', () => {
    const chamadas = BUSCA.split('await buscar(').length - 1;
    const prazos = (BUSCA.match(/AbortSignal\.timeout/g) || []).length;
    expect(chamadas).toBeGreaterThan(0);
    expect(prazos).toBe(chamadas);
  });

  /*
   * E A UNICA REQUISICAO QUE CARREGA SEGREDO NAO SEGUE REDIRECIONAMENTO: o
   * `fetch` do Node so remove `Authorization` ao mudar de origem; cabecalho
   * proprio como `X-Cosmos-Token` e reenviado ao destino. Um 302 entregaria a
   * credencial paga a quem estivesse do outro lado.
   */
  it('a chamada com o token nao segue redirecionamento', () => {
    const i = BUSCA.indexOf("'X-Cosmos-Token'");
    const corpo = BUSCA.slice(i, i + 500);
    expect(corpo).toContain("redirect: 'error'");
  });

  /* O teto do download e conferido ANTES de trazer o corpo para a memoria —
     conferir depois do `arrayBuffer()` e conferir com o arquivo ja inteiro
     dentro do processo, que e o que o teto existe para evitar. */
  it('o tamanho declarado e conferido antes de baixar', () => {
    const i = BUSCA.indexOf('const declarado');
    const j = BUSCA.indexOf('await r.arrayBuffer()');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });
});
