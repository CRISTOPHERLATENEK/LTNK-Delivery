/**
 * VIGIA DE SAÚDE — o que o sistema sabe sobre si e ninguém está olhando.
 *
 * Antes disto, o único alerta proativo era o do backup. Tudo o mais aparecia em
 * log: certificado A1 a vencer, disco enchendo, nota rejeitada pela SEFAZ. Log
 * é onde a informação vai morar quando não há ninguém lendo — e com clientes
 * pagantes, "o lojista me avisou" é o pior canal de monitoramento possível.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ISTO NÃO COBRE, e é importante estar escrito:
 *
 * queda do servidor. Um vigia que roda DENTRO do processo não pode avisar que
 * o processo morreu, nem que a máquina apagou. Para isso é preciso alguém de
 * fora batendo em /api/saude — um monitor externo, que é um serviço à parte.
 * Este arquivo cobre o que o sistema consegue enxergar estando de pé.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Roda no boot e a cada 6 horas, como o vigia de backup, e usa a mesma
 * disciplina de silêncio: um aviso por dia por problema, e um aviso quando
 * volta ao normal.
 */
import { execFileSync } from 'child_process';
import db, { comTenant } from './db-mysql';
import { listarTenants } from './tenants-mysql';
import { enviarEmail, emailHabilitado } from './email';
import { destinatarioDeAlerta, podeAvisar, voltouAoNormal } from './alerta-destino';

/** Um problema encontrado: chave estável para o silêncio, e o texto do aviso. */
export interface Achado {
  chave: string;
  titulo: string;
  corpo: string;
}

/*
 * CERTIFICADO A1: avisa com 30 dias, não com 3.
 *
 * Renovar certificado envolve contador, agendamento e às vezes ir a um posto —
 * não é coisa de fazer no dia. E o dia em que ele vence, a emissão fiscal para
 * inteira, no meio do movimento. Trinta dias é o prazo em que ainda dá para
 * resolver sem urgência; sete é o prazo em que já virou urgência.
 */
const DIAS_AVISO_CERTIFICADO = 30;

export function avaliarCertificado(
  loja: { id: number; nome: string; validade: string | null },
  agora: number,
): Achado | null {
  if (!loja.validade) return null;
  const vence = Date.parse(loja.validade);
  if (Number.isNaN(vence)) return null;

  const dias = Math.floor((vence - agora) / 86_400_000);
  if (dias > DIAS_AVISO_CERTIFICADO) return null;

  if (dias < 0) {
    return {
      chave: `cert-vencido-${loja.id}`,
      titulo: `Certificado VENCIDO — ${loja.nome}`,
      corpo: `<p>O certificado A1 da loja <b>${loja.nome}</b> venceu em
              <b>${loja.validade.slice(0, 10)}</b>, há ${Math.abs(dias)} dia(s).</p>
              <p>A emissão fiscal desta loja está parada desde então.</p>`,
    };
  }
  return {
    chave: `cert-vencendo-${loja.id}`,
    titulo: `Certificado vence em ${dias} dia(s) — ${loja.nome}`,
    corpo: `<p>O certificado A1 da loja <b>${loja.nome}</b> vence em
            <b>${loja.validade.slice(0, 10)}</b> — ${dias} dia(s).</p>
            <p>Renovar envolve contador e agendamento; no dia do vencimento a
            emissão fiscal para no meio do movimento.</p>`,
  };
}

/*
 * DISCO: avisa em 85%, não em 99%.
 *
 * Em 99% já não dá para escrever o dump do backup nem o log que diria o que
 * aconteceu — o aviso chega junto com o estrago. E 15% de 197 GB ainda são
 * dezenas de gigas: dá tempo de olhar sem pressa.
 */
const USO_DISCO_ALERTA = 85;

export function avaliarDisco(usoPorCento: number): Achado | null {
  if (usoPorCento < USO_DISCO_ALERTA) return null;
  return {
    chave: 'disco',
    titulo: `Disco em ${usoPorCento}% no servidor do Delivery`,
    corpo: `<p>O disco está com <b>${usoPorCento}%</b> de uso.</p>
            <p>Cheio, o backup para de gravar, o MySQL para de escrever e o log
            para de registrar o motivo. Os suspeitos de sempre:</p>
            <pre>du -sh /opt/backup-delivery /opt/delivery/dados/uploads
du -sh /var/log /root/.pm2/logs</pre>`,
  };
}

