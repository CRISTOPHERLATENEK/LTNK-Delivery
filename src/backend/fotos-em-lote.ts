/**
 * BUSCA FOTO DE FUNDO BRANCO PARA OS PRODUTOS SEM FOTO, EM LOTE.
 *
 * Ferramenta de linha de comando, ENSAIO POR PADRÃO. Sem `--valendo` ela não
 * escreve nada: procura, converte, mede o fundo e imprime o que faria.
 *
 *   node dist/backend/fotos-em-lote.js --tenant=tenant_galderio_bebidas --loja=1
 *   node dist/backend/fotos-em-lote.js --tenant=tenant_galderio_bebidas --loja=1 --valendo
 *
 * POR QUE EM LOTE. A lupa do cadastro resolve um produto por vez, e isso é o
 * certo quando alguém está cadastrando. Medido na Galderio em 10/09/2026: 281
 * produtos à venda sem foto, 255 deles com código de barras. Um por vez, com
 * conferência, são horas de trabalho de gente para um resultado que a máquina
 * acerta em 8 de cada 10 — e os 2 que ela erra são recusados, não gravados.
 *
 * A CONFERÊNCIA CONTINUA EXISTINDO, só muda de lugar: aqui ela é a REGRA DE
 * FUNDO BRANCO (`analisarFundo`), que já recusa a foto de prateleira, mais o
 * ensaio, que mostra produto por produto antes de qualquer escrita. Depois de
 * rodar valendo, quem olha é o lojista no cardápio — e trocar uma foto errada
 * é um clique na lupa, não um sinistro.
 *
 * EFEITO DE LADO QUE VALE SABER: a vitrine usa a foto do PRIMEIRO produto da
 * categoria como capa da faixa quando o lojista não escolheu uma
 * (`categoria_foto_auto`, em publico.ts). Gravar foto em lote muda essas capas
 * sem ninguém pedir — não é defeito, é consequência, e a saída é escolher a
 * capa na tela de Categorias, que vence a automática.
 *
 * NUNCA SOBRESCREVE FOTO QUE JÁ EXISTE. Nem na seleção (só entra produto com
 * `foto_url` vazio) nem na escrita (o UPDATE repete a condição). Entre a
 * seleção e a escrita passam minutos, e nesses minutos o lojista pode ter
 * subido a foto dele — que vale mais que a minha.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import nodeCrypto from 'crypto';
import db, { comTenant } from './db-mysql';
import { acharFotoDeFundoBranco, LIMITE_ENTRE_CHAMADAS, type Motivo, type NomeFonte } from './foto-por-codigo';

/**
 * A PAUSA ENTRE PRODUTOS. As duas fontes são de terceiros e nenhuma me deve
 * nada: 255 consultas em rajada é o tipo de coisa que faz um serviço gratuito
 * bloquear o IP do servidor — e aí a lupa do cadastro para de funcionar para
 * todo mundo, por causa de um lote.
 *
 * É O MESMO NÚMERO QUE `foto-por-codigo.ts` MEDIU (`LIMITE_ENTRE_CHAMADAS`),
 * e não um segundo palpite: eu tinha posto 400 ms aqui, um terço do limite que
 * o outro módulo tinha medido na própria Open Food Facts como o ponto em que
 * ela barra. Dois números para a mesma regra divergem, e o que perde é sempre
 * o que ninguém releu.
 */
export const PAUSA_PADRAO = LIMITE_ENTRE_CHAMADAS;

export interface ProdutoSemFoto {
  id: number;
  nome: string;
  codigo_barras: string;
}

export interface Resultado {
  tentados: number;
  gravados: number;
  porMotivo: Record<string, number>;
  porFonte: Record<string, number>;
  bytes: number;
}

export interface Ferramentas {
  achar: typeof acharFotoDeFundoBranco;
  /** Grava o arquivo e devolve a URL pública. */
  gravarArquivo: (buffer: Buffer, extensao: string) => Promise<string>;
  /** Liga a URL ao produto. Devolve `false` se o produto já tinha foto. */
  ligarAoProduto: (produtoId: number, url: string, credito: string) => Promise<boolean>;
  esperar: (ms: number) => Promise<unknown>;
  log: (linha: string) => void;
}

/**
 * Percorre os produtos. Com `valendo: false` não chama `gravarArquivo` nem
 * `ligarAoProduto` — a busca acontece igual, porque é ela que diz o que daria
 * certo, mas nada sai do lugar.
 */
