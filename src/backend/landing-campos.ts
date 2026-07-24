/**
 * FONTE ÚNICA dos campos da landing page do produto.
 *
 * Antes, cada campo precisava ser declarado em TRÊS lugares: o GET e o PUT de
 * /api/admin/landing (rotas/admin.ts) e o GET /api/tema (rotas/publico.ts).
 * Esquecer um deles gerava o bug clássico "editei no admin e o site não mudou"
 * (o campo era salvo, mas o /api/tema nunca devolvia). Aqui os campos são
 * declarados UMA vez e os três caminhos derivam desta lista.
 *
 * Como adicionar um campo novo: acrescente uma entrada em CAMPOS_TEXTO (texto
 * simples) ou CAMPOS_LISTA (array salvo como JSON). Nada mais — leitura no
 * admin, escrita validada e exposição pública passam a funcionar sozinhas.
 *
 * Convenção de chave em `configuracoes`:
 *   texto → `landing_<nome>`          (ex.: landing_hero_titulo)
 *   lista → `landing_<nome>_json`     (ex.: landing_recursos_json)
 *
 * ATENÇÃO ao mexer nos textos padrão: são promessas comerciais públicas. Nada
 * de claim absoluto que a operação não controla (ex.: "100% autorizada na
 * SEFAZ" — a autorização depende do órgão, não do sistema) nem de promessa que
 * o backend contradiz (ex.: prometer "sem comissão" com o motor de comissão
 * ligado). Descreva o que o sistema FAZ.
 */
import { textoLimpo, erroHttp } from './util';

export const LANDING_ICONES = [
  'store', 'palette', 'bike', 'chefhat', 'receipt', 'smartphone', 'check', 'star', 'shield', 'users',
  'ticket', 'chart', 'list', 'share', 'rocket', 'printer', 'qrcode', 'key', 'cloud', 'zap', 'bell', 'pin',
] as const;

export const LANDING_FORMATOS = ['celular', 'navegador', 'livre'] as const;

type Icone = typeof LANDING_ICONES[number];

/** Campo de texto simples — chave de config derivada: `landing_<nome>`. */
interface CampoTexto {
  nome: string;
  /** Limite de caracteres aplicado na escrita. */
  max: number;
  /** Valor devolvido quando nada foi salvo ainda. */
  padrao?: string;
  /** Quando true, o padrão também vale no /api/tema (público), não só no admin. */
  padraoPublico?: boolean;
}

/** Campo de lista salvo como JSON — chave de config derivada: `landing_<nome>_json`. */
interface CampoLista {
  nome: string;
  /** Valor devolvido ao admin quando nada foi salvo (o público recebe null e usa o default do frontend). */
  padrao: unknown[];
  /** Valida e normaliza o array cru do PUT. Deve lançar erroHttp em dado inválido. */
  validar(bruto: unknown): unknown[];
}

export const chaveDeTexto = (nome: string) => `landing_${nome}`;
export const chaveDeLista = (nome: string) => `landing_${nome}_json`;

/* ───────────────────────── helpers de validação ───────────────────────── */

/** Garante array e tamanho máximo, e mapeia cada item pelo normalizador. */
function normalizarLista<T>(bruto: unknown, maxItens: number, rotulo: string, mapear: (item: unknown) => T): T[] {
  if (!Array.isArray(bruto) || bruto.length > maxItens) {
    throw erroHttp(400, `Lista "${rotulo}" inválida (máximo ${maxItens} itens).`);
  }
  return bruto.map(mapear);
}

/** Lista de strings simples (benefícios, segmentos, comparativos). */
function listaDeTextos(bruto: unknown, maxItens: number, maxTexto: number, rotulo: string): string[] {
  return normalizarLista(bruto, maxItens, rotulo, (s) => textoLimpo(s, maxTexto)).filter(Boolean);
}

/** Item { icone, titulo, desc } — usado em Recursos, Como funciona e mini-cards fiscais. */
function itemIconeTituloDesc(item: unknown, maxDesc: number, rotulo: string, iconePadrao: Icone) {
  const o = item as { icone?: unknown; titulo?: unknown; desc?: unknown };
  const icone = LANDING_ICONES.includes(o.icone as Icone) ? (o.icone as Icone) : iconePadrao;
  const titulo = textoLimpo(o.titulo, 60);
  if (!titulo) throw erroHttp(400, `Todo item de "${rotulo}" precisa de um título.`);
  return { icone, titulo, desc: textoLimpo(o.desc, maxDesc) };
}

