/**
 * Schema MySQL CONSOLIDADO — estado final de todas as tabelas.
 *
 * No SQLite o schema era construído em camadas (CREATE TABLE base + ~90
 * migrações garantirColuna acumuladas ao longo do desenvolvimento). Como os
 * bancos MySQL nascem do zero (não existe MySQL legado pra migrar), cada
 * tabela aqui já vem com TODAS as colunas atuais — elimina uma classe
 * inteira de erros de tradução. `garantirColuna`/`garantirIndice` (db-mysql)
 * continuam disponíveis pra migrações FUTURAS a partir daqui.
 *
 * Traduções aplicadas (vs. o schema SQLite em db.ts):
 *  - INTEGER PRIMARY KEY            → INT PRIMARY KEY AUTO_INCREMENT
 *  - Datas ISO-8601 em TEXT         → VARCHAR(32) (strings ISO ordenam
 *    lexicográfica = cronologicamente; todas as comparações `>= ?` do código
 *    continuam corretas sem mexer em nada)
 *  - Booleans INTEGER 0/1           → TINYINT NOT NULL DEFAULT 0/1
 *  - REAL                           → DOUBLE
 *  - TEXT em PK/UNIQUE/índice       → VARCHAR com tamanho (MySQL exige)
 *  - Índices únicos PARCIAIS (WHERE do SQLite, sem equivalente no MySQL) →
 *    coluna gerada `NULLIF(col,'')` + UNIQUE nela: NULLs múltiplos não
 *    conflitam em índice único no MySQL, então vazio/NULL fica livre e
 *    valores reais ficam únicos — mesmíssimo comportamento de antes
 *  - CREATE INDEX IF NOT EXISTS (não existe no MySQL 8) → índices declarados
 *    INLINE no CREATE TABLE (idempotente via IF NOT EXISTS da tabela, e
 *    funciona igual em MySQL e MariaDB)
 *  - usuarios.loja_id: SEM constraint de FK (usuarios ↔ lojas é circular;
 *    o SQLite só aceitava porque não valida a tabela referenciada na criação)
 *  - As 2 migrações de "recriar tabela" do SQLite (itens_pedido.produto_id
 *    nullable, mensagens_pedido.remetente com 'loja') já nascem no estado
 *    final aqui
 */
import { Pool } from 'mysql2/promise';

const SUFIXO_TABELA = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

