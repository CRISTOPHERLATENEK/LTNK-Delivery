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
  totp_secret        TEXT,
  totp_ativo         TINYINT NOT NULL DEFAULT 0,
  totp_backup_codes  TEXT,
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
  aceita_retirada       TINYINT NOT NULL DEFAULT 0,
  categoria_estilo      VARCHAR(20) NOT NULL DEFAULT 'cards',
  categoria_formato     VARCHAR(20) NOT NULL DEFAULT 'circulo',
  categoria_tamanho     VARCHAR(10) NOT NULL DEFAULT 'medio',
  categoria_todos_imagem VARCHAR(500) NOT NULL DEFAULT '',
  categoria_foto_auto   TINYINT NOT NULL DEFAULT 1,
  mercadopago_token     TEXT,
  mercadopago_token_teste    TEXT,
  mercadopago_token_producao TEXT,
  mercadopago_modo      VARCHAR(10) NOT NULL DEFAULT 'producao',
  -- Gateway do Pix online desta loja. 'mercadopago' = token da própria loja
  -- (ou o global do .env); 'onz' = conta ONZ/Planner (da loja, ou a global).
  pagamento_gateway     VARCHAR(20) NOT NULL DEFAULT 'mercadopago'
                        CHECK (pagamento_gateway IN ('mercadopago','onz')),
  -- Conta ONZ/Planner DA LOJA: cada cliente abre a própria conta (um CNPJ, uma
  -- conta, uma chave Pix) e recebe direto — a plataforma não intermedeia o
  -- dinheiro. Secret criptografado em repouso (AES-256-GCM, ver cripto.ts).
  -- O CERTIFICADO mTLS é único da integração (fica no ambiente), não por loja.
  onz_client_id         TEXT,
  onz_client_secret     TEXT,
  onz_pix_key           VARCHAR(80),
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
  disponivel_pdv  TINYINT NOT NULL DEFAULT 1,
  excluido        TINYINT NOT NULL DEFAULT 0,
  criado_em       VARCHAR(32) NOT NULL,
  preco_promocional_centavos INT,
  /*
   * Último dia em que a promoção vale ('YYYY-MM-DD'), no fuso de Brasília.
   * Vazio = sem prazo, que é como toda promoção era antes desta coluna.
   *
   * VARCHAR e não DATE por consistência com o resto do schema (criado_em,
   * validade do cupom): o projeto guarda data como texto ordenável, e comparar
   * 'YYYY-MM-DD' com string funciona sem trazer fuso pra dentro do banco.
   *
   * O preço promocional NÃO é apagado quando vence: fica guardado e só deixa de
   * ser aplicado (ver preco-produto.ts). Assim reativar a promoção é mudar a
   * data, não redigitar o valor.
   */
  promo_fim       VARCHAR(10) NOT NULL DEFAULT '',
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
  /*
   * Seção dentro do grupo ('Tradicionais', 'Especiais', 'Doces'…). Vazio = sem
   * seção, que é como toda opção existia antes.
   *
   * POR QUE AQUI E NÃO EM GRUPOS SEPARADOS: pizzaria separa sabor por faixa,
   * mas o LIMITE e o PREÇO são do conjunto. Três grupos de sabor deixariam a
   * pizza de 3 sabores aceitar 3 de cada (9), e o modo_preco 'maior', que e
   * calculado dentro do grupo, somaria três "maiores" — o oposto do que essa
   * regra existe pra fazer. Seção separa na TELA sem partir a regra.
   */
  secao                    VARCHAR(40) NOT NULL DEFAULT '',
  /*
   * Ingredientes do sabor, mostrados embaixo do nome pro cliente.
   *
   * 160 caracteres e não TEXT: é uma linha de apoio numa lista, não um campo de
   * marketing. Sem teto, a descrição vira anúncio e a lista de sabores deixa de
   * ser varrível — foi o defeito nº 12 da análise do concorrente ("descrições
   * longuíssimas em tom de anúncio").
   */
  descricao                VARCHAR(160) NOT NULL DEFAULT '',
  /*
   * Foto do sabor. Mesmo tamanho de produtos.foto_url — guarda URL, nao
   * arquivo (o upload vive em /api/upload/imagem e devolve o caminho).
   *
   * Vale pra sabor, não pra borda ou adicional: numa pizzaria a foto do sabor é
   * o que vende, e ninguém precisa ver uma foto de "sem cebola".
   */
  imagem                   VARCHAR(500) NOT NULL DEFAULT '',
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
  tipo_entrega          VARCHAR(10) NOT NULL DEFAULT 'entrega',
  forma_pagamento       VARCHAR(20) NOT NULL CHECK (forma_pagamento IN ('pix','dinheiro','cartao_entrega','cartao_online')),
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
  observacao           VARCHAR(160) NOT NULL DEFAULT '',
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
  -- Zona por NOME DE BAIRRO (modelo original). Vazio nas zonas de área.
  bairro        VARCHAR(120) NOT NULL,
  taxa_centavos INT NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  -- Zona por ÁREA DESENHADA no mapa: rótulo + polígono [[lat,lon],...] em JSON.
  -- Quando poligono_json está preenchido, a zona é geográfica e o bairro é
  -- ignorado. Ver resolverFrete() em rotas/lojista.ts e geometria.ts.
  nome          VARCHAR(80),
  poligono_json TEXT,
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
  -- As escolhas do item, com os mesmos nomes e tipos de itens_pedido: na fase 2
  -- a validacao passa a ser compartilhada entre delivery e balcao, e nome
  -- divergente aqui obrigaria a uma traducao no meio -- que e onde os dois
  -- canais voltariam a discordar sobre preco.
  -- (Comentario em -- e sem crases: este bloco vive DENTRO de uma template
  -- string, e uma crase aqui fecha a string.)
  opcoes_texto        TEXT,
  opcoes_ids          TEXT,
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

`CREATE TABLE IF NOT EXISTS caixas (
  id                        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id                   INT NOT NULL,
  usuario_abertura_id       INT NOT NULL,
  usuario_abertura_nome     VARCHAR(120) NOT NULL DEFAULT '',
  aberto_em                 VARCHAR(32) NOT NULL,
  valor_abertura_centavos   INT NOT NULL DEFAULT 0,
  status                    VARCHAR(10) NOT NULL DEFAULT 'aberto',
  fechado_em                VARCHAR(32) NOT NULL DEFAULT '',
  usuario_fechamento_nome   VARCHAR(120) NOT NULL DEFAULT '',
  valor_contado_centavos    INT NOT NULL DEFAULT 0,
  valor_esperado_centavos   INT NOT NULL DEFAULT 0,
  diferenca_centavos        INT NOT NULL DEFAULT 0,
  -- Totais por FORMA congelados no fechamento. Antes só contado/esperado eram
  -- guardados, então "quanto entrou de cartão naquele turno?" só se respondia
  -- reconsultando pedidos por data e reconstruindo -- e o número já estava
  -- calculado na tela, sendo descartado.
  vendas_dinheiro_centavos  INT NOT NULL DEFAULT 0,
  vendas_cartao_centavos    INT NOT NULL DEFAULT 0,
  vendas_pix_centavos       INT NOT NULL DEFAULT 0,
  vendas_quantidade         INT NOT NULL DEFAULT 0,
  sangrias_centavos         INT NOT NULL DEFAULT 0,
  suprimentos_centavos      INT NOT NULL DEFAULT 0,
  observacoes               TEXT,
  KEY idx_caixas_loja (loja_id, status),
  KEY idx_caixas_abertura (loja_id, aberto_em)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  caixa_id       INT NOT NULL,
  tipo           VARCHAR(12) NOT NULL,
  valor_centavos INT NOT NULL,
  motivo         VARCHAR(200) NOT NULL DEFAULT '',
  usuario_nome   VARCHAR(120) NOT NULL DEFAULT '',
  criado_em      VARCHAR(32) NOT NULL,
  -- CANCELAMENTO MARCADO, não DELETE: erro de digitação em campo de dinheiro é
  -- rotina (sangria de 1000 no lugar de 100), e sem caminho de correção o
  -- operador compensa com um lançamento inverso -- o esperado fica certo e o
  -- histórico passa a mostrar duas movimentações que nunca aconteceram. Apagar a
  -- linha seria pior ainda: some o rastro de que houve erro.
  cancelado_em   VARCHAR(32) NOT NULL DEFAULT '',
  cancelado_por  VARCHAR(120) NOT NULL DEFAULT '',
  KEY idx_mov_caixa (caixa_id)
) ${SUFIXO_TABELA}`,