/* ───────────────────────── campos de texto ───────────────────────── */

export const CAMPOS_TEXTO: CampoTexto[] = [
  // Hero
  { nome: 'cta_texto', max: 60, padrao: 'Ver demonstração', padraoPublico: true },
  { nome: 'hero_eyebrow', max: 80 },
  { nome: 'hero_titulo', max: 120 },
  { nome: 'hero_subtitulo', max: 240 },
  { nome: 'hero_imagem', max: 500 },
  { nome: 'hero_imagem_mobile', max: 500 },
  // Contato / demo
  { nome: 'whatsapp', max: 30 },
  { nome: 'demo_url', max: 300 },
  // Títulos de seção
  { nome: 'como_funciona_titulo', max: 100 },
  { nome: 'como_funciona_subtitulo', max: 200 },
  { nome: 'atendimento_titulo', max: 100 },
  { nome: 'atendimento_subtitulo', max: 200 },
  { nome: 'automacao_titulo', max: 100 },
  { nome: 'automacao_subtitulo', max: 200 },
  { nome: 'recursos_titulo', max: 100 },
  { nome: 'planos_titulo', max: 100 },
  { nome: 'planos_subtitulo', max: 200 },
  { nome: 'duvidas_titulo', max: 100 },
  // Seção fiscal
  { nome: 'fiscal_eyebrow', max: 60 },
  { nome: 'fiscal_titulo', max: 100 },
  { nome: 'fiscal_texto', max: 300 },
  { nome: 'fiscal_selo_titulo', max: 100 },
  { nome: 'fiscal_selo_desc', max: 160 },
  { nome: 'cupom_total', max: 20, padrao: '56,00' },
  // CTA final
  { nome: 'cta_titulo', max: 100 },
  { nome: 'cta_subtitulo', max: 240 },
  { nome: 'cta_botao_demo_texto', max: 40 },
  // Mensagens pré-preenchidas do WhatsApp
  { nome: 'whatsapp_msg_hero', max: 200 },
  { nome: 'whatsapp_msg_cta', max: 200 },
  { nome: 'whatsapp_msg_flutuante', max: 200 },
  // Rodapé
  { nome: 'footer_coluna_sistema', max: 40 },
  { nome: 'footer_coluna_contato', max: 40 },
  { nome: 'endereco', max: 200 },
  { nome: 'social_instagram', max: 300 },
  { nome: 'social_facebook', max: 300 },
  { nome: 'social_tiktok', max: 300 },
  { nome: 'social_youtube', max: 300 },
  { nome: 'social_x', max: 300 },
];

/* ───────────────────────── campos de lista ───────────────────────── */

