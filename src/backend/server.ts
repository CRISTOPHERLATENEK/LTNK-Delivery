/**
 * Servidor principal — Delivery Multi-lojas (TypeScript).
 */
// DEVE ser o primeiro import: instala prova-de-vida + captura de erro de boot
// ANTES de carregar './db-mysql' (mysql2, pool de conexão). Assim, se o
// processo cair na carga do módulo, o erro real aparece no log em vez de
// morrer silencioso. (Em CommonJS o tsc iça os imports pro topo — por isso um
// arquivo dedicado importado primeiro, e não um console.log solto aqui.)
import './boot-diagnostico';

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { metaDaRota, injetarMeta, paginaSuspensa, contatoSuporte } from './og';
import express, { ErrorRequestHandler } from 'express';

import autenticacaoRoutes from './rotas/autenticacao';
import publicoRoutes from './rotas/publico';
import clienteRoutes from './rotas/cliente';
import lojistaRoutes from './rotas/lojista';
import entregadorRoutes from './rotas/entregador';
import cozinhaRoutes from './rotas/cozinha';
import adminRoutes from './rotas/admin';
import revendedorRoutes from './rotas/revendedor';
import pagamentosRoutes, { reconciliarPagamentosOnz, reconciliarCartoesMP, cancelarCartoesAbandonados } from './rotas/pagamentos';
import { aquecerTokens } from './onz';
import { gravarFaturasDeTodos } from './faturas';
import { deveEnviar, destinatariosDe } from './envio-contador';
import { enviarPacoteAoContador } from './xml-contador';
import { emailHabilitado } from './email';
import uploadRoutes from './rotas/upload';
import pushRoutes from './rotas/push';
import webhooksRoutes from './rotas/webhooks';
import { ErroHttp, lojaAbertaPorAgenda, agoraUTC, dataBrasilia, mensagemDeDuplicidade } from './util';
import db, { comTenant, abrirPool, BANCO_PADRAO } from './db-mysql';
import { inicializarSchema } from './schema-mysql';
import { inicializarCentral, resolverPorHost, tenantPadrao, tenantPorSlug, tenantPorDbNome, listarTenants, poolCentral, tenantDesativadoDoHost, ehMaster } from './tenants-mysql';
import { inicializarAssinaturas, processarVencimentos } from './assinaturas';
import { tenantDoToken } from './auth';
import { capturarErro } from './monitoramento';

/**
 * Bootstrap opcional: em hospedagens gerenciadas (sem terminal/SSH para rodar
 * `npm run seed` manualmente), defina SEED_ON_START=1 nas variáveis de
 * ambiente pra rodar o seed automaticamente no primeiro boot. `seed.ts` é
 * idempotente (não duplica nada) — seguro mesmo que fique ligado por engano
 * em boots seguintes. Recomendado remover a variável depois do 1º login.
 * A chamada de verdade acontece dentro do IIFE assíncrono de boot, mais
 * abaixo (precisa rodar depois de inicializarCentral()).
 */

const app = express();
app.disable('x-powered-by');
/*
 * CONFIA_PROXY = QUANTOS intermediários existem entre o cliente e o app.
 *
 *   1 = só o nginx           (tráfego direto no servidor)
 *   2 = Cloudflare + nginx   (proxy da Cloudflare ligado)
 *
 * O número importa e não é detalhe: seis limitadores de requisição usam
 * `req.ip` (login, cadastro, 2FA, recuperação de senha, cozinha e upload). Com
 * o valor baixo demais, `req.ip` passa a ser o IP do proxy da frente — e aí os
 * limitadores enxergam a internet inteira como uma pessoa só e começam a
 * bloquear gente legítima que nunca errou senha nenhuma.
 *
 * Valor inválido ou ausente = não confia em ninguém, que é o padrão seguro:
 * `req.ip` vira o IP do socket, no máximo pessimista demais.
 */
const saltosConfiaveis = Math.trunc(Number(process.env.CONFIA_PROXY));
if (Number.isFinite(saltosConfiaveis) && saltosConfiaveis > 0) {
  app.set('trust proxy', saltosConfiaveis);
}
app.use(express.json({ limit: '200kb' }));

