import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { iconeSemFoto } from '../../frontend/src/lib/icone-sem-foto';

/*
 * COMPARA PELO `displayName`, e nao importando `lucide-react` aqui.
 *
 * O modulo sob teste mora em `frontend/` e resolve o pacote no node_modules
 * dele; este arquivo mora em `src/backend/` e a raiz NAO tem o pacote — o
 * import direto falha com "Cannot find package". O `displayName` e o nome do
 * icone ("Beer", "Wine") e nao depende de resolucao nenhuma.
 */
const nomeDo = (cat: string | null, nome: string | null): string =>
  (iconeSemFoto(cat, nome) as unknown as { displayName?: string }).displayName ?? '?';

const Beer = 'Beer';
const Wine = 'Wine';
const Martini = 'Martini';
const CupSoda = 'CupSoda';
const Cigarette = 'Cigarette';
const Snowflake = 'Snowflake';
const GlassWater = 'GlassWater';
const Zap = 'Zap';
const Package = 'Package';

/*
 * O QUE APARECE NO LUGAR DA FOTO QUE NÃO EXISTE.
 *
 * A vitrine mostrava GARFO E FACA CRUZADOS para todo produto sem foto. Medido
 * na Galderio em 10/09/2026: 51 dos 62 itens à venda — cerveja, energético e
 * vinho — apareciam ilustrados com talher. Pior que o vazio: parece cardápio de
 * outra loja.
 *
 * ISTO NÃO SUBSTITUI FOTO, e o teste não finge que substitui. Serve para o
 * intervalo entre a loja abrir e o lojista fotografar a prateleira.
 *
 * OS CASOS SÃO NOMES REAIS do cardápio importado da Galderio. Exemplo inventado
 * testa a regra que eu imaginei; nome real testa a regra contra o que o lojista
 * de fato digitou — que é onde ela vai ser usada.
 */

describe('os produtos reais da Galderio', () => {
  /* Os 36 itens de Cervejas. */
  it.each([
    ['Cervejas', 'AMSTEL CAIXA'],
    ['Cervejas', 'AMSTEL UNIDADE'],
    ['Cervejas', 'BRAHMA DUPLO MALTE UNIDADE'],
    ['Cervejas', 'BUDWEISER LONG ZERO UNIDADE'],
    ['Cervejas', 'BURGUESA CAIXA'],
    ['Cervejas', 'ANTARTICA UNIDADE'],
  ])('%s / %s vira caneca', (cat, nome) => {
    expect(nomeDo(cat, nome)).toBe(Beer);
  });

  it.each([
    ['Vinhos e espumantes', 'VINHO TINTO SUAVE'],
    ['Vinhos e espumantes', 'ESPUMANTE MOSCATEL'],
  ])('%s / %s vira taça', (cat, nome) => {
    expect(nomeDo(cat, nome)).toBe(Wine);
  });

  /*
   * ENERGÉTICO NÃO PODE CAIR NO PADRÃO. `Package` é o "não reconheci"; se
   * energético usasse a mesma caixa, ficaria indistinguível de item sem
   * classificação — e energético é a segunda categoria da loja, 14 itens.
   */
  it('energético tem ícone próprio, diferente do padrão', () => {
    expect(nomeDo('Energéticos', 'BALY MELANCIA')).toBe(Zap);
    expect(nomeDo('Energéticos', 'BALY MELANCIA')).not.toBe(Package);
  });

  /*
   * BURGOMA é o item de R$ 2,00 da loja — nome que não diz nada a ninguém, nem
   * a mim. Ele cai na categoria, que é a informação confiável.
   */
  it('nome opaco cai na categoria', () => {
    expect(nomeDo('Cervejas', 'BURGOMA')).toBe(Beer);
  });
});

describe('a categoria decide antes do nome', () => {
  /*
   * A categoria foi escolhida para agrupar; o nome pode conter qualquer coisa.
   * "Kit Presente Vinho + Taça" numa categoria de cerveja é cerveja.
   */
  it('categoria ganha do nome quando os dois falam', () => {
    expect(nomeDo('Cervejas', 'KIT VINHO E TACA')).toBe(Beer);
  });

  it('sem categoria, o nome resolve', () => {
    expect(nomeDo('', 'HEINEKEN LONG NECK')).toBe(Beer);
    expect(nomeDo(null, 'VODKA ABSOLUT')).toBe(Martini);
  });

  it('sem nada, cai no padrão neutro', () => {
    expect(nomeDo(null, null)).toBe(Package);
    expect(nomeDo('', '')).toBe(Package);
  });
});

