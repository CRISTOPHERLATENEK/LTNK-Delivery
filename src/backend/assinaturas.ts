/**
 * ASSINATURAS — a plataforma cobrando o LOJISTA (não a loja cobrando o cliente).
 *
 * POR QUE EXISTE: o sistema já era multi-tenant, com banco e domínio por cliente,
 * mas não havia nenhum registro de quanto cada um paga, quando vence ou se pagou.
 * Isso significava cobrar por fora e controlar de cabeça — funciona com 2
 * clientes e vira caos com 15, porque a decisão de "corto ou não" passa a ser
 * tomada 15 vezes por mês, de memória.
 *
 * MORA NO BANCO CENTRAL, junto de `tenants`. Não pode ficar no banco do tenant:
 * cliente inadimplente teria os dados da própria cobrança no banco dele, e
 * suspender o acesso apagaria a visão do que ele deve.
 *
 * MODELO: mensalidade por tenant, sem comissão por pedido. É o que o produto já
 * assumia (o padrão de `comissao_percentual` é 0 e a landing promete 0%), e é o
 * único coerente com white-label — quem paga pra ter o próprio app não aceita
 * comissão em cima do faturamento dele.
 */
import type { Pool } from 'mysql2/promise';
import { agoraUTC } from './util';

export type StatusAssinatura = 'teste' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

export interface Assinatura {
  id: number;
  tenant_id: number;
  plano: string;
  valor_centavos: number;
  /** Dia do mês do vencimento (1–28). Ver `proximoVencimento` sobre o limite 28. */
  dia_vencimento: number;
  /** Dias após o vencimento antes de suspender. 0 = corta no dia seguinte. */
  dias_tolerancia: number;
  status: StatusAssinatura;
  /** Data (YYYY-MM-DD) do vencimento em aberto. */
  vence_em: string;
  /** Último pagamento registrado (ISO) ou ''. */
  pago_em: string;
  observacoes: string;
  criado_em: string;
  atualizado_em: string;
}

export interface PagamentoAssinatura {
  id: number;
  assinatura_id: number;
  valor_centavos: number;
  /** 'pix' | 'manual' — 'manual' cobre transferência, dinheiro, cartão por fora. */
  forma: string;
  referencia: string;
  competencia: string;
  criado_em: string;
}