export const CAMPOS_LISTA: CampoLista[] = [
  {
    nome: 'recursos',
    padrao: [
      { icone: 'store', titulo: 'Loja própria', desc: 'Seu painel, seu cardápio e seu domínio — só seu, nada compartilhado.' },
      { icone: 'palette', titulo: 'White label', desc: 'Cores, logo e visual totalmente do jeito da sua marca.' },
      { icone: 'bike', titulo: 'Rastreio ao vivo', desc: 'O cliente acompanha o entregador em tempo real no mapa, do pedido até a porta.' },
      { icone: 'bike', titulo: 'App do entregador', desc: 'App próprio pra aceitar a corrida, navegar até o destino e avisar o cliente.' },
      { icone: 'chefhat', titulo: 'Cozinha (KDS)', desc: 'Painel de produção próprio, sem misturar com o financeiro.' },
      { icone: 'receipt', titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda, sem depender de outro sistema.' },
      { icone: 'smartphone', titulo: 'PDV + Comandas', desc: 'Venda no balcão e mesas do salão, tudo no mesmo lugar.' },
    ],
    validar: (b) => normalizarLista(b, 9, 'Recursos', (i) => itemIconeTituloDesc(i, 160, 'Recursos', 'store')),
  },
  {
    nome: 'beneficios',
    padrao: ['Sem taxa de setup', 'Domínio próprio', 'Suporte a Pix, cartão e dinheiro'],
    validar: (b) => listaDeTextos(b, 6, 80, 'Benefícios'),
  },
  {
    nome: 'comparativo_sem',
    padrao: ['Desorganização no atendimento', 'Falhas de comunicação', 'Erros nos pedidos'],
    validar: (b) => listaDeTextos(b, 6, 80, 'Sem a plataforma'),
  },
  {
    nome: 'comparativo_com',
    padrao: ['Agilidade e organização nos pedidos', 'Sua operação num lugar só', 'Menos erro, mais venda'],
    validar: (b) => listaDeTextos(b, 6, 80, 'Com a plataforma'),
  },
  {
    nome: 'segmentos',
    padrao: ['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria'],
    validar: (b) => listaDeTextos(b, 16, 40, 'Segmentos'),
  },
  {
    nome: 'depoimentos',
    padrao: [],
    validar: (b) => normalizarLista(b, 12, 'Depoimentos', (d) => {
      const o = d as { texto?: unknown; nome?: unknown; negocio?: unknown };
      const texto = textoLimpo(o.texto, 300);
      const nome = textoLimpo(o.nome, 60);
      if (!texto || !nome) throw erroHttp(400, 'Todo depoimento precisa de texto e nome.');
      return { texto, nome, negocio: textoLimpo(o.negocio, 60) };
    }),
  },
  {
    nome: 'destaques',
    padrao: [
      { imagem_url: '/landing/storefront-mobile.png', formato: 'celular', titulo: 'Seu cliente pede direto pelo celular', desc: 'Cardápio digital com foto, categorias e busca — sem app pra baixar. O cliente monta o pedido e finaliza em segundos, com Pix, cartão ou dinheiro.' },
      { imagem_url: '/landing/storefront-desktop.png', formato: 'navegador', titulo: 'Sua loja online com a sua cara', desc: 'Cores, logo e capa personalizados. Seu próprio endereço, cardápio e visual — do jeito da marca.' },
    ],
    validar: (b) => normalizarLista(b, 4, 'Destaques', (d) => {
      const o = d as { imagem_url?: unknown; titulo?: unknown; desc?: unknown; formato?: unknown };
      const titulo = textoLimpo(o.titulo, 80);
      if (!titulo) throw erroHttp(400, 'Todo destaque precisa de um título.');
      const formato = LANDING_FORMATOS.includes(o.formato as typeof LANDING_FORMATOS[number])
        ? o.formato : 'navegador';
      return { imagem_url: textoLimpo(o.imagem_url, 500), titulo, desc: textoLimpo(o.desc, 240), formato };
    }),
  },
  {
    nome: 'planos',
    padrao: [
      { nome: 'Iniciante', preco: 'R$ 97/mês', destaque: false, cta: 'Começar agora', recursos: ['1 loja com domínio próprio', 'Cardápio digital ilimitado', 'Pedidos, cozinha e PDV', 'Pix, cartão e dinheiro', 'Suporte por WhatsApp'] },
      { nome: 'Profissional', preco: 'R$ 197/mês', destaque: true, cta: 'Assinar Profissional', recursos: ['Tudo do Iniciante', 'NFC-e integrada (nota na venda)', 'Rastreio de entregador ao vivo', 'Comandas e mesas do salão', 'Relatórios completos', 'Suporte prioritário'] },
      { nome: 'Mais de uma unidade', preco: 'Sob medida', destaque: false, cta: 'Falar com a gente', recursos: ['Cada unidade é um acesso próprio', 'Banco e domínio separados por unidade', 'A sua marca em cada uma', 'Sem taxa de setup'] },
    ],
    validar: (b) => normalizarLista(b, 6, 'Planos', (p) => {
      const o = p as { nome?: unknown; preco?: unknown; destaque?: unknown; cta?: unknown; recursos?: unknown };
      const nome = textoLimpo(o.nome, 40);
      if (!nome) throw erroHttp(400, 'Todo plano precisa de um nome.');
      const recursos = Array.isArray(o.recursos)
        ? o.recursos.slice(0, 12).map((r) => textoLimpo(r, 80)).filter(Boolean)
        : [];
      return {
        nome, preco: textoLimpo(o.preco, 40), destaque: !!o.destaque,
        cta: textoLimpo(o.cta, 40) || 'Falar no WhatsApp', recursos,
      };
    }),
  },
  {
    nome: 'faq',
    padrao: [
      { pergunta: 'Preciso de CNPJ pra usar?', resposta: 'Pra vender e emitir NFC-e, sim (a nota exige CNPJ e certificado A1). Mas você pode montar o cardápio e testar tudo antes de decidir.' },
      { pergunta: 'Em quanto tempo minha loja fica no ar?', resposta: 'No mesmo dia. Você cadastra os produtos, define cores e logo, e já compartilha o link da sua loja com os clientes.' },
      { pergunta: 'Vocês cobram taxa por pedido?', resposta: 'Não. Você paga só a mensalidade do plano — nenhuma comissão por venda. O que você fatura é seu.' },
      { pergunta: 'Tem fidelidade ou multa de cancelamento?', resposta: 'Não. Sem contrato de fidelidade e sem multa. Você cancela quando quiser.' },
      { pergunta: 'Funciona com a minha impressora?', resposta: 'Sim. Somos compatíveis com as principais impressoras térmicas do mercado (80mm e 58mm), pro cupom e pro DANFE da NFC-e.' },
      { pergunta: 'Preciso instalar algo pra imprimir os pedidos?', resposta: 'Não. Por padrão a impressão sai pelo diálogo do navegador, sem instalar nada. Se quiser imprimir direto na térmica sem esse diálogo (mais rápido pro balcão), tem um agente opcional pra Windows que faz isso automaticamente.' },
      { pergunta: 'Como funciona o domínio da minha loja?', resposta: 'Você recebe um link pronto assim que cadastra a loja (ex.: seusite.com/sua-loja). Se preferir, também pode apontar o seu próprio domínio (ex.: sualoja.com.br) — é só ajustar o DNS e colar o domínio no painel.' },
      { pergunta: 'Dá pra criar cupom de desconto?', resposta: 'Sim. Você cria cupons por valor fixo ou percentual, com validade e limite de usos — o cliente aplica no carrinho e o desconto sai certinho no pedido e na nota.' },
    ],
    validar: (b) => normalizarLista(b, 15, 'Dúvidas', (f) => {
      const o = f as { pergunta?: unknown; resposta?: unknown };
      const pergunta = textoLimpo(o.pergunta, 160);
      if (!pergunta) throw erroHttp(400, 'Toda dúvida precisa de uma pergunta.');
      return { pergunta, resposta: textoLimpo(o.resposta, 600) };
    }),
  },
  {
    nome: 'como_funciona',
    padrao: [
      { icone: 'list', titulo: 'Monte seu cardápio', desc: 'Cadastre produtos, fotos, categorias e preços — leva minutos, sem depender de ninguém.' },
      { icone: 'share', titulo: 'Compartilhe o link da sua loja', desc: 'Domínio próprio, sem app pra instalar. O cliente abre e já pede.' },
      { icone: 'rocket', titulo: 'Comece a vender', desc: 'Pedido cai direto na cozinha, entregador sai com rastreio ao vivo e o pagamento (Pix, cartão ou dinheiro) já cai na sua conta.' },
    ],
    validar: (b) => normalizarLista(b, 3, 'Como funciona', (i) => itemIconeTituloDesc(i, 160, 'Como funciona', 'list')),
  },
  {
    nome: 'stats',
    // "NFC-e emitida direto na SEFAZ" em vez de "100% autorizada": a autorização
    // depende da resposta do órgão (ver sefaz.ts), não é algo que prometemos.
    padrao: [
      { numero: '2 min', texto: 'do pedido à cozinha' },
      { numero: 'NFC-e', texto: 'emitida direto na SEFAZ' },
      { numero: '0', texto: 'taxa por pedido' },
      { numero: '1 dia', texto: 'para a loja ficar no ar' },
    ],
    validar: (b) => normalizarLista(b, 4, 'Estatísticas', (s) => {
      const o = s as { numero?: unknown; texto?: unknown };
      const numero = textoLimpo(o.numero, 20);
      if (!numero) throw erroHttp(400, 'Toda estatística precisa de um número.');
      return { numero, texto: textoLimpo(o.texto, 60) };
    }),
  },
  {
    nome: 'automacao',
    padrao: [
      { icone: 'zap', titulo: 'Pix automático', desc: 'O pagamento se confirma sozinho — sem conferência manual.', itens: ['Pix, cartão e dinheiro aceitos', 'Confirmação automática via Mercado Pago', 'Sem digitar nada no caixa'] },
      { icone: 'bell', titulo: 'Notificação automática', desc: 'Seu cliente acompanha o pedido sem precisar perguntar.', itens: ['Aviso quando o pedido é aceito', 'Aviso quando sai pra entrega', 'Aviso quando é entregue'] },
      { icone: 'star', titulo: 'Avaliações dos clientes', desc: 'Cada pedido entregue pode ser avaliado — e você acompanha tudo.', itens: ['Nota e comentário por pedido', 'Média da loja no seu painel', 'Ajuda a enxergar o que melhorar'] },
    ],
    validar: (b) => normalizarLista(b, 3, 'Automação', (a) => {
      const base = itemIconeTituloDesc(a, 160, 'Automação', 'star');
      const o = a as { itens?: unknown };
      const itens = Array.isArray(o.itens)
        ? o.itens.slice(0, 5).map((i) => textoLimpo(i, 100)).filter(Boolean)
        : [];
      return { ...base, itens };
    }),
  },
  {
    nome: 'fiscal_mini',
    padrao: [
      { icone: 'printer', titulo: 'Emissão automática', desc: 'NFC-e sai na finalização do pedido.' },
      { icone: 'qrcode', titulo: 'QR Code', desc: 'Consulta rápida pelo consumidor.' },
      { icone: 'key', titulo: 'Chave de acesso', desc: 'Válida em qualquer portal da SEFAZ.' },
      { icone: 'cloud', titulo: 'Impressão', desc: 'Compatível com térmicas 80/58mm.' },
    ],
    validar: (b) => normalizarLista(b, 4, 'Mini-cards fiscais', (i) => itemIconeTituloDesc(i, 120, 'Mini-cards fiscais', 'printer')),
  },
  {
    nome: 'cupom_itens',
    padrao: [
      { q: 1, nome: 'X-SALADA ARTESANAL', v: '28,00' },
      { q: 1, nome: 'PORCAO BATATA RUSTICA', v: '16,00' },
      { q: 2, nome: 'REFRIGERANTE LATA', v: '12,00' },
    ],
    validar: (b) => normalizarLista(b, 6, 'Itens do cupom', (c) => {
      const o = c as { q?: unknown; nome?: unknown; v?: unknown };
      const nome = textoLimpo(o.nome, 60);
      if (!nome) throw erroHttp(400, 'Todo item do cupom precisa de um nome.');
      return { q: Math.min(Math.max(Number(o.q) || 1, 1), 99), nome, v: textoLimpo(o.v, 10) };
    }),
  },
];

/* ───────────────────────── leitura / escrita ───────────────────────── */

/** Lê uma chave de `configuracoes` e devolve '' quando não existe. */
export type LerConfig = (chave: string) => Promise<string>;
/** Grava (upsert) uma chave em `configuracoes`. */
export type GravarConfig = (chave: string, valor: string) => Promise<unknown>;

function parseOuPadrao(bruto: string, padrao: unknown): unknown {
  if (!bruto) return padrao;
  try { return JSON.parse(bruto); } catch { return padrao; }
}

/**
 * Objeto do editor do admin (GET /api/admin/landing): nomes CURTOS
 * (`hero_titulo`) e defaults preenchidos, pra tela abrir já com conteúdo.
 */
export async function montarLandingAdmin(ler: LerConfig): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  for (const c of CAMPOS_TEXTO) {
    saida[c.nome] = (await ler(chaveDeTexto(c.nome))) || c.padrao || '';
  }
  for (const c of CAMPOS_LISTA) {
    saida[c.nome] = parseOuPadrao(await ler(chaveDeLista(c.nome)), c.padrao);
  }
  return saida;
}

