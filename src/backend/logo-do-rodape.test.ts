import { describe, it, expect } from 'vitest';
import { CAMPOS_TEXTO, chaveDeTexto, montarLandingAdmin, montarLandingPublica, salvarLanding } from './landing-campos';
import { escalaDaLogo } from './util';

/*
 * A LOGO DO RODAPÉ, e o tamanho dela.
 *
 * Duas coisas pedidas olhando a tela: "criar opção de escolher a logo do
 * rodapé, pelo que eu vi o do header vai pro rodapé tbm" — "rodapé do landing
 * page, não aquele que é Criado por" — e, para o crédito "Desenvolvido por",
 * "colocar um negócio pra aumentar ou diminuir tamanho".
 *
 * São dois rodapés diferentes, e é justamente o que se confunde:
 *
 *   landing (`landing_footer_logo`) ..... rodapé da página de vendas, fundo
 *                                         quase preto, repetia a logo do topo
 *   crédito (`rodape_credito_*`) ........ "Desenvolvido por" no fim do painel
 *                                         de quem contratou, vem do banco
 *                                         CENTRAL e é um só para todos
 */

/** Config de mentira: o mesmo par ler/gravar que as rotas injetam. */
function configFalsa(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    ler: async (chave: string) => dados.get(chave) ?? '',
    gravar: async (chave: string, valor: string) => { dados.set(chave, valor); },
  };
}

describe('logo do rodapé da landing', () => {
  it('é um campo declarado, com a chave que o resto do sistema espera', () => {
    const campo = CAMPOS_TEXTO.find(c => c.nome === 'footer_logo');
    expect(campo).toBeDefined();
    /* 500 é o teto das URLs de imagem do projeto (o mesmo de `hero_imagem`) —
       caminho de upload com hash cabe folgado. */
    expect(campo!.max).toBe(500);
    expect(chaveDeTexto('footer_logo')).toBe('landing_footer_logo');
  });

  /*
   * O CICLO INTEIRO, que é onde mora o bug clássico deste arquivo: "editei no
   * admin e o site não mudou" — o campo era gravado mas o /api/tema nunca o
   * devolvia. Aqui ele passa pelas três portas de uma vez.
   */
  it('vai do admin ao público: grava, volta pra edição e chega na página', async () => {
    const { dados, ler, gravar } = configFalsa();
    await salvarLanding({ footer_logo: '/uploads/logo-clara.webp' }, gravar);

    expect(dados.get('landing_footer_logo')).toBe('/uploads/logo-clara.webp');
    expect((await montarLandingAdmin(ler)).footer_logo).toBe('/uploads/logo-clara.webp');
    expect((await montarLandingPublica(ler)).landing_footer_logo).toBe('/uploads/logo-clara.webp');
  });

  /* Vazio é o estado de QUEM JÁ ESTÁ NO AR: a página cai na logo do cabeçalho,
     e ninguém precisa fazer nada para continuar como estava. */
  it('vazio continua vazio, para a página cair na logo do cabeçalho', async () => {
    const { ler } = configFalsa();
    expect((await montarLandingPublica(ler)).landing_footer_logo).toBe('');
  });

  /*
   * A GARANTIA GENÉRICA, que vale para o campo de amanhã também: tudo que for
   * declarado precisa aparecer nas duas montagens. É esta asserção que mantém
   * de pé a promessa do arquivo — declarar num lugar só e funcionar nos três.
   */
  it('todo campo declarado chega ao admin E ao público', async () => {
    const { ler } = configFalsa();
    const admin = await montarLandingAdmin(ler);
    const publico = await montarLandingPublica(ler);
    for (const campo of CAMPOS_TEXTO) {
      expect(admin, `campo ${campo.nome} sumiu do admin`).toHaveProperty(campo.nome);
      expect(publico, `campo ${campo.nome} sumiu do público`).toHaveProperty(chaveDeTexto(campo.nome));
    }
  });
});

/*
 * O TAMANHO DA LOGO DO CRÉDITO.
 *
 * A barra vale 0–100 e 50 é o tamanho original. O que este teste guarda é o
 * comportamento do SERVIDOR com valor torto — a tela não é a única porta pra
 * rota, e o crédito é um só, lido por TODOS os clientes: uma escala absurda
 * aqui deforma o rodapé de todo mundo de uma vez.
 */
describe('escala da logo', () => {
  it('passa o que está na faixa', () => {
    expect(escalaDaLogo(0)).toBe(0);
    expect(escalaDaLogo(50)).toBe(50);
    expect(escalaDaLogo(100)).toBe(100);
    expect(escalaDaLogo('72')).toBe(72);
  });

  it('prende o que passa da faixa, em vez de recusar', () => {
    expect(escalaDaLogo(999)).toBe(100);
    expect(escalaDaLogo(-40)).toBe(0);
  });

  /*
   * LIXO CAI NO PADRÃO, NÃO NO ZERO — e esta é a parte que não é óbvia.
   * `Number(null)` é 0 e zero é posição VÁLIDA da barra; sem o desvio, um dado
   * torto encolheria a logo pela metade calado, que é pior que recusar.
   */
  it('valor sem sentido cai no padrão, não no zero', () => {
    expect(escalaDaLogo(undefined)).toBe(50);
    expect(escalaDaLogo(null)).toBe(50);
    expect(escalaDaLogo('abc')).toBe(50);
    expect(escalaDaLogo(NaN)).toBe(50);
  });

  it('corta a fração: a barra anda de um em um', () => {
    expect(escalaDaLogo(62.7)).toBe(62);
  });
});
