/**
 * Control plane do multi-tenant (SILO) — versão MySQL de tenants.ts.
 *
 * Antes: um banco central `_central.db` (SQLite) guardava o registro de
 * tenants (nome, slug, domínio, arquivo .db). Agora: uma tabela `tenants`
 * dentro de um banco MySQL "central" dedicado (`MYSQL_DATABASE_CENTRAL`) guarda
 * o mesmo registro, trocando `db_arquivo` (caminho de arquivo) por `db_nome`
 * (nome do banco MySQL do tenant).
 *
 * IMPORTANTE (decisão da Etapa 1): o usuário MySQL da Hostinger NÃO tem
 * privilégio CREATE DATABASE. Isso significa que `criarTenant()` NÃO cria o
 * banco do tenant — ele só registra a linha, e exige que o banco MySQL
 * correspondente já exista (criado manualmente no hPanel antes). Se o banco
 * não existir/não for alcançável, `criarTenant()` falha com erro claro em vez
 * de silenciosamente deixar o tenant quebrado.
 */
import { Pool } from 'mysql2/promise';
import { abrirPool, garantirColuna, criarBancoSeNaoExiste } from './db-mysql';
import { inicializarSchema } from './schema-mysql';
import { basesDe, slugDoHost, urlDeSlug } from './dominio-base';
import { agoraUTC } from './util';

/**
 * Prefixo obrigatório do nome do banco de qualquer tenant provisionado
 * automaticamente. Existe porque o usuário MySQL do app só tem privilégio
 * CREATE/DROP escopado a esse padrão (`tenant\_%`, ver GRANT no servidor) —
 * nunca privilégio geral. Provisionamento automático só é tentado quando o
 * nome bate com esse prefixo; fora disso, cai no fluxo manual de sempre.
 */
const PREFIXO_AUTO_CRIACAO = process.env.MYSQL_TENANT_PREFIX || 'tenant_';

const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';
const BANCO_PADRAO = process.env.MYSQL_DATABASE || '';

export function poolCentral(): Pool {
  if (!BANCO_CENTRAL) throw new Error('MYSQL_DATABASE_CENTRAL (ou MYSQL_DATABASE) não configurado.');
  return abrirPool(BANCO_CENTRAL);
}

export interface Tenant {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  db_nome: string;
  ativo: 0 | 1;
  criado_em: string;
  /** Revendedor dono deste cliente — null quando veio direto da plataforma. */
  revendedor_id?: number | null;
}

export interface Revendedor {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  documento: string;
  /** Quanto ELE paga por cliente ativo. O que cobra do cliente final é dele. */
  custo_centavos: number;
  ativo: 0 | 1;
  bloqueado: 0 | 1;
  criado_em: string;
}