/**
 * Fatia da landing no GET /api/tema (público): nomes com PREFIXO
 * (`landing_hero_titulo`). Listas voltam `null` quando nunca foram salvas — o
 * frontend aplica os próprios defaults nesse caso (evita mandar um payload
 * gordo em toda visita e mantém o texto padrão junto do componente que o usa).
 */
export async function montarLandingPublica(ler: LerConfig): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  for (const c of CAMPOS_TEXTO) {
    const v = await ler(chaveDeTexto(c.nome));
    saida[chaveDeTexto(c.nome)] = v || (c.padraoPublico ? (c.padrao ?? '') : '');
  }
  for (const c of CAMPOS_LISTA) {
    const bruto = await ler(chaveDeLista(c.nome));
    saida[chaveDeTexto(c.nome)] = bruto ? parseOuPadrao(bruto, null) : null;
  }
  return saida;
}

/**
 * Aplica o PUT /api/admin/landing: valida e grava só os campos presentes no
 * corpo (ausente = "não mexe", diferente de vazio = "limpa").
 */
export async function salvarLanding(corpo: Record<string, unknown>, gravar: GravarConfig): Promise<void> {
  for (const c of CAMPOS_TEXTO) {
    if (corpo[c.nome] === undefined) continue;
    await gravar(chaveDeTexto(c.nome), textoLimpo(corpo[c.nome], c.max));
  }
  for (const c of CAMPOS_LISTA) {
    if (corpo[c.nome] === undefined) continue;
    await gravar(chaveDeLista(c.nome), JSON.stringify(c.validar(corpo[c.nome])));
  }
}
