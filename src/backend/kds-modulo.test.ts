import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { rotuloPreparando, avisoPreparando } from './rotulo-preparo';

/*
 * KDS LIGA E DESLIGA POR LOJA — E O RÓTULO DO STATUS SEGUE.
 *
 * "Preparando" pressupõe cozinha. Numa conveniência ninguém prepara nada:
 * separa da prateleira. O cliente lendo "preparando seu pedido" para uma
 * garrafa de cerveja fica esperando um preparo que não existe — e o painel de
 * cozinha ali é uma tela que nunca abre.
 *
 * A MESMA PERGUNTA RESOLVE OS DOIS: a loja tem KDS? Por isso o rótulo deriva de
 * `kds_liberado` em vez de ser um campo de texto para o lojista preencher —
 * campo livre seria mais um lugar para desatualizar, e a decisão real já está
 * tomada em outro lugar.
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const admin = fs.readFileSync(path.join(BACKEND, 'rotas', 'admin.ts'), 'utf8');
const cozinha = fs.readFileSync(path.join(BACKEND, 'rotas', 'cozinha.ts'), 'utf8');
const cliente = fs.readFileSync(path.join(BACKEND, 'rotas', 'cliente.ts'), 'utf8');
const notificacoes = fs.readFileSync(path.join(BACKEND, 'notificacoes.ts'), 'utf8');
const schema = fs.readFileSync(path.join(BACKEND, 'schema-mysql.ts'), 'utf8');
const regraServidor = fs.readFileSync(path.join(BACKEND, 'rotulo-preparo.ts'), 'utf8');
const regraTela = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'lib', 'rotulo-preparo.ts'), 'utf8');
const painel = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'lojista', 'painel.tsx'), 'utf8');
const lojasAdmin = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');
const telaPedido = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'cliente', 'pedido.tsx'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('o rótulo do preparo', () => {
  it('com cozinha, prepara; sem cozinha, separa', () => {
    expect(rotuloPreparando(true)).toBe('Preparando');
    expect(rotuloPreparando(false)).toBe('Em separação');
  });

  /* O emoji acompanha: chapéu de cozinheiro contradiz "separando" no mesmo
     balão de notificação. */
  it('o aviso e o emoji acompanham', () => {
    expect(avisoPreparando(true)).toContain('Preparando');
    expect(avisoPreparando(true)).toContain('👨‍🍳');
    expect(avisoPreparando(false)).toContain('Separando');
    expect(avisoPreparando(false)).toContain('🛍️');
  });

  /*
   * AS DUAS CÓPIAS DA REGRA ANDAM JUNTAS.
   *
   * O servidor precisa dela para a notificação que ele mesmo envia; a tela
   * precisa para o acompanhamento. Duas versões divergindo é como o cliente
   * recebe "Preparando" no WhatsApp e lê "Em separação" na tela do pedido — e
   * ninguém descobre, porque cada metade parece certa sozinha.
   *
   * A comparação ignora a linha que cada arquivo usa para apontar para o outro.
   */
  it('a cópia do frontend é idêntica à do servidor', () => {
    const semReferencia = (t: string) =>
      t.split('\n').filter(l => !l.includes('rotulo-preparo.ts`')).join('\n');
    expect(semReferencia(regraTela)).toBe(semReferencia(regraServidor));
  });
});

describe('o módulo no painel do admin', () => {
  /*
   * O KDS É MÓDULO de verdade — uma TELA que a loja tem ou não, com login
   * próprio. Diferente de `pagamento_online`, que é ajuste e ficou fora do
   * mapa justamente para o log não dizer "módulo bloqueado" para algo que
   * ninguém contratou.
   */
  it('entra no mapa de módulos', () => {
    const codigo = exec(admin);
    const i = codigo.indexOf('const COLUNA_DO_MODULO');
    const mapa = codigo.slice(i, i + 300);
    expect(mapa).toContain("kds: 'kds_liberado'");
    /* E o pagamento online continua FORA dele. */
    expect(mapa).not.toContain('pagamento_online');
  });

  it('o estado dos módulos devolve o KDS, e nulo conta como ligado', () => {
    const codigo = exec(admin);
    expect(codigo).toContain('vendas_liberado, fiscal_liberado, kds_liberado, canal_versao');
    expect(codigo).toContain('kds: Number(l.kds_liberado ?? 1) === 1 ? 1 : 0');
  });

  it('a tela lista o módulo e avisa o que muda para o cliente', () => {
    expect(lojasAdmin).toContain("chave: 'kds' as const");
    expect(lojasAdmin).toContain('Cozinha (KDS)');
    /* O aviso do confirm diz a consequência que não é obvia: muda o texto que o
       CLIENTE lê, não só a aba do lojista. */
    expect(lojasAdmin).toContain('Em separação" em vez de "Preparando');
  });
});

