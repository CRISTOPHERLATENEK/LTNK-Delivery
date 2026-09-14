import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * UM HEAD NA RAIZ TEM QUE RESPONDER 200.
 *
 * Medido em 14/09/2026, com a loja perfeitamente no ar:
 *
 *   GET  / -> 200
 *   HEAD / -> 404
 *
 * Quem pergunta por HEAD não é gente: é monitor de uptime (a maioria checa
 * assim, por ser a chamada mais barata), verificador de link e pré-visualização
 * de mensageiro. O efeito prático era o pior possível para um alarme — o painel
 * de monitoramento diria "fora do ar" justamente quando não está, e o aviso que
 * existe para avisar de queda viraria o aviso em que ninguém acredita.
 *
 * A causa era literal: os dois handlers do fim do servidor começavam com
 * `if (req.method !== 'GET') return next()`, e o HEAD caía até o fim.
 */

const SERVER = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODIGO = semComentarios(SERVER);

describe('o HEAD não é tratado como método estranho', () => {
  /*
   * A ASSERÇÃO É NEGATIVA E PRECISA SER: o defeito não é uma linha faltando, é
   * uma linha ERRADA ainda ali. Procurar "menciona HEAD" passaria verde com a
   * checagem antiga intacta ao lado.
   */
  it('nenhuma guarda de método deixa o HEAD de fora', () => {
    const guardas = CODIGO.split('\n').filter(l => /req\.method !== 'GET'/.test(l));
    expect(guardas.length).toBeGreaterThanOrEqual(2);
    for (const g of guardas) expect(g).toContain("req.method !== 'HEAD'");
  });

  it('o fallback do SPA aceita os dois', () => {
    /* É ele que devolve o index.html da raiz — o que o monitor pede. */
    const i = CODIGO.indexOf("if (req.method !== 'GET' && req.method !== 'HEAD') return next();");
    expect(i).toBeGreaterThan(0);
    const depois = CODIGO.slice(i, i + 300);
    expect(depois).toContain("req.path.startsWith('/api')");
  });

  it('a API segue respondendo o 404 dela', () => {
    /* HEAD numa rota de API inexistente continua sendo 404 — o que mudou é só
       a navegação do app, não o contrato da API. */
    expect(CODIGO).toContain("res.status(404).json({ erro: 'Rota não encontrada.' })");
  });
});
