/**
 * QUEM EMITE A NOTA de cada cliente.
 *
 * Testes de COMPORTAMENTO, não de fonte: a decisão é pura de propósito, e é
 * ela que decide se um cliente aparece como "vendendo sem nota" ou passa
 * batido. Errar aqui não dá erro em tela nenhuma.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { quemEmite } from './quem-emite';

describe('quemEmite', () => {
  it('ERP com token: emite, e sem alerta', () => {
    const r = quemEmite({ nfce_emissor: 'erp', tem_token_erp: true, fiscal_liberado: 0, nfce_ativo: 0 });
    expect(r.estado).toBe('erp');
    expect(r.alerta).toBe(false);
  });

  it('ERP com token NAO depende do nosso modulo fiscal', () => {
    /*
     * É o caso comum hoje: cliente sem a nossa emissão, mandando o pedido pro
     * ERP dele. Se o `fiscal_liberado = 0` puxasse este caso para "sem nota", o
     * aviso do topo nasceria gritando em cima de todo mundo — e um aviso que
     * grita sempre para de ser lido.
     */
    const r = quemEmite({ nfce_emissor: 'erp', tem_token_erp: true, fiscal_liberado: 0 });
    expect(r.alerta).toBe(false);
  });

  it('ERP SEM token e alerta: o pedido nao chega la', () => {
    const r = quemEmite({ nfce_emissor: 'erp', tem_token_erp: false });
    expect(r.estado).toBe('sem_credencial');
    expect(r.alerta).toBe(true);
    expect(r.detalhe).toMatch(/token/);
  });

  it('maquininha ligada e configurada: emite', () => {
    const r = quemEmite({ nfce_emissor: 'maquininha', smarttef_configurado: true });
    expect(r.estado).toBe('maquininha');
    expect(r.alerta).toBe(false);
  });

  it('maquininha sem credencial e alerta', () => {
    const r = quemEmite({ nfce_emissor: 'maquininha', smarttef_configurado: false });
    expect(r.alerta).toBe(true);
  });

  it('emissor proprio e ALERTA mesmo com tudo ligado', () => {
    /*
     * A emissão deste sistema está incompleta e não é para ser usada — a nota
     * sai pelo Maxx Gestão ou por outra API. Loja apontada para cá é
     * configuração a corrigir, não estado de repouso, então aparece marcada
     * mesmo com `fiscal_liberado` e `nfce_ativo` em 1.
     */
    const r = quemEmite({ nfce_emissor: 'sistema', fiscal_liberado: 1, nfce_ativo: 1 });
    expect(r.estado).toBe('proprio');
    expect(r.alerta).toBe(true);
  });

  it('ninguem emite: modulo bloqueado e emissor apontando pra ca', () => {
    const r = quemEmite({ nfce_emissor: 'sistema', fiscal_liberado: 0, nfce_ativo: 1 });
    expect(r.estado).toBe('nenhum');
    expect(r.alerta).toBe(true);
    /* Diz que a chave que falta é a DAQUI (painel admin). */
    expect(r.detalhe).toMatch(/módulo fiscal não está liberado/);
  });

  it('ninguem emite: modulo liberado mas o lojista desligou', () => {
    /*
     * As duas chaves ficam em TELAS diferentes — `fiscal_liberado` no admin,
     * `nfce_ativo` no painel do lojista. Um "não emite" genérico manda a pessoa
     * procurar nas duas.
     */
    const r = quemEmite({ nfce_emissor: 'sistema', fiscal_liberado: 1, nfce_ativo: 0 });
    expect(r.estado).toBe('nenhum');
    expect(r.detalhe).toMatch(/desligada no painel do lojista/);
  });

  it('emissor ausente ou estranho cai no nosso, e isso e alerta', () => {
    /*
     * O funil da nota trata valor desconhecido como `sistema`. Esta função
     * precisa concordar com ele, senão a tela diria "Maxx Gestão" para uma loja
     * que na hora da entrega tenta emitir aqui.
     */
    for (const v of [null, undefined, '', 'coisa-nova']) {
      const r = quemEmite({ nfce_emissor: v as string | null, fiscal_liberado: 0 });
      expect(r.alerta).toBe(true);
      expect(r.estado).toBe('nenhum');
    }
  });

  it('todo estado tem rotulo e detalhe preenchidos', () => {
    /* Selo vazio no card é pior que selo ausente: parece bug da tela. */
    const casos = [
      { nfce_emissor: 'erp', tem_token_erp: true },
      { nfce_emissor: 'erp', tem_token_erp: false },
      { nfce_emissor: 'maquininha', smarttef_configurado: true },
      { nfce_emissor: 'maquininha', smarttef_configurado: false },
      { nfce_emissor: 'sistema', fiscal_liberado: 1, nfce_ativo: 1 },
      { nfce_emissor: 'sistema', fiscal_liberado: 0 },
    ];
    for (const c of casos) {
      const r = quemEmite(c);
      expect(r.rotulo.length).toBeGreaterThan(2);
      expect(r.detalhe.length).toBeGreaterThan(20);
    }
  });
});

