/**
 * RETENÇÃO DO LOG DE AUDITORIA — apaga o que passou de seis meses.
 *
 * A tabela crescia para sempre, e desde que o IP entrou nela ela guarda DADO
 * PESSOAL. Guardar para sempre não é cautela: é aumentar, todo dia, o tamanho
 * do estrago de um vazamento — e sob a LGPD, dado pessoal sem prazo é dado sem
 * finalidade declarada.
 *
 * Seis meses é o que o dono da plataforma escolheu. Meia janela de fiscalização
 * para "quem suspendeu esta loja" e "de onde partiu essa ação", que é o uso
 * real deste log.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ISTO APAGA REGISTRO DE AUDITORIA. É irreversível.
 *
 * Duas travas por isso: o corte é sempre por DATA (nunca por quantidade, que
 * apagaria o registro de ontem numa tabela movimentada), e o `LIMIT` por rodada
 * existe para não travar a tabela — não para limitar quanto se apaga.
 * ─────────────────────────────────────────────────────────────────────────
 */
import db from './db-mysql';

/** Meses de retenção. No `.env` para não exigir deploy se a política mudar. */
const MESES = Math.max(1, Number(process.env.AUDITORIA_RETENCAO_MESES) || 6);

/**
 * Quantos apagar por vez.
 *
 * `DELETE` sem teto numa tabela com anos de histórico segura a transação por
 * segundos e trava quem estiver gravando auditoria naquele instante — ou seja,
 * trava a ação administrativa que gerou o registro. Em lotes, cada transação
 * dura milissegundos.
 */
const LOTE = 500;

/** Apaga o que passou do prazo no tenant ATUAL. Devolve quantos saíram. */
export async function limparAuditoriaDoTenant(agora = Date.now()): Promise<number> {
  const corte = new Date(agora - MESES * 30 * 86_400_000).toISOString();
  let total = 0;
  /*
   * O laço tem teto: 200 lotes = 100 mil registros por rodada. Sem ele, uma
   * data errada no banco (`criado_em` vazio, por exemplo) poderia fazer o laço
   * girar indefinidamente segurando o processo — e o job roda na instância que
   * também atende HTTP.
   */
  for (let i = 0; i < 200; i++) {
    const r = await db.prepare(
      'DELETE FROM admin_auditoria WHERE criado_em <> \'\' AND criado_em < ? LIMIT ?'
    ).run(corte, LOTE);
    const n = Number((r as { changes?: number }).changes ?? 0);
    total += n;
    if (n < LOTE) break;
  }
  return total;
}
