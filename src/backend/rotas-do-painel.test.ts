import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * TODA ROTA QUE O PAINEL CHAMA TEM QUE EXISTIR.
 *
 * A aba "Histórico" chamava `/api/lojista/pedidos-historico`, que NUNCA foi
 * escrita: o lojista clicava e via "Não encontramos isso". Chamada sem servidor
 * não quebra compilação nem teste — só aparece clicando, e pode ficar meses
 * assim.
 *
 * Este teste lê as chamadas do frontend e confere que cada uma tem rota. É
 * grosseiro (casa por string), e é o suficiente para o buraco que existiu.
 */
const raiz = path.join(__dirname, '..', '..');

function arquivosDe(dir: string, ext: string, achados: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (fs.statSync(caminho).isDirectory()) arquivosDe(caminho, ext, achados);
    else if (nome.endsWith(ext)) achados.push(caminho);
  }
  return achados;
}

describe('as rotas do lojista que a tela chama', () => {
  const fontesRotas = arquivosDe(path.join(__dirname, 'rotas'), '.ts')
    .filter(f => !f.includes('.test.'))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const telas = arquivosDe(path.join(raiz, 'frontend', 'src'), '.tsx')
    .concat(arquivosDe(path.join(raiz, 'frontend', 'src'), '.ts'))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  /* Só as do lojista, e só o caminho fixo: rota com parâmetro no meio
     (`/pedidos/${id}/acao`) não casa por string e ficaria falso-negativo. */
  const chamadas = [...telas.matchAll(/['"`]\/api\/lojista\/([a-z0-9-]+)['"`]/g)]
    .map(m => m[1]);

  it('encontra chamadas para conferir (o teste não é vazio)', () => {
    /* Sem isto, uma mudança no jeito de chamar a API deixaria o teste passando
       por não ter o que verificar. */
    expect(new Set(chamadas).size).toBeGreaterThan(10);
  });

  it('toda rota chamada existe no servidor', () => {
    const faltando = [...new Set(chamadas)].filter(r => !fontesRotas.includes(`'/${r}'`));
    expect(faltando).toEqual([]);
  });

  it('o histórico de pedidos existe — era o buraco', () => {
    expect(fontesRotas).toContain("router.get('/pedidos-historico'");
  });
});
