import { describe, it, expect } from 'vitest';
import { categoriaPorNome, normalizarNome, REGRAS, ORDEM_SUGERIDA } from './categoria-por-nome';

/*
 * CATEGORIA PELO NOME DO PRODUTO.
 *
 * Todo nome citado aqui é REAL: saiu do cadastro da Galderio Bebidas, onde a
 * importação do Maxx Gestão colocou 1.225 produtos e os 1.225 caíram em
 * "Geral" — o ERP daquela empresa não tem grupo nem subgrupo cadastrado.
 *
 * Os testes de ORDEM são o coração do arquivo. Cada um deles corresponde a um
 * erro que a regra cometeu de verdade contra o cadastro e que eu vi na
 * conferência, não a um caso hipotético.
 */

describe('normalizar o nome', () => {
  it('tira acento, porque o cadastro escreve dos dois jeitos', () => {
    /* "ESSÊNCIA" e "ESSENCIA" convivem no mesmo campo do mesmo ERP. */
    expect(normalizarNome('ESSÊNCIA ADALYA')).toBe(normalizarNome('ESSENCIA ADALYA'));
  });

  it('sobe para maiúscula, porque o cadastro escreve dos dois jeitos', () => {
    expect(categoriaPorNome('pizza lombo')).toBe('Lámen e comida rápida');
    expect(categoriaPorNome('PICOLÉ DE brownie')).toBe('Sorvetes e açaí');
  });

  /* Cercar de espaço é o que faz ` COCA ` casar a palavra na primeira e na
     última posição sem precisar de `\b` — que em nome acentuado é imprevisível. */
  it('cerca de espaço para a palavra casar em qualquer posição', () => {
    expect(normalizarNome('COCA COLA 2L').startsWith(' ')).toBe(true);
    expect(normalizarNome('COCA COLA 2L').endsWith(' ')).toBe(true);
    expect(categoriaPorNome('GUARANA 200ML')).toBe('Refrigerantes');
    expect(categoriaPorNome('KUAT GUARANÁ 600ml')).toBe('Refrigerantes');
  });

  it('pontuação e o "&" viram separador, não juntam palavras', () => {
    expect(normalizarNome('AMACIANTE SOL COCO & BAUNILHA 500ML'))
      .toBe(' AMACIANTE SOL COCO BAUNILHA 500ML ');
  });
});