describe('a rota do admin manda a situacao pronta', () => {
  const admin = fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8');
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'lojas.tsx'), 'utf8');

  it('os DOIS caminhos da lista incluem situacao_nota', () => {
    /*
     * A rota tem um SELECT para o super admin (agregando tenants) e outro para
     * tenant único. Um deles sem o campo deixaria metade dos admins sem a
     * coluna — e ninguém reclamaria, porque o selo simplesmente não aparece.
     */
    const i = admin.indexOf("router.get('/lojas'");
    const t = admin.slice(i, i + 1800);
    expect((t.match(/situacao_nota: situacaoDaNota/g) ?? []).length).toBe(2);
  });

  it('manda BOOLEANO de credencial, nunca o valor', () => {
    /* O selo só precisa saber se existe. Mandar o token cifrado ao navegador é
       exposição sem uso. */
    const i = admin.indexOf('function situacaoDaNota');
    const t = admin.slice(i, i + 900);
    expect(t).toContain('tem_token_erp: !!l.maxxgestao_token');
  });

  it('o criterio da maquininha e o mesmo do envio de verdade', () => {
    /*
     * `fluxoPedido` exige ligada + usuário + senha + chave do gateway. Um
     * critério mais frouxo aqui mostraria "Maquininha" verde numa loja que
     * nunca lança preconta.
     */
    const i = admin.indexOf('function situacaoDaNota');
    const t = admin.slice(i, i + 900);
    for (const campo of ['smarttef_ativo', 'smarttef_usuario', 'smarttef_senha', 'smarttef_gateway_token']) {
      expect(t).toContain(campo);
    }
  });

  it('o aviso do topo conta so loja APROVADA', () => {
    /* Pendente e suspensa não vendem; incluí-las manteria o aviso sempre
       aceso, e aviso sempre aceso não é lido. */
    expect(tela).toContain("l.status_aprovacao === 'aprovada' && l.situacao_nota?.alerta");
  });

  it('o aviso NOMEIA as lojas, nao so conta', () => {
    const i = tela.indexOf('semNota.length > 0');
    const t = tela.slice(i, i + 1400);
    expect(t).toContain('semNota.slice(0, 8).map');
    expect(t).toContain('situacao_nota?.detalhe');
  });

  it('emissor proprio tem a MESMA cor de quem nao emite nada', () => {
    /* Verde nele diria "resolvido" para a configuração que a gente quer
       corrigir. */
    const i = tela.indexOf('const SELO_NOTA');
    const t = tela.slice(i, i + 400);
    expect(t).toMatch(/proprio: 'bg-amber/);
    expect(t).not.toMatch(/proprio: 'bg-green/);
  });
});
