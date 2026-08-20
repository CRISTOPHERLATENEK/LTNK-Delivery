/**
 * A regra de promoção decide QUANTO O CLIENTE PAGA. Errar pra um lado dá
 * desconto que o lojista não quis; pro outro, cobra cheio de quem viu promoção
 * na tela — e o segundo é pior, porque é o cliente descobrindo no extrato.
 *
 * O teste mais importante deste arquivo é o último: ele varre o código-fonte
 * procurando a regra COPIADA. A promoção nasceu sem prazo e a decisão
 * ("promo > 0 ? promo : preco") foi replicada em nove lugares. Quando o prazo
 * entrou, cada cópia virou uma chance de cobrar promoção vencida. Travar o
 * comportamento não basta: é preciso travar a duplicação, senão a décima cópia
 * nasce sem a data e nenhum teste de comportamento percebe.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { promocaoVigente, precoVigente, sqlPromocaoVigente } from './preco-produto';

const HOJE = '2026-08-20';
const base = { preco_centavos: 5000, preco_promocional_centavos: 3000 };

describe('promocaoVigente', () => {
  it('sem preço promocional, não há promoção', () => {
    expect(promocaoVigente({ preco_centavos: 5000 }, HOJE)).toBe(false);
    expect(promocaoVigente({ ...base, preco_promocional_centavos: null }, HOJE)).toBe(false);
    expect(promocaoVigente({ ...base, preco_promocional_centavos: 0 }, HOJE)).toBe(false);
  });

  /* Compatibilidade: é o estado de todo produto cadastrado antes da coluna. */
  it('sem prazo, vale sempre', () => {
    expect(promocaoVigente(base, HOJE)).toBe(true);
    expect(promocaoVigente({ ...base, promo_fim: '' }, HOJE)).toBe(true);
    expect(promocaoVigente({ ...base, promo_fim: null }, HOJE)).toBe(true);
  });

  /*
   * O DIA DO FIM CONTA INTEIRO. Promoção "até domingo" tem que valer domingo —
   * se o limite fosse exclusivo, ela morreria na virada de sábado e o lojista
   * veria preço cheio no dia que anunciou desconto.
   */
  it('vale ATÉ o último dia, inclusive', () => {
    expect(promocaoVigente({ ...base, promo_fim: HOJE }, HOJE)).toBe(true);
  });

  it('no dia seguinte ao fim, acabou', () => {
    expect(promocaoVigente({ ...base, promo_fim: '2026-08-19' }, HOJE)).toBe(false);
  });

  it('prazo futuro segue valendo', () => {
    expect(promocaoVigente({ ...base, promo_fim: '2026-12-31' }, HOJE)).toBe(true);
  });

  /* Comparação de string só funciona se o formato for ordenável — este teste
     pega qualquer troca pra 'DD/MM/AAAA', que ordenaria errado. */
  it('vira o mês e o ano corretamente', () => {
    expect(promocaoVigente({ ...base, promo_fim: '2026-09-01' }, '2026-08-31')).toBe(true);
    expect(promocaoVigente({ ...base, promo_fim: '2025-12-31' }, '2026-01-01')).toBe(false);
  });
});

describe('precoVigente', () => {
  it('promoção valendo cobra o promocional', () => {
    expect(precoVigente({ ...base, promo_fim: '2026-12-31' }, HOJE)).toBe(3000);
  });

  it('promoção vencida cobra o preço normal, SEM apagar o promocional', () => {
    const p = { ...base, promo_fim: '2026-01-01' };
    expect(precoVigente(p, HOJE)).toBe(5000);
    // O valor continua ali: reativar a promoção é mudar a data, não redigitar.
    expect(p.preco_promocional_centavos).toBe(3000);
  });

  it('sem promoção, o preço normal', () => {
    expect(precoVigente({ preco_centavos: 5000 }, HOJE)).toBe(5000);
  });
});

describe('sqlPromocaoVigente', () => {
  it('cobre as três condições e deixa um ? pra data', () => {
    const sql = sqlPromocaoVigente('p');
    expect(sql).toMatch(/p\.preco_promocional_centavos > 0/);
    expect(sql).toMatch(/p\.promo_fim IS NULL/);
    expect(sql).toMatch(/p\.promo_fim >= \?/);
    expect(sql.match(/\?/g)).toHaveLength(1);   // um só parâmetro: a data de hoje
  });

  it('aceita outro alias sem quebrar', () => {
    expect(sqlPromocaoVigente('prod')).toMatch(/prod\.promo_fim >= \?/);
  });
});

/**
 * ESTE É O TESTE QUE IMPEDE O BUG DE VOLTAR.
 *
 * Procura a decisão de preço escrita à mão fora deste módulo. Enquanto a regra
 * era só "tem promoção?", copiar era feio; com prazo, cada cópia é uma
 * cobrança errada esperando acontecer — e o lugar mais fácil de esquecer é o
 * que cobra, porque ninguém olha para ele na tela.
 *
 * Se este teste falhar, NÃO adicione exceção: use `precoVigente` /
 * `promocaoVigente` (ou `sqlPromocaoVigente`, em consulta) no lugar novo.
 */
describe('a regra não pode ser copiada', () => {
  const raizes = [
    path.resolve(__dirname, '..', '..', 'src'),
    path.resolve(__dirname, '..', '..', 'frontend', 'src'),
  ];
  const permitidos = ['preco-produto.ts', 'preco-produto.test.ts', 'schema-mysql.ts'];

  function arquivos(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p);
      return /\.(ts|tsx)$/.test(e.name) && !permitidos.includes(e.name) ? [p] : [];
    });
  }

  it('nenhum arquivo decide o preço promocional por conta própria', () => {
    // "preco_promocional_centavos > 0" é a assinatura da decisão copiada.
    // Guardar/ler o campo é livre; TESTAR se ele é maior que zero pra escolher
    // o preço é o que tem de estar num lugar só.
    const culpados: string[] = [];
    for (const raiz of raizes) {
      for (const arq of arquivos(raiz)) {
        const texto = fs.readFileSync(arq, 'utf8');
        if (/preco_promocional_centavos\s*(?:&&|>)\s*[^;]*?>\s*0/.test(texto)
            || /preco_promocional_centavos\s*>\s*0/.test(texto)) {
          culpados.push(path.relative(path.resolve(__dirname, '..', '..'), arq));
        }
      }
    }
    expect(culpados).toEqual([]);
  });
});