/** Uso do disco em %, ou `null` se não deu para medir (não é motivo de alarme). */
export function usoDoDisco(): number | null {
  try {
    const saida = execFileSync('df', ['-P', '/'], { encoding: 'utf8' });
    const linha = saida.trim().split('\n').pop() || '';
    const m = linha.match(/(\d+)%/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/*
 * NOTA REJEITADA: conta as últimas 24h e avisa a partir da primeira.
 *
 * Rejeição não é ruído: é venda registrada sem documento fiscal, e o problema
 * quase sempre é de cadastro (CFOP, CSOSN, CSC, intermediador) — ou seja,
 * repete em TODAS as notas seguintes até alguém corrigir. Uma rejeição hoje é
 * cinquenta amanhã.
 */
export function avaliarRejeicoes(
  lojaNome: string, lojaId: number, quantas: number, motivo: string | null,
): Achado | null {
  if (quantas <= 0) return null;
  return {
    chave: `rejeicao-${lojaId}`,
    titulo: `${quantas} nota(s) rejeitada(s) em 24h — ${lojaNome}`,
    corpo: `<p>A loja <b>${lojaNome}</b> teve <b>${quantas}</b> nota(s)
            rejeitada(s) nas últimas 24 horas.</p>
            <p>Último motivo informado pela SEFAZ:</p>
            <pre>${(motivo || 'sem motivo registrado').slice(0, 400)}</pre>
            <p>Rejeição costuma ser de cadastro, e cadastro errado rejeita a
            próxima também — cada nota que não sai é venda sem documento.</p>`,
  };
}

/** Junta os achados de todos os tenants. Nunca lança. */
export async function coletarAchados(agora = Date.now()): Promise<Achado[]> {
  const achados: Achado[] = [];

  const uso = usoDoDisco();
  if (uso !== null) {
    const a = avaliarDisco(uso);
    if (a) achados.push(a);
    else if (voltouAoNormal('disco')) {
      achados.push({
        chave: 'disco-ok',
        titulo: `Disco voltou ao normal (${uso}%)`,
        corpo: `<p>O uso do disco caiu para <b>${uso}%</b>.</p>`,
      });
    }
  }

  let tenants: Array<{ db_nome: string; slug: string }> = [];
  try {
    tenants = await listarTenants() as Array<{ db_nome: string; slug: string }>;
  } catch {
    return achados;
  }

  for (const t of tenants) {
    try {
      await comTenant(t.db_nome, async () => {
        const lojas = await db.prepare(
          `SELECT id, nome, nfce_cert_validade AS validade
             FROM lojas WHERE excluida = 0`
        ).all() as Array<{ id: number; nome: string; validade: string | null }>;

        for (const loja of lojas) {
          const cert = avaliarCertificado(loja, agora);
          if (cert) achados.push(cert);

          const corte = new Date(agora - 86_400_000).toISOString();
          const r = await db.prepare(
            `SELECT COUNT(*) AS quantas, MAX(motivo) AS motivo
               FROM notas_fiscais
              WHERE loja_id = ? AND status IN ('rejeitada','erro') AND criado_em >= ?`
            /* 'erro' entra junto, como no dossiê: nota que deu erro é nota que
               não saiu, e a venda fica sem documento do mesmo jeito. */
          ).get(loja.id, corte) as { quantas: number; motivo: string | null } | undefined;

          const rej = avaliarRejeicoes(loja.nome, loja.id, Number(r?.quantas || 0), r?.motivo ?? null);
          if (rej) achados.push(rej);
        }
      });
    } catch (e) {
      /* Um tenant com problema não pode calar os outros. */
      console.error(`[SAUDE] falhou ao verificar ${t.slug}:`, e instanceof Error ? e.message : e);
    }
  }

  return achados;
}

/** Roda a verificação e manda o que for novo. Nunca lança. */
export async function verificarSaude(agora = Date.now()): Promise<Achado[]> {
  let achados: Achado[] = [];
  try {
    achados = await coletarAchados(agora);
  } catch (e) {
    console.error('[SAUDE] coleta falhou:', e instanceof Error ? e.message : e);
    return [];
  }

  const enviar = achados.filter(a => a.chave.endsWith('-ok') || podeAvisar(a.chave, agora));
  if (enviar.length === 0) return achados;

  for (const a of enviar) console.error(`[SAUDE] ${a.titulo}`);

  const para = await destinatarioDeAlerta();
  if (!para) {
    console.error('[SAUDE] sem destino de alerta (ALERTA_EMAIL, suporte_email ou SMTP_USER).');
    return achados;
  }
  if (!emailHabilitado()) {
    console.error('[SAUDE] SMTP não configurado — os avisos não puderam ser enviados.');
    return achados;
  }

  /*
   * UM E-MAIL COM TUDO, não um por achado. Certificado vencendo e disco cheio
   * costumam ter a mesma causa raiz (servidor esquecido), e três e-mails ao
   * mesmo tempo treinam a pessoa a arquivar os três.
   */
  const assunto = enviar.length === 1
    ? `⚠ ${enviar[0].titulo}`
    : `⚠ ${enviar.length} avisos do Delivery`;
  const corpo = enviar.map(a => `<h3>${a.titulo}</h3>${a.corpo}`).join('<hr>');

  try {
    await enviarEmail(para, assunto, corpo);
  } catch (e) {
    console.error('[SAUDE] não deu para enviar o aviso:', e instanceof Error ? e.message : e);
  }
  return achados;
}
