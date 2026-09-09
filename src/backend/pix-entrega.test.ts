import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tipoPagamentoNfce } from './tipo-pagamento-nfce';

/*
 * PIX NA ENTREGA — pago na porta ou no balcão, direto para a loja.
 *
 * Não passa pelo gateway: nada é cobrado no app, nada depende de credencial. E é
 * por isso que ela sobrevive na loja que desligou o pagamento ONLINE, que era o
 * pedido da conveniência — recebe Pix na mão, mas não quer cobrar antes.
 *
 * O RISCO DESTA FORMA NÃO É ELA NÃO FUNCIONAR. É ela funcionar e ser CHAMADA DE
 * OUTRA COISA. `cartao_entrega` foi o molde usado para mapear a superfície, e em
 * quase todo lugar que exibe a forma de pagamento o último ramo do ternário era
 * "Cartão na entrega". Uma forma nova cai nesse ramo sem erro nenhum aparecer:
 * o cupom manda o entregador levar maquininha, a NFC-e sai declarada como
 * crédito, e o fechamento do caixa soma no balde errado. Este arquivo existe
 * para que cada um desses lugares seja uma falha de teste, e não um bilhete
 * errado na porta do cliente.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');

const schema = ler(BACKEND, 'schema-mysql.ts');
const cliente = ler(BACKEND, 'rotas', 'cliente.ts');
const caixa = ler(BACKEND, 'caixa.ts');
const whatsapp = ler(BACKEND, 'whatsapp.ts');
const erp = ler(BACKEND, 'maxxgestao-emitir.ts');
const quando = ler(BACKEND, 'pdvmobi-quando.ts');
const modelos = ler(RAIZ, 'src', 'tipos', 'modelos.ts');

const TELA = (...p: string[]) => ler(RAIZ, 'frontend', 'src', ...p);
const tipos = TELA('types.ts');
const carrinho = TELA('pages', 'cliente', 'carrinho.tsx');
const entregador = TELA('pages', 'entregador', 'index.tsx');

/*
 * OS LUGARES QUE MOSTRAM A FORMA DE PAGAMENTO PARA UMA PESSOA.
 *
 * A lista é explícita, e não um glob, porque o valor dela está em FALHAR quando
 * uma tela nova aparecer: quem adicionar a próxima superfície de exibição
 * precisa vir aqui e decidir o que ela escreve, em vez de herdar um fallback.
 */