/** Cria as tabelas no banco central. Idempotente, chamada no boot. */
export async function inicializarAssinaturas(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assinaturas (
      id              INT PRIMARY KEY AUTO_INCREMENT,
      tenant_id       INT NOT NULL,
      plano           VARCHAR(60) NOT NULL DEFAULT 'mensal',
      valor_centavos  INT NOT NULL DEFAULT 0,
      dia_vencimento  INT NOT NULL DEFAULT 5,
      dias_tolerancia INT NOT NULL DEFAULT 5,
      status          VARCHAR(20) NOT NULL DEFAULT 'teste',
      vence_em        VARCHAR(10) NOT NULL DEFAULT '',
      pago_em         VARCHAR(32) NOT NULL DEFAULT '',
      observacoes     TEXT,
      criado_em       VARCHAR(32) NOT NULL,
      atualizado_em   VARCHAR(32) NOT NULL,
      -- Uma assinatura por tenant: histórico de pagamento vai na outra tabela.
      -- Sem isso, duas linhas pro mesmo cliente dariam duas respostas pra
      -- "ele está em dia?", e o job de suspensão obedeceria a que achasse primeiro.
      UNIQUE KEY idx_assinaturas_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assinatura_pagamentos (
      id             INT PRIMARY KEY AUTO_INCREMENT,
      assinatura_id  INT NOT NULL,
      valor_centavos INT NOT NULL,
      forma          VARCHAR(20) NOT NULL DEFAULT 'manual',
      referencia     VARCHAR(120) NOT NULL DEFAULT '',
      -- Competência (YYYY-MM) do mês que este pagamento cobre. Guardada porque
      -- pagamento atrasado entra numa data e paga OUTRO mês -- sem isso, não dá
      -- pra responder "ele pagou março?" sem inferir por data, que erra.
      competencia    VARCHAR(7) NOT NULL DEFAULT '',
      criado_em      VARCHAR(32) NOT NULL,
      KEY idx_pag_assinatura (assinatura_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Hoje em YYYY-MM-DD (UTC), o mesmo formato de `vence_em`. */
export function hojeISO(): string {
  return agoraUTC().slice(0, 10);
}

/**
 * Próximo vencimento a partir de uma data-base.
 *
 * DIA LIMITADO A 28 de propósito: com vencimento em 31, fevereiro não tem o dia e
 * a data "escorregaria" pra março, atrasando a cobrança de um mês inteiro sem
 * ninguém notar. 28 vence em todo mês do calendário.
 */
export function proximoVencimento(base: string, diaVencimento: number): string {
  const dia = Math.min(28, Math.max(1, Math.trunc(diaVencimento) || 1));
  const [ano, mes] = base.split('-').map(Number);
  const diaBase = Number(base.slice(8, 10));
  // Se o dia do vencimento ainda não passou neste mês, vence neste mês.
  const avancaMes = diaBase >= dia;
  const d = new Date(Date.UTC(ano, mes - 1 + (avancaMes ? 1 : 0), dia));
  return d.toISOString().slice(0, 10);
}

/** Dias de atraso (0 se em dia ou adiantado). */
export function diasDeAtraso(venceEm: string, hoje = hojeISO()): number {
  if (!venceEm) return 0;
  const ms = Date.parse(hoje + 'T00:00:00Z') - Date.parse(venceEm + 'T00:00:00Z');
  return ms <= 0 ? 0 : Math.floor(ms / 86400000);
}

/**
 * Status que a assinatura DEVERIA ter hoje, dado vencimento e tolerância.
 * Função pura: é o coração da regra e o que os testes travam.
 *
 * `cancelada` e `teste` não são recalculados — são decisões humanas, não
 * consequência de data. Cancelar é ato do operador; período de teste termina
 * quando ele define o primeiro vencimento.
 */
export function statusCalculado(a: Pick<Assinatura, 'status' | 'vence_em' | 'dias_tolerancia'>, hoje = hojeISO()): StatusAssinatura {
  if (a.status === 'cancelada' || a.status === 'teste') return a.status;
  const atraso = diasDeAtraso(a.vence_em, hoje);
  if (atraso === 0) return 'ativa';
  if (atraso <= a.dias_tolerancia) return 'inadimplente';
  return 'suspensa';
}

/** Deve cortar o acesso? Só `suspensa` e `cancelada` derrubam o tenant. */
export function deveSuspenderAcesso(status: StatusAssinatura): boolean {
  return status === 'suspensa' || status === 'cancelada';
}

/* ─────────────────── Operações (banco central) ─────────────────── */

type LinhaAssinatura = Assinatura & { tenant_nome?: string; tenant_slug?: string; tenant_ativo?: 0 | 1; suspenso_por?: string };

/** Assinaturas + dados do tenant, pra tela do admin. */
export async function listarAssinaturas(pool: Pool): Promise<LinhaAssinatura[]> {
  const [linhas] = await pool.query(
    `SELECT a.*, t.nome AS tenant_nome, t.slug AS tenant_slug, t.ativo AS tenant_ativo
       FROM assinaturas a JOIN tenants t ON t.id = a.tenant_id
      ORDER BY a.status = 'suspensa' DESC, a.vence_em ASC`,
  );
  return linhas as LinhaAssinatura[];
}

/**
 * Cria ou atualiza a assinatura de um tenant.
 *
 * `vence_em` só é calculado quando ainda não existe: recalcular a cada
 * salvamento empurraria o vencimento pra frente sempre que o operador mexesse no
 * valor ou na observação — o cliente nunca ficaria em atraso.
 */
export async function salvarAssinatura(pool: Pool, dados: {
  tenantId: number;
  plano: string;
  valorCentavos: number;
  diaVencimento: number;
  diasTolerancia: number;
  status: StatusAssinatura;
  observacoes: string;
}): Promise<void> {
  const agora = agoraUTC();
  const [existentes] = await pool.query(
    'SELECT id, vence_em FROM assinaturas WHERE tenant_id = ?', [dados.tenantId],
  ) as [Array<{ id: number; vence_em: string }>, unknown];
  const atual = existentes[0];

  const venceEm = atual?.vence_em || (
    dados.status === 'teste' ? '' : proximoVencimento(hojeISO(), dados.diaVencimento)
  );

  if (atual) {
    await pool.query(
      `UPDATE assinaturas SET plano = ?, valor_centavos = ?, dia_vencimento = ?,
              dias_tolerancia = ?, status = ?, vence_em = ?, observacoes = ?, atualizado_em = ?
        WHERE id = ?`,
      [dados.plano, dados.valorCentavos, dados.diaVencimento, dados.diasTolerancia,
       dados.status, venceEm, dados.observacoes, agora, atual.id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO assinaturas (tenant_id, plano, valor_centavos, dia_vencimento,
       dias_tolerancia, status, vence_em, observacoes, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [dados.tenantId, dados.plano, dados.valorCentavos, dados.diaVencimento,
     dados.diasTolerancia, dados.status, venceEm, dados.observacoes, agora, agora],
  );
}

/**
 * Registra pagamento e AVANÇA o vencimento.
 *
 * Avançar a partir do `vence_em` antigo (não de hoje) é o que mantém a
 * competência honesta: quem paga março com 10 dias de atraso quita MARÇO, e o
 * próximo vencimento continua sendo abril. Calculando de hoje, o atraso viraria
 * desconto — o cliente ganharia dias grátis por pagar tarde.
 */
export async function registrarPagamento(pool: Pool, dados: {
  assinaturaId: number;
  valorCentavos: number;
  forma: string;
  referencia: string;
}): Promise<void> {
  const agora = agoraUTC();
  const [linhas] = await pool.query(
    'SELECT id, tenant_id, vence_em, dia_vencimento FROM assinaturas WHERE id = ?',
    [dados.assinaturaId],
  ) as [Array<{ id: number; tenant_id: number; vence_em: string; dia_vencimento: number }>, unknown];
  const a = linhas[0];
  if (!a) throw new Error('Assinatura não encontrada.');

  const competencia = (a.vence_em || hojeISO()).slice(0, 7);
  await pool.query(
    `INSERT INTO assinatura_pagamentos (assinatura_id, valor_centavos, forma, referencia, competencia, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [a.id, dados.valorCentavos, dados.forma, dados.referencia, competencia, agora],
  );

  const proximo = proximoVencimento(a.vence_em || hojeISO(), a.dia_vencimento);
  await pool.query(
    "UPDATE assinaturas SET vence_em = ?, pago_em = ?, status = 'ativa', atualizado_em = ? WHERE id = ?",
    [proximo, agora, agora, a.id],
  );
  /*
   * Pagou: o acesso volta na hora, sem esperar o job da madrugada. Um lojista
   * esperando o dia virar pra voltar a vender é suporte na certa.
   *
   * Mas só religa o que foi desligado POR FALTA DE PAGAMENTO. Cliente suspenso
   * pelo revendedor ou pelo admin continua suspenso mesmo pagando — pagar a
   * plataforma não desfaz uma suspensão que nunca foi sobre dinheiro.
   *
   * O `''` entra na lista porque é o que têm as linhas desligadas antes da
   * coluna `suspenso_por` existir: sem ele, um cliente antigo pagaria e
   * continuaria fora do ar sem ninguém entender por quê. Aqui vale porque é ato
   * humano e deliberado do operador; o job da madrugada é mais restrito.
   */
  await pool.query(
    "UPDATE tenants SET ativo = 1, suspenso_por = '' WHERE id = ? AND suspenso_por IN ('assinatura', '')",
    [a.tenant_id],
  );
}

export async function historicoPagamentos(pool: Pool, assinaturaId: number): Promise<PagamentoAssinatura[]> {
  const [linhas] = await pool.query(
    'SELECT * FROM assinatura_pagamentos WHERE assinatura_id = ? ORDER BY id DESC LIMIT 24',
    [assinaturaId],
  );
  return linhas as PagamentoAssinatura[];
}

/**
 * JOB DIÁRIO: recalcula status e liga/desliga o acesso do tenant.
 *
 * Idempotente — rodar duas vezes no mesmo dia não muda nada além do que já está.
 * Só escreve quando o valor MUDA, pra não sujar `atualizado_em` de todo mundo
 * todo dia e deixar de ser útil pra depurar.
 *
 * NUNCA reativa tenant suspenso por outro motivo — e isso agora é verdade.
 * Antes o comentário afirmava isso mas o código não fazia: bastava o estado
 * desejado diferir pra religar, então o revendedor suspendia um cliente em dia
 * com a plataforma e este job desfazia na madrugada seguinte, em silêncio.
 *
 * O que decide é `tenants.suspenso_por`: este job só religa o que ele mesmo
 * desligou ('assinatura'). Linha antiga com o carimbo vazio fica onde está —
 * job automático não deve religar ninguém por dedução, e admin e revendedor
 * continuam podendo religar na mão.
 */
export async function processarVencimentos(pool: Pool): Promise<{ verificadas: number; suspensos: number; reativados: number }> {
  const hoje = hojeISO();
  const [linhas] = await pool.query(
    `SELECT a.*, t.ativo AS tenant_ativo, t.suspenso_por
       FROM assinaturas a JOIN tenants t ON t.id = a.tenant_id`,
  ) as [LinhaAssinatura[], unknown];

  let suspensos = 0, reativados = 0;
  for (const a of linhas) {
    const novo = statusCalculado(a, hoje);
    if (novo !== a.status) {
      await pool.query('UPDATE assinaturas SET status = ?, atualizado_em = ? WHERE id = ?',
        [novo, agoraUTC(), a.id]);
    }
    const deveCortar = deveSuspenderAcesso(novo);
    if (deveCortar && a.tenant_ativo === 1) {
      await pool.query(
        "UPDATE tenants SET ativo = 0, suspenso_por = 'assinatura' WHERE id = ?", [a.tenant_id]);
      suspensos++;
      console.warn(`[ASSINATURA] tenant ${a.tenant_id} SUSPENSO — ${diasDeAtraso(a.vence_em, hoje)} dia(s) de atraso (vencia ${a.vence_em}).`);
      continue;
    }
    if (!deveCortar && a.tenant_ativo === 0) {
      // O `AND suspenso_por = 'assinatura'` é o conserto: sem ele, este UPDATE
      // religava quem o revendedor ou o admin tinha desligado.
      const [r] = await pool.query(
        "UPDATE tenants SET ativo = 1, suspenso_por = '' WHERE id = ? AND suspenso_por = 'assinatura'",
        [a.tenant_id],
      ) as unknown as [{ affectedRows: number }];
      if (r.affectedRows > 0) {
        reativados++;
        console.log(`[ASSINATURA] tenant ${a.tenant_id} reativado.`);
      } else {
        console.log(`[ASSINATURA] tenant ${a.tenant_id} está em dia, mas segue desligado por "${a.suspenso_por || 'motivo não registrado'}" — não é este job que religa.`);
      }
    }
  }
  return { verificadas: linhas.length, suspensos, reativados };
}
