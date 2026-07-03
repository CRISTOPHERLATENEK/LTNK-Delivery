/**
 * Teste de ponta a ponta — Delivery Multi-lojas (TypeScript).
 * Execute com: npm run teste:e2e
 *
 * Sobe o servidor em uma porta separada com banco DESCARTÁVEL e percorre:
 *   1. Vitrine pública e autenticação
 *   2. Segurança: acesso sem token e com perfil errado
 *   3. Regras de negócio na criação do pedido (preço, loja fechada, troco)
 *   3b. Opções do produto (obrigatório, forjado, limite)
 *   4. Máquina de estados (transições válidas)
 *   5. Entregador: corrida disponível e aceite atômico
 *   6. Admin: dashboard, repasses e bloqueio
 *   7. Rate limiting no login
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORTA = 3100;
const BASE = `http://localhost:${PORTA}`;
const RAIZ = path.join(__dirname, '..', '..');
const DB_TESTE = path.join(RAIZ, 'dados', 'teste-e2e.db');
// Banco central (registro de tenants) TAMBÉM descartável — senão o resolvedor de
// tenant cai no _central.db real, cujo tenant padrão aponta para o banco de dev.
const CENTRAL_TESTE = path.join(RAIZ, 'dados', 'teste-e2e-central.db');

interface RespostaApi { status: number; dados: any }

let aprovados = 0, reprovados = 0;
function verificar(nome: string, condicao: boolean, detalhe = ''): void {
  if (condicao) { aprovados++; console.log(`  ✔ ${nome}`); }
  else { reprovados++; console.error(`  ✘ FALHOU: ${nome} ${detalhe}`); }
}

async function chamar(metodo: string, caminho: string, corpo?: unknown, token?: string): Promise<RespostaApi> {
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) cabecalhos['Authorization'] = 'Bearer ' + token;
  const resposta = await fetch(BASE + caminho, {
    method: metodo, headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  let dados: any = {};
  try { dados = await resposta.json(); } catch { /* sem corpo */ }
  return { status: resposta.status, dados };
}

async function login(email: string, senha: string): Promise<string> {
  const r = await chamar('POST', '/api/auth/login', { email, senha });
  if (r.status !== 200) throw new Error(`Login de ${email} falhou: ${JSON.stringify(r.dados)}`);
  return r.dados.token;
}

