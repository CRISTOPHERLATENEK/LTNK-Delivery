/** Modelos do domínio espelhados do backend (apenas o que o frontend usa). */

export type Perfil = 'cliente' | 'lojista' | 'entregador' | 'admin';

export type StatusPedido =
  | 'pendente' | 'aceito' | 'preparando' | 'pronto'
  | 'em_entrega' | 'entregue' | 'cancelado' | 'recusado';

export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao_entrega';

export type StatusLoja = 'pendente' | 'aprovada' | 'suspensa';

export type TipoGrupoOpcao = 'unico' | 'multiplo';

export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  /** 'cozinha' não é um perfil da plataforma — é uma conta de loja (KDS). */
  perfil: Perfil | 'cozinha';
  telefone?: string | null;
  /** CPF do cliente (só dígitos) — chave de login do cliente. */
  cpf?: string | null;
  /** Apenas para perfil='admin': 1 = super admin (dono do SaaS). */
  super_admin?: 0 | 1;
  /** Para contas de cozinha: a loja vinculada. */
  loja_id?: number;
  loja_nome?: string;
}

export interface Loja {
  id: number;
  nome: string;
  descricao: string;
  categoria: string;
  endereco?: string;
  taxa_entrega_centavos: number;
  tempo_estimado_min: number;
  horario_funcionamento?: string;
  status_aprovacao?: StatusLoja;
  aberta: 0 | 1;
  /** Marca da loja (white label) — URLs e cor hex, opcionais */
  logo_url?: string;
  capa_url?: string;
  favicon_url?: string;
  cor_marca?: string;
  cor_secundaria?: string;
  /** Horário automático — agenda semanal em JSON e flags. */
  horario_json?: string;
  auto_horario?: 0 | 1;
  pausado_ate?: string;
  /** Pedido mínimo da loja (centavos). */
  minimo_pedido_centavos?: number;
  /** Avaliação agregada. */
  nota_media?: number;
  nota_qtd?: number;
  /** URL amigável da loja (/loja/slug). */
  slug?: string | null;
  /** Impressão térmica do cupom. */
  impressora_largura?: '80' | '58';
  impressora_auto?: 0 | 1;
  cupom_rodape?: string;
}

/** Um dia da agenda semanal de funcionamento. dia: 0=domingo … 6=sábado. */
export interface DiaHorario {
  dia: number;
  aberto: boolean;
  abre: string;
  fecha: string;
}

/** Identidade visual da plataforma (white label global). */
export type RaioMarca = 'reto' | 'suave' | 'redondo';
export type FonteMarca = 'inter' | 'poppins' | 'montserrat' | 'roboto' | 'sistema';

export interface TemaMarca {
  nome: string;
  slogan: string;
  logo_url: string;
  favicon_url: string;
  cor_primaria: string;
  /** Cor de destaque secundária (botões alternativos, links). Vazio = derivada da primária. */
  cor_secundaria: string;
  /** Estilo dos cantos (border-radius) da interface. */
  raio: RaioMarca;
  /** Família tipográfica da marca. */
  fonte: FonteMarca;
  /** Descrição curta usada em SEO e no compartilhamento (Open Graph). */
  descricao: string;
  /** Imagem de compartilhamento (Open Graph) — aparece ao colar o link em redes sociais. */
  og_image: string;
  /** ID da loja padrão (0 = modo marketplace, >0 = white label single-store) */
  loja_id: number;
}

export interface OpcaoItem {
  id: number;
  nome: string;
  preco_adicional_centavos: number;
}

export interface GrupoOpcoes {
  id: number;
  nome: string;
  tipo: TipoGrupoOpcao;
  obrigatorio: 0 | 1;
  max_escolhas: number;
  opcoes: OpcaoItem[];
}

export interface Produto {
  id: number;
  loja_id?: number;
  nome: string;
  descricao: string;
  categoria: string;
  subcategoria?: string;
  preco_centavos: number;
  preco_promocional_centavos?: number | null;
  serve_pessoas?: number | null;
  destaque?: 0 | 1;
  foto_url?: string;
  disponivel?: 0 | 1;
  controla_estoque?: 0 | 1;
  estoque?: number;
  vendido_por?: 'un' | 'kg';
  codigo_barras?: string;
  grupos?: GrupoOpcoes[];
}

export interface Endereco {
  id: number;
  rotulo: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep?: string;
  referencia?: string;
  lat?: number | null;
  lon?: number | null;
}

export interface ItemCarrinho {
  chave: string;            // produtoId + ":" + ids opções ordenados
  produto_id: number;
  nome: string;
  preco_centavos: number;
  quantidade: number;
  opcoes: number[];
  opcoes_texto: string;
  foto_url?: string;
}

export interface CarrinhoLocal {
  loja_id: number;
  loja_nome: string;
  taxa_entrega_centavos: number;
  itens: ItemCarrinho[];
}

export interface Banner {
  id: number;
  titulo: string;
  subtitulo?: string;
  imagem: string;
  loja_id?: number | null;
  loja_nome?: string;
  produto_id?: number | null;
  produto_nome?: string;
  link_url?: string | null;
}

export interface ProdutoPromocao extends Produto {
  loja_id: number;
  loja_nome: string;
  loja_categoria: string;
}

export interface CategoriaContagem {
  categoria: string;
  qtd: number;
}

export interface Pedido {
  id: number;
  status: StatusPedido;
  loja_nome?: string;
  tempo_estimado_min?: number;
  cliente_nome?: string;
  cliente_telefone?: string | null;
  entregador_nome?: string | null;
  entregador_lat?: number | null;
  entregador_lng?: number | null;
  entregador_local_em?: string | null;
  aviso_chegada_em?: string | null;
  endereco_entrega: string;
  forma_pagamento: FormaPagamento;
  troco_para_centavos?: number | null;
  observacoes?: string;
  subtotal_centavos: number;
  taxa_entrega_centavos: number;
  total_centavos: number;
  comissao_percentual?: number;
  motivo_recusa?: string | null;
  criado_em: string;
  atualizado_em?: string;
}

export interface ItemPedido {
  id?: number;
  produto_id?: number;
  nome_produto: string;
  preco_unit_centavos: number;
  quantidade: number;
  opcoes_texto?: string;
}

export interface EventoStatus {
  status: StatusPedido;
  criado_em: string;
}
