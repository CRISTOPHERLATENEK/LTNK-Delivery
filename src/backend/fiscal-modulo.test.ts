/**
 * O MÓDULO FISCAL É LIBERADO PELA PLATAFORMA, LOJA POR LOJA.
 *
 * Testes de FONTE, como os outros desta família: o que precisa ser garantido
 * aqui é estrutural — existe uma guarda no prefixo, ela cobre as 17 rotas de
 * uma vez, e a auto-emissão a respeita. Um teste de comportamento por rota
 * garantiria menos e não pegaria a rota nova que alguém escrever amanhã.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const lojista = semComentarios(
  fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8'));
const admin = semComentarios(
  fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8'));
const schema = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf8');

describe('a plataforma libera o fiscal loja por loja', () => {
  it('a coluna existe e nasce DESLIGADA', () => {
    /*
     * Nascer 1 daria a toda loja nova uma aba pedindo certificado A1 que ela
     * não contratou.
     */
    expect(schema).toContain("['lojas', 'fiscal_liberado', 'fiscal_liberado TINYINT NOT NULL DEFAULT 0']");
  });

  it('o backfill liga para quem JÁ usava, e roda uma vez só', () => {
    /*
     * Sem o backfill, o deploy tiraria do ar a emissão de quem tem nota
     * autorizada em produção. Sem a marca, um bloqueio feito de propósito
     * voltaria sozinho no deploy seguinte.
     */
    const i = schema.indexOf('mig_fiscal_liberado');
    expect(i).toBeGreaterThan(0);
    const t = schema.slice(i - 400, i + 900);
    expect(t).toMatch(/UPDATE lojas SET fiscal_liberado = 1/);
    expect(t).toMatch(/nfce_ativo = 1 OR/);
    expect(t).toMatch(/INSERT INTO configuracoes/);
  });

  it('UMA guarda no prefixo /nfce, não um if por rota', () => {
    /*
     * São 17 rotas hoje. "Um if por rota" é como o pedido 88 saiu sem cobrança
     * nenhuma: o ponto único que não era único. A guarda no prefixo cobre a
     * próxima rota sem ninguém lembrar dela.
     */
    const i = lojista.indexOf("router.use('/nfce'");
    expect(i).toBeGreaterThan(0);
    const t = lojista.slice(i, i + 900);
    expect(t).toMatch(/fiscal_liberado/);
    expect(t).toContain('erroHttp(403');
  });

  it('a guarda vem ANTES da primeira rota /nfce', () => {
    /* Depois dela, o Express não a aplicaria às que já foram registradas — e a
       guarda passaria a proteger só metade das rotas, silenciosamente. */
    const guarda = lojista.indexOf("router.use('/nfce'");
    const primeira = lojista.search(/router\.(get|post|put|delete)\('\/nfce/);
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(primeira);
  });

  it('a auto-emissão da entrega respeita o bloqueio', () => {
    /*
     * Esta é a que morde de verdade: sem ela, bloquear no admin esconderia a
     * aba e a nota continuaria saindo a cada "Já entreguei", porque
     * `nfce_ativo = 1` ficou guardado de quando estava liberado.
     */
    const i = lojista.indexOf('export async function emitirNfcePedido');
    expect(i).toBeGreaterThan(0);
    expect(lojista.slice(i, i + 700)).toContain('!loja.fiscal_liberado');
  });

  /*
   * A ROTA VIROU GENÉRICA quando apareceu o SEGUNDO módulo (vendas).
   *
   * Era `PUT /lojas/:id/fiscal/liberado`. Uma rota por módulo duplicaria também
   * a chance de uma delas esquecer o `exigirSuperAdmin` — que é a única coisa
   * separando "a plataforma decide" de "qualquer admin decide".
   */
  it('só o super admin liga e desliga', () => {
    /*
     * A asserção olha a LINHA DE REGISTRO, não uma janela em volta dela.
     * Testado antes com `slice(i, i + 700)`, o teste passava mesmo depois de eu
     * tirar o `exigirSuperAdmin` da rota: o da rota SEGUINTE caía na janela e
     * satisfazia a busca.
     */
    const linha = admin.split('\n').find(l => l.includes("router.put('/lojas/:id/modulo/:modulo'"));
    expect(linha).toBeDefined();
    expect(linha).toContain('exigirSuperAdmin');
  });

  it('o nome do módulo NÃO vai da requisição para o SQL', () => {
    /*
     * `req.params.modulo` monta um nome de coluna. Sem a lista fechada, seria
     * injeção de identificador — e nenhum `?` protege nome de coluna.
     */
    const i = admin.indexOf('const COLUNA_DO_MODULO');
    expect(i).toBeGreaterThan(0);
    const mapa = admin.slice(i, admin.indexOf('};', i));
    expect(mapa).toContain("vendas: 'vendas_liberado'");
    expect(mapa).toContain("fiscal: 'fiscal_liberado'");
    const rota = admin.slice(admin.indexOf("router.put('/lojas/:id/modulo/:modulo'"), admin.indexOf("router.put('/lojas/:id/modulo/:modulo'") + 900);
    expect(rota).toContain('COLUNA_DO_MODULO[String(req.params.modulo)]');
    expect(rota).toMatch(/if \(!coluna\)/);
  });

  it('a rota é SEPARADA do formulário do emitente', () => {
    /*
     * O `PUT .../fiscal` exige o cadastro fiscal válido, e o cliente que a
     * gente mais precisa poder desligar é o de cadastro pela metade.
     */
    const form = admin.indexOf("router.put('/lojas/:id/fiscal'");
    expect(admin.slice(form, form + 1500)).not.toContain('fiscal_liberado');
  });

  it('UM interruptor por módulo, não dois pro mesmo campo', () => {
    /*
     * O bloco fiscal do admin tinha o seu próprio interruptor antes de existir
     * "Módulos contratados". Dois controles para o mesmo campo fazem a pessoa
     * mexer num e conferir no outro.
     */
    const tela = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');
    expect(tela).not.toContain('/fiscal/liberado');
    expect((tela.match(/modulo\/\$\{chave\}/g) ?? []).length).toBe(1);
  });

  it('bloquear NÃO apaga certificado, CSC nem numeração', () => {
    /* Mudança de plano não pode destruir documento fiscal — nem, agora que a
       rota é genérica, o histórico de vendas de quem perder o módulo de PDV. */
    const i = admin.indexOf("router.put('/lojas/:id/modulo/:modulo'");
    const t = admin.slice(i, i + 900);
    expect(t).not.toMatch(/nfce_csc|nfce_cert|DELETE|unlink|proximo_numero/);
  });

  it('o admin lê o estado junto da config, sem uma segunda chamada', () => {
    const i = admin.indexOf("router.get('/lojas/:id/fiscal'");
    expect(admin.slice(i, i + 1600)).toMatch(/liberado: loja\.fiscal_liberado/);
  });

  it('a aba Fiscal sai do menu do lojista sem o módulo', () => {
    const painel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel.tsx'), 'utf8');
    expect(painel).toContain("Number(lojaQ.data?.loja?.fiscal_liberado ?? 0) === 1");
    expect(painel).toContain("i.id !== 'fiscal'");
    /* E os DOIS menus (celular e desktop) usam a lista filtrada — o desktop
       ficou com `GRUPOS_CONFIG` cru na primeira tentativa. */
    const sem = semComentarios(painel);
    expect(sem).not.toMatch(/\{GRUPOS_CONFIG\.map/);
    expect((sem.match(/\{grupos\.map/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('o interruptor do admin diz o que acontece antes de bloquear', () => {
    const tela = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');
    /* Confirmação só ao BLOQUEAR (`!novo`): perguntar para liberar seria um
       clique a mais numa ação que não quebra nada. */
    expect(tela).toContain('if (!novo && !window.confirm(');
    expect(tela).toMatch(/ficam guardados/);
  });
});

describe('bloquear o fiscal NÃO encosta no Maxx Gestão', () => {
  /*
   * SÃO DUAS CONTRATAÇÕES DIFERENTES.
   *
   * `fiscal_liberado` é o módulo de NFC-e DAQUI: nosso certificado, nossa
   * numeração. O Maxx Gestão é integração — a nota sai de lá, com o
   * certificado e a numeração deles. Um cliente pode perfeitamente não ter o
   * nosso fiscal e mandar os pedidos para o ERP dele; é o caso comum, não a
   * exceção.
   *
   * Sem estes testes, a próxima pessoa que quiser "trancar tudo que é fiscal"
   * arrasta o `/erp` junto e derruba a venda no ERP de quem nunca usou nossa
   * emissão.
   */
  it('a guarda tranca só o prefixo /nfce', () => {
    const linha = lojista.split('\n').find(l => l.includes("router.use('/nfce'"));
    expect(linha).toBeDefined();
    expect(linha).not.toMatch(/'\/erp'/);
  });

  it('as rotas /erp ficam FORA do alcance da guarda', () => {
    /*
     * No Express, `router.use('/nfce')` já não alcançaria `/erp` pelo caminho.
     * O que este teste protege é o descuido de mudar o prefixo para algo mais
     * largo (ou registrar `/erp` depois de uma guarda futura).
     */
    const guarda = lojista.indexOf("router.use('/nfce'");
    const rotasErp = [...lojista.matchAll(/router\.(get|post|put|delete)\('\/erp/g)];
    expect(rotasErp.length).toBeGreaterThan(4);
    for (const r of rotasErp) expect(r.index!).toBeLessThan(guarda);
  });

  it('o funil manda pro ERP ANTES de olhar o módulo fiscal', () => {
    /*
     * `fiscal_liberado` é checado dentro de `emitirNfcePedido`, e o ramo do ERP
     * retorna antes de chegar lá. Se um dia a checagem subir para o topo do
     * funil, o pedido do cliente sem o nosso fiscal para de subir para o ERP
     * dele — e ninguém veria, porque nada dá erro: o pedido só não chega.
     */
    const i = lojista.indexOf('export async function emitirNotaDoPedido');
    const funil = lojista.slice(i, lojista.indexOf('\n}', i));
    expect(funil).not.toContain('fiscal_liberado');
    const erp = funil.indexOf('enviarPedidoAoErp');
    const nosso = funil.indexOf('emitirNfcePedido');
    expect(erp).toBeGreaterThan(0);
    expect(erp).toBeLessThan(nosso);
  });

  it('o envio ao ERP não exige o nosso módulo nem a nossa emissão ligada', () => {
    const erp = fs.readFileSync(path.join(__dirname, 'maxxgestao-emitir.ts'), 'utf8');
    expect(semComentarios(erp)).not.toMatch(/fiscal_liberado|nfce_ativo/);
  });

  it('a aba Integrações continua no menu do lojista bloqueado', () => {
    /* O card do Maxx Gestão mora nela. Some a aba, some a integração. */
    const painel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel.tsx'), 'utf8');
    const i = painel.indexOf('const grupos = temFiscal');
    const trecho = painel.slice(i, i + 400);
    expect(trecho).toContain("i.id !== 'fiscal'");
    expect(trecho).not.toContain('integracoes');
  });
});

describe('a plataforma libera o módulo de VENDAS loja por loja', () => {
  /*
   * A tela de Vendas é uma só (PDV Balcão, Mesas, Caixa) e se apoia em quatro
   * prefixos de rota. Esconder o menu não protege nada: as rotas respondem a
   * quem chamar direto.
   */
  it('a coluna existe e nasce DESLIGADA', () => {
    /* Nascer 1 daria a toda loja de delivery um PDV que ela não contratou. */
    expect(schema).toContain("['lojas', 'vendas_liberado', 'vendas_liberado TINYINT NOT NULL DEFAULT 0']");
  });

  it('o backfill liga para quem JÁ operava, e roda uma vez só', () => {
    /*
     * O critério é ter DEIXADO RASTRO: venda de balcão, caixa, ou mesa. Sem o
     * backfill, o deploy tiraria o caixa do ar de quem está operando; sem a
     * marca, um bloqueio feito de propósito voltaria no deploy seguinte.
     */
    const i = schema.indexOf('mig_vendas_liberado');
    expect(i).toBeGreaterThan(0);
    const t = schema.slice(i - 200, i + 1100);
    expect(t).toMatch(/UPDATE lojas l SET vendas_liberado = 1/);
    expect(t).toMatch(/origem = 'balcao'/);
    expect(t).toMatch(/FROM caixas/);
    expect(t).toMatch(/FROM mesas/);
    expect(t).toMatch(/INSERT INTO configuracoes/);
  });

  it('a guarda cobre os QUATRO prefixos, mais o histórico de comandas', () => {
    /*
     * `/comandas-historico` entra separado porque o Express casa `use` por
     * SEGMENTO: `/comandas` não o cobre. Sem ele, o histórico de vendas de uma
     * loja bloqueada seguiria aberto.
     */
    const i = lojista.indexOf('async function exigirModuloVendas');
    expect(i).toBeGreaterThan(0);
    expect(lojista.slice(i, i + 800)).toContain('vendas_liberado');
    expect(lojista.slice(i, i + 800)).toContain('erroHttp(403');
    const lista = lojista.slice(lojista.indexOf('for (const prefixo of'), lojista.indexOf('for (const prefixo of') + 300);
    for (const p of ['/balcao', '/mesas', '/comandas', '/comandas-historico', '/caixa']) {
      expect(lista).toContain(`'${p}'`);
    }
  });

  it('a guarda vem ANTES da primeira rota do módulo', () => {
    /* Depois dela, o Express não a aplicaria às já registradas — e ela passaria
       a proteger metade das rotas, silenciosamente. */
    const guarda = lojista.indexOf('for (const prefixo of');
    const primeira = lojista.search(/router[.](get|post|put|delete)[(]'[/](balcao|mesas|comandas|caixa)/);
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(primeira);
  });

  it('o Delivery daquela tela NÃO é governado por este módulo', () => {
    /*
     * A aba Delivery é emissão de NFC-e, e quem manda nela é `fiscal_liberado`.
     * São duas contratações: vender no balcão e emitir nota são coisas
     * separadas, e uma loja pode ter uma sem a outra.
     */
    const lista = lojista.slice(lojista.indexOf('for (const prefixo of'), lojista.indexOf('for (const prefixo of') + 300);
    expect(lista).not.toContain('/nfce');
  });

  it('a tela some do menu E a rota deixa de existir', () => {
    /*
     * Só tirar do menu deixaria `/lojista/vendas` digitado na barra de
     * endereços abrir a tela, com cada botão dela devolvendo 403.
     */
    const painel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'painel.tsx'), 'utf8');
    expect(painel).toContain("vendas_liberado ?? 0) === 1");
    expect(painel).toContain("i.area !== 'vendas' || temVendas");
    expect(painel).toContain('{temVendas && <Route path="vendas"');
  });
});
