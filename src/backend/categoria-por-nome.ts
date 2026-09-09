/**
 * CATEGORIA A PARTIR DO NOME DO PRODUTO.
 *
 * Serve a um problema medido: a importação do Maxx Gestão trouxe 1.225 produtos
 * para a Galderio Bebidas e TODOS caíram em "Geral" — porque o ERP daquela
 * empresa não tem grupo nem subgrupo cadastrado, e a categoria do produto vem
 * de lá. Cardápio de 1.225 itens numa categoria só é pior de usar que um de 80
 * organizados: sem categoria não há navegação, e sem navegação a pessoa desiste
 * antes de achar a cerveja.
 *
 * A loja não é uma distribuidora de bebida, ao contrário do nome: é uma
 * CONVENIÊNCIA COM TABACARIA. O cadastro tem essência de narguilé, seda,
 * carvão, cigarro, pod de vape, picolé, lámen, amaciante e atum em conserva. As
 * categorias abaixo saíram do cadastro real, não de um palpite sobre o ramo.
 *
 * ORDEM IMPORTA, e é o coração disto. A primeira regra que casa ganha, então as
 * específicas vêm antes das genéricas. Casos reais que só saem certos por causa
 * da ordem, todos medidos contra o cadastro:
 *
 *   "SHAMPOO SEDA"               → limpeza, não tabacaria
 *   "PICOLÉ ABACAXI COM VINHO"   → sorvete, não vinho
 *   "GELO DE MARACUJA DRINK"     → gelo, não suco
 *   "DESINFETANTE AQUA CHÁ"      → limpeza, não chá
 *   "SEDA ZOMO"                  → tabacaria, não essência (Zomo faz as duas)
 *   "POD ALFBAR AÇAI BANANA ICE" → vape, não sorvete nem ice
 *   "PIPOCA SABOR PIZZA"         → salgadinho, não pizza
 *   "NISSIN CARNE COM BATATA"    → lámen, não salgadinho
 *
 * NÃO ADIVINHA. O que não casa com nenhuma regra volta VAZIO, e vazio é para
 * alguém olhar — nunca para cair num "Outros" que esconde o problema. Categoria
 * errada é pior que categoria nenhuma: o produto fica onde ninguém procura, e
 * ninguém descobre, porque a tela parece completa. Ficam de fora de propósito
 * nomes que não dizem o que são nem para quem conhece o ramo ("CANDELA",
 * "ESPADA", "MOEDA", "SENAT", "CONQUISTADOR", "DIVERSOS") e os que dizem coisas
 * demais ("POTE DE MANSÃO" pode ser sorvete ou bebida — quem sabe é o lojista).
 *
 * Isto NÃO substitui o grupo do ERP. Se a empresa cadastrar grupos lá, aquilo é
 * a fonte melhor — é a decisão de quem conhece o próprio estoque. Isto é para
 * quem não tem, que é o caso de hoje.
 */

/** Regra: a primeira que casa define a categoria. */
export interface RegraCategoria {
  categoria: string;
  quando: RegExp;
}

/**
 * NOME NORMALIZADO PARA CASAR REGRA.
 *
 * Sem acento (o cadastro mistura "ESSÊNCIA" e "ESSENCIA" no mesmo campo),
 * maiúsculo (mistura "pizza lombo" e "PICOLÉ"), tudo que não é letra ou dígito
 * vira espaço, e o resultado fica cercado de espaço — assim ` COCA ` casa a
 * palavra inteira em qualquer posição, inclusive na primeira e na última.
 *
 * O espaço nas pontas é o que torna as regras legíveis: elas usam ` PALAVRA ` e
 * não precisam de `\b`, que em nome com acento se comporta de um jeito difícil
 * de prever.
 */
