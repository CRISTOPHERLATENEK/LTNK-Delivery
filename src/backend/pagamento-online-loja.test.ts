import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * "TER CREDENCIAL" NÃO É "QUERER RECEBER ONLINE".
 *
 * Os dois eram a mesma coisa no código, e não são. `getTokenMP` cai no token do
 * Mercado Pago da PLATAFORMA quando a loja não tem o próprio — então QUALQUER
 * loja aprovada passava a oferecer Pix e cartão online, sem ter pedido, e o
 * dinheiro cairia na conta da plataforma em vez da dela.
 *
 * O caso concreto: a Galderio é uma conveniência com foco em bebidas e só cobra
 * na entrega ou na retirada. O checkout dela oferecia "Pix online" e "Cartão
 * online" porque a lista de formas de pagamento da tela era FIXA — as quatro,
 * em toda loja, sempre.
 *
 * Agora existe `lojas.pagamento_online`, ligado por padrão (quem já vende
 * online continua vendendo), com o servidor como autoridade e a tela deixando
 * de oferecer o que vai ser recusado.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const pagamentos = fs.readFileSync(path.join(BACKEND, 'rotas', 'pagamentos.ts'), 'utf8');
const publico = fs.readFileSync(path.join(BACKEND, 'rotas', 'publico.ts'), 'utf8');
const lojista = fs.readFileSync(path.join(BACKEND, 'rotas', 'lojista.ts'), 'utf8');
const schema = fs.readFileSync(path.join(BACKEND, 'schema-mysql.ts'), 'utf8');
const carrinho = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'cliente', 'carrinho.tsx'), 'utf8');
const config = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'lojista', 'loja-config.tsx'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('o servidor é a autoridade', () => {
  const codigo = exec(pagamentos);

  it('o teste está lendo o arquivo certo', () => {
    expect(codigo).toContain('export async function pagamentoOnlineAtivo');
    expect(codigo).toContain('export async function cartaoOnlineAtivo');
  });

  it('existe uma função só para a vontade da loja', () => {
    expect(codigo).toContain('export async function lojaQuerPagamentoOnline');
    expect(codigo).toContain('SELECT pagamento_online FROM lojas WHERE id = ?');
  });

  /*
   * O INTERRUPTOR VEM ANTES DA CREDENCIAL nas duas portas. Sem isso, uma
   * requisição forjada com `forma_pagamento: pix` numa loja que não recebe
   * online geraria cobrança — na conta da plataforma.
   */
  it('Pix online respeita o interruptor antes de olhar o gateway', () => {
    const fn = codigo.slice(codigo.indexOf('export async function pagamentoOnlineAtivo'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('lojaQuerPagamentoOnline');
    const iInterruptor = corpo.indexOf('lojaQuerPagamentoOnline');
    const iGateway = corpo.indexOf('gatewayDaLoja');
    expect(iInterruptor).toBeGreaterThan(-1);
    expect(iInterruptor).toBeLessThan(iGateway);
  });

  it('cartão online respeita o interruptor antes de olhar o token', () => {
    const fn = codigo.slice(codigo.indexOf('export async function cartaoOnlineAtivo'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('lojaQuerPagamentoOnline');
    expect(corpo.indexOf('lojaQuerPagamentoOnline')).toBeLessThan(corpo.indexOf('tokenProprioMP'));
  });

  /*
   * BANCO SEM A MIGRAÇÃO CONTA COMO LIGADO — é o padrão da coluna. Tratar nulo
   * como desligado faria toda loja parar de receber online no primeiro deploy,
   * que é o oposto de uma mudança segura.
   */
  it('coluna nula conta como ligado', () => {
    const fn = codigo.slice(codigo.indexOf('export async function lojaQuerPagamentoOnline'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('pagamento_online ?? 1');
  });

  /* E loja que não existe não recebe. */
  it('loja inexistente não recebe', () => {
    const fn = codigo.slice(codigo.indexOf('export async function lojaQuerPagamentoOnline'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('if (!row) return false;');
  });
});

describe('a tela deixa de oferecer o que seria recusado', () => {
  it('o checkout filtra as formas pela loja', () => {
    const codigo = exec(carrinho);
    expect(codigo).toContain('const formasOferecidas = pagamentoOnline');
    expect(codigo).toContain("p.id !== 'pix' && p.id !== 'cartao_online'");
    /* E a lista renderizada é a filtrada, não a fixa. */
    expect(codigo).toContain('{formasOferecidas.map(p => (');
    expect(codigo).not.toContain('{PAGAMENTOS.map(p => (');
  });

  /*
   * A ESCOLHA INICIAL SEGUE O QUE ESTÁ OFERECIDO. Nascia em `'pix'` fixo — numa
   * loja sem pagamento online o pedido sairia com uma forma que nem aparece na
   * tela, e o cliente veria "escolha uma forma válida" sem saber o que escolheu
   * errado.
   */
  /*
   * O `useState` SOZINHO NÃO RESOLVE, e foi o defeito que chegou como "não
   * consigo pedir".
   *
   * O inicializador roda UMA VEZ, na primeira renderização — e nela a resposta
   * da loja ainda não chegou, então `pagamentoOnline` é o padrão `true` e a
   * escolha nasce `'pix'`. Quando a resposta chega dizendo que a loja não recebe
   * online, a lista perde o Pix mas a ESCOLHA continua nele: nenhum botão
   * aparece marcado e finalizar manda uma forma que o servidor recusa.
   *
   * Estado derivado de dado que chega depois precisa de correção depois.
   */
  it('a escolha é corrigida quando a resposta da loja chega', () => {
    const codigo = exec(carrinho);
    expect(codigo).toContain('if (formasOferecidas.some(f => f.id === pagamento)) return;');
    expect(codigo).toContain("setPagamento(formasOferecidas[0]?.id ?? 'dinheiro')");
    /* Dentro de um efeito, não no corpo do render: `setState` no render é laço. */
    const iEfeito = codigo.indexOf('useEffect(() => {\n    if (formasOferecidas.some');
    expect(iEfeito).toBeGreaterThan(0);
  });

  /* E o clique do cliente NÃO é desfeito: o efeito só age quando a escolha
     atual saiu da lista. */
  it('não sobrescreve a escolha do cliente', () => {
    const codigo = exec(carrinho);
    const i = codigo.indexOf('if (formasOferecidas.some(f => f.id === pagamento)) return;');
    expect(codigo.slice(i, i + 200)).toContain('return;');
  });

  /*
   * AUSENTE CONTA COMO LIGADO. Enquanto a resposta da loja não chega é melhor
   * mostrar e o servidor recusar do que esconder de uma loja que aceita.
   */
  it('sem resposta ainda, assume ligado', () => {
    expect(exec(carrinho)).toContain('loja.pagamento_online !== 0');
  });

  it('a loja publica a flag', () => {
    expect(exec(publico)).toContain('aceita_retirada, pagamento_online');
  });
});

describe('o interruptor no painel do lojista', () => {
  /*
   * ELE MORA NA TELA DE PAGAMENTOS, e mudou de lugar depois de eu errar.
   *
   * Nasceu ao lado de "Aceitar retirada no local", na seção de ENTREGA — outro
   * assunto. O resultado: a tela de Pagamentos mostrava "Pix não configurado" e
   * o formulário de credencial inteiro numa loja que não recebe online, sem
   * dizer por quê nem onde mudar. Convite para colar um token do Mercado Pago e
   * descobrir depois que o checkout nunca ofereceu Pix.
   */
  it('existe e diz o que muda', () => {
    expect(config).toContain('Aceitar pagamento online');
    expect(config).toContain('só paga na entrega ou na retirada');
  });

  it('está na tela de Pagamentos, antes da configuração', () => {
    const codigo = exec(config);
    const iTela = codigo.indexOf('export function PagamentosLoja()');
    const iInterruptor = codigo.indexOf('<InterruptorPagamentoOnline');
    const iAbas = codigo.indexOf("id: 'pix' as const");
    expect(iTela).toBeGreaterThan(0);
    expect(iInterruptor).toBeGreaterThan(iTela);
    expect(iInterruptor).toBeLessThan(iAbas);
  });

  /* E NÃO ficou também na seção de entrega: dois interruptores para a mesma
     coluna no mesmo painel é a próxima confusão. */
  it('saiu da seção de entrega', () => {
    const codigo = exec(config);
    expect(codigo).not.toContain('pagamento_online: form.pagamento_online');
    expect(codigo).not.toContain('f.pagamento_online');
  });

  /*
   * DESLIGADO, A CONFIGURAÇÃO NEM APARECE. É o pedido do lojista, e a razão é
   * concreta: configurar o que o checkout não oferece é trabalho jogado fora.
   */
  it('desligado, esconde a configuração de Pix e cartão', () => {
    const codigo = exec(config);
    expect(codigo).toContain('{!estado.pagamento_online ? null : (<>');
    /* A porta vem ANTES das abas de Pix/cartão. */
    const iPorta = codigo.indexOf('{!estado.pagamento_online ? null : (<>');
    expect(iPorta).toBeLessThan(codigo.indexOf("id: 'pix' as const"));
  });

  /* A tela precisa RECEBER a flag, senão ela adivinha. */
  it('o payload de pagamentos devolve a flag', () => {
    expect(exec(lojista)).toContain('pagamento_online: Number(row?.pagamento_online ?? 1) === 1');
  });

  /* Salva na hora: interruptor de duas posições com efeito imediato no
     checkout não combina com um "Salvar" separado. */
  it('salva no clique, sem botão de salvar', () => {
    const fn = config.slice(config.indexOf('function InterruptorPagamentoOnline'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain("api('PUT', '/api/lojista/loja', { pagamento_online: novo })");
    expect(corpo).toContain('if (!novo && !window.confirm(');
  });

  /*
   * PUT PARCIAL NÃO DESLIGA POR OMISSÃO. Esta tela salva vários blocos, e um
   * corpo sem o campo tem que MANTER o que está — não zerar.
   */
  it('a rota mantém o valor quando o campo não vem', () => {
    const codigo = exec(lojista);
    expect(codigo).toContain('req.body.pagamento_online !== undefined');
    expect(codigo).toContain('pagamento_online?: number }).pagamento_online ?? 1');
  });

  it('e grava na coluna', () => {
    expect(exec(lojista)).toContain('pagamento_online = ?');
  });
});

describe('o interruptor no painel do ADMIN', () => {
  const admin = fs.readFileSync(path.join(BACKEND, 'rotas', 'admin.ts'), 'utf8');
  const lojas = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');
  const detalhe = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'loja-detalhe.tsx'), 'utf8');

  /*
   * O DONO DA PLATAFORMA PRECISA DESLIGAR SEM ENTRAR COMO LOJISTA. Só no painel
   * do lojista, atender um pedido de cliente exigiria impersonar a loja dele.
   */
  it('existe rota própria, só para super admin', () => {
    expect(exec(admin)).toContain("router.put('/lojas/:id/pagamento-online', exigirSuperAdmin");
  });

  /*
   * ROTA PRÓPRIA, E NÃO UMA ENTRADA NO MAPA DE MÓDULOS. `vendas` e `fiscal` são
   * decisão comercial (o que o cliente contratou) e o painel dele mostra
   * "bloqueado". Pagamento online é ajuste da loja. No mapa, o log diria
   * "módulo bloqueado" para algo que ninguém contratou, e o bloco "Módulos
   * contratados" passaria a mentir sobre o que lista.
   */
  it('não entra no mapa de módulos', () => {
    const i = exec(admin).indexOf('const COLUNA_DO_MODULO');
    const mapa = exec(admin).slice(i, i + 260);
    expect(mapa).toContain("vendas: 'vendas_liberado'");
    expect(mapa).not.toContain('pagamento_online');
  });

  it('grava a coluna e registra na auditoria', () => {
    const codigo = exec(admin);
    expect(codigo).toContain("UPDATE lojas SET pagamento_online = ? WHERE id = ?");
    expect(codigo).toContain("'loja.pagamento_online'");
  });

  /* O painel da loja precisa DEVOLVER o valor, senão o interruptor não sabe em
     que estado nasce. */
  it('o painel da loja devolve a flag', () => {
    expect(exec(admin)).toContain('l.pagamento_online,');
  });

  it('a tela tem o interruptor na aba de configuração', () => {
    expect(lojas).toContain('export function PagamentoOnlineEditor');
    expect(detalhe).toContain('<PagamentoOnlineEditor');
    expect(detalhe).toContain('ativo={l.pagamento_online !== 0}');
  });

  /*
   * SÓ DESLIGAR PERGUNTA. Ligar não tira nada de ninguém; desligar remove duas
   * formas de pagamento de uma loja que pode estar vendendo agora — e quem
   * clica no admin está vendo a loja de fora, sem saber se tem pedido em
   * andamento.
   */
  it('desligar pede confirmação', () => {
    const fn = lojas.slice(lojas.indexOf('export function PagamentoOnlineEditor'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain('if (!novo && !window.confirm(');
    expect(corpo).toContain('Desligar o pagamento online de');
  });

  /*
   * E A TELA DIZ QUE O LOJISTA TAMBÉM MEXE. Sem isso, quem desliga aqui espera
   * que fique desligado para sempre, e vai achar que o sistema desobedeceu no
   * dia em que o cliente religar.
   */
  it('avisa que os dois painéis escrevem a mesma coisa', () => {
    expect(lojas).toContain('O lojista também liga e desliga isto no painel dele');
  });
});

describe('a coluna nova tem migração', () => {
  /* O CREATE é IF NOT EXISTS e não alcança banco que já existe. */
  it('pagamento_online está no laço de ALTER, ligado por padrão', () => {
    expect(schema).toMatch(/\['lojas', 'pagamento_online', 'pagamento_online TINYINT NOT NULL DEFAULT 1'\]/);
  });

  /* Comentário dentro de template literal de SQL não pode ter crase — erro que
     eu cometi três vezes nesta sessão. */
  it('o comentário do schema não usa crase', () => {
    const i = schema.indexOf('PAGAMENTO ONLINE (Pix e cartao)');
    expect(i).toBeGreaterThan(-1);
    expect(schema.slice(i, i + 800)).not.toContain('`');
  });
});

describe('os segmentos de loja', () => {
  const segmentos = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'lib', 'segmentos.ts'), 'utf8');
  const tenants = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'tenants.tsx'), 'utf8');

  /*
   * A LISTA DEIXOU DE SER SÓ COMIDA. Eram dez opções, todas restaurante,
   * lanchonete ou doce — o primeiro cliente que não vende comida ficou em
   * "Outros", que é o balde de quem não foi previsto.
   */
  it('tem conveniência e bebida', () => {
    for (const s of ['Conveniência', 'Adega', 'Distribuidora de bebidas', 'Mercado', 'Tabacaria']) {
      expect(segmentos, s).toContain(`'${s}'`);
    }
  });

  it('e continua tendo as de comida', () => {
    for (const s of ['Pizzaria', 'Hamburgueria', 'Restaurante', 'Lanchonete']) {
      expect(segmentos, s).toContain(`'${s}'`);
    }
  });

  /*
   * UMA LISTA, DUAS TELAS. O admin escolhe no cadastro e o lojista troca depois.
   * Antes só o admin tinha sugestão, e a do lojista era um `placeholder` com
   * três exemplos de comida — as duas discordando sobre o que a plataforma
   * atende.
   */
  it('as duas telas usam a mesma lista', () => {
    for (const [nome, fonte] of [['tenants', tenants], ['loja-config', config]] as const) {
      expect(fonte, nome).toContain("from '@/lib/segmentos'");
      expect(fonte, nome).toContain('SEGMENTOS_SUGERIDOS.map');
      expect(fonte, nome).toContain('ID_LISTA_SEGMENTOS');
    }
  });

  /* E nenhuma delas mantém uma cópia própria da lista. */
  it('nenhuma tela tem a lista copiada', () => {
    for (const [nome, fonte] of [['tenants', tenants], ['loja-config', config]] as const) {
      expect(exec(fonte), nome).not.toMatch(/\['Pizzaria', 'Hamburgueria'/);
    }
  });

  /* O campo continua texto livre: segmento que ninguém previu se digita. */
  it('o campo segue aceitando texto livre', () => {
    expect(segmentos).toContain('Sugestão, não lista fechada');
    expect(tenants).toContain('list={ID_LISTA_SEGMENTOS}');
    expect(config).toContain('list={ID_LISTA_SEGMENTOS}');
  });
});
