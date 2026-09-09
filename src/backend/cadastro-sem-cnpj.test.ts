import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * COMEÇAR SEM CNPJ TEM QUE SER VISIVELMENTE POSSÍVEL.
 *
 * O concorrente que cobra R$ 99/mês anuncia isso no FAQ: "Posso começar sem
 * CNPJ? Sim. Você cadastra como MEI ou CPF e ajusta depois." É fricção de
 * entrada, e fricção de entrada decide venda.
 *
 * Aqui a capacidade JÁ EXISTIA — o assistente nunca exigiu CNPJ, e o passo
 * fiscal só grava quando há um. O que existia era a tela dizendo o contrário
 * por omissão: passo chamado "Fiscal", CNPJ como primeiro campo sem marca de
 * opcional, e o "Pular" desenhado como desistência (botão fantasma) ao lado de
 * um "Concluir" sólido. Quem cadastra MEI concluía que precisava — e desistia,
 * ou inventava um número, que é pior.
 *
 * Este teste guarda a APARÊNCIA, porque é ela que estava errada. E guarda
 * também a capacidade, para ninguém "consertar" o passo tornando-o obrigatório.
 */

const RAIZ = path.join(__dirname, '..', '..');
const tela = fs.readFileSync(
  path.join(RAIZ, 'frontend', 'src', 'pages', 'admin', 'tenants.tsx'), 'utf8');
const autenticacao = fs.readFileSync(path.join(__dirname, 'rotas', 'autenticacao.ts'), 'utf8');

/**
 * TEXTO CORRIDO COM O ESPAÇO NORMALIZADO.
 *
 * Frase de interface quebra de linha na fonte onde o editor quiser, e um regex
 * não atravessa a quebra: `/já vende/` falhou porque no arquivo está
 * "a loja já" + quebra + espaços + "vende". Asserção sobre PROSA tem que olhar
 * a prosa, não o recuo do arquivo.
 */
function prosa(fonte: string): string {
  return fonte.replace(/\s+/g, ' ');
}

/** O passo fiscal do assistente, isolado do resto do arquivo. */
const etapaFiscal = (() => {
  const i = tela.indexOf('function EtapaFiscal');
  return tela.slice(i, tela.indexOf('\n}\n', i));
})();

describe('o passo fiscal do cadastro de cliente', () => {
  it('o teste está lendo o passo certo', () => {
    // Sem isto, tudo abaixo passa por vácuo se o componente for renomeado.
    expect(etapaFiscal.length).toBeGreaterThan(500);
    expect(etapaFiscal).toMatch(/CNPJ/);
  });

  it('diz na tela que é opcional, antes dos campos', () => {
    const aviso = etapaFiscal.indexOf('Este passo é opcional');
    const primeiroCampo = etapaFiscal.indexOf('<Label>CNPJ');
    expect(aviso).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(primeiroCampo);
  });

  /*
   * NÃO BASTA DIZER "OPCIONAL": tem que dizer o que a loja consegue fazer sem
   * isso. "Opcional" sozinho deixa a dúvida de para que serve, e na dúvida a
   * pessoa preenche errado em vez de pular.
   */
  it('diz o que a loja faz sem preencher nada', () => {
    expect(prosa(etapaFiscal)).toMatch(/MEI ou CPF/);
    expect(prosa(etapaFiscal)).toMatch(/j[áa] vende, recebe pedido/);
  });

  it('o rótulo do campo marca que é opcional', () => {
    expect(etapaFiscal).toMatch(/<Label>CNPJ <span[^>]*>— opcional/);
  });

  /*
   * O BOTÃO PRINCIPAL SEGUE O QUE FOI PREENCHIDO. Antes o sólido era sempre
   * "Concluir" (que salva o fiscal) e o pular era fantasma — o caminho comum
   * de quem não emite nota estava desenhado como desistência.
   */
  it('sem CNPJ, o botão principal conclui sem fiscal', () => {
    expect(etapaFiscal).toMatch(/onClick=\{cnpj \? concluir : onConcluir\}/);
    expect(etapaFiscal).toMatch(/Concluir sem fiscal/);
  });

  it('o passo aparece na lista como opcional', () => {
    expect(tela).toMatch(/chave: 'fiscal', label: 'Fiscal \(opcional\)'/);
  });
});

describe('a capacidade, que já existia e não pode regredir', () => {
  it('o fiscal só é enviado quando há CNPJ', () => {
    expect(etapaFiscal).toMatch(/if \(cnpj\) \{/);
  });

  /*
   * E o cadastro de lojista por conta própria continua fechado — de propósito,
   * é a nossa equipe que abre loja. Registrado aqui para que "começar sem CNPJ"
   * nunca seja lido como "abrir loja sozinho pela tela pública".
   */
  it('lojista não se cadastra sozinho, e a mensagem explica', () => {
    expect(autenticacao).toMatch(/Cadastro de lojista é feito pela nossa equipe/);
  });
});