describe('o que a ordem das regras resolve', () => {
  /* "SHAMPOO SEDA" casava ` SEDA ` e ia para a tabacaria. É por causa dele que
     higiene subiu para o segundo lugar da lista. */
  it('shampoo Seda é shampoo, não seda de enrolar', () => {
    expect(categoriaPorNome('SHAMPOO SEDA')).toBe('Higiene e limpeza');
    expect(categoriaPorNome('SEDA SMOKING SUPREME')).toBe('Tabacaria');
  });

  /* "DESINFETANTE AQUA CHÁ BRANCO" casava ` CHA ` e virava chá para beber. */
  it('desinfetante com nome de chá é limpeza', () => {
    expect(categoriaPorNome('DESINFETANTE AQUA CHÁ BRANCO')).toBe('Higiene e limpeza');
  });

  /* O vape usa nome de sabor de sorvete e de ice ao mesmo tempo. */
  it('pod de vape não é sorvete nem ice', () => {
    expect(categoriaPorNome('POD ALFBAR AÇAI E BANANA ICE 30K')).toBe('Vape');
    expect(categoriaPorNome('POD DUAL FLAVOR ABACAXI ICE')).toBe('Vape');
    expect(categoriaPorNome('FLOWBAR SEM ZERO AÇUCAR')).toBe('Vape');
  });

  /* `CAIPI` como pedaço de palavra casava "GALINHA CAIPIRA" e mandava lámen
     para bebida. Foi trocado por palavra inteira. */
  it('galinha caipira é lámen, não caipirinha', () => {
    expect(categoriaPorNome('CUP NOODLES GALINHA CAIPIRA 69G UNIDADE')).toBe('Lámen e comida rápida');
    expect(categoriaPorNome('NISSIN LÁMEN GALINHA CAIPIRA 80G UNIDADE')).toBe('Lámen e comida rápida');
    expect(categoriaPorNome('BALY CAIPIRINHA DO BRASIL 2L UNIDADE')).toBe('Energéticos');
  });

  /* `ORIGINAL` sozinho é adjetivo antes de ser marca de cerveja. */
  it('"original" só é cerveja quando vem com a embalagem', () => {
    expect(categoriaPorNome('BIS ORIGINAL 100G')).toBe('Doces e chocolates');
    expect(categoriaPorNome('BATATA STAX ORIGINAL')).toBe('Salgadinhos');
    expect(categoriaPorNome('ORIGINAL CAIXA')).toBe('Cervejas');
    expect(categoriaPorNome('ORIGINAL UNIDADE')).toBe('Cervejas');
  });

  /* `PALHA` sozinho levava batata palha para a tabacaria. */
  it('batata palha é salgadinho; fumo de palha é tabacaria', () => {
    expect(categoriaPorNome('BATATA PALHA 70G')).toBe('Salgadinhos');
    expect(categoriaPorNome('PALHA CAMPEÃO DO SUL')).toBe('Tabacaria');
  });

  /* Salgadinho com sabor de comida pronta ia para comida pronta. */
  it('pipoca sabor pizza é salgadinho', () => {
    expect(categoriaPorNome('PIPOCA SABOR PIZZA CALDO BOM')).toBe('Salgadinhos');
    expect(categoriaPorNome('TREEPS PIZZA 35G UNIDADE')).toBe('Salgadinhos');
    expect(categoriaPorNome('tekitos nuggets')).toBe('Salgadinhos');
    /* E o contrário: lámen com batata no nome continua lámen. É por isso que
       `BATATA` ficou na segunda regra de salgadinho, depois do lámen. */
    expect(categoriaPorNome('NISSIN CARNE COM BATATA')).toBe('Lámen e comida rápida');
  });

  /* Sorvete com vinho no nome existe, e vinho vem antes de sorvete na lista. */
  it('picolé com vinho é sorvete', () => {
    expect(categoriaPorNome('PICOLÉ ABACAXI COM VINHO')).toBe('Sorvetes e açaí');
    expect(categoriaPorNome('CAMPO LARGO BRANCO SUAVE')).toBe('Vinhos e espumantes');
  });

  /* Gelo de fruta para drink tem fruta e "drink" no nome. */
  it('gelo de fruta é gelo', () => {
    expect(categoriaPorNome('GELO DE MARACUJA DRINK')).toBe('Gelo');
    expect(categoriaPorNome('GELO MAÇÃ VERDE DRINK')).toBe('Gelo');
  });

  /* A mesma marca faz essência e faz seda. */
  it('marca que faz duas coisas é decidida pela palavra, não pela marca', () => {
    expect(categoriaPorNome('ESSENCIA ZOMO MANGA')).toBe('Essências para narguilé');
    expect(categoriaPorNome('SEDA ZOMO MANSÂO MAROMBA')).toBe('Tabacaria');
    expect(categoriaPorNome('KISLLA VDK TRADICIONAL')).toBe('Destilados');
    expect(categoriaPorNome('KISLLA ICE BLUE')).toBe('Ices e drinks');
  });

  /* Energético com sabor licenciado de bala. */
  it('Baly com nome de bala é energético', () => {
    expect(categoriaPorNome('BALY FREEGELLS CEREJA')).toBe('Energéticos');
    expect(categoriaPorNome('FREEGELLS CEREJA COM CHOCOLATE')).toBe('Doces e chocolates');
  });

  /* Água com sabor da marca é vendida junto do refrigerante; separá-la
     partiria a prateleira em duas. */
  it('a linha de água com sabor fica junto do refrigerante', () => {
    expect(categoriaPorNome('ÁGUA DA SERRA GUARANÁ 2L UNIDADE')).toBe('Refrigerantes');
    expect(categoriaPorNome('ÁGUA DA SERRA FRAMBOESA 2L UNIDADE')).toBe('Refrigerantes');
    expect(categoriaPorNome('AGUA CRISTAL SEM GAZ 500ML')).toBe('Águas');
    /* "SERRA AZUL 900ML" é água, e casava ` SERRA ` na regra de suco. */
    expect(categoriaPorNome('SERRA AZUL  900ML')).toBe('Águas');
  });

  /* A mesma marca em duas categorias parece defeito na tela. */
  it('a marca Max não se parte entre refrigerante e suco', () => {
    expect(categoriaPorNome('MAX GUARANÁ 2L  UNIDADE')).toBe('Refrigerantes');
    expect(categoriaPorNome('MAX LARANJA 2L UNIDADE')).toBe('Refrigerantes');
    expect(categoriaPorNome('MAX FRAMBOESA 2L UNIDADE')).toBe('Refrigerantes');
  });

  /* "OCB SLIM COM PITEIRA" é papel de enrolar, e ia para acessório de narguilé. */
  it('papel com piteira é tabacaria, não acessório de narguilé', () => {
    expect(categoriaPorNome('OCB SLIM COM PITEIRA')).toBe('Tabacaria');
    expect(categoriaPorNome('PAPELITO PITEIRA TRADICIONAL')).toBe('Tabacaria');
    expect(categoriaPorNome('CARVÃO CHACAL 500G')).toBe('Acessórios para narguilé');
  });

  /* Gel acendedor de 420g é de churrasqueira. */
  it('gel acendedor é utilidade, não tabacaria', () => {
    expect(categoriaPorNome('GEL ACENDEDOR 420G UNIDADE')).toBe('Utilidades');
  });

  /* Doce de balcão com açaí no nome ia para sorvete. */
  it('cocada com açaí é doce', () => {
    expect(categoriaPorNome('COCADA BANANA E AÇAI')).toBe('Doces e chocolates');
    expect(categoriaPorNome('AÇAÍ LEITINHO')).toBe('Sorvetes e açaí');
  });
});

