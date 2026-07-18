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
  /** Domínio próprio apontado pelo lojista (ex.: pizzariadapaula.com.br), alternativa ao slug. */
  dominio_personalizado?: string | null;
  /** Impressão térmica do cupom. */
  impressora_largura?: '80' | '58';
  impressora_auto?: 0 | 1;
  cupom_rodape?: string;
  /** Editor visual completo (aba "Visual") — blob JSON, ver VisualJson. */
  visual_json?: string;
}

/**
 * Forma do blob `Loja.visual_json` — TODOS os ajustes cosméticos granulares
 * do editor "Visual" do lojista (independente do tema white-label da
 * PLATAFORMA em `RaioMarca`/`FonteMarca` abaixo, que é global do SaaS).
 */
export interface VisualJson {
  geral: {
    slogan: string;
    mostrar_avaliacao: boolean;
    mostrar_tempo_medio: boolean;
    mostrar_taxa_entrega: boolean;
    mostrar_pedido_minimo: boolean;
    mostrar_distancia: boolean;
  };
  cores: {
    cor_botoes: string;
    cor_cards: string;
    cor_fundo: string;
    cor_cabecalho: string;
    cor_rodape: string;
    cor_texto: string;
    cor_badges: string;
  };
  logo: {
    tamanho: number;
    formato: 'quadrado' | 'arredondado' | 'circular';
    sombra: boolean;
    borda: boolean;
    borda_branca: boolean;
    padding: boolean;
  };
  capa: {
    overlay: boolean;
    gradiente: boolean;
    blur: number;
    escurecimento: number;
    opacidade: number;
    posicao: 'topo' | 'centro' | 'base';
    ajuste: 'cover' | 'contain' | 'repeat';
  };
  cardapio: {
    layout: 'lista' | 'grid' | 'compacto' | 'premium';
    mostrar_foto: boolean;
    mostrar_descricao: boolean;
    mostrar_categoria: boolean;
    mostrar_avaliacao: boolean;
    mostrar_tempo: boolean;
    preco_destacado: boolean;
    badge_promocao: boolean;
    botao_comprar: boolean;
    espacamento: number;
    raio_bordas: number;
    altura_cards: number;
  };
  botoes: {
    hover: boolean;
    sombra: boolean;
    gradiente: boolean;
    icone: boolean;
    borda: boolean;
    raio: number;
    tamanho: 'sm' | 'md' | 'lg';
    animacao: 'nenhuma' | 'scale' | 'ripple' | 'glow' | 'fade';
  };
  tipografia: {
    fonte: 'inter' | 'poppins' | 'roboto' | 'montserrat' | 'nunito';
    peso: 400 | 500 | 600 | 700 | 800;
    espacamento: number;
    tamanho_base: number;
    altura_linha: number;
  };
  banners: {
    botao_texto: string;
    tempo_rotacao_ms: number;
    loop: boolean;
    mostrar_indicadores: boolean;
    mostrar_setas: boolean;
  };
  avancado: {
    meta_description: string;
    meta_keywords: string;
    og_image: string;
    ga_measurement_id: string;
    gtm_container_id: string;
    fb_pixel_id: string;
    tiktok_pixel_id: string;
    clarity_project_id: string;
  };
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
  /** Banner personalizado da tela de login (vazio = usa a ilustração padrão). */
  login_banner_url: string;
  /** ID da loja padrão (0 = modo marketplace, >0 = white label single-store) */
  loja_id: number;
  /** Texto do botão de CTA na landing page do produto. */
  landing_cta_texto?: string;
  /** Grade de recursos da landing page (null = usa os padrões embutidos no front). */
  landing_recursos?: LandingRecurso[] | null;
  /** Lista de benefícios (checklist) no rodapé da landing page. */
  landing_beneficios?: string[] | null;
  /** Contato de suporte e link de termos — reaproveitados no rodapé da landing (mesmos campos de Marca → Configurações gerais). */
  suporte_email?: string;
  suporte_telefone?: string;
  termos_url?: string;
  /** Comparativo "sem/com a plataforma" na landing. */
  landing_comparativo_sem?: string[] | null;
  landing_comparativo_com?: string[] | null;
  /** Segmentos de negócio atendidos (pizzaria, açaiteria...) exibidos na landing. */
  landing_segmentos?: string[] | null;
  /** Depoimentos de clientes exibidos na landing. */
  landing_depoimentos?: LandingDepoimento[] | null;
  /** Blocos de destaque com foto + texto na landing (estilo "feature highlight"). */
  landing_destaques?: LandingDestaque[] | null;
  /** Hero da landing (título grande + imagem do produto ao lado, estilo SaaS). */
  landing_hero_eyebrow?: string;
  landing_hero_titulo?: string;
  landing_hero_subtitulo?: string;
  landing_hero_imagem?: string;
  /** URL fixa do botão "Ver demonstração" — sobrepõe a busca automática pela 1ª loja do tenant (útil quando a loja de demo mora em outro tenant/domínio). */
  landing_demo_url?: string;
}

export interface LandingDestaque {
  imagem_url: string;
  titulo: string;
  desc: string;
  /** Moldura da imagem: celular, navegador (desktop) ou solta (sem moldura). */
  formato?: 'celular' | 'navegador' | 'livre';
}

/** Ícones disponíveis para os cards de recursos da landing page (ver ÍCONES_LANDING em landing.tsx). */
export type LandingIcone = 'store' | 'palette' | 'bike' | 'chefhat' | 'receipt' | 'smartphone' | 'check' | 'star' | 'shield' | 'users';

export interface LandingRecurso {
  icone: LandingIcone;
  titulo: string;
  desc: string;
}

export interface LandingDepoimento {
  texto: string;
  nome: string;
  negocio: string;
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
  /** Dados fiscais (NFC-e) — mesmos campos editáveis em lojista/fiscal.tsx. */
  ncm?: string;
  cfop?: string;
  csosn?: string;
  origem?: string;
  unidade_comercial?: string;
  cest?: string;
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
  botao_texto?: string;
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
  entregador_telefone?: string | null;
  entregador_nota_media?: number | null;
  entregador_nota_qtd?: number | null;
  entregador_chat_metodo?: 'app' | 'whatsapp' | null;
  entregador_lat?: number | null;
  entregador_lng?: number | null;
  entregador_local_em?: string | null;
  aviso_chegada_em?: string | null;
  endereco_entrega: string;
  forma_pagamento: FormaPagamento;
  pagamento_status?: 'na_entrega' | 'aguardando' | 'aprovado' | 'recusado';
  /** Preenchido quando o pagamento Pix foi estornado (ver POST /lojista/pedidos/:id/estornar). */
  estornado_em?: string | null;
  troco_para_centavos?: number | null;
  observacoes?: string;
  subtotal_centavos: number;
  taxa_entrega_centavos: number;
  total_centavos: number;
  comissao_percentual?: number;
  motivo_recusa?: string | null;
  criado_em: string;
  atualizado_em?: string;
  /** Só na listagem do lojista: mensagens do cliente ainda não lidas pela loja. */
  mensagens_nao_lidas?: number;
}

export interface ItemPedido {
  id?: number;
  produto_id?: number;
  nome_produto: string;
  preco_unit_centavos: number;
  quantidade: number;
  opcoes_texto?: string;
  /** Categoria do produto — usada pra rotear a impressão por setor (Cozinha/Bar). */
  categoria?: string | null;
}

export interface EventoStatus {
  status: StatusPedido;
  criado_em: string;
}
