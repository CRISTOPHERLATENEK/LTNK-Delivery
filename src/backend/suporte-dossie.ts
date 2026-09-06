/**
 * O DOSSIÊ DE UMA LOJA — o estado real, em texto, para diagnóstico.
 *
 * Existe separado da IA de propósito. Metade das dúvidas de suporte se responde
 * só de LER isto ("a loja está com o emissor apontado para o sistema, que não
 * emite"), e essa metade não deveria custar uma chamada de API nem depender de
 * a Anthropic estar no ar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NADA DE SEGREDO ENTRA AQUI.
 *
 * Este texto sai da máquina — vai para a API da Anthropic e aparece na tela de
 * quem atende. Token do Mercado Pago, do Maxx Gestão, senha de certificado e
 * hash de senha nunca entram, nem cifrados. O que entra é se EXISTE, nunca o
 * valor. É a mesma disciplina do `soOsCamposDaTela` da lista de lojas, e pela
 * mesma razão: o que não é mandado não vaza.
 * ─────────────────────────────────────────────────────────────────────────
 */
import db from './db-mysql';
import { quemEmite } from './quem-emite';
import { canalValido, ROTULO_CANAL, funcionalidadesDoCanal } from './canais';

export interface Dossie {
  /** Uma linha por fato, já em português — é o que vai para a tela e para a IA. */
  linhas: string[];
  /** Os pontos que explicam a maioria dos chamados, destacados. */
  alertas: string[];
  loja: { id: number; nome: string };
}

/** `sim`/`não` em vez de `1`/`0`: o texto é lido por gente e por modelo. */
const simNao = (v: unknown) => (Number(v ?? 0) === 1 ? 'sim' : 'não');

