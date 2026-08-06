/**
 * LOGIN SOCIAL (Google / Facebook) para o cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE MANDA NO DESENHO: OAuth exige que a `redirect_uri` esteja
 * CADASTRADA no console do provedor, exata. E aqui cada cliente do SaaS tem o
 * domínio dele (loja1.com.br, loja2.com.br, cristopher.maxxdelivery.app.br...).
 * As duas saídas possíveis:
 *
 *  (a) Um app OAuth por tenant — cada pizzaria criaria um projeto no Google
 *      Cloud, aceitaria termos, configuraria tela de consentimento. Irreal pra
 *      quem vende sistema pra pizzaria.
 *
 *  (b) UM app da plataforma, com callback num domínio FIXO, e um salto de volta
 *      pro domínio do tenant. É o que este módulo faz.
 *
 * O preço de (b), e é honesto dizer: a tela de consentimento do Google mostra o
 * domínio da PLATAFORMA, não o da loja. Some um pouco do white-label naquele
 * instante. A alternativa é não ter login social, ou exigir que cada lojista
 * mantenha credencial própria — pior nas duas pontas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O FLUXO, e por que cada pedaço existe:
 *
 *  1. `/oauth/:provedor/iniciar` no domínio da LOJA monta a URL do provedor. O
 *     `state` é um JWT assinado carregando o BANCO DO TENANT, a loja e pra onde
 *     voltar. Sem isso o callback não teria como saber em qual dos bancos criar
 *     o usuário — e `state` também é a proteção contra CSRF, que é o motivo de
 *     ele ser assinado e não um texto qualquer.
 *
 *  2. `/oauth/:provedor/callback` no domínio FIXO troca o código pelo perfil,
 *     acha-ou-cria o usuário DENTRO do tenant que veio no state, e gera um
 *     CÓDIGO DE USO ÚNICO.
 *
 *  3. Redireciona pro domínio da loja com o código no FRAGMENTO da URL
 *     (`#oauth=...`). Fragmento não vai pro servidor, não entra em log de
 *     acesso e não viaja no cabeçalho Referer — mesma decisão já usada no
 *     repasse de 2FA entre domínios (lib/repasse-2fa.ts).
 *
 *  4. `/oauth/trocar` troca o código pela sessão de verdade. O código morre no
 *     primeiro uso e em 2 minutos.
 *
 * POR QUE NÃO MANDAR O TOKEN DE SESSÃO DIRETO NA URL: mesmo no fragmento, ele
 * fica no histórico do navegador do aparelho — que num delivery é com frequência
 * um celular compartilhado ou um computador de balcão. Código que morre no
 * primeiro uso limita o dano a uma janela de segundos.
 *
 * POR QUE REDIRECT E NÃO O SDK JS DO GOOGLE: o SDK exigiria abrir `script-src` e
 * `frame-src` na CSP pra domínio do Google (ver CSP_BASE em server.ts). Redirect
 * de navegação não precisa de nada disso — a CSP fica fechada como está.
 */
import jwt from 'jsonwebtoken';

export type ProvedorOauth = 'google' | 'facebook';

export interface PerfilOauth {
  /** Id do usuário NO PROVEDOR (`sub` no Google). Estável, nunca reutilizado. */
  sub: string;
  email: string;
  nome: string;
  /** O provedor confirma que o e-mail é daquela pessoa? Decide se dá pra vincular. */
  emailVerificado: boolean;
}

export interface EstadoOauth {
  /** Banco do tenant onde a conta vive/nascerá. */
  tenant: string;
  /** Loja de origem (isolamento white-label do cadastro de cliente). */
  lojaId: number | null;
  /** Origem pra onde voltar, ex.: "https://maxxtalk.com.br". */
  origem: string;
  /** Caminho dentro da origem, ex.: "/conta". */
  caminho: string;
}

const SEGREDO = process.env.JWT_SECRET || '';

/**
 * Domínio FIXO onde o callback do OAuth atende — o único endereço que precisa
 * estar cadastrado no console do provedor.
 *
 * Sem isto configurado o login social fica DESLIGADO em vez de tentar adivinhar
 * pelo Host: adivinhar produziria uma `redirect_uri` diferente da cadastrada, e
 * o provedor recusaria com um erro que não diz o que fazer ("redirect_uri
 * mismatch") justo na frente do cliente final.
 */
export function urlBaseOauth(): string {
  return (process.env.OAUTH_URL_BASE || '').replace(/\/+$/, '');
}

interface ConfigProvedor {
  clientId: string;
  clientSecret: string;
  urlAutorizacao: string;
  urlToken: string;
  urlPerfil: string;
  escopo: string;
}

