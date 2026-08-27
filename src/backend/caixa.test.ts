import { describe, it, expect } from 'vitest';
import fsCaixa from 'fs';
import pathCaixa from 'path';
import {
  esperadoEmDinheiro, diferencaDeCaixa, classificarDiferenca, somarVendas, montarResumo,
  somarMovimentos, tempoAberto, sangriaCabeNoCaixa } from './caixa';

/**
 * Conferência de caixa é conta de dinheiro que alguém vai contar na mão e comparar.
 * Errar aqui não dá erro em log nenhum: dá "falta R$ 340 no caixa" e uma discussão
 * com o funcionário que não fez nada errado.
 */
describe('esperadoEmDinheiro', () => {
  it('abertura + vendas em dinheiro', () => {
    expect(esperadoEmDinheiro({
      aberturaCentavos: 10000, vendasDinheiroCentavos: 25000,
      suprimentosCentavos: 0, sangriasCentavos: 0,
    })).toBe(35000);
  });

  it('suprimento entra, sangria sai', () => {
    expect(esperadoEmDinheiro({
      aberturaCentavos: 10000, vendasDinheiroCentavos: 25000,
      suprimentosCentavos: 5000, sangriasCentavos: 20000,
    })).toBe(20000);
  });

  it('sangria maior que o saldo dá negativo (não silencia o erro de digitação)', () => {
    // Retirar mais do que existe é erro de lançamento; devolver 0 esconderia isso.
    expect(esperadoEmDinheiro({
      aberturaCentavos: 1000, vendasDinheiroCentavos: 0,
      suprimentosCentavos: 0, sangriasCentavos: 5000,
    })).toBe(-4000);
  });

  it('caixa sem movimento nenhum devolve a abertura', () => {
    expect(esperadoEmDinheiro({
      aberturaCentavos: 15000, vendasDinheiroCentavos: 0,
      suprimentosCentavos: 0, sangriasCentavos: 0,
    })).toBe(15000);
  });
});

describe('diferencaDeCaixa', () => {
  it('fechou exato', () => expect(diferencaDeCaixa(35000, 35000)).toBe(0));
  it('falta na gaveta é negativo', () => expect(diferencaDeCaixa(34000, 35000)).toBe(-1000));
  it('sobra é positivo', () => expect(diferencaDeCaixa(36000, 35000)).toBe(1000));
});

describe('classificarDiferenca', () => {
  it('quebra de centavos é "ok" — senão toda conferência viraria alarme e ninguém olharia', () => {
    expect(classificarDiferenca(0)).toBe('ok');
    expect(classificarDiferenca(150)).toBe('ok');
    expect(classificarDiferenca(-200)).toBe('ok');
  });
  it('acima da tolerância aponta falta ou sobra', () => {
    expect(classificarDiferenca(-201)).toBe('falta');
    expect(classificarDiferenca(5000)).toBe('sobra');
  });
  it('tolerância configurável', () => {
    expect(classificarDiferenca(-500, 1000)).toBe('ok');
    expect(classificarDiferenca(-1001, 1000)).toBe('falta');
  });
});

describe('somarVendas', () => {
  it('separa por forma; cartao_entrega é como o PDV grava cartão', () => {
    const r = somarVendas([
      { forma_pagamento: 'dinheiro', total_centavos: 1000 },
      { forma_pagamento: 'dinheiro', total_centavos: 2500 },
      { forma_pagamento: 'pix', total_centavos: 4000 },
      { forma_pagamento: 'cartao_entrega', total_centavos: 7000 },
    ]);
    expect(r.dinheiro_centavos).toBe(3500);
    expect(r.pix_centavos).toBe(4000);
    expect(r.cartao_centavos).toBe(7000);
    expect(r.quantidade).toBe(4);
  });

  it('forma desconhecida vai pra cartão em vez de sumir da soma', () => {
    // Perder a venda da soma seria pior: o total do turno ficaria menor que o real.
    const r = somarVendas([{ forma_pagamento: 'voucher_qualquer', total_centavos: 900 }]);
    expect(r.cartao_centavos).toBe(900);
  });

  it('sem vendas, tudo zero', () => {
    const r = somarVendas([]);
    expect(r).toEqual({ dinheiro_centavos: 0, cartao_centavos: 0, pix_centavos: 0, quantidade: 0 });
  });
});

describe('montarResumo — a regra central', () => {
  const vendas = somarVendas([
    { forma_pagamento: 'dinheiro', total_centavos: 30000 },
    { forma_pagamento: 'pix', total_centavos: 50000 },
    { forma_pagamento: 'cartao_entrega', total_centavos: 80000 },
  ]);

  it('CARTÃO E PIX NÃO ENTRAM NO ESPERADO — eles caem no banco, não na gaveta', () => {
    const r = montarResumo({
      aberturaCentavos: 10000, vendas, suprimentosCentavos: 0, sangriasCentavos: 0,
    });
    // Esperado = 10000 + 30000 (só dinheiro). Se somasse tudo, daria 170000 e a
    // conferência fecharia errada em R$ 1.300 todo dia.
    expect(r.esperado_centavos).toBe(40000);
    expect(r.cartao_centavos).toBe(80000);
    expect(r.pix_centavos).toBe(50000);
  });

  it('sangria do meio do turno reduz o esperado', () => {
    const r = montarResumo({
      aberturaCentavos: 10000, vendas, suprimentosCentavos: 0, sangriasCentavos: 25000,
    });
    expect(r.esperado_centavos).toBe(15000);
  });
});