// Cabeçalhos de segurança básicos. Exceção estreita: a própria página da
// loja (`/:id?preview=1`, PhonePreview.tsx) OU a landing (`/?preview=1`,
// admin → Marca, PreviewLanding em marca.tsx) em modo preview precisam poder
// ser embutidas num <iframe> — são os previews ao vivo dos respectivos
// editores, same-origin. Em vez de tirar a proteção, trocamos por CSP
// `frame-ancestors 'self'`: continua bloqueando qualquer site de FORA
// framear a página (clickjacking), só libera o próprio domínio embutir a
// própria página de preview.
/**
 * Content-Security-Policy.
 *
 * LIMITE CONHECIDO E DELIBERADO: `script-src` precisa de 'unsafe-inline'.
 * O lojista pode plugar o próprio GA4/GTM/Meta/TikTok/Clarity (visual_json →
 * avancado), e esses snippets são injetados como <script> inline em runtime
 * (ver frontend/src/lib/visual.ts). Com 'unsafe-inline' a CSP deixa de ser
 * defesa forte contra XSS — isso só muda reescrevendo a injeção de analytics
 * pra usar nonce por request. O que esta política ENTREGA de verdade:
 *   - object-src 'none'  → mata plugin/Flash como vetor
 *   - base-uri 'self'    → bloqueia sequestro de URL relativa via <base>
 *   - form-action 'self' → impede POST de formulário pra domínio de fora
 *   - allowlist de origem pra script/connect/font/style: um XSS não consegue
 *     exfiltrar dado pra um servidor arbitrário, só pros domínios abaixo
 *   - upgrade-insecure-requests → sub-recurso em http:// vira https://
 *
 * img-src aceita `https:` de propósito: logo, capa e imagem do hero podem
 * apontar pra URL externa escolhida pelo lojista (não dá pra listar).
 */
/*
 * CURINGA NOS DOMÍNIOS DO MERCADO PAGO, e não uma lista nominal.
 *
 * A lista nominal foi tentada primeiro e virou caça ao tesouro: cada bloqueio
 * escondia o próximo, e a documentação não cita nenhum deles. Só rodando é que
 * apareceram `http2.mlstatic.com` (componente e traduções), `www.mercadolibre.com`
 * (fingerprint de antifraude), `secure-fields.mercadopago.com` (os campos do
 * cartão) e `api-static.mercadopago.com`. Não há motivo pra crer que a lista
 * acabou — e cada domínio faltando quebra o pagamento em produção.
 *
 * O QUE ISSO CUSTA, com honestidade: um curinga é mais fraco que nomes exatos.
 * O que ele libera, porém, é infraestrutura do MESMO fornecedor a quem já
 * entregamos a tokenização do cartão — se ele estiver comprometido, ter listado
 * três subdomínios em vez de todos não salvaria ninguém. O curinga não vale pra
 * mais ninguém: só estes dois domínios, ambos do Mercado Pago/Livre.
 */