function configDe(provedor: ProvedorOauth): ConfigProvedor | null {
  if (provedor === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) return null;
    return {
      clientId, clientSecret,
      urlAutorizacao: 'https://accounts.google.com/o/oauth2/v2/auth',
      urlToken: 'https://oauth2.googleapis.com/token',
      urlPerfil: 'https://openidconnect.googleapis.com/v1/userinfo',
      escopo: 'openid email profile',
    };
  }
  const clientId = process.env.FACEBOOK_APP_ID || '';
  const clientSecret = process.env.FACEBOOK_APP_SECRET || '';
  if (!clientId || !clientSecret) return null;
  return {
    clientId, clientSecret,
    urlAutorizacao: 'https://www.facebook.com/v19.0/dialog/oauth',
    urlToken: 'https://graph.facebook.com/v19.0/oauth/access_token',
    urlPerfil: 'https://graph.facebook.com/v19.0/me?fields=id,name,email',
    escopo: 'email public_profile',
  };
}

/** Provedores prontos pra usar — a tela só mostra botão pra estes. */
export function provedoresDisponiveis(): ProvedorOauth[] {
  if (!SEGREDO || !urlBaseOauth()) return [];
  return (['google', 'facebook'] as ProvedorOauth[]).filter(p => configDe(p) !== null);
}

/** A `redirect_uri` — tem que ser IDÊNTICA à cadastrada no console do provedor. */
export function redirectUri(provedor: ProvedorOauth): string {
  return `${urlBaseOauth()}/api/auth/oauth/${provedor}/callback`;
}

/* ───────────────────────── state (anti-CSRF + tenant) ───────────────────────── */

/**
 * `state` assinado, válido por 10 minutos.
 *
 * DUAS FUNÇÕES numa coisa só: transporta o tenant/loja/destino (o callback roda
 * noutro domínio e não teria como saber) e prova que o retorno corresponde a um
 * início que NÓS emitimos — um `state` que a gente não assinou é tentativa de
 * forçar login em conta alheia.
 */
export function assinarEstado(estado: EstadoOauth): string {
  return jwt.sign(estado, SEGREDO, { expiresIn: '10m' });
}

export function lerEstado(state: string): EstadoOauth | null {
  try {
    const d = jwt.verify(state, SEGREDO) as EstadoOauth;
    if (!d?.tenant || !d?.origem) return null;
    return d;
  } catch { return null; }
}

/* ───────────────────────── passos do fluxo ───────────────────────── */

/** URL do provedor pra onde mandar a pessoa. */
export function urlDeAutorizacao(provedor: ProvedorOauth, state: string): string | null {
  const cfg = configDe(provedor);
  if (!cfg) return null;
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(provedor),
    response_type: 'code',
    scope: cfg.escopo,
    state,
  });
  // `select_account` porque o aparelho costuma ser compartilhado (celular da
  // família, computador do balcão): sem isso o Google reusa a última conta em
  // silêncio e a pessoa entra como outra pessoa sem perceber.
  if (provedor === 'google') q.set('prompt', 'select_account');
  return `${cfg.urlAutorizacao}?${q}`;
}

/** Troca o `code` pelo perfil da pessoa. Lança com mensagem legível se falhar. */
export async function perfilDoCodigo(provedor: ProvedorOauth, code: string): Promise<PerfilOauth> {
  const cfg = configDe(provedor);
  if (!cfg) throw new Error('Login social não está configurado no servidor.');

  const respToken = await fetch(cfg.urlToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(provedor),
      grant_type: 'authorization_code',
    }),
  });
  if (!respToken.ok) {
    const corpo = await respToken.text().catch(() => '');
    throw new Error(`O provedor recusou a autenticação (HTTP ${respToken.status}). ${corpo.slice(0, 200)}`);
  }
  const { access_token: accessToken } = await respToken.json() as { access_token?: string };
  if (!accessToken) throw new Error('O provedor não devolveu o token de acesso.');

  const respPerfil = await fetch(cfg.urlPerfil, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!respPerfil.ok) throw new Error(`Não conseguimos ler seu perfil no provedor (HTTP ${respPerfil.status}).`);
  return normalizarPerfil(provedor, await respPerfil.json());
}

/**
 * Normaliza a resposta dos provedores, que divergem no básico.
 *
 * FACEBOOK PODE NÃO MANDAR E-MAIL — a pessoa pode negar a permissão, ou a conta
 * pode ser só telefone. E o Facebook não tem campo de "e-mail verificado": aqui
 * ele é tratado como verificado apenas porque a conta é confirmada do lado deles;
 * sem e-mail, `emailVerificado` cai pra false e o vínculo é recusado lá em cima,
 * que é o comportamento seguro.
 */
