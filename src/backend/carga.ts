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
import bcrypt from 'bcryptjs';
import { comTenant } from './db-mysql';
import db from './db-mysql';
import { listarTenants, removerTenant, tenantPorSlug } from './tenants-mysql';
import { provisionarCliente } from './rotas/admin';
import { agoraUTC } from './util';

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
      const url = `${BASE}${ROTA}`;
      const t0 = Date.now();
      try {
        const r = await fetch(url, { headers: { Host: `${t.slug}.maxxpedidos.com.br` } });
        await r.text();
        amostras.push({ ms: Date.now() - t0, ok: r.ok, status: r.status });
      } catch {
        amostras.push({ ms: Date.now() - t0, ok: false, status: 0 });
      }
    }
  };

  const inicio = Date.now();
  await Promise.all(Array.from({ length: simultaneas }, (_, i) => worker(i)));
  parar = true;
  const duracao = (Date.now() - inicio) / 1000;

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
  else if (acao === 'limpar') await limpar();
  else console.log('Use: preparar <n> | medir <segundos> <simultaneas> | limpar');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