/** Cria a tabela `tenants` no banco central e garante o tenant padrão. Chamar uma vez no boot. */
export async function inicializarCentral(): Promise<void> {
  const pool = poolCentral();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      nome        TEXT    NOT NULL,
      slug        VARCHAR(60) NOT NULL UNIQUE,
      dominio     VARCHAR(255) UNIQUE,
      db_nome     VARCHAR(120) NOT NULL,
      ativo       TINYINT NOT NULL DEFAULT 1,
      criado_em   VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  /*
   * REVENDEDORES — quem traz clientes e cobra deles por fora.
   *
   * Vive no banco CENTRAL, junto de `tenants`, porque um revendedor atravessa
   * vários clientes: guardá-lo no banco de um deles seria escolher um dono
   * arbitrário e perder o vínculo no dia em que esse cliente saísse.
   *
   * `custo_centavos` é o que ELE paga por cliente ativo. O que ele cobra do
   * cliente final é problema dele — a plataforma não sabe nem precisa saber.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS revendedores (
      id             INT PRIMARY KEY AUTO_INCREMENT,
      nome           TEXT NOT NULL,
      email          VARCHAR(255) NOT NULL UNIQUE,
      senha_hash     TEXT NOT NULL,
      telefone       VARCHAR(30) NOT NULL DEFAULT '',
      documento      VARCHAR(20) NOT NULL DEFAULT '',
      custo_centavos INT NOT NULL DEFAULT 0,
      ativo          TINYINT NOT NULL DEFAULT 1,
      bloqueado      TINYINT NOT NULL DEFAULT 0,
      criado_em      VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  /*
   * SEM foreign key de propósito: revendedor removido não pode levar junto o
   * cliente dele. O vínculo vira NULL e o cliente continua de pé, atendendo.
   */
  await garantirColuna(pool, BANCO_CENTRAL, 'tenants', 'revendedor_id', 'revendedor_id INT NULL');

  /*
   * MÓDULOS ADICIONAIS — os valores extras além da mensalidade.
   *
   * Isto é COBRANÇA, não permissão. Ligar um módulo num cliente soma na conta
   * do revendedor; não habilita nem bloqueia nada no painel dele. Quem controla
   * acesso continua sendo o super admin, na mão.
   *
   * Está escrito aqui porque a confusão é fácil: "cliente tem o módulo NFC-e"
   * soa como permissão, e alguém um dia vai assumir que desligar tira o
   * recurso. Não tira.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modulos (
      id        INT PRIMARY KEY AUTO_INCREMENT,
      nome      VARCHAR(80) NOT NULL,
      descricao TEXT,
      preco_centavos INT NOT NULL DEFAULT 0,
      ativo     TINYINT NOT NULL DEFAULT 1,
      criado_em VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  /*
   * O PREÇO É COPIADO na hora de ligar, não lido do módulo.
   *
   * Sem isso, reajustar o módulo mudaria retroativamente o que já foi
   * combinado com cada revendedor — e a conta do mês passado deixaria de bater
   * com o que foi cobrado. Assim o reajuste vale só pros próximos.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modulos_cliente (
      id             INT PRIMARY KEY AUTO_INCREMENT,
      tenant_id      INT NOT NULL,
      modulo_id      INT NOT NULL,
      preco_centavos INT NOT NULL,
      criado_em      VARCHAR(32) NOT NULL,
      UNIQUE KEY uq_modulo_cliente (tenant_id, modulo_id),
      KEY idx_mc_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  /*
   * SOLICITAÇÕES DE CLIENTE — o revendedor pede, o super admin aprova.
   *
   * A solicitação NÃO cria nada: guarda o formulário e espera. O banco só é
   * provisionado na aprovação — se a resposta for "não", não sobra banco órfão
   * na infraestrutura, e o slug continua livre pra outra pessoa.
   *
   * A senha do responsável vem JÁ EM HASH. Uma fila com senha em claro seria
   * um depósito de credencial esperando alguém ler o banco central.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitacoes_cliente (
      id             INT PRIMARY KEY AUTO_INCREMENT,
      revendedor_id  INT NOT NULL,
      nome           TEXT NOT NULL,
      slug           VARCHAR(60) NOT NULL,
      nome_loja      TEXT NOT NULL,
      categoria      VARCHAR(50) NOT NULL DEFAULT 'Outros',
      dono_nome      TEXT NOT NULL,
      dono_email     VARCHAR(255) NOT NULL,
      dono_telefone  VARCHAR(30) NOT NULL DEFAULT '',
      senha_hash     TEXT NOT NULL,
      status         VARCHAR(12) NOT NULL DEFAULT 'pendente',
      motivo_recusa  TEXT,
      tenant_id      INT NULL,
      criado_em      VARCHAR(32) NOT NULL,
      decidido_em    VARCHAR(32) NOT NULL DEFAULT '',
      KEY idx_solic_revendedor (revendedor_id),
      KEY idx_solic_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // coluna dominio pode ter sido criada NOT NULL em versões antigas de teste — no-op se já ok.
  await garantirColuna(pool, BANCO_CENTRAL, 'tenants', 'ativo', 'ativo TINYINT NOT NULL DEFAULT 1');

  const [linhas] = await pool.query('SELECT COUNT(*) AS n FROM tenants');
  const n = (linhas as Array<{ n: number }>)[0].n;
  if (n === 0) {
    if (!BANCO_PADRAO) throw new Error('MYSQL_DATABASE (banco padrão) não configurado.');
    await pool.query(
      `INSERT INTO tenants (nome, slug, dominio, db_nome, ativo, criado_em) VALUES (?, ?, NULL, ?, 1, ?)`,
      ['Padrão', 'padrao', BANCO_PADRAO, agoraUTC()],
    );
  }
}

/** O tenant master é o banco padrão — só ele gerencia os outros tenants. */
export function ehMaster(dbNome: string): boolean {
  return dbNome === BANCO_PADRAO;
}

function normalizarHost(host: string): string {
  return host.split(':')[0].toLowerCase().replace(/^www\./, '');
}

/*
 * DOMINIO_BASE aceita LISTA separada por vírgula — o primeiro é o canônico.
 * Regras e testes em dominio-base.ts. Lido a cada uso (e não uma vez no
 * import) pra que trocar a variável e reiniciar baste, sem depender da ordem
 * em que os módulos carregam.
 */
const basesAtuais = () => basesDe(process.env.DOMINIO_BASE);

/**
 * Resolve o tenant pela URL da requisição. Ordem:
 *  1) Domínio próprio do cliente (match exato — CNAME). Tem prioridade.
 *  2) Subdomínio sob o domínio base: `<slug>.seuapp.com` (wildcard).
 */
export async function resolverPorHost(host: string | undefined): Promise<Tenant | null> {
  if (!host) return null;
  const h = normalizarHost(host);
  const pool = poolCentral();

  const [exatoRows] = await pool.query('SELECT * FROM tenants WHERE dominio = ? AND ativo = 1', [h]);
  const exato = (exatoRows as Tenant[])[0];
  if (exato) return exato;

  const sub = slugDoHost(h, basesAtuais());
  if (sub) {
    const [subRows] = await pool.query('SELECT * FROM tenants WHERE slug = ? AND ativo = 1', [sub]);
    const porSlug = (subRows as Tenant[])[0];
    if (porSlug) return porSlug;
  }
  return null;
}

/**
 * Endereço público de um tenant — o caminho inverso de `resolverPorHost`:
 * domínio próprio, senão `<slug>.<DOMINIO_BASE>`. Devolve null quando não dá
 * pra montar URL nenhuma (sem domínio e sem DOMINIO_BASE configurado) — aí não
 * há pra onde redirecionar.
 */
/**
 * Slugs que NÃO podem virar tenant, porque virariam subdomínio real.
 *
 * COM `DOMINIO_BASE` LIGADO, O SLUG É UM ENDEREÇO. `resolverPorHost` casa
 * `<slug>.<base>` com o tenant de mesmo slug — então um cliente cadastrado como
 * `www` passaria a RESPONDER por `www.seudominio`, e o site principal viraria a
 * loja dele. O mesmo vale pra `api`, `mail`, `admin`: são nomes que já existem, ou
 * vão existir, como serviço da plataforma.
 *
 * A hora de barrar é no cadastro. Depois de criado, o tenant já tem banco, loja e
 * gente logando — desfazer é bem mais caro do que recusar o nome na frente.
 */
const SLUGS_RESERVADOS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp',
  'ns', 'ns1', 'ns2', 'dns', 'mx', 'cdn', 'static', 'assets', 'uploads',
  'painel', 'plataforma', 'suporte', 'ajuda', 'blog', 'status', 'docs',
  'lojista', 'entregador', 'cozinha', 'kds', 'cliente', 'pdv', 'checkout',
  'pay', 'pagamento', 'webhook', 'webhooks', 'auth', 'login', 'sso',
  'test', 'teste', 'dev', 'staging', 'homolog', 'demo', 'localhost',
]);

