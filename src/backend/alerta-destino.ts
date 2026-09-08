/**
 * PARA QUEM O ALERTA VAI.
 *
 * Existia dentro do vigia de backup como `ALERTA_EMAIL || SMTP_USER`, e no
 * servidor de produção `ALERTA_EMAIL` não estava definido — então todo aviso
 * caía no endereço da CONTA DE ENVIO, que é caixa de saída, não caixa de quem
 * cuida. Funciona por acidente e é o tipo de coisa que ninguém confere até o
 * dia em que o aviso importava.
 *
 * A plataforma já sabe o endereço de suporte: está em `configuracoes`, é
 * preenchido no painel e é exatamente quem deveria receber. Então a ordem é:
 *
 *   1. ALERTA_EMAIL      — quem quer um endereço só para alarme (plantão)
 *   2. suporte_email     — o que a plataforma já declara como canal
 *   3. SMTP_USER         — último recurso, para não ficar sem destino nenhum
 *
 * Fica em arquivo próprio porque agora há mais de um vigia, e destino de
 * alerta decidido em dois lugares diverge no primeiro que alguém mexer.
 */
import db from './db-mysql';

/** Nunca lança: alerta que falha por causa do destino é pior que alerta feio. */
export async function destinatarioDeAlerta(): Promise<string> {
  const doAmbiente = (process.env.ALERTA_EMAIL || '').trim();
  if (doAmbiente) return doAmbiente;

  try {
    const row = await db.prepare(
      "SELECT valor FROM configuracoes WHERE chave = 'suporte_email'"
    ).get() as { valor: string | null } | undefined;
    const suporte = (row?.valor || '').trim();
    if (suporte) return suporte;
  } catch {
    /* Banco fora do ar é justamente quando o alerta importa — cai no próximo. */
  }

  return (process.env.SMTP_USER || '').trim();
}

/**
 * SÓ AVISA UMA VEZ POR DIA POR PROBLEMA, e avisa de novo quando VOLTA.
 *
 * Um e-mail por hora sobre a mesma coisa é o jeito mais rápido de treinar
 * alguém a ignorar o alerta — e aí o próximo, que é de verdade, passa também.
 * O aviso de recuperação existe pelo motivo oposto: sem ele, ninguém sabe se o
 * problema foi resolvido ou se o vigia morreu junto.
 *
 * A chave é por problema, não global: disco cheio não pode silenciar o
 * certificado vencido por 24 horas.
 */
const UM_DIA = 24 * 3_600_000;
const ultimoAviso = new Map<string, number>();
const quebrado = new Set<string>();

export function _resetarSilencio(): void {
  ultimoAviso.clear();
  quebrado.clear();
}

/** Deve avisar deste problema agora? Marca o envio quando responde `true`. */
export function podeAvisar(chave: string, agora: number): boolean {
  quebrado.add(chave);
  const anterior = ultimoAviso.get(chave) ?? 0;
  if (agora - anterior < UM_DIA) return false;
  ultimoAviso.set(chave, agora);
  return true;
}

/**
 * Problema resolvido: devolve `true` UMA vez, para o aviso de recuperação.
 * Chamar com um problema que nunca quebrou devolve `false` — senão o primeiro
 * ciclo do vigia mandaria "voltou a funcionar" de coisas que nunca falharam.
 */
export function voltouAoNormal(chave: string): boolean {
  if (!quebrado.has(chave)) return false;
  quebrado.delete(chave);
  ultimoAviso.delete(chave);
  return true;
}
