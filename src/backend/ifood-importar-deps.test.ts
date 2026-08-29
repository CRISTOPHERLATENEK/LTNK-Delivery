import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/** Sem comentários: um INSERT citado numa explicação não é um INSERT. */
function semComentarios(arquivo: string): string {
  return fs.readFileSync(path.join(__dirname, arquivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('um caminho só de importação', () => {
  it('a rota NÃO tem INSERT próprio — usa as dependências compartilhadas', () => {
    /*
     * O comando de linha e o botão da tela precisam gravar pelo MESMO código.
     * Com dois conjuntos de INSERT, o que passasse num caminho não provaria
     * nada sobre o outro — e o CHECK de preco_centavos > 0, que já mordeu uma
     * vez, voltaria a morder só num deles.
     */
    const rota = semComentarios('rotas/lojista.ts');
    const trecho = rota.slice(rota.indexOf("'/ifood/cardapio/importar'"), rota.indexOf("'/nfce'"));
    expect(trecho).toContain('depsImportacaoIfood()');
    expect(trecho).not.toMatch(/INSERT INTO (produtos|grupos_opcoes|opcoes_itens)/);
  });

  it('o comando de linha usa as mesmas funções da rota', () => {
    const cli = semComentarios('ifood-importar-cli.ts');
    for (const f of ['lerCardapioIfood', 'importarCardapio', 'depsImportacaoIfood']) {
      expect(cli).toContain(f);
    }
    expect(cli).not.toMatch(/INSERT INTO/);
  });

  it('o comando exige o banco explicitamente', () => {
    /* Fora de um request não há tenant no contexto; sem `comTenant` a
       importação cairia no banco errado e criaria o cardápio de uma loja
       dentro de outra. */
    expect(semComentarios('ifood-importar-cli.ts')).toContain('comTenant(banco');
  });
});

describe('a sincronização não encosta em preço', () => {
  it('o UPDATE da sincronização não tem coluna de preço', () => {
    /*
     * A regra vale no plano (que não gera alteração de preço) E aqui, na
     * gravação. Duas guardas para a mesma coisa porque o estrago é o mesmo dos
     * dois lados: o preço do iFood embute a comissão, e num regime que roda
     * sozinho ele voltaria a cada hora.
     */
    const fonte = semComentarios('ifood-importar-deps.ts');
    /* Só o corpo de `atualizarProduto`, não o resto do arquivo: a publicação
       vive aqui do lado e PRECISA ler preço — varrer até o fim acusaria ela. */
    const inicio = fonte.indexOf('atualizarProduto:');
    const trecho = fonte.slice(inicio, fonte.indexOf('},', fonte.indexOf('UPDATE produtos', inicio)));
    expect(inicio).toBeGreaterThan(0);
    expect(trecho).toContain('UPDATE produtos');
    expect(trecho).not.toMatch(/preco/i);
  });

  it('o ciclo do servidor só pega quem ESCOLHEU a direção', () => {
    /* Sem o filtro, ligar o iFood para receber pedido ligaria junto a
       sincronização — e o cardápio da loja mudaria sem ela ter pedido. */
    const servidor = semComentarios('server.ts');
    const trecho = servidor.slice(servidor.indexOf('sincronizarCardapiosIfood'));
    expect(trecho).toContain("ifood_sincronizacao = 'do_ifood'");
  });

  it('o ciclo de cardápio NÃO roda no intervalo do polling', () => {
    /*
     * O polling de 30s é o que mantém a loja online no iFood. Uma
     * sincronização de catálogo no mesmo ritmo custaria uma chamada por item a
     * cada meio minuto e levaria o rate limit a derrubar o polling junto —
     * trocando "descrição desatualizada" por "loja fora do ar".
     */
    const servidor = semComentarios('server.ts');
    const linha = servidor.split('\n').find(l => l.includes('sincronizarCardapiosIfood().catch'));
    expect(linha).toBeDefined();
    const bloco = servidor.slice(servidor.indexOf(linha!), servidor.indexOf(linha!) + 260);
    expect(bloco).toContain('60 * 60_000');
    expect(bloco).not.toContain('30_000');
  });
});

describe('um ciclo só de sincronização', () => {
  it('o servidor e o comando chamam o MESMO ciclo', () => {
    /* Com duas orquestrações, o "sincronizar agora" do suporte provaria uma
       coisa e o automático faria outra — e a diferença só apareceria na loja
       de alguém. */
    for (const arquivo of ['server.ts', 'ifood-sincronizar-cli.ts']) {
      expect(semComentarios(arquivo)).toContain('sincronizarLojaIfood(');
    }
  });

  it('nenhum dos dois monta o plano por conta própria', () => {
    for (const arquivo of ['server.ts', 'ifood-sincronizar-cli.ts']) {
      expect(semComentarios(arquivo)).not.toContain('planejarSincronizacao(');
    }
  });
});
