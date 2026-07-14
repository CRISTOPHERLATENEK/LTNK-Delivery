/**
 * Servidor principal — Delivery Multi-lojas (TypeScript).
 */
// DEVE ser o primeiro import: instala prova-de-vida + captura de erro de boot
// ANTES de carregar './db' (better-sqlite3, módulo nativo). Assim, se o processo
// cair na carga do módulo nativo, o erro real aparece no log em vez de morrer
// silencioso. (Em CommonJS o tsc iça os imports pro topo — por isso um arquivo
// dedicado importado primeiro, e não um console.log solto aqui.)
import './boot-diagnostico';

import 'dotenv/config';
import path from 'path';
import express, { ErrorRequestHandler } from 'express';

import autenticacaoRoutes from './rotas/autenticacao';
import publicoRoutes from './rotas/publico';
import clienteRoutes from './rotas/cliente';
import lojistaRoutes from './rotas/lojista';
import entregadorRoutes from './rotas/entregador';
import cozinhaRoutes from './rotas/cozinha';
import adminRoutes from './rotas/admin';
import pagamentosRoutes from './rotas/pagamentos';
import uploadRoutes from './rotas/upload';
import pushRoutes from './rotas/push';
import webhooksRoutes from './rotas/webhooks';
import { ErroHttp, lojaAbertaPorAgenda, agoraUTC } from './util';
import db, { comTenant } from './db';
import { resolverPorHost, tenantPadrao, listarTenants } from './tenants';
import { capturarErro } from './monitoramento';

/**
 * Bootstrap opcional: em hospedagens gerenciadas (sem terminal/SSH para rodar
 * `npm run seed` manualmente), defina SEED_ON_START=1 nas variáveis de
 * ambiente pra rodar o seed automaticamente no primeiro boot. `seed.ts` é
 * idempotente (não duplica nada) — seguro mesmo que fique ligado por engano
 * em boots seguintes. Recomendado remover a variável depois do 1º login.
 */
if (process.env.SEED_ON_START === '1') {
  console.log('🌱 SEED_ON_START=1 — rodando seed inicial (idempotente)...');
  require('./seed');
}

const app = express();
app.disable('x-powered-by');
if (process.env.CONFIA_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

// Cabeçalhos de segurança básicos. Exceção estreita: a própria página da
// loja em modo preview (`/loja/:id?preview=1`) precisa poder ser embutida
// num <iframe> — é o preview ao vivo do editor "Visual" do lojista (ver
// frontend/src/pages/lojista/visual/PhonePreview.tsx), same-origin. Em vez
// de tirar a proteção, trocamos por CSP `frame-ancestors 'self'`: continua
// bloqueando qualquer site de FORA framear a loja (clickjacking), só libera
// o próprio domínio embutir a própria página de preview.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ehPreviewDaLoja = /^\/loja\/[^/]+$/.test(req.path) && req.query.preview === '1';
  if (ehPreviewDaLoja) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  } else {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ── Multi-tenant (SILO): resolve o tenant pelo domínio e fixa o .db do request.
// Sem match (localhost / domínio não cadastrado) usa o tenant padrão.
// Todo o restante do request roda dentro do contexto desse tenant.
app.use((req, _res, next) => {
  const tenant = resolverPorHost(req.headers.host) ?? tenantPadrao();
  comTenant(tenant.db_arquivo, () => next());
});

app.use('/api/auth', autenticacaoRoutes);
app.use('/api', publicoRoutes);
app.use('/api/cliente', clienteRoutes);
app.use('/api/lojista', lojistaRoutes);
app.use('/api/entregador', entregadorRoutes);
app.use('/api/cozinha', cozinhaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/webhooks', webhooksRoutes);

// Uploads de imagem (fotos de produtos, banners, logos, capas).
app.use('/uploads', express.static(path.resolve('./dados/uploads')));

// O frontend (compilado) é servido como arquivos estáticos. index.html e
// sw.js NUNCA podem ficar em cache — são o "ponteiro" que aponta pro bundle
// com hash mais novo; sem isso, o navegador pode prender o usuário numa
// versão antiga do app indefinidamente (inclusive via PWA instalado).
app.use(express.static(path.join(__dirname, '..', '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback: rotas client-side do React Router (/loja/:id, /carrinho, etc.)
// devolvem o index.html. Rotas .html legadas (lojista.html, admin.html…) já
// foram resolvidas pelo express.static acima.
const SPA_ROTAS = ['/loja', '/carrinho', '/pedidos', '/pedido', '/conta',
                   '/lojista', '/entregador', '/cozinha', '/painel-admin',
                   '/esqueci-senha', '/redefinir-senha'];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  if (req.path === '/' || SPA_ROTAS.some(r => req.path.startsWith(r))) {
    return res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  }
  next();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Tratador central de erros — converte ErroHttp em resposta JSON em português.
// Só reporta ao Sentry os 500 (erro real, inesperado) — erros de negócio
// (ErroHttp: 400/404/409...) são esperados e não viram ruído no monitoramento.
const tratadorErros: ErrorRequestHandler = (erro, req, res, _next) => {
  if (erro instanceof ErroHttp || (erro && erro.statusHttp)) {
    return res.status(erro.statusHttp).json({ erro: erro.message });
  }
  if (erro && erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição inválido (JSON malformado).' });
  }
  console.error('[ERRO INTERNO]', erro);
  capturarErro(erro, { metodo: req.method, rota: req.path });
  res.status(500).json({ erro: 'Erro interno do servidor. Tente novamente em instantes.' });
};
app.use(tratadorErros);

/**
 * Tick de horário automático — a cada minuto, abre/fecha as lojas que ativaram
 * o modo automático conforme a agenda semanal. Respeita pausa temporária.
 */
function sincronizarHorariosDoTenant(): void {
  const lojas = db.prepare(
    `SELECT id, aberta, horario_json, pausado_ate FROM lojas WHERE auto_horario = 1`
  ).all() as Array<{ id: number; aberta: number; horario_json: string; pausado_ate: string }>;
  const agora = agoraUTC();
  const atualizar = db.prepare('UPDATE lojas SET aberta = ? WHERE id = ?');
  for (const loja of lojas) {
    let deveAbrir = lojaAbertaPorAgenda(loja.horario_json);
    if (deveAbrir === null) continue; // sem agenda válida, não mexe
    // Pausa temporária força fechado.
    if (loja.pausado_ate && loja.pausado_ate > agora) deveAbrir = false;
    const alvo = deveAbrir ? 1 : 0;
    if (loja.aberta !== alvo) atualizar.run(alvo, loja.id);
  }
}

/** Roda o tick de horário para CADA tenant (cada um no seu próprio .db). */
function sincronizarHorarios(): void {
  for (const tenant of listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      comTenant(tenant.db_arquivo, sincronizarHorariosDoTenant);
    } catch (e) {
      console.error(`[HORARIO AUTO] falha no tenant ${tenant.slug}:`, e);
    }
  }
}
sincronizarHorarios();
setInterval(sincronizarHorarios, 60_000);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  // Esta mensagem é só informativa (endereço LOCAL do processo). Em produção,
  // é a plataforma de hospedagem (ex.: Hostinger) que encaminha o SEU DOMÍNIO
  // pra esta porta por trás dos panos — "localhost" aqui não significa que o
  // app está preso à máquina local.
  console.log(`✅ Delivery Multi-lojas ouvindo na porta ${PORT} (acesse pelo seu domínio em produção)`);
  console.log('   Local p/ testes: http://localhost:' + PORT + '/');
});
