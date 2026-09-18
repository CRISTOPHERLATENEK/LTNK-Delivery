import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * UMA CONEXÃO DE WHATSAPP POR CLIENTE — e a linha que não pode ser cruzada.
 *
 * O desenho antigo era uma sessão só para a plataforma inteira, por limitação do
 * plano contratado. Agora cada cliente pode ter o próprio token, cadastrado pelo
 * super admin, e a conexão da plataforma segue valendo de RESERVA.
 *
 * A REGRA QUE ESTE ARQUIVO GUARDA:
 *
 *   enviar mensagem ............ cliente, caindo na plataforma se não tiver
 *   parear / QR / desconectar .. SÓ do cliente, sem reserva nenhuma
 *
 * O segundo caso não é preferência de arquitetura, é segurança: se o pareamento
 * caísse na reserva, um lojista clicando "conectar" parearia o número
 * COMPARTILHADO no celular dele — e o "desconectar" dele derrubaria o WhatsApp
 * de todos os outros clientes junto.
 *
 * O teste lê o fonte porque o que precisa ser garantido é QUAL função é chamada
 * em cada lugar. Exercitar de verdade exigiria um provedor externo e três bancos.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const MODULO = ler('src', 'backend', 'whatsapp-nao-oficial.ts');
const LOJISTA = ler('src', 'backend', 'rotas', 'lojista.ts');
const WEBHOOKS = ler('src', 'backend', 'rotas', 'webhooks.ts');
const ADMIN = ler('src', 'backend', 'rotas', 'admin.ts');

describe('as duas camadas de conexão', () => {
  it('a do cliente não cai na da plataforma', () => {
    const fn = /async function credenciaisDoCliente\(\)[^}]*\{([\s\S]*?)\n\}/.exec(MODULO);
    expect(fn).not.toBeNull();
    /* Se aparecer `credenciaisPlataforma` aqui dentro, a reserva vazou pro
       caminho de sessão — que é exatamente o defeito que isto impede. */
    expect(fn![1]).not.toContain('credenciaisPlataforma');
  });

  it('só o envio usa a reserva', () => {
    const envio = /export async function enviarTextoNaoOficial[\s\S]*?\n\}/.exec(MODULO);
    expect(envio).not.toBeNull();
    expect(envio![0]).toContain('credenciaisParaEnvio');
  });

  it('a reserva é cliente primeiro, plataforma depois', () => {
    expect(MODULO).toMatch(/credenciaisParaEnvio[\s\S]*?credenciaisDoCliente\(\)\) \?\? \(await credenciaisPlataforma\(\)/);
  });

  /*
   * `bancoTenantAtual` é fail-closed e LANÇA fora de request. O envio acontece
   * também fora de request (fila, boot), e uma exceção ali derrubaria a mensagem
   * em vez de usar a reserva.
   */
  it('contexto ausente não derruba o envio', () => {
    const fn = /function bancoDoContexto\(\)[\s\S]*?\n\}/.exec(MODULO);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('catch');
  });
});

describe('rotas de pareamento do lojista', () => {
  const trecho = LOJISTA.slice(LOJISTA.indexOf('/whatsapp/nao-oficial/conectar'));

  it('existem as três: conectar, código e desconectar', () => {
    for (const rota of ['nao-oficial/conectar', 'nao-oficial/codigo', 'nao-oficial/desconectar']) {
      expect(LOJISTA, `faltou a rota ${rota}`).toContain(rota);
    }
  });

  /* A asserção central deste arquivo. */
  it('nenhuma delas toca a conexão da plataforma', () => {
    expect(trecho).not.toContain('Plataforma(');
  });

  it('todas exigem conexão própria antes de agir', () => {
    const chamadas = (trecho.match(/exigirConexaoPropria\(/g) || []).length;
    expect(chamadas).toBeGreaterThanOrEqual(3);
  });

  /* Sem isto o lojista escaneia e a tela não sabe que conectou. */
  it('o painel recebe se a loja tem conexão própria', () => {
    expect(LOJISTA).toContain('conexao_propria');
  });
});

describe('webhook de entrada', () => {
  /*
   * Com sessão por cliente, a resposta do consumidor chega do provedor — de
   * fora, sem passar pelo domínio de ninguém. Sem dizer de quem é, ela cairia
   * no banco que o Host resolvesse: o cliente errado.
   */
  it('roteia pelo cliente carimbado na URL', () => {
    expect(WEBHOOKS).toContain("req.query.cliente");
    expect(WEBHOOKS).toContain('comTenant(');
  });

  /* O parâmetro vem de fora: sem conferir, viraria um jeito de escolher em qual
     banco gravar. O token autentica a chamada, mas não autoriza apontar pra
     qualquer lugar. */
  it('confere o cliente contra a lista de tenants', () => {
    expect(WEBHOOKS).toContain('tenantPorDbNome(');
  });

  it('a URL registrada leva o cliente junto', () => {
    expect(MODULO).toContain('&cliente=');
  });
});

describe('cadastro do token pelo super admin', () => {
  it('grava no banco do cliente, não no central', () => {
    const rota = ADMIN.slice(ADMIN.indexOf("router.put('/tenants/:id/whatsapp'"));
    expect(rota).toContain('comTenant(tenant.db_nome');
    expect(rota).not.toContain('upsertCentral');
  });

  it('o token é gravado cifrado', () => {
    const rota = ADMIN.slice(ADMIN.indexOf("router.put('/tenants/:id/whatsapp'"));
    expect(rota).toContain('criptografar(');
  });

  /* O token é credencial paga: o lojista pareia sem nunca vê-la. */
  it('a leitura devolve só se existe token, nunca o valor', () => {
    const rota = ADMIN.slice(
      ADMIN.indexOf("router.get('/tenants/:id/whatsapp'"),
      ADMIN.indexOf("router.put('/tenants/:id/whatsapp'"),
    );
    expect(rota).toContain('tem_token');
    expect(rota).toContain("!!(await ler('wbapi_api_key'))");
    expect(rota).not.toMatch(/wbapi_api_key:\s*await ler/);
  });
});