const EXIBEM: Array<[string, string]> = [
  ['pedido do cliente', TELA('pages', 'cliente', 'pedido.tsx')],
  ['detalhe no admin', TELA('pages', 'admin', 'pedidos-admin.tsx')],
  ['app do entregador', entregador],
  ['dashboard do lojista', TELA('pages', 'lojista', 'dashboard.tsx')],
  ['painel do lojista', TELA('pages', 'lojista', 'painel.tsx')],
  ['relatorios do lojista', TELA('pages', 'lojista', 'relatorios.tsx')],
  ['WhatsApp', whatsapp],
];

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('a forma existe de ponta a ponta', () => {
  /* O CREATE é IF NOT EXISTS e não alcança banco que já existe: sem a migração,
     o CHECK antigo recusaria o INSERT em produção. */
  it('o CHECK aceita pix_entrega no CREATE e na migração', () => {
    const checks = schema.match(/forma_pagamento IN [(][^)]*[)]/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
    for (const c of checks) expect(c).toContain("'pix_entrega'");
  });

  /*
   * A migração é idempotente por sentinela: ela se pula quando o CHECK atual já
   * cita a forma mais nova. Deixar a sentinela em `cartao_online` faria a
   * migração se considerar feita ANTES de rodar — e o banco antigo continuaria
   * recusando a forma nova, calado.
   */
  it('a sentinela da migração aponta para a forma mais nova', () => {
    const codigo = exec(schema);
    /* A sentinela: banco cuja cláusula não cite a forma mais nova está velho. */
    expect(codigo).toContain(".some(c => !c.clausula.includes('pix_entrega'))");
    /* E não a antiga: `cartao_online` já está em todo banco, então checá-la
       faria a migração se considerar feita antes de rodar. */
    expect(codigo).not.toContain("clausula.includes('cartao_online')");
    /* O ALTER que ela dispara leva a lista completa. */
    expect(codigo).toContain('ALTER TABLE pedidos MODIFY forma_pagamento');
  });

  it('o pedido aceita a forma', () => {
    expect(exec(cliente)).toContain("['pix', 'dinheiro', 'cartao_entrega', 'cartao_online', 'pix_entrega']");
  });

  /*
   * E NÃO É COBRADA ANTES. `pagoAntes` decide se o sistema gera cobrança no
   * gateway e se o pedido nasce pago. Pix na porta não passa por gateway
   * nenhum: entrar aqui seria o cliente esperando um QR que nunca vem.
   */
  it('não conta como pago antes de sair', () => {
    const codigo = exec(cliente);
    expect(codigo).toContain("const pixOnline = formaPagamento === 'pix';");
    expect(codigo).toContain("const cartaoOnline = formaPagamento === 'cartao_online';");
    expect(codigo).toContain('const pagoAntes = pixOnline || cartaoOnline;');
    /* A prova negativa: nenhuma das três linhas acima cita a forma nova. */
    const i = codigo.indexOf('const pixOnline');
    const f = codigo.indexOf('const pagoAntes') + 60;
    expect(codigo.slice(i, f)).not.toContain('pix_entrega');
  });

  it('o tipo está declarado nas duas metades', () => {
    expect(modelos).toContain("'cartao_online' | 'pix_entrega'");
    expect(tipos).toContain("'cartao_online' | 'pix_entrega'");
  });
});

describe('a loja sem pagamento online continua oferecendo', () => {
  /*
   * ESTE É O MOTIVO DA FORMA EXISTIR. O filtro tira as formas que dependem do
   * gateway. Filtrar por "tem pix no nome" tiraria justamente a forma que a
   * conveniência mais usa, e ela ficaria só com dinheiro e maquininha.
   */
  it('o filtro tira pix e cartão online, e não a forma da porta', () => {
    const codigo = exec(carrinho);
    expect(codigo).toContain("PAGAMENTOS.filter(p => p.id !== 'pix' && p.id !== 'cartao_online')");
    const i = codigo.indexOf('PAGAMENTOS.filter');
    expect(codigo.slice(i, i + 120)).not.toContain('pix_entrega');
  });

  /* O informativo era o pedido literal: quem escolhe precisa ler onde paga. */
  it('a opção aparece no checkout, com o informativo', () => {
    const codigo = exec(carrinho);
    const i = codigo.indexOf("id: 'pix_entrega'");
    expect(i).toBeGreaterThan(-1);
    const bloco = codigo.slice(i, i + 260);
    expect(bloco).toContain("label: 'Pix na entrega'");
    expect(bloco).toContain('direto para a loja');
  });
});

