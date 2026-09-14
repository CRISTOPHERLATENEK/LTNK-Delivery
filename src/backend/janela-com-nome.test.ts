import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * TODA JANELA QUE ABRE TEM QUE TER NOME.
 *
 * O modal de produto — a tela em que o cliente escolhe sabor, borda e
 * complemento, ou seja, ONDE A VENDA ACONTECE — abria sem título. Para quem
 * enxerga não fazia falta: o nome está na foto. Para quem usa leitor de tela, a
 * caixa era anunciada como uma janela SEM NOME, e só dava para descobrir em que
 * produto se entrou varrendo o conteúdo inteiro.
 *
 * O Radix reclamava disso no console em toda abertura ("DialogContent requires
 * a DialogTitle"). Era um aviso de biblioteca com gente do outro lado.
 */

const RAIZ = path.join(__dirname, '../../frontend/src');
const ler = (p: string) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const comBarras = (p: string) => p.split(path.sep).join('/');

describe('as caixas que abrem por cima da tela têm nome', () => {
  it('o modal de produto anuncia o produto', () => {
    const fonte = ler('pages/cliente/modal-produto.tsx');
    expect(fonte).toContain('<SheetTitle');
    /* COM O NOME DO PRODUTO, e nao um rotulo fixo: "Produto" em toda abertura
       nao diz em qual delas a pessoa esta. */
    expect(fonte).toMatch(/<SheetTitle[^>]*>\{produto\.nome\}<\/SheetTitle>/);
  });

  /*
   * A VARREDURA: o defeito nasce quando alguém escreve a próxima caixa e não
   * lembra do título — exatamente como nasceu esta. Conferir só o modal de
   * produto protegeria o único lugar que já está certo.
   */
  it('nenhuma tela abre Sheet ou Dialog sem título', () => {
    const semNome: string[] = [];
    const varrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { varrer(p); continue; }
        if (!e.name.endsWith('.tsx')) continue;
        /* `components/ui` é a biblioteca (quem DEFINE Sheet e Dialog); quem
           precisa do título é quem USA. */
        if (comBarras(p).includes('/components/ui/')) continue;
        const t = fs.readFileSync(p, 'utf8');
        for (const [conteudo, titulo] of [['SheetContent', 'SheetTitle'], ['DialogContent', 'DialogTitle']]) {
          const abre = (t.match(new RegExp('<' + conteudo + '[\\s>]', 'g')) ?? []).length;
          const nomeia = (t.match(new RegExp('<' + titulo + '[\\s>]', 'g')) ?? []).length;
          if (abre > nomeia) {
            semNome.push(`${comBarras(path.relative(RAIZ, p))}: ${abre} ${conteudo}, ${nomeia} ${titulo}`);
          }
        }
      }
    };
    varrer(RAIZ);
    expect(semNome).toEqual([]);
  });
});
