import { describe, it, expect } from 'vitest';
import { resolverCanais, vendeEmAlgumCanal } from './disponibilidade-produto';

describe('resolverCanais — produto novo', () => {
  it('nasce à venda nos dois canais quando o corpo não diz nada', () => {
    expect(resolverCanais({})).toEqual({ cardapio: 1, pdv: 1 });
  });

  it('PDV HERDA o cardápio quando só o cardápio foi informado', () => {
    // Cadastrar um item já pausado e ele aparecer vendendo no balcão seria uma
    // venda que ninguém autorizou.
    expect(resolverCanais({ disponivel: false })).toEqual({ cardapio: 0, pdv: 0 });
  });

  it('respeita os dois quando os dois vêm no corpo', () => {
    expect(resolverCanais({ disponivel: false, disponivel_pdv: true }))
      .toEqual({ cardapio: 0, pdv: 1 });
  });
});

describe('resolverCanais — edição', () => {
  const atual = { disponivel: 1, disponivel_pdv: 0 };

  it('não mexe no canal que a requisição não citou', () => {
    // O PUT parcial do interruptor rápido manda um campo só; o outro canal tem
    // que ficar exatamente como estava.
    expect(resolverCanais({ disponivel: false }, atual)).toEqual({ cardapio: 0, pdv: 0 });
    expect(resolverCanais({ disponivel_pdv: true }, atual)).toEqual({ cardapio: 1, pdv: 1 });
  });

  it('mantém tudo quando o corpo não traz nenhum dos dois', () => {
    expect(resolverCanais({}, atual)).toEqual({ cardapio: 1, pdv: 0 });
  });

  it('trata 0 gravado como desligado, não como ausente', () => {
    // `0` é falsy: um `??` no lugar do `!== undefined` faria o produto pausado
    // voltar a vender sozinho na primeira edição de nome.
    expect(resolverCanais({}, { disponivel: 0, disponivel_pdv: 0 }))
      .toEqual({ cardapio: 0, pdv: 0 });
  });

  it('herda do banco mesmo com o outro campo vindo no corpo', () => {
    expect(resolverCanais({ disponivel: true }, { disponivel: 0, disponivel_pdv: 0 }))
      .toEqual({ cardapio: 1, pdv: 0 });
  });
});

describe('vendeEmAlgumCanal', () => {
  it('só é falso com os dois desligados', () => {
    expect(vendeEmAlgumCanal({ cardapio: 0, pdv: 0 })).toBe(false);
    expect(vendeEmAlgumCanal({ cardapio: 1, pdv: 0 })).toBe(true);
    expect(vendeEmAlgumCanal({ cardapio: 0, pdv: 1 })).toBe(true);
    expect(vendeEmAlgumCanal({ cardapio: 1, pdv: 1 })).toBe(true);
  });
});