describe('a marca Dip Loko, que eu categorizei errado', () => {
  /*
   * ERRO MEU, e vale registrar o raciocínio: eu vi "DIPLOKO MONSTER NEON 10G",
   * li 10 gramas e nome de sabor, e concluí essência de narguilé. Dip Loko é
   * marca de DOCE — pirulito com pó ácido. A linha inteira estava indo para
   * "Essências", dez produtos, e uma criança procurando bala não a acharia.
   *
   * O cadastro escreve o nome de três jeitos, e os três têm que funcionar.
   */
  it('as três grafias caem em doce', () => {
    expect(categoriaPorNome('DIPLOKO MONSTER NEON 10G')).toBe('Doces e chocolates');
    expect(categoriaPorNome('DIP LOKO DIPPER MINHOCAS MORANGO SOUR')).toBe('Doces e chocolates');
    expect(categoriaPorNome('DIPO LOKO ZOMBIE')).toBe('Doces e chocolates');
  });

  it('o resto da linha também', () => {
    expect(categoriaPorNome('APITO LOKO 15G')).toBe('Doces e chocolates');
    expect(categoriaPorNome('TREME TERRA PEQUENO')).toBe('Doces e chocolates');
  });
});

describe('o que NÃO é categorizado', () => {
  /*
   * VAZIO É RESPOSTA. Chutar seria pior: o produto ficaria numa categoria em
   * que ninguém procura, e a tela pareceria completa. São 19 produtos em 1.225
   * — e são os únicos que precisam da mão do lojista.
   */
  it('nome que não diz o que é volta vazio', () => {
    for (const n of ['CANDELA', 'ESPADA', 'MOEDA', 'SENAT', 'CONQUISTADOR', 'DIVERSOS', 'KONE']) {
      expect(categoriaPorNome(n)).toBe('');
    }
  });

  /*
   * E O AMBÍGUO TAMBÉM. `POTE` no cadastro é pote de sorvete ("POTE 2L
   * MORANGO") e é garrafa de bebida ("POTE DE JACK TRADICIONAL"). Com tamanho
   * ou com a palavra sorvete, é sorvete; com uma marca que eu não reconheço,
   * eu não sei — e não saber tem que aparecer.
   */
  it('pote com tamanho é sorvete; pote de marca desconhecida fica vazio', () => {
    expect(categoriaPorNome('POTE 2L MORANGO')).toBe('Sorvetes e açaí');
    expect(categoriaPorNome('POTE 1 LITRO NAPOLITANO')).toBe('Sorvetes e açaí');
    expect(categoriaPorNome('POTE DE SORVETE NAPOLITANO 600ml')).toBe('Sorvetes e açaí');
    expect(categoriaPorNome('POTE DE JACK TRADICIONAL')).toBe('Destilados');
    expect(categoriaPorNome('POTE DE CAVALINHO')).toBe('');
    expect(categoriaPorNome('POTE DE MANSAO')).toBe('');
  });

  it('nome vazio não vira categoria', () => {
    expect(categoriaPorNome('')).toBe('');
    expect(categoriaPorNome('   ')).toBe('');
  });
});