describe('a ordem das regras', () => {
  /*
   * "ÁGUA TÔNICA" tem as duas pistas: `agua` e `tonica`. A primeira regra que
   * casa é a que vale, então água precisa vir ANTES de refrigerante. Trocar a
   * ordem faz água tônica virar copo de refrigerante.
   */
  it('água tônica é água, não refrigerante', () => {
    expect(nomeDo('Bebidas', 'AGUA TONICA')).toBe(GlassWater);
  });

  /* E refrigerante puro continua sendo refrigerante. */
  it('refrigerante sem água é refrigerante', () => {
    expect(nomeDo('Bebidas', 'COCA COLA 2L')).toBe(CupSoda);
  });

  /*
   * CERVEJA SEM ÁLCOOL é cerveja. A palavra `cerveja` está na primeira regra,
   * então nada depois pode roubá-la — inclusive `zero`, que aparece em
   * "BUDWEISER ZERO LATA" no cardápio real.
   */
  it('cerveja zero continua cerveja', () => {
    expect(nomeDo('Cervejas', 'BRAHMA ZERO UNIDADE')).toBe(Beer);
    expect(nomeDo('', 'BUDWEISER LONG ZERO UNIDADE')).toBe(Beer);
  });
});

describe('a conveniência inteira, não só bebida', () => {
  /* A Galderio é conveniência COM TABACARIA — foi o que o lojista descreveu. */
  it('tabacaria tem ícone', () => {
    expect(nomeDo('Tabacaria', 'CIGARRO MARLBORO')).toBe(Cigarette);
    expect(nomeDo('', 'SEDA PARA CIGARRO')).toBe(Cigarette);
  });

  it('gelo tem ícone', () => {
    expect(nomeDo('', 'GELO 5KG')).toBe(Snowflake);
  });
});

describe('acento e caixa não decidem nada', () => {
  /*
   * O lojista digita como quiser: MAIÚSCULA, minúscula, com e sem acento.
   *
   * O NOME DO PRODUTO AQUI NÃO PODE TER PISTA. Minha primeira versão usava
   * "RED BULL", que casa pela regra do nome — então tirar a remoção de acento
   * não quebrava nada e a sabotagem passou. Com um nome que não diz nada, quem
   * decide é a categoria, e o acento passa a importar de verdade.
   */
  it('a categoria acentuada resolve, com nome que não ajuda', () => {
    for (const c of ['Energéticos', 'ENERGETICOS', 'energéticos', 'ENERGÉTICOS']) {
      expect(nomeDo(c, 'XYZ 500ML')).toBe(Zap);
    }
  });

  it('o mesmo vale para as outras categorias da loja', () => {
    expect(nomeDo('Vinhos e espumantes', 'XYZ 750ML')).toBe(Wine);
    expect(nomeDo('VINHOS E ESPUMANTES', 'XYZ 750ML')).toBe(Wine);
  });
});

describe('o talher saiu da vitrine', () => {
  const RAIZ = path.join(__dirname, '..', '..');
  const ler = (...p: string[]) => fs.readFileSync(path.join(RAIZ, 'frontend', 'src', ...p), 'utf8');
  const loja = ler('pages', 'cliente', 'loja.tsx');
  const carrinho = ler('pages', 'cliente', 'carrinho.tsx');

  /*
   * A PROVA NEGATIVA. Os quatro pontos da vitrine e o do carrinho tinham
   * `UtensilsCrossed` fixo. Consertar quatro e esquecer um deixaria talher
   * aparecendo exatamente onde ninguém olha durante o teste.
   */
  it('nenhum produto sem foto usa talher', () => {
    for (const fonte of [loja, carrinho]) {
      const usos = (fonte.match(/<UtensilsCrossed/g) ?? []).length;
      /* Sobra UM em loja.tsx: é a LOJA sem logo, não produto sem foto — outro
         assunto, e talher lá é o padrão antigo da plataforma. */
      expect(usos).toBeLessThanOrEqual(fonte === loja ? 1 : 0);
    }
  });

  it('os cinco pontos passaram a derivar do produto', () => {
    const vezes = (l: string) => (l.match(/iconeSemFoto\(/g) ?? []).length;
    expect(vezes(loja)).toBe(4);
    expect(vezes(carrinho)).toBe(1);
  });

  /* O que sobrou de talher em loja.tsx é o logo da loja, e tem tamanho próprio
     (`size-7`) — se algum dia esse também virar derivado, este teste avisa. */
  it('o talher que sobrou é o do logo da loja', () => {
    const i = loja.indexOf('<UtensilsCrossed');
    expect(loja.slice(i, i + 60)).toContain('size-7');
  });
});
