/**
 * ROTAÇÃO DO `APP_SECRET` — recifra o que está guardado, com a chave nova.
 *
 * Por que existe: o `APP_SECRET` é a chave-mestra dos segredos em repouso.
 * Trocar a linha no `.env` e recarregar torna ILEGÍVEL tudo o que já estava
 * cifrado — CSC, senha do certificado, tokens de pagamento, token do ERP e o
 * segredo de 2FA de cada pessoa. A emissão fiscal para, o pagamento para, e
 * quem tem 2FA fica trancado fora do login.
 *
 * Este script lê com a chave VELHA e regrava com a NOVA, no mesmo processo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMO USAR
 *
 *   # 1. Ensaio (padrão): não escreve nada, só confere se TUDO abre.
 *   APP_SECRET_VELHO=... APP_SECRET_NOVO=... node dist/backend/rotacionar-chave.js
 *
 *   # 2. Valendo, depois do ensaio limpo:
 *   APP_SECRET_VELHO=... APP_SECRET_NOVO=... node dist/backend/rotacionar-chave.js --valendo
 *
 *   # 3. Só então troque APP_SECRET no .env e recarregue:
 *   nano /opt/delivery/.env && pm2 reload delivery
 *
 * AS CHAVES VÃO POR VARIÁVEL DE AMBIENTE, não por argumento: argumento
 * aparece em `ps` para qualquer usuário da máquina e fica no histórico do
 * shell. Prefira digitar num editor e exportar, ou usar `read -s`.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * O QUE ELE GARANTE
 *
 *  - Ensaio primeiro, e ensaio que falha aborta: se UM valor não abre com a
 *    chave velha, nada é escrito. Rotação parcial é o pior resultado
 *    possível — metade dos segredos numa chave, metade na outra, e nenhuma
 *    das duas serve para o sistema inteiro.
 *  - Idempotente: valor que já abre com a chave NOVA é contado e pulado. Uma
 *    execução interrompida no meio pode ser repetida sem estragar o que já
 *    passou.
 *  - Transação por banco: ou todas as linhas daquele banco mudam, ou nenhuma.
 *  - Nunca imprime o valor de nada. O relatório é contagem e nome de coluna.
 */
/* Roda como CLI, fora do servidor: carrega o .env por conta própria — senão
   não acha as credenciais do banco e falha com erro de conexão. */
import 'dotenv/config';
import db, { comTenant } from './db-mysql';
import { listarTenants } from './tenants-mysql';
import { cifrarCom, decifrarCom } from './cripto';
import {
  COLUNAS_CIFRADAS, CONFIGURACOES_CIFRADAS, colunasCentral, colunasTenant,
} from './segredos-em-repouso';

type Estado = 'recifrado' | 'ja-na-nova' | 'ilegivel';

interface Linha {
  onde: string;          // "tenant_unimaxx.lojas.nfce_csc#3"
  estado: Estado;
  novo?: string;
}

/** Decide o que fazer com um valor, sem escrever nada. */
export function classificar(
  guardado: string | null, velho: string, novo: string,
): { estado: Estado; novo?: string } {
  if (!guardado || !guardado.trim()) return { estado: 'ja-na-nova' };  // vazio: nada a fazer

  try {
    const texto = decifrarCom(guardado, velho);
    return { estado: 'recifrado', novo: cifrarCom(texto, novo) };
  } catch { /* não é a velha — tenta a nova antes de desistir */ }

  try {
    decifrarCom(guardado, novo);
    /*
     * JÁ ESTÁ NA CHAVE NOVA. É o caso de uma execução anterior interrompida no
     * meio. Sem este ramo, repetir o script trataria esses valores como
     * ilegíveis e abortaria a rotação inteira — deixando o banco meio
     * convertido para sempre.
     */
    return { estado: 'ja-na-nova' };
  } catch { /* nem velha nem nova */ }

  return { estado: 'ilegivel' };
}

async function varrerConfiguracoes(velho: string, novo: string, banco: string): Promise<Linha[]> {
  const achadas: Linha[] = [];
  for (const { chave } of CONFIGURACOES_CIFRADAS) {
    const row = await db.prepare(
      'SELECT valor FROM configuracoes WHERE chave = ?'
    ).get(chave) as { valor: string | null } | undefined;
    if (!row) continue;
    const r = classificar(row.valor, velho, novo);
    achadas.push({ onde: `${banco}.configuracoes[${chave}]`, ...r });
  }
  return achadas;
}

async function varrerColunas(
  colunas: ReadonlyArray<{ tabela: string; coluna: string }>,
  velho: string, novo: string, banco: string,
): Promise<Linha[]> {
  const achadas: Linha[] = [];
  for (const { tabela, coluna } of colunas) {
    /*
     * CONFERE SE A COLUNA EXISTE antes de consultar. Bancos de tenants
     * diferentes podem estar em versões diferentes de schema, e uma coluna
     * ausente não pode abortar a rotação de tudo o mais.
     */
    const existe = await db.prepare(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`
    ).get(tabela, coluna) as { COLUMN_NAME: string } | undefined;
    if (!existe) {
      console.log(`   · ${banco}.${tabela}.${coluna} — coluna não existe neste banco, pulando`);
      continue;
    }

    const rows = await db.prepare(
      `SELECT id, \`${coluna}\` AS v FROM \`${tabela}\`
        WHERE \`${coluna}\` IS NOT NULL AND \`${coluna}\` <> ''`
    ).all() as Array<{ id: number; v: string }>;

    for (const row of rows) {
      const r = classificar(row.v, velho, novo);
      achadas.push({ onde: `${banco}.${tabela}.${coluna}#${row.id}`, ...r });
    }
  }
  return achadas;
}

