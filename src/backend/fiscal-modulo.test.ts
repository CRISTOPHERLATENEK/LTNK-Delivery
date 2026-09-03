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

  it('só o super admin liga e desliga', () => {
    /*
     * A asserção olha a LINHA DE REGISTRO, não uma janela em volta dela.
     * Testado antes com `slice(i, i + 700)`, o teste passava mesmo depois de
     * eu tirar o `exigirSuperAdmin` da rota: o `exigirSuperAdmin` da rota
     * SEGUINTE caía dentro da janela e satisfazia a busca.
     */
    const linha = admin.split('\n').find(l => l.includes("router.put('/lojas/:id/fiscal/liberado'"));
    expect(linha).toBeDefined();
    expect(linha).toContain('exigirSuperAdmin');
    const i = admin.indexOf("router.put('/lojas/:id/fiscal/liberado'");
    expect(admin.slice(i, i + 700)).toContain('UPDATE lojas SET fiscal_liberado = ?');
  });

  it('a rota é SEPARADA do formulário do emitente', () => {
    /*
     * O `PUT .../fiscal` exige o cadastro fiscal válido, e o cliente que a
     * gente mais precisa poder desligar é o de cadastro pela metade.
     */
    expect(admin).toContain("router.put('/lojas/:id/fiscal/liberado'");
    const form = admin.indexOf("router.put('/lojas/:id/fiscal'");
    expect(admin.slice(form, form + 1500)).not.toContain('fiscal_liberado');
  });

  it('bloquear NÃO apaga certificado, CSC nem numeração', () => {
    /* Mudança de plano não pode destruir documento fiscal. */
    const i = admin.indexOf("router.put('/lojas/:id/fiscal/liberado'");
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
    expect(tela).toContain('/fiscal/liberado');
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
