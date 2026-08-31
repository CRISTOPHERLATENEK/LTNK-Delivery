/**
 * O PRAZO DE UM JWT, LIDO DO PRÓPRIO TOKEN.
 *
 * Serve às duas APIs da POS Controle — Smart TEF e PDV MOBI — e é por isso que
 * mora fora das duas: ler `exp` não depende de qual serviço emitiu, e a
 * alternativa seria uma delas importar a outra sem motivo.
 *
 * Ler o prazo do token, em vez de acreditar no envelope da resposta, é o que
 * mantém a renovação certa quando o formato da resposta muda. O PDV MOBI devolve
 * `{ "jwt": "..." }` e diz "válido por 1 hora" na documentação; confiar nessa
 * frase seria fixar uma hora no código e descobrir a mudança na hora da venda.
 */

/**
 * O `exp` do JWT, em milissegundos, ou `null` se não der para ler.
 *
 * Não valida assinatura, e não é para validar: quem valida é o servidor deles.
 * Aqui só se lê o prazo, e é por isso que um token estranho não pode explodir —
 * devolve `null`, e quem chama decide o padrão.
 */
export function expiraDoJwt(token: string, agoraMs: number): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = Number(corpo.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    const ms = exp * 1000;
    /* Prazo no passado é token vencido: não serve, e tratar como válido faria a
       primeira venda falhar sem explicação. */
    return ms > agoraMs ? ms : null;
  } catch {
    return null;
  }
}