/**
 * Diz por que um slug de tenant não serve, ou null se está tudo bem.
 * Devolver a MENSAGEM (e não um booleano) porque "slug inválido" sozinho manda
 * quem cadastra ficar tentando adivinhar o que a regra é.
 */
export function problemaNoSlugTenant(slug: string): string | null {
  const s = String(slug || '').trim().toLowerCase();
  if (s.length < 2) return 'O endereço precisa de pelo menos 2 caracteres.';
  if (s.length > 40) return 'O endereço ficou longo demais (máx. 40 caracteres).';
  if (!/^[a-z0-9-]+$/.test(s)) return 'Use só letras minúsculas, números e hífen.';
  // Hífen na ponta é nome de host inválido; sequência dupla confunde e é
  // reservada pelo padrão IDN ("xn--").
  if (s.startsWith('-') || s.endsWith('-')) return 'O endereço não pode começar nem terminar com hífen.';
  if (s.includes('--')) return 'O endereço não pode ter dois hífens seguidos.';
  if (SLUGS_RESERVADOS.has(s)) return `"${s}" é um endereço reservado da plataforma. Escolha outro.`;
  return null;
}

export function urlDoTenant(tenant: Tenant): string | null {
  if (tenant.dominio) return `https://${tenant.dominio}`;
  // Sempre a base CANÔNICA (a primeira): é o endereço que se entrega ao
  // cliente. As outras seguem funcionando, mas não são o que se divulga.
  return urlDeSlug(tenant.slug, basesAtuais());
}