const ORIGENS_MERCADOPAGO = [
  'https://*.mercadopago.com',        // sdk, api, secure-fields, api-static, events…
  'https://*.mercadopago.com.br',
  'https://*.mlstatic.com',           // CDN do componente do brick e das traduções
  'https://www.mercadolibre.com',     // fingerprint de antifraude (connect e frame)
  'https://api.mercadolibre.com',
];
const ORIGENS_ANALYTICS = [
  'https://www.googletagmanager.com',   // GA4 + GTM
  'https://connect.facebook.net',       // Meta Pixel
  'https://analytics.tiktok.com',       // TikTok Pixel
  'https://www.clarity.ms',             // Microsoft Clarity
];
const CSP_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `frame-src 'self' ${ORIGENS_MERCADOPAGO.join(' ')}`,
  "worker-src 'self'",                  // service worker do PWA (push)
  "manifest-src 'self'",
  "img-src 'self' data: blob: https:",  // QR em base64, uploads, imagem externa da loja
  "media-src 'self' blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `script-src 'self' 'unsafe-inline' ${[...ORIGENS_ANALYTICS, ...ORIGENS_MERCADOPAGO].join(' ')}`,
  [
    "connect-src 'self'",
    'https://viacep.com.br',              // busca de CEP no checkout
    'https://brasilapi.com.br',           // consulta de CNPJ no painel fiscal
    'https://router.project-osrm.org',    // rota do entregador no mapa
    'https://*.tile.openstreetmap.org',   // tiles do mapa
    /**
     * AGENTE DE IMPRESSÃO no PC do caixa (frontend/src/lib/agente.ts).
     *
     * BUG QUE ISSO CORRIGE: sem estas origens, TODA chamada ao agente era
     * bloqueada pela CSP ("Refused to connect... violates connect-src"). O
     * lojista instalava o agente, ele rodava, e o navegador nem tentava falar
     * com ele — `agenteAtivo()` sempre dava falso e cada impressão caía no
     * diálogo do navegador. Era a causa raiz do PDV/mesa travando.
     *
     * Risco de segurança é baixo e o alcance é mínimo: loopback só chega no
     * PRÓPRIO computador de quem está usando o painel, numa porta só. Um XSS
     * não ganha exfiltração pra fora com isso — e é exatamente o recurso que a
     * porta 9110 existe pra oferecer. 127.0.0.1 junto porque parte dos Windows
     * resolve `localhost` só pra ::1 e o agente escuta em IPv4.
     */
    'http://localhost:9110',
    'http://127.0.0.1:9110',
    ...ORIGENS_ANALYTICS,
    ...ORIGENS_MERCADOPAGO,
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.facebook.com',
    'https://*.clarity.ms',
  ].join(' '),
  'upgrade-insecure-requests',
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Loja em modo preview vive na raiz por slug/id (`/minha-loja?preview=1`,
  // sem prefixo /loja/ — ver App.tsx `<Route path="/:id">`); a landing vive
  // na própria raiz (`/?preview=1`).
  const ehPreview = /^\/([^/]+)?$/.test(req.path) && req.query.preview === '1';
  // frame-ancestors é a única diretiva que muda entre preview e página normal:
  // o preview PRECISA ser embutível (same-origin) pelos editores; o resto não
  // pode ser framado por ninguém. X-Frame-Options fica só pra navegador antigo
  // que ignora frame-ancestors — e não pode ser mandado no preview, porque não
  // tem equivalente a 'self' confiável entre navegadores.
  res.setHeader(
    'Content-Security-Policy',
    `${CSP_BASE}; frame-ancestors ${ehPreview ? "'self'" : "'none'"}`,
  );
  if (!ehPreview) res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // HSTS: manda o navegador só falar HTTPS com este domínio pelo próximo ano.
  // Sem isso, a PRIMEIRA visita por http:// (link antigo, usuário digitando o
  // domínio, rede hostil) trafega em claro antes do redirect — janela clássica
  // de SSL-strip, séria num app que passa senha e pagamento.
  //
  // Só envia quando a requisição original chegou por HTTPS: o nginx termina o
  // TLS e fala HTTP com o app, então o protocolo real vem no x-forwarded-proto
  // (mandar HSTS numa resposta HTTP é inválido pela spec e ignorado).
  //
  // Deliberadamente SEM `includeSubDomains` e SEM `preload`: com domínio
  // próprio por loja, subdomínio ainda em HTTP quebraria de vez, e `preload` é
  // praticamente irreversível (entra numa lista embutida nos navegadores).
  // Ambos são decisão de negócio, não default técnico.
  if (req.headers['x-forwarded-proto'] === 'https' || (req.socket as { encrypted?: boolean }).encrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

/**
 * Portas de entrada da PLATAFORMA (não de uma marca), declaradas em
 * DOMINIO_PLATAFORMA — lista separada por vírgula, ex.:
 *   DOMINIO_PLATAFORMA=maxxdelivery.app.br,www.maxxdelivery.app.br
 *
 * É nesses domínios (e só neles) que o login procura a conta nos outros
 * tenants. Declarar explicitamente evita depender de o domínio "por acaso" não
 * estar cadastrado como tenant.
 */
const HOSTS_PLATAFORMA = new Set(
  (process.env.DOMINIO_PLATAFORMA || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean),
);

function ehHostDaPlataforma(host: string | undefined): boolean {
  if (!host || HOSTS_PLATAFORMA.size === 0) return false;
  const h = host.toLowerCase().split(':')[0].replace(/^www\./, '');
  return HOSTS_PLATAFORMA.has(h);
}

// ── Multi-tenant (SILO): resolve o tenant pelo domínio e fixa o .db do request.
// Sem match (localhost / domínio não cadastrado) usa o tenant padrão.
// Todo o restante do request roda dentro do contexto desse tenant.
//
// Exceção: header X-Demo-Tenant (slug) tem prioridade sobre o Host — usado
// pela vitrine de demonstração (frontend/src/pages/cliente/demo.tsx) e pelo
// preview do editor Visual, que deixam o visitante navegar numa loja de
// outro tenant sem precisar de domínio/subdomínio próprio configurado.
//
// SÓ é honrado em requisições SEM "Authorization" — nunca em requisições
// autenticadas. Motivo: `autenticar` (auth.ts) carrega o usuário por
// `WHERE id = ?` dentro do tenant já resolvido aqui; se um token válido de
// um tenant fosse aceito junto com X-Demo-Tenant apontando pra outro, um
// `id` que colidir entre os dois bancos (ex.: id=1, comum em todo tenant
// recém-criado) autenticaria como o usuário ERRADO no tenant alvo, sem
// senha nenhuma.
//
// PRIORIDADE MÁXIMA: o tenant embutido no PRÓPRIO token de sessão (claim
// `tenant`, assinado por nós em login/registro/impersonação). Uma sessão
// pertence a UM tenant — então TODA rota da requisição, pública ou privada,
// roda nesse tenant. Sem isso, depois do login as rotas públicas (menu da
// loja, tema…) caíam no tenant errado: o header de demo é ignorado quando há
// Authorization, e rota pública não roda `autenticar` pra ler o claim — a
// loja de demonstração "quebrava" no instante em que o cliente logava.
app.use((req, res, next) => {
  (async () => {
    const dbDoToken = tenantDoToken(req.headers.authorization);
    const tenantDoTokenReq = dbDoToken ? await tenantPorDbNome(dbDoToken) : undefined;

    const semAuth = !req.headers.authorization;
    const slugDemo = semAuth && typeof req.headers['x-demo-tenant'] === 'string' ? req.headers['x-demo-tenant'] : undefined;
    const tenantDemo = slugDemo ? await tenantPorSlug(slugDemo) : undefined;

    const tenantDoHost = await resolverPorHost(req.headers.host);

    // O login precisa distinguir "cheguei pelo domínio de um tenant" de
    // "cheguei pelo domínio da plataforma". Só no segundo caso ele procura a
    // conta nos OUTROS tenants (ver `autenticacao.ts`, POST /login): num
    // domínio de tenant, esse domínio é a fronteira white-label e não pode
    // sequer admitir que contas de outras marcas existem.
    //
    // "Não casou com tenant nenhum" já indica a porta da plataforma, mas isso
    // é frágil: basta alguém cadastrar esse domínio como tenant pra a busca
    // parar de rodar, e o lojista voltar a levar "e-mail ou senha incorretos"
    // sem ninguém entender por quê. DOMINIO_PLATAFORMA (lista separada por
    // vírgula) declara essas portas de forma explícita e vence o palpite.
    //
    // E FOI EXATAMENTE ISSO QUE ACONTECEU. O domínio da plataforma foi cadastrado
    // como domínio do tenant MASTER, então `tenantDoHost` passou a existir, o
    // palpite morreu, e sem `DOMINIO_PLATAFORMA` no .env o login central parou:
    // quem tinha conta em outra marca voltou a levar "e-mail ou senha incorretos"
    // digitando tudo certo, sem redirecionamento nenhum. Perder o login central
    // por causa de uma variável de ambiente esquecida é caro demais.
    //
    // O TENANT MASTER É A PLATAFORMA — isso não é configuração, é definição (`db`
    // igual ao BANCO_PADRAO). Se o Host resolve pro master, esta É a porta da
    // plataforma, e a busca entre tenants pode rodar. Nenhum risco de vazamento
    // white-label: a fronteira que precisa ser respeitada é a do domínio de um
    // CLIENTE, e esse nunca resolve pro master.
    req.hostEhDaPlataforma = ehHostDaPlataforma(req.headers.host)
      || !tenantDoHost
      || ehMaster(tenantDoHost.db_nome);

    /**
     * DOMÍNIO DE CLIENTE SUSPENSO → aviso honesto, não conteúdo de outra pessoa.
     *
     * `resolverPorHost` filtra `ativo = 1`, então tenant cortado não é achado e a
     * requisição caía no `tenantPadrao()`: o domínio do lojista inadimplente
     * passava a entregar A PLATAFORMA — landing de vendas, com preço e "fale com
     * a gente", no endereço dele. Os clientes dele viam outra marca; ele via site
     * alheio e ligava no suporte achando que era bug.
     *
     * Só entra aqui quando NÃO há sessão nem tenant de demo apontando pra outro
     * lugar: assim o próprio lojista, já logado, continua conseguindo abrir o
     * painel pelo token (o claim `tenant` vence o host) e ver o que aconteceu.
     */
    if (!tenantDoTokenReq && !tenantDemo && !tenantDoHost) {
      const suspenso = await tenantDesativadoDoHost(req.headers.host);
      if (suspenso) {
        // 503 + Retry-After: é indisponibilidade temporária, não "não existe".
        // Robô de busca não desindexa a loja por causa de uma mensalidade atrasada.
        res.status(503)
          .setHeader('Retry-After', '3600');
        res.type('html').send(paginaSuspensa(suspenso.nome, await contatoSuporte()));
        return;
      }
    }

    const tenant = tenantDoTokenReq ?? tenantDemo ?? tenantDoHost ?? (await tenantPadrao());
    await comTenant(tenant.db_nome, async () => { next(); });
  })().catch(next);
});

app.use('/api/auth', autenticacaoRoutes);
app.use('/api', publicoRoutes);
app.use('/api/cliente', clienteRoutes);
app.use('/api/lojista', lojistaRoutes);
app.use('/api/entregador', entregadorRoutes);
app.use('/api/cozinha', cozinhaRoutes);
/*
 * DIAGNÓSTICO DE PROXY — diz qual IP o servidor está enxergando como sendo o
 * do cliente.
 *
 * Existe porque ligar o proxy da Cloudflare muda esse IP em silêncio: nada
 * quebra na hora, e o estrago (limitador bloqueando gente inocente) só aparece
 * sob carga. Com isto dá pra conferir antes, em vez de descobrir depois.
 *
 * Não expõe nada sensível: devolve só o que o próprio chamador já mandou.
 */
app.get('/api/diagnostico/ip', (req, res) => {
  res.json({
    ip_visto: req.ip,
    saltos_confiaveis: app.get('trust proxy'),
    via_cloudflare: !!req.headers['cf-connecting-ip'],
    // Quando bate, o app está lendo o IP certo por trás da Cloudflare.
    ip_real_cloudflare: req.headers['cf-connecting-ip'] || null,
    encaminhado_por: req.headers['x-forwarded-for'] || null,
  });
});

app.use('/api/admin', adminRoutes);
app.use('/api/revendedor', revendedorRoutes);
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
  /**
   * `index: false` é essencial, não detalhe.
   *
   * Por padrão o express.static responde `GET /` com o public/index.html CRU,
   * antes de chegar no fallback abaixo — que é quem injeta as meta tags de
   * compartilhamento (og.ts). Resultado observado em produção: /pedido/32 vinha
   * com a marca da loja e a RAIZ vinha sem meta tag nenhuma. E a raiz é
   * exatamente onde mora a vitrine de quem tem domínio próprio, ou seja o link
   * que o lojista mais divulga.
   *
   * Desligando o index automático, `/` cai no fallback como qualquer outra rota
   * do app e recebe o mesmo tratamento.
   */
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback: rotas client-side do React Router devolvem o index.html.
// A loja do domínio vive na raiz por slug (`/minha-loja`, sem prefixo fixo —
// ver App.tsx `<Route path="/:id">`), então qualquer caminho de 1 nível sem
// extensão de arquivo é candidato a rota do app: se não bateu com nenhum
// arquivo estático acima (express.static já resolveu JS/CSS/imagens) e não é
// `/api`, é sempre o React Router que decide o que fazer com ele (inclusive
// mostrar 404 dentro do app, se o slug não existir).
/**
 * Cache do index.html em memória. Ler o arquivo a cada navegação seria I/O de
 * disco no caminho mais quente do app; o arquivo só muda em deploy, e o processo
 * reinicia no deploy.
 */
let htmlBase: string | null = null;
function lerHtmlBase(): string {
  if (htmlBase === null) {
    htmlBase = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  }
  return htmlBase;
}

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();

  /**
   * O HTML do app NUNCA pode ser cacheado: ele é o "ponteiro" que aponta pro
   * bundle com hash mais novo. Cacheado, o navegador prende o usuário numa versão
   * antiga do app indefinidamente (inclusive via PWA instalado).
   *
   * Precisa estar AQUI: quem punha esse header era o `setHeaders` do
   * express.static, e ele só roda quando é o static que responde. Como agora
   * `index: false` manda a raiz pra este handler — e as demais rotas do SPA
   * sempre passaram por aqui — sem esta linha o header simplesmente não ia mais
   * junto. Regressão que eu mesmo introduzi ao mover a raiz pra cá.
   */
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  /**
   * Injeta Open Graph por rota (ver og.ts). WhatsApp/Facebook/Telegram não
   * executam JS, então isto TEM que sair do servidor: antes, o link do pedido
   * mostrava a marca e o texto de venda da plataforma pro consumidor final, em
   * vez da marca da loja onde ele comprou.
   */
  (async () => {
    const meta = await metaDaRota(req.path, req.headers.host);
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const base = `${proto}://${req.headers.host}`;
    res.type('html').send(injetarMeta(lerHtmlBase(), meta, base, base + req.originalUrl));
  })().catch(() => {
    // Falhou montando o preview? Serve o HTML como estava — a página funciona,
    // só o cartão do link sai genérico.
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });
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
  /**
   * Violação de índice ÚNICO não é erro interno: é dado repetido, e quem digitou
   * precisa saber QUAL campo.
   *
   * BUG REAL QUE ISSO CORRIGE: cadastrar entregador com um telefone já usado por
   * outro usuário devolvia 500 "Erro interno do servidor". A tabela `usuarios`
   * tem índice único em telefone e CPF (via coluna gerada), e a rota só tratava
   * e-mail repetido — o lojista clicava três vezes sem entender nada.
   *
   * Fica no tratador CENTRAL de propósito: existem várias rotas que inserem
   * usuário (cliente, lojista, entregador, admin, cozinha) e outras virão.
   * Tratar rota por rota garante esquecer a próxima.
   */
  const dup = mensagemDeDuplicidade(erro);
  if (dup) return res.status(409).json({ erro: dup });

  console.error('[ERRO INTERNO]', erro);
  capturarErro(erro, { metodo: req.method, rota: req.path });
  res.status(500).json({ erro: 'Erro interno do servidor. Tente novamente em instantes.' });
};
app.use(tratadorErros);

/**
 * Tick de horário automático — a cada minuto, abre/fecha as lojas que ativaram
 * o modo automático conforme a agenda semanal. Respeita pausa temporária.
 */
async function sincronizarHorariosDoTenant(): Promise<void> {
  const lojas = await db.prepare(
    `SELECT id, aberta, horario_json, pausado_ate FROM lojas WHERE auto_horario = 1`
  ).all() as Array<{ id: number; aberta: number; horario_json: string; pausado_ate: string }>;
  const agora = agoraUTC();
  for (const loja of lojas) {
    let deveAbrir = lojaAbertaPorAgenda(loja.horario_json);
    if (deveAbrir === null) continue; // sem agenda válida, não mexe
    // Pausa temporária força fechado.
    if (loja.pausado_ate && loja.pausado_ate > agora) deveAbrir = false;
    const alvo = deveAbrir ? 1 : 0;
    if (loja.aberta !== alvo) await db.prepare('UPDATE lojas SET aberta = ? WHERE id = ?').run(alvo, loja.id);
  }
}

/**
 * Manda os XMLs do mês fechado pro contador das lojas que pediram.
 *
 * A decisão de "hoje é dia?" está em envio-contador.ts, testada — o que mora
 * aqui é só a varredura. A marca de competência enviada fica NA LOJA, então
 * rodar isto várias vezes no mesmo dia não manda nada duas vezes.
 */
async function enviarXmlsDoTenant(): Promise<void> {
  const lojas = await db.prepare(
    `SELECT id, nome, slug, nfce_cnpj, nfce_razao_social,
            contador_email, contador_envio_auto, contador_dia_envio, contador_ultima_competencia
       FROM lojas WHERE contador_envio_auto = 1 AND contador_email <> ''`
  ).all() as Array<Record<string, any>>;

  for (const loja of lojas) {
    const { enviar, competencia } = deveEnviar({
      // DATA no fuso do Brasil, nao em UTC: o servidor roda em UTC e das 21h
      // a meia-noite o UTC ja virou o dia seguinte. Com agoraUTC() aqui, quem
      // escolhesse dia 1 receberia a fatura as 21h do ultimo dia do mes
      // anterior — antes de o mes fechar, e sem as vendas do fim da noite.
      hojeIso: dataBrasilia(),
      auto: true,
      temDestinatario: destinatariosDe(loja.contador_email).length > 0,
      diaEnvio: Number(loja.contador_dia_envio) || 5,
      ultimaCompetencia: String(loja.contador_ultima_competencia || ''),
    });
    if (!enviar) continue;
    const r = await enviarPacoteAoContador(loja, competencia);
    console.log(`[CONTADOR] loja ${loja.id} ${competencia}:`,
      r.ok ? `${r.notas} nota(s) enviada(s)` : `falhou — ${r.motivo}`);
  }
}

async function enviarXmlsAoContador(): Promise<void> {
  // Sem SMTP não há envio possível; varrer todos os bancos pra descobrir isso
  // a cada ciclo seria trabalho jogado fora.
  if (!emailHabilitado()) return;
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      await comTenant(tenant.db_nome, enviarXmlsDoTenant);
    } catch (e) {
      // Um cliente com problema não pode impedir o envio dos outros — cada
      // loja tem um contador esperando o próprio pacote.
      console.error(`[CONTADOR] falha no tenant ${tenant.slug}:`, e);
    }
  }
}

