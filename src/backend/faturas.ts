/**
 * Fechamento da fatura do revendedor.
 *
 * O HISTÓRICO PRECISA SER RETRATO, não consulta. Se a fatura de março fosse
 * recalculada hoje, um módulo ligado ontem mudaria o valor de março e o
 * revendedor veria um total diferente do que pagou — e não teria como provar
 * qual dos dois era o certo.
 *
 * Como o retrato é tirado: a competência CORRENTE é regravada o tempo todo (a
 * cada leitura do painel e de hora em hora pelo job). Quando o mês vira, a
 * linha daquele mês já está gravada com o estado de dentro do próprio mês, e
 * ninguém mais encosta nela. É por isso que o fechamento nunca reconstrói mês
 * passado a partir do estado de hoje: isso seria inventar número.
 */
import { poolCentral } from './tenants-mysql';
import { agoraUTC } from './util';
import { competenciaDe, faturaDetalhada, type FaturaDetalhada } from './fatura-revendedor';

/** Estado atual da conta de um revendedor, quebrado por cliente. */
export async function faturaAtual(revendedorId: number, custoCentavos: number): Promise<FaturaDetalhada> {
  const pool = poolCentral();
  const [tenants] = await pool.query(
    'SELECT id, nome, ativo FROM tenants WHERE revendedor_id = ? ORDER BY nome',
    [revendedorId],
  ) as unknown as [Array<{ id: number; nome: string; ativo: number }>];

  /*
   * Modulos numa consulta separada e agrupados aqui, em vez de GROUP_CONCAT.
   * Concatenar nome e preco numa string exige um separador que o nome do modulo
   * nunca contenha - e o nome e digitado por gente. Um "PDV; NFC-e" quebraria a
   * conta em silencio.
   */
  const porTenant = new Map<number, Array<{ nome: string; preco_centavos: number }>>();
  const [mods] = await pool.query(
    `SELECT mc.tenant_id, COALESCE(m.nome, 'Modulo removido') AS nome, mc.preco_centavos
       FROM modulos_cliente mc
       JOIN tenants t ON t.id = mc.tenant_id
       LEFT JOIN modulos m ON m.id = mc.modulo_id
      WHERE t.revendedor_id = ?
      ORDER BY nome`,
    [revendedorId],
  ) as unknown as [Array<{ tenant_id: number; nome: string; preco_centavos: number }>];
  for (const m of mods) {
    const lista = porTenant.get(Number(m.tenant_id)) ?? [];
    lista.push({ nome: String(m.nome), preco_centavos: Number(m.preco_centavos) || 0 });
    porTenant.set(Number(m.tenant_id), lista);
  }

  return faturaDetalhada(custoCentavos, tenants.map(t => ({
    id: Number(t.id),
    nome: String(t.nome),
    ativo: !!t.ativo,
    modulos: porTenant.get(Number(t.id)) ?? [],
  })));
}

/**
 * Regrava o retrato da competência CORRENTE.
 *
 * Só a corrente: passar `competencia` de mês fechado é justamente o que não
 * pode acontecer, então nem existe o parâmetro.
 */
export async function gravarFaturaDoMes(revendedorId: number, custoCentavos: number): Promise<FaturaDetalhada> {
  const f = await faturaAtual(revendedorId, custoCentavos);
  const competencia = competenciaDe(agoraUTC());
  await poolCentral().query(
    `INSERT INTO faturas_revendedor
       (revendedor_id, competencia, clientes_ativos, mensalidades_centavos, modulos_centavos, total_centavos, detalhe, fechada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       clientes_ativos = VALUES(clientes_ativos),
       mensalidades_centavos = VALUES(mensalidades_centavos),
       modulos_centavos = VALUES(modulos_centavos),
       total_centavos = VALUES(total_centavos),
       detalhe = VALUES(detalhe),
       fechada_em = VALUES(fechada_em)`,
    [
      revendedorId, competencia, f.clientes_ativos, f.mensalidades_centavos,
      f.modulos_centavos, f.total_centavos, JSON.stringify(f.linhas), agoraUTC(),
    ],
  );
  return f;
}

/**
 * Passa em todos os revendedores ativos. Roda de hora em hora pra que, na
 * virada do mês, o último retrato gravado seja de no máximo uma hora antes do
 * fim do mês — e não de quando o revendedor resolveu abrir o painel.
 */
export async function gravarFaturasDeTodos(): Promise<void> {
  const [rs] = await poolCentral().query(
    'SELECT id, custo_centavos FROM revendedores WHERE ativo = 1',
  ) as unknown as [Array<{ id: number; custo_centavos: number }>];
  for (const r of rs) {
    // Um revendedor com banco problemático não pode impedir o retrato dos
    // outros — cada um é uma cobrança separada.
    try {
      await gravarFaturaDoMes(Number(r.id), Number(r.custo_centavos) || 0);
    } catch (e) {
      console.error('[fatura] falha ao gravar do revendedor', r.id, e);
    }
  }
}
