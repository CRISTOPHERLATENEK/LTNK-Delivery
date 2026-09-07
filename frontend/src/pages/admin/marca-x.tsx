/**
 * A MARCA "X" DA UNIMAXX, em SVG.
 *
 * Existe o PNG de 1024px em `public/integracoes/maxxgestao.png` — 768 KB, feito
 * para aparecer grande no card da integração. Num botão de 20px ele seria uma
 * imagem quase inteira baixada para virar um borrão: PNG reduzido a 5% do
 * tamanho perde o traço, e o gradiente 3D vira uma mancha.
 *
 * Em SVG o desenho é nítido em qualquer tamanho, funciona em tela de alta
 * densidade, herda a cor quando preciso e não custa download nenhum.
 */

export function MarcaX({ tamanho = 20, className }: { tamanho?: number; className?: string }) {
  /*
   * O gradiente precisa de id ÚNICO por instância.
   *
   * Dois SVGs na mesma página com `id="g"` fazem o segundo usar a definição do
   * primeiro — e se o primeiro for removido do DOM, o segundo perde a cor e
   * fica preto. É um bug que só aparece quando alguém põe dois ícones na tela.
   */
  const id = `marca-x-${tamanho}`;
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5A623" />
          <stop offset="45%" stopColor="#F2701E" />
          <stop offset="100%" stopColor="#D62410" />
        </linearGradient>
      </defs>

      {/* O X: duas diagonais que se cruzam, com a barriga curva da marca. */}
      <path
        fill={`url(#${id})`}
        d="M18 20 h16 c2 0 4 1 5 3 l11 17 11-17 c1-2 3-3 5-3 h16 l-24 34 24 34 h-16
           c-2 0-4-1-5-3 l-11-17-11 17 c-1 2-3 3-5 3 h-16 l24-34 z"
      />

      {/* Os três quadradinhos do canto superior direito. */}
      <rect x="72" y="10" width="11" height="11" rx="3" fill={`url(#${id})`} />
      <rect x="87" y="10" width="11" height="11" rx="3" fill={`url(#${id})`} />
      <rect x="87" y="25" width="11" height="11" rx="3" fill={`url(#${id})`} />
    </svg>
  );
}