/** Roda o tick de horário para CADA tenant (cada um no seu próprio banco). */
async function sincronizarHorarios(): Promise<void> {
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      await comTenant(tenant.db_nome, sincronizarHorariosDoTenant);
    } catch (e) {
      console.error(`[HORARIO AUTO] falha no tenant ${tenant.slug}:`, e);
    }
  }
}

/**
 * Reconciliação do Pix da ONZ em TODOS os tenants: confirma pedido pago cujo
 * webhook não chegou. Ver `reconciliarPagamentosOnz` (rotas/pagamentos.ts) para
 * o porquê — webhook perdido deixava pedido pago preso em "aguardando".
 *
 * Só roda se a ONZ estiver configurada em algum lugar; num ambiente sem ONZ
 * isso evita varrer o banco de graça a cada ciclo.
 */
async function reconciliarPixOnz(): Promise<void> {
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      const r = await comTenant(tenant.db_nome, () => reconciliarPagamentosOnz());
      if (r.confirmados > 0 || r.expirados > 0) {
        console.log(`[onz] reconciliação (${tenant.slug}): ${r.conferidos} pendentes → ${r.confirmados} confirmados, ${r.expirados} cancelados por expiração.`);
      }
    } catch (e) {
      console.error(`[onz] reconciliação falhou no tenant ${tenant.slug}:`, e);
    }
  }
}

