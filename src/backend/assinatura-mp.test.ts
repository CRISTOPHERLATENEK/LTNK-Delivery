/**
 * O formato do manifest do webhook do Mercado Pago, travado por vetor fixo.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Hoje a validação está desligada (sem segredo,
 * tudo passa), e isso é seguro porque o status é sempre reconsultado na API do
 * MP. O perigo está em LIGAR: com o segredo configurado, um manifest errado
 * rejeita TODAS as notificações legítimas, e pedido pago deixa de ser
 * confirmado — em silêncio, num warn que ninguém lê.
 *
 * O hash abaixo é literal de propósito. Se o teste recalculasse o HMAC com o
 * mesmo código que está sendo testado, ele passaria com qualquer manifest,
 * inclusive um errado — provaria só que a função é consistente consigo mesma.
 * Com o valor fixo, mudar a ordem dos campos, o separador, o `;` final ou o
 * lowercase quebra o teste.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { montarManifest, lerCabecalhoAssinatura, conferirAssinatura } from './assinatura-mp';
import { escolherSegredoWebhook, exigeSegredoWebhook } from './rotas/pagamentos';

const SEGREDO = 'segredo-de-teste';
// HMAC-SHA256 de 'id:123456789;request-id:abc-123;ts:1704908010;' com SEGREDO.
const HASH_BOM = '1621445cc5e0b5e7f88c172d2f1e9ad88fc91fc4bc91c5527b4b024e0950fcd7';
const TS = '1704908010';
const REQ_ID = 'abc-123';
const DATA_ID = '123456789';
const CABECALHO_BOM = `ts=${TS},v1=${HASH_BOM}`;

describe('montarManifest — o formato que o MP assina', () => {
  it('segue o template documentado, com o ponto-e-vírgula final', () => {
    expect(montarManifest(DATA_ID, REQ_ID, TS)).toBe('id:123456789;request-id:abc-123;ts:1704908010;');
  });

  it('minusculiza o data.id (o MP documenta assim para id alfanumérico)', () => {
    expect(montarManifest('ABC-DEF', 'req-9', '1700000000')).toBe('id:abc-def;request-id:req-9;ts:1700000000;');
  });
});

describe('lerCabecalhoAssinatura', () => {
  it('separa ts e v1', () => {
    expect(lerCabecalhoAssinatura(CABECALHO_BOM)).toEqual({ ts: TS, v1: HASH_BOM });
  });

  it('aceita espaço em volta da vírgula (o MP já mandou dos dois jeitos)', () => {
    expect(lerCabecalhoAssinatura(`ts=${TS} , v1=${HASH_BOM}`)).toEqual({ ts: TS, v1: HASH_BOM });
  });

  it('não corta no primeiro = : valor com = dentro chega inteiro', () => {
    // Hex não tem '=', mas base64 termina com '='. Se o MP mudar o formato,
    // split('=') truncaria o valor e a assinatura falharia sem motivo visível.
    expect(lerCabecalhoAssinatura('ts=1,v1=abc==')?.v1).toBe('abc==');
  });

  it('sem v1 não dá parte nenhuma', () => {
    expect(lerCabecalhoAssinatura('ts=1704908010')).toBeNull();
  });
});

describe('conferirAssinatura', () => {
  const base = { cabecalho: CABECALHO_BOM, requestId: REQ_ID, dataId: DATA_ID, secret: SEGREDO };

  /*
   * ESTE É O TESTE QUE IMPORTA. Ele prova que uma notificação LEGÍTIMA passa
   * quando o segredo está configurado — que é exatamente o que para de
   * funcionar se o manifest estiver errado, e o que faria o pagamento deixar
   * de ser confirmado no dia em que o segredo entrasse no .env.
   */
  it('assinatura legítima passa', () => {
    expect(conferirAssinatura(base)).toEqual({ valida: true });
  });

  it('hash trocado é recusado, e o motivo diz que não bate', () => {
    const ruim = { ...base, cabecalho: `ts=${TS},v1=${'0'.repeat(64)}` };
    expect(conferirAssinatura(ruim)).toEqual({ valida: false, motivo: 'hash-diferente' });
  });

  it('ts diferente muda o manifest e derruba a assinatura (protege contra replay)', () => {
    expect(conferirAssinatura({ ...base, cabecalho: `ts=9999999999,v1=${HASH_BOM}` }).valida).toBe(false);
  });

  it('outro data.id não passa com a assinatura de um pagamento diferente', () => {
    expect(conferirAssinatura({ ...base, dataId: '987654321' }).valida).toBe(false);
  });

  it('hash de tamanho diferente não explode no timingSafeEqual', () => {
    expect(conferirAssinatura({ ...base, cabecalho: 'ts=1,v1=curto' })).toEqual({
      valida: false, motivo: 'hash-diferente',
    });
  });

  /* Os motivos separados existem pro log: "não veio" e "não bate" levam a
     lugares diferentes na hora de investigar. */
  it('distingue cabeçalho ausente de request-id ausente', () => {
    expect(conferirAssinatura({ ...base, cabecalho: undefined }).motivo).toBe('sem-cabecalho');
    expect(conferirAssinatura({ ...base, requestId: undefined }).motivo).toBe('sem-request-id');
    expect(conferirAssinatura({ ...base, cabecalho: 'lixo' }).motivo).toBe('cabecalho-malformado');
  });

  /*
   * Sem segredo aceita — é o comportamento de hoje, e está documentado como
   * decisão: a proteção real é a reconsulta do status na API do MP. Este teste
   * existe pra que ligar ou desligar isso seja uma mudança CONSCIENTE, com um
   * teste vermelho pedindo confirmação, e não um efeito colateral.
   */
  it('sem segredo configurado, aceita — e diz por quê', () => {
    expect(conferirAssinatura({ ...base, secret: null })).toEqual({
      valida: true, motivo: 'sem-segredo',
    });
  });
});