describe('desligado, a porta fecha no servidor', () => {
  /*
   * ESCONDER A ABA É CORTESIA. O tablet da cozinha entra pelo login próprio da
   * cozinha e continuaria entrando — loja que desligou o KDS não deve ter um
   * tablet mostrando pedido.
   */
  it('o login da cozinha recusa quando o módulo está desligado', () => {
    const codigo = exec(cozinha);
    expect(codigo).toContain('COALESCE(l.kds_liberado, 1) AS kds_liberado');
    expect(codigo).toContain('Number(conta.kds_liberado ?? 1) !== 1');
    expect(codigo).toContain('O painel de cozinha está desativado para esta loja.');
  });

  /*
   * E A MENSAGEM DIZ QUE FOI A LOJA. "E-mail ou senha incorretos" deixaria quem
   * está no tablet tentando a senha de novo, sem chance de adivinhar.
   */
  it('a recusa vem depois do bloqueio da conta, com motivo próprio', () => {
    const codigo = exec(cozinha);
    const iBloqueio = codigo.indexOf('Este acesso da cozinha foi desativado.');
    const iModulo = codigo.indexOf('O painel de cozinha está desativado para esta loja.');
    expect(iBloqueio).toBeGreaterThan(0);
    expect(iModulo).toBeGreaterThan(iBloqueio);
  });
});

describe('a aba desaparece nos DOIS lugares', () => {
  /*
   * A sidebar e o "Mais" são componentes diferentes, cada um com a própria
   * lista. Filtrar num e não no outro esconde a aba de um lado e a oferece do
   * outro — pior que não esconder em nenhum.
   */
  it('sidebar e menu "Mais" respeitam o módulo', () => {
    const codigo = exec(painel);
    const vezes = (codigo.match(/temKds \? \[\{ rota: '\/lojista\/cozinha-equipe'/g) ?? []).length;
    expect(vezes).toBe(2);
  });

  /* `?? 1`: o KDS nasce LIGADO, então banco sem a migração não esconde a aba de
     ninguém. `?? 0` faria todo mundo perder a tela no primeiro deploy. */
  it('ausente conta como ligado', () => {
    const codigo = exec(painel);
    expect((codigo.match(/kds_liberado \?\? 1/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(codigo).not.toContain('kds_liberado ?? 0');
  });
});

describe('o cliente lê o rótulo certo', () => {
  it('o pedido carrega se a loja tem KDS', () => {
    expect(exec(cliente)).toContain('COALESCE(l.kds_liberado, 1) AS loja_kds');
  });

  it('a tela do pedido troca o rótulo e o ícone', () => {
    const codigo = exec(telaPedido);
    expect(codigo).toContain('rotuloPreparando(temKds)');
    /* O ícone acompanha: chapéu de cozinheiro contradiz "Em separação". */
    expect(codigo).toContain('preparando: temKds ? ChefHat : ShoppingBag');
    /* E os usos passaram para o mapa derivado, não o fixo. */
    expect(codigo).not.toContain('ROTULOS_STATUS[pedido.status]');
    expect(codigo).not.toContain('ICONES_STATUS[s]');
  });

  /*
   * A NOTIFICAÇÃO TAMBÉM. Ela é enviada pelo servidor, sem passar pela tela —
   * consertar só o acompanhamento deixaria o cliente recebendo "está sendo
   * preparado" no WhatsApp e lendo "Em separação" ao abrir o pedido.
   */
  it('a notificação segue o mesmo rótulo', () => {
    const codigo = exec(notificacoes);
    expect(codigo).toContain('COALESCE(l.kds_liberado, 1) AS kds_liberado');
    expect(codigo).toContain('está sendo separado');
    expect(codigo).toContain('avisoPreparando(temKds)');
  });
});

describe('a coluna nova tem migração', () => {
  /* O CREATE é IF NOT EXISTS e não alcança banco que já existe. */
  it('kds_liberado está no laço de ALTER, ligado por padrão', () => {
    expect(schema).toMatch(/\['lojas', 'kds_liberado', 'kds_liberado TINYINT NOT NULL DEFAULT 1'\]/);
  });

  /* Comentário dentro de template literal de SQL não pode ter crase — erro que
     eu cometi três vezes nesta sessão. */
  it('o comentário do schema não usa crase', () => {
    const i = schema.indexOf('KDS (painel de cozinha) LIBERADO');
    expect(i).toBeGreaterThan(-1);
    expect(schema.slice(i, i + 600)).not.toContain('`');
  });
});