/**
 * CÓDIGOS DE USO ÚNICO do login social.
 *
 * POR QUE NO BANCO e não num Map em memória: o callback do OAuth roda no domínio
 * da PLATAFORMA e a troca pela sessão acontece no domínio da LOJA — duas
 * requisições que podem cair em processos diferentes (pm2 em cluster, ou dois
 * servidores amanhã). Em memória, o código gerado num processo não existiria no
 * outro, e o login falharia de forma intermitente: o pior tipo de bug pra
 * diagnosticar depois.
 *
 * `usado_em` em vez de DELETE: um código apresentado duas vezes é sinal (link
 * copiado, histórico compartilhado, tentativa de replay). Apagando, a segunda
 * tentativa é indistinguível de código expirado.
 */
`CREATE TABLE IF NOT EXISTS oauth_codigos (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  codigo_hash VARCHAR(64) NOT NULL UNIQUE,
  usuario_id  INT NOT NULL,
  expira_em   VARCHAR(32) NOT NULL,
  usado_em    VARCHAR(32) NOT NULL DEFAULT '',
  criado_em   VARCHAR(32) NOT NULL,
  KEY idx_oauth_cod_exp (expira_em),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
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
  -- A composicao do item, no mesmo formato de itens_pedido.opcoes_texto: e o que
  -- a cozinha precisa pra PRODUZIR. Sem ela o ticket dizia "Pizza Artesanal" e
  -- nada mais -- impossivel de fazer.
  -- (Sem crases: este bloco vive dentro de uma template string.)
  opcoes_texto TEXT,
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

/*
 * A SUBCATEGORIA GANHA CADASTRO — ATÉ AQUI ELA ERA SÓ TEXTO EM `produtos`.
 *
 * Sem tabela não havia onde guardar posição, e a consequência aparecia na tela:
 * a faixa "SUCO NATURAL" vinha antes de "REFRIGERANTES" não por escolha de
 * ninguém, mas porque o suco era destaque e arrastava a faixa junto. Mexer no
 * destaque de UM produto reordenava a seção inteira.
 *
 * `categoria` é o texto, não um id: em `produtos` ela também é texto livre, e
 * usar id aqui exigiria que toda categoria existisse na tabela `categorias` —
 * o que não é verdade pra produto criado antes dela ou renomeado por fora.
 *
 * A linha nasce sozinha quando o lojista usa uma subcategoria nova; o UNIQUE
 * deixa o INSERT ser cego (`INSERT IGNORE`) em vez de exigir consulta antes.
 */
`CREATE TABLE IF NOT EXISTS subcategorias (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id   INT NOT NULL,
  categoria VARCHAR(120) NOT NULL,
  nome      VARCHAR(120) NOT NULL,
  ordem     INT NOT NULL DEFAULT 0,
  criado_em VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_subcategoria (loja_id, categoria, nome),
  KEY idx_subcategorias_loja (loja_id),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS categorias (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  loja_id   INT NOT NULL,
  nome      VARCHAR(120) NOT NULL,
  icone     VARCHAR(20) NOT NULL DEFAULT '',
  imagem    VARCHAR(500) NOT NULL DEFAULT '',
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

/*
 * QUAIS GRUPOS DE COMPLEMENTO CADA PRODUTO USA.
 *
 * FASE 1 do reaproveitamento de grupos. Hoje `grupos_opcoes.produto_id` amarra
 * cada grupo a um produto e a mais nenhum — numa pizzaria com 30 pizzas, "Borda"
 * existe 30 vezes, e subir o Catupiry de R$ 8 pra R$ 10 é editar 30 grupos. No
 * banco do mostruário já são 12 grupos para 5 nomes distintos, e "Tamanho"
 * aparece 5 vezes.
 *
 * NADA LÊ ESTA TABELA AINDA. Nesta fase ela só é criada e preenchida 1:1 com o
 * que já existe (uma ligação por grupo), justamente pra que a fase possa ser
 * aplicada e revertida sem mudar comportamento nenhum. Quem passa a ler é a
 * fase 2.
 *
 * O QUE MORA AQUI E NÃO NO GRUPO: o critério é "a resposta é a mesma em todo
 * produto que usa o grupo?". Nome e itens, sim — ficam no grupo. Ordem na tela e
 * obrigatoriedade, não:
 *
 *   - `ordem` é a ordem em que o CLIENTE monta o pedido naquele produto.
 *     Compartilhada, reordenar a Pizza A reordenaria a Pizza B.
 *   - `obrigatorio` e `max_escolhas` mudam por produto: borda é obrigatória na
 *     pizza e opcional na esfiha. Compartilhados, um dos dois estaria errado.
 *
 * O UNIQUE É REGRA, NÃO OTIMIZAÇÃO. Sem ele, dois cliques em "usar este grupo"
 * ligam o mesmo grupo duas vezes, e o cliente vê "Borda" duas vezes no cardápio,
 * com dois limites independentes.
 */
/*
 * DE QUE UM COMBO É FEITO.
 *
 * Um combo é um PRODUTO que contém outros produtos: "Combo Casal = uma Pizza
 * Artesanal + uma Coca 2L". Cada linha aqui é um pedaço dele.
 *
 * POR QUE REFERENCIA PRODUTO E NÃO GRUPOS. O caminho alternativo era o combo
 * declarar os grupos de cada pizza ("slot 1: Tamanho, Sabores, Borda"). Isso
 * obrigaria o lojista a redescrever a pizza dentro do combo, e a manter as duas
 * descrições em pé. Referenciando o produto, o combo herda os 27 sabores, o
 * limite que vem do tamanho e a borda de 5 opções sem redeclarar nada.
 *
 * `slot` E NÃO `quantidade`. Duas pizzas iguais no mesmo combo são DUAS LINHAS,
 * slot 1 e slot 2, porque cada uma é CONFIGURADA SEPARADAMENTE — sabores e borda
 * próprios. Uma coluna de quantidade descreveria "duas pizzas idênticas", que é
 * exatamente o que este recurso não é.
 *
 * `rotulo` é o que o cliente lê no modal e o cozinheiro no cupom ("Pizza 1" /
 * "Pizza 2"). Sem ele, dois slots do mesmo produto ficam indistinguíveis na
 * tela — o mesmo problema do dado, agora na interface.
 *
 * UM PRODUTO É COMBO QUANDO TEM LINHA AQUI. Não existe coluna `eh_combo`: um
 * booleano precisaria ser mantido em sincronia com a existência das linhas, e
 * booleano fora de sincronia é a fonte de defeito que a tabela já responde.
 *
 * NADA LÊ ISTO AINDA. Esta é a fase 1: cria e cadastra. O modal do cliente, o
 * preço e o cupom vêm depois — e é o que torna esta fase aplicável e reversível.
 */
`CREATE TABLE IF NOT EXISTS combo_itens (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  combo_id    INT NOT NULL,
  slot        INT NOT NULL,
  produto_id  INT NOT NULL,
  rotulo      VARCHAR(40) NOT NULL DEFAULT '',
  UNIQUE KEY uq_combo_slot (combo_id, slot),
  KEY idx_combo_itens_produto (produto_id),
  FOREIGN KEY (combo_id) REFERENCES produtos(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ${SUFIXO_TABELA}`,

`CREATE TABLE IF NOT EXISTS produto_grupos (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  produto_id    INT NOT NULL,
  grupo_id      INT NOT NULL,
  ordem         INT NOT NULL DEFAULT 0,
  obrigatorio   TINYINT NOT NULL DEFAULT 0,
  max_escolhas  INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_produto_grupo (produto_id, grupo_id),
  KEY idx_pg_grupo (grupo_id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id),
  FOREIGN KEY (grupo_id) REFERENCES grupos_opcoes(id)
) ${SUFIXO_TABELA}`,
];

/** Chaves de configuração criadas só na primeira vez (INSERT IGNORE). */
const CONFIGS_PADRAO: Array<[string, string]> = [
  ['marca_nome', 'Delivery Já'],
  ['marca_slogan', 'Peça das melhores lojas da sua região'],
  ['marca_logo_url', ''],
  /*
   * Nome ao lado da logo. Padrão LIGADO: logo só de símbolo sem o nome ao lado
   * deixa o visitante sem saber onde está. Quem tem logo com o nome escrito
   * (wordmark) desliga — senão o cabeçalho mostra o nome duas vezes, e pode
   * mostrar dois nomes DIFERENTES se a logo e o cadastro não combinarem.
   */
  ['marca_mostrar_nome', '1'],
  /*
   * Tamanho da logo numa barra de 0 a 100, onde 50 e o tamanho original.
   * Guardado como texto porque `configuracoes` e chave/valor em texto; quem
   * converte e valida a faixa e fatorDaEscala (frontend/src/lib/logo-escala.ts).
   */
  ['marca_logo_escala', '50'],
  /*
   * CRÉDITO NO RODAPÉ do painel de quem contratou ("Desenvolvido por ...").
   *
   * Configurável, e não fixo no código, porque num sistema white-label o
   * crédito nem sempre é da plataforma: um revendedor que entrega o sistema com
   * a marca dele quer o nome dele ali. Vazio = não aparece nada, que é o certo
   * pra quem não quer assinar o painel do cliente.
   */
  ['rodape_credito_texto', ''],
  ['rodape_credito_logo_url', ''],
  ['rodape_credito_url', ''],
  ['marca_favicon_url', ''],
  ['marca_cor_primaria', '#dc2640'],
  ['loja_padrao_id', '0'],
  ['marca_login_banner_url', ''],
  ['suporte_email', ''],
  ['suporte_telefone', ''],
  ['termos_url', ''],
  // 0 = a plataforma NÃO cobra comissão por pedido (modelo só-mensalidade, o
  // que a landing anuncia). O motor de comissão continua existindo pra quem
  // quiser cobrar: basta o admin definir um percentual global ou por loja.
  ['comissao_percentual', '0'],
];

/**
 * Cria o schema completo num banco (novo ou existente — tudo idempotente).
 * Chamado no provisionamento explícito de tenant (tenants.ts), NUNCA no
 * caminho quente de um request como era no SQLite.
 */
/**
 * ALTER TABLE que tolera "a coluna já existe".
 *
 * POR QUE ISSO É NECESSÁRIO: o PM2 roda em CLUSTER com 3 instâncias, e as três
 * chamam a migração no boot. Duas leem INFORMATION_SCHEMA antes de qualquer uma
 * gravar, as duas tentam o ALTER, e a segunda estoura com
 * ER_DUP_FIELDNAME — e aí o `for` inteiro daquele tenant ABORTA, deixando as
 * colunas seguintes sem aplicar.
 *
 * Foi observado em produção: ao adicionar `descricao` e `imagem` em
 * opcoes_itens, o log trouxe "Duplicate column name 'descricao'" e a migração de
 * uma das instâncias parou ali. As duas colunas acabaram existindo porque OUTRA
 * instância completou a sequência — ou seja, funcionou por sorte, não por
 * desenho. Se a corrida pegasse a última coluna, ela ficaria faltando.
 *
 * Coluna que já existe é exatamente o estado desejado, então engolir esse erro
 * específico é o certo. Qualquer outro erro continua subindo.
 */
async function adicionarColuna(pool: Pool, sql: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch (e) {
    if ((e as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw e;
  }
}

/**
 * Cria índice tolerando "já existe" — mesma corrida do `adicionarColuna`, e o
 * mesmo estrago: a segunda instância estoura com ER_DUP_KEYNAME e aborta o resto
 * da migração daquele tenant.
 *
 * `permitirFalha` é pra índice ÚNICO que pode não caber nos dados existentes
 * (duplicata gravada de antes). Aí a falha é legítima e não deve derrubar o boot
 * da plataforma — só avisar, com o SELECT que encontra as linhas repetidas.
 */
async function criarIndice(pool: Pool, sql: string, aviso?: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ER_DUP_KEYNAME') return;          // outra instância criou
    if (aviso) { console.warn(`[SCHEMA] ${aviso}`, code || e); return; }
    throw e;
  }
}

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

  /**
   * Aparência da faixa de categorias do cardápio.
   *
   * A imagem era SEMPRE a foto do primeiro produto da categoria, e o formato
   * era sempre círculo — o lojista não escolhia nem uma coisa nem outra. Numa
   * categoria com um produto sem foto boa, a vitrine inteira ficava feia e não
   * havia o que fazer.
   *
   * `categorias.imagem` vazio mantém o comportamento de antes (foto do 1º
   * produto), então nada muda pra quem não mexer.
   */
  for (const [tabela, coluna, ddl] of [
    ['categorias', 'imagem',             "imagem VARCHAR(500) NOT NULL DEFAULT ''"],
    ['lojas',      'categoria_formato',  "categoria_formato VARCHAR(20) NOT NULL DEFAULT 'circulo'"],
    ['lojas',      'categoria_tamanho',  "categoria_tamanho VARCHAR(10) NOT NULL DEFAULT 'medio'"],
    // Foto do botão "Todos" — o único que nunca tinha imagem, e por isso
    // destoava sempre que as outras categorias tinham.
    ['lojas',      'categoria_todos_imagem', "categoria_todos_imagem VARCHAR(500) NOT NULL DEFAULT ''"],
    // Ligada (padrão) = comportamento de sempre: categoria sem foto escolhida
    // usa a do 1º produto. Desligada = só as fotos escolhidas, ícone no resto —
    // é o jeito de ter a faixa consistente sem produzir imagem pra tudo.
    ['lojas',      'categoria_foto_auto',    'categoria_foto_auto TINYINT NOT NULL DEFAULT 1'],
    /*
     * itens_pedido.observacao — pedido por ITEM ("sem cebola"), não do pedido
     * inteiro. Existia só uma observação geral, no fim do checkout: quem pedia
     * dois lanches e queria um sem cebola tinha que escrever "o segundo
     * X-Burguer sem cebola" e esperar que a cozinha entendesse qual era.
     */
    ['itens_pedido', 'observacao', "observacao VARCHAR(160) NOT NULL DEFAULT ''"],
    /*
     * RETIRADA NO LOCAL. Nasce 'entrega' em todo pedido que já existe — é o
     * que eles foram, e o padrão certo pra qualquer pedido novo que não diga
     * nada.
     */
    ['pedidos', 'tipo_entrega', "tipo_entrega VARCHAR(10) NOT NULL DEFAULT 'entrega'"],
    /*
     * DESLIGADO por padrão, de propósito: ligar retirada em toda loja da
     * plataforma de uma vez faria clientes aparecerem no balcão de cozinhas
     * que não têm balcão.
     */
    ['lojas', 'aceita_retirada', 'aceita_retirada TINYINT NOT NULL DEFAULT 0'],
    /*
     * XML DO EVENTO DE CANCELAMENTO, em coluna própria.
     *
     * O cancelamento gravava o evento POR CIMA de `xml`, e a nota autorizada
     * original sumia. O contador precisa das duas peças: a NFC-e autorizada e o
     * evento que a cancelou — só o evento não comprova o que foi cancelado.
     * Notas canceladas ANTES desta coluna já perderam o XML original; não há de
     * onde recuperar a não ser baixando da SEFAZ.
     */
    ['notas_fiscais', 'xml_cancelamento', 'xml_cancelamento MEDIUMTEXT'],
    /*
     * MESA DUPLICADA era possivel: POST /mesas checava "ja existe?" e inseria
     * depois, sem transacao. Dois toques no botao criavam duas "Mesa 5", o
     * garcom abria comanda numa e a cozinha via a outra.
     *
     * NULL quando excluida, pra o indice unico nao brigar com a exclusao logica:
     * uma "Mesa 5" apagada tem que poder ser recriada. Mesmo recurso de
     * cpf_unico/telefone_unico/dominio_unico.
     */
    ['mesas', 'numero_unico', "numero_unico VARCHAR(20) GENERATED ALWAYS AS (IF(excluida = 0, numero, NULL)) VIRTUAL"],
    /*
     * ENVIO DOS XMLs PRO CONTADOR.
     *
     * `contador_ultima_competencia` é o que impede o envio em dobro: o job roda
     * várias vezes por dia e, sem essa marca, o contador escrituraria o mesmo
     * mês de novo a cada passada.
     */
    ['lojas', 'contador_email',               "contador_email VARCHAR(300) NOT NULL DEFAULT ''"],
    ['lojas', 'contador_envio_auto',          'contador_envio_auto TINYINT NOT NULL DEFAULT 0'],
    ['lojas', 'contador_dia_envio',           'contador_dia_envio INT NOT NULL DEFAULT 5'],
    ['lojas', 'contador_ultima_competencia',  "contador_ultima_competencia VARCHAR(7) NOT NULL DEFAULT ''"],
    ['lojas', 'contador_ultimo_envio_em',     "contador_ultimo_envio_em VARCHAR(32) NOT NULL DEFAULT ''"],
    /** Erro do último envio, pra tela poder dizer POR QUE não chegou. */
    ['lojas', 'contador_ultimo_erro',         "contador_ultimo_erro VARCHAR(300) NOT NULL DEFAULT ''"],

    /*
     * ─── TEF (Smart TEF / POS Controle) ───
     *
     * A maquininha vira um terminal do nosso PDV: mandamos o valor por HTTP, ela
     * mostra um card pro operador, e devolve o resultado. O que ela devolve é o
     * ponto — hoje `tipo-pagamento-nfce.ts` declara TODO cartão de PDV como
     * crédito por palpite, sem bandeira e sem NSU, e a SEFAZ autoriza igual
     * porque 03 é código válido. O erro só aparece em fiscalização.
     *
     * As duas credenciais são POR LOJA e vêm cifradas, como o token do Mercado
     * Pago e as da ONZ: quem tem o token cobra na maquininha de alguém.
     *
     * `smarttef_base_url` é campo e não constante porque o host não está na
     * documentação pública — vem no credenciamento, e parceiro White Label pode
     * receber outro. Fixar no código obrigaria deploy pra trocar.
     */
    ['lojas', 'smarttef_ativo',          'smarttef_ativo TINYINT NOT NULL DEFAULT 0'],
    ['lojas', 'smarttef_base_url',       "smarttef_base_url VARCHAR(200) NOT NULL DEFAULT ''"],
    ['lojas', 'smarttef_token',          'smarttef_token TEXT'],
    ['lojas', 'smarttef_gateway_token',  'smarttef_gateway_token TEXT'],
    /*
     * Terminal padrão. Vazio = a ordem cai na lista geral (`order_type: NRM`) e
     * qualquer POS da loja pode pegar; preenchido, vai direto pra este aparelho
     * (`CRD_UNICO`). Loja com uma maquininha só quer o segundo; loja com três
     * caixas quer o primeiro, senão a cobrança aparece no balcão errado.
     */
    ['lojas', 'smarttef_serial_pos',     "smarttef_serial_pos VARCHAR(40) NOT NULL DEFAULT ''"],

    /*
     * ─── O que a maquininha devolve, gravado no pedido ───
     *
     * Vazio quando a venda não passou por TEF — que continua sendo a maioria, e
     * é o que mantém `tipoPagamentoNfce` compatível: sem estes campos ele segue
     * palpitando como sempre, com `ehPalpite: true`. Lojista sem TEF não regride.
     *
     * Sem COLLATE explícito de propósito: `ALTER TABLE ... ADD COLUMN` herda a
     * colação da tabela. O tombo do `subcategorias` foi em CREATE TABLE, onde
     * declarar `CHARSET` sem `COLLATE` RESSETA pro padrão do charset — aqui não
     * se declara nenhum dos dois, então não há o que ressetar.
     */
    ['pedidos', 'tef_nsu',             "tef_nsu VARCHAR(40) NOT NULL DEFAULT ''"],
    ['pedidos', 'tef_autorizacao',     "tef_autorizacao VARCHAR(40) NOT NULL DEFAULT ''"],
    ['pedidos', 'tef_bandeira',        "tef_bandeira VARCHAR(30) NOT NULL DEFAULT ''"],
    ['pedidos', 'tef_adquirente',      "tef_adquirente VARCHAR(60) NOT NULL DEFAULT ''"],
    ['pedidos', 'tef_adquirente_cnpj', "tef_adquirente_cnpj VARCHAR(20) NOT NULL DEFAULT ''"],
    /* CREDIT | DEBIT | PIX | VOUCHER — o que a adquirente confirmou, não o que
       o operador escolheu na tela. É este campo que mata o palpite da NFC-e. */
    ['pedidos', 'tef_tipo',            "tef_tipo VARCHAR(10) NOT NULL DEFAULT ''"],
    /*
     * PRAZO DA PROMOÇÃO. Vazio = sem prazo, que é o estado de toda promoção
     * cadastrada antes desta coluna — nenhum produto muda de preço na migração.
     */
    ['produtos', 'promo_fim', "promo_fim VARCHAR(10) NOT NULL DEFAULT ''"],
    /*
     * CÓDIGO DE BARRAS DUPLICADO era possível: nada impedia dois produtos com o
     * mesmo EAN na mesma loja, e ao bipar no PDV entrava o que o banco
     * devolvesse primeiro — ambiguidade em cima do caixa, na frente do cliente.
     *
     * NULL quando vazio OU quando o produto está excluído: EAN em branco é
     * legítimo (PLU de balança, produto sem código) e não pode brigar com
     * outro em branco; e produto apagado tem que liberar o código pra ser
     * recadastrado. Mesmo recurso de cpf_unico/numero_unico.
     */
    ['produtos', 'ean_unico',
      "ean_unico VARCHAR(40) GENERATED ALWAYS AS (IF(excluido = 0, NULLIF(codigo_barras, ''), NULL)) VIRTUAL"],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        LIMIT 1`,
      [tabela, coluna],
    ) as any;
    if (existe.length === 0) {
      await adicionarColuna(pool, `ALTER TABLE \`${tabela}\` ADD COLUMN ${ddl}`);
    }
  }

  /*
   * ÍNDICE ÚNICO DAS MESAS por (loja, número).
   *
   * Depende da coluna gerada `numero_unico` do laço acima, então vem depois
   * dele. É o que fecha a corrida do POST /mesas: checar "já existe?" em SQL
   * antes do INSERT nunca resolve sozinho, porque entre ler e gravar cabe outra
   * requisição — dois toques no botão criavam duas "Mesa 5", o garçom abria
   * comanda numa e a cozinha via a outra.
   *
   * O erro de chave duplicada já sai como mensagem amigável (ver
   * mensagemDeDuplicidade em util.ts), então a checagem no código continua
   * valendo como caminho normal e o índice é a garantia.
   */
  const [jaTemMesaUnica] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mesas' AND INDEX_NAME = 'uq_mesa_numero'
      LIMIT 1`,
  ) as any;
  if (jaTemMesaUnica.length === 0) {
    await criarIndice(pool, 'ALTER TABLE mesas ADD UNIQUE KEY uq_mesa_numero (loja_id, numero_unico)');
  }

  /*
   * ÍNDICE ÚNICO DO CÓDIGO DE BARRAS por (loja, EAN).
   *
   * Depende da coluna gerada `ean_unico` do laço acima, então vem DEPOIS dele —
   * criar o índice antes da coluna falha com "Unknown column", e é o erro que
   * eu mesmo já cometi neste arquivo.
   *
   * POR LOJA e não global: duas lojas diferentes vendendo a mesma Coca-Cola têm
   * o mesmo EAN legitimamente. O que não pode é a MESMA loja ter dois produtos
   * com o mesmo código, porque aí bipar no PDV é sorteio.
   *
   * Em try/catch: se já existir duplicata gravada, o CREATE falha — e derrubar o
   * boot do cliente por causa disso seria desproporcional. O aviso diz o SELECT
   * que encontra as linhas repetidas.
   */
  const [jaTemEanUnico] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND INDEX_NAME = 'uq_produto_ean'
      LIMIT 1`,
  ) as any;
  if (jaTemEanUnico.length === 0) {
    await criarIndice(pool,
      'ALTER TABLE produtos ADD UNIQUE KEY uq_produto_ean (loja_id, ean_unico)',
      "não foi possível criar uq_produto_ean. Se houver EAN repetido, encontre com: " +
      "SELECT loja_id, codigo_barras, COUNT(*) c FROM produtos WHERE excluido = 0 " +
      "AND codigo_barras <> '' GROUP BY 1,2 HAVING c > 1; — código:");
  }

  /**
   * produtos.disponivel_pdv — vender no BALCÃO é decisão separada de aparecer
   * no CARDÁPIO.
   *
   * Antes era um interruptor só: pausar um item no delivery tirava ele também
   * do PDV, e vice-versa. Mas as duas coisas se decidem por motivos
   * diferentes — o prato que só sai no salão, o combo de entrega que não faz
   * sentido no balcão, o item que acabou pro delivery mas ainda dá pra vender
   * pra quem está na loja.
   *
   * NASCE COM O VALOR DE `disponivel`, não com 1: um DEFAULT 1 cego colocaria
   * à venda no PDV todo item que o lojista tinha pausado de propósito.
   */
  const [jaTemPdv] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = 'disponivel_pdv'
      LIMIT 1`,
  ) as any;
  if (jaTemPdv.length === 0) {
    await adicionarColuna(pool, 'ALTER TABLE produtos ADD COLUMN disponivel_pdv TINYINT NOT NULL DEFAULT 1');
    await pool.query('UPDATE produtos SET disponivel_pdv = disponivel');
  }

  // pedidos.estornado_em: mesmo caso do índice acima — coluna nova que
  // `CREATE TABLE IF NOT EXISTS` não alcança em bancos já criados.
  const [jaTemColuna] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'estornado_em'
      LIMIT 1`,
  ) as any;
  if (jaTemColuna.length === 0) {
    await adicionarColuna(pool, "ALTER TABLE pedidos ADD COLUMN estornado_em VARCHAR(32) NOT NULL DEFAULT ''");
  }

  /**
   * pedidos.idempotencia — chave enviada pelo PDV pra impedir VENDA DUPLICADA.
   *
   * O caso real: o operador finaliza, o servidor grava, mas a resposta se perde
   * (rede oscilou). Ele vê erro, refaz — e a venda entra duas vezes, com estoque
   * baixado em dobro e dois cupons. O índice ÚNICO é o que garante isso no banco,
   * não só na aplicação: mesmo com duas requisições simultâneas, só uma insere.
   */
  const [jaTemIdem] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'idempotencia'
      LIMIT 1`,
  ) as any;
  if (jaTemIdem.length === 0) {
    await adicionarColuna(pool, 'ALTER TABLE pedidos ADD COLUMN idempotencia VARCHAR(64) NULL');
  }
  /**
   * ÍNDICE conferido SEPARADAMENTE da coluna, de propósito.
   *
   * Antes os dois ALTERs estavam dentro do mesmo `if (coluna não existe)`. Se o
   * primeiro passasse e o segundo falhasse — conexão caindo no meio, tenant com
   * `pedidos` grande, migração interrompida no deploy — a coluna passava a
   * existir e o índice NUNCA mais era criado, porque a condição olhava só a
   * coluna. E é o índice que garante a idempotência do PDV: sem ele, duas
   * requisições simultâneas com a mesma chave inserem as DUAS vendas, e a
   * proteção que parecia estar lá não existe.
   *
   * UNIQUE aceita vários NULL no MySQL — pedido que não vem do PDV fica de fora
   * da restrição naturalmente, sem precisar de valor sentinela.
   */
  const [jaTemIndiceIdem] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos'
        AND INDEX_NAME = 'idx_pedidos_idempotencia' LIMIT 1`,
  ) as any;
  if (jaTemIndiceIdem.length === 0) {
    await criarIndice(pool, 'ALTER TABLE pedidos ADD UNIQUE KEY idx_pedidos_idempotencia (idempotencia)');
  }

  /**
   * CAIXA — colunas novas em tabelas que já existem em produção.
   *
   * `caixas` e `caixa_movimentos` foram criadas num deploy anterior, então
   * `CREATE TABLE IF NOT EXISTS` acima não adiciona coluna nenhuma nelas: para
   * banco existente, quem faz o trabalho é o ALTER daqui. Sem isto, o tenant que
   * já rodou a versão anterior ficaria sem as colunas e toda consulta ao caixa
   * daria "Unknown column" — exatamente o erro que já apareceu neste projeto.
   */
  /*
   * CHECK de `forma_pagamento` PRECISA SER RECRIADO nos bancos que já existem.
   * `CREATE TABLE IF NOT EXISTS` não toca em tabela existente, então o CHECK antigo
   * (sem 'cartao_online') continuaria valendo e TODO pedido de cartão online seria
   * recusado pelo banco — erro que só apareceria com um cliente real tentando pagar.
   *
   * `MODIFY COLUMN` e não `DROP CONSTRAINT`/`DROP CHECK`. Duas tentativas anteriores
   * falharam e vale registrar por quê:
   *   - `DROP CHECK` é sintaxe do MySQL 8; este servidor é MariaDB 10.5 e recusa.
   *   - `DROP CONSTRAINT` é a sintaxe do MariaDB, mas NÃO remove CHECK de COLUNA
   *     (declarado junto da coluna, como aqui): roda sem erro e não muda nada.
   * Redefinir a coluna leva a nova cláusula junto, e funciona nos dois bancos.
   *
   * Idempotente: só mexe se a cláusula atual não tiver 'cartao_online'.
   */
  try {
    const [checks] = await pool.query(
      `SELECT cc.CHECK_CLAUSE AS clausula
         FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
         JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
          AND tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
        WHERE cc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'pedidos'
          AND cc.CHECK_CLAUSE LIKE '%forma_pagamento%'`,
    );
    const desatualizado = (checks as Array<{ clausula: string }>)
      .some(c => !c.clausula.includes('cartao_online'));
    if (desatualizado) {
      await pool.query(
        "ALTER TABLE pedidos MODIFY forma_pagamento VARCHAR(20) NOT NULL "
        + "CHECK (forma_pagamento IN ('pix','dinheiro','cartao_entrega','cartao_online'))",
      );
      console.log('[schema] CHECK de forma_pagamento atualizado (cartao_online liberado).');
    }
  } catch (e) {
    console.warn('[schema] não deu pra atualizar o CHECK de forma_pagamento:', (e as Error).message);
  }

  for (const [tabela, coluna, ddl] of [
    ['caixa_movimentos', 'cancelado_em',  "cancelado_em VARCHAR(32) NOT NULL DEFAULT ''"],
    ['caixa_movimentos', 'cancelado_por', "cancelado_por VARCHAR(120) NOT NULL DEFAULT ''"],
    ['caixas', 'vendas_dinheiro_centavos', 'vendas_dinheiro_centavos INT NOT NULL DEFAULT 0'],
    ['caixas', 'vendas_cartao_centavos',   'vendas_cartao_centavos INT NOT NULL DEFAULT 0'],
    ['caixas', 'vendas_pix_centavos',      'vendas_pix_centavos INT NOT NULL DEFAULT 0'],
    ['caixas', 'vendas_quantidade',        'vendas_quantidade INT NOT NULL DEFAULT 0'],
    ['caixas', 'sangrias_centavos',        'sangrias_centavos INT NOT NULL DEFAULT 0'],
    ['caixas', 'suprimentos_centavos',     'suprimentos_centavos INT NOT NULL DEFAULT 0'],
    // Login social: identidade no provedor. `oauth_sub` é o id NO PROVEDOR, que é
    // estável e nunca reutilizado — casar por e-mail sozinho não serve, porque a
    // pessoa pode trocar o e-mail da conta Google e continuar sendo a mesma.
    ['usuarios', 'oauth_provedor', "oauth_provedor VARCHAR(20) NOT NULL DEFAULT ''"],
    ['usuarios', 'oauth_sub',      "oauth_sub VARCHAR(64) NOT NULL DEFAULT ''"],
  ] as Array<[string, string, string]>) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [tabela, coluna],
    ) as any;
    if (existe.length === 0) {
      await adicionarColuna(pool, `ALTER TABLE \`${tabela}\` ADD COLUMN ${ddl}`);
    }
  }

  // lojas.pagamento_gateway: idem — escolha do gateway de Pix online por loja
  // (mercadopago | onz). Default 'mercadopago' preserva o comportamento de
  // quem já estava rodando antes desta coluna existir.
  const [jaTemGateway] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lojas' AND COLUMN_NAME = 'pagamento_gateway'
      LIMIT 1`,
  ) as any;
  if (jaTemGateway.length === 0) {
    await pool.query(
      "ALTER TABLE lojas ADD COLUMN pagamento_gateway VARCHAR(20) NOT NULL DEFAULT 'mercadopago'"
    );
  }

  // Credenciais da conta ONZ por loja (mesmo caso: colunas novas que o
  // CREATE TABLE IF NOT EXISTS não alcança em bancos já criados).
  for (const [coluna, ddl] of [
    ['onz_client_id', 'onz_client_id TEXT'],
    ['onz_client_secret', 'onz_client_secret TEXT'],
    ['onz_pix_key', 'onz_pix_key VARCHAR(80)'],
    /*
     * ASSINATURA DO WEBHOOK POR LOJA, não por servidor.
     *
     * O Mercado Pago emite a assinatura secreta POR APLICAÇÃO, e cada lojista
     * usa a conta dele. Uma variável de ambiente única validaria a notificação
     * de UMA loja e descartaria silenciosamente a de todas as outras — bug que
     * só apareceria com o segundo cliente, e como "os pedidos demoram 5 minutos
     * pra aparecer, e só na loja nova".
     */
    ['mercadopago_webhook_secret', 'mercadopago_webhook_secret TEXT'],
    /*
     * PUBLIC KEY guardada EM CLARO, ao contrário do access token.
     *
     * Ela é pública por definição: vai pro navegador do cliente pra montar o
     * formulário de cartão, e qualquer um que abra o cardápio consegue lê-la no
     * código da página. Cifrar daria falsa sensação de segredo e só atrapalharia
     * a leitura de quem viesse depois. Quem autoriza cobrança é o access token,
     * esse sim cifrado.
     */
    ['mercadopago_public_key', 'mercadopago_public_key VARCHAR(120)'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lojas' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE lojas ADD COLUMN ${ddl}`);
  }

  /*
   * TEMPO ESTIMADO por zona/área, e a FOTO dele no pedido.
   *
   * Era um número só da loja (40 min) pra todo mundo: quem mora a 1 km e quem
   * mora a 8 km viam a mesma previsão. Agora cada área pode ter o seu, e 0
   * significa 'usa o da loja'.
   *
   * No PEDIDO fica uma cópia: a contagem regressiva na tela do cliente não pode
   * mudar porque o lojista ajustou o padrão depois — a promessa foi feita na
   * hora do pedido.
   */
  for (const [tabela, coluna, ddl] of [
    ['zonas_entrega', 'tempo_min', 'tempo_min INT NOT NULL DEFAULT 0'],
    ['pedidos', 'tempo_estimado_min', 'tempo_estimado_min INT NOT NULL DEFAULT 0'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        LIMIT 1`, [tabela, coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
  }

  /*
   * TIPO REAL do pagamento, como o gateway devolveu (credit_card, debit_card,
   * account_money...). Sem isto a NFC-e declarava CRÉDITO pra todo cartão,
   * inclusive débito — e a SEFAZ autoriza normalmente, porque 03 é um código
   * válido. O dado sempre veio do Mercado Pago; a gente é que descartava.
   */
  for (const [coluna, ddl] of [
    ['pagamento_tipo', "pagamento_tipo VARCHAR(20) NOT NULL DEFAULT ''"],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE pedidos ADD COLUMN ${ddl}`);
  }

  /*
   * CHAVE DE IDEMPOTÊNCIA do checkout: o navegador gera uma por tentativa e a
   * repete em qualquer reenvio. O ÍNDICE ÚNICO é o que garante de verdade —
   * checar antes de inserir não resolve corrida, e duplo clique no celular é
   * exatamente uma corrida.
   *
   * Coluna gerada + UNIQUE (mesmo truque do CPF/telefone): string vazia vira
   * NULL, e NULLs não conflitam — pedidos antigos e chamadas sem chave
   * continuam passando.
   */
  for (const [coluna, ddl] of [
    ['chave_idem', 'chave_idem VARCHAR(64)'],
    ['chave_idem_unica', "chave_idem_unica VARCHAR(64) GENERATED ALWAYS AS (NULLIF(chave_idem, '')) VIRTUAL"],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE pedidos ADD COLUMN ${ddl}`);
  }
  {
    const [idx] = await pool.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND INDEX_NAME = 'idx_pedidos_idem'
        LIMIT 1`,
    ) as any;
    if (idx.length === 0) {
      await criarIndice(pool, 'ALTER TABLE pedidos ADD UNIQUE KEY idx_pedidos_idem (chave_idem_unica)');
    }
  }

  /*
   * PERMISSÕES POR ÁREA do usuário do painel (JSON com as chaves das áreas).
   * NULL = acesso total, pra não trancar quem já usava o sistema antes do
   * recurso existir. Usuário novo nasce com a lista explícita.
   */
  /*
   * PIZZA: o grupo diz QUE PAPEL cumpre e COMO soma.
   *
   * `papel = 'tamanho'`  → as opções dele liberam N sabores (coluna `sabores`)
   * `papel = 'sabores'`  → o limite vem do tamanho escolhido, não do max_escolhas
   * `modo_preco = 'maior'` → conta só o MAIOR acréscimo do grupo, não a soma
   *
   * Sem isso, pizza de 3 sabores somava os três acréscimos: um preço que
   * pizzaria nenhuma pratica, aparecendo no carrinho do cliente.
   */
  for (const [coluna, ddl] of [
    ['papel', "papel VARCHAR(10) NOT NULL DEFAULT ''"],
    ['modo_preco', "modo_preco VARCHAR(10) NOT NULL DEFAULT 'somar'"],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos_opcoes' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE grupos_opcoes ADD COLUMN ${ddl}`);
  }

  /*
   * VENDIDO AVULSO NO CARDÁPIO?
   *
   * Combo de "1 Grande + 1 Broto" precisa de um produto "Pizza Broto" que
   * EXISTE (pra ser referenciado) e NÃO APARECE no cardápio.
   *
   * `disponivel = 0` não serve: ela quer dizer "pausado", e o painel mostra
   * "pausado" no card. Um componente que nunca foi pra venda avulsa apareceria
   * como se estivesse temporariamente fora — a tela mentindo sobre o motivo.
   *
   * Nasce em 1, que é o comportamento de todo produto que já existe.
   */
  /*
   * A POSIÇÃO DO PRODUTO DENTRO DA FAIXA.
   *
   * Categoria e subcategoria já eram ordenáveis; dentro delas a lista era
   * `destaque DESC, nome` — alfabética. Numa faixa "Prontas" com sete pizzas,
   * a que sustenta a casa ficava onde a letra mandasse.
   *
   * Nasce em 0, e o backfill abaixo põe a posição que o produto JÁ OCUPA hoje —
   * sem isso todo mundo empataria em 0 e o primeiro arrasto embaralharia a
   * faixa inteira na cara do cliente.
   */
  for (const [coluna, ddl] of [
    ['vendido_sozinho', 'vendido_sozinho TINYINT NOT NULL DEFAULT 1'],
    ['ordem', 'ordem INT NOT NULL DEFAULT 0'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE produtos ADD COLUMN ${ddl}`);
  }

  /*
   * COLAÇÃO IGUAL À DE `produtos` — SEM ISSO O JOIN NÃO É "MAIS LENTO", É ERRO.
   *
   * A tabela nasceu com `DEFAULT CHARSET=utf8mb4` no CREATE. Parece inofensivo
   * e não é: declarar o charset RESSETA a colação pra padrão do charset
   * (`utf8mb4_general_ci` no MariaDB), ignorando a do banco
   * (`utf8mb4_unicode_ci`, que é a de todas as outras tabelas). Comparar
   * VARCHAR entre colações diferentes é ER_CANT_AGGREGATE_2COLLATIONS — erro
   * fatal, não aviso. O cardápio inteiro respondeu 500 até isto rodar.
   *
   * O CREATE já não declara mais charset (herda o do banco, como as demais).
   * Este reparo é pros bancos onde a tabela já foi criada com o CREATE antigo.
   * Alinha com `produtos` em vez de fixar `unicode_ci` no código: o que importa
   * é ser IGUAL à coluna do outro lado do JOIN, e um tenant restaurado de dump
   * antigo pode ter outra.
   */
  {
    const [dif] = await pool.query(
      `SELECT s.TABLE_COLLATION AS atual, p.TABLE_COLLATION AS alvo
         FROM INFORMATION_SCHEMA.TABLES s
         JOIN INFORMATION_SCHEMA.TABLES p
           ON p.TABLE_SCHEMA = s.TABLE_SCHEMA AND p.TABLE_NAME = 'produtos'
        WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = 'subcategorias'
          AND s.TABLE_COLLATION <> p.TABLE_COLLATION`,
    ) as any;
    if (dif.length > 0) {
      const alvo = String(dif[0].alvo);
      /* Só nomes de colação do próprio servidor chegam aqui (vieram do
         INFORMATION_SCHEMA), mas colação não aceita placeholder em DDL — daí a
         checagem de formato antes de interpolar. */
      if (/^[a-z0-9_]+$/.test(alvo)) {
        await pool.query(
          `ALTER TABLE subcategorias CONVERT TO CHARACTER SET utf8mb4 COLLATE ${alvo}`,
        );
      }
    }
  }

  /*
   * FASE 4: A COZINHA RECEBE A COMPOSIÇÃO.
   *
   * O ticket guardava só nome e quantidade. Com a venda de balcão já gravando as
   * escolhas (fase 3), o item finalizado saía certo no cupom — mas "enviar
   * cozinha" antes de fechar a venda mandava a pizza pelada, e é justamente o
   * envio antecipado que existe pra cozinha começar a produzir.
   */
  for (const [coluna, ddl] of [
    ['opcoes_texto', 'opcoes_texto TEXT'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cozinha_ticket_itens' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) {
      await adicionarColuna(pool, `ALTER TABLE cozinha_ticket_itens ADD COLUMN ${ddl}`);
    }
  }

  /*
   * FASE 1 DO BALCÃO COM OPÇÕES — só as colunas, ninguém lê ainda.
   *
   * Hoje mesa e balcão lançam o item pelo PREÇO BASE e sem escolha nenhuma:
   * uma pizza que no delivery sai a R$ 77 (sabor + borda) é registrada a R$ 45,
   * e a cozinha recebe "Pizza Artesanal" sem tamanho nem sabor. Grupo
   * obrigatório, que no delivery impede fechar o pedido, aqui passa direto.
   *
   * Esta fase não muda comportamento nenhum: as colunas nascem NULL, nada
   * escreve e nada lê. É o ponto de volta seguro — dá pra aplicar hoje e
   * decidir a fase 2 depois.
   */
  for (const [coluna, ddl] of [
    ['opcoes_texto', 'opcoes_texto TEXT'],
    ['opcoes_ids', 'opcoes_ids TEXT'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comanda_itens' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) {
      await adicionarColuna(pool, `ALTER TABLE comanda_itens ADD COLUMN ${ddl}`);
    }
  }

  /*
   * BACKFILL DA ORDEM DOS PRODUTOS: a posição de hoje vira a posição inicial.
   *
   * Uma vez por tenant; depois `ordem` é do lojista e reexecutar jogaria fora o
   * arranjo dele. O critério é o `ORDER BY` que as duas telas usavam
   * (`destaque DESC, nome`) dentro de cada faixa: no deploy nada muda de lugar.
   */
  {
    const [feito] = await pool.query(
      "SELECT valor FROM configuracoes WHERE chave = 'mig_ordem_produtos' LIMIT 1",
    ) as any;
    if (feito.length === 0) {
      await pool.query(
        `UPDATE produtos p JOIN (
             SELECT id, ROW_NUMBER() OVER (
                      PARTITION BY loja_id, categoria, subcategoria
                      ORDER BY destaque DESC, nome
                    ) AS pos
               FROM produtos WHERE excluido = 0
           ) t ON t.id = p.id
            SET p.ordem = t.pos`,
      );
      await pool.query(
        "INSERT IGNORE INTO configuracoes (chave, valor) VALUES ('mig_ordem_produtos', '1')",
      );
    }
  }

  /*
   * BACKFILL DAS SUBCATEGORIAS: a tela de hoje vira a ordem inicial.
   *
   * Roda uma vez por tenant. O critério reproduz o que o painel mostra hoje —
   * a faixa aparece na posição do seu primeiro produto, e "primeiro" era
   * `destaque DESC, nome`. Assim, no deploy, NADA muda de lugar: só passa a
   * ser editável.
   */
  {
    const [feito] = await pool.query(
      "SELECT valor FROM configuracoes WHERE chave = 'mig_ordem_subcategorias' LIMIT 1",
    ) as any;
    if (feito.length === 0) {
      await pool.query(
        `INSERT IGNORE INTO subcategorias (loja_id, categoria, nome, ordem, criado_em)
         SELECT loja_id, categoria, nome, ROW_NUMBER() OVER (
                  PARTITION BY loja_id, categoria ORDER BY tem_destaque DESC, primeiro
                ), NOW()
           FROM (SELECT loja_id, categoria, subcategoria AS nome,
                        MAX(destaque) AS tem_destaque, MIN(nome) AS primeiro
                   FROM produtos
                  WHERE excluido = 0 AND subcategoria IS NOT NULL AND subcategoria <> ''
                  GROUP BY loja_id, categoria, subcategoria) g`,
      );
      await pool.query(
        "INSERT IGNORE INTO configuracoes (chave, valor) VALUES ('mig_ordem_subcategorias', '1')",
      );
    }
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * FASE 1 DO REAPROVEITAMENTO DE GRUPOS
   *
   * Três passos, e nenhum deles muda comportamento: ninguém lê `loja_id` nem
   * `produto_grupos` ainda. É o ponto de volta seguro — dá pra aplicar hoje e
   * decidir a fase 2 depois.
   * ─────────────────────────────────────────────────────────────────────────
   */

  /*
   * `loja_id` NO GRUPO NÃO É ENFEITE, É AUTORIZAÇÃO.
   *
   * `meuGrupo` (rotas/lojista.ts) descobre o dono do grupo por
   * `JOIN produtos p ON p.id = g.produto_id`. Quando o grupo passar a ser
   * compartilhado, ele pode existir sem produto ligado nenhum — e aí não teria
   * dono: a rota devolveria 404 pra sempre e a linha ficaria órfã no banco,
   * inalcançável e indelével. Mesma coisa em `minhaOpcao` e na exclusão de loja
   * pelo admin, que apaga grupos via `produto_id IN (SELECT ... WHERE loja_id)`.
   *
   * Entra NULL agora e é preenchida logo abaixo; virar NOT NULL fica pra quando
   * as rotas pararem de gravar `produto_id`.
   */
  for (const [coluna, ddl] of [
    ['loja_id', 'loja_id INT NULL'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos_opcoes' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE grupos_opcoes ADD COLUMN ${ddl}`);
  }

  /*
   * `produto_id` PASSA A ACEITAR NULL.
   *
   * É o que permite um grupo de biblioteca que não está ligado a nenhum produto.
   * A coluna continua existindo e sendo gravada pelas rotas de hoje — some só
   * quando a fase 2 parar de usá-la.
   *
   * O `IS_NULLABLE` na frente NÃO é economia de linha: `MODIFY COLUMN` reescreve
   * a tabela em várias versões do MySQL, e isto roda no boot de TODA instância,
   * de TODO tenant. Sem a checagem, cada reinício do PM2 (três instâncias)
   * reconstruiria a tabela três vezes, de graça.
   */
  {
    const [nulavel] = await pool.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grupos_opcoes'
          AND COLUMN_NAME = 'produto_id' LIMIT 1`,
    ) as any;
    if (nulavel.length > 0 && nulavel[0].IS_NULLABLE === 'NO') {
      await pool.query('ALTER TABLE grupos_opcoes MODIFY produto_id INT NULL');
    }
  }

  /* Dono do grupo: vem do produto que ele já tem. Só as linhas ainda sem dono. */
  await pool.query(
    `UPDATE grupos_opcoes g JOIN produtos p ON p.id = g.produto_id
        SET g.loja_id = p.loja_id
      WHERE g.loja_id IS NULL`,
  );

  /*
   * UMA LIGAÇÃO POR GRUPO EXISTENTE, e nada mais.
   *
   * O BACKFILL NÃO MESCLA GRUPOS DE NOME IGUAL, e essa é a decisão mais
   * importante desta fase. Os 5 "Tamanho" do mostruário NÃO são o mesmo grupo:
   * um deles tem `Gigante` com `sabores = 4`, e os outros podem ter itens e
   * preços diferentes. Mesclar automaticamente mudaria preço de cardápio e
   * limite de sabores de produtos que ninguém pediu pra mexer — em silêncio, no
   * boot, em todos os tenants de uma vez.
   *
   * Migração é 1:1. A consolidação vem depois, como ferramenta que o lojista
   * aciona, comparando item a item antes de juntar.
   *
   * `INSERT IGNORE` + o UNIQUE são o que deixa isto rodar nas três instâncias do
   * PM2 ao mesmo tempo sem uma derrubar a migração da outra.
   *
   * A checagem antes existe pelo mesmo motivo do `IS_NULLABLE`: sem ela, todo
   * boot varreria `grupos_opcoes` inteira pra reinserir nada. Com ela, o custo
   * em regime é uma linha lida.
   */
  {
    const [pendentes] = await pool.query(
      `SELECT 1 FROM grupos_opcoes g
         LEFT JOIN produto_grupos pg ON pg.grupo_id = g.id AND pg.produto_id = g.produto_id
        WHERE g.produto_id IS NOT NULL AND pg.id IS NULL
        LIMIT 1`,
    ) as any;
    if (pendentes.length > 0) {
      await pool.query(
        `INSERT IGNORE INTO produto_grupos (produto_id, grupo_id, ordem, obrigatorio, max_escolhas)
         SELECT produto_id, id, ordem, obrigatorio, max_escolhas
           FROM grupos_opcoes WHERE produto_id IS NOT NULL`,
      );
    }
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * A JANELA ENTRE A FASE 1 E A FASE 2, fechada uma única vez.
   *
   * A fase 1 criou `produto_grupos` copiando `obrigatorio`, `max_escolhas` e
   * `ordem` do grupo. Nesse momento os dois lados eram iguais. Mas até a fase 2
   * subir, o `PUT /grupos/:id` continuou gravando SÓ no grupo — então toda
   * edição feita nessa janela deixou a ligação parada no valor antigo.
   *
   * Aconteceu de verdade, e em menos de uma hora: o grupo "Tamanho" da pizza
   * ficou com `max_escolhas = 3` no grupo e `1` na ligação. No instante em que a
   * fase 2 passou a ler pela ligação, o limite do produto voltou pra 1 sem
   * ninguém pedir. Não dá erro, não aparece em log: é o cardápio mudando sozinho.
   *
   * A CONDIÇÃO `g.produto_id = pg.produto_id` É O QUE TORNA ISTO SEGURO. Ela
   * seleciona exatamente as ligações que o backfill da fase 1 criou a partir
   * daquele grupo — nunca uma ligação criada depois, à mão, pra um segundo
   * produto. E o marcador em `configuracoes` faz rodar UMA VEZ por tenant:
   * depois da fase 2 a ligação é a autoridade, e divergir passa a ser o
   * comportamento correto (borda obrigatória na pizza, opcional na esfiha). Sem
   * o marcador, cada reinício do PM2 sobrescreveria a regra de cada produto com
   * o padrão do grupo.
   *
   * RISCO ASSUMIDO: se alguém editar a regra de um produto entre o deploy da
   * fase 2 e o desta reconciliação, o valor novo é perdido em favor do padrão do
   * grupo. A janela é de um deploy, e o alternativo — deixar cardápio divergente
   * em banco de tenant restaurado de backup daquele período — é pior.
   * ─────────────────────────────────────────────────────────────────────────
   */
  {
    const [feito] = await pool.query(
      "SELECT valor FROM configuracoes WHERE chave = 'mig_ligacao_reconciliada' LIMIT 1",
    ) as any;
    if (feito.length === 0) {
      await pool.query(
        `UPDATE produto_grupos pg JOIN grupos_opcoes g ON g.id = pg.grupo_id
            SET pg.obrigatorio = g.obrigatorio,
                pg.max_escolhas = g.max_escolhas,
                pg.ordem = g.ordem
          WHERE g.produto_id = pg.produto_id`,
      );
      await pool.query(
        "INSERT IGNORE INTO configuracoes (chave, valor) VALUES ('mig_ligacao_reconciliada', '1')",
      );
    }
  }

  // Quantos sabores esta opção libera. Só faz sentido nas opções do grupo de
  // tamanho; 0 = não define nada (o padrão de toda opção que não é tamanho).
  for (const [coluna, ddl] of [
    ['sabores', 'sabores INT NOT NULL DEFAULT 0'],
    ['secao', "secao VARCHAR(40) NOT NULL DEFAULT ''"],
    ['descricao', "descricao VARCHAR(160) NOT NULL DEFAULT ''"],
    ['imagem', "imagem VARCHAR(500) NOT NULL DEFAULT ''"],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opcoes_itens' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE opcoes_itens ADD COLUMN ${ddl}`);
  }

  for (const [coluna, ddl] of [
    ['permissoes', 'permissoes TEXT'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE usuarios ADD COLUMN ${ddl}`);
  }

  // Zonas de entrega por ÁREA desenhada no mapa (antes só existia por bairro).
  for (const [coluna, ddl] of [
    ['nome', 'nome VARCHAR(80)'],
    ['poligono_json', 'poligono_json TEXT'],
  ] as const) {
    const [existe] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zonas_entrega' AND COLUMN_NAME = ?
        LIMIT 1`, [coluna],
    ) as any;
    if (existe.length === 0) await adicionarColuna(pool, `ALTER TABLE zonas_entrega ADD COLUMN ${ddl}`);
  }
}