/** DDL de cada tabela, em ordem de dependência de FK (pais antes de filhos). */
const TABELAS: string[] = [

`CREATE TABLE IF NOT EXISTS usuarios (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  nome        TEXT NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  perfil      VARCHAR(20) NOT NULL CHECK (perfil IN ('cliente','lojista','entregador','admin')),
  telefone    VARCHAR(20),
  bloqueado   TINYINT NOT NULL DEFAULT 0,
  criado_em   VARCHAR(32) NOT NULL,
  super_admin TINYINT NOT NULL DEFAULT 0,
  loja_id     INT,
  cpf         VARCHAR(11),
  reset_token_hash   TEXT,
  reset_token_expira VARCHAR(32),
  nota_media  DOUBLE NOT NULL DEFAULT 0,
  nota_qtd    INT NOT NULL DEFAULT 0,
  entregador_chat_metodo VARCHAR(20) NOT NULL DEFAULT 'app',
  cpf_unico      VARCHAR(11)  GENERATED ALWAYS AS (NULLIF(cpf, '')) VIRTUAL,
  telefone_unico VARCHAR(20)  GENERATED ALWAYS AS (NULLIF(telefone, '')) VIRTUAL,
  UNIQUE KEY idx_usuarios_cpf (cpf_unico),
  UNIQUE KEY idx_usuarios_telefone_unico (telefone_unico)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS lojas (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id            INT NOT NULL,
  nome                  TEXT NOT NULL,
  descricao             TEXT NOT NULL,
  categoria             VARCHAR(60) NOT NULL DEFAULT 'Outros',
  endereco              TEXT NOT NULL,
  taxa_entrega_centavos INT NOT NULL DEFAULT 0 CHECK (taxa_entrega_centavos >= 0),
  tempo_estimado_min    INT NOT NULL DEFAULT 40 CHECK (tempo_estimado_min > 0),
  horario_funcionamento TEXT NOT NULL,
  status_aprovacao      VARCHAR(20) NOT NULL DEFAULT 'pendente'
                        CHECK (status_aprovacao IN ('pendente','aprovada','suspensa')),
  aberta                TINYINT NOT NULL DEFAULT 0,
  criado_em             VARCHAR(32) NOT NULL,
  logo_url              TEXT,
  capa_url              TEXT,
  cor_marca             VARCHAR(20) NOT NULL DEFAULT '',
  cor_secundaria        VARCHAR(20) NOT NULL DEFAULT '',
  favicon_url           TEXT,
  horario_json          TEXT,
  auto_horario          TINYINT NOT NULL DEFAULT 0,
  pausado_ate           VARCHAR(32) NOT NULL DEFAULT '',
  minimo_pedido_centavos INT NOT NULL DEFAULT 0,
  nota_media            DOUBLE NOT NULL DEFAULT 0,
  nota_qtd              INT NOT NULL DEFAULT 0,
  comissao_percentual   DOUBLE,
  categoria_estilo      VARCHAR(20) NOT NULL DEFAULT 'cards',
  mercadopago_token     TEXT,
  mercadopago_token_teste    TEXT,
  mercadopago_token_producao TEXT,
  mercadopago_modo      VARCHAR(10) NOT NULL DEFAULT 'producao',
  slug                  VARCHAR(60),
  dominio_personalizado VARCHAR(200),
  impressora_largura    VARCHAR(4) NOT NULL DEFAULT '80',
  impressora_auto       TINYINT NOT NULL DEFAULT 1,
  cupom_rodape          TEXT,
  nfce_ativo            TINYINT NOT NULL DEFAULT 0,
  nfce_cnpj             VARCHAR(20) NOT NULL DEFAULT '',
  nfce_ie               VARCHAR(20) NOT NULL DEFAULT '',
  nfce_razao_social     TEXT,
  nfce_nome_fantasia    TEXT,
  nfce_crt              INT NOT NULL DEFAULT 1,
  nfce_uf               VARCHAR(2) NOT NULL DEFAULT '',
  nfce_cmun             VARCHAR(7) NOT NULL DEFAULT '',
  nfce_municipio        TEXT,
  nfce_logradouro       TEXT,
  nfce_numero           VARCHAR(20) NOT NULL DEFAULT '',
  nfce_bairro           TEXT,
  nfce_cep              VARCHAR(10) NOT NULL DEFAULT '',
  nfce_csc              TEXT,
  nfce_csc_id           VARCHAR(20) NOT NULL DEFAULT '',
  nfce_ambiente         INT NOT NULL DEFAULT 2,
  nfce_serie            INT NOT NULL DEFAULT 1,
  nfce_proximo_numero   INT NOT NULL DEFAULT 1,
  nfce_ncm_padrao       VARCHAR(10) NOT NULL DEFAULT '21069090',
  nfce_cfop_padrao      VARCHAR(6)  NOT NULL DEFAULT '5102',
  nfce_csosn_padrao     VARCHAR(6)  NOT NULL DEFAULT '102',
  nfce_cert_senha       TEXT,
  nfce_cert_validade    VARCHAR(32) NOT NULL DEFAULT '',
  nfce_cert_titular     TEXT,
  visual_json           TEXT,
  whatsapp_permite_oficial     TINYINT NOT NULL DEFAULT 0,
  whatsapp_permite_nao_oficial TINYINT NOT NULL DEFAULT 0,
  whatsapp_metodo_ativo        VARCHAR(20) NOT NULL DEFAULT 'nenhum',
  whatsapp_oficial_numero      VARCHAR(20) NOT NULL DEFAULT '',
  whatsapp_oficial_phone_id    VARCHAR(40) NOT NULL DEFAULT '',
  whatsapp_oficial_business_id VARCHAR(40) NOT NULL DEFAULT '',
  whatsapp_oficial_token       TEXT,
  whatsapp_oficial_template    VARCHAR(60) NOT NULL DEFAULT 'confirmacao_pedido',
  whatsapp_nao_oficial_status  VARCHAR(20) NOT NULL DEFAULT 'desconectado',
  whatsapp_enviar_confirmacao  TINYINT NOT NULL DEFAULT 0,
  lat                   DOUBLE,
  lon                   DOUBLE,
  dominio_unico VARCHAR(200) GENERATED ALWAYS AS (NULLIF(dominio_personalizado, '')) VIRTUAL,
  UNIQUE KEY idx_lojas_dominio (dominio_unico),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS produtos (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  loja_id         INT NOT NULL,
  nome            TEXT NOT NULL,
  descricao       TEXT NOT NULL,
  categoria       VARCHAR(120) NOT NULL DEFAULT 'Geral',
  preco_centavos  INT NOT NULL CHECK (preco_centavos > 0),
  foto_url        TEXT,
  disponivel      TINYINT NOT NULL DEFAULT 1,
  excluido        TINYINT NOT NULL DEFAULT 0,
  criado_em       VARCHAR(32) NOT NULL,
  preco_promocional_centavos INT,
  serve_pessoas   INT,
  destaque        TINYINT NOT NULL DEFAULT 0,
  subcategoria    VARCHAR(120) NOT NULL DEFAULT '',
  vendido_por     VARCHAR(4) NOT NULL DEFAULT 'un',
  codigo_barras   VARCHAR(40) NOT NULL DEFAULT '',
  ncm             VARCHAR(10) NOT NULL DEFAULT '',
  cfop            VARCHAR(6)  NOT NULL DEFAULT '5102',
  csosn           VARCHAR(6)  NOT NULL DEFAULT '102',
  origem          VARCHAR(2)  NOT NULL DEFAULT '0',
  unidade_comercial VARCHAR(8) NOT NULL DEFAULT 'UN',
  cest            VARCHAR(10) NOT NULL DEFAULT '',
  controla_estoque TINYINT NOT NULL DEFAULT 0,
  estoque         INT NOT NULL DEFAULT 0,
  KEY idx_produtos_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS grupos_opcoes (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  produto_id   INT NOT NULL,
  nome         TEXT NOT NULL,
  tipo         VARCHAR(10) NOT NULL DEFAULT 'unico' CHECK (tipo IN ('unico','multiplo')),
  obrigatorio  TINYINT NOT NULL DEFAULT 0,
  max_escolhas INT NOT NULL DEFAULT 0,
  ordem        INT NOT NULL DEFAULT 0,
  KEY idx_grupos_produto (produto_id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS opcoes_itens (
  id                       INT PRIMARY KEY AUTO_INCREMENT,
  grupo_id                 INT NOT NULL,
  nome                     TEXT NOT NULL,
  preco_adicional_centavos INT NOT NULL DEFAULT 0 CHECK (preco_adicional_centavos >= 0),
  disponivel               TINYINT NOT NULL DEFAULT 1,
  ordem                    INT NOT NULL DEFAULT 0,
  KEY idx_opcoes_grupo (grupo_id),
  FOREIGN KEY (grupo_id) REFERENCES grupos_opcoes(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS enderecos (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT NOT NULL,
  rotulo      VARCHAR(60) NOT NULL DEFAULT 'Casa',
  rua         TEXT NOT NULL,
  numero      VARCHAR(20) NOT NULL,
  complemento TEXT,
  bairro      VARCHAR(120) NOT NULL,
  cidade      VARCHAR(120) NOT NULL,
  uf          VARCHAR(2) NOT NULL,
  cep         VARCHAR(12) NOT NULL DEFAULT '',
  referencia  TEXT,
  criado_em   VARCHAR(32) NOT NULL,
  lat         DOUBLE,
  lon         DOUBLE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS pedidos (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  cliente_id            INT NOT NULL,
  loja_id               INT NOT NULL,
  entregador_id         INT,
  status                VARCHAR(20) NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','aceito','preparando','pronto',
                                          'em_entrega','entregue','cancelado','recusado')),
  endereco_entrega      TEXT NOT NULL,
  forma_pagamento       VARCHAR(20) NOT NULL CHECK (forma_pagamento IN ('pix','dinheiro','cartao_entrega')),
  troco_para_centavos   INT,
  observacoes           TEXT NOT NULL,
  subtotal_centavos     INT NOT NULL,
  taxa_entrega_centavos INT NOT NULL,
  total_centavos        INT NOT NULL,
  comissao_percentual   DOUBLE NOT NULL,
  comissao_centavos     INT NOT NULL,
  pagamento_status      VARCHAR(20) NOT NULL DEFAULT 'na_entrega'
                        CHECK (pagamento_status IN ('na_entrega','aguardando','aprovado','recusado')),
  pagamento_gateway     VARCHAR(40),
  pagamento_gateway_id  VARCHAR(80),
  estornado_em          VARCHAR(32) NOT NULL DEFAULT '',
  motivo_recusa         TEXT,
  criado_em             VARCHAR(32) NOT NULL,
  atualizado_em         VARCHAR(32) NOT NULL,
  entregador_lat        DOUBLE,
  entregador_lng        DOUBLE,
  entregador_local_em   VARCHAR(32) NOT NULL DEFAULT '',
  aviso_chegada_em      VARCHAR(32) NOT NULL DEFAULT '',
  origem                VARCHAR(10) NOT NULL DEFAULT 'app',
  entrega_lat           DOUBLE,
  entrega_lon           DOUBLE,
  desconto_centavos     INT NOT NULL DEFAULT 0,
  cupom_codigo          VARCHAR(60) NOT NULL DEFAULT '',
  entregador_etapa      VARCHAR(20) NOT NULL DEFAULT '',
  KEY idx_pedidos_cliente (cliente_id),
  KEY idx_pedidos_loja (loja_id),
  KEY idx_pedidos_status (status),
  FOREIGN KEY (cliente_id) REFERENCES usuarios(id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (entregador_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS historico_status (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id  INT NOT NULL,
  status     VARCHAR(20) NOT NULL,
  criado_em  VARCHAR(32) NOT NULL,
  KEY idx_hist_pedido (pedido_id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS itens_pedido (
  id                   INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id            INT NOT NULL,
  produto_id           INT,
  nome_produto         TEXT NOT NULL,
  preco_unit_centavos  INT NOT NULL,
  quantidade           INT NOT NULL CHECK (quantidade > 0),
  opcoes_texto         TEXT,
  opcoes_ids           TEXT,
  KEY idx_itens_pedido (pedido_id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS banners (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  titulo      TEXT NOT NULL,
  imagem      TEXT NOT NULL,
  loja_id     INT,
  link_url    TEXT,
  ordem       INT NOT NULL DEFAULT 0,
  ativo       TINYINT NOT NULL DEFAULT 1,
  criado_em   VARCHAR(32) NOT NULL,
  produto_id  INT,
  subtitulo   TEXT,
  botao_texto VARCHAR(60) NOT NULL DEFAULT '',
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(191) PRIMARY KEY,
  valor TEXT NOT NULL
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS eventos_notificacao (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id  INT NOT NULL,
  evento     VARCHAR(40) NOT NULL,
  canal      VARCHAR(40) NOT NULL DEFAULT 'pendente_configuracao',
  payload    TEXT,
  enviado    TINYINT NOT NULL DEFAULT 0,
  criado_em  VARCHAR(32) NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS notas_fiscais (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  loja_id       INT NOT NULL,
  pedido_id     INT,
  modelo        VARCHAR(4) NOT NULL DEFAULT '65',
  serie         INT NOT NULL,
  numero        INT NOT NULL,
  chave         VARCHAR(44) NOT NULL,
  ambiente      INT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','autorizada','rejeitada','cancelada','erro')),
  c_stat        VARCHAR(10) NOT NULL DEFAULT '',
  motivo        TEXT,
  protocolo     VARCHAR(40) NOT NULL DEFAULT '',
  xml           MEDIUMTEXT,
  qr_url        TEXT,
  total_centavos INT NOT NULL DEFAULT 0,
  criado_em     VARCHAR(32) NOT NULL,
  autorizada_em VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_notas_loja (loja_id),
  KEY idx_notas_pedido (pedido_id),
  UNIQUE KEY idx_notas_chave (chave),
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS zonas_entrega (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  loja_id       INT NOT NULL,
  bairro        VARCHAR(120) NOT NULL,
  taxa_centavos INT NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  criado_em     VARCHAR(32) NOT NULL,
  KEY idx_zonas_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS avaliacoes (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id    INT NOT NULL,
  loja_id      INT NOT NULL,
  cliente_id   INT NOT NULL,
  nota         INT NOT NULL CHECK (nota >= 1 AND nota <= 5),
  comentario   TEXT,
  resposta     TEXT,
  criado_em    VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_avaliacao_pedido (pedido_id),
  KEY idx_avaliacoes_loja (loja_id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (cliente_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS push_inscricoes (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT NOT NULL,
  endpoint    VARCHAR(500) NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  criado_em   VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_push_endpoint (endpoint),
  KEY idx_push_usuario (usuario_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS favoritos (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id  INT NOT NULL,
  loja_id     INT NOT NULL,
  criado_em   VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_favorito (usuario_id, loja_id),
  KEY idx_favoritos_usuario (usuario_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS mesas (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id   INT NOT NULL,
  numero    VARCHAR(20) NOT NULL,
  status    VARCHAR(10) NOT NULL DEFAULT 'livre' CHECK (status IN ('livre','ocupada')),
  criado_em VARCHAR(32) NOT NULL,
  excluida  TINYINT NOT NULL DEFAULT 0,
  KEY idx_mesas_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS comandas (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  loja_id         INT NOT NULL,
  mesa_id         INT NOT NULL,
  status          VARCHAR(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada','cancelada')),
  total_centavos  INT NOT NULL DEFAULT 0,
  forma_pagamento VARCHAR(20),
  pedido_id       INT,
  aberto_em       VARCHAR(32) NOT NULL,
  fechado_em      VARCHAR(32),
  KEY idx_comandas_mesa (mesa_id),
  KEY idx_comandas_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (mesa_id) REFERENCES mesas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS comanda_itens (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  comanda_id          INT NOT NULL,
  produto_id          INT,
  nome_produto        TEXT NOT NULL,
  preco_unit_centavos INT NOT NULL CHECK (preco_unit_centavos >= 0),
  quantidade          INT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  observacao          TEXT,
  enviado_cozinha     TINYINT NOT NULL DEFAULT 0,
  KEY idx_comanda_itens (comanda_id),
  FOREIGN KEY (comanda_id) REFERENCES comandas(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS cozinha_contas (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  loja_id    INT NOT NULL,
  nome       TEXT NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  bloqueado  TINYINT NOT NULL DEFAULT 0,
  criado_em  VARCHAR(32) NOT NULL,
  KEY idx_cozinha_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS cozinha_tickets (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  loja_id    INT NOT NULL,
  origem     VARCHAR(10) NOT NULL,
  referencia VARCHAR(60) NOT NULL,
  comanda_id INT,
  status     VARCHAR(12) NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila','preparando','pronto')),
  observacao TEXT,
  criado_em  VARCHAR(32) NOT NULL,
  pronto_em  VARCHAR(32),
  KEY idx_cozinha_tickets_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS cozinha_ticket_itens (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id    INT NOT NULL,
  nome_produto TEXT NOT NULL,
  quantidade   INT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  observacao   TEXT,
  KEY idx_cozinha_ticket_itens (ticket_id),
  FOREIGN KEY (ticket_id) REFERENCES cozinha_tickets(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS cupons (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  loja_id          INT NOT NULL,
  codigo           VARCHAR(60) NOT NULL,
  tipo             VARCHAR(12) NOT NULL CHECK (tipo IN ('percentual','fixo')),
  valor            DOUBLE NOT NULL,
  minimo_centavos  INT NOT NULL DEFAULT 0,
  usos_max         INT NOT NULL DEFAULT 0,
  usos_count       INT NOT NULL DEFAULT 0,
  validade         VARCHAR(32),
  ativo            TINYINT NOT NULL DEFAULT 1,
  criado_em        VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_cupom (loja_id, codigo),
  KEY idx_cupons_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS setores (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id   INT NOT NULL,
  nome      VARCHAR(120) NOT NULL,
  criado_em VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_setor (loja_id, nome),
  KEY idx_setores_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS categorias (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id   INT NOT NULL,
  nome      VARCHAR(120) NOT NULL,
  icone     VARCHAR(20) NOT NULL DEFAULT '',
  ordem     INT NOT NULL DEFAULT 0,
  criado_em VARCHAR(32) NOT NULL,
  setor_id  INT,
  UNIQUE KEY uq_categoria (loja_id, nome),
  KEY idx_categorias_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id),
  FOREIGN KEY (setor_id) REFERENCES setores(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS admin_auditoria (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  admin_id     INT,
  admin_nome   TEXT NOT NULL,
  admin_email  TEXT NOT NULL,
  acao         VARCHAR(60) NOT NULL,
  alvo_tipo    VARCHAR(40) NOT NULL DEFAULT '',
  alvo_id      INT,
  alvo_desc    TEXT,
  detalhes     TEXT,
  criado_em    VARCHAR(32) NOT NULL,
  KEY idx_admin_auditoria_criado (criado_em)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS avaliacoes_entregador (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id     INT NOT NULL,
  entregador_id INT NOT NULL,
  cliente_id    INT NOT NULL,
  nota          INT NOT NULL CHECK (nota >= 1 AND nota <= 5),
  comentario    TEXT,
  criado_em     VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_avaliacao_entregador_pedido (pedido_id),
  KEY idx_avaliacoes_entregador (entregador_id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (entregador_id) REFERENCES usuarios(id),
  FOREIGN KEY (cliente_id) REFERENCES usuarios(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS mensagens_pedido (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id   INT NOT NULL,
  remetente   VARCHAR(12) NOT NULL CHECK (remetente IN ('cliente','entregador','loja')),
  texto       TEXT NOT NULL,
  lida        TINYINT NOT NULL DEFAULT 0,
  criado_em   VARCHAR(32) NOT NULL,
  KEY idx_mensagens_pedido (pedido_id, id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS etapas_entrega (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  pedido_id  INT NOT NULL,
  etapa      VARCHAR(20) NOT NULL,
  criado_em  VARCHAR(32) NOT NULL,
  KEY idx_etapas_entrega (pedido_id, id),
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ${SUFIXO_TABELA}`,
];