/** Tenant padrão (fallback para localhost / domínios não cadastrados). */
export async function tenantPadrao(): Promise<Tenant> {
  const pool = poolCentral();
  const [porBanco] = await pool.query('SELECT * FROM tenants WHERE db_nome = ? ORDER BY id LIMIT 1', [BANCO_PADRAO]);
  const t = (porBanco as Tenant[])[0];
  if (t) return t;
  const [qualquer] = await pool.query('SELECT * FROM tenants ORDER BY id LIMIT 1');
  return (qualquer as Tenant[])[0];
}

/**
 * Remove um cliente: apaga o registro e, se o banco tiver sido criado pelo
 * sistema, dropa o banco junto.
 *
 * O QUE ELA SE RECUSA A FAZER, e por quê:
 *
 *  - O TENANT PADRÃO (banco da plataforma) nunca. Dropar ele apagaria o
 *    cadastro de todos os outros clientes junto — o registro deles vive lá.
 *  - Banco que NÃO nasceu do prefixo automático fica de pé. Se alguém apontou
 *    um banco existente na mão, ele pode ser compartilhado ou ter história
 *    anterior à plataforma; apagar seria destruir o que não é nosso.
 *
 * Devolve o que aconteceu com o banco pra tela poder dizer a verdade em vez de
 * um "excluído" genérico.
 */
export async function removerTenant(id: number): Promise<{ nome: string; bancoApagado: boolean }> {
  const pool = poolCentral();
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [id]);
  const t = (rows as Tenant[])[0];
  if (!t) throw new Error('Cliente não encontrado.');
  if (BANCO_PADRAO && t.db_nome === BANCO_PADRAO) {
    throw new Error('Este é o cliente principal da plataforma e não pode ser excluído.');
  }

  await pool.query('DELETE FROM tenants WHERE id = ?', [id]);

  let bancoApagado = false;
  if (t.db_nome.startsWith(PREFIXO_AUTO_CRIACAO)) {
    // Crase no nome: nome de banco não entra como parâmetro em DDL, e o
    // prefixo já garante que ele veio de dbNomeDoTenant (a-z, 0-9 e _).
    await pool.query(`DROP DATABASE IF EXISTS \`${t.db_nome}\``);
    bancoApagado = true;
  }
  return { nome: t.nome, bancoApagado };
}

export async function listarTenants(): Promise<Tenant[]> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants ORDER BY id');
  return rows as Tenant[];
}

export async function tenantPorId(id: number | string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE id = ?', [id]);
  return (rows as Tenant[])[0];
}

export async function tenantPorSlug(slug: string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE slug = ? AND ativo = 1', [slug]);
  return (rows as Tenant[])[0];
}

export async function tenantPorDbNome(dbNome: string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE db_nome = ?', [dbNome]);
  return (rows as Tenant[])[0];
}

