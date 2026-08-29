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