export function normalizarPerfil(provedor: ProvedorOauth, bruto: Record<string, unknown>): PerfilOauth {
  const email = String(bruto.email || '').trim().toLowerCase();
  if (provedor === 'google') {
    return {
      sub: String(bruto.sub || ''),
      email,
      nome: String(bruto.name || '').trim(),
      emailVerificado: bruto.email_verified === true || bruto.email_verified === 'true',
    };
  }
  return {
    sub: String(bruto.id || ''),
    email,
    nome: String(bruto.name || '').trim(),
    emailVerificado: !!email,
  };
}

/**
 * Decide o que fazer com o perfil que voltou do provedor.
 *
 * A REGRA QUE IMPORTA — VÍNCULO POR E-MAIL EXIGE E-MAIL VERIFICADO: casar por
 * e-mail sem o provedor garantir que ele é daquela pessoa seria entregar a conta
 * de quem já tem senha aqui pra quem conseguir criar uma conta com o mesmo
 * endereço no provedor. É takeover, não conveniência.
 *
 * Separado em função pura pra ser testável: são as decisões de quem entra em qual
 * conta, e errar aqui é grave de um jeito que teste de rota não pega.
 */
export type DecisaoOauth =
  | { acao: 'entrar'; usuarioId: number }
  | { acao: 'vincular'; usuarioId: number }
  | { acao: 'criar' }
  | { acao: 'recusar'; motivo: string };

export function decidirVinculo(
  perfil: PerfilOauth,
  achados: { porSub?: { id: number } | null; porEmail?: { id: number; perfil: string } | null },
): DecisaoOauth {
  if (!perfil.sub) return { acao: 'recusar', motivo: 'O provedor não identificou sua conta. Tente de novo.' };

  // Já entrou por aqui antes: caminho normal, nem depende de e-mail.
  if (achados.porSub) return { acao: 'entrar', usuarioId: achados.porSub.id };

  if (!perfil.email) {
    return {
      acao: 'recusar',
      motivo: 'O provedor não informou seu e-mail, e ele é necessário para criar a conta. '
        + 'Autorize o compartilhamento do e-mail, ou cadastre-se com e-mail e senha.',
    };
  }

  /*
   * E-MAIL NÃO VERIFICADO → SEMPRE A MESMA RESPOSTA, exista conta aqui ou não.
   *
   * A mensagem específica ("já existe uma conta com este e-mail" contra "o
   * provedor não confirmou seu e-mail") VAZAVA A EXISTÊNCIA DA CONTA. E aqui isso
   * é grave de verdade, não teórico: e-mail não verificado significa que quem está
   * do outro lado pode NÃO SER o dono do endereço — o Facebook nem sempre confirma
   * —, então qualquer pessoa descobriria, um e-mail por vez, quem é cliente desta
   * loja. Duas mensagens diferentes são um oráculo tão bom quanto uma que responde
   * "sim".
   *
   * O caminho é o mesmo nos dois casos (entrar ou cadastrar com senha), então uma
   * mensagem serve para ambos sem perder nada de utilidade. É a mesma decisão já
   * tomada na mensagem de conflito do cadastro (rotas/autenticacao.ts).
   */
  if (!perfil.emailVerificado) {
    return {
      acao: 'recusar',
      motivo: 'Não foi possível entrar com esse provedor porque ele não confirmou seu e-mail. '
        + 'Entre com e-mail e senha, ou crie sua conta.',
    };
  }

  if (achados.porEmail) {
    /*
     * Só cliente entra por login social. Conta de lojista/entregador/admin tem 2FA
     * e painel próprio; vincular Google a ela puliria o segundo fator.
     *
     * A MENSAGEM NÃO DIZ QUE É CONTA DA EQUIPE. Dizia antes, e revelar o CARGO por
     * trás de um e-mail entrega estrutura da operação pra quem for atacar — quem
     * sabe qual endereço é do dono da loja sabe em quem insistir. Aqui já sabemos
     * que a pessoa é dona do e-mail (verificado acima), então "já está em uso" é
     * seguro e é o que ela precisa pra saber o que fazer.
     */
    if (achados.porEmail.perfil !== 'cliente') {
      return {
        acao: 'recusar',
        motivo: 'Este e-mail já está em uso. Entre com e-mail e senha.',
      };
    }
    return { acao: 'vincular', usuarioId: achados.porEmail.id };
  }

  return { acao: 'criar' };
}

/**
 * Nome pra usar no cadastro quando o provedor manda algo vazio ou esquisito.
 * Cliente sem nome quebra o cupom, a etiqueta de entrega e a saudação da tela.
 */
export function nomeUsavel(perfil: PerfilOauth): string {
  const nome = perfil.nome.trim();
  if (nome.length >= 2) return nome.slice(0, 120);
  const antesDoArroba = perfil.email.split('@')[0] || '';
  return (antesDoArroba.replace(/[._-]+/g, ' ').trim() || 'Cliente').slice(0, 120);
}
