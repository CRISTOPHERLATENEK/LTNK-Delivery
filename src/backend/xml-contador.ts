/**
 * O pacote de XMLs que vai pro contador — montagem e envio.
 *
 * Vive fora das rotas porque tem DOIS chamadores: o botão "baixar" na tela do
 * lojista e o job mensal que manda por e-mail. Duplicar isso daria duas versões
 * do mesmo pacote, e a diferença só apareceria na escrituração de alguém.
 *
 * Roda sempre dentro do banco do tenant (via `comTenant` no job, ou no contexto
 * da requisição), porque `notas_fiscais` é por cliente.
 */
import JSZip from 'jszip';
import db from './db-mysql';
import { enviarEmail } from './email';
import { destinatariosDe } from './envio-contador';
import { agoraUTC } from './util';

/**
 * SÓ PRODUÇÃO (ambiente = 1). Nota de homologação não tem valor fiscal nenhum;
 * mandar isso pro contador seria entregar lixo misturado com escrituração.
 */
const FILTRO = "loja_id = ? AND ambiente = 1 AND status IN ('autorizada', 'cancelada')";
/** A data que vale é a da autorização; antes dela a nota não existe pra SEFAZ. */
export const DATA_FISCAL = "COALESCE(NULLIF(autorizada_em, ''), criado_em)";

/**
 * Teto de notas num pacote só. O ZIP é montado inteiro em memória e o servidor
 * atende todas as lojas ao mesmo tempo — acima disso o pedido é recusado com
 * uma saída, em vez de derrubar o processo.
 */
export const MAX_NOTAS = 5000;

export interface PacoteXml {
  conteudo: Buffer;
  nome: string;
  notas: number;
  autorizadas: number;
  canceladas: number;
  total_centavos: number;
}

/** Meses que têm nota de produção, do mais recente pro mais antigo. */
export async function competenciasDaLoja(lojaId: number) {
  const linhas = await db.prepare(
    `SELECT LEFT(${DATA_FISCAL}, 7) AS competencia,
            COUNT(*) AS notas,
            SUM(status = 'autorizada') AS autorizadas,
            SUM(status = 'cancelada') AS canceladas,
            SUM(CASE WHEN status = 'autorizada' THEN total_centavos ELSE 0 END) AS total_centavos
       FROM notas_fiscais
      WHERE ${FILTRO}
      GROUP BY competencia
      ORDER BY competencia DESC
      LIMIT 24`
  ).all(lojaId) as Array<Record<string, unknown>>;
  // SUM() no MySQL volta como string — sem coagir aqui, "12" + "30" viraria
  // "1230" na tela em vez de 42.
  return linhas.map(l => ({
    competencia: String(l.competencia),
    notas: Number(l.notas) || 0,
    autorizadas: Number(l.autorizadas) || 0,
    canceladas: Number(l.canceladas) || 0,
    total_centavos: Number(l.total_centavos) || 0,
  }));
}

/**
 * Monta o ZIP do mês. Devolve `null` quando não há nota de produção — o que
 * NÃO é erro: é o mês em que a loja não emitiu nada.
 *
 * Vai a NFC-e autorizada de cada nota e, quando houve cancelamento, o evento
 * num arquivo à parte. As duas peças são necessárias: só o evento não comprova
 * o que foi cancelado, e só a nota não mostra que ela foi.
 */
export async function montarPacoteXml(
  lojaId: number, slugLoja: string, competencia: string,
): Promise<PacoteXml | null> {
  const notas = await db.prepare(
    `SELECT numero, serie, chave, status, motivo, total_centavos, xml, xml_cancelamento,
            ${DATA_FISCAL} AS data_fiscal
       FROM notas_fiscais
      WHERE ${FILTRO} AND LEFT(${DATA_FISCAL}, 7) = ?
      ORDER BY numero`
  ).all(lojaId, competencia) as Array<Record<string, any>>;

  if (notas.length === 0) return null;
  if (notas.length > MAX_NOTAS) {
    throw new Error(`Este mês tem ${notas.length} notas, demais para um arquivo só.`);
  }

  const zip = new JSZip();
  const csv = ['numero;serie;chave;data;valor;situacao;motivo'];
  let autorizadas = 0, canceladas = 0, total = 0;
  for (const n of notas) {
    // O nome do arquivo é a CHAVE, que é como o contador e o software fiscal
    // dele identificam a nota — "nota-12.xml" não diz nada do outro lado.
    if (n.xml) zip.file(`${n.chave}.xml`, String(n.xml));
    if (n.xml_cancelamento) zip.file(`${n.chave}-cancelamento.xml`, String(n.xml_cancelamento));
    if (n.status === 'autorizada') { autorizadas++; total += Number(n.total_centavos) || 0; }
    if (n.status === 'cancelada') canceladas++;
    csv.push([
      n.numero, n.serie, n.chave,
      String(n.data_fiscal || '').slice(0, 10),
      ((Number(n.total_centavos) || 0) / 100).toFixed(2).replace('.', ','),
      n.status,
      String(n.motivo || '').replace(/[;\r\n]+/g, ' ').trim(),
    ].join(';'));
  }
  /*
   * BOM no CSV: o contador abre isso no Excel em português, e sem o BOM o Excel
   * lê como ANSI e estraga todo acento do motivo do cancelamento.
   */
  zip.file('relacao.csv', '﻿' + csv.join('\r\n') + '\r\n');

  const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    conteudo,
    nome: `nfce-${slugLoja || lojaId}-${competencia}.zip`,
    notas: notas.length,
    autorizadas, canceladas,
    total_centavos: total,
  };
}