/**
 * Reconciliação do CARTÃO (Mercado Pago) em todos os tenants.
 *
 * Existe pelo mesmo motivo da do Pix, e por um caso observado: um pagamento
 * `approved`, com a `notification_url` gravada corretamente dentro do próprio
 * pagamento, que nunca gerou chamada nenhuma ao servidor. Sem esta varredura o
 * pedido fica pago e invisível — o cliente pagou e a loja nunca vê.
 */
async function reconciliarCartaoMP(): Promise<void> {
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      const r = await comTenant(tenant.db_nome, () => reconciliarCartoesMP());
      if (r.confirmados > 0) {
        console.log(`[mercadopago] reconciliação (${tenant.slug}): ${r.conferidos} pendentes → ${r.confirmados} confirmados.`);
      }
      /*
       * Depois de confirmar quem pagou, cancela quem abandonou — nesta ordem,
       * senão um pagamento aprovado com notificação atrasada seria cancelado
       * pelo relógio antes de alguém perguntar ao Mercado Pago.
       */
      const ab = await comTenant(tenant.db_nome, () => cancelarCartoesAbandonados());
      if (ab.cancelados > 0) {
        console.log(`[mercadopago] ${ab.cancelados} pedido(s) de cartão abandonados cancelados em ${tenant.slug} (estoque e cupom devolvidos).`);
      }
    } catch (e) {
      console.error(`[mercadopago] reconciliação falhou no tenant ${tenant.slug}:`, e);
    }
  }
}

