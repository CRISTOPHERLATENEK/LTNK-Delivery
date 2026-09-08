/**
 * TUDO QUE ESTÁ CIFRADO NO BANCO, num lugar só.
 *
 * Esta lista é a coisa mais frágil da rotação de chave: coluna esquecida aqui
 * fica cifrada com a chave VELHA depois que a velha já não existe — e aí o
 * valor não volta nunca. É perda permanente, não um bug que se conserta.
 *
 * Por isso ela não é só documentação: `segredos-em-repouso.test.ts` varre o
 * código procurando toda chamada de `criptografar`/`descriptografar` e exige
 * que a coluna correspondente esteja aqui. Coluna nova cifrada sem entrar
 * nesta lista quebra o teste.
 *
 * O QUE NÃO ENTRA:
 *  - `usuarios.senha_hash` e `usuarios.totp_backup_codes` — são HASH, não
 *    cifra. Não há o que recifrar: hash não volta a ser texto.
 *  - `usuarios.reset_token_hash` — idem.
 *  - `.env` — não está no banco; quem troca é você, no arquivo.
 */

/** Uma coluna cifrada de uma tabela. */
export interface ColunaCifrada {
  tabela: string;
  coluna: string;
  /** Onde vive: banco central, banco de cada tenant, ou os dois. */
  onde: 'central' | 'tenant' | 'ambos';
  /** Para que serve — aparece no relatório do script. */
  oque: string;
}

/**
 * Segredos guardados como LINHA de `configuracoes` (chave/valor), não como
 * coluna. O valor cifrado está sempre em `valor`.
 */
export const CONFIGURACOES_CIFRADAS: ReadonlyArray<{ chave: string; oque: string }> = [
  { chave: 'wbapi_api_key', oque: 'chave da API do WhatsApp não-oficial da plataforma' },
  { chave: 'mercadopago_token_teste', oque: 'token de teste do Mercado Pago da plataforma' },
  { chave: 'mercadopago_token_producao', oque: 'token de produção do Mercado Pago da plataforma' },
];

export const COLUNAS_CIFRADAS: ReadonlyArray<ColunaCifrada> = [
  // ── Fiscal ───────────────────────────────────────────────────────────────
  { tabela: 'lojas', coluna: 'nfce_csc', onde: 'tenant', oque: 'CSC da NFC-e' },
  { tabela: 'lojas', coluna: 'nfce_cert_senha', onde: 'tenant', oque: 'senha do certificado A1' },

  // ── Pagamento ────────────────────────────────────────────────────────────
  { tabela: 'lojas', coluna: 'mercadopago_token_teste', onde: 'tenant', oque: 'token de teste do MP da loja' },
  { tabela: 'lojas', coluna: 'mercadopago_token_producao', onde: 'tenant', oque: 'token de produção do MP da loja' },
  { tabela: 'lojas', coluna: 'mercadopago_webhook_secret', onde: 'tenant', oque: 'assinatura do webhook do MP' },
  /*
   * COLUNA QUE SÓ É LIDA. Nada escreve nela desde que os tokens viraram
   * teste/produção separados — mas o código ainda a DECIFRA como reserva, e
   * loja antiga pode ter valor ali. Deixar de fora da rotação transformaria o
   * pagamento dessa loja em erro silencioso.
   */
  { tabela: 'lojas', coluna: 'mercadopago_token', onde: 'tenant', oque: 'token do MP (formato antigo, só leitura)' },
  { tabela: 'lojas', coluna: 'onz_client_secret', onde: 'tenant', oque: 'client secret da ONZ (Pix)' },
  /*
   * O CLIENT ID TAMBÉM É CIFRADO, e eu tinha deixado de fora por achar que não
   * era segredo — ele aparece inteiro na tela do lojista. Mas o código o
   * grava com `criptografar`, e é isso que decide: a rotação segue o que o
   * código FAZ, não o que eu acho que ele deveria fazer. Fora da lista, o Pix
   * daquela loja pararia depois da troca de chave.
   */
  { tabela: 'lojas', coluna: 'onz_client_id', onde: 'tenant', oque: 'client id da ONZ (cifrado, ainda que visível na tela)' },

  // ── Maquininha (TEF) ─────────────────────────────────────────────────────
  { tabela: 'lojas', coluna: 'smarttef_senha', onde: 'tenant', oque: 'senha do TEF' },
  { tabela: 'lojas', coluna: 'smarttef_gateway_token', onde: 'tenant', oque: 'token do gateway do TEF' },

  // ── ERP e WhatsApp ───────────────────────────────────────────────────────
  { tabela: 'lojas', coluna: 'maxxgestao_token', onde: 'tenant', oque: 'token do Maxx Gestão' },
  { tabela: 'lojas', coluna: 'whatsapp_oficial_token', onde: 'tenant', oque: 'token do WhatsApp oficial (Meta)' },

  // ── Segunda etapa de login ───────────────────────────────────────────────
  /*
   * ESTE É O QUE TRANCA GENTE FORA. Os outros quebram uma integração e o
   * lojista recadastra; este impede o login de quem tem 2FA ativo, e a pessoa
   * não tem como recadastrar sozinha — precisa de alguém com acesso ao painel
   * para resetar. Existe nos dois bancos.
   */

  { tabela: 'usuarios', coluna: 'totp_secret', onde: 'ambos', oque: 'segredo do 2FA' },
];

/** As colunas que vivem no banco central (inclui as marcadas como 'ambos'). */
export function colunasCentral(): ColunaCifrada[] {
  return COLUNAS_CIFRADAS.filter(c => c.onde === 'central' || c.onde === 'ambos');
}

/** As colunas que vivem no banco de cada tenant. */
export function colunasTenant(): ColunaCifrada[] {
  return COLUNAS_CIFRADAS.filter(c => c.onde === 'tenant' || c.onde === 'ambos');
}
