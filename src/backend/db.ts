/**
 * Conexão com o banco SQLite e criação do schema.
 *
 * Decisões (compatíveis com a migração futura para PostgreSQL):
 *  - Valores monetários em CENTAVOS (INTEGER) — vira BIGINT/NUMERIC no Postgres
 *  - Datas em UTC ISO-8601 (TEXT) — vira TIMESTAMPTZ no Postgres
 *  - Booleans como INTEGER 0/1
 *  - PRAGMA foreign_keys = ON (integridade referencial)
 *  - Nenhum recurso exclusivo do SQLite além de AUTOINCREMENT implícito
 */
import path from 'path';
import fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import Database from 'better-sqlite3';

/**
 * Multi-tenant SILO: cada tenant (cliente do SaaS) tem o próprio arquivo .db.
 * A conexão é resolvida POR REQUISIÇÃO via AsyncLocalStorage; fora de um request
 * (boot, jobs) cai no tenant padrão. O `db` exportado é um proxy que sempre
 * aponta para a conexão do tenant atual — assim nenhuma query precisa mudar.
 */
type Conexao = Database.Database;

const ARQUIVO_PADRAO = process.env.DB_ARQUIVO || './dados/delivery.db';
const conexoes = new Map<string, Conexao>();
const contexto = new AsyncLocalStorage<{ arquivo: string }>();

/** Abre (ou reusa do cache) a conexão de um .db, criando schema/migrações. */
export function abrirBanco(arquivo: string): Conexao {
  const existente = conexoes.get(arquivo);
  if (existente) return existente;
  const dir = path.dirname(path.resolve(arquivo));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(path.resolve(arquivo));
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  inicializarBanco(conn);
  conexoes.set(arquivo, conn);
  return conn;
}

/** Roda `fn` no contexto de um tenant (define qual .db o `db` vai usar). */
export function comTenant<T>(arquivo: string, fn: () => T): T {
  return contexto.run({ arquivo }, fn);
}

/** Conexão do tenant atual (ou o padrão, fora de request). */
function conexaoAtual(): Conexao {
  const ctx = contexto.getStore();
  return abrirBanco(ctx?.arquivo ?? ARQUIVO_PADRAO);
}

/** Arquivo .db do tenant atual (ou o padrão, fora de request). */
export function arquivoTenantAtual(): string {
  return contexto.getStore()?.arquivo ?? ARQUIVO_PADRAO;
}