/**
 * Aplica o schema (e as migrações idempotentes dentro dele) em TODOS os tenants
 * ativos, no boot.
 *
 * POR QUE ISTO EXISTE: `inicializarSchema` só era chamada por `criarTenant()`,
 * ou seja, apenas quando um tenant NASCIA. Mas é justamente ali que ficam os
 * blocos "coluna nova que CREATE TABLE IF NOT EXISTS não alcança em bancos já
 * criados" — as migrações estavam escritas, corretas e idempotentes, e nada as
 * executava nos bancos existentes. Toda coluna adicionada depois da criação de
 * um tenant ficava faltando pra sempre, e só aparecia como 500 em produção
 * quando alguém abria a tela que a lia (`Unknown column ... in 'field list'`).
 *
 * Falha isolada por tenant, como em `sincronizarHorarios`: um banco com
 * problema não pode impedir o servidor de subir e atender os outros.
 */
async function migrarTenants(): Promise<void> {
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      await inicializarSchema(abrirPool(tenant.db_nome));
    } catch (e) {
      console.error(`[MIGRACAO] falha no tenant ${tenant.slug} (${tenant.db_nome}):`, e);
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;

(async () => {
  await inicializarCentral();
  // Tabelas de assinatura vivem no banco CENTRAL, junto de `tenants` — é a
  // plataforma cobrando o lojista, não a loja cobrando o cliente.
  await inicializarAssinaturas(poolCentral());
  // Antes de aceitar tráfego: sem isso uma coluna nova só falha na cara do
  // usuário, no primeiro request que a consultar.
  await migrarTenants();
  if (process.env.SEED_ON_START === '1') {
    console.log('🌱 SEED_ON_START=1 — rodando seed inicial (idempotente)...');
    const { seed } = await import('./seed');
    // Boot roda fora de request: o banco tem que ser declarado explicitamente
    // (bancoTenantAtual() lança sem contexto — ver db-mysql.ts).
    await comTenant(BANCO_PADRAO, seed);
  }
  /**
   * VENCIMENTOS: uma vez no boot e a cada 6h.
   *
   * 6h e nao 24h de proposito: com um tick diario, o servidor reiniciado logo
   * depois do horario pularia o dia inteiro -- inadimplente seguiria usando, ou
   * pior, quem pagou continuaria suspenso ate a madrugada seguinte. O job e
   * idempotente (so escreve quando o estado MUDA), entao rodar 4x por dia nao
   * custa nada.
   */
  /*
   * TAREFAS DE FUNDO SÓ NA PRIMEIRA INSTÂNCIA.
   *
   * Em modo cluster o PM2 sobe N cópias do processo pra usar todos os núcleos.
   * As rotas HTTP podem (e devem) rodar em todas — mas os jobs, não: N cópias
   * reconciliando o mesmo Pix, fechando a mesma fatura e mandando o mesmo
   * e-mail pro contador significam N chamadas à API do PSP e, no pior caso,
   * cobrança e e-mail duplicados. O `contador_ultima_competencia` protege o
   * envio, mas depender só disso seria contar com sorte de ordenação.
   *
   * `NODE_APP_INSTANCE` é do PM2 e não existe em modo fork nem em `node
   * server.js` na mão — sem ele, tudo roda, que é o comportamento de sempre.
   */
  const instancia = process.env.NODE_APP_INSTANCE;
  const rodarTarefas = instancia === undefined || instancia === '0';
  if (!rodarTarefas) {
    console.log(`[TAREFAS] instância ${instancia}: só atende HTTP (jobs rodam na instância 0).`);
  }

  if (rodarTarefas) {
  processarVencimentos(poolCentral())
    .then(r => { if (r.suspensos || r.reativados) console.log(`[ASSINATURA] ${r.suspensos} suspenso(s), ${r.reativados} reativado(s) de ${r.verificadas}.`); })
    .catch(e => console.error('[ASSINATURA] falha ao processar vencimentos:', e));
  setInterval(() => {
    processarVencimentos(poolCentral())
      .catch(e => console.error('[ASSINATURA] falha ao processar vencimentos:', e));
  }, 6 * 60 * 60_000);

  sincronizarHorarios().catch(e => console.error('[HORARIO AUTO] falha:', e));
  setInterval(() => { sincronizarHorarios().catch(e => console.error('[HORARIO AUTO] falha:', e)); }, 60_000);

  // Reconciliação do Pix ONZ: no boot (pega o que ficou preso enquanto o
  // servidor estava fora) e a cada 5 min. Intervalo folgado de propósito — é
  // uma REDE DE SEGURANÇA, o caminho normal é o webhook (instantâneo); consultar
  // de mais só gastaria chamada na API do PSP.
  //
  // Sem guarda de "ONZ configurada": a credencial pode estar em UMA LOJA e não
  // no ambiente, então checar o env daria falso negativo. Quando não há pedido
  // ONZ pendente, a função sai na primeira consulta (custo desprezível).
  reconciliarPixOnz().catch(e => console.error('[onz] reconciliação falhou:', e));
  setInterval(() => { reconciliarPixOnz().catch(e => console.error('[onz] reconciliação falhou:', e)); }, 5 * 60_000);
  // Mesmo ciclo do Pix: 5 min é curto o bastante pro lojista não perder a
  // venda e longo o bastante pra não martelar a API do Mercado Pago.
  reconciliarCartaoMP().catch(e => console.error('[mercadopago] reconciliação falhou:', e));
  setInterval(() => { reconciliarCartaoMP().catch(e => console.error('[mercadopago] reconciliação falhou:', e)); }, 5 * 60_000);

  // Mantém quente o token da ONZ (vale só 5 min): sem isso, quase todo pedido
  // pagava ~1s de autenticação antes de mostrar o QR, com o cliente esperando.
  setInterval(() => { aquecerTokens().catch(() => { /* melhor esforço */ }); }, 60_000);

  /*
   * Retrato da fatura do mês de cada revendedor, de hora em hora.
   *
   * De hora em hora e não uma vez por mês porque o que fecha a competência é o
   * ÚLTIMO retrato tirado dentro dela: assim, na virada, o valor gravado é de no
   * máximo uma hora antes do fim do mês. Um job mensal que não rodasse (deploy,
   * reboot, servidor fora) deixaria o mês inteiro sem fatura, e ela não pode ser
   * reconstruída depois sem inventar número (ver faturas.ts).
   */
  /*
   * XMLs do mês pro contador. De 6 em 6 horas e não uma vez por dia porque um
   * deploy no horário errado faria o dia inteiro passar sem envio; a marca de
   * competência na loja garante que rodar de novo não manda duas vezes.
   */
  enviarXmlsAoContador().catch(e => console.error('[CONTADOR] falha na varredura inicial:', e));
  setInterval(() => { enviarXmlsAoContador().catch(e => console.error('[CONTADOR] falha na varredura:', e)); }, 6 * 60 * 60_000);

  gravarFaturasDeTodos().catch(e => console.error('[fatura] falha no fechamento inicial:', e));
  setInterval(() => { gravarFaturasDeTodos().catch(e => console.error('[fatura] falha no fechamento:', e)); }, 60 * 60_000);

  } // fim das tarefas de fundo

  app.listen(PORT, () => {
    // Esta mensagem é só informativa (endereço LOCAL do processo). Em produção,
    // é a plataforma de hospedagem (ex.: Hostinger) que encaminha o SEU DOMÍNIO
    // pra esta porta por trás dos panos — "localhost" aqui não significa que o
    // app está preso à máquina local.
    console.log(`✅ Delivery Multi-lojas ouvindo na porta ${PORT} (acesse pelo seu domínio em produção)`);
    console.log('   Local p/ testes: http://localhost:' + PORT + '/');
  });
})().catch(e => {
  console.error('❌ Falha fatal ao inicializar (registro central de tenants):', e);
  process.exit(1);
});