export async function montarDossie(lojaId: number): Promise<Dossie | null> {
  const l = await db.prepare(
    `SELECT l.id, l.nome, l.slug, l.categoria, l.aberta, l.auto_horario,
            l.status_aprovacao, l.criado_em,
            l.nfce_emissor, l.nfce_ativo, l.fiscal_liberado, l.vendas_liberado,
            l.canal_versao, l.comissao_percentual, l.dominio_personalizado,
            l.maxxgestao_auto_emitir, l.maxxgestao_modelo, l.maxxgestao_id_caixa,
            l.smarttef_ativo, l.ifood_ativo, l.nfce_cnpj, l.nfce_uf,
            l.nfce_cert_validade,
            /* Só a EXISTÊNCIA das credenciais. O valor nunca sai daqui. */
            (l.maxxgestao_token IS NOT NULL AND l.maxxgestao_token <> '') AS tem_token_erp,
            (l.nfce_csc IS NOT NULL AND l.nfce_csc <> '') AS tem_csc,
            (l.smarttef_senha IS NOT NULL AND l.smarttef_senha <> '') AS tem_senha_tef,
            (l.smarttef_gateway_token IS NOT NULL AND l.smarttef_gateway_token <> '') AS tem_gateway_tef,
            l.smarttef_usuario,
            u.nome AS dono_nome, u.email AS dono_email, u.bloqueado AS dono_bloqueado
       FROM lojas l JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.id = ?`
  ).get(lojaId) as Record<string, unknown> | undefined;
  if (!l) return null;

  const situacao = quemEmite({
    nfce_emissor: l.nfce_emissor as string,
    fiscal_liberado: l.fiscal_liberado as number,
    nfce_ativo: l.nfce_ativo as number,
    tem_token_erp: !!l.tem_token_erp,
    smarttef_configurado: !!l.smarttef_ativo && !!String(l.smarttef_usuario ?? '').trim()
      && !!l.tem_senha_tef && !!l.tem_gateway_tef,
  });

  const canal = canalValido(l.canal_versao);

  /* Últimos 30 dias: é o recorte que responde "está vendendo?". */
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const p = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status = 'entregue') AS entregues,
            SUM(status IN ('cancelado','recusado')) AS cancelados,
            SUM(status IN ('pendente','aceito','preparando','pronto','em_entrega')) AS abertos,
            MAX(criado_em) AS ultimo
       FROM pedidos WHERE loja_id = ? AND criado_em >= ?`
  ).get(lojaId, desde) as Record<string, unknown>;

  /*
   * AS NOTAS QUE FALHARAM são a pergunta mais comum do suporte fiscal, e a
   * resposta está no MOTIVO da SEFAZ — que já está gravado e ninguém lê.
   */
  const rejeicoes = await db.prepare(
    `SELECT status, c_stat, motivo, COUNT(*) AS n
       FROM notas_fiscais
      WHERE loja_id = ? AND status IN ('rejeitada','erro') AND criado_em >= ?
      GROUP BY status, c_stat, motivo ORDER BY n DESC LIMIT 3`
  ).all(lojaId, desde).catch(() => []) as Array<Record<string, unknown>>;

  const linhas: string[] = [];
  const alertas: string[] = [];

  linhas.push(`Loja: ${l.nome} (id ${l.id}, /${l.slug ?? 'sem-slug'}, ${l.categoria})`);
  linhas.push(`Situação do cadastro: ${l.status_aprovacao}`);
  linhas.push(`Aberta agora: ${simNao(l.aberta)}${Number(l.auto_horario) === 1 ? ' (segue o horário cadastrado — o admin não força)' : ' (controle manual do lojista)'}`);
  linhas.push(`Dono: ${l.dono_nome} <${l.dono_email}>${Number(l.dono_bloqueado) === 1 ? ' — ACESSO BLOQUEADO' : ''}`);
  linhas.push(`Domínio próprio: ${l.dominio_personalizado || 'nenhum (usa o subdomínio da plataforma)'}`);
  linhas.push(`Canal de liberação: ${ROTULO_CANAL[canal]}${canal !== 'estavel' ? ` (recebe: ${funcionalidadesDoCanal(canal).join(', ')})` : ''}`);
  linhas.push(`Módulo de vendas (PDV/mesas/caixa): ${simNao(l.vendas_liberado)}`);
  linhas.push(`Módulo fiscal liberado: ${simNao(l.fiscal_liberado)}`);
  linhas.push(`Comissão: ${l.comissao_percentual == null ? 'herda o padrão da plataforma' : `${l.comissao_percentual}% próprio`}`);

  linhas.push(`Quem emite a nota: ${situacao.rotulo} — ${situacao.detalhe}`);
  if (situacao.alerta) alertas.push(`Emissão da nota: ${situacao.detalhe}`);

  if (String(l.nfce_emissor) === 'erp') {
    linhas.push(`Maxx Gestão: token salvo ${simNao(l.tem_token_erp)}, documento sobe como ${l.maxxgestao_modelo || 'PA'}, caixa ${Number(l.maxxgestao_id_caixa) > 0 ? l.maxxgestao_id_caixa : 'nenhum'}, emissão automática ${simNao(l.maxxgestao_auto_emitir)}`);
    if (Number(l.maxxgestao_auto_emitir) !== 1) {
      linhas.push('Consequência: o pedido vira documento no ERP e alguém precisa faturar lá — nenhuma nota sai sozinha.');
    }
  }

  if (Number(l.fiscal_liberado) === 1) {
    linhas.push(`Cadastro fiscal: CNPJ ${l.nfce_cnpj || 'não preenchido'}, UF ${l.nfce_uf || '—'}, CSC ${simNao(l.tem_csc)}, certificado vence em ${l.nfce_cert_validade || 'sem certificado'}`);
    /* Certificado vencido para a emissão no mesmo dia — vale como alerta antes
       de virar chamado. */
    const val = String(l.nfce_cert_validade || '');
    if (val && Date.parse(val) < Date.now()) alertas.push(`Certificado A1 VENCIDO em ${val} — a emissão para no mesmo dia.`);
  }

  linhas.push(`Integrações: maquininha ${simNao(l.smarttef_ativo)}, iFood ${simNao(l.ifood_ativo)}`);

  linhas.push(`Pedidos nos últimos 30 dias: ${Number(p?.total ?? 0)} no total — ${Number(p?.entregues ?? 0)} entregues, ${Number(p?.abertos ?? 0)} em andamento, ${Number(p?.cancelados ?? 0)} cancelados`);
  linhas.push(`Último pedido: ${p?.ultimo ? String(p.ultimo) : 'nenhum nos últimos 30 dias'}`);

  if (rejeicoes.length) {
    for (const r of rejeicoes) {
      linhas.push(`NFC-e ${r.status}: ${r.n}x — ${r.c_stat ?? ''} ${r.motivo ?? ''}`.trim());
    }
    alertas.push(`Há notas rejeitadas nos últimos 30 dias: ${String(rejeicoes[0].motivo ?? '').slice(0, 160)}`);
  }

  /*
   * VENDENDO SEM NOTA é o alerta que justifica o dossiê existir: nada na
   * plataforma grita isso hoje, e é o que o contador do cliente descobre
   * meses depois.
   */
  if (Number(p?.entregues ?? 0) > 0 && situacao.alerta) {
    alertas.push(`${Number(p?.entregues)} pedidos entregues nos últimos 30 dias com a emissão não resolvida.`);
  }

  return { linhas, alertas, loja: { id: Number(l.id), nome: String(l.nome) } };
}

/** O dossiê em texto, para o log, para a tela e para o prompt. */
export function dossieEmTexto(d: Dossie): string {
  const alertas = d.alertas.length
    ? `\n\nPONTOS DE ATENÇÃO:\n${d.alertas.map(a => `- ${a}`).join('\n')}`
    : '\n\nPONTOS DE ATENÇÃO: nenhum.';
  return `ESTADO ATUAL DA LOJA\n${d.linhas.map(x => `- ${x}`).join('\n')}${alertas}`;
}
