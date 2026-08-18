/**
 * Teste de carga — descobre onde a plataforma para de responder.
 *
 * Roda contra o servidor DE VERDADE (HTTP em localhost), não contra mocks: o
 * que interessa medir é a soma de Express, pool de conexão, MySQL e disco, e
 * qualquer atalho aqui mediria outra coisa.
 *
 * SEGURANÇA: só mexe em tenant cujo slug começa com PREFIXO. A limpeza também.
 * Um teste de carga que pudesse tocar num cliente real não vale o número que
 * produz.
 *
 * Uso (no servidor, dentro de /opt/delivery):
 *   node dist/backend/carga.js preparar 20      # cria 20 tenants de teste
 *   node dist/backend/carga.js medir 60 200     # 60s, 200 requisições simultâneas
 *   node dist/backend/carga.js limpar           # apaga tudo que criou
 */
import 'dotenv/config';
import http from 'http';
import bcrypt from 'bcryptjs';
import { comTenant } from './db-mysql';
import db from './db-mysql';
import { listarTenants, removerTenant, tenantPorSlug } from './tenants-mysql';
import { provisionarCliente } from './rotas/admin';
import { agoraUTC } from './util';
import { gerarToken } from './auth';

/** Todo tenant de teste começa com isto. A limpeza confia nesta regra. */
const PREFIXO = 'carga';
const PORTA = Number(process.env.PORT) || 3000;
const BASE = `http://127.0.0.1:${PORTA}`;
/** Rota medida. `loja/1` é a primeira loja de cada tenant de carga. */
const ROTA = process.env.CARGA_ROTA || '/api/lojas/1';

/* ────────────────────────────── preparar ────────────────────────────── */

async function preparar(quantos: number): Promise<void> {
  const senhaHash = bcrypt.hashSync(`carga-${Date.now()}`, 10);
  let criados = 0;
  for (let i = 1; i <= quantos; i++) {
    const slug = `${PREFIXO}${String(i).padStart(3, '0')}`;
    if (await tenantPorSlug(slug)) { console.log(`· ${slug} já existe`); continue; }
    const t0 = Date.now();
    try {
      const { tenant, lojaId } = await provisionarCliente({
        nome: `Carga ${i}`, slug, dominio: null,
        nomeLoja: `Loja Carga ${i}`, categoria: 'Testes',
        nomeDono: `Dono ${i}`, email: `dono${i}@${PREFIXO}.invalid`, telefone: '',
        senhaHash,
      });
      // Produtos: sem catálogo, o cardápio responde vazio e a medição vira
      // "quão rápido devolvemos uma lista vazia", que não é a pergunta.
      await comTenant(tenant.db_nome, async () => {
        for (let p = 1; p <= 20; p++) {
          await db.prepare(
            `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos, disponivel, criado_em)
             VALUES (?, ?, ?, ?, ?, 1, ?)`
          ).run(lojaId, `Produto ${p}`, 'Item de teste de carga', 'Testes', 1000 + p * 100, agoraUTC());
        }
        // Loja FECHADA recusa pedido com 409 — e aí a medição de escrita viraria
        // a medição de quão rápido dizemos "estamos fechados".
        await db.prepare('UPDATE lojas SET aberta = 1 WHERE id = ?').run(lojaId);

        // Um cliente com endereço por tenant: sem endereço o pedido de ENTREGA
        // é recusado antes de tocar no banco de itens.
        const cli = await db.prepare(
          `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, criado_em)
           VALUES (?, ?, ?, 'cliente', '', ?)`
        ).run(`Cliente Carga ${i}`, `cliente${i}@${PREFIXO}.invalid`, senhaHash, agoraUTC());
        await db.prepare(
          `INSERT INTO enderecos (usuario_id, rotulo, rua, numero, complemento, bairro, cidade, uf, cep, referencia, criado_em)
           VALUES (?, 'Casa', 'Rua de Teste', '100', '', 'Centro', 'Florianópolis', 'SC', '88000000', '', ?)`
        ).run(Number(cli.lastInsertRowid), agoraUTC());
      });
      criados++;
      console.log(`✓ ${slug} em ${Date.now() - t0}ms`);
    } catch (e) {
      console.error(`✗ ${slug}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${criados} tenant(s) criado(s).`);
}

/* ─────────────────────────────── medir ─────────────────────────────── */

interface Amostra { ms: number; ok: boolean; status: number }

/**
 * Uma requisição, com o Host do tenant.
 *
 * `http.request` e NÃO `fetch`: o fetch do Node (undici) IGNORA o cabeçalho
 * Host por segurança, sem avisar. A primeira versão desta ferramenta usava
 * fetch e media 100% de 404 — todas as requisições caíam no tenant padrão, e o
 * número que saía era o custo de responder "não achei".
 */
function pedir(host: string, opcoes: { rota?: string; metodo?: string; corpo?: unknown; token?: string } = {}): Promise<number> {
  const corpo = opcoes.corpo === undefined ? null : Buffer.from(JSON.stringify(opcoes.corpo));
  const cabecalhos: Record<string, string> = { Host: host };
  if (corpo) { cabecalhos['Content-Type'] = 'application/json'; cabecalhos['Content-Length'] = String(corpo.length); }
  if (opcoes.token) cabecalhos.Authorization = `Bearer ${opcoes.token}`;
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORTA, path: opcoes.rota ?? ROTA, method: opcoes.metodo ?? 'GET', headers: cabecalhos },
      (res) => {
        // Consome o corpo: sem ler, o socket fica preso e o teste mede o
        // tempo até o cabeçalho, não até a resposta inteira.
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', () => resolve(0));
    if (corpo) req.write(corpo);
    req.end();
  });
}