export function normalizarNome(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ` ${semAcento.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
}

/**
 * AS REGRAS, da mais específica para a mais genérica.
 *
 * Cada bloco começa pelas MARCAS, que são o sinal mais confiável, e só depois
 * usa a palavra genérica.
 */
export const REGRAS: RegraCategoria[] = [
  /* ─── 1. vape ───
     Primeiro de todos porque "POD ALFBAR AÇAI E BANANA ICE 30K" tem AÇAI e ICE
     no nome: sem isto, um cigarro eletrônico entra em "Sorvetes" ou em "Ices". */
  { categoria: 'Vape', quando: / (POD|ALFBAR|ELFBAR|FLOWBAR|IGNITE|VAPE|PUFF|VAPORIZADOR) / },

  /* ─── 2. higiene e limpeza ───
     TÃO NO ALTO POR DOIS CASOS REAIS. "SHAMPOO SEDA" casava ` SEDA ` e virava
     tabacaria; "DESINFETANTE AQUA CHÁ BRANCO" casava ` CHA ` e virava chá.
     Produto de limpeza usa nome de comida e marca de outra coisa, então ele tem
     que ser reconhecido antes, não depois. */
  { categoria: 'Higiene e limpeza', quando: / (SABONETE|SABAO|DETERGENTE|AMACIANTE|DESINFETANTE|INSETICIDA|REPELENTE|CONDICIONADOR|SHAMPOO|DESODORANTE|TALCO|GILETE|GILLETTE|PRESTOBARBA|ESCOVA|HIGIENICO|ABSORVENTE|FRALDA|PRESERVATIVO|CAMISINHA|UMEDECIDAS|SANITARIA|CLORO|ALCOOL) / },
  { categoria: 'Higiene e limpeza', quando: / (PRESTO BARBA|CREME DENTAL) / },

  /* ─── 3. tabacaria: papel, fumo e o que acende ───
     SUBIU PARA CÁ por um erro medido: "SEDA ZOMO MANSÂO MAROMBA" caía em
     essência, porque a marca Zomo era testada antes da palavra SEDA. Zomo faz
     as duas coisas, e quem decide o que o produto é não é a marca — é a
     palavra. O comentário antigo afirmava que este caso funcionava; não
     funcionava, e foi o teste que mostrou.
     Depois de essência (por "SEDA ZOMO") e depois de cigarro (por "GUDAN", que
     é tabaco solto da mesma marca do cigarro).

     `TREEPS` estava aqui e saiu: é salgadinho ("TREEPS CHURRASCO 35G"). Eu o
     havia juntado a "tips" por semelhança sonora — o tipo de palpite que este
     arquivo não deve ter. `PALHA` também saiu sozinho: levava "BATATA PALHA
     70G" para a tabacaria, e agora só vale com a marca do fumo. */
  { categoria: 'Tabacaria', quando: / (SEDA|PAPELITO|OCB|SMOKING|BOLADO|BOLADOR|ISQUEIRO|CINZEIRO|TABACO|FUMO|PAIERO|GUDAN|BLUNT|FILTER|FILTERS|FILTRO|TIPS|PITEIRA|DICHAVADOR|SADHU) / },
  { categoria: 'Tabacaria', quando: / PALHA (CAMPEAO|DO SUL) / },

  /* ─── 4. essência de narguilé ───
     O maior grupo de "não é bebida" do cadastro. As marcas usam nome de sabor
     de bala e de bebida ("ADALYA ICE BOM BOM", "SMYRNA VOVÓ DISSE BLUEBERRY
     MUIFFIN"), então precisam ser reconhecidas ANTES de doce e de ice.

     `DIPLOKO` NÃO está aqui, e isso foi um erro meu na primeira versão: eu li
     "DIPLOKO MONSTER NEON 10G" como essência pelos 10g e pelo nome de sabor.
     Dip Loko é marca de DOCE (pirulito com pó) — a linha inteira ("BOOM LIKE",
     "DIPPER MINHOCAS", "SURPRISE PET", "UNICÓRNIO NEON") é bala, e dez produtos
     estavam indo para a categoria errada. */
  { categoria: 'Essências para narguilé', quando: / (ESSENCIA|ZOMO|ZGY|ADALYA|ONIXX|SMYRNA|VOLKER|MALTYNX|NABATIDA|HOOKAIN|NARGUILE|MELACO) / },
  { categoria: 'Essências para narguilé', quando: / (MISTER HEMP|JUICE) / },

  /* ─── 5. o aparelho do narguilé ───
     `PITEIRA` mora na tabacaria, não aqui: "OCB SLIM COM PITEIRA" e "PAPELITO
     PITEIRA TRADICIONAL" são papel de enrolar com filtro, e vinham para cá.
     `VASO` e `PRATO` ficaram fora de propósito — são palavras de utilidade
     doméstica, e o ganho não paga o risco. */
  { categoria: 'Acessórios para narguilé', quando: / (BONG|ROSH|MANGUEIRA|CARVAO|PANELINHA|ABAFADOR|FORNILHO|ALUMINIO) / },

  /* ─── 6. cigarro ───
     A marca é o ÚNICO sinal: "RED GOLD BLEND", "BLACK MENTHOL" e "L&M RED BOX"
     não têm a palavra cigarro em lugar nenhum. `MALBORO` e `CALTO`/`CALTON`
     entram com o erro de digitação que está no cadastro — regra que só aceita a
     grafia certa não serve para cadastro escrito por gente. */
  { categoria: 'Cigarros', quando: / (CAMEL|CHESTERFIELD|KENT|ROTHMANS|WINSTON|MARLBORO|MALBORO|LUCKY|DUNHILL|SAMPOERNA|CARLTON|CALTON|CALTO|DERBY|DERBI|KRETEK|MENTHOL|CAPSULE|CIGARRO|MACO) / },
  { categoria: 'Cigarros', quando: / (L M|L A|GOLD BLEND) / },

  /* ─── 7. gelo ───
     Antes de suco e de destilado: "GELO DE MARACUJA DRINK" e "GELO MAÇÃ VERDE
     DRINK" são gelo de fruta para drink, e a fruta no nome os levaria a suco. */
  { categoria: 'Gelo', quando: / GELO / },

  /* ─── Dip Loko, antes do energético ───
     "DIPLOKO MONSTER NEON 10G" caía em "Energéticos" pela palavra MONSTER. É
     bala com nome de energético, e a marca resolve — desde que seja testada
     antes. */
  { categoria: 'Doces e chocolates', quando: / (DIPLOKO|DIP LOKO|DIPO LOKO|APITO LOKO|TREME TERRA) / },

  /* ─── 8. energético ─── */
  { categoria: 'Energéticos', quando: / (BALY|MONSTER|RED BULL|RED HORSE|TNT|FUSION|ENERGETICO|ENERGY) / },

  /* ─── 9. ice e drink pronto ───
     `CAIPI` saiu daqui: casava "CUP NOODLES GALINHA CAIPIRA" e "NISSIN LÁMEN
     GALINHA CAIPIRA", mandando lámen para bebida. Pedaço de palavra é
     armadilha — a regra só aceita palavra inteira. */
  { categoria: 'Ices e drinks', quando: / (ICE|BEATS|CAIPIRINHA|DRINK) / },

  /* ─── 10. sorvete de haste, antes de vinho ───
     "PICOLÉ ABACAXI COM VINHO" existe. O resto do sorvete (pote, açaí) fica
     mais abaixo, porque `POTE` só pode ganhar depois das marcas de destilado. */
  { categoria: 'Sorvetes e açaí', quando: / (PICOLE|SORVETE|CASQUINHA|SUNDAE) / },

  /* ─── 11. vinho e espumante ─── */
  { categoria: 'Vinhos e espumantes', quando: / (VINHO|ESPUMANTE|PROSECCO|CHARDONNAY|CARMENERE|CABERNET|MERLOT|MALBEC|TANNAT|SAUVIGNON|FREIXENET|CHANDON|RANDON|RESERVADO|PERGOLA|SIDRA) / },
  { categoria: 'Vinhos e espumantes', quando: / (CAMPO LARGO|SANGUE DE BOI|VIM DO SUL|SAINT GERMAIN) / },

  /* ─── 12. destilado ───
     Lista longa de marca de propósito: uísque e vodca não dizem o que são no
     nome ("BLACK LABEL 1L", "GREY GOOSE 200ML", "BUCHANANS DE LUXE"). */
  { categoria: 'Destilados', quando: / (ABSOLUT|BACARDI|BALLANTINE|BALLANTINES|BEEFEATER|BOMBAY|BAMBAY|BUCHANANS|CHIVAS|CIROC|GORDONS|JACK|DANIELS|JAMESON|JOHNNIE|JURUPINGA|JURUPIRA|MARTINI|NATU|ORLOFF|PASSPORT|SMIRNOFF|STEINHAEGER|TANQUERAY|TEQUILERO|DOMECQ|DREHER|JAMEL|CAMPARI|CYNAR|JAGER|ASKOV|KISLLA|VDK|JAPIRA|PITU|SELETA|ROCKS|ROOTS) / },
  { categoria: 'Destilados', quando: / (GREY GOOSE|VELHO BARREIRO|BLACK LABEL|RED LABEL|WHITE HORSE|BOB PINGA|NATASHA|BAIANINHA|BARRIL DE OURO|JOINVILLE|TRAGO FORTE|OLDEN WACK|BUSCA BRISA) / },
  { categoria: 'Destilados', quando: / (VODKA|WHISKY|WHISKEY|CACHACA|GIN|TEQUILA|RUM|CONHAQUE|LICOR|APERITIVO|CATUABA|DOSE|PINGA|VERMUTE) / },

  /* ─── 13. cerveja ───
     `ORIGINAL` NÃO vale sozinho: casava "BIS ORIGINAL 100G" (chocolate) e
     "BATATA STAX ORIGINAL" (salgadinho). Aqui só vale acompanhado da embalagem,
     que é como a cerveja aparece neste cadastro. */
  { categoria: 'Cervejas', quando: / (BRAHMA|ANTARCTICA|ANTARTICA|SKOL|SPATEN|EISENBAHN|HEINEKEN|BUDWEISER|AMSTEL|STELLA|CORONA|ITAIPAVA|PETRA|BURGUESA|BURGOMA|PATAGONIA|BECKS|DEVASSA|KAISER|SCHIN|BOHEMIA|SERRAMALTE|CARACU|MALTA|IMPERIO|PRESIDENTE|MIRANTE|STEMPEL|DRAFT) / },
  { categoria: 'Cervejas', quando: / (DI SANTO|SUB ZERO|SOL LONG) / },
  { categoria: 'Cervejas', quando: / ORIGINAL (CAIXA|UNIDADE|LATA|LONG|LATAO)/ },
  { categoria: 'Cervejas', quando: / (CERVEJA|PILSEN|PILSEM|MALZBIER|LAGER|CHOPP|CHOP|LATAO|IPA) / },

  /* ─── 14. refrigerante ───
     `MAX` e `RED HOUSE` são linhas de refrigerante de 2 litros desta região.
     `MAX` estava em "Sucos", e o efeito era feio: "MAX GUARANÁ" caía em
     refrigerante pela palavra guaraná e "MAX LARANJA" caía em suco — a mesma
     marca partida em duas categorias, que na tela parece defeito. */
  { categoria: 'Refrigerantes', quando: / (COCA|PEPSI|FANTA|SPRITE|GUARANA|SCHWEPPES|SCHWEPPS|REFRIGERANTE|SODA|TONICA|TONICO|DOLLY|ITUBAINA|KUAT|MAX|H2O) / },
  { categoria: 'Refrigerantes', quando: / (SAO BERNARDO|AGUA DA SERRA|RED HOUSE) / },

  /* ─── 15. água ───
     Depois de refrigerante porque "ÁGUA DA SERRA GUARANÁ 2L" é a linha de água
     com sabor da marca, vendida junto do refrigerante. */
  { categoria: 'Águas', quando: / (AGUA|CRISTAL|BONAFONT|MORMAII) / },
  { categoria: 'Águas', quando: / (FONT LIFE|SERRA AZUL|SERRA CATARINENSE) / },

  /* ─── 16. suco, néctar, refresco, isotônico ───
     `SERRA` sozinho saiu: casava "SERRA AZUL 900ML", que é água. */
  { categoria: 'Sucos e refrescos', quando: / (SUCO|SUQ|NECTAR|REFRESCO|GATORADE|POWERADE|ISOTONICO|KAPO|PRATS|TANG|MAGUARY|CHA|MATTE|TODDYNHO|MUMU) / },
  { categoria: 'Sucos e refrescos', quando: / (POWER ADE|DEL VALLE|DELL VALE|DEL VALE|SO FRESH|SU FRESH|CHOCO LEITE) / },

  /* ─── 17. doce que a regra do açaí roubaria ───
     "COCADA BANANA E AÇAI" e "PAÇOQUINHA" são doce de balcão, não sorvete. */
  { categoria: 'Doces e chocolates', quando: / (COCADA|PACOCA|PACOQUITA|PACOQUINHA) / },

  /* ─── 18. o resto do sorvete: pote e açaí ───
     `POTE` exige tamanho ou a palavra sorvete. Solto, ele levava "POTE DE
     MANSÃO" e "POTE DE CAVALINHO" para cá — que pelo padrão do cadastro ("POTE
     DE JACK", "POTE DE RED LABEL") são bebida, não sorvete. Como eu não sei
     qual dos dois, eles ficam sem categoria, que é a resposta honesta. */
  { categoria: 'Sorvetes e açaí', quando: / (ACAI|LEITINHO) / },
  { categoria: 'Sorvetes e açaí', quando: / POTE (\d|DE SORVETE)/ },

  /* ─── 19. salgadinho, parte 1: as marcas ───
     ANTES do lámen, porque "PIPOCA SABOR PIZZA", "TREEPS PIZZA 35G" e "tekitos
     nuggets" casavam PIZZA e NUGGETS e iam para comida pronta. `BATATA` ficou
     para a parte 2, depois do lámen: "NISSIN CARNE COM BATATA" é lámen. */
  { categoria: 'Salgadinhos', quando: / (RUFFLES|BACONZITOS|BILUZITOS|DORITOS|CHEETOS|CHETTOS|FANDANGOS|TORCIDA|LAYS|STAX|PETTIZ|AMENDUPA|AMENDOIM|AMENDOIN|PIPOTECA|PIPOCA|PURURUCA|TORRADINHA|TORRESMINHO|TEKITOS|TREEPS|CHIPS) / },
  { categoria: 'Salgadinhos', quando: / (PINGO DE OURO|PEGA FOGO) / },

  /* ─── 20. lámen e comida pronta ─── */
  { categoria: 'Lámen e comida rápida', quando: / (NISSIN|LAMEN|MIOJO|NOODLES|YAKISSOBA|PIZZA|LASANHA|HAMBURGUER|HANBURGUER|SANDUICHE|ESFIHA|PASTEL|NUGGETS) / },
  { categoria: 'Lámen e comida rápida', quando: / HOT HIT / },

  /* ─── 21. salgadinho, parte 2: as palavras genéricas ─── */
  { categoria: 'Salgadinhos', quando: / (BATATA|SALGADINHO|FAROFA|CEBOLITOS) / },

  /* ─── 22. doce, chocolate, biscoito ───
     A linha Dip Loko mora aqui, com as três grafias que o cadastro usa
     (`DIPLOKO`, `DIP LOKO`, `DIPO LOKO`) — mais "APITO LOKO" e "TREME TERRA",
     que são produtos da mesma linha. */
  { categoria: 'Doces e chocolates', quando: / (FINI|TRIDENT|TRIDENTE|HALLS|LACTA|NESTLE|BAUDUCCO|BAUDUCO|TRENTO|FREEGELLS|GAROTO|HERSHEY|BIS|ALPINO|BATON|CHOKITO|SUFLAIR|LOLLO|TALENTO|SERENATA|PRESTIGIO|NEGRESCO|TRAKINAS|PASSATEMPO|MINUETO|DISQUETI|LILIBEL|GOMETS|GOMAKS|MENTOS|SNICKERS|KINDER|NUTELLA|NUTELA|MMS|BIBS|ARCOR|DORI|PECCIN|NEOPOP|MORANGUETE|TRICACAU|FLOKITO|LOOK|BLONG|POPKINS|HIPOPO|PASSION|FLICS|ROYAL|MORENINHA|TRIUNFO|DANCLETS) / },
  { categoria: 'Doces e chocolates', quando: / (KIT KAT|M MS|POP FRUTA|UP DATE|BARRA SHOT) / },
  { categoria: 'Doces e chocolates', quando: / (CHOCOLATE|BOMBOM|BOM BOM|PIRULITO|CHICLETE|CHICLETS|CHICLE|BALA|BALAS|PASTILHA|COOKIE|COOKIES|BOLACHA|BISCOITO|WAFER|WALFER|TORTINHA|TORTINHAS|BOLINHO|DOCE|BARRINHA|GOMA|JUJUBA|MARSHMALLOW|BRIGADEIRO|GELATINA|PUDIM|GRANULADO) / },

  /* ─── 23. mercearia ─── */
  { categoria: 'Mercearia', quando: / (PIRACANJUBA|BONARE|SAZON|HELLMANN|SEARA|ODERICH|BRETZKE|HEMMER|KONSUMO|ZIZO|MELITA|MELITTA|ERVILHA|MILHO|ARROZ|FEIJAO|ACUCAR|CAFE|OLEO|MACARRAO|MOLHO|MAIONESE|KETCHUP|MOSTARDA|VINAGRE|TEMPERO|FARINHA|MARGARINA|CONSERVA|ATUM|SARDINHA|PALMITO|PEPINO|PEPINOS|BETERRABA|CODORNA|QUEIJO|MORTADELA|PAO|ERVA|CUIA|AMIDO|LACTEA|SAL|LEITE) / },
  { categoria: 'Mercearia', quando: / (DONA BENTA|VISCONTI|COCO RALADO) / },

  /* ─── 24. o resto que uma conveniência vende ───
     `ACENDEDOR` está aqui e não na tabacaria: "GEL ACENDEDOR 420G" é para
     churrasqueira, não para cigarro. */
  { categoria: 'Utilidades', quando: / (CARREGADOR|TOMADA|PILHA|FONE|CABO|CHAVEIRO|BRINQUEDO|BRINQUEDOS|FOGOS|VELA|VELAS|FOSFORO|GUARDANAPO|COPO|CANUDO|SACOLA|FIGURINHAS|LENHA|ESPETO|FURADOR|ACENDEDOR) / },
  { categoria: 'Utilidades', quando: / (KIDS ZONE|PAPEL FILME|PAPEL MANTEIGA|PAPEL POLIESTER|PAPEL TOALHA) / },
];

/**
 * A ORDEM EM QUE AS CATEGORIAS APARECEM NA VITRINE.
 *
 * Existe porque a alternativa é ordem alfabética, e alfabética coloca
 * "Acessórios para narguilé" e "Águas" na frente de "Cervejas" — a primeira
 * faixa da loja mostrando mangueira de narguilé e garrafa de água. Aqui a ordem
 * é a da prateleira: o que puxa o pedido primeiro, o que se leva junto depois, e
 * o que só se procura quando já se sabe que tem.
 *
 * Categoria fora desta lista não é erro: ela vai para o fim, em ordem
 * alfabética, que é o que o cardápio já faz com categoria sem registro.
 */
export const ORDEM_SUGERIDA: string[] = [
  'Cervejas',
  'Destilados',
  'Ices e drinks',
  'Vinhos e espumantes',
  'Energéticos',
  'Refrigerantes',
  'Sucos e refrescos',
  'Águas',
  'Gelo',
  'Essências para narguilé',
  'Acessórios para narguilé',
  'Tabacaria',
  'Cigarros',
  'Vape',
  'Salgadinhos',
  'Doces e chocolates',
  'Sorvetes e açaí',
  'Lámen e comida rápida',
  'Mercearia',
  'Higiene e limpeza',
  'Utilidades',
];

/**
 * A CATEGORIA DE UM PRODUTO PELO NOME, ou vazio quando nenhuma regra casa.
 *
 * Vazio é resposta legítima e é o ponto do desenho: ver 20 produtos sem
 * categoria e resolvê-los à mão é melhor que ver 20 produtos na categoria
 * errada e não saber quais são.
 */
export function categoriaPorNome(nome: string, regras: RegraCategoria[] = REGRAS): string {
  const alvo = normalizarNome(nome);
  for (const r of regras) {
    if (r.quando.test(alvo)) return r.categoria;
  }
  return '';
}

/** Só para conferência: quantos produtos cada categoria receberia. */
export function contarPorCategoria(nomes: string[]): Map<string, number> {
  const conta = new Map<string, number>();
  for (const n of nomes) {
    const c = categoriaPorNome(n) || '(sem categoria)';
    conta.set(c, (conta.get(c) ?? 0) + 1);
  }
  return conta;
}