/**
 * QUAL SEGREDO VALE PRA CADA LOJA.
 *
 * Este é o teste que torna seguro colar MERCADOPAGO_WEBHOOK_SECRET no .env.
 * Antes, a reserva do .env valia pra qualquer loja sem segredo próprio — e o MP
 * assina por APLICAÇÃO, então a notificação de um lojista com conta própria
 * jamais bateria com o segredo da plataforma. Ligar o .env recusava 100% das
 * notificações legítimas dessas lojas, e o pedido pago delas parava de ser
 * confirmado.
 */
describe('escolherSegredoWebhook — de quem é o segredo', () => {
  it('loja com segredo próprio usa o dela, mesmo havendo o do .env', () => {
    expect(escolherSegredoWebhook(
      { segredoProprio: 'da-loja', temContaPropria: true }, 'do-env')).toBe('da-loja');
  });

  /* O caso que era o bug. */
  it('conta própria SEM segredo próprio NÃO cai no .env — devolve null (aceita)', () => {
    expect(escolherSegredoWebhook(
      { segredoProprio: null, temContaPropria: true }, 'do-env')).toBeNull();
  });

  it('loja na conta da plataforma usa o segredo do .env', () => {
    expect(escolherSegredoWebhook(
      { segredoProprio: null, temContaPropria: false }, 'do-env')).toBe('do-env');
  });

  it('sem loja identificada, vale o do .env (conta da plataforma)', () => {
    expect(escolherSegredoWebhook(null, 'do-env')).toBe('do-env');
  });

  it('sem nada configurado, null — o comportamento de hoje', () => {
    expect(escolherSegredoWebhook({ segredoProprio: null, temContaPropria: false }, null)).toBeNull();
  });

  /*
   * O elo com a validação: null significa "sem segredo", e por PADRÃO
   * `conferirAssinatura` ACEITA nesse caso.
   *
   * Este comentário dizia que virar recusa seria a mudança que derruba a
   * confirmação de pagamento das lojas com conta própria. Metade certo: virar
   * recusa INCONDICIONAL derrubaria. Recusar só onde é seguro — loja em
   * produção, que tem o segredo à mão — não derruba nada, porque a
   * reconciliação de 5 min confirma o pedido de todo jeito. Quem decide isso
   * agora é `exigeSegredoWebhook`, testada abaixo; aqui fica registrado o
   * padrão, que continua sendo aceitar.
   */
  it('null significa aceitar, quando não se exige', () => {
    const secret = escolherSegredoWebhook({ segredoProprio: null, temContaPropria: true }, 'do-env');
    expect(conferirAssinatura({ cabecalho: undefined, requestId: undefined, dataId: '1', secret }))
      .toEqual({ valida: true, motivo: 'sem-segredo' });
  });
});

/*
 * TODA LOJA NOVA NASCIA ACEITANDO WEBHOOK SEM CONFERÊNCIA.
 *
 * O campo da assinatura vem vazio, e vazio significava "aceita". Com um cliente
 * isso passa; ao vender, cada loja nova entra assim e nada na tela chama a
 * ausência de problema. Estes testes fixam ONDE passou a exigir — e, o que
 * importa igual, onde continua NÃO exigindo, porque exigir no lugar errado
 * recusa notificação legítima e o pedido pago deixa de confirmar na hora.
 */