/** Percentil de uma lista JÁ ordenada. */
function percentil(ordenado: number[], p: number): number {
  if (ordenado.length === 0) return 0;
  const i = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return Math.round(ordenado[i]);
}

async function medir(segundos: number, simultaneas: number): Promise<void> {
  const slugs = (await listarTenants()).filter(t => t.slug.startsWith(PREFIXO));
  if (slugs.length === 0) { console.error('Nenhum tenant de carga. Rode "preparar" antes.'); return; }

  console.log(`Alvo: ${slugs.length} tenant(s) · ${simultaneas} requisições simultâneas · ${segundos}s\n`);

  const amostras: Amostra[] = [];
  const fim = Date.now() + segundos * 1000;
  let parar = false;

  /*
   * Cada worker escolhe um tenant DIFERENTE a cada volta. Bater sempre no mesmo
   * mediria o cache de um banco só; o que se quer saber é o custo de atender
   * muitos clientes ao mesmo tempo, que é onde o pool de conexões aperta.
   */
  const worker = async (n: number) => {
    let volta = n;
    while (!parar && Date.now() < fim) {
      const t = slugs[volta++ % slugs.length];
      /*
       * O CARDÁPIO, e não uma rota leve: é a página mais aberta de um delivery
       * e a que lê mais linha por requisição (loja + produtos + opções). Medir
       * um endpoint barato daria um número bonito e inútil.
       */
      const t0 = Date.now();
      const st = await pedir(`${t.slug}.maxxpedidos.com.br`);
      amostras.push({ ms: Date.now() - t0, ok: st >= 200 && st < 400, status: st });
    }
  };

  const inicio = Date.now();
  await Promise.all(Array.from({ length: simultaneas }, (_, i) => worker(i)));
  parar = true;
  const duracao = (Date.now() - inicio) / 1000;

  relatorio(amostras, duracao);
}

/** Resumo de uma rodada. Igual pros dois modos, pra dar pra comparar. */
function relatorio(amostras: Amostra[], duracao: number): void {
  const tempos = amostras.map(a => a.ms).sort((a, b) => a - b);
  const erros = amostras.filter(a => !a.ok);
  const porStatus = new Map<number, number>();
  for (const e of erros) porStatus.set(e.status, (porStatus.get(e.status) ?? 0) + 1);

  console.log(`requisições : ${amostras.length}`);
  console.log(`duração     : ${duracao.toFixed(1)}s`);
  console.log(`vazão       : ${(amostras.length / duracao).toFixed(0)} req/s`);
  console.log(`p50 / p95   : ${percentil(tempos, 50)}ms / ${percentil(tempos, 95)}ms`);
  console.log(`p99 / máx   : ${percentil(tempos, 99)}ms / ${tempos[tempos.length - 1] ?? 0}ms`);
  console.log(`erros       : ${erros.length} (${((erros.length / Math.max(1, amostras.length)) * 100).toFixed(1)}%)`);
  for (const [s, n] of porStatus) console.log(`   status ${s || 'conexão caiu'}: ${n}`);
}

