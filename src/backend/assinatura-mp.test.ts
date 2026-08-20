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
import { montarManifest, lerCabecalhoAssinatura, conferirAssinatura } from './assinatura-mp';

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
