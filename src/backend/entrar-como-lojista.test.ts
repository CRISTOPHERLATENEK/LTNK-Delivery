import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * "ENTRAR COMO LOJISTA" FALHAVA EM SILÊNCIO.
 *
 * O super admin abre o painel de um cliente sem a senha dele: o servidor emite
 * um token de lojista, e o navegador abre a aba. O servidor sempre funcionou —
 * a auditoria de produção tem SEIS emissões registradas, quatro delas em onze
 * minutos, todas do mesmo admin. Quatro cliques em onze minutos é a assinatura
 * de alguém insistindo numa coisa que não responde.
 *
 * O que não funcionava era a aba:
 *
 *   window.open(destino, '_blank');   // ← retorno nunca olhado
 *
 * `window.open` só abre enquanto vale a ativação do clique, e ela é curta. A
 * chamada vinha DEPOIS de um `await fetch` (em um dos caminhos, dois), então o
 * navegador bloqueava, devolvia `null`, e ninguém checava. Sem exceção, sem
 * toast, sem nada na tela.
 *
 * E o mesmo código estava copiado em TRÊS telas do admin, com o mesmo defeito
 * nas três — que é por que ele agora vive num lugar só.
 */

const RAIZ = path.join(__dirname, '..', '..');
const api = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'lib', 'api.ts'), 'utf8');
const TELAS = ['tenants.tsx', 'lojas.tsx', 'loja-detalhe.tsx'];

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

/** O corpo de `entrarComoLojista`, sem comentário. */
const corpo = (() => {
  const i = api.indexOf('export async function entrarComoLojista(');
  expect(i).toBeGreaterThan(-1);
  const fim = api.indexOf('\n}\n', i);
  return exec(api.slice(i, fim));
})();

describe('a aba é pedida dentro do clique', () => {
  it('o teste está lendo a função certa', () => {
    expect(corpo).toContain('window.open');
    expect(corpo).toContain('/impersonar');
  });

  /*
   * A ASSERÇÃO CENTRAL, e é sobre ORDEM. Qualquer `await` antes do
   * `window.open` consome a ativação do clique e traz o defeito de volta —
   * inclusive um `await` que alguém acrescente sem perceber, um dia, para
   * carregar qualquer coisa antes.
   */
  it('window.open vem antes do primeiro await', () => {
    const iAba = corpo.indexOf('window.open(');
    const iEspera = corpo.indexOf('await ');
    expect(iAba).toBeGreaterThan(-1);
    expect(iEspera).toBeGreaterThan(-1);
    expect(iAba).toBeLessThan(iEspera);
  });

  /* Aba em branco é pedida com `about:blank` e não com o destino, porque o
     destino só existe depois da resposta do servidor. */
  it('a aba nasce em branco e depois é redirecionada', () => {
    expect(corpo).toContain("window.open('about:blank', '_blank')");
    expect(corpo).toMatch(/aba\.location\.replace\(url\)/);
  });
});

describe('o retorno de window.open é olhado', () => {
  /*
   * ERA ISSO O BUG. `null` significa aba bloqueada, e ignorá-lo é o silêncio.
   */
  it('há um caminho para quando a aba não abre', () => {
    expect(corpo).toMatch(/if \(aba\) \{/);
    expect(corpo).toContain('opcoes.avisar?.(');
    expect(corpo).toContain('window.location.assign(url)');
  });

  it('o aviso diz o que aconteceu e o que vai acontecer', () => {
    expect(api).toContain('O navegador bloqueou a aba nova. Abrindo o painel nesta aba.');
  });

  /* Aba em branco que ficou sem destino é lixo na cara de quem clicou: falha na
     requisição fecha a aba antes de propagar o erro. */
  it('erro fecha a aba em branco', () => {
    const vezes = (corpo.match(/aba\?\.close\(\)/g) ?? []).length;
    expect(vezes).toBeGreaterThanOrEqual(2);
  });

  /*
   * E O ERRO SOBE. A função não engole: quem chama mostra o toast, e as três
   * telas fazem isso. Tratar aqui deixaria a tela sem saber que falhou.
   */
  it('a função propaga o erro em vez de engolir', () => {
    expect(corpo).toMatch(/throw e;/);
  });
});

describe('as três telas do admin não reimplementam nada', () => {
  for (const tela of TELAS) {
    const fonte = exec(fs.readFileSync(
      path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', tela), 'utf8'));

    it(`${tela} chama a função compartilhada`, () => {
      expect(fonte).toContain('entrarComoLojista as entrarNoPainelDoLojista');
      expect(fonte).toContain('await entrarNoPainelDoLojista(');
    });

    /*
     * NENHUMA DELAS ABRE ABA POR CONTA PRÓPRIA. É a asserção que impede a
     * volta da cópia — foi a duplicação que fez um defeito virar três.
     *
     * A asserção é sobre O CORPO DA FUNÇÃO, não sobre o arquivo: `tenants.tsx`
     * tem um `window.open` legítimo noutro lugar (abrir o site da loja num
     * clique), e proibi-lo no arquivo inteiro seria proibir a coisa errada.
     */
    it(`${tela} não abre aba dentro de entrar como lojista`, () => {
      const i = fonte.indexOf('async function entrarComoLojista');
      expect(i).toBeGreaterThan(-1);
      const fn = fonte.slice(i, fonte.indexOf('\n  }\n', i));
      expect(fn).not.toContain('window.open');
      expect(fn).not.toContain('window.location');
    });

    it(`${tela} não monta o destino nem valida o token sozinha`, () => {
      expect(fonte).not.toContain('destinoImpersonacao');
      expect(fonte).not.toContain('abrirSessaoLojistaImpersonada');
      expect(fonte).not.toContain('/impersonar');
    });

    /* Falha continua aparecendo na tela: a função propaga, e a tela mostra. */
    it(`${tela} mostra o erro`, () => {
      expect(fonte).toContain('Falha ao entrar como lojista.');
    });
  }
});

describe('o token nunca vai na query string', () => {
  /*
   * REGRA QUE JÁ VALIA E NÃO PODE REGREDIR: JWT em query string vaza no
   * histórico do navegador, no log de acesso do servidor e no header Referer.
   * Quando a loja está em outro domínio, o token viaja no FRAGMENTO, que não é
   * enviado ao servidor — e a página de chegada o consome e apaga da URL.
   */
  it('o repasse entre domínios usa fragmento', () => {
    expect(api).toContain('/lojista#sessao=');
    expect(exec(api)).not.toMatch(/lojista\?(entrar|sessao|token)=/);
  });

  it('e a chegada apaga o fragmento da URL', () => {
    const fn = api.slice(api.indexOf('export function lerRepasseImpersonacao'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain('history.replaceState');
  });
});
