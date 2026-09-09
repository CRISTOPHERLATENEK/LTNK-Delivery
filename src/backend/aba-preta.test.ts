import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * DUAS ABAS PRETAS, DUAS CAUSAS DIFERENTES.
 *
 * Medido na tela do dono da plataforma, os dois botões do detalhe da loja:
 *
 *  1. "Abrir loja" levava a `maxxpedidos.com.br/loja/galderiobebidas` e a
 *     página vinha VAZIA — `document.body` sem uma letra. Dois erros somados:
 *     o caminho `/loja/x` não existe (a loja é `/:id`, de UM segmento) e, sendo
 *     relativo, abria no domínio do painel, onde a loja de um cliente não mora.
 *     E o app não tinha rota de "não encontrado", então nada disso aparecia:
 *     era só uma aba preta.
 *
 *  2. "Entrar como lojista" chegava no painel e mostrava um "Entrar" solto no
 *     meio do nada — sem título, sem campo de e-mail, sem senha. Não era CSS
 *     nem tema: os `div` de campo estavam com `opacity: 0; transform:
 *     translate(0px, 18px)` no estilo inline, e `document.getAnimations()`
 *     vazio. Animação de entrada que começou e nunca terminou.
 */

const RAIZ = path.join(__dirname, '..', '..');
const lerFront = (...p: string[]) => fs.readFileSync(path.join(RAIZ, 'frontend', 'src', ...p), 'utf8');
const app = lerFront('App.tsx');
const detalhe = lerFront('pages', 'admin', 'loja-detalhe.tsx');
const painelLojista = lerFront('pages', 'lojista', 'painel.tsx');
const admin = fs.readFileSync(path.join(__dirname, 'rotas', 'admin.ts'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('o endereço público da loja', () => {
  it('o teste está lendo os arquivos certos', () => {
    expect(detalhe).toContain('Abrir loja');
    expect(admin).toContain("router.get('/lojas/:id/painel'");
  });

  /*
   * A TELA NÃO MONTA MAIS O ENDEREÇO. Ela não tem como: o domínio depende do
   * tenant, e o tenant é conhecido no servidor.
   */
  it('a tela usa o endereço que veio do servidor', () => {
    expect(exec(detalhe)).toContain('const url = l.url_publica');
  });

  it('e não monta caminho nenhum na mão', () => {
    /* `/loja/${slug}` é o caminho que não existe. Nem ele, nem parente. */
    expect(exec(detalhe)).not.toContain('/loja/${');
    expect(exec(detalhe)).not.toContain('`https://${l.dominio_personalizado}`');
  });

  /*
   * O SERVIDOR MONTA COM `urlDoTenant`, que já resolve domínio próprio e
   * subdomínio — repetir essa regra no front garantiria as duas discordando.
   */
  it('o servidor devolve url_publica montada com o domínio do tenant', () => {
    const codigo = exec(admin);
    expect(codigo).toContain('url_publica: urlPublica');
    expect(codigo).toContain('tenantPorDbNome(bancoTenantAtual())');
    expect(codigo).toContain('urlDoTenant(tenantDaLoja)');
  });

  /* Um segmento, não dois: é o formato que a rota `/:id` casa. */
  it('o caminho tem um segmento só', () => {
    expect(exec(admin)).toContain('`${base}/${loja.slug}`');
  });

  /* Loja sem slug não gera link quebrado: gera link nenhum, e a tela some com o
     botão (`{url && ...}`). */
  it('sem slug, o endereço fica vazio', () => {
    expect(exec(admin)).toMatch(/base && loja\.slug \? .* : ''/);
    expect(detalhe).toContain('{url && <a href={url}');
  });
});

describe('endereço que não existe', () => {
  /*
   * SEM ROTA CORINGA, `<Routes>` não escolhe elemento nenhum e a página fica
   * preta. Foi o que transformou um link errado em "não acontece nada".
   */
  it('há uma rota coringa no fim', () => {
    expect(app).toContain('<Route path="*" element={<PaginaNaoEncontrada />} />');
  });

  it('e ela é a ÚLTIMA, senão engole as outras', () => {
    const iCoringa = app.indexOf('path="*"');
    const iUltimaReal = app.lastIndexOf('path="/painel-admin/*"');
    expect(iUltimaReal).toBeGreaterThan(-1);
    expect(iCoringa).toBeGreaterThan(iUltimaReal);
  });

  it('a tela diz o que houve e oferece a saída', () => {
    expect(app).toContain('Página não encontrada');
    expect(app).toContain('Voltar ao início');
  });
});

describe('a animação de entrada do login do lojista', () => {
  const anim = (() => {
    const i = painelLojista.indexOf("gsap.from('[data-anim=\"logo\"]'");
    expect(i).toBeGreaterThan(-1);
    return exec(painelLojista.slice(i, painelLojista.indexOf('}, escopo);', i)));
  })();

  it('o teste está lendo o bloco certo', () => {
    for (const nome of ['logo', 'palavra', 'apoio', 'campo', 'botao']) {
      expect(anim).toContain(`[data-anim="${nome}"]`);
    }
  });

  /*
   * A ASSERÇÃO QUE IMPORTA: NENHUM TWEEN ANIMA OPACIDADE.
   *
   * `gsap.from` com `opacity: 0` escreve zero AGORA e conta com o tween
   * terminar para revelar. Frame que não chega — aba em segundo plano, e
   * "Entrar como lojista" abre exatamente isso — deixa o elemento invisível
   * para sempre. `data-anim="campo"` está nos WRAPPERS do título e dos campos,
   * então um tween congelado esconde o formulário inteiro.
   *
   * Isto já havia sido consertado para o BOTÃO e só para ele. O resto da tela
   * ficou com o defeito e ele voltou pior.
   */
  it('nenhum tween anima opacidade', () => {
    expect(anim).not.toContain('opacity');
  });

  /* O movimento continua: o conserto é tirar a opacidade, não a animação. */
  it('o movimento continua existindo', () => {
    expect(anim).toMatch(/y: -14/);
    expect(anim).toMatch(/y: 22/);
    expect(anim).toMatch(/y: 18/);
    expect(anim).toContain("y: '0.9em'");
  });

  /*
   * E `prefers-reduced-motion` continua pulando tudo. Isso só é seguro porque
   * os elementos já estão visíveis por padrão — a animação sai DE um estado
   * deslocado. Se alguém trouxer opacidade de volta, quem pediu menos movimento
   * passa a ver uma tela vazia.
   */
  it('quem pede menos movimento vê a tela pronta, não vazia', () => {
    const fn = painelLojista.slice(painelLojista.indexOf('const escopo = useRef'));
    expect(fn.slice(0, 400)).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches) return");
  });
});

describe('o padrão não voltou em outro lugar', () => {
  /*
   * A varredura é o que impede a reincidência: o defeito já foi consertado uma
   * vez, num elemento só, e voltou nos outros do mesmo arquivo.
   */
  const TELAS = [
    ['pages', 'lojista', 'painel.tsx'],
    ['pages', 'admin', 'index.tsx'],
    ['pages', 'entregador', 'index.tsx'],
    ['pages', 'cozinha', 'painel.tsx'],
    ['pages', 'cliente', 'landing.tsx'],
  ];

  for (const partes of TELAS) {
    const nome = partes[partes.length - 1];
    it(`${partes.slice(0, -1).join('/')}/${nome} não usa gsap.from com opacity`, () => {
      let fonte: string;
      try { fonte = exec(lerFront(...partes)); } catch { return; }
      /* Casa `gsap.from(...)` até o fecha-chaves das opções e procura opacity
         lá dentro — `gsap.fromTo` com estado explícito não tem o problema,
         porque o valor final é escrito por quem chama. */
      const chamadas = fonte.match(/gsap\.from\((?!To)[^;]*?\);/gs) ?? [];
      for (const c of chamadas) expect(c, c.slice(0, 80)).not.toContain('opacity');
    });
  }
});