describe('o dinheiro cai no lugar certo', () => {
  /*
   * A NFC-E. O último `return` daquele arquivo é `cartao_credito` — o fallback
   * que existe porque `cartao_entrega` não diz se foi crédito ou débito. Sem um
   * ramo próprio, todo Pix pago na porta sairia na nota como cartão de crédito:
   * o defeito exato que aquele arquivo foi criado para consertar, repetido numa
   * forma nova.
   */
  it('a NFC-e sai como Pix, sem palpite', () => {
    expect(tipoPagamentoNfce('pix_entrega')).toEqual({ tipo: 'pix', ehPalpite: false });
    /* E o palpite continua sendo só do cartão na porta. */
    expect(tipoPagamentoNfce('cartao_entrega').ehPalpite).toBe(true);
  });

  /*
   * O FECHAMENTO DO CAIXA. Os baldes são pix / dinheiro / cartão, e o cartão é o
   * `else` — quem não é pix nem dinheiro vira cartão. O Pix da porta apareceria
   * como cartão no fechamento, e a conferência do lojista nunca bateria.
   */
  it('o caixa soma no balde do Pix', () => {
    const codigo = exec(caixa);
    expect(codigo).toMatch(/forma_pagamento === 'pix' [|][|] v[.]forma_pagamento === 'pix_entrega'/);
  });

  /*
   * O ERP. Sem forma correspondente o documento vai sem pagamento. Pix recebido
   * na mão é recebimento MANUAL, que é o que "PIX - MANUAL" descreve — aqui não
   * há palpite a dar, diferente de `cartao_entrega`, que fica fora de propósito.
   */
  it('o ERP reconhece a forma, com os apelidos do Pix', () => {
    const codigo = exec(erp);
    const i = codigo.indexOf('pix_entrega:');
    expect(i).toBeGreaterThan(-1);
    expect(codigo.slice(i, i + 200)).toContain("'pix - manual'");
    /* E o cartão na porta continua FORA, que é a decisão antiga. */
    expect(codigo).not.toContain('cartao_entrega: [');
  });

  /*
   * A MAQUININHA NÃO É ACIONADA. Só `cartao_entrega` passa por ela; um Pix
   * lançado na maquininha seria uma cobrança de cartão que ninguém pediu.
   */
  it('não entra na maquininha', () => {
    expect(exec(quando)).toContain("if (c.formaPagamento !== 'cartao_entrega') return false;");
  });
});

describe('ninguém lê "Cartão na entrega" para um Pix', () => {
  /*
   * O PONTO INTEIRO DESTE ARQUIVO. Em cada tela que exibe a forma, o rótulo era
   * um ternário cujo último ramo era "Cartão na entrega". Uma forma nova cai
   * nele calada — e o cupom impresso manda o entregador levar maquininha para
   * cobrar um Pix.
   */
  it.each(EXIBEM)('%s escreve a forma nova', (_nome, fonte) => {
    expect(exec(fonte)).toContain('pix_entrega');
  });

  /*
   * E NENHUMA DELAS USA A MAQUININHA COMO FALLBACK. A checagem é estrutural: a
   * linha que escreve esse texto tem que ser o ramo do cartão, comparando com
   * `cartao_entrega` ali mesmo. Ternário que cai nele por descarte falha aqui.
   */
  it.each(EXIBEM)('%s não usa a maquininha como fallback', (_nome, fonte) => {
    for (const linha of exec(fonte).split('\n')) {
      if (!linha.includes('Cartão na entrega')) continue;
      expect(linha).toContain('cartao_entrega');
    }
  });

  /*
   * E O ENTREGADOR DISTINGUE PAGO DE A COBRAR. "Pix" para os dois casos é como
   * ele cobra de novo um pedido que o cliente já pagou no app — ou entrega de
   * graça um que não foi pago. As duas versões acabam na porta do cliente.
   */
  it('o app do entregador separa o Pix pago do Pix a cobrar', () => {
    const codigo = exec(entregador);
    expect(codigo).toContain('Pix (pago online)');
    expect(codigo).toContain('Pix na entrega — COBRAR');
    /* E o tipo da corrida admite as formas que a tela agora escreve. */
    expect(codigo).toContain("'cartao_online' | 'pix_entrega'");
  });

  /* O cupom impresso também diz COBRAR — e dashboard e painel têm cada um a sua
     cópia da função de impressão, então os dois precisam da linha. */
  it.each([
    ['dashboard', TELA('pages', 'lojista', 'dashboard.tsx')],
    ['painel', TELA('pages', 'lojista', 'painel.tsx')],
  ])('o cupom do %s manda cobrar', (_nome, fonte) => {
    expect(exec(fonte)).toContain("'Pix na entrega — COBRAR'");
  });
});