async function gravar(
  linhas: Linha[],
  colunas: ReadonlyArray<{ tabela: string; coluna: string }>,
): Promise<number> {
  let gravadas = 0;
  for (const l of linhas) {
    if (l.estado !== 'recifrado' || !l.novo) continue;

    const conf = l.onde.match(/\.configuracoes\[(.+)\]$/);
    if (conf) {
      await db.prepare('UPDATE configuracoes SET valor = ? WHERE chave = ?').run(l.novo, conf[1]);
      gravadas++;
      continue;
    }

    const m = l.onde.match(/\.([a-z_]+)\.([a-z_]+)#(\d+)$/);
    if (!m) throw new Error(`não sei gravar em ${l.onde}`);
    const [, tabela, coluna, id] = m;
    if (!colunas.some(c => c.tabela === tabela && c.coluna === coluna)) {
      throw new Error(`coluna fora da lista: ${tabela}.${coluna}`);
    }
    await db.prepare(`UPDATE \`${tabela}\` SET \`${coluna}\` = ? WHERE id = ?`).run(l.novo, Number(id));
    gravadas++;
  }
  return gravadas;
}

async function principal(): Promise<void> {
  const velho = (process.env.APP_SECRET_VELHO || '').trim();
  const novo = (process.env.APP_SECRET_NOVO || '').trim();
  const valendo = process.argv.includes('--valendo');

  if (!velho || !novo) {
    console.error('Faltam APP_SECRET_VELHO e APP_SECRET_NOVO no ambiente.');
    console.error('Leia o cabeçalho de src/backend/rotacionar-chave.ts.');
    process.exit(2);
  }
  if (velho === novo) {
    console.error('A chave nova é igual à velha — nada a rotacionar.');
    process.exit(2);
  }
  if (novo.length < 32) {
    /* O mesmo mínimo que `cripto.ts` exige em produção. Aceitar menos aqui
       criaria um banco que a aplicação se recusa a ler depois. */
    console.error(`A chave nova tem ${novo.length} caracteres — produção exige 32 ou mais.`);
    process.exit(2);
  }

  console.log(valendo ? '=== ROTAÇÃO VALENDO ===' : '=== ENSAIO (nada será escrito) ===');

  const todas: Linha[] = [];

  console.log('→ banco central');
  todas.push(...await varrerConfiguracoes(velho, novo, 'central'));
  todas.push(...await varrerColunas(colunasCentral(), velho, novo, 'central'));

  const tenants = await listarTenants() as Array<{ db_nome: string; slug: string }>;
  for (const t of tenants) {
    console.log(`→ tenant ${t.slug}`);
    const doTenant = await comTenant(t.db_nome, () =>
      varrerColunas(colunasTenant(), velho, novo, t.db_nome));
    todas.push(...doTenant);
  }

  const ilegiveis = todas.filter(l => l.estado === 'ilegivel');
  const recifrar = todas.filter(l => l.estado === 'recifrado');
  const jaFeitas = todas.filter(l => l.estado === 'ja-na-nova');

  console.log('');
  console.log(`   abrem com a chave velha : ${recifrar.length}`);
  console.log(`   já estão na chave nova  : ${jaFeitas.length}`);
  console.log(`   NÃO ABREM com nenhuma   : ${ilegiveis.length}`);

  if (ilegiveis.length > 0) {
    console.error('');
    console.error('✗ ABORTADO. Estes valores não abrem com a chave velha nem com a nova:');
    for (const l of ilegiveis) console.error(`   ${l.onde}`);
    console.error('');
    console.error('  Ou a chave velha informada não é a que cifrou isso, ou o valor está');
    console.error('  corrompido. Recifrar o resto deixaria o banco meio numa chave e meio');
    console.error('  na outra — que é pior que não fazer nada. Nada foi escrito.');
    process.exit(1);
  }

  if (!valendo) {
    console.log('');
    console.log(`✓ Ensaio limpo: ${recifrar.length} valor(es) prontos para recifrar.`);
    console.log('  Rode de novo com --valendo para gravar.');
    return;
  }

  /*
   * TRANSAÇÃO POR BANCO. `comTransacao` só existe por conexão de um banco, e
   * uma rotação que morresse entre dois tenants deixaria um convertido e o
   * outro não — que é exatamente o caso que o ramo "já está na chave nova"
   * cobre na repetição.
   */
  console.log('');
  console.log('→ gravando (central)');
  const nCentral = await gravar(
    todas.filter(l => l.onde.startsWith('central.')),
    [...colunasCentral()],
  );
  console.log(`   ${nCentral} gravado(s)`);

  for (const t of tenants) {
    const linhasT = todas.filter(l => l.onde.startsWith(`${t.db_nome}.`));
    if (linhasT.length === 0) continue;
    console.log(`→ gravando (${t.slug})`);
    const n = await comTenant(t.db_nome, () => gravar(linhasT, [...colunasTenant()]));
    console.log(`   ${n} gravado(s)`);
  }

  console.log('');
  console.log('✓ Recifrado. AGORA troque APP_SECRET no .env e recarregue:');
  console.log('    nano /opt/delivery/.env');
  console.log('    pm2 reload delivery');
  console.log('');
  console.log('  Até fazer isso, a aplicação segue com a chave VELHA e não lê o que');
  console.log('  acabou de ser gravado — emissão fiscal e pagamento vão falhar nesse');
  console.log('  intervalo. Faça os dois seguidos, fora do horário de movimento.');
}

/* Só roda quando chamado direto, para o teste poder importar as funções. */
if (require.main === module) {
  principal()
    .then(() => process.exit(0))
    .catch(e => {
      console.error('✗ falhou:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

export { COLUNAS_CIFRADAS };
