/**
 * Slugs que o cardápio NÃO pode usar, porque a URL já pertence ao app.
 *
 * A loja vive em `/:id` — a rota mais genérica do cliente. Uma loja com slug
 * `pedidos` some: `/pedidos` casa com a rota ESTÁTICA de pedidos, que é mais
 * específica e vence em qualquer roteador. E o lojista não tem como descobrir
 * isso: ele salva, vê "Loja atualizada!", e o link que ele espalhou abre a tela
 * errada.
 *
 * A lista mora aqui, e não solta na rota, pra ter teste — o jeito de ela
 * apodrecer é alguém criar uma rota nova em `App.tsx` e não lembrar daqui.
 */
export const SLUGS_RESERVADOS: readonly string[] = [
  // Rotas do app do cliente.
  'carrinho', 'conta', 'esqueci-senha', 'pedido', 'pedidos', 'redefinir-senha', 'revenda', 'demo',
  /* Documentos legais que a plataforma serve por conta propria. Loja com slug
     `privacidade` responderia no endereco da politica de privacidade. */
  'termos', 'privacidade',
  // Áreas (cada uma tem o próprio prefixo de rota).
  'cozinha', 'entregador', 'lojista', 'painel-admin',
  // Servidor.
  'api', 'uploads',
  /*
   * Não são rotas hoje, mas são nomes que qualquer app acaba usando — e o custo
   * de reservar é zero perto do de descobrir depois que a loja `admin` quebrou
   * quando a rota `/admin` nasceu.
   */
  'admin', 'app', 'assets', 'login', 'painel', 'static', 'www',
  /*
   * PÁGINAS DE CONTEÚDO DA PLATAFORMA.
   *
   * Nasceram para o buscador ter o que indexar: a landing tinha tudo numa
   * página só, e o Google só classifica endereço que existe. Elas são rotas de
   * verdade, então entram aqui pelo mesmo motivo de `termos` e `privacidade` —
   * uma loja com slug `planos` responderia no lugar da página de planos.
   */
  'planos', 'recursos', 'nota-fiscal', 'duvidas',
];

/** O slug colide com uma rota do app? */
export function slugReservado(slug: string): boolean {
  return SLUGS_RESERVADOS.includes(slug.trim().toLowerCase());
}
