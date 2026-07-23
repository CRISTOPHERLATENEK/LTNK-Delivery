/**
 * Modelos de domínio compartilhados entre backend e frontend.
 *
 * Convenções:
 *  - Valores monetários em CENTAVOS (number inteiro).
 *  - Datas em UTC, formato ISO 8601 (string).
 *  - Booleans persistidos como 0/1 no SQLite mas usados como number aqui
 *    (NumeroBooleano) para refletir o que sai do banco sem conversão.
 */

export type NumeroBooleano = 0 | 1;

export type Perfil = 'cliente' | 'lojista' | 'entregador' | 'admin';

export type StatusPedido =
  | 'pendente' | 'aceito' | 'preparando' | 'pronto'
  | 'em_entrega' | 'entregue' | 'cancelado' | 'recusado';

export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao_entrega';

export type StatusPagamento = 'na_entrega' | 'aguardando' | 'aprovado' | 'recusado';

export type StatusLoja = 'pendente' | 'aprovada' | 'suspensa';

export type TipoGrupoOpcao = 'unico' | 'multiplo';

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  senha_hash: string;
  perfil: Perfil;
  telefone: string | null;
  /** CPF do cliente (11 dígitos, sem máscara). Chave de login do cliente. */
  cpf: string | null;
  bloqueado: NumeroBooleano;
  /** Apenas para perfil='admin': 1 = super admin (dono do SaaS, pode tudo). */
  super_admin: NumeroBooleano;
  criado_em: string;
  /** 2FA (TOTP) — obrigatório para lojista/admin. Secret cifrado (criptografar/descriptografar). */
  totp_secret: string | null;
  totp_ativo: NumeroBooleano;
  /** JSON: array de hashes bcrypt (um por código de backup ainda não usado). */
  totp_backup_codes: string | null;
}

export type UsuarioPublico = Omit<Usuario, 'senha_hash' | 'bloqueado'> & { bloqueado?: NumeroBooleano };

export interface Loja {
  id: number;
  usuario_id: number;
  nome: string;
  descricao: string;
  categoria: string;
  endereco: string;
  taxa_entrega_centavos: number;
  tempo_estimado_min: number;
  horario_funcionamento: string;
  status_aprovacao: StatusLoja;
  aberta: NumeroBooleano;
  /** White label da loja — URLs HTTPS e cor hex (#rrggbb), vazias = padrão */
  logo_url?: string;
  capa_url?: string;
  favicon_url?: string;
  cor_marca?: string;
  cor_secundaria?: string;
  /** Coordenadas geocodificadas do endereço (melhor esforço; podem ser null). */
  lat?: number | null;
  lon?: number | null;
  criado_em: string;
}

/** Identidade visual da plataforma (white label global). */
export interface TemaMarca {
  nome: string;
  slogan: string;
  logo_url: string;
  favicon_url: string;
  cor_primaria: string;
}

export interface Produto {
  id: number;
  loja_id: number;
  nome: string;
  descricao: string;
  categoria: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  serve_pessoas: number | null;
  destaque: NumeroBooleano;
  foto_url: string;
  disponivel: NumeroBooleano;
  controla_estoque: NumeroBooleano;
  estoque: number;
  excluido: NumeroBooleano;
  criado_em: string;
}

export interface GrupoOpcao {
  id: number;
  produto_id: number;
  nome: string;
  tipo: TipoGrupoOpcao;
  obrigatorio: NumeroBooleano;
  max_escolhas: number;
  ordem: number;
}

export interface OpcaoItem {
  id: number;
  grupo_id: number;
  nome: string;
  preco_adicional_centavos: number;
  disponivel: NumeroBooleano;
  ordem: number;
}

/** Grupo já com suas opções aninhadas (formato devolvido pela API). */
export interface GrupoComOpcoes extends GrupoOpcao {
  opcoes: OpcaoItem[];
}

/** Produto com grupos (cardápio). */
export interface ProdutoComGrupos extends Produto {
  grupos: GrupoComOpcoes[];
}

export interface Endereco {
  id: number;
  usuario_id: number;
  rotulo: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  referencia: string;
  /** Coordenadas geocodificadas (OpenStreetMap) — podem ser null se não achou. */
  lat: number | null;
  lon: number | null;
  criado_em: string;
}

export interface Pedido {
  id: number;
  cliente_id: number;
  loja_id: number;
  entregador_id: number | null;
  status: StatusPedido;
  endereco_entrega: string;
  forma_pagamento: FormaPagamento;
  troco_para_centavos: number | null;
  observacoes: string;
  subtotal_centavos: number;
  taxa_entrega_centavos: number;
  total_centavos: number;
  comissao_percentual: number;
  comissao_centavos: number;
  pagamento_status: StatusPagamento;
  pagamento_gateway: string | null;
  pagamento_gateway_id: string | null;
  motivo_recusa: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ItemPedido {
  id: number;
  pedido_id: number;
  produto_id: number;
  nome_produto: string;
  preco_unit_centavos: number;
  quantidade: number;
  opcoes_texto: string;
  opcoes_ids: string;
}

export interface HistoricoStatus {
  id: number;
  pedido_id: number;
  status: StatusPedido;
  criado_em: string;
}

export interface Banner {
  id: number;
  titulo: string;
  imagem: string;
  loja_id: number | null;
  link_url: string | null;
  ordem: number;
  ativo: NumeroBooleano;
  criado_em: string;
}

/** Item enviado pelo cliente ao criar um pedido. */
export interface ItemRequisicaoPedido {
  produto_id: number;
  quantidade: number;
  opcoes?: number[];
}

/** Corpo da requisição de criação de pedido. */
export interface RequisicaoCriarPedido {
  loja_id: number;
  itens: ItemRequisicaoPedido[];
  endereco_id: number;
  forma_pagamento: FormaPagamento;
  troco_para?: string | number | null;
  observacoes?: string;
}

/** Estado da sessão guardado no localStorage do navegador. */
export interface SessaoLocal {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  telefone?: string | null;
}