describe('exigeSegredoWebhook — onde a assinatura passou a ser obrigatória', () => {
  it('produção com conta própria e sem segredo: EXIGE', () => {
    expect(exigeSegredoWebhook({
      temSegredoProprio: false, temContaPropria: true, modo: 'producao',
    })).toBe(true);
  });

  /* A coluna tem 'producao' por padrão, mas nulo/lixo não pode virar "não exige"
     — seria um jeito silencioso de escapar da regra. */
  it('modo nulo conta como produção', () => {
    expect(exigeSegredoWebhook({ temSegredoProprio: false, temContaPropria: true, modo: null })).toBe(true);
  });

  it('teste não exige — travaria a homologação', () => {
    expect(exigeSegredoWebhook({
      temSegredoProprio: false, temContaPropria: true, modo: 'teste',
    })).toBe(false);
  });

  /*
   * Conta da plataforma NÃO exige. Se exigisse, um `.env` sem
   * MERCADOPAGO_WEBHOOK_SECRET passaria a recusar as notificações de TODAS as
   * lojas de uma vez — endurecer assim é derrubar, não proteger.
   */
  it('conta da plataforma não exige', () => {
    expect(exigeSegredoWebhook({
      temSegredoProprio: false, temContaPropria: false, modo: 'producao',
    })).toBe(false);
  });

  it('quem já tem segredo não tem o que exigir', () => {
    expect(exigeSegredoWebhook({
      temSegredoProprio: true, temContaPropria: true, modo: 'producao',
    })).toBe(false);
  });
});

describe('conferirAssinatura com segredo exigido', () => {
  it('sem segredo e exigindo: RECUSA, com motivo próprio', () => {
    expect(conferirAssinatura({
      cabecalho: CABECALHO_BOM, requestId: REQ_ID, dataId: DATA_ID,
      secret: null, exigirSegredo: true,
    })).toEqual({ valida: false, motivo: 'sem-segredo-exigido' });
  });

  /*
   * O motivo é separado de 'sem-segredo' de propósito: às duas da manhã, "aceitei
   * porque não havia segredo" e "recusei porque exigia" levam a lugares opostos.
   */
  it('o motivo distingue aceitar de recusar', () => {
    const aceito = conferirAssinatura({ cabecalho: undefined, requestId: undefined, dataId: '1', secret: null });
    const recusado = conferirAssinatura({ cabecalho: undefined, requestId: undefined, dataId: '1', secret: null, exigirSegredo: true });
    expect(aceito.motivo).toBe('sem-segredo');
    expect(recusado.motivo).toBe('sem-segredo-exigido');
  });

  /*
   * E O CAMINHO BOM CONTINUA BOM. Sem esta linha, `exigirSegredo` poderia estar
   * recusando tudo — inclusive a notificação legítima da loja que colou o
   * segredo — e os testes acima passariam iguais.
   */
  it('exigir não quebra a assinatura legítima', () => {
    expect(conferirAssinatura({
      cabecalho: CABECALHO_BOM, requestId: REQ_ID, dataId: DATA_ID,
      secret: SEGREDO, exigirSegredo: true,
    })).toEqual({ valida: true });
  });
});

/* A regra só vale se a ROTA passar o `exigirSegredo`. Sem isto, tudo acima
   passaria com a rota chamando a conferência como antes. */
describe('a rota do webhook usa a exigência', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'pagamentos.ts'), 'utf8');
  const rota = fonte.slice(fonte.indexOf("router.post('/webhook/mercadopago'"));

  it('a rota do MP passa exigirSegredo para a conferência', () => {
    expect(rota).toMatch(/const \{ secret, exigir \} = await segredoWebhookDaLoja\(lojaDica\)/);
    expect(rota).toMatch(/exigirSegredo: exigir/);
  });
});

/* E a tela precisa dizer o que acontece enquanto falta — senão o lojista não
   vai buscar o segredo, e a regra nova só produz atraso sem explicação. */
describe('a tela do lojista avisa que falta a assinatura', () => {
  const tela = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'loja-config.tsx'), 'utf8');

  it('o aviso é condicionado a produção E ausência do segredo', () => {
    expect(tela).toMatch(
      /estado\.modo === 'producao' && estado\.cartao_online_ativo && !estado\.webhook_secret_configurado/);
  });

  it('o aviso diz o que acontece, não só que falta', () => {
    expect(tela).toContain('são recusadas');
    expect(tela).toMatch(/5 minutos/);
  });
});
