/**
 * CATEGORIZA OS PRODUTOS DE UMA LOJA PELO NOME.
 *
 * Ferramenta de linha de comando, ENSAIO POR PADRÃO. Sem `--valendo` ela não
 * escreve nada: imprime a distribuição e a lista do que não conseguiu resolver.
 *
 *   node dist/backend/categorizar-produtos.js --tenant=tenant_galderio_bebidas --loja=1
 *   node dist/backend/categorizar-produtos.js --tenant=tenant_galderio_bebidas --loja=1 --valendo
 *
 * PARA QUE ELA EXISTE: a importação do Maxx Gestão traz a categoria do GRUPO do
 * ERP. Empresa que não cadastrou grupo lá — o caso da Galderio Bebidas — recebe
 * os produtos todos em "Geral", e um cardápio de 1.225 itens numa categoria só
 * não tem navegação nenhuma.
 *
 * SÓ MEXE NO QUE NINGUÉM ESCOLHEU. Produto cuja categoria não é vazia nem o
 * padrão do ERP ("Geral") fica como está: se alguém digitou aquilo, foi decisão,
 * e decisão de gente não é sobrescrita por ferramenta.
 *
 * E A IMPORTAÇÃO SEGUINTE NÃO DESFAZ. `planejarImportacaoErp` só reescreve a
 * categoria quando o valor atual é igual ao espelho (o que o ERP disse por
 * último) — ver `podeAtualizar`. Gravando aqui e NÃO tocando no espelho, o
 * produto passa a contar como editado, que é exatamente o que ele é.
 *
 * A ORDEM DAS FAIXAS também é gravada, em `categorias`, a partir de
 * `ORDEM_SUGERIDA`. Sem isso a vitrine ordena alfabeticamente e abre a loja com
 * "Acessórios para narguilé" na frente de "Cervejas".
 */
import 'dotenv/config';
import db, { comTenant } from './db-mysql';
import { categoriaPorNome, ORDEM_SUGERIDA } from './categoria-por-nome';
import { agoraUTC } from './util';

/** A categoria que a importação do ERP usa quando o grupo vem vazio. */
const PADRAO_DO_ERP = 'Geral';

interface Produto { id: number; nome: string; categoria: string }

function argumento(nome: string): string {
  const p = process.argv.find(a => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : '';
}

async function principal(): Promise<void> {
  const tenant = argumento('tenant');
  const lojaId = Number(argumento('loja') || 0);
  const valendo = process.argv.includes('--valendo');

  if (!tenant || !lojaId) {
    console.error('Uso: --tenant=<banco> --loja=<id> [--valendo]');
    process.exit(2);
  }

  console.log(valendo ? '=== VALENDO ===' : '=== ENSAIO (nada será escrito) ===');
  console.log(`tenant ${tenant}, loja ${lojaId}\n`);

  await comTenant(tenant, async () => {
    const produtos = await db.prepare(
      'SELECT id, nome, categoria FROM produtos WHERE loja_id = ? AND excluido = 0 ORDER BY nome',
    ).all(lojaId) as Produto[];

    const porCategoria = new Map<string, Produto[]>();
    const semCategoria: Produto[] = [];
    const jaEscolhidos: Produto[] = [];

    for (const p of produtos) {
      const atual = (p.categoria || '').trim();
      if (atual && atual !== PADRAO_DO_ERP) { jaEscolhidos.push(p); continue; }
      const nova = categoriaPorNome(p.nome);
      if (!nova) { semCategoria.push(p); continue; }
      if (!porCategoria.has(nova)) porCategoria.set(nova, []);
      porCategoria.get(nova)!.push(p);
    }

    /* Na ordem da vitrine, não na de contagem: o relatório tem que se parecer
       com a tela que a mudança vai produzir. */
    const ordenadas = [...porCategoria.keys()].sort((a, b) => {
      const ia = ORDEM_SUGERIDA.indexOf(a);
      const ib = ORDEM_SUGERIDA.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
    });

    let mudariam = 0;
    for (const c of ordenadas) {
      const lista = porCategoria.get(c)!;
      mudariam += lista.length;
      const exemplos = lista.slice(0, 3).map(p => p.nome.slice(0, 30)).join(' · ');
      console.log(`${String(lista.length).padStart(4)}  ${c.padEnd(26)} ${exemplos}`);
    }
    console.log(`\n${mudariam} produtos receberiam categoria, em ${ordenadas.length} faixas.`);
    console.log(`${jaEscolhidos.length} já tinham categoria escolhida e não são tocados.`);
    console.log(`${semCategoria.length} ficam SEM categoria — nenhuma regra casou:`);
    for (const p of semCategoria) console.log(`      #${p.id} ${p.nome}`);

    if (!valendo) {
      console.log('\nEnsaio. Rode de novo com --valendo para gravar.');
      return;
    }

    /*
     * O ANTES É GRAVADO EM ARQUIVO, não só na tela.
     *
     * Sem isso, desfazer depende de todo mundo ainda estar em "Geral" — e basta
     * uma edição do lojista no meio para essa suposição virar mentira. Com a
     * lista, o desfazer é exato.
     */
    const antes = ordenadas.flatMap(c => porCategoria.get(c)!.map(p => ({
      id: p.id, de: p.categoria, para: c,
    })));
    const arquivo = `categorizacao-${tenant}-loja${lojaId}-${Date.now()}.json`;
    (await import('fs')).writeFileSync(arquivo, JSON.stringify(antes, null, 2), 'utf8');
    console.log(`\n→ estado anterior salvo em ${arquivo}`);

    let gravados = 0;
    for (const c of ordenadas) {
      for (const p of porCategoria.get(c)!) {
        await db.prepare('UPDATE produtos SET categoria = ? WHERE id = ? AND loja_id = ?')
          .run(c, p.id, lojaId);
        gravados++;
      }
    }
    console.log(`→ ${gravados} produtos categorizados`);

    /*
     * E O REGISTRO DA CATEGORIA, para a faixa ter ordem. `INSERT ... ON
     * DUPLICATE KEY UPDATE` respeita a chave única (loja_id, nome) — rodar duas
     * vezes não duplica nem zera o ícone que alguém já tenha escolhido.
     */
    let faixas = 0;
    for (const c of ordenadas) {
      const ordem = ORDEM_SUGERIDA.indexOf(c);
      await db.prepare(
        'INSERT INTO categorias (loja_id, nome, ordem, criado_em) VALUES (?, ?, ?, ?) '
        + 'ON DUPLICATE KEY UPDATE ordem = VALUES(ordem)',
      ).run(lojaId, c, ordem < 0 ? 999 : ordem, agoraUTC());
      faixas++;
    }
    console.log(`→ ${faixas} faixas registradas com ordem de vitrine`);
  });
}

principal().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