/** Cria todo o schema e roda as migrações idempotentes numa conexão. */
function inicializarBanco(db: Conexao) {
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  senha_hash  TEXT    NOT NULL,
  perfil      TEXT    NOT NULL CHECK (perfil IN ('cliente','lojista','entregador','admin')),
  telefone    TEXT,
  bloqueado   INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS lojas (
  id                  INTEGER PRIMARY KEY,
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
  nome                TEXT    NOT NULL,
  descricao           TEXT    NOT NULL DEFAULT '',
  categoria           TEXT    NOT NULL DEFAULT 'Outros',
  endereco            TEXT    NOT NULL DEFAULT '',
  taxa_entrega_centavos INTEGER NOT NULL DEFAULT 0 CHECK (taxa_entrega_centavos >= 0),
  tempo_estimado_min  INTEGER NOT NULL DEFAULT 40 CHECK (tempo_estimado_min > 0),
  horario_funcionamento TEXT  NOT NULL DEFAULT '',
  status_aprovacao    TEXT    NOT NULL DEFAULT 'pendente'
                      CHECK (status_aprovacao IN ('pendente','aprovada','suspensa')),
  aberta              INTEGER NOT NULL DEFAULT 0,
  criado_em           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY,
  loja_id         INTEGER NOT NULL REFERENCES lojas(id),
  nome            TEXT    NOT NULL,
  descricao       TEXT    NOT NULL DEFAULT '',
  categoria       TEXT    NOT NULL DEFAULT 'Geral',
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos > 0),
  foto_url        TEXT    NOT NULL DEFAULT '',
  disponivel      INTEGER NOT NULL DEFAULT 1,
  excluido        INTEGER NOT NULL DEFAULT 0,
  criado_em       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS grupos_opcoes (
  id           INTEGER PRIMARY KEY,
  produto_id   INTEGER NOT NULL REFERENCES produtos(id),
  nome         TEXT    NOT NULL,
  tipo         TEXT    NOT NULL DEFAULT 'unico' CHECK (tipo IN ('unico','multiplo')),
  obrigatorio  INTEGER NOT NULL DEFAULT 0,
  max_escolhas INTEGER NOT NULL DEFAULT 0,
  ordem        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opcoes_itens (
  id                       INTEGER PRIMARY KEY,
  grupo_id                 INTEGER NOT NULL REFERENCES grupos_opcoes(id),
  nome                     TEXT    NOT NULL,
  preco_adicional_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_adicional_centavos >= 0),
  disponivel               INTEGER NOT NULL DEFAULT 1,
  ordem                    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_grupos_produto  ON grupos_opcoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_opcoes_grupo    ON opcoes_itens(grupo_id);
CREATE INDEX IF NOT EXISTS idx_produtos_loja    ON produtos(loja_id);

CREATE TABLE IF NOT EXISTS enderecos (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  rotulo      TEXT    NOT NULL DEFAULT 'Casa',
  rua         TEXT    NOT NULL,
  numero      TEXT    NOT NULL,
  complemento TEXT    NOT NULL DEFAULT '',
  bairro      TEXT    NOT NULL,
  cidade      TEXT    NOT NULL,
  uf          TEXT    NOT NULL,
  cep         TEXT    NOT NULL DEFAULT '',
  referencia  TEXT    NOT NULL DEFAULT '',
  criado_em   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                    INTEGER PRIMARY KEY,
  cliente_id            INTEGER NOT NULL REFERENCES usuarios(id),
  loja_id               INTEGER NOT NULL REFERENCES lojas(id),
  entregador_id         INTEGER REFERENCES usuarios(id),
  status                TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','aceito','preparando','pronto',
                                          'em_entrega','entregue','cancelado','recusado')),
  endereco_entrega      TEXT NOT NULL,
  forma_pagamento       TEXT NOT NULL CHECK (forma_pagamento IN ('pix','dinheiro','cartao_entrega')),
  troco_para_centavos   INTEGER,
  observacoes           TEXT NOT NULL DEFAULT '',
  subtotal_centavos     INTEGER NOT NULL,
  taxa_entrega_centavos INTEGER NOT NULL,
  total_centavos        INTEGER NOT NULL,
  comissao_percentual   REAL    NOT NULL,
  comissao_centavos     INTEGER NOT NULL,
  pagamento_status      TEXT NOT NULL DEFAULT 'na_entrega'
                        CHECK (pagamento_status IN ('na_entrega','aguardando','aprovado','recusado')),
  pagamento_gateway     TEXT,
  pagamento_gateway_id  TEXT,
  motivo_recusa         TEXT,
  criado_em             TEXT NOT NULL,
  atualizado_em         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historico_status (
  id         INTEGER PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  status     TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id                   INTEGER PRIMARY KEY,
  pedido_id            INTEGER NOT NULL REFERENCES pedidos(id),
  produto_id           INTEGER NOT NULL REFERENCES produtos(id),
  nome_produto         TEXT    NOT NULL,
  preco_unit_centavos  INTEGER NOT NULL,
  quantidade           INTEGER NOT NULL CHECK (quantidade > 0)
);

CREATE TABLE IF NOT EXISTS banners (
  id        INTEGER PRIMARY KEY,
  titulo    TEXT    NOT NULL,
  imagem    TEXT    NOT NULL,
  loja_id   INTEGER REFERENCES lojas(id),
  link_url  TEXT,
  ordem     INTEGER NOT NULL DEFAULT 0,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos_notificacao (
  id         INTEGER PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  evento     TEXT    NOT NULL,
  canal      TEXT    NOT NULL DEFAULT 'pendente_configuracao',
  payload    TEXT    NOT NULL DEFAULT '{}',
  enviado    INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS notas_fiscais (
  id            INTEGER PRIMARY KEY,
  loja_id       INTEGER NOT NULL REFERENCES lojas(id),
  pedido_id     INTEGER REFERENCES pedidos(id),   -- NULL = nota de teste/avulsa
  modelo        TEXT    NOT NULL DEFAULT '65',     -- 65 = NFC-e
  serie         INTEGER NOT NULL,
  numero        INTEGER NOT NULL,
  chave         TEXT    NOT NULL,                  -- 44 dígitos
  ambiente      INTEGER NOT NULL,                 -- 1=produção 2=homologação
  status        TEXT    NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','autorizada','rejeitada','cancelada','erro')),
  c_stat        TEXT    NOT NULL DEFAULT '',       -- código de retorno da SEFAZ
  motivo        TEXT    NOT NULL DEFAULT '',       -- xMotivo da SEFAZ
  protocolo     TEXT    NOT NULL DEFAULT '',       -- nProt (autorização)
  xml           TEXT    NOT NULL DEFAULT '',       -- XML assinado (ou nfeProc autorizado)
  qr_url        TEXT    NOT NULL DEFAULT '',
  total_centavos INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT    NOT NULL,
  autorizada_em TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja     ON pedidos(loja_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status   ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_itens_pedido     ON itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_hist_pedido      ON historico_status(pedido_id);
CREATE INDEX IF NOT EXISTS idx_notas_loja       ON notas_fiscais(loja_id);
CREATE INDEX IF NOT EXISTS idx_notas_pedido     ON notas_fiscais(pedido_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notas_chave ON notas_fiscais(chave);
`);

// Migrações leves (adiciona colunas que vieram em versões posteriores)
function garantirColuna(tabela: string, coluna: string, ddl: string): void {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  if (!colunas.some(c => c.name === coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
  }
}
garantirColuna('produtos', 'preco_promocional_centavos', 'preco_promocional_centavos INTEGER');
garantirColuna('produtos', 'serve_pessoas', 'serve_pessoas INTEGER');
garantirColuna('produtos', 'destaque', 'destaque INTEGER NOT NULL DEFAULT 0');
garantirColuna('produtos', 'subcategoria', "subcategoria TEXT NOT NULL DEFAULT ''");
// Venda por peso (balança): 'un' = unidade, 'kg' = preço por quilo (operador informa o peso).
garantirColuna('produtos', 'vendido_por', "vendido_por TEXT NOT NULL DEFAULT 'un'");
// Código de barras (EAN) ou PLU para leitura no PDV / etiqueta de balança.
garantirColuna('produtos', 'codigo_barras', "codigo_barras TEXT NOT NULL DEFAULT ''");
// Dados fiscais do produto (NFC-e). Valores padrão genéricos — o contador ajusta.
garantirColuna('produtos', 'ncm', "ncm TEXT NOT NULL DEFAULT ''");                    // 8 dígitos
garantirColuna('produtos', 'cfop', "cfop TEXT NOT NULL DEFAULT '5102'");              // venda dentro do estado
garantirColuna('produtos', 'csosn', "csosn TEXT NOT NULL DEFAULT '102'");            // Simples Nacional
garantirColuna('produtos', 'origem', "origem TEXT NOT NULL DEFAULT '0'");            // 0 = nacional
garantirColuna('produtos', 'unidade_comercial', "unidade_comercial TEXT NOT NULL DEFAULT 'UN'");
garantirColuna('produtos', 'cest', "cest TEXT NOT NULL DEFAULT ''");                  // opcional (ST)
// Controle de estoque: quando controla_estoque=1, o produto some/bloqueia ao chegar em 0.
// estoque só é relevante quando controla_estoque=1; -1 = ignorado (sem controle).
garantirColuna('produtos', 'controla_estoque', 'controla_estoque INTEGER NOT NULL DEFAULT 0');
garantirColuna('produtos', 'estoque', 'estoque INTEGER NOT NULL DEFAULT 0');
garantirColuna('itens_pedido', 'opcoes_texto', "opcoes_texto TEXT NOT NULL DEFAULT ''");
garantirColuna('itens_pedido', 'opcoes_ids', "opcoes_ids TEXT NOT NULL DEFAULT '[]'");

// Rastreamento ao vivo do entregador: última posição GPS reportada no pedido.
garantirColuna('pedidos', 'entregador_lat', 'entregador_lat REAL');
garantirColuna('pedidos', 'entregador_lng', 'entregador_lng REAL');
garantirColuna('pedidos', 'entregador_local_em', "entregador_local_em TEXT NOT NULL DEFAULT ''");

// Tabelas adicionais (features de venda: zonas de entrega e avaliações).
db.exec(`
CREATE TABLE IF NOT EXISTS zonas_entrega (
  id            INTEGER PRIMARY KEY,
  loja_id       INTEGER NOT NULL REFERENCES lojas(id),
  bairro        TEXT    NOT NULL,
  taxa_centavos INTEGER NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  criado_em     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zonas_loja ON zonas_entrega(loja_id);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id           INTEGER PRIMARY KEY,
  pedido_id    INTEGER NOT NULL REFERENCES pedidos(id),
  loja_id      INTEGER NOT NULL REFERENCES lojas(id),
  cliente_id   INTEGER NOT NULL REFERENCES usuarios(id),
  nota         INTEGER NOT NULL CHECK (nota >= 1 AND nota <= 5),
  comentario   TEXT    NOT NULL DEFAULT '',
  resposta     TEXT    NOT NULL DEFAULT '',
  criado_em    TEXT    NOT NULL,
  UNIQUE (pedido_id)
);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_loja ON avaliacoes(loja_id);

-- Inscrições de Web Push (notificações no celular mesmo com o app fechado).
-- Cada dispositivo/navegador do usuário gera uma inscrição única (endpoint).
CREATE TABLE IF NOT EXISTS push_inscricoes (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  endpoint    TEXT    NOT NULL UNIQUE,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  criado_em   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_usuario ON push_inscricoes(usuario_id);

-- Lojas favoritas do cliente.
CREATE TABLE IF NOT EXISTS favoritos (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  loja_id     INTEGER NOT NULL REFERENCES lojas(id),
  criado_em   TEXT    NOT NULL,
  UNIQUE (usuario_id, loja_id)
);
CREATE INDEX IF NOT EXISTS idx_favoritos_usuario ON favoritos(usuario_id);

-- Mesas do salão (dine-in / PDV mesa a mesa).
CREATE TABLE IF NOT EXISTS mesas (
  id        INTEGER PRIMARY KEY,
  loja_id   INTEGER NOT NULL REFERENCES lojas(id),
  numero    TEXT    NOT NULL,
  status    TEXT    NOT NULL DEFAULT 'livre' CHECK (status IN ('livre','ocupada')),
  criado_em TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mesas_loja ON mesas(loja_id);

-- Comanda aberta por mesa: acumula itens até ser fechada.
CREATE TABLE IF NOT EXISTS comandas (
  id              INTEGER PRIMARY KEY,
  loja_id         INTEGER NOT NULL REFERENCES lojas(id),
  mesa_id         INTEGER NOT NULL REFERENCES mesas(id),
  status          TEXT    NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada','cancelada')),
  total_centavos  INTEGER NOT NULL DEFAULT 0,
  forma_pagamento TEXT,
  pedido_id       INTEGER,
  aberto_em       TEXT    NOT NULL,
  fechado_em      TEXT
);
CREATE INDEX IF NOT EXISTS idx_comandas_mesa ON comandas(mesa_id);
CREATE INDEX IF NOT EXISTS idx_comandas_loja ON comandas(loja_id);

-- Itens lançados na comanda.
CREATE TABLE IF NOT EXISTS comanda_itens (
  id                  INTEGER PRIMARY KEY,
  comanda_id          INTEGER NOT NULL REFERENCES comandas(id),
  produto_id          INTEGER REFERENCES produtos(id),
  nome_produto        TEXT    NOT NULL,
  preco_unit_centavos INTEGER NOT NULL CHECK (preco_unit_centavos >= 0),
  quantidade          INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  observacao          TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comanda_itens ON comanda_itens(comanda_id);

-- Contas de cozinha (KDS): login independente que pertence a UMA loja.
-- Não é um usuário da plataforma — só enxerga o painel de cozinha da sua loja.
CREATE TABLE IF NOT EXISTS cozinha_contas (
  id         INTEGER PRIMARY KEY,
  loja_id    INTEGER NOT NULL REFERENCES lojas(id),
  nome       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  senha_hash TEXT    NOT NULL,
  bloqueado  INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cozinha_loja ON cozinha_contas(loja_id);

-- Comandas da cozinha: itens enviados pra produção a partir de mesa ou PDV.
-- Separado do faturamento — só controla o que a cozinha precisa fazer.
CREATE TABLE IF NOT EXISTS cozinha_tickets (
  id         INTEGER PRIMARY KEY,
  loja_id    INTEGER NOT NULL REFERENCES lojas(id),
  origem     TEXT    NOT NULL,        -- 'mesa' | 'balcao'
  referencia TEXT    NOT NULL,        -- rótulo exibido na cozinha (ex.: 'Mesa 3', 'Balcão')
  comanda_id INTEGER,                 -- vínculo opcional com a comanda da mesa
  status     TEXT    NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila','preparando','pronto')),
  observacao TEXT    NOT NULL DEFAULT '',
  criado_em  TEXT    NOT NULL,
  pronto_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_cozinha_tickets_loja ON cozinha_tickets(loja_id);

CREATE TABLE IF NOT EXISTS cozinha_ticket_itens (
  id           INTEGER PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES cozinha_tickets(id),
  nome_produto TEXT    NOT NULL,
  quantidade   INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  observacao   TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cozinha_ticket_itens ON cozinha_ticket_itens(ticket_id);
`);

// Aviso "estou chegando" enviado pelo entregador (timestamp ISO; vazio = não avisou).
garantirColuna('pedidos', 'aviso_chegada_em', "aviso_chegada_em TEXT NOT NULL DEFAULT ''");

// Origem do pedido: 'app' (delivery pelo cliente) ou 'balcao' (venda no PDV do lojista).
garantirColuna('pedidos', 'origem', "origem TEXT NOT NULL DEFAULT 'app'");

// Hierarquia de admin: super_admin = dono do SaaS (poderes totais).
// Admins normais (super_admin = 0) fazem apenas operação (aprovar lojas,
// suspender contas, ver pedidos). Editar marca, comissão e gerenciar outros
// admins exige super_admin = 1.
garantirColuna('usuarios', 'super_admin', 'super_admin INTEGER NOT NULL DEFAULT 0');
// Isolamento de clientes por loja (white label multi-tenant)
garantirColuna('usuarios', 'loja_id', 'loja_id INTEGER REFERENCES lojas(id)');
// CPF do cliente: identificador principal de login (11 dígitos, sem máscara).
// Único por banco/tenant. Lojista/entregador continuam logando por e-mail.
garantirColuna('usuarios', 'cpf', 'cpf TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_cpf ON usuarios(cpf) WHERE cpf IS NOT NULL');

// Coordenadas do endereço (geocodificadas via OpenStreetMap/Nominatim ao salvar)
// — deixam o mapa/navegação do entregador precisos (ponto exato, não só texto).
garantirColuna('enderecos', 'lat', 'lat REAL');
garantirColuna('enderecos', 'lon', 'lon REAL');
// O pedido guarda o endereço como snapshot de texto; guarda também as coords.
garantirColuna('pedidos', 'entrega_lat', 'entrega_lat REAL');
garantirColuna('pedidos', 'entrega_lon', 'entrega_lon REAL');

// White label da loja: cada lojista pode definir sua identidade visual.
garantirColuna('lojas', 'logo_url', "logo_url TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'capa_url', "capa_url TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'cor_marca', "cor_marca TEXT NOT NULL DEFAULT ''");

// Horário de funcionamento automático: agenda semanal em JSON.
// Formato: [{ dia:0..6, aberto:bool, abre:"HH:MM", fecha:"HH:MM" }, ...] (0=domingo)
garantirColuna('lojas', 'horario_json', "horario_json TEXT NOT NULL DEFAULT '[]'");
// Quando 1, o servidor abre/fecha a loja sozinho conforme horario_json.
garantirColuna('lojas', 'auto_horario', 'auto_horario INTEGER NOT NULL DEFAULT 0');
// Pausa temporária: ISO timestamp até quando a loja fica fechada mesmo no automático.
garantirColuna('lojas', 'pausado_ate', "pausado_ate TEXT NOT NULL DEFAULT ''");

// Pedido mínimo da loja (separado do mínimo de cupom).
garantirColuna('lojas', 'minimo_pedido_centavos', 'minimo_pedido_centavos INTEGER NOT NULL DEFAULT 0');

// Avaliação agregada da loja (cache para ordenar/exibir sem recalcular).
garantirColuna('lojas', 'nota_media', 'nota_media REAL NOT NULL DEFAULT 0');
garantirColuna('lojas', 'nota_qtd', 'nota_qtd INTEGER NOT NULL DEFAULT 0');

// Banners: link direto para produto específico.
garantirColuna('banners', 'produto_id', 'produto_id INTEGER REFERENCES produtos(id)');
garantirColuna('banners', 'subtitulo', "subtitulo TEXT NOT NULL DEFAULT ''");

// Colunas adicionadas ao esquema de mesas/comandas após a criação inicial do banco.
garantirColuna('comandas', 'pedido_id', 'pedido_id INTEGER');
// Marca itens da comanda já despachados pra cozinha (permite enviar em rodadas).
garantirColuna('comanda_itens', 'enviado_cozinha', 'enviado_cozinha INTEGER NOT NULL DEFAULT 0');
// Tabela de cupons de desconto por loja.
db.exec(`
CREATE TABLE IF NOT EXISTS cupons (
  id               INTEGER PRIMARY KEY,
  loja_id          INTEGER NOT NULL REFERENCES lojas(id),
  codigo           TEXT    NOT NULL,
  tipo             TEXT    NOT NULL CHECK (tipo IN ('percentual','fixo')),
  valor            REAL    NOT NULL,
  minimo_centavos  INTEGER NOT NULL DEFAULT 0,
  usos_max         INTEGER NOT NULL DEFAULT 0,
  usos_count       INTEGER NOT NULL DEFAULT 0,
  validade         TEXT,
  ativo            INTEGER NOT NULL DEFAULT 1,
  criado_em        TEXT    NOT NULL,
  UNIQUE (loja_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_cupons_loja ON cupons(loja_id);
`);
// Cupom de desconto aplicado no pedido (registro do que foi descontado).
garantirColuna('pedidos', 'desconto_centavos', 'desconto_centavos INTEGER NOT NULL DEFAULT 0');
garantirColuna('pedidos', 'cupom_codigo', "cupom_codigo TEXT NOT NULL DEFAULT ''");
// Comissão customizada por loja (NULL = usa a comissão global da plataforma).
garantirColuna('lojas', 'comissao_percentual', 'comissao_percentual REAL');
// Soft delete da mesa: comandas históricas referenciam mesa_id, então não dá
// para apagar de verdade sem perder o histórico. Marcamos e filtramos da listagem.
garantirColuna('mesas', 'excluida', 'excluida INTEGER NOT NULL DEFAULT 0');
// Metadados das categorias do cardápio (ícone/emoji + ordem). O nome casa com
// produtos.categoria; produtos sem registro herdam ícone vazio e ordem alta.
db.exec(`
CREATE TABLE IF NOT EXISTS categorias (
  id        INTEGER PRIMARY KEY,
  loja_id   INTEGER NOT NULL REFERENCES lojas(id),
  nome      TEXT    NOT NULL,
  icone     TEXT    NOT NULL DEFAULT '',
  ordem     INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT    NOT NULL,
  UNIQUE (loja_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_categorias_loja ON categorias(loja_id);
`);
// Estilo de exibição das categorias na vitrine do cliente: 'cards' (com ícone) | 'chips'.
garantirColuna('lojas', 'categoria_estilo', "categoria_estilo TEXT NOT NULL DEFAULT 'cards'");

// Setores de produção (Cozinha, Bar...) — agrupam categorias pra rotear a
// impressão do cupom: cada setor tem uma impressora própria (vínculo fica
// LOCAL, no navegador/agente de cada PC — não faz sentido salvar no banco,
// já que cada computador do caixa pode ter impressoras físicas diferentes).
db.exec(`
CREATE TABLE IF NOT EXISTS setores (
  id        INTEGER PRIMARY KEY,
  loja_id   INTEGER NOT NULL REFERENCES lojas(id),
  nome      TEXT    NOT NULL,
  criado_em TEXT    NOT NULL,
  UNIQUE (loja_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_setores_loja ON setores(loja_id);
`);
garantirColuna('categorias', 'setor_id', 'setor_id INTEGER REFERENCES setores(id)');
// Token do Mercado Pago por loja (configurável pelo painel do lojista).
// NULL = sem Pix online; usa env MERCADOPAGO_ACCESS_TOKEN como fallback global.
garantirColuna('lojas', 'mercadopago_token', 'mercadopago_token TEXT');
// Slug amigável para URL da loja (ex: pizzaria-da-paula → /loja/pizzaria-da-paula).
// NULL = acesso só por ID numérico (/loja/2). Deve ser único entre lojas ativas.
garantirColuna('lojas', 'slug', 'slug TEXT');
// Configuração de impressão térmica do cupom (PDV / comanda).
garantirColuna('lojas', 'impressora_largura', "impressora_largura TEXT NOT NULL DEFAULT '80'"); // '80' | '58' mm
garantirColuna('lojas', 'impressora_auto', 'impressora_auto INTEGER NOT NULL DEFAULT 1');       // imprime ao finalizar
garantirColuna('lojas', 'cupom_rodape', "cupom_rodape TEXT NOT NULL DEFAULT ''");               // mensagem no rodapé

// Dados fiscais do emitente (NFC-e). Sem isso a emissão fica desligada.
garantirColuna('lojas', 'nfce_ativo', 'nfce_ativo INTEGER NOT NULL DEFAULT 0');
garantirColuna('lojas', 'nfce_cnpj', "nfce_cnpj TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_ie', "nfce_ie TEXT NOT NULL DEFAULT ''");                  // inscrição estadual
garantirColuna('lojas', 'nfce_razao_social', "nfce_razao_social TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_nome_fantasia', "nfce_nome_fantasia TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_crt', 'nfce_crt INTEGER NOT NULL DEFAULT 1');              // 1 = Simples Nacional
garantirColuna('lojas', 'nfce_uf', "nfce_uf TEXT NOT NULL DEFAULT ''");                  // sigla (SP, MG…)
garantirColuna('lojas', 'nfce_cmun', "nfce_cmun TEXT NOT NULL DEFAULT ''");              // cód. IBGE município (7)
garantirColuna('lojas', 'nfce_municipio', "nfce_municipio TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_logradouro', "nfce_logradouro TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_numero', "nfce_numero TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_bairro', "nfce_bairro TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_cep', "nfce_cep TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_csc', "nfce_csc TEXT NOT NULL DEFAULT ''");                // Código de Segurança do Contribuinte
garantirColuna('lojas', 'nfce_csc_id', "nfce_csc_id TEXT NOT NULL DEFAULT ''");          // idToken do CSC
garantirColuna('lojas', 'nfce_ambiente', 'nfce_ambiente INTEGER NOT NULL DEFAULT 2');    // 1=produção 2=homologação
garantirColuna('lojas', 'nfce_serie', 'nfce_serie INTEGER NOT NULL DEFAULT 1');
garantirColuna('lojas', 'nfce_proximo_numero', 'nfce_proximo_numero INTEGER NOT NULL DEFAULT 1');
// Padrões fiscais aplicados quando o produto não tem NCM/CFOP/CSOSN próprios.
garantirColuna('lojas', 'nfce_ncm_padrao',  "nfce_ncm_padrao TEXT NOT NULL DEFAULT '21069090'"); // NCM genérico alimentos
garantirColuna('lojas', 'nfce_cfop_padrao', "nfce_cfop_padrao TEXT NOT NULL DEFAULT '5102'");    // venda dentro do estado
garantirColuna('lojas', 'nfce_csosn_padrao',"nfce_csosn_padrao TEXT NOT NULL DEFAULT '102'");   // SN sem crédito
// Certificado A1: senha criptografada (o .pfx fica em dados/certificados/loja-<id>.pfx).
garantirColuna('lojas', 'nfce_cert_senha', "nfce_cert_senha TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_cert_validade', "nfce_cert_validade TEXT NOT NULL DEFAULT ''");
garantirColuna('lojas', 'nfce_cert_titular', "nfce_cert_titular TEXT NOT NULL DEFAULT ''");

// itens_pedido.produto_id precisa ser nullable para suportar itens avulsos de comanda (PDV mesa).
// SQLite não permite ALTER COLUMN, então recriamos a tabela se ainda tiver NOT NULL.
{
  const cols = db.prepare('PRAGMA table_info(itens_pedido)').all() as Array<{ name: string; notnull: number }>;
  const col = cols.find(c => c.name === 'produto_id');
  if (col && col.notnull === 1) {
    db.exec(`
      CREATE TABLE itens_pedido_v2 (
        id                   INTEGER PRIMARY KEY,
        pedido_id            INTEGER NOT NULL REFERENCES pedidos(id),
        produto_id           INTEGER REFERENCES produtos(id),
        nome_produto         TEXT    NOT NULL,
        preco_unit_centavos  INTEGER NOT NULL,
        quantidade           INTEGER NOT NULL CHECK (quantidade > 0),
        opcoes_texto         TEXT    NOT NULL DEFAULT '',
        opcoes_ids           TEXT    NOT NULL DEFAULT '[]'
      );
      INSERT INTO itens_pedido_v2 SELECT * FROM itens_pedido;
      DROP TABLE itens_pedido;
      ALTER TABLE itens_pedido_v2 RENAME TO itens_pedido;
      CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);
    `);
  }
}

// Marca da plataforma (sobrescrita global) — chaves padrão criadas só na primeira vez
const padroes: Array<[string, string]> = [
  ['marca_nome', 'Delivery Já'],
  ['marca_slogan', 'Peça das melhores lojas da sua região'],
  ['marca_logo_url', ''],
  ['marca_favicon_url', ''],
  ['marca_cor_primaria', '#dc2640'],
  ['loja_padrao_id', '0'],
];
const inserirConfig = db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)');
for (const [k, v] of padroes) inserirConfig.run(k, v);

db.prepare(
  `INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('comissao_percentual', '10')`
).run();
} // fim de inicializarBanco

/**
 * Proxy do `db`: qualquer acesso (db.prepare, db.exec, db.transaction…) é
 * roteado para a conexão do tenant atual. Métodos são "bindados" à conexão.
 */
const db = new Proxy({} as Conexao, {
  get(_alvo, prop) {
    const conn = conexaoAtual() as unknown as Record<string | symbol, unknown>;
    const valor = conn[prop];
    return typeof valor === 'function'
      ? (valor as (...args: unknown[]) => unknown).bind(conn)
      : valor;
  },
});

export default db;