describe('somarMovimentos — cancelado não conta', () => {
  it('ignora o movimento cancelado', () => {
    const r = somarMovimentos([
      { tipo: 'sangria', valor_centavos: 100000, cancelado_em: '2026-08-05T12:00:00Z' },
      { tipo: 'sangria', valor_centavos: 10000, cancelado_em: '' },
      { tipo: 'suprimento', valor_centavos: 5000 },
    ]);
    // Sem ignorar o cancelado, "desfazer" não desfaria nada e o esperado
    // continuaria errado — o problema que o cancelamento existe pra resolver.
    expect(r.sangrias_centavos).toBe(10000);
    expect(r.suprimentos_centavos).toBe(5000);
  });

  it('trata null e ausente como NÃO cancelado', () => {
    const r = somarMovimentos([
      { tipo: 'sangria', valor_centavos: 1000, cancelado_em: null },
      { tipo: 'sangria', valor_centavos: 2000 },
    ]);
    expect(r.sangrias_centavos).toBe(3000);
  });

  it('tudo cancelado zera', () => {
    const r = somarMovimentos([
      { tipo: 'sangria', valor_centavos: 9999, cancelado_em: 'x' },
      { tipo: 'suprimento', valor_centavos: 8888, cancelado_em: 'x' },
    ]);
    expect(r).toEqual({ sangrias_centavos: 0, suprimentos_centavos: 0 });
  });
});

describe('tempoAberto — caixa esquecido', () => {
  const abriu = '2026-08-05T11:00:00Z';
  it('turno normal não alerta', () => {
    expect(tempoAberto(abriu, new Date('2026-08-05T19:00:00Z'))).toEqual({ horas: 8, alerta: false });
  });
  it('13h ainda não alerta (turno longo de restaurante)', () => {
    expect(tempoAberto(abriu, new Date('2026-08-06T00:00:00Z')).alerta).toBe(false);
  });
  it('14h alerta', () => {
    expect(tempoAberto(abriu, new Date('2026-08-06T01:00:00Z')).alerta).toBe(true);
  });
  it('esquecido por dois dias mostra as horas acumuladas', () => {
    const r = tempoAberto(abriu, new Date('2026-08-07T11:00:00Z'));
    expect(r.horas).toBe(48);
    expect(r.alerta).toBe(true);
  });
  it('relógio atrasado não devolve horas negativas', () => {
    expect(tempoAberto(abriu, new Date('2026-08-05T10:00:00Z')).horas).toBe(0);
  });
});

/*
 * SANGRIA MAIOR QUE A GAVETA É ERRO DE DIGITAÇÃO — tipicamente um zero a mais.
 *
 * Recusar no lançamento é o que separa "pega o dedo errado agora" de "falta de
 * R$ 900 no fechamento, horas depois, com o turno inteiro de movimentação no
 * meio pra atrapalhar a reconstituição".
 */
describe('sangriaCabeNoCaixa', () => {
  it('recusa acima do que existe', () => {
    expect(sangriaCabeNoCaixa(100_000, 10_000)).toBe(false);
  });

  it('aceita abaixo', () => {
    expect(sangriaCabeNoCaixa(5_000, 10_000)).toBe(true);
  });

  /* Esvaziar a gaveta é operação legítima de fim de turno. */
  it('aceita exatamente o total', () => {
    expect(sangriaCabeNoCaixa(10_000, 10_000)).toBe(true);
  });

  /* Gaveta vazia (ou negativa, se a conferência já estava estranha) não
     comporta retirada nenhuma. */
  it('gaveta vazia não comporta sangria', () => {
    expect(sangriaCabeNoCaixa(1, 0)).toBe(false);
    expect(sangriaCabeNoCaixa(1, -500)).toBe(false);
  });

  /* O esperado JÁ desconta as sangrias anteriores (`esperadoEmDinheiro`), então
     duas retiradas seguidas não conseguem furar o total somadas — que é o
     caminho pelo qual uma checagem ingênua vazaria. */
  it('a segunda sangria enxerga a primeira', () => {
    const esperadoDepois = esperadoEmDinheiro({
      aberturaCentavos: 10_000, vendasDinheiroCentavos: 0,
      suprimentosCentavos: 0, sangriasCentavos: 8_000,
    });
    expect(esperadoDepois).toBe(2_000);
    expect(sangriaCabeNoCaixa(5_000, esperadoDepois)).toBe(false);
    expect(sangriaCabeNoCaixa(2_000, esperadoDepois)).toBe(true);
  });
});

describe('a rota de movimento aplica o limite', () => {
  const lojista = fsCaixa.readFileSync(
    pathCaixa.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const rota = lojista.slice(
    lojista.indexOf("router.post('/caixa/movimento'"),
    lojista.indexOf("router.post('/caixa/movimento/:id/cancelar'"));

  it('checa antes de gravar', () => {
    const checa = rota.indexOf('sangriaCabeNoCaixa');
    const grava = rota.indexOf('INSERT INTO caixa_movimentos');
    expect(checa).toBeGreaterThan(-1);
    expect(checa).toBeLessThan(grava);
  });
});