export async function processar(
  produtos: ProdutoSemFoto[],
  opcoes: { valendo: boolean; pausa?: number },
  f: Ferramentas,
): Promise<Resultado> {
  const pausa = opcoes.pausa ?? PAUSA_PADRAO;
  const r: Resultado = { tentados: 0, gravados: 0, porMotivo: {}, porFonte: {}, bytes: 0 };

  for (const p of produtos) {
    r.tentados++;
    /*
     * UM PRODUTO QUE EXPLODE NÃO LEVA O LOTE JUNTO.
     *
     * São 255 produtos e minutos de execução: uma exceção no 200º (disco cheio,
     * rede caindo no meio, imagem que faz o `sharp` lançar) abortava a corrida
     * inteira e levava o relatório com ela — ninguém ficava sabendo o que já
     * tinha sido gravado. Agora o produto vira uma linha de falha e a fila
     * continua.
     */
    let achado;
    try {
      achado = await f.achar(p.codigo_barras);
    } catch (e) {
      r.porMotivo['erro'] = (r.porMotivo['erro'] || 0) + 1;
      f.log(`  !  ${p.nome.slice(0, 40).padEnd(40)} erro: ${(e as Error).message.slice(0, 60)}`);
      await f.esperar(pausa);
      continue;
    }

    if (!achado.ok) {
      r.porMotivo[achado.motivo] = (r.porMotivo[achado.motivo] || 0) + 1;
      f.log(`  -  ${p.nome.slice(0, 40).padEnd(40)} ${achado.motivo}`);
      await f.esperar(pausa);
      continue;
    }

    const { imagem, fonte, credito, fundo, nomeNaBase } = achado.achado;
    r.porFonte[fonte] = (r.porFonte[fonte] || 0) + 1;
    r.bytes += imagem.buffer.length;

    if (!opcoes.valendo) {
      f.log(`  =  ${p.nome.slice(0, 40).padEnd(40)} ${fonte} ${imagem.largura}x${imagem.altura}`
        + ` ${Math.round(imagem.buffer.length / 1024)}KB canto=${Math.round(fundo.piorCanto * 100)}%`
        + (nomeNaBase ? `  [${nomeNaBase.slice(0, 30)}]` : ''));
      await f.esperar(pausa);
      continue;
    }

    let url = '';
    let ligou = false;
    try {
      url = await f.gravarArquivo(imagem.buffer, imagem.extensao);
      ligou = await f.ligarAoProduto(p.id, url, credito);
    } catch (e) {
      r.porMotivo['erro'] = (r.porMotivo['erro'] || 0) + 1;
      f.log(`  !  ${p.nome.slice(0, 40).padEnd(40)} erro ao gravar: ${(e as Error).message.slice(0, 60)}`);
      await f.esperar(pausa);
      continue;
    }
    if (ligou) {
      r.gravados++;
      f.log(`  *  ${p.nome.slice(0, 40).padEnd(40)} ${fonte} ${imagem.largura}x${imagem.altura} -> ${url}`);
    } else {
      /*
       * O LOJISTA GANHOU A CORRIDA, e está certo que ganhe: ele subiu a foto
       * dele enquanto o lote rodava. O arquivo que eu baixei fica órfão no
       * disco, e isso é barato perto de apagar a foto de alguém.
       */
      r.porMotivo['ja-tinha-foto'] = (r.porMotivo['ja-tinha-foto'] || 0) + 1;
      f.log(`  !  ${p.nome.slice(0, 40).padEnd(40)} ja tinha foto, nao mexi`);
    }
    await f.esperar(pausa);
  }

  return r;
}

/** A consulta é parte da regra: só produto À VENDA, SEM foto e COM código. */
export const SQL_SEM_FOTO =
  `SELECT id, nome, codigo_barras
     FROM produtos
    WHERE loja_id = ? AND excluido = 0
      AND (disponivel = 1 OR disponivel_pdv = 1)
      AND (foto_url IS NULL OR foto_url = '')
      AND codigo_barras <> ''
    ORDER BY categoria, nome`;

function argumento(nome: string): string {
  const p = process.argv.find(a => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : '';
}

async function principal(): Promise<void> {
  const tenant = argumento('tenant');
  const lojaId = Number(argumento('loja') || 0);
  const limite = Number(argumento('limite') || 0);
  const pausa = Number(argumento('pausa') || PAUSA_PADRAO);
  const valendo = process.argv.includes('--valendo');

  if (!tenant || !lojaId) {
    console.error('Uso: --tenant=<banco> --loja=<id> [--limite=N] [--pausa=ms] [--valendo]');
    process.exit(2);
  }

  console.log(valendo ? '=== VALENDO ===' : '=== ENSAIO (nada será escrito) ===');
  console.log(`tenant ${tenant}, loja ${lojaId}${limite ? `, no máximo ${limite}` : ''}\n`);

  await comTenant(tenant, async () => {
    const todos = await db.prepare(SQL_SEM_FOTO).all(lojaId) as ProdutoSemFoto[];
    const produtos = limite > 0 ? todos.slice(0, limite) : todos;
    console.log(`${todos.length} produtos à venda sem foto e com código de barras`
      + (limite > 0 ? `, tratando ${produtos.length}\n` : '\n'));

    const destino = path.resolve('./dados/uploads');

    const r = await processar(produtos, { valendo, pausa }, {
      achar: acharFotoDeFundoBranco,
      gravarArquivo: async (buffer, extensao) => {
        const nome = nodeCrypto.randomBytes(16).toString('hex') + extensao;
        await fs.promises.writeFile(path.join(destino, nome), buffer);
        return `/uploads/${nome}`;
      },
      ligarAoProduto: async (produtoId, url, credito) => {
        /* A condição de foto vazia SE REPETE aqui: entre a seleção e agora o
           lojista pode ter subido a dele. */
        const info = await db.prepare(
          `UPDATE produtos SET foto_url = ?, foto_credito = ?
            WHERE id = ? AND (foto_url IS NULL OR foto_url = '')`
        ).run(url, credito, produtoId);
        return Number(info.changes) > 0;
      },
      esperar: (ms) => new Promise(res => setTimeout(res, ms)),
      log: (l) => console.log(l),
    });

    console.log(`\ntentados ......... ${r.tentados}`);
    console.log(`com foto boa ..... ${Object.values(r.porFonte).reduce((s, v) => s + v, 0)}`
      + `  (${Object.entries(r.porFonte).map(([k, v]) => `${k}: ${v}`).join(', ') || 'nenhuma'})`);
    if (valendo) console.log(`gravados ......... ${r.gravados}`);
    console.log(`sem foto ......... ${Object.entries(r.porMotivo).map(([k, v]) => `${k}: ${v}`).join(', ') || 'nenhum'}`);
    console.log(`bytes das fotos .. ${Math.round(r.bytes / 1024)} KB`);
    if (!valendo) console.log('\nnada foi escrito. Para valer, repita com --valendo');
  });
}

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('falhou:', e);
    process.exit(1);
  });
}

export type { Motivo, NomeFonte };
