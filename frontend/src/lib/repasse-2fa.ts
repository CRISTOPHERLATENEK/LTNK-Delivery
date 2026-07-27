/**
 * Repasse do 2FA entre domínios.
 *
 * Quem entra pelo domínio da PLATAFORMA pode ter conta em outra marca — cada
 * tenant tem banco próprio, então o login central procura a conta nos demais
 * tenants (só depois de conferir a senha) e devolve `redirecionar` apontando
 * pro domínio da marca dona da conta. O 2FA precisa ser concluído LÁ, porque o
 * token de pré-autenticação é carimbado com aquele tenant e `autenticarPreAuth`
 * o recusa em qualquer outro banco.
 *
 * O token viaja no FRAGMENTO da URL (`#pre=...`), não na query: fragmento não é
 * enviado ao servidor, então não entra em log de acesso nem em cabeçalho
 * Referer. E o que viaja é um token de 10 minutos que sozinho não abre nada —
 * o código do 2FA ainda precisa ser digitado no destino. Ainda assim a URL é
 * limpa logo após a leitura, pra não sobrar no histórico nem num link colado
 * sem querer.
 */

export type Repasse2FA = { tokenPreAuth: string; modo: 'configurar' | 'verificar' };

/** Lê (e consome) o repasse vindo na URL. Null quando não é uma chegada dessas. */
export function lerRepasse2FA(): Repasse2FA | null {
  if (!window.location.hash.startsWith('#')) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  const pre = p.get('pre');
  const modo = p.get('modo');
  if (!pre || (modo !== 'configurar' && modo !== 'verificar')) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { tokenPreAuth: pre, modo };
}

/**
 * Monta o destino do repasse, ou null se não há pra onde ir (sem
 * `redirecionar`, URL inválida, ou já estamos no domínio certo — aí o 2FA
 * segue aqui mesmo, que funciona porque o token já traz o tenant certo).
 */
export function destinoRepasse2FA(
  redirecionar: string | null | undefined,
  caminho: string,
  repasse: Repasse2FA,
): string | null {
  if (!redirecionar) return null;
  let origem: string;
  try {
    origem = new URL(redirecionar).origin;
  } catch { return null; }
  if (origem === window.location.origin) return null;
  const params = new URLSearchParams({ pre: repasse.tokenPreAuth, modo: repasse.modo });
  return `${redirecionar.replace(/\/+$/, '')}${caminho}#${params}`;
}
