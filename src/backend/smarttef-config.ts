/**
 * CONFIGURAÇÃO DO TEF POR LOJA — as regras, longe da rota.
 *
 * O que mora aqui é o que decide se a loja PODE cobrar na maquininha, e como a
 * base URL é normalizada. Fora da rota porque é a parte que dá para testar sem
 * banco e sem rede, e porque errar aqui tem consequência assimétrica:
 *
 * - dizer "configurado" sem estar → o operador escolhe Cartão, a venda trava
 *   esperando uma maquininha que nunca vai receber nada, com o cliente na frente;
 * - dizer "não configurado" estando → o lojista volta pra digitar valor na mão,
 *   que é o que ele já fazia. Chato, mas não quebra venda.
 *
 * Por isso a checagem é conservadora: exige as três peças, não duas.
 */

export interface CredenciaisTef {
  ativo: boolean;
  baseUrl: string;
  token: string | null;
  gatewayToken: string | null;
  serialPos: string;
}

/**
 * Normaliza a base URL vinda da tela.
 *
 * O host não está na documentação pública do Smart TEF — vem no credenciamento,
 * e parceiro White Label pode receber outro. Ou seja: é um campo que um humano
 * cola, e vai colar com espaço no fim, com barra sobrando, e às vezes já com o
 * caminho `/smarttef/...` junto.
 *
 * Devolve string vazia quando não dá para usar. Não lança: a tela precisa poder
 * dizer o que está errado, e exceção aqui viraria 500 no lugar de aviso.
 */
export function normalizarBaseUrl(bruta: unknown): string {
  const texto = String(bruta ?? '').trim();
  if (!texto) return '';

  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return '';
  }

  /*
   * HTTPS OBRIGATÓRIO, sem exceção para localhost.
   *
   * O que trafega aqui é o Bearer da loja — quem o tem cobra na maquininha de
   * alguém. Um "só pra testar" em http vaza o token na rede local do
   * restaurante, que é justamente onde tem wifi de cliente.
   */
  if (u.protocol !== 'https:') return '';
  if (!u.hostname.includes('.')) return '';

  /*
   * Guarda só a origem. Os caminhos (`/smarttef/commands/...`) são do nosso
   * cliente HTTP: se o lojista colar a URL completa de um endpoint, concatenar
   * geraria `/smarttef/.../smarttef/...` e um 404 que ninguém liga ao campo.
   */
  return u.origin;
}

/**
 * A loja consegue cobrar na maquininha agora?
 *
 * As três peças são indivisíveis: base URL sem token não autentica, token sem
 * gateway token bate no 401 do gateway, e qualquer uma delas sozinha não cobra
 * nada. Meio configurado é o mesmo que não configurado — só pior, porque parece
 * pronto.
 *
 * `ativo` é separado das credenciais de propósito: o lojista precisa poder
 * desligar o TEF sem apagar o que colou, por exemplo quando a maquininha vai
 * pra manutenção. Apagar credencial pra desligar é como o token some.
 */
export function tefConfigurado(c: CredenciaisTef): boolean {
  return (
    c.ativo &&
    normalizarBaseUrl(c.baseUrl) !== '' &&
    !!c.token?.trim() &&
    !!c.gatewayToken?.trim()
  );
}

/**
 * O que falta, em português, para a tela poder dizer.
 *
 * Lista e não primeiro-erro: quem acabou de abrir a tela não colou nada ainda, e
 * revelar uma pendência por vez faz a pessoa salvar quatro vezes para descobrir
 * as quatro coisas.
 */
export function pendenciasTef(c: CredenciaisTef): string[] {
  const faltas: string[] = [];
  if (!String(c.baseUrl ?? '').trim()) faltas.push('o endereço da API');
  else if (!normalizarBaseUrl(c.baseUrl)) faltas.push('um endereço da API válido, começando com https://');
  if (!c.token?.trim()) faltas.push('o token da loja');
  if (!c.gatewayToken?.trim()) faltas.push('o gateway token');
  return faltas;
}