/* ───────────────────────── medir criação de pedido ───────────────────── */

/** Cliente, endereço e produtos de um tenant — o que um checkout precisa. */
interface Cenario { host: string; token: string; lojaId: number; enderecoId: number; produtos: number[] }

async function montarCenarios(): Promise<Cenario[]> {
  const tenants = (await listarTenants()).filter(t => t.slug.startsWith(PREFIXO));
  const cenarios: Cenario[] = [];
  for (const t of tenants) {
    const c = await comTenant(t.db_nome, async () => {
      const loja = await db.prepare('SELECT id FROM lojas ORDER BY id LIMIT 1').get() as { id: number } | undefined;
      const cli = await db.prepare("SELECT id FROM usuarios WHERE perfil = 'cliente' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
      if (!loja || !cli) return null;
      const end = await db.prepare('SELECT id FROM enderecos WHERE usuario_id = ? LIMIT 1').get(cli.id) as { id: number } | undefined;
      const prods = await db.prepare('SELECT id FROM produtos WHERE loja_id = ? AND disponivel = 1 LIMIT 5').all(loja.id) as Array<{ id: number }>;
      if (!end || prods.length === 0) return null;
      /*
       * Token gerado direto, sem passar pelo login: o custo do bcrypt no login
       * é proposital (defesa contra força bruta) e domina qualquer medição. O
       * que se quer medir aqui é o CHECKOUT.
       */
      return {
        host: `${t.slug}.maxxpedidos.com.br`,
        token: gerarToken({ id: cli.id, perfil: 'cliente' }),
        lojaId: loja.id, enderecoId: end.id, produtos: prods.map(p => p.id),
      } as Cenario;
    });
    if (c) cenarios.push(c);
  }
  return cenarios;
}

async function medirPedidos(segundos: number, simultaneas: number): Promise<void> {
  const cenarios = await montarCenarios();
  if (cenarios.length === 0) { console.error('Nenhum cenário pronto. Rode "preparar" antes.'); return; }
  console.log(`Criando pedidos em ${cenarios.length} tenant(s) · ${simultaneas} simultâneas · ${segundos}s
`);

  const amostras: Amostra[] = [];
  const fim = Date.now() + segundos * 1000;

  const worker = async (n: number) => {
    let volta = n;
    while (Date.now() < fim) {
      const c = cenarios[volta++ % cenarios.length];
      // 'dinheiro' de propósito: Pix e cartão chamam a API do gateway, e aí a
      // medição viraria o tempo do Mercado Pago, não o do nosso checkout.
      const corpo = {
        loja_id: c.lojaId,
        endereco_id: c.enderecoId,
        forma_pagamento: 'dinheiro',
        itens: [
          { produto_id: c.produtos[volta % c.produtos.length], quantidade: 1 },
          { produto_id: c.produtos[(volta + 1) % c.produtos.length], quantidade: 2 },
        ],
      };
      const t0 = Date.now();
      const st = await pedir(c.host, { rota: '/api/cliente/pedidos', metodo: 'POST', corpo, token: c.token });
      amostras.push({ ms: Date.now() - t0, ok: st >= 200 && st < 400, status: st });
    }
  };

  const inicio = Date.now();
  await Promise.all(Array.from({ length: simultaneas }, (_, i) => worker(i)));
  relatorio(amostras, (Date.now() - inicio) / 1000);
}

/* ──────────────────────── pico: taxa fixa de chegada ─────────────────── */

/**
 * Dispara N requisições POR SEGUNDO, sem esperar as anteriores terminarem.
 *
 * É o oposto do modo `medir`. Ali cada worker só pede de novo quando a resposta
 * chega, então a máquina nunca recebe mais do que aguenta — bom pra achar o
 * teto, inútil pra prever pico real. Gente de verdade não espera: se mil pessoas
 * abrem o cardápio no mesmo minuto, as mil requisições chegam, e o que se quer
 * saber é se a resposta continua rápida ou se a fila começa a crescer.
 *
 * O sinal de que passou do ponto não é erro, é a latência subindo a cada
 * segundo — quando isso aparece, a chegada superou a vazão e a fila só cresce.
 */
async function pico(segundos: number, porSegundo: number, escrita: boolean): Promise<void> {
  const cenarios = escrita ? await montarCenarios() : [];
  const tenants = (await listarTenants()).filter(t => t.slug.startsWith(PREFIXO));
  if (tenants.length === 0) { console.error('Nenhum tenant de carga.'); return; }
  if (escrita && cenarios.length === 0) { console.error('Cenários de pedido não prontos.'); return; }

  console.log(`${escrita ? 'PEDIDOS' : 'CARDÁPIO'} · ${porSegundo} req/s durante ${segundos}s · ${tenants.length} tenants\n`);
  console.log('  s   enviadas  concluídas   p50     p95    erros');

  const amostras: Amostra[] = [];
  const emVoo = new Set<Promise<void>>();
  let enviadas = 0;
  const intervalo = 1000 / porSegundo;

  const disparar = () => {
    const i = enviadas++;
    const t0 = Date.now();
    const p = (async () => {
      let st: number;
      if (escrita) {
        const c = cenarios[i % cenarios.length];
        st = await pedir(c.host, {
          rota: '/api/cliente/pedidos', metodo: 'POST', token: c.token,
          corpo: { loja_id: c.lojaId, endereco_id: c.enderecoId, forma_pagamento: 'dinheiro',
                   itens: [{ produto_id: c.produtos[i % c.produtos.length], quantidade: 1 }] },
        });
      } else {
        st = await pedir(`${tenants[i % tenants.length].slug}.maxxpedidos.com.br`);
      }
      amostras.push({ ms: Date.now() - t0, ok: st >= 200 && st < 400, status: st });
    })();
    emVoo.add(p);
    void p.finally(() => emVoo.delete(p));
  };

  // Relatório por segundo: é a curva que denuncia a fila crescendo.
  let ultimo = 0;
  const porSeg = setInterval(() => {
    const novas = amostras.slice(ultimo);
    ultimo = amostras.length;
    const t = novas.map(a => a.ms).sort((a, b) => a - b);
    const err = novas.filter(a => !a.ok).length;
    console.log(`${String(Math.round((Date.now() - inicio) / 1000)).padStart(3)}  ${String(enviadas).padStart(8)}  ${String(amostras.length).padStart(10)}  ${String(percentil(t, 50)).padStart(5)}ms ${String(percentil(t, 95)).padStart(6)}ms ${String(err).padStart(6)}`);
  }, 1000);

  const inicio = Date.now();
  const fim = inicio + segundos * 1000;
  while (Date.now() < fim) {
    disparar();
    await new Promise(r => setTimeout(r, intervalo));
  }
  await Promise.all([...emVoo]);
  clearInterval(porSeg);

  console.log('\n─── total ───');
  relatorio(amostras, (Date.now() - inicio) / 1000);
  const perdidas = enviadas - amostras.length;
  if (perdidas > 0) console.log(`ficaram em voo no fim: ${perdidas}`);
}

/* ─────────────────────────────── limpar ─────────────────────────────── */

async function limpar(): Promise<void> {
  const alvos = (await listarTenants()).filter(t => t.slug.startsWith(PREFIXO));
  if (alvos.length === 0) { console.log('Nada a limpar.'); return; }
  for (const t of alvos) {
    try {
      const r = await removerTenant(t.id);
      console.log(`✓ ${t.slug} removido${r.bancoApagado ? ' (banco apagado)' : ''}`);
    } catch (e) {
      console.error(`✗ ${t.slug}: ${(e as Error).message}`);
    }
  }
}

/* ──────────────────────────────── main ──────────────────────────────── */

(async () => {
  const [acao, a1, a2] = process.argv.slice(2);
  if (acao === 'preparar') await preparar(Math.max(1, Number(a1) || 5));
  else if (acao === 'medir') await medir(Math.max(1, Number(a1) || 30), Math.max(1, Number(a2) || 50));
  else if (acao === 'pedidos') await medirPedidos(Math.max(1, Number(a1) || 30), Math.max(1, Number(a2) || 50));
  else if (acao === 'pico') await pico(Math.max(1, Number(a1) || 20), Math.max(1, Number(a2) || 50), process.argv[5] === 'escrita');
  else if (acao === 'limpar') await limpar();
  else console.log('Use: preparar <n> | medir <s> <n> | pedidos <s> <n> | pico <s> <req/s> [escrita] | limpar');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