async function principal(): Promise<void> {
  for (const base of [DB_TESTE, CENTRAL_TESTE]) {
    for (const sufixo of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(base + sufixo); } catch { /* não existia */ }
    }
  }
  const ambiente = {
    ...process.env,
    PORT: String(PORTA),
    DB_ARQUIVO: DB_TESTE,
    TENANTS_DB: CENTRAL_TESTE,
    JWT_SECRET: 'segredo-apenas-para-teste',
  };
  const seed = spawn(process.execPath, ['dist/backend/seed.js'], { cwd: RAIZ, env: ambiente });
  await new Promise<void>((ok, falha) => {
    seed.on('exit', c => c === 0 ? ok() : falha(new Error('seed falhou')));
  });

  const servidor = spawn(process.execPath, ['dist/backend/server.js'], { cwd: RAIZ, env: ambiente });
  servidor.stderr.on('data', d => process.stderr.write('[servidor] ' + d));
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/lojas'); break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }

  try {
    console.log('\n— 1. Vitrine pública e autenticação —');
    const vitrine = await chamar('GET', '/api/lojas');
    verificar('Vitrine lista as 2 lojas do seed sem login',
      vitrine.status === 200 && vitrine.dados.lojas.length === 2);

    const cardapio = await chamar('GET', '/api/lojas/' + vitrine.dados.lojas[0].id);
    verificar('Cardápio vem agrupado por categorias',
      cardapio.status === 200 && Object.keys(cardapio.dados.cardapio).length >= 2);

    const tCliente = await login('cliente@demo.com', 'cliente123');
    const tLojista = await login('lojista@demo.com', 'lojista123');
    const tEntregador = await login('entregador@demo.com', 'entrega123');
    const tAdmin = await login('admin@demo.com', 'admin123');
    verificar('Login dos 4 perfis funciona', !!(tCliente && tLojista && tEntregador && tAdmin));

    const senhaErrada = await chamar('POST', '/api/auth/login', { email: 'cliente@demo.com', senha: 'errada' });
    verificar('Senha errada devolve 401 com mensagem em português',
      senhaErrada.status === 401 && /incorretos/.test(senhaErrada.dados.erro));

    console.log('\n— 2. Segurança: bloqueio por perfil no backend —');
    const semToken = await chamar('GET', '/api/cliente/pedidos');
    verificar('Rota protegida sem token devolve 401', semToken.status === 401);

    const clienteNoAdmin = await chamar('GET', '/api/admin/dashboard', undefined, tCliente);
    verificar('Cliente tentando acessar rota de admin recebe 403', clienteNoAdmin.status === 403);

    const entregadorNoLojista = await chamar('GET', '/api/lojista/pedidos', undefined, tEntregador);
    verificar('Entregador tentando acessar rota de lojista recebe 403', entregadorNoLojista.status === 403);

    console.log('\n— 3. Regras de negócio na criação do pedido —');
    const minhaLoja = (await chamar('GET', '/api/lojista/loja', undefined, tLojista)).dados.loja;
    const itensCardapio = Object.values(
      (await chamar('GET', '/api/lojas/' + minhaLoja.id)).dados.cardapio).flat() as any[];
    const pizza = itensCardapio.find(p => /Margherita/.test(p.nome));
    const enderecos = (await chamar('GET', '/api/cliente/enderecos', undefined, tCliente)).dados.enderecos;

    const grupoTamanho = pizza.grupos.find((g: any) => g.obrigatorio && g.tipo === 'unico');
    const tamanhoBroto = grupoTamanho.opcoes[0];
    const itemValido = { produto_id: pizza.id, quantidade: 1, opcoes: [tamanhoBroto.id] };

    await chamar('POST', '/api/lojista/loja/abrir-fechar', {}, tLojista); // fecha
    const pedidoLojaFechada = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [itemValido],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Pedido em loja FECHADA é recusado com 409', pedidoLojaFechada.status === 409);
    await chamar('POST', '/api/lojista/loja/abrir-fechar', {}, tLojista); // reabre

    const pedidoPrecoForjado = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id,
      itens: [{ ...itemValido, quantidade: 2, preco_centavos: 1 }],
      total_centavos: 1,
      endereco_id: enderecos[0].id, forma_pagamento: 'dinheiro', troco_para: '200,00',
    }, tCliente);
    const totalEsperado = (pizza.preco_centavos + tamanhoBroto.preco_adicional_centavos) * 2
      + minhaLoja.taxa_entrega_centavos;
    verificar('Preço forjado é ignorado: total recalculado no servidor',
      pedidoPrecoForjado.status === 201 && pedidoPrecoForjado.dados.total_centavos === totalEsperado,
      `(esperado ${totalEsperado}, veio ${pedidoPrecoForjado.dados.total_centavos})`);
    const pedidoId = pedidoPrecoForjado.dados.pedido_id;

    const trocoInvalido = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [itemValido],
      endereco_id: enderecos[0].id, forma_pagamento: 'dinheiro', troco_para: '1,00',
    }, tCliente);
    verificar('Troco menor que o total é rejeitado com 400', trocoInvalido.status === 400);

    // Pix online sem Mercado Pago configurado (ambiente de teste não tem token).
    const pixSemGateway = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [itemValido],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Pix sem gateway configurado devolve 503', pixSemGateway.status === 503);

    console.log('\n— 3b. Opções do produto (tamanho, borda, adicionais) —');
    const semTamanho = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [{ produto_id: pizza.id, quantidade: 1, opcoes: [] }],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Item sem a escolha OBRIGATÓRIA (tamanho) é rejeitado com 400', semTamanho.status === 400);

    const opcaoForjada = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [{ produto_id: pizza.id, quantidade: 1, opcoes: [tamanhoBroto.id, 999999] }],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Opção forjada (id que não é do produto) é rejeitada com 400', opcaoForjada.status === 400);

    const doisTamanhos = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id,
      itens: [{ produto_id: pizza.id, quantidade: 1, opcoes: [grupoTamanho.opcoes[0].id, grupoTamanho.opcoes[1].id] }],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Duas opções num grupo de escolha ÚNICA são rejeitadas com 400', doisTamanhos.status === 400);

    const grupoAdicionais = pizza.grupos.find((g: any) => g.tipo === 'multiplo');
    const estourado = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id,
      itens: [{ produto_id: pizza.id, quantidade: 1,
                opcoes: [tamanhoBroto.id, ...grupoAdicionais.opcoes.map((o: any) => o.id)] }],
      endereco_id: enderecos[0].id, forma_pagamento: 'pix',
    }, tCliente);
    verificar('Passar do máximo de adicionais é rejeitado com 400', estourado.status === 400);

    const pepperoni = itensCardapio.find(p => /Pepperoni/.test(p.nome));
    const tamanhoBig = pepperoni.grupos.find((g: any) => g.obrigatorio).opcoes
      .find((o: any) => /Big/.test(o.nome));
    const borda = pepperoni.grupos.find((g: any) => /Borda/.test(g.nome)).opcoes[0];
    const comOpcoes = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id,
      itens: [{ produto_id: pepperoni.id, quantidade: 1, opcoes: [tamanhoBig.id, borda.id] }],
      endereco_id: enderecos[0].id, forma_pagamento: 'dinheiro',
    }, tCliente);
    const esperadoComOpcoes = pepperoni.preco_promocional_centavos
      + tamanhoBig.preco_adicional_centavos + borda.preco_adicional_centavos
      + minhaLoja.taxa_entrega_centavos;
    verificar('Preço PROMOCIONAL + tamanho Big + borda recalculado no servidor',
      comOpcoes.status === 201 && comOpcoes.dados.total_centavos === esperadoComOpcoes,
      `(esperado ${esperadoComOpcoes}, veio ${comOpcoes.dados.total_centavos})`);
    await chamar('POST', `/api/cliente/pedidos/${comOpcoes.dados.pedido_id}/cancelar`, {}, tCliente);

    console.log('\n— 4. Máquina de estados (transições validadas) —');
    const pularEtapa = await chamar('POST', `/api/lojista/pedidos/${pedidoId}/acao`, { acao: 'pronto' }, tLojista);
    verificar('Pular etapa (pendente → pronto) é rejeitado com 409', pularEtapa.status === 409);

    const pedidoCancelavel = await chamar('POST', '/api/cliente/pedidos', {
      loja_id: minhaLoja.id, itens: [itemValido],
      endereco_id: enderecos[0].id, forma_pagamento: 'dinheiro',
    }, tCliente);
    const cancelou = await chamar('POST', `/api/cliente/pedidos/${pedidoCancelavel.dados.pedido_id}/cancelar`, {}, tCliente);
    verificar('Cliente cancela pedido PENDENTE com sucesso', cancelou.status === 200);

    const aceitar = await chamar('POST', `/api/lojista/pedidos/${pedidoId}/acao`, { acao: 'aceitar' }, tLojista);
    verificar('Lojista aceita pedido pendente', aceitar.status === 200);

    const cancelarTarde = await chamar('POST', `/api/cliente/pedidos/${pedidoId}/cancelar`, {}, tCliente);
    verificar('Cliente NÃO cancela pedido já aceito (409)', cancelarTarde.status === 409);

    const aceitarDeNovo = await chamar('POST', `/api/lojista/pedidos/${pedidoId}/acao`, { acao: 'aceitar' }, tLojista);
    verificar('Aceitar duas vezes (voltar etapa) é rejeitado com 409', aceitarDeNovo.status === 409);

    const preparar = await chamar('POST', `/api/lojista/pedidos/${pedidoId}/acao`, { acao: 'preparar' }, tLojista);
    const pronto = await chamar('POST', `/api/lojista/pedidos/${pedidoId}/acao`, { acao: 'pronto' }, tLojista);
    verificar('Fluxo aceitar → preparar → pronto funciona', preparar.status === 200 && pronto.status === 200);

    console.log('\n— 5. Entregador: corrida disponível e aceite atômico —');
    const corridas = await chamar('GET', '/api/entregador/corridas', undefined, tEntregador);
    verificar('Pedido pronto aparece como corrida disponível',
      corridas.status === 200 && corridas.dados.corridas.some((c: any) => c.id === pedidoId));

    const cad2 = await chamar('POST', '/api/auth/registrar', {
      nome: 'Rival Veloz', email: 'rival@demo.com', senha: 'rival123', perfil: 'entregador',
    });
    const tRival = cad2.dados.token;

    const [r1, r2] = await Promise.all([
      chamar('POST', `/api/entregador/corridas/${pedidoId}/aceitar`, {}, tEntregador),
      chamar('POST', `/api/entregador/corridas/${pedidoId}/aceitar`, {}, tRival),
    ]);
    const sucessos = [r1, r2].filter(r => r.status === 200).length;
    const conflitos = [r1, r2].filter(r => r.status === 409).length;
    verificar('Corrida disputada: exatamente UM entregador consegue (atômico)',
      sucessos === 1 && conflitos === 1, `(sucessos=${sucessos}, conflitos=${conflitos})`);

    const tVencedor = r1.status === 200 ? tEntregador : tRival;
    const tPerdedor = r1.status === 200 ? tRival : tEntregador;

    const entregaAlheia = await chamar('POST', `/api/entregador/corridas/${pedidoId}/entregar`, {}, tPerdedor);
    verificar('Entregador que NÃO pegou a corrida não consegue concluí-la (409)', entregaAlheia.status === 409);

    const entregar = await chamar('POST', `/api/entregador/corridas/${pedidoId}/entregar`, {}, tVencedor);
    verificar('Entregador da corrida confirma a entrega', entregar.status === 200);

    const detalhe = await chamar('GET', '/api/cliente/pedidos/' + pedidoId, undefined, tCliente);
    verificar('Cliente vê o pedido ENTREGUE com linha do tempo completa',
      detalhe.dados.pedido.status === 'entregue' && detalhe.dados.historico.length >= 6);

    const ganhos = await chamar('GET', '/api/entregador/historico?periodo=dia', undefined, tVencedor);
    verificar('Frete da entrega aparece nos ganhos do entregador',
      ganhos.dados.total_fretes_centavos === minhaLoja.taxa_entrega_centavos);

    console.log('\n— 6. Admin: dashboard, repasses e bloqueio —');
    const painel = await chamar('GET', '/api/admin/dashboard', undefined, tAdmin);
    verificar('Dashboard mostra os pedidos de hoje',
      painel.status === 200 && painel.dados.pedidos_hoje >= 1 && painel.dados.lojas_ativas === 2);

    const repasses = await chamar('GET', '/api/admin/repasses', undefined, tAdmin);
    const repasseLoja = repasses.dados.repasses.find((r: any) => r.loja_id === minhaLoja.id);
    verificar('Relatório de repasse calcula comissão + líquido da loja',
      repasseLoja && repasseLoja.pedidos === 1 &&
      repasseLoja.repasse_centavos === repasseLoja.faturamento_centavos - repasseLoja.comissao_centavos);

    const relLojista = await chamar('GET', '/api/lojista/relatorios?periodo=dia', undefined, tLojista);
    verificar('Relatório do lojista soma o faturamento entregue',
      relLojista.dados.resumo.pedidos === 1 && relLojista.dados.resumo.faturamento_centavos === totalEsperado);

    const usuarios = await chamar('GET', '/api/admin/usuarios', undefined, tAdmin);
    const rival = usuarios.dados.usuarios.find((u: any) => u.email === 'rival@demo.com');
    await chamar('POST', `/api/admin/usuarios/${rival.id}/bloquear-desbloquear`, {}, tAdmin);
    const acessoBloqueado = await chamar('GET', '/api/entregador/corridas', undefined, tRival);
    verificar('Usuário bloqueado perde o acesso mesmo com token válido (403)', acessoBloqueado.status === 403);

    console.log('\n— 7. Rate limiting no login (por último: bloqueia o IP de teste) —');
    let resposta429: RespostaApi | null = null;
    for (let i = 0; i < 11; i++) {
      resposta429 = await chamar('POST', '/api/auth/login', { email: 'cliente@demo.com', senha: 'errada' + i });
    }
    verificar('11ª tentativa falha de login é barrada com 429', resposta429!.status === 429);

  } finally {
    servidor.kill();
  }

  console.log(`\nResultado: ${aprovados} aprovados, ${reprovados} reprovados.`);
  process.exit(reprovados === 0 ? 0 : 1);
}

principal().catch((e: Error) => { console.error('Erro fatal no teste:', e); process.exit(1); });
