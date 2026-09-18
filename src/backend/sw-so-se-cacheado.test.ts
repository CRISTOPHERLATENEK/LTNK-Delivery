import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * ERR_CACHE_MISS NO CONSOLE DO LOJISTA.
 *
 * Relatado como "ainda continua com o erro", numa linha vermelha do DevTools
 * que aparecia em toda visita. Medido em produção, em
 * galderio-bebidas.maxxpedidos.com.br:
 *
 *   status ..... (falha) net::ERR_CACHE_MISS
 *   tamanho .... 0,0 kB
 *   tempo ...... 3 ms
 *   iniciador .. sw.js:41   (a busca com segunda chance)
 *   no nginx .... NADA — a requisição nunca chegou ao servidor
 *
 * O 3 ms é o que entrega a causa: falha de rede não é tão rápida. Isso é o
 * navegador RECUSANDO antes de tentar.
 *
 * QUEM PEDIU NÃO FOMOS NÓS. O Chrome reemite pedidos com
 * `cache: 'only-if-cached'` ao voltar página (botão Voltar, restauração de
 * aba), e o significado disso é "responda do SEU cache HTTP, ou não responda".
 * Passar um pedido desses para o `fetch` é contradição: o navegador recusa na
 * hora. E era o pedido da RAIZ — o `start_url` do manifesto, que o Chrome busca
 * de tempos em tempos para conferir se o app segue instalável.
 *
 * A "segunda chance" ainda repetia tudo 400 ms depois, pelo mesmo motivo, e o
 * SW terminava devolvendo o 504 sintético dele.
 *
 * O conserto é sair do caminho: pedido assim volta para o navegador, que é quem
 * sabe respondê-lo. Não é contornar sintoma — o pedido nunca foi nosso.
 */

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'frontend/public/sw.js'), 'utf8');
const PUBLICADO = fs.readFileSync(path.join(RAIZ, 'public/sw.js'), 'utf8');

describe('service worker · pedido "só se estiver no cache"', () => {
  it('não é interceptado', () => {
    expect(FONTE).toContain("req.cache === 'only-if-cached'");
  });

  /*
   * A ORDEM É O CONSERTO. Depois de qualquer `respondWith`, o pedido já é
   * nosso e o `return` não desfaz mais nada — o erro voltaria igual.
   */
  it('a saída vem ANTES de qualquer respondWith', () => {
    const guarda = FONTE.indexOf("req.cache === 'only-if-cached'");
    const primeiroRespond = FONTE.indexOf('e.respondWith');
    expect(guarda).toBeGreaterThan(-1);
    expect(primeiroRespond).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(primeiroRespond);
  });

  /* E dentro do handler de fetch, não solto no arquivo. */
  it('mora no handler de fetch', () => {
    const handler = FONTE.indexOf("addEventListener('fetch'");
    const guarda = FONTE.indexOf("req.cache === 'only-if-cached'");
    expect(handler).toBeGreaterThan(-1);
    expect(guarda).toBeGreaterThan(handler);
  });

  /*
   * `public/sw.js` é o que está no ar e `frontend/public/sw.js` é o que o build
   * publica por cima. Divergir faz a correção viver até o próximo deploy e
   * sumir — já aconteceu neste projeto, e é por isso que a checagem se repete
   * aqui em vez de confiar em lembrar.
   */
  it('a correção está nas duas cópias', () => {
    expect(PUBLICADO).toContain("req.cache === 'only-if-cached'");
    expect(PUBLICADO).toBe(FONTE);
  });
});