/** Chaves de configuração criadas só na primeira vez (INSERT IGNORE). */
const CONFIGS_PADRAO: Array<[string, string]> = [
  ['marca_nome', 'Delivery Já'],
  ['marca_slogan', 'Peça das melhores lojas da sua região'],
  ['marca_logo_url', ''],
  ['marca_favicon_url', ''],
  ['marca_cor_primaria', '#dc2640'],
  ['loja_padrao_id', '0'],
  ['marca_login_banner_url', ''],
  ['suporte_email', ''],
  ['suporte_telefone', ''],
  ['termos_url', ''],
  ['comissao_percentual', '10'],
];

/**
 * Cria o schema completo num banco (novo ou existente — tudo idempotente).
 * Chamado no provisionamento explícito de tenant (tenants.ts), NUNCA no
 * caminho quente de um request como era no SQLite.
 */
export async function inicializarSchema(pool: Pool): Promise<void> {
  // Uma DDL por vez (sem multipleStatements): erros apontam a tabela exata.
  for (const ddl of TABELAS) {
    await pool.query(ddl);
  }
  for (const [chave, valor] of CONFIGS_PADRAO) {
    await pool.query('INSERT IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)', [chave, valor]);
  }

  // Índice único (loja_id, serie, numero) em notas_fiscais: a tabela já
  // existia sem isso (só tinha UNIQUE em `chave`) — via `CREATE TABLE IF NOT
  // EXISTS` acima, adicionar a coluna na constante TABELAS não alcança bancos
  // já criados. reservarNumero() (lojista.ts) já serializa a reserva do
  // número com FOR UPDATE, mas esse índice é a segunda trava (defesa em
  // profundidade contra número duplicado por outro caminho de código/bug
  // futuro) — sem DATABASE() na query não precisa saber o nome do banco atual.
  const [jaTemIndice] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notas_fiscais' AND INDEX_NAME = 'idx_notas_loja_serie_numero'
      LIMIT 1`,
  ) as any;
  if (jaTemIndice.length === 0) {
    await pool.query(
      'ALTER TABLE notas_fiscais ADD UNIQUE KEY idx_notas_loja_serie_numero (loja_id, serie, numero)'
    );
  }

  // pedidos.estornado_em: mesmo caso do índice acima — coluna nova que
  // `CREATE TABLE IF NOT EXISTS` não alcança em bancos já criados.
  const [jaTemColuna] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'estornado_em'
      LIMIT 1`,
  ) as any;
  if (jaTemColuna.length === 0) {
    await pool.query("ALTER TABLE pedidos ADD COLUMN estornado_em VARCHAR(32) NOT NULL DEFAULT ''");
  }
}