describe('erro de digitação do cadastro', () => {
  /*
   * Regra que só aceita a grafia certa não serve para cadastro escrito por
   * gente. Estes erros estão no ERP e vão continuar lá.
   */
  it('as grafias erradas que existem no cadastro são reconhecidas', () => {
    expect(categoriaPorNome('ANTARTICA UNIDADE')).toBe('Cervejas');
    expect(categoriaPorNome('MALBORO RED BOX')).toBe('Cigarros');
    expect(categoriaPorNome('CALTON AZUL')).toBe('Cigarros');
    expect(categoriaPorNome('SCHWEPPS TÔNICO LATA 350ML UNIDADE')).toBe('Refrigerantes');
    expect(categoriaPorNome('BAUDUCCO WALFER MORANGO 140G')).toBe('Doces e chocolates');
    expect(categoriaPorNome('SÚ FRESH LARANJA 1L')).toBe('Sucos e refrescos');
    expect(categoriaPorNome('SÓ FRESH UVA 1L')).toBe('Sucos e refrescos');
    expect(categoriaPorNome('PEPEL HIGIENICO PALOMA C/ 8')).toBe('Higiene e limpeza');
  });
});

describe('a ordem da vitrine', () => {
  /*
   * A alternativa é ordem alfabética, que abriria a loja com "Acessórios para
   * narguilé" e "Águas" na frente de "Cervejas".
   */
  it('bebida vem antes de limpeza e de utilidade', () => {
    const pos = (c: string) => ORDEM_SUGERIDA.indexOf(c);
    expect(pos('Cervejas')).toBeLessThan(pos('Mercearia'));
    expect(pos('Cervejas')).toBeLessThan(pos('Higiene e limpeza'));
    expect(pos('Higiene e limpeza')).toBeLessThan(pos('Utilidades'));
    expect(pos('Cervejas')).toBe(0);
  });

  /* Toda categoria que as regras produzem tem lugar na ordem — senão ela cai no
     fim junto do que não tem registro, e a faixa fica sem explicação. */
  it('toda categoria das regras está na ordem', () => {
    const produzidas = new Set(REGRAS.map(r => r.categoria));
    for (const c of produzidas) expect(ORDEM_SUGERIDA).toContain(c);
  });

  it('e a ordem não tem categoria que ninguém produz', () => {
    const produzidas = new Set(REGRAS.map(r => r.categoria));
    for (const c of ORDEM_SUGERIDA) expect(produzidas.has(c)).toBe(true);
  });

  it('sem repetição', () => {
    expect(new Set(ORDEM_SUGERIDA).size).toBe(ORDEM_SUGERIDA.length);
  });
});
