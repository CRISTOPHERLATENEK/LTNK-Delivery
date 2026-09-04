/**
 * VIGIA DO BACKUP — avisa quando ele PARA de acontecer.
 *
 * O script de backup já grita quando falha. O que ninguém vê é o silêncio: cron
 * desativado num `apt upgrade`, script apagado, disco cheio antes da primeira
 * linha, pasta com permissão trocada. Nesses casos não há falha para reportar —
 * simplesmente não acontece nada, todo dia, e a descoberta é no incidente.
 *
 * Este vigia olha o resultado, não o processo: existe pasta de backup de hoje?
 * Ela tem os arquivos que deveria ter? É a única pergunta que pega todos os
 * modos de falha de uma vez, inclusive os que ninguém previu.
 *
 * NÃO substitui um heartbeat externo. Ele roda DENTRO do servidor, então não
 * tem como avisar que o servidor caiu — para isso existe `HEARTBEAT_URL` no
 * script, que é pingada de fora. Os dois cobrem metades diferentes.
 */
import fs from 'fs';
import path from 'path';
import { enviarEmail, emailHabilitado } from './email';

const PASTA_BACKUP = process.env.BACKUP_DIR || '/opt/backup-delivery';

/** Prazo até reclamar. */
const HORAS_TOLERADAS = 30;

/**
 * As peças que um backup precisa ter para servir de alguma coisa.
 *
 * Conferir só "a pasta existe" deixaria passar o caso pior: a pasta de hoje
 * criada e vazia porque o disco encheu no primeiro dump. Um backup sem
 * `.sql.gz` não é um backup pequeno — é nenhum.
 */
const ESPERADAS = ['.sql.gz'];

export interface EstadoBackup {
  ok: boolean;
  motivo: string;
  ultimaPasta: string;
  horasAtras: number | null;
  arquivos: number;
}

/** Lê o estado do backup no disco. Puro o suficiente para testar. */
export function avaliarBackup(raiz: string, agora = Date.now()): EstadoBackup {
  if (!fs.existsSync(raiz)) {
    return { ok: false, motivo: `a pasta ${raiz} não existe`, ultimaPasta: '', horasAtras: null, arquivos: 0 };
  }

  const pastas = fs.readdirSync(raiz, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ nome: e.name, mtime: fs.statSync(path.join(raiz, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (pastas.length === 0) {
    return { ok: false, motivo: 'não há nenhuma pasta de backup', ultimaPasta: '', horasAtras: null, arquivos: 0 };
  }

  const ultima = pastas[0];
  const horas = (agora - ultima.mtime) / 3_600_000;
  const arquivos = fs.readdirSync(path.join(raiz, ultima.nome));
  const dumps = arquivos.filter(a => ESPERADAS.some(ext => a.endsWith(ext)));

  if (horas > HORAS_TOLERADAS) {
    return {
      ok: false,
      motivo: `o backup mais recente é de ${Math.floor(horas)}h atrás (${ultima.nome})`,
      ultimaPasta: ultima.nome, horasAtras: horas, arquivos: arquivos.length,
    };
  }
  if (dumps.length === 0) {
    /* Pasta de hoje sem nenhum dump: o backup "rodou" e não salvou banco
       nenhum. É o modo de falha mais traiçoeiro, porque a data está certa. */
    return {
      ok: false,
      motivo: `a pasta ${ultima.nome} existe mas não tem nenhum dump de banco`,
      ultimaPasta: ultima.nome, horasAtras: horas, arquivos: arquivos.length,
    };
  }

  return {
    ok: true, motivo: '', ultimaPasta: ultima.nome,
    horasAtras: horas, arquivos: arquivos.length,
  };
}

/**
 * Para quem o aviso vai.
 *
 * `ALERTA_EMAIL` no `.env` tem prioridade. Sem ele, o `SMTP_USER` — que é a
 * conta que envia, e portanto uma caixa que alguém lê. Mandar para ninguém
 * seria pior que não checar: daria a sensação de estar vigiado.
 */
function destinatario(): string {
  return (process.env.ALERTA_EMAIL || process.env.SMTP_USER || '').trim();
}

/*
 * SÓ AVISA UMA VEZ POR DIA, e avisa de novo quando VOLTA.
 *
 * Um e-mail por hora sobre o mesmo problema é o jeito mais rápido de treinar
 * alguém a ignorar o alerta — e aí o próximo, que é de verdade, também passa.
 * O aviso de recuperação existe pelo motivo oposto: sem ele, ninguém sabe se o
 * problema foi resolvido ou se o vigia parou junto.
 */
let ultimoAvisoEm = 0;
let estavaQuebrado = false;

export function _resetarEstadoDoVigia() {
  ultimoAvisoEm = 0;
  estavaQuebrado = false;
}

export async function verificarBackup(agora = Date.now()): Promise<EstadoBackup> {
  const estado = avaliarBackup(PASTA_BACKUP, agora);

  if (estado.ok) {
    if (estavaQuebrado) {
      estavaQuebrado = false;
      console.log(`[BACKUP] voltou a funcionar (${estado.ultimaPasta}, ${estado.arquivos} arquivos).`);
      const para = destinatario();
      if (para && emailHabilitado()) {
        await enviarEmail(para, 'Backup voltou a funcionar',
          `<p>O backup do Delivery voltou a rodar.</p>
           <p>Cópia mais recente: <b>${estado.ultimaPasta}</b>, ${estado.arquivos} arquivo(s).</p>`);
      }
    }
    return estado;
  }

  console.error(`[BACKUP] ATENÇÃO: ${estado.motivo}`);
  estavaQuebrado = true;

  const um_dia = 24 * 3_600_000;
  if (agora - ultimoAvisoEm < um_dia) return estado;

  const para = destinatario();
  if (!para) {
    console.error('[BACKUP] sem ALERTA_EMAIL nem SMTP_USER — o aviso não tem para onde ir.');
    return estado;
  }
  if (!emailHabilitado()) {
    console.error('[BACKUP] SMTP não configurado — o aviso não pôde ser enviado.');
    return estado;
  }

  ultimoAvisoEm = agora;
  await enviarEmail(para, '⚠ O backup do Delivery não está acontecendo',
    `<p><b>${estado.motivo}</b></p>
     <p>O backup deveria rodar todo dia às 03:12. Enquanto isso não voltar, uma
     perda do servidor custa tudo o que entrou desde a última cópia boa.</p>
     <p>Para investigar:</p>
     <pre>tail -20 /var/log/backup-delivery.log
ls -lt /opt/backup-delivery | head
systemctl status cron
df -h /</pre>
     <p>Para rodar na mão agora: <code>/usr/local/bin/backup-delivery.sh</code></p>`);
  console.log(`[BACKUP] aviso enviado para ${para}`);
  return estado;
}