/**
 * Teto do anexo. Provedor de e-mail costuma recusar acima de 25 MB, e a recusa
 * chega como falha genérica de SMTP — melhor não tentar e dizer o motivo certo
 * na tela do que ficar com "falha ao enviar" sem explicação.
 */
const MAX_ANEXO_BYTES = 15 * 1024 * 1024;

export interface ResultadoEnvio {
  ok: boolean;
  /** Vazio quando deu certo; a razão, quando não. */
  motivo: string;
  /** Quantas notas foram no pacote (0 quando não havia o que mandar). */
  notas: number;
}

/**
 * Monta e manda o pacote pro contador da loja, e registra o resultado NA LOJA.
 *
 * Mês sem nota conta como resolvido (`ok`, 0 notas) de propósito: sem isso, o
 * job tentaria de novo todo dia até o mês virar, pra sempre não achar nada.
 */
export async function enviarPacoteAoContador(
  loja: Record<string, any>, competencia: string,
): Promise<ResultadoEnvio> {
  const destinos = destinatariosDe(loja.contador_email);
  if (destinos.length === 0) return { ok: false, motivo: 'Nenhum e-mail de contador válido cadastrado.', notas: 0 };

  let pacote: PacoteXml | null;
  try {
    pacote = await montarPacoteXml(Number(loja.id), String(loja.slug || ''), competencia);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha ao montar o arquivo.';
    await registrar(loja.id, '', motivo);
    return { ok: false, motivo, notas: 0 };
  }

  if (!pacote) {
    // Nada a enviar. Marca como resolvido pra não repetir a busca todo dia.
    await registrar(loja.id, competencia, '');
    return { ok: true, motivo: '', notas: 0 };
  }

  if (pacote.conteudo.length > MAX_ANEXO_BYTES) {
    const motivo = `O arquivo do mês ficou com ${(pacote.conteudo.length / 1048576).toFixed(1)} MB, grande demais para anexar. Baixe pelo painel e envie por outro meio.`;
    await registrar(loja.id, '', motivo);
    return { ok: false, motivo, notas: pacote.notas };
  }

  const nomeLoja = String(loja.nfce_razao_social || loja.nome || 'a loja');
  const enviado = await enviarEmail(
    destinos.join(', '),
    `NFC-e ${mesLegivel(competencia)} — ${nomeLoja}`,
    corpoEmail(nomeLoja, String(loja.nfce_cnpj || ''), competencia, pacote),
    [{ nome: pacote.nome, conteudo: pacote.conteudo, tipo: 'application/zip' }],
  );

  if (!enviado) {
    const motivo = 'O servidor de e-mail recusou o envio. Confira a configuração de SMTP.';
    await registrar(loja.id, '', motivo);
    return { ok: false, motivo, notas: pacote.notas };
  }
  await registrar(loja.id, competencia, '');
  return { ok: true, motivo: '', notas: pacote.notas };
}

/** Grava o resultado na loja: competência enviada e/ou o erro pra tela mostrar. */
async function registrar(lojaId: number, competencia: string, erro: string): Promise<void> {
  if (competencia) {
    await db.prepare(
      `UPDATE lojas SET contador_ultima_competencia = ?, contador_ultimo_envio_em = ?, contador_ultimo_erro = ''
        WHERE id = ?`
    ).run(competencia, agoraUTC(), lojaId);
  } else {
    // Erro NÃO mexe na última competência: senão uma falha de SMTP faria o
    // sistema achar que o mês foi enviado e pular pro próximo.
    await db.prepare('UPDATE lojas SET contador_ultimo_erro = ? WHERE id = ?').run(erro.slice(0, 300), lojaId);
  }
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-07' → 'julho/2026'. Competência inválida volta como veio. */
export function mesLegivel(competencia: string): string {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  return MESES[(mes || 0) - 1] ? `${MESES[mes - 1]}/${ano}` : String(competencia);
}

function corpoEmail(nomeLoja: string, cnpj: string, competencia: string, p: PacoteXml): string {
  const total = (p.total_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="color:#1a1a1a; margin:0 0 4px;">NFC-e de ${mesLegivel(competencia)}</h2>
      <p style="color:#666; margin:0 0 20px;">${nomeLoja}${cnpj ? ` — CNPJ ${cnpj}` : ''}</p>
      <p>Seguem em anexo os XMLs das notas emitidas no período.</p>
      <table style="border-collapse:collapse; margin:16px 0; font-size:14px;">
        <tr><td style="padding:4px 16px 4px 0; color:#666;">Notas autorizadas</td><td style="font-weight:bold;">${p.autorizadas}</td></tr>
        <tr><td style="padding:4px 16px 4px 0; color:#666;">Notas canceladas</td><td style="font-weight:bold;">${p.canceladas}</td></tr>
        <tr><td style="padding:4px 16px 4px 0; color:#666;">Total autorizado</td><td style="font-weight:bold;">R$ ${total}</td></tr>
      </table>
      <p style="font-size:13px; color:#666;">
        O arquivo <b>${p.nome}</b> traz um XML por nota, nomeado pela chave de acesso, o XML do evento
        de cancelamento quando houver, e um <b>relacao.csv</b> com número, chave, data, valor e situação
        para conferência.
      </p>
      <p style="font-size:12px; color:#999; margin-top:24px;">
        Envio automático. Em caso de divergência, procure o estabelecimento.
      </p>
    </div>
  `;
}