/** O banco MySQL alvo já existe e está alcançável com as credenciais atuais? */
async function bancoAlcancavel(dbNome: string): Promise<boolean> {
  try {
    const pool = abrirPool(dbNome);
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra um tenant novo. Se o banco MySQL de destino já tem o prefixo
 * de auto-criação (`MYSQL_TENANT_PREFIX`, ver acima), tenta criá-lo sozinho
 * (o usuário do app tem privilégio CREATE escopado a esse padrão). Fora
 * desse padrão — ex.: MySQL gerenciado sem privilégio CREATE nenhum, como
 * era na Hostinger — exige que o banco já exista, criado manualmente antes.
 * De qualquer forma, roda o schema completo nele (idempotente) no final.
 */
export async function criarTenant(dados: { nome: string; slug: string; dominio?: string | null; dbNome: string }): Promise<Tenant> {
  const slug = dados.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (slug.length < 2) throw new Error('Slug inválido.');

  let alcancavel = await bancoAlcancavel(dados.dbNome);
  if (!alcancavel && dados.dbNome.startsWith(PREFIXO_AUTO_CRIACAO)) {
    try {
      await criarBancoSeNaoExiste(dados.dbNome);
      alcancavel = await bancoAlcancavel(dados.dbNome);
    } catch { /* segue pro erro claro abaixo se ainda não alcançável */ }
  }
  if (!alcancavel) {
    throw new Error(
      `O banco MySQL "${dados.dbNome}" não existe ou não está alcançável. Crie-o manualmente ` +
      `(hPanel ou terminal do servidor) com este nome exato antes de cadastrar o tenant.`,
    );
  }

  await inicializarSchema(abrirPool(dados.dbNome));

  const pool = poolCentral();
  const [resultado] = await pool.query(
    `INSERT INTO tenants (nome, slug, dominio, db_nome, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)`,
    [dados.nome, slug, dados.dominio?.trim().toLowerCase() || null, dados.dbNome, agoraUTC()],
  );
  const id = (resultado as { insertId: number }).insertId;
  return (await tenantPorId(id))!;
}

export async function atualizarTenant(id: number, campos: Partial<Pick<Tenant, 'nome' | 'dominio' | 'ativo'>>): Promise<void> {
  const atual = await tenantPorId(id);
  if (!atual) throw new Error('Tenant não encontrado.');

  /**
   * REATIVAR TENANT MIGRA O SCHEMA DELE — antes não migrava, e isso deixava um
   * tenant atendendo requisição com banco desatualizado.
   *
   * A sequência que produzia o bug:
   *   1. tenant criado (schema em dia — criarTenant roda inicializarSchema)
   *   2. tenant desativado (ativo = 0)
   *   3. deploy com migração nova → `migrarTenants` no boot PULA inativo
   *      (`if (!tenant.ativo) continue`, em server.ts)
   *   4. tenant reativado → volta a atender com o schema do passo 1
   * Resultado: `Unknown column '<coluna nova>' in 'field list'` na cara do
   * lojista, na primeira tela que consultasse a coluna. Exatamente o erro que
   * apareceu no log de produção.
   *
   * Migrar aqui, e não deixar de pular inativo no boot, é de propósito: banco de
   * tenant parado pode ter sido apagado, e tentar migrar isso a cada boot só
   * enche o log de erro que ninguém vai agir. Na reativação, a migração é
   * exatamente o que se quer — e se falhar, é melhor a reativação falhar do que
   * ficar de pé pela metade.
   */
  const estaReativando = campos.ativo === 1 && atual.ativo === 0;
  if (estaReativando) {
    await inicializarSchema(abrirPool(atual.db_nome));
  }

  await poolCentral().query('UPDATE tenants SET nome = ?, dominio = ?, ativo = ? WHERE id = ?', [
    campos.nome ?? atual.nome,
    campos.dominio !== undefined ? (campos.dominio?.trim().toLowerCase() || null) : atual.dominio,
    campos.ativo !== undefined ? campos.ativo : atual.ativo,
    id,
  ]);
}

/**
 * Tenant DESATIVADO que é dono deste host.
 *
 * `resolverPorHost` filtra `ativo = 1` de propósito (domínio de cliente cortado
 * não deve servir a loja). Mas o efeito colateral era pior que o problema: sem
 * achar tenant, o middleware caía no `tenantPadrao()` e o domínio do cliente
 * passava a entregar A PLATAFORMA — a landing de vendas, com preço e "fale com a
 * gente", no endereço do lojista inadimplente. Os clientes dele viam outra marca,
 * e ele via site alheio e ligava no suporte achando que era bug.
 *
 * Esta função responde "existe um tenant aqui, só está desativado?" pra o
 * servidor poder mostrar um aviso honesto em vez de conteúdo de outra pessoa.
 */
export async function tenantDesativadoDoHost(host: string | undefined): Promise<Tenant | null> {
  if (!host) return null;
  const h = normalizarHost(host);
  const pool = poolCentral();

  const [porDominio] = await pool.query('SELECT * FROM tenants WHERE dominio = ? AND ativo = 0', [h]);
  const achado = (porDominio as Tenant[])[0];
  if (achado) return achado;

  // Mesma regra da resolução normal: o aviso de "cliente desativado" tem que
  // valer nos dois domínios, senão o endereço antigo mostraria a loja errada
  // em vez do aviso.
  const sub = slugDoHost(h, basesAtuais());
  if (sub) {
    const [porSlug] = await pool.query('SELECT * FROM tenants WHERE slug = ? AND ativo = 0', [sub]);
    return (porSlug as Tenant[])[0] || null;
  }
  return null;
}
